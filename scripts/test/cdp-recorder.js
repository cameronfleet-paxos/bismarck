#!/usr/bin/env node
/**
 * CDP Recorder - Record user interactions and generate test scripts
 *
 * Monitors CDP events to capture clicks, keypresses, navigation, and
 * state changes. Generates executable test code matching the pattern
 * used in core-flows-test.js.
 *
 * Usage:
 *   node scripts/test/cdp-recorder.js
 *   node scripts/test/cdp-recorder.js --output my-test.js
 *   npm run dev:recorder
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 *
 * Controls:
 *   r - Start/resume recording
 *   p - Pause recording
 *   s - Take snapshot (screenshot + state)
 *   g - Generate test code from recording
 *   c - Clear recording
 *   q - Quit
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';
const OUTPUT_FILE = process.argv.find((a, i) => process.argv[i - 1] === '--output') ||
  `recorded-test-${Date.now()}.js`;

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
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
          resolve(JSON.parse(data));
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

// Recording state
let recording = false;
let events = [];
let startTime = null;

/**
 * Poll for state changes and record them
 */
async function pollState() {
  let lastState = null;
  let lastAgents = null;

  while (true) {
    if (recording) {
      try {
        const state = await cdpRequest('GET', '/state');
        const stateStr = JSON.stringify(state);

        if (lastState !== stateStr) {
          const elapsed = Date.now() - startTime;
          events.push({
            type: 'state_change',
            timestamp: elapsed,
            data: state,
            previous: lastState ? JSON.parse(lastState) : null,
          });

          // Log state changes
          if (lastState) {
            const prev = JSON.parse(lastState);
            if (prev.view !== state.view) {
              console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} View changed: ${c.yellow}${prev.view}${c.reset} -> ${c.green}${state.view}${c.reset}`);
            }
            if (prev.workspace?.activeTab !== state.workspace?.activeTab) {
              console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} Tab changed: ${c.yellow}${prev.workspace?.activeTab || 'none'}${c.reset} -> ${c.green}${state.workspace?.activeTab || 'none'}${c.reset}`);
            }
            if (prev.workspace?.agentCount !== state.workspace?.agentCount) {
              console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} Agent count: ${c.yellow}${prev.workspace?.agentCount}${c.reset} -> ${c.green}${state.workspace?.agentCount}${c.reset}`);
            }
            if (prev.settings?.activeSection !== state.settings?.activeSection) {
              console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} Settings section: ${c.yellow}${prev.settings?.activeSection || 'none'}${c.reset} -> ${c.green}${state.settings?.activeSection || 'none'}${c.reset}`);
            }
          }

          lastState = stateStr;
        }

        // Check for dialog changes
        const ui = await cdpRequest('GET', '/ui');
        if (ui.dialog && !lastState?.includes('"dialog"')) {
          const elapsed = Date.now() - startTime;
          events.push({
            type: 'dialog_appeared',
            timestamp: elapsed,
            data: ui.dialog,
          });
          console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} Dialog: ${c.yellow}${ui.dialog.title || 'untitled'}${c.reset}`);
        }
      } catch (e) {
        // Connection lost, retry
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Record a user-initiated action
 */
function recordAction(type, data) {
  if (!recording) return;
  const elapsed = Date.now() - startTime;
  events.push({ type, timestamp: elapsed, data });
  console.log(`${c.cyan}[${formatTime(elapsed)}]${c.reset} ${c.green}${type}${c.reset}: ${JSON.stringify(data)}`);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const msRem = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(msRem).padStart(3, '0')}`;
}

/**
 * Generate test code from recorded events
 */
function generateTestCode() {
  if (events.length === 0) {
    console.log(`${c.yellow}No events recorded${c.reset}`);
    return null;
  }

  const lines = [];
  lines.push(`#!/usr/bin/env node`);
  lines.push(`/**`);
  lines.push(` * Recorded CDP Integration Test`);
  lines.push(` * Generated: ${new Date().toISOString()}`);
  lines.push(` * Events: ${events.length}`);
  lines.push(` *`);
  lines.push(` * Usage:`);
  lines.push(` *   node ${OUTPUT_FILE}`);
  lines.push(` *`);
  lines.push(` * Prerequisites:`);
  lines.push(` *   npm run dev:cdp:wait`);
  lines.push(` */`);
  lines.push('');
  lines.push(`const http = require('http');`);
  lines.push(`const path = require('path');`);
  lines.push(`const fs = require('fs');`);
  lines.push('');
  lines.push(`const CDP_SERVER_PORT = 9333;`);
  lines.push(`const SCREENSHOT_MODE = process.argv.includes('--screenshots');`);
  lines.push(`const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/recorded');`);
  lines.push('');

  // Add cdpRequest helper
  lines.push(`async function cdpRequest(method, endpoint, body = null) {`);
  lines.push(`  return new Promise((resolve, reject) => {`);
  lines.push(`    const url = \`http://localhost:\${CDP_SERVER_PORT}\${endpoint}\`;`);
  lines.push(`    const options = { method, headers: body ? { 'Content-Type': 'application/json' } : undefined };`);
  lines.push(`    const req = http.request(url, options, (res) => {`);
  lines.push(`      let data = '';`);
  lines.push(`      res.on('data', chunk => data += chunk);`);
  lines.push(`      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); } });`);
  lines.push(`    });`);
  lines.push(`    req.on('error', reject);`);
  lines.push(`    if (body) req.write(JSON.stringify(body));`);
  lines.push(`    req.end();`);
  lines.push(`  });`);
  lines.push(`}`);
  lines.push('');
  lines.push(`const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));`);
  lines.push('');

  // Generate test functions from state changes
  lines.push(`async function main() {`);
  lines.push(`  console.log('Running recorded test...');`);
  lines.push('');
  lines.push(`  // Check CDP connection`);
  lines.push(`  const health = await cdpRequest('GET', '/health');`);
  lines.push(`  if (health.cdp !== 'connected') throw new Error('CDP not connected');`);
  lines.push(`  console.log('CDP connected');`);
  lines.push('');

  if (SCREENSHOT_MODE) {
    lines.push(`  if (SCREENSHOT_MODE && !fs.existsSync(SCREENSHOT_DIR)) {`);
    lines.push(`    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });`);
    lines.push(`  }`);
    lines.push('');
  }

  let lastTimestamp = 0;
  let stepNum = 0;

  for (const event of events) {
    // Add delay between actions
    const delay = event.timestamp - lastTimestamp;
    if (delay > 200 && lastTimestamp > 0) {
      lines.push(`  await sleep(${Math.min(delay, 2000)});`);
    }
    lastTimestamp = event.timestamp;

    switch (event.type) {
      case 'state_change':
        if (event.previous) {
          stepNum++;
          if (event.previous.view !== event.data.view) {
            lines.push(`  // Step ${stepNum}: Verify view changed to ${event.data.view}`);
            lines.push(`  {`);
            lines.push(`    const state = await cdpRequest('GET', '/state');`);
            lines.push(`    if (state.view !== '${event.data.view}') {`);
            lines.push(`      throw new Error(\`Expected view '${event.data.view}', got: \${state.view}\`);`);
            lines.push(`    }`);
            lines.push(`    console.log('Step ${stepNum}: View is ${event.data.view}');`);
            lines.push(`  }`);
          }
          if (event.previous.settings?.activeSection !== event.data.settings?.activeSection && event.data.settings?.activeSection) {
            lines.push(`  // Step ${stepNum}: Verify settings section changed to ${event.data.settings.activeSection}`);
            lines.push(`  {`);
            lines.push(`    const state = await cdpRequest('GET', '/state');`);
            lines.push(`    if (state.settings?.activeSection !== '${event.data.settings.activeSection}') {`);
            lines.push(`      throw new Error(\`Expected section '${event.data.settings.activeSection}', got: \${state.settings?.activeSection}\`);`);
            lines.push(`    }`);
            lines.push(`    console.log('Step ${stepNum}: Section is ${event.data.settings.activeSection}');`);
            lines.push(`  }`);
          }
        }
        break;

      case 'click':
        stepNum++;
        lines.push(`  // Step ${stepNum}: Click ${event.data.target}`);
        if (event.data.selector) {
          lines.push(`  await cdpRequest('POST', '/click', { selector: ${JSON.stringify(event.data.selector)} });`);
        } else {
          lines.push(`  await cdpRequest('POST', '/click', { text: ${JSON.stringify(event.data.text)} });`);
        }
        lines.push(`  console.log('Step ${stepNum}: Clicked ${event.data.target || event.data.selector || event.data.text}');`);
        break;

      case 'keypress':
        stepNum++;
        lines.push(`  // Step ${stepNum}: Press ${event.data.key}`);
        lines.push(`  await cdpRequest('POST', '/key', ${JSON.stringify(event.data)});`);
        lines.push(`  console.log('Step ${stepNum}: Pressed ${event.data.key}');`);
        break;

      case 'snapshot':
        stepNum++;
        lines.push(`  // Step ${stepNum}: Verify state snapshot`);
        lines.push(`  {`);
        lines.push(`    const state = await cdpRequest('GET', '/state');`);
        if (event.data.state?.view) {
          lines.push(`    if (state.view !== '${event.data.state.view}') throw new Error('View mismatch');`);
        }
        lines.push(`    console.log('Step ${stepNum}: State verified');`);
        lines.push(`  }`);
        break;

      case 'dialog_appeared':
        stepNum++;
        lines.push(`  // Step ${stepNum}: Dialog appeared: ${event.data.title || 'untitled'}`);
        lines.push(`  console.log('Step ${stepNum}: Dialog detected');`);
        break;
    }

    lines.push('');
  }

  lines.push(`  console.log('\\nAll ${stepNum} steps passed!');`);
  lines.push(`}`);
  lines.push('');
  lines.push(`main().catch(error => {`);
  lines.push(`  console.error('Test failed:', error.message);`);
  lines.push(`  process.exit(1);`);
  lines.push(`});`);

  return lines.join('\n');
}

/**
 * Interactive recording session
 */
async function main() {
  console.log(`${c.bright}CDP Recorder v1.0${c.reset}`);
  console.log(`${c.dim}Connecting to CDP server at ${CDP_SERVER_HOST}:${CDP_SERVER_PORT}...${c.reset}\n`);

  // Check connection
  try {
    const health = await cdpRequest('GET', '/health');
    if (health.cdp !== 'connected') {
      console.log(`${c.yellow}CDP server running but app not connected${c.reset}`);
    } else {
      console.log(`${c.green}Connected to CDP server and Electron app${c.reset}`);
    }
  } catch (error) {
    console.log(`${c.red}Cannot connect to CDP server: ${error.message}${c.reset}`);
    console.log(`${c.dim}Make sure the app is running: npm run dev:cdp:wait${c.reset}`);
    process.exit(1);
  }

  console.log(`\n${c.bright}Controls:${c.reset}`);
  console.log(`  ${c.cyan}r${c.reset} - Start/resume recording`);
  console.log(`  ${c.cyan}p${c.reset} - Pause recording`);
  console.log(`  ${c.cyan}s${c.reset} - Take snapshot (screenshot + state)`);
  console.log(`  ${c.cyan}k${c.reset} - Record keypress (interactive)`);
  console.log(`  ${c.cyan}l${c.reset} - Record click (interactive)`);
  console.log(`  ${c.cyan}g${c.reset} - Generate test code`);
  console.log(`  ${c.cyan}c${c.reset} - Clear recording`);
  console.log(`  ${c.cyan}q${c.reset} - Quit\n`);

  // Start state polling in background
  pollState().catch(() => {});

  // Setup raw input mode
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }

    switch (key.name) {
      case 'r':
        if (!recording) {
          recording = true;
          if (!startTime) startTime = Date.now();
          console.log(`\n${c.green}Recording started${c.reset} (press p to pause, g to generate)\n`);
        }
        break;

      case 'p':
        if (recording) {
          recording = false;
          console.log(`\n${c.yellow}Recording paused${c.reset} (${events.length} events captured)\n`);
        }
        break;

      case 's':
        try {
          const state = await cdpRequest('GET', '/state');
          const dir = path.join(__dirname, '../../test-screenshots/recorder');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const screenshotPath = path.join(dir, `snapshot-${Date.now()}.png`);
          await cdpRequest('GET', `/screenshot?path=${encodeURIComponent(screenshotPath)}`);
          recordAction('snapshot', { state, screenshot: screenshotPath });
          console.log(`${c.green}Snapshot saved: ${screenshotPath}${c.reset}`);
        } catch (e) {
          console.log(`${c.red}Snapshot failed: ${e.message}${c.reset}`);
        }
        break;

      case 'k': {
        // Record keypress interactively
        process.stdin.setRawMode(false);
        rl.question(`\n${c.cyan}Key to record (e.g., k, Escape, Enter): ${c.reset}`, (keyInput) => {
          rl.question(`${c.cyan}Modifiers (meta/shift/ctrl/alt, space-separated): ${c.reset}`, (modsInput) => {
            const mods = {};
            modsInput.split(/\s+/).filter(Boolean).forEach((m) => { mods[m] = true; });
            const keyData = { key: keyInput, ...mods };
            recordAction('keypress', keyData);
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
          });
        });
        break;
      }

      case 'l': {
        // Record click interactively
        process.stdin.setRawMode(false);
        rl.question(`\n${c.cyan}Click target (selector or text): ${c.reset}`, (target) => {
          const data = target.startsWith('[') || target.startsWith('.') || target.startsWith('#')
            ? { selector: target, target }
            : { text: target, target };
          recordAction('click', data);
          if (process.stdin.isTTY) process.stdin.setRawMode(true);
        });
        break;
      }

      case 'g': {
        console.log(`\n${c.bright}Generating test code...${c.reset}\n`);
        const code = generateTestCode();
        if (code) {
          const outputPath = path.join(__dirname, OUTPUT_FILE);
          fs.writeFileSync(outputPath, code);
          console.log(`${c.green}Test code saved: ${outputPath}${c.reset}`);
          console.log(`${c.dim}Run with: node ${outputPath}${c.reset}\n`);
        }
        break;
      }

      case 'c':
        events = [];
        startTime = null;
        console.log(`\n${c.yellow}Recording cleared${c.reset}\n`);
        break;

      case 'q':
        if (events.length > 0) {
          console.log(`\n${c.yellow}Generating test code before exit...${c.reset}`);
          const code = generateTestCode();
          if (code) {
            const outputPath = path.join(__dirname, OUTPUT_FILE);
            fs.writeFileSync(outputPath, code);
            console.log(`${c.green}Saved: ${outputPath}${c.reset}`);
          }
        }
        process.exit(0);
        break;
    }
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
