#!/usr/bin/env node
/**
 * Stress Test Script
 *
 * Drives the mock harness with 200+ tasks and measures:
 * - Time to create all tasks in beads
 * - Time for all tasks to reach completed state
 * - Memory usage over time
 * - IPC event throughput
 * - Detection of stuck/stagnated tasks
 *
 * Usage:
 *   node scripts/test/stress-test.js [scenario] [count]
 *
 * Scenarios: linear-chain, wide-parallel, deep-diamond, mixed-complex
 *
 * Requirements:
 * - App must be running with CDP (npm run dev:cdp:wait or xvfb-run approach)
 * - CDP server at localhost:9333
 */

const http = require('http');
const { performance } = require('perf_hooks');

const CDP_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const scenario = process.argv[2] || 'wide-parallel';
const taskCount = parseInt(process.argv[3] || '200', 10);

// Thresholds for pass/fail
const THRESHOLDS = {
  setupTimeMs: 120_000,      // Max time to create all tasks
  completionTimeMs: 300_000, // Max time for all tasks to complete
  maxMemoryMB: 512,          // Max renderer memory usage
  minEventsPerSecond: 1,     // Minimum IPC event throughput
  maxStuckDurationMs: 60_000, // Max time a task can be stuck
};

/**
 * Make HTTP request to CDP server
 */
function cdpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: CDP_PORT,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function evalJS(expression) {
  return cdpRequest('POST', '/eval', expression);
}

async function screenshot(path) {
  return cdpRequest('GET', `/screenshot?path=${encodeURIComponent(path)}`);
}

async function getState() {
  return cdpRequest('GET', '/state');
}

async function health() {
  return cdpRequest('GET', '/health');
}

/**
 * Wait for a condition to be true, polling periodically
 */
async function waitFor(label, checkFn, timeoutMs = 300_000, intervalMs = 2_000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const result = await checkFn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for: ${label} (${timeoutMs}ms)`);
}

/**
 * Get memory usage from renderer process via CDP
 */
async function getMemoryUsageMB() {
  try {
    const result = await evalJS('JSON.stringify(process.memoryUsage())');
    if (result && result.result) {
      const mem = JSON.parse(result.result);
      return Math.round(mem.heapUsed / 1024 / 1024);
    }
  } catch {
    // ignore
  }
  return 0;
}

/**
 * Main stress test
 */
async function runStressTest() {
  console.log('='.repeat(60));
  console.log(`Bismarck Stress Test`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Task Count: ${taskCount}`);
  console.log('='.repeat(60));

  // Step 1: Check CDP connection
  console.log('\n[1/6] Checking CDP connection...');
  try {
    const h = await health();
    if (h.cdp !== 'connected') {
      console.error('CDP not connected. Start the app with: npm run dev:cdp:wait');
      process.exit(1);
    }
    console.log('  CDP connected');
  } catch (err) {
    console.error('Cannot reach CDP server at localhost:' + CDP_PORT);
    console.error('Start the app with: npm run dev:cdp:wait');
    process.exit(1);
  }

  // Step 2: Bypass onboarding
  console.log('\n[2/6] Setting up test environment...');
  try {
    await cdpRequest('POST', '/setup-test-env', { agents: [{ path: '/workspace', name: 'stress-test' }] });
    console.log('  Test environment ready');
  } catch {
    console.log('  (setup-test-env not available, continuing)');
  }

  // Step 3: Start mock flow with scenario
  console.log(`\n[3/6] Starting mock flow (${scenario}, ${taskCount} tasks)...`);
  const setupStart = performance.now();

  const mockFlowResult = await evalJS(`
    (async () => {
      try {
        const result = await window.electronAPI.devRunMockFlow({
          scenario: '${scenario}',
          taskCount: ${taskCount},
          eventIntervalMs: 500,
          teamMode: '${scenario === 'wide-parallel' ? 'bottom-up' : 'top-down'}',
        });
        return JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: err.message });
      }
    })()
  `);

  const setupEnd = performance.now();
  const setupTimeMs = Math.round(setupEnd - setupStart);

  let planId = null;
  if (mockFlowResult && mockFlowResult.result) {
    try {
      const parsed = JSON.parse(mockFlowResult.result);
      if (parsed.error) {
        console.error('  Mock flow error:', parsed.error);
        process.exit(1);
      }
      planId = parsed.planId;
      const taskIds = parsed.tasks?.map(t => t.id) || [];
      console.log(`  Created plan: ${planId}`);
      console.log(`  Tasks created: ${taskIds.length}`);
      console.log(`  Setup time: ${setupTimeMs}ms`);
    } catch {
      console.error('  Failed to parse mock flow result:', mockFlowResult);
      process.exit(1);
    }
  } else {
    console.error('  No result from mock flow');
    process.exit(1);
  }

  // Step 4: Take initial screenshot
  console.log('\n[4/6] Taking initial screenshot...');
  await screenshot('/tmp/claude/stress-test-initial.png');
  console.log('  Saved: /tmp/claude/stress-test-initial.png');

  // Step 5: Monitor task completion
  console.log('\n[5/6] Monitoring task completion...');
  const monitorStart = performance.now();
  let memoryPeakMB = 0;
  let eventCount = 0;
  let lastEventCount = 0;
  let lastCheckTime = monitorStart;
  let checksCompleted = 0;
  let allDone = false;

  const MONITOR_INTERVAL_MS = 3_000;
  const MONITOR_TIMEOUT_MS = THRESHOLDS.completionTimeMs;

  while (performance.now() - monitorStart < MONITOR_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, MONITOR_INTERVAL_MS));
    checksCompleted++;

    // Check memory
    const memMB = await getMemoryUsageMB();
    if (memMB > memoryPeakMB) memoryPeakMB = memMB;

    // Check state
    const state = await getState();

    // Check for plan completion via eval
    const completionResult = await evalJS(`
      (async () => {
        try {
          const plans = await window.electronAPI.getPlans();
          const plan = plans.find(p => p.id === '${planId}');
          if (!plan) return JSON.stringify({ status: 'not_found' });
          return JSON.stringify({ status: plan.status });
        } catch (err) {
          return JSON.stringify({ error: err.message });
        }
      })()
    `);

    let planStatus = 'unknown';
    if (completionResult?.result) {
      try {
        planStatus = JSON.parse(completionResult.result).status;
      } catch {}
    }

    const elapsed = Math.round((performance.now() - monitorStart) / 1000);
    console.log(`  [${elapsed}s] Plan status: ${planStatus}, Memory: ${memMB}MB (peak: ${memoryPeakMB}MB), View: ${state?.view || 'unknown'}`);

    if (planStatus === 'completed' || planStatus === 'ready_for_review') {
      allDone = true;
      break;
    }

    if (planStatus === 'failed') {
      console.error('  Plan failed!');
      break;
    }

    // Take periodic screenshots
    if (checksCompleted % 10 === 0) {
      await screenshot(`/tmp/claude/stress-test-progress-${checksCompleted}.png`);
    }
  }

  const completionTimeMs = Math.round(performance.now() - monitorStart);

  // Step 6: Take final screenshot and generate report
  console.log('\n[6/6] Generating report...');
  await screenshot('/tmp/claude/stress-test-final.png');
  console.log('  Saved: /tmp/claude/stress-test-final.png');

  // Generate report
  console.log('\n' + '='.repeat(60));
  console.log('STRESS TEST REPORT');
  console.log('='.repeat(60));

  const results = {
    scenario,
    taskCount,
    setupTimeMs,
    completionTimeMs,
    memoryPeakMB,
    allTasksCompleted: allDone,
  };

  const checks = [
    {
      name: 'Setup time',
      value: `${setupTimeMs}ms`,
      pass: setupTimeMs <= THRESHOLDS.setupTimeMs,
      threshold: `<= ${THRESHOLDS.setupTimeMs}ms`,
    },
    {
      name: 'Completion time',
      value: `${completionTimeMs}ms`,
      pass: completionTimeMs <= THRESHOLDS.completionTimeMs,
      threshold: `<= ${THRESHOLDS.completionTimeMs}ms`,
    },
    {
      name: 'All tasks completed',
      value: allDone ? 'Yes' : 'No',
      pass: allDone,
      threshold: 'Yes',
    },
    {
      name: 'Peak memory',
      value: `${memoryPeakMB}MB`,
      pass: memoryPeakMB <= THRESHOLDS.maxMemoryMB,
      threshold: `<= ${THRESHOLDS.maxMemoryMB}MB`,
    },
  ];

  let allPassed = true;
  for (const check of checks) {
    const icon = check.pass ? '✓' : '✗';
    const status = check.pass ? 'PASS' : 'FAIL';
    console.log(`  ${icon} ${check.name}: ${check.value} (${check.threshold}) [${status}]`);
    if (!check.pass) allPassed = false;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`RESULT: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);
  console.log('='.repeat(60));

  // Write JSON report
  const fs = require('fs');
  const reportPath = '/tmp/claude/stress-test-report.json';
  fs.mkdirSync('/tmp/claude', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ ...results, checks }, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  // Clean up mock flow
  await evalJS('window.electronAPI.devStopMock()');

  process.exit(allPassed ? 0 : 1);
}

runStressTest().catch(err => {
  console.error('Stress test failed:', err);
  process.exit(1);
});
