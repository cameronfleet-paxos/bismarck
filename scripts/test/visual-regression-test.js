#!/usr/bin/env node
/**
 * Visual Regression Test - Compare screenshots against baselines
 *
 * Takes screenshots of all major UI states and compares them against
 * previously captured baselines to detect unintended visual changes.
 *
 * Usage:
 *   node scripts/test/visual-regression-test.js               # Compare against baseline
 *   node scripts/test/visual-regression-test.js --update       # Update baseline screenshots
 *   node scripts/test/visual-regression-test.js --screenshots  # Save diff screenshots
 *   npm run test:visual
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';
const BASELINE_DIR = path.join(__dirname, '../../test-screenshots/baseline');
const CURRENT_DIR = path.join(__dirname, '../../test-screenshots/current');
const DIFF_DIR = path.join(__dirname, '../../test-screenshots/diff');
const UPDATE_MODE = process.argv.includes('--update');
const SCREENSHOT_MODE = process.argv.includes('--screenshots') || UPDATE_MODE;

/**
 * Make HTTP request to CDP server
 */
async function cdpRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = `http://${CDP_SERVER_HOST}:${CDP_SERVER_PORT}${endpoint}`;
    const options = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    };
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error));
          else resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CDP helper shortcuts
 */
const cdp = {
  health: () => cdpRequest('GET', '/health'),
  screenshot: (name) => {
    const dir = UPDATE_MODE ? BASELINE_DIR : CURRENT_DIR;
    const filePath = path.join(dir, `${name}.png`);
    return cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`).then(() => filePath);
  },
  state: () => cdpRequest('GET', '/state'),
  eval: (expr) => cdpRequest('POST', '/eval', { expression: expr }).then((r) => r.result),
  click: (target) => {
    const body = target.startsWith('[') || target.startsWith('.') || target.startsWith('#')
      ? { selector: target }
      : { text: target };
    return cdpRequest('POST', '/click', body);
  },
  key: (key, mods = {}) => cdpRequest('POST', '/key', { key, ...mods }),
  wait: (sel, timeout = 5000) => cdpRequest('POST', '/wait', { selector: sel, timeout }),
  setupTestEnv: () => cdpRequest('POST', '/setup-test-env'),
};

/**
 * Compare two PNG files byte-by-byte
 * Returns the percentage of different bytes (rough comparison)
 */
function compareScreenshots(baselinePath, currentPath) {
  if (!fs.existsSync(baselinePath)) {
    return { match: false, reason: 'no_baseline', diff: 100 };
  }
  if (!fs.existsSync(currentPath)) {
    return { match: false, reason: 'no_current', diff: 100 };
  }

  const baseline = fs.readFileSync(baselinePath);
  const current = fs.readFileSync(currentPath);

  // Quick size check
  if (baseline.length !== current.length) {
    const sizeDiff = Math.abs(baseline.length - current.length) / Math.max(baseline.length, current.length);
    return { match: false, reason: 'size_mismatch', diff: Math.round(sizeDiff * 100) };
  }

  // Byte-by-byte comparison
  let diffBytes = 0;
  const minLen = Math.min(baseline.length, current.length);
  for (let i = 0; i < minLen; i++) {
    if (baseline[i] !== current[i]) diffBytes++;
  }

  const diffPercent = (diffBytes / minLen) * 100;

  // Allow 1% tolerance for rendering differences
  const threshold = 1.0;
  return {
    match: diffPercent <= threshold,
    diff: Math.round(diffPercent * 100) / 100,
    reason: diffPercent > threshold ? 'pixel_diff' : 'match',
  };
}

/**
 * Test runner
 */
class VisualTestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.updated = 0;
    this.skipped = 0;
  }

  test(name, captureFn) {
    this.tests.push({ name, captureFn });
  }

  async run() {
    console.log('\n' + '='.repeat(60));
    console.log(UPDATE_MODE
      ? '  VISUAL REGRESSION - UPDATING BASELINES'
      : '  VISUAL REGRESSION TESTS');
    console.log('='.repeat(60) + '\n');

    // Check CDP
    try {
      const health = await cdp.health();
      if (health.cdp !== 'connected') throw new Error('CDP not connected');
      console.log('CDP connected\n');
    } catch (error) {
      console.error('CDP server not available:', error.message);
      console.error('Run: npm run dev:cdp:wait\n');
      process.exit(1);
    }

    // Ensure directories
    [BASELINE_DIR, CURRENT_DIR, DIFF_DIR].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    // Setup test environment
    try {
      await cdp.setupTestEnv();
      await sleep(500);
      await cdp.eval(`
        (function() {
          const buttons = document.querySelectorAll('button');
          const cancelBtn = Array.from(buttons).find(b =>
            b.textContent === 'Cancel' || b.textContent === 'Skip Setup'
          );
          if (cancelBtn) cancelBtn.click();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()
      `);
      await sleep(300);
      await cdp.eval('location.reload()');
      await sleep(2000);
    } catch (e) {
      console.log('Note: Setup may have already been done');
    }

    // Run captures
    for (const { name, captureFn } of this.tests) {
      try {
        const screenshotName = name.replace(/\s+/g, '-').toLowerCase();
        await captureFn();
        await sleep(300);

        const currentPath = await cdp.screenshot(screenshotName);
        const baselinePath = path.join(BASELINE_DIR, `${screenshotName}.png`);

        if (UPDATE_MODE) {
          // In update mode, screenshots go directly to baseline
          this.updated++;
          console.log(`  Updated: ${name}`);
        } else if (!fs.existsSync(baselinePath)) {
          // No baseline exists - this is a new test
          this.skipped++;
          console.log(`  o ${name} (no baseline - run with --update first)`);
        } else {
          // Compare against baseline
          const result = compareScreenshots(baselinePath, currentPath);
          if (result.match) {
            this.passed++;
            console.log(`  + ${name} (${result.diff}% diff)`);
          } else {
            this.failed++;
            console.log(`  x ${name} (${result.diff}% diff - ${result.reason})`);

            // Copy files for review
            if (SCREENSHOT_MODE) {
              const diffBaseline = path.join(DIFF_DIR, `${screenshotName}-baseline.png`);
              const diffCurrent = path.join(DIFF_DIR, `${screenshotName}-current.png`);
              if (fs.existsSync(baselinePath)) fs.copyFileSync(baselinePath, diffBaseline);
              if (fs.existsSync(currentPath)) fs.copyFileSync(currentPath, diffCurrent);
              console.log(`    Diff files in: ${DIFF_DIR}`);
            }
          }
        }
      } catch (error) {
        this.failed++;
        console.log(`  x ${name} - Error: ${error.message}`);
      }
    }

    // Summary
    console.log('\n' + '-'.repeat(60));
    if (UPDATE_MODE) {
      console.log(`Updated: ${this.updated} baselines`);
      console.log(`Baseline directory: ${BASELINE_DIR}`);
    } else {
      console.log(`Total: ${this.tests.length} | + ${this.passed} | x ${this.failed} | o ${this.skipped}`);
    }
    console.log('-'.repeat(60) + '\n');

    return this.failed === 0;
  }
}

// ============================================================
//  VISUAL TEST DEFINITIONS
// ============================================================

const runner = new VisualTestRunner();

// Workspace view
runner.test('Workspace - Default View', async () => {
  const state = await cdp.state();
  if (state.view !== 'workspace') {
    await cdp.key('Escape');
    await sleep(300);
  }
});

runner.test('Workspace - Agent Selected', async () => {
  await cdp.eval(`
    (function() {
      const card = document.querySelector('[data-testid^="agent-card-"]');
      if (card) card.click();
    })()
  `);
  await sleep(300);
});

runner.test('Workspace - Tab Bar', async () => {
  // Already in workspace with agent selected, tab bar should be visible
  await sleep(100);
});

// Settings views
runner.test('Settings - General', async () => {
  await cdp.eval(`
    (function() {
      const buttons = document.querySelectorAll('header button');
      const settingsBtn = Array.from(buttons).find(b =>
        b.querySelector('svg[class*="lucide-settings"]') ||
        b.getAttribute('aria-label')?.includes('settings') ||
        b.title?.toLowerCase().includes('settings')
      );
      if (settingsBtn) settingsBtn.click();
      else if (buttons.length >= 3) buttons[buttons.length - 1].click();
    })()
  `);
  await sleep(500);
});

runner.test('Settings - Keyboard Shortcuts', async () => {
  await cdp.click('[data-testid="settings-section-keyboard"]');
  await sleep(300);
});

runner.test('Settings - Docker', async () => {
  await cdp.click('[data-testid="settings-section-docker"]');
  await sleep(300);
});

runner.test('Settings - Authentication', async () => {
  await cdp.click('[data-testid="settings-section-authentication"]');
  await sleep(300);
});

runner.test('Settings - Cron Automations', async () => {
  await cdp.click('[data-testid="settings-section-cron-jobs"]');
  await sleep(500);
});

runner.test('Settings - Repositories', async () => {
  await cdp.click('[data-testid="settings-section-repositories"]');
  await sleep(300);
});

runner.test('Settings - Teams and Prompts', async () => {
  await cdp.click('[data-testid="settings-section-plans"]');
  await sleep(300);
});

runner.test('Settings - Advanced', async () => {
  await cdp.click('[data-testid="settings-section-advanced"]');
  await sleep(300);
});

// Back to workspace
runner.test('Settings - Back to Workspace', async () => {
  await cdp.key('Escape');
  await sleep(300);
});

// Command palette
runner.test('Command Palette - Open', async () => {
  await cdp.key('k', { meta: true });
  await sleep(400);
});

runner.test('Command Palette - Close', async () => {
  await cdp.key('Escape');
  await sleep(300);
});

// Dev console
runner.test('Dev Console - Toggle On', async () => {
  await cdp.key('d', { meta: true, shift: true });
  await sleep(400);
});

runner.test('Dev Console - Toggle Off', async () => {
  await cdp.key('d', { meta: true, shift: true });
  await sleep(300);
});

// ============================================================
//  MAIN
// ============================================================

async function main() {
  const passed = await runner.run();

  // Generate report
  const reportDir = path.join(__dirname, '../../test-reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    type: 'visual-regression',
    timestamp: new Date().toISOString(),
    mode: UPDATE_MODE ? 'update' : 'compare',
    baselineDir: BASELINE_DIR,
    results: runner.tests.map((t) => ({
      name: t.name,
      status: UPDATE_MODE ? 'updated' : 'captured',
    })),
    summary: {
      total: runner.tests.length,
      passed: runner.passed,
      failed: runner.failed,
      updated: runner.updated,
      skipped: runner.skipped,
    },
  };

  fs.writeFileSync(
    path.join(reportDir, 'visual-regression-report.json'),
    JSON.stringify(report, null, 2)
  );

  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
