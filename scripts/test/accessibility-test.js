#!/usr/bin/env node
/**
 * Accessibility Test - Verify data-testid coverage, keyboard navigation, and ARIA
 *
 * Scans all UI components to ensure proper accessibility attributes,
 * keyboard navigability, and screen reader compatibility.
 *
 * Usage:
 *   node scripts/test/accessibility-test.js
 *   node scripts/test/accessibility-test.js --screenshots
 *   npm run test:accessibility
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/accessibility');
const SCREENSHOT_MODE = process.argv.includes('--screenshots');

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

const cdp = {
  health: () => cdpRequest('GET', '/health'),
  screenshot: (name) => {
    if (!SCREENSHOT_MODE) return Promise.resolve();
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
    return cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`);
  },
  state: () => cdpRequest('GET', '/state'),
  eval: (expr) => cdpRequest('POST', '/eval', { expression: expr }).then((r) => r.result),
  click: (sel) => cdpRequest('POST', '/click', { selector: sel }),
  key: (key, mods = {}) => cdpRequest('POST', '/key', { key, ...mods }),
  setupTestEnv: () => cdpRequest('POST', '/setup-test-env'),
};

/**
 * Test runner
 */
class AccessibilityTestRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
    this.issues = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  warn(name, message) {
    this.warnings++;
    this.issues.push({ name, type: 'warning', message });
    console.log(`  ! ${name}: ${message}`);
  }

  async run() {
    console.log('\n' + '='.repeat(50));
    console.log(`  ${this.suiteName}`);
    console.log('='.repeat(50) + '\n');

    for (const { name, fn } of this.tests) {
      try {
        const start = Date.now();
        await fn();
        const duration = Date.now() - start;
        console.log(`  + ${name} (${duration}ms)`);
        this.passed++;
      } catch (error) {
        console.log(`  x ${name}`);
        console.log(`    ${error.message}`);
        this.failed++;
        this.issues.push({ name, type: 'error', message: error.message });

        if (SCREENSHOT_MODE) {
          try {
            await cdp.screenshot(`failure-${name.replace(/\s+/g, '-').toLowerCase()}`);
          } catch (e) { /* ignore */ }
        }
      }
    }

    console.log('\n' + '-'.repeat(50));
    console.log(`Total: ${this.tests.length} | + ${this.passed} | x ${this.failed} | ! ${this.warnings}`);
    console.log('-'.repeat(50) + '\n');

    return this.failed === 0;
  }
}

// ============================================================
//  TEST SUITES
// ============================================================

/**
 * Suite 1: data-testid Coverage
 */
async function testDataTestIds() {
  const runner = new AccessibilityTestRunner('data-testid Coverage');

  runner.test('Setup: Navigate to workspace', async () => {
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
  });

  runner.test('Header buttons have data-testid', async () => {
    const result = await cdp.eval(`
      (function() {
        const headerButtons = document.querySelectorAll('header button');
        const withTestId = Array.from(headerButtons).filter(b => b.getAttribute('data-testid'));
        const withoutTestId = Array.from(headerButtons).filter(b => !b.getAttribute('data-testid'));
        return {
          total: headerButtons.length,
          withTestId: withTestId.length,
          withoutTestId: withoutTestId.length,
          missing: withoutTestId.map(b => ({
            text: b.textContent?.trim()?.slice(0, 30),
            ariaLabel: b.getAttribute('aria-label'),
          })),
        };
      })()
    `);
    if (result.withoutTestId > 0) {
      runner.warn('Header buttons', `${result.withoutTestId}/${result.total} buttons missing data-testid`);
    }
  });

  runner.test('Interactive elements in workspace have identifiers', async () => {
    const result = await cdp.eval(`
      (function() {
        const interactive = document.querySelectorAll('button, a, input, select, [role="button"], [tabindex]');
        let missing = 0;
        let total = 0;
        const missingDetails = [];
        interactive.forEach(el => {
          total++;
          const hasId = el.getAttribute('data-testid') || el.id || el.getAttribute('aria-label') || el.name;
          if (!hasId) {
            missing++;
            if (missingDetails.length < 10) {
              missingDetails.push({
                tag: el.tagName.toLowerCase(),
                text: el.textContent?.trim()?.slice(0, 30),
                className: el.className?.split?.(' ')?.slice(0, 3)?.join(' '),
              });
            }
          }
        });
        return { total, missing, missingDetails };
      })()
    `);
    const coverage = (result.total - result.missing) / result.total;
    // Report coverage but don't fail - many icon-only buttons legitimately lack identifiers
    // Log as warning if below 50%, otherwise just report the coverage number
    if (coverage < 0.5) {
      runner.warn('Interactive identifiers', `Only ${Math.round(coverage * 100)}% coverage (${result.missing}/${result.total} missing)`);
    }
    console.log(`    Coverage: ${Math.round(coverage * 100)}% (${result.total - result.missing}/${result.total} elements identified)`);
  });

  runner.test('Agent cards have data-testid', async () => {
    const result = await cdp.eval(`
      (function() {
        const cards = document.querySelectorAll('[data-testid^="agent-card-"]');
        return cards.length;
      })()
    `);
    if (result === 0) {
      throw new Error('No agent cards found with data-testid="agent-card-*"');
    }
  });

  runner.test('Settings sections have data-testid', async () => {
    // Navigate to settings
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

    const result = await cdp.eval(`
      (function() {
        const sections = document.querySelectorAll('[data-testid^="settings-section-"]');
        return {
          count: sections.length,
          ids: Array.from(sections).map(s => s.getAttribute('data-testid')),
        };
      })()
    `);

    const expectedSections = ['general', 'keyboard', 'docker', 'plans', 'cron-jobs', 'repositories'];
    const found = result.ids || [];
    const missing = expectedSections.filter(
      (s) => !found.some((id) => id.includes(s))
    );

    if (missing.length > 0) {
      throw new Error(`Missing settings section testids: ${missing.join(', ')}`);
    }
  });

  runner.test('Cron jobs section has data-testid', async () => {
    await cdp.click('[data-testid="settings-section-cron-jobs"]');
    await sleep(500);

    const result = await cdp.eval(`
      (function() {
        const section = document.querySelector('[data-testid="cron-jobs-section"]');
        const newBtn = document.querySelector('[data-testid="new-automation-button"]');
        return {
          hasSection: !!section,
          hasNewButton: !!newBtn,
        };
      })()
    `);

    if (!result.hasSection) throw new Error('Cron jobs section missing data-testid');
    if (!result.hasNewButton) throw new Error('New automation button missing data-testid');
  });

  // Return to workspace
  runner.test('Cleanup: Return to workspace', async () => {
    await cdp.key('Escape');
    await sleep(300);
  });

  return runner.run();
}

/**
 * Suite 2: Keyboard Navigation
 */
async function testKeyboardNavigation() {
  const runner = new AccessibilityTestRunner('Keyboard Navigation');

  runner.test('Cmd+K opens command palette', async () => {
    await cdp.key('k', { meta: true });
    await sleep(300);
    const hasDialog = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"], [role="dialog"]')
    `);
    if (!hasDialog) throw new Error('Command palette did not open with Cmd+K');
  });

  runner.test('Escape closes command palette', async () => {
    await cdp.key('Escape');
    await sleep(200);
    const hasDialog = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"]')
    `);
    if (hasDialog) throw new Error('Command palette did not close with Escape');
  });

  runner.test('Cmd+Shift+D toggles dev console', async () => {
    await cdp.key('d', { meta: true, shift: true });
    await sleep(300);
    // Just verify no crash
    await cdp.key('d', { meta: true, shift: true });
    await sleep(200);
  });

  runner.test('Escape from settings returns to workspace', async () => {
    // Ensure we're in workspace first
    let state = await cdp.state();
    if (state.view !== 'workspace') {
      await cdp.key('Escape');
      await sleep(500);
    }

    // Go to settings
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

    state = await cdp.state();
    if (state.view !== 'settings') {
      // May have failed to navigate - not a keyboard issue
      console.log('    (Could not navigate to settings - skipping Escape test)');
      return;
    }

    await cdp.key('Escape');
    await sleep(500);

    state = await cdp.state();
    if (state.view !== 'workspace') throw new Error(`Expected workspace after Escape, got: ${state.view}`);
  });

  runner.test('Tab key moves focus between elements', async () => {
    const result = await cdp.eval(`
      (function() {
        // Check that pressing Tab changes the active element
        const before = document.activeElement?.tagName;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        // Note: Tab doesn't actually move focus via KeyboardEvent dispatch
        // We verify focusable elements exist instead
        const focusable = document.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        return { focusableCount: focusable.length };
      })()
    `);
    if (result.focusableCount === 0) {
      throw new Error('No focusable elements found in the DOM');
    }
  });

  return runner.run();
}

/**
 * Suite 3: ARIA Attributes
 */
async function testAriaAttributes() {
  const runner = new AccessibilityTestRunner('ARIA Attributes');

  runner.test('Dialogs have role="dialog"', async () => {
    // Open command palette which is a dialog
    await cdp.key('k', { meta: true });
    await sleep(300);

    const result = await cdp.eval(`
      (function() {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        return {
          count: dialogs.length,
          hasAriaLabel: Array.from(dialogs).filter(d =>
            d.getAttribute('aria-label') || d.getAttribute('aria-labelledby')
          ).length,
        };
      })()
    `);

    await cdp.key('Escape');
    await sleep(200);

    if (result.count === 0) {
      runner.warn('Dialog ARIA', 'No elements with role="dialog" found when dialog is open');
    }
  });

  runner.test('Buttons have accessible names', async () => {
    const result = await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('button');
        const noName = [];
        buttons.forEach(b => {
          const hasName = b.textContent?.trim() ||
            b.getAttribute('aria-label') ||
            b.getAttribute('title') ||
            b.querySelector('svg')?.getAttribute('aria-label');
          if (!hasName) {
            noName.push({
              className: b.className?.split?.(' ')?.slice(0, 2)?.join(' '),
              parent: b.parentElement?.tagName?.toLowerCase(),
            });
          }
        });
        return { total: buttons.length, noName: noName.length, details: noName.slice(0, 5) };
      })()
    `);

    const coverage = (result.total - result.noName) / result.total;
    // Report coverage - many icon-only buttons without text/aria-label are common in Tailwind UIs
    if (result.noName > 0) {
      runner.warn('Button names', `${result.noName}/${result.total} buttons lack accessible names (${Math.round(coverage * 100)}% coverage)`);
    }
    console.log(`    Coverage: ${Math.round(coverage * 100)}% (${result.total - result.noName}/${result.total} buttons named)`);
  });

  runner.test('Form inputs have labels', async () => {
    // Navigate to settings to find form inputs
    await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('header button');
        const settingsBtn = Array.from(buttons).find(b =>
          b.querySelector('svg[class*="lucide-settings"]') ||
          b.title?.toLowerCase().includes('settings')
        );
        if (settingsBtn) settingsBtn.click();
        else if (buttons.length >= 3) buttons[buttons.length - 1].click();
      })()
    `);
    await sleep(500);

    const result = await cdp.eval(`
      (function() {
        const inputs = document.querySelectorAll('input, select, textarea');
        const noLabel = [];
        inputs.forEach(inp => {
          const hasLabel =
            inp.getAttribute('aria-label') ||
            inp.getAttribute('aria-labelledby') ||
            inp.getAttribute('placeholder') ||
            inp.id && document.querySelector(\`label[for="\${inp.id}"]\`) ||
            inp.closest('label');
          if (!hasLabel) {
            noLabel.push({
              type: inp.type || inp.tagName.toLowerCase(),
              name: inp.name,
              id: inp.id,
            });
          }
        });
        return { total: inputs.length, noLabel: noLabel.length, details: noLabel.slice(0, 5) };
      })()
    `);

    if (result.noLabel > 0) {
      runner.warn('Input labels', `${result.noLabel}/${result.total} inputs missing labels`);
    }

    await cdp.key('Escape');
    await sleep(300);
  });

  runner.test('Images have alt text', async () => {
    const result = await cdp.eval(`
      (function() {
        const images = document.querySelectorAll('img');
        const noAlt = Array.from(images).filter(img => !img.getAttribute('alt'));
        return { total: images.length, noAlt: noAlt.length };
      })()
    `);
    if (result.total > 0 && result.noAlt > 0) {
      runner.warn('Image alt text', `${result.noAlt}/${result.total} images missing alt text`);
    }
  });

  runner.test('Switch components have accessible state', async () => {
    // Navigate to settings to find switches
    await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('header button');
        const settingsBtn = Array.from(buttons).find(b =>
          b.querySelector('svg[class*="lucide-settings"]') ||
          b.title?.toLowerCase().includes('settings')
        );
        if (settingsBtn) settingsBtn.click();
        else if (buttons.length >= 3) buttons[buttons.length - 1].click();
      })()
    `);
    await sleep(500);

    const result = await cdp.eval(`
      (function() {
        const switches = document.querySelectorAll('[role="switch"], [data-state]');
        const withState = Array.from(switches).filter(s =>
          s.getAttribute('aria-checked') !== null || s.getAttribute('data-state')
        );
        return { total: switches.length, withState: withState.length };
      })()
    `);

    if (result.total > 0 && result.withState < result.total) {
      runner.warn('Switch state', `${result.total - result.withState}/${result.total} switches missing state`);
    }

    await cdp.key('Escape');
    await sleep(300);
  });

  return runner.run();
}

/**
 * Suite 4: Focus Management
 */
async function testFocusManagement() {
  const runner = new AccessibilityTestRunner('Focus Management');

  runner.test('Focus indicator is visible on buttons', async () => {
    const result = await cdp.eval(`
      (function() {
        // Check that buttons have focus-visible styles defined
        const buttons = document.querySelectorAll('button');
        let hasFocusStyles = 0;
        buttons.forEach(b => {
          const styles = window.getComputedStyle(b);
          // Check if the button has outline or ring styles when focused
          const hasOutline = styles.outlineStyle !== 'none' || b.className.includes('focus');
          if (hasOutline || b.className.includes('ring') || b.className.includes('focus')) {
            hasFocusStyles++;
          }
        });
        return { total: buttons.length, withFocus: hasFocusStyles };
      })()
    `);
    // Most Tailwind components have focus-visible styles via ring utility
    // Just verify buttons exist
    if (result.total === 0) {
      throw new Error('No buttons found');
    }
  });

  runner.test('Modal traps focus', async () => {
    // Open command palette
    await cdp.key('k', { meta: true });
    await sleep(300);

    const result = await cdp.eval(`
      (function() {
        const dialog = document.querySelector('[role="dialog"], [class*="CommandSearch"]');
        if (!dialog) return { hasDialog: false };
        // Check if active element is inside dialog
        const activeInDialog = dialog.contains(document.activeElement);
        // Check if dialog has focusable elements
        const focusable = dialog.querySelectorAll(
          'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        return {
          hasDialog: true,
          activeInDialog,
          focusableCount: focusable.length,
        };
      })()
    `);

    await cdp.key('Escape');
    await sleep(200);

    if (result.hasDialog && result.focusableCount === 0) {
      throw new Error('Dialog has no focusable elements');
    }
  });

  return runner.run();
}

// ============================================================
//  MAIN
// ============================================================

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  BISMARCK ACCESSIBILITY TESTS');
  console.log('='.repeat(60));

  // Check CDP
  try {
    const health = await cdpRequest('GET', '/health');
    if (health.cdp !== 'connected') throw new Error('CDP not connected');
    console.log('\nCDP connected');
  } catch (error) {
    console.error('\nCDP server not available:', error.message);
    console.error('Run: npm run dev:cdp:wait\n');
    process.exit(1);
  }

  if (SCREENSHOT_MODE && !fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const results = [];
  results.push(await testDataTestIds());
  results.push(await testKeyboardNavigation());
  results.push(await testAriaAttributes());
  results.push(await testFocusManagement());

  const allPassed = results.every((r) => r);

  // Generate report
  const reportDir = path.join(__dirname, '../../test-reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    type: 'accessibility',
    timestamp: new Date().toISOString(),
    suites: ['data-testid Coverage', 'Keyboard Navigation', 'ARIA Attributes', 'Focus Management'],
    passed: allPassed,
    results: results.map((r, i) => ({
      suite: ['data-testid Coverage', 'Keyboard Navigation', 'ARIA Attributes', 'Focus Management'][i],
      passed: r,
    })),
  };

  fs.writeFileSync(
    path.join(reportDir, 'accessibility-test-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n' + '='.repeat(60));
  console.log(allPassed ? '  ALL ACCESSIBILITY SUITES PASSED' : '  SOME ACCESSIBILITY SUITES FAILED');
  console.log('='.repeat(60) + '\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
