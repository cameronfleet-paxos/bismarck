#!/usr/bin/env node
/**
 * Performance Test - Measure CDP response times and UI render performance
 *
 * Benchmarks CDP endpoints, UI interactions, and memory usage to detect
 * performance regressions.
 *
 * Usage:
 *   node scripts/test/performance-test.js
 *   node scripts/test/performance-test.js --iterations 20
 *   npm run test:performance
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';
const ITERATIONS = parseInt(
  process.argv.find((a, i) => process.argv[i - 1] === '--iterations') || '10',
  10
);

// Performance budgets (milliseconds)
const BUDGETS = {
  'health': 50,
  'state': 200,
  'screenshot': 2000,
  'eval-simple': 100,
  'eval-complex': 500,
  'click': 300,
  'key': 200,
  'ui-snapshot': 300,
  'agents-list': 200,
  'view-switch': 1000,
  'settings-section-switch': 500,
};

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
 * Measure execution time of an async function
 */
async function measure(fn) {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1_000_000; // Convert to ms
}

/**
 * Run multiple iterations and return statistics
 */
async function benchmark(name, fn, iterations = ITERATIONS) {
  const times = [];

  // Warmup (1 iteration)
  try {
    await fn();
  } catch (e) {
    return { name, error: e.message };
  }

  for (let i = 0; i < iterations; i++) {
    try {
      const time = await measure(fn);
      times.push(time);
    } catch (e) {
      return { name, error: e.message };
    }
  }

  times.sort((a, b) => a - b);

  const stats = {
    name,
    iterations,
    min: Math.round(times[0] * 100) / 100,
    max: Math.round(times[times.length - 1] * 100) / 100,
    median: Math.round(times[Math.floor(times.length / 2)] * 100) / 100,
    mean: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
    p95: Math.round(times[Math.floor(times.length * 0.95)] * 100) / 100,
    p99: Math.round(times[Math.floor(times.length * 0.99)] * 100) / 100,
  };

  // Check budget
  const budget = BUDGETS[name];
  if (budget) {
    stats.budget = budget;
    stats.withinBudget = stats.median <= budget;
  }

  return stats;
}

/**
 * Format a benchmark result as a table row
 */
function formatResult(result) {
  if (result.error) {
    return `  x ${result.name.padEnd(25)} ERROR: ${result.error}`;
  }

  const budgetStr = result.budget
    ? result.withinBudget
      ? ` [budget: ${result.budget}ms OK]`
      : ` [budget: ${result.budget}ms EXCEEDED]`
    : '';

  const status = result.withinBudget === false ? 'x' : '+';

  return (
    `  ${status} ${result.name.padEnd(25)} ` +
    `min=${String(result.min).padStart(7)}ms  ` +
    `med=${String(result.median).padStart(7)}ms  ` +
    `p95=${String(result.p95).padStart(7)}ms  ` +
    `max=${String(result.max).padStart(7)}ms` +
    budgetStr
  );
}

// ============================================================
//  BENCHMARK SUITES
// ============================================================

/**
 * Suite 1: CDP Endpoint Response Times
 */
async function benchmarkCDPEndpoints() {
  console.log('\n' + '='.repeat(70));
  console.log('  CDP Endpoint Benchmarks');
  console.log('='.repeat(70) + '\n');

  const results = [];

  // Health check
  results.push(await benchmark('health', () => cdpRequest('GET', '/health')));

  // State detection
  results.push(await benchmark('state', () => cdpRequest('GET', '/state')));

  // UI snapshot
  results.push(await benchmark('ui-snapshot', () => cdpRequest('GET', '/ui')));

  // Agents list
  results.push(await benchmark('agents-list', () => cdpRequest('GET', '/agents')));

  // Simple eval
  results.push(
    await benchmark('eval-simple', () =>
      cdpRequest('POST', '/eval', { expression: '1 + 1' })
    )
  );

  // Complex eval (DOM traversal)
  results.push(
    await benchmark('eval-complex', () =>
      cdpRequest('POST', '/eval', {
        expression: `
          (function() {
            const els = document.querySelectorAll('*');
            return { count: els.length };
          })()
        `,
      })
    )
  );

  // Screenshot
  results.push(
    await benchmark(
      'screenshot',
      () => cdpRequest('GET', '/screenshot?path=/tmp/perf-test-screenshot.png'),
      Math.min(ITERATIONS, 5) // Fewer iterations for screenshots
    )
  );

  // Key press
  results.push(
    await benchmark('key', async () => {
      // Press a harmless key
      await cdpRequest('POST', '/key', { key: 'Shift' });
    })
  );

  results.forEach((r) => console.log(formatResult(r)));

  return results;
}

/**
 * Suite 2: UI Interaction Performance
 */
async function benchmarkUIInteractions() {
  console.log('\n' + '='.repeat(70));
  console.log('  UI Interaction Benchmarks');
  console.log('='.repeat(70) + '\n');

  const results = [];

  // View switch: workspace -> settings -> workspace
  results.push(
    await benchmark(
      'view-switch',
      async () => {
        // Go to settings
        await cdpRequest('POST', '/eval', {
          expression: `
            (function() {
              const buttons = document.querySelectorAll('header button');
              const settingsBtn = Array.from(buttons).find(b =>
                b.querySelector('svg[class*="lucide-settings"]') ||
                b.title?.toLowerCase().includes('settings')
              );
              if (settingsBtn) settingsBtn.click();
              else if (buttons.length >= 3) buttons[buttons.length - 1].click();
            })()
          `,
        });
        await sleep(100);
        // Return to workspace
        await cdpRequest('POST', '/key', { key: 'Escape' });
        await sleep(100);
      },
      5
    )
  );

  // Settings section switch
  // First navigate to settings
  await cdpRequest('POST', '/eval', {
    expression: `
      (function() {
        const buttons = document.querySelectorAll('header button');
        const settingsBtn = Array.from(buttons).find(b =>
          b.querySelector('svg[class*="lucide-settings"]') ||
          b.title?.toLowerCase().includes('settings')
        );
        if (settingsBtn) settingsBtn.click();
        else if (buttons.length >= 3) buttons[buttons.length - 1].click();
      })()
    `,
  });
  await sleep(300);

  const sections = ['general', 'keyboard', 'docker', 'cron-jobs', 'repositories', 'advanced'];
  let sectionIdx = 0;

  results.push(
    await benchmark(
      'settings-section-switch',
      async () => {
        const section = sections[sectionIdx % sections.length];
        await cdpRequest('POST', '/click', {
          selector: `[data-testid="settings-section-${section}"]`,
        });
        await sleep(50);
        sectionIdx++;
      },
      sections.length * 2
    )
  );

  // Return to workspace
  await cdpRequest('POST', '/key', { key: 'Escape' });
  await sleep(200);

  // Command palette open/close
  results.push(
    await benchmark(
      'command-palette',
      async () => {
        await cdpRequest('POST', '/key', { key: 'k', meta: true });
        await sleep(50);
        await cdpRequest('POST', '/key', { key: 'Escape' });
        await sleep(50);
      },
      5
    )
  );

  results.forEach((r) => console.log(formatResult(r)));

  return results;
}

/**
 * Suite 3: Memory Usage
 */
async function benchmarkMemory() {
  console.log('\n' + '='.repeat(70));
  console.log('  Memory Usage');
  console.log('='.repeat(70) + '\n');

  const snapshots = [];

  // Take initial memory snapshot
  const getMemory = async () => {
    const result = await cdpRequest('POST', '/eval', {
      expression: `
        (function() {
          if (performance.memory) {
            return {
              usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
              jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            };
          }
          return null;
        })()
      `,
    });
    return result.result;
  };

  const initial = await getMemory();
  if (!initial) {
    console.log('  Memory API not available (performance.memory)');
    return [];
  }

  snapshots.push({ label: 'initial', ...initial });
  console.log(`  Initial heap: ${Math.round(initial.usedJSHeapSize / 1024 / 1024)}MB`);

  // Perform some operations
  for (let i = 0; i < 10; i++) {
    await cdpRequest('GET', '/state');
    await cdpRequest('GET', '/ui');
    await cdpRequest('GET', '/agents');
    await cdpRequest('POST', '/eval', { expression: 'document.querySelectorAll("*").length' });
  }

  const afterOps = await getMemory();
  if (afterOps) {
    snapshots.push({ label: 'after-operations', ...afterOps });
    console.log(`  After operations: ${Math.round(afterOps.usedJSHeapSize / 1024 / 1024)}MB`);
  }

  // Navigate between views
  for (let i = 0; i < 5; i++) {
    await cdpRequest('POST', '/eval', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('header button');
          const settingsBtn = Array.from(buttons).find(b =>
            b.querySelector('svg[class*="lucide-settings"]') ||
            b.title?.toLowerCase().includes('settings')
          );
          if (settingsBtn) settingsBtn.click();
          else if (buttons.length >= 3) buttons[buttons.length - 1].click();
        })()
      `,
    });
    await sleep(100);
    await cdpRequest('POST', '/key', { key: 'Escape' });
    await sleep(100);
  }

  const afterNav = await getMemory();
  if (afterNav) {
    snapshots.push({ label: 'after-navigation', ...afterNav });
    console.log(`  After navigation: ${Math.round(afterNav.usedJSHeapSize / 1024 / 1024)}MB`);

    // Check for memory growth
    const growth = afterNav.usedJSHeapSize - initial.usedJSHeapSize;
    const growthMB = Math.round(growth / 1024 / 1024);
    const growthPct = Math.round((growth / initial.usedJSHeapSize) * 100);

    if (growthPct > 50) {
      console.log(`  ! Memory grew by ${growthMB}MB (${growthPct}%) - possible leak`);
    } else {
      console.log(`  + Memory growth: ${growthMB}MB (${growthPct}%) - acceptable`);
    }
  }

  return snapshots;
}

// ============================================================
//  MAIN
// ============================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  BISMARCK PERFORMANCE TESTS');
  console.log(`  Iterations: ${ITERATIONS}`);
  console.log('='.repeat(70));

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

  // Setup test env
  try {
    await cdpRequest('POST', '/setup-test-env');
    await sleep(500);
    await cdpRequest('POST', '/eval', {
      expression: `
        (function() {
          const buttons = document.querySelectorAll('button');
          const cancelBtn = Array.from(buttons).find(b =>
            b.textContent === 'Cancel' || b.textContent === 'Skip Setup'
          );
          if (cancelBtn) cancelBtn.click();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        })()
      `,
    });
    await sleep(300);
    await cdpRequest('POST', '/eval', { expression: 'location.reload()' });
    await sleep(2000);
  } catch (e) {
    console.log('Note: Setup may have already been done');
  }

  // Run benchmarks
  const cdpResults = await benchmarkCDPEndpoints();
  const uiResults = await benchmarkUIInteractions();
  const memoryResults = await benchmarkMemory();

  // Check budgets
  const allResults = [...cdpResults, ...uiResults];
  const budgetViolations = allResults.filter((r) => r.withinBudget === false);

  console.log('\n' + '='.repeat(70));
  if (budgetViolations.length === 0) {
    console.log('  ALL PERFORMANCE BUDGETS MET');
  } else {
    console.log(`  ${budgetViolations.length} PERFORMANCE BUDGET(S) EXCEEDED:`);
    budgetViolations.forEach((v) => {
      console.log(`    - ${v.name}: ${v.median}ms > ${v.budget}ms budget`);
    });
  }
  console.log('='.repeat(70) + '\n');

  // Generate report
  const reportDir = path.join(__dirname, '../../test-reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    type: 'performance',
    timestamp: new Date().toISOString(),
    iterations: ITERATIONS,
    budgets: BUDGETS,
    cdpEndpoints: cdpResults,
    uiInteractions: uiResults,
    memory: memoryResults,
    budgetViolations: budgetViolations.map((v) => ({
      name: v.name,
      median: v.median,
      budget: v.budget,
    })),
    passed: budgetViolations.length === 0,
  };

  fs.writeFileSync(
    path.join(reportDir, 'performance-test-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`Report saved to: ${path.join(reportDir, 'performance-test-report.json')}\n`);

  process.exit(budgetViolations.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
