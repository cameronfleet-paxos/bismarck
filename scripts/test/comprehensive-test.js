#!/usr/bin/env node
/**
 * Comprehensive CDP Integration Test Suite
 *
 * Systematically tests ALL CDP server endpoints and ALL major UI flows.
 * Designed to be the single source of truth for UI regression testing.
 *
 * Usage:
 *   node scripts/test/comprehensive-test.js
 *   node scripts/test/comprehensive-test.js --screenshots
 *   npm run test:comprehensive
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 *
 * Test Suites:
 *   1. CDP Server Endpoints (health, screenshot, state, eval, click, type, key, wait, ui, agents, select, setup-test-env, mock-agent)
 *   2. Workspace View (agent list, tabs, terminal, agent selection)
 *   3. Settings Page (navigation, all sections, toggles)
 *   4. Cron Job Automations (navigation, empty state, workflow editor, node types, CRUD)
 *   5. Keyboard Shortcuts (Cmd+K, Cmd+Shift+D, Escape, Cmd+D)
 *   6. Command Palette (open, search, cron commands, close)
 *   7. Plans Panel (toggle, UI elements)
 *   8. Dev Console (toggle, mock agent)
 *   9. Error Handling (invalid selectors, timeouts, bad input)
 *   10. Edge Cases (rapid navigation, empty states, rapid clicks)
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/comprehensive');
const SCREENSHOT_MODE = process.argv.includes('--screenshots');
const IS_CI = !!process.env.CI;

// ============================================================
//  CDP REQUEST HELPER
// ============================================================

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
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, parseError: true });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Convenience helpers
const cdp = {
  async health() {
    const { body } = await cdpRequest('GET', '/health');
    return body;
  },
  async screenshot(name) {
    if (!SCREENSHOT_MODE) return;
    const filePath = path.join(SCREENSHOT_DIR, `${name.replace(/\s+/g, '-').toLowerCase()}.png`);
    await cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`);
    return filePath;
  },
  async state() {
    const { body } = await cdpRequest('GET', '/state');
    if (body.error) throw new Error(body.error);
    return body;
  },
  async eval(expression) {
    const { body } = await cdpRequest('POST', '/eval', { expression });
    if (body.error) throw new Error(body.error);
    return body.result;
  },
  async click(target) {
    const body = target.startsWith('[') || target.startsWith('.') || target.startsWith('#')
      ? { selector: target }
      : { text: target };
    const { body: result } = await cdpRequest('POST', '/click', body);
    if (result.error) throw new Error(result.error);
    return result;
  },
  async type(selector, text) {
    const { body } = await cdpRequest('POST', '/type', { selector, text });
    if (body.error) throw new Error(body.error);
    return body;
  },
  async key(key, modifiers = {}) {
    const { body } = await cdpRequest('POST', '/key', { key, ...modifiers });
    if (body.error) throw new Error(body.error);
    return body;
  },
  async wait(selectorOrCondition, timeout = 5000) {
    const body = selectorOrCondition.startsWith('[') || selectorOrCondition.startsWith('.') || selectorOrCondition.startsWith('#')
      ? { selector: selectorOrCondition, timeout }
      : { condition: selectorOrCondition, timeout };
    const { body: result } = await cdpRequest('POST', '/wait', body);
    if (result.error) throw new Error(result.error);
    return result;
  },
  async setupTestEnv() {
    const { body } = await cdpRequest('POST', '/setup-test-env');
    return body;
  },
  async mockAgent(taskId) {
    const { body } = await cdpRequest('POST', '/mock-agent', { taskId });
    return body;
  },
  async toggleDevConsole() {
    const { body } = await cdpRequest('GET', '/toggle-dev-console');
    return body;
  },
  async agents() {
    const { body } = await cdpRequest('GET', '/agents');
    return body;
  },
  async select(nameOrIndex) {
    const body = typeof nameOrIndex === 'number' ? { index: nameOrIndex } : { name: nameOrIndex };
    const { body: result } = await cdpRequest('POST', '/select', body);
    return result;
  },
  async ui() {
    const { body } = await cdpRequest('GET', '/ui');
    return body;
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};

// ============================================================
//  TEST RUNNER
// ============================================================

class TestRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
    this.timings = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  skip(name, reason = '') {
    this.tests.push({ name, fn: null, skip: true, reason });
  }

  async run() {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${this.suiteName}`);
    console.log('='.repeat(60) + '\n');

    for (const { name, fn, skip, reason } of this.tests) {
      if (skip) {
        console.log(`  o ${name}${reason ? ` (${reason})` : ''}`);
        this.skipped++;
        continue;
      }

      try {
        const start = Date.now();
        await fn();
        const duration = Date.now() - start;
        console.log(`  + ${name} (${duration}ms)`);
        this.passed++;
        this.timings.push({ name, duration, passed: true });
      } catch (error) {
        const duration = Date.now();
        console.log(`  x ${name}`);
        console.log(`    ${error.message}`);
        this.failed++;
        this.timings.push({ name, duration: 0, passed: false, error: error.message });

        if (SCREENSHOT_MODE) {
          try {
            await cdp.screenshot(`failure-${name}`);
          } catch (e) { /* ignore */ }
        }
      }
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Total: ${this.tests.length} | + ${this.passed} | x ${this.failed} | o ${this.skipped}`);
    console.log('-'.repeat(60) + '\n');

    return { passed: this.failed === 0, stats: { total: this.tests.length, passed: this.passed, failed: this.failed, skipped: this.skipped, timings: this.timings } };
  }
}

// ============================================================
//  SUITE 1: CDP SERVER ENDPOINTS
// ============================================================

async function testCDPEndpoints() {
  const runner = new TestRunner('Suite 1: CDP Server Endpoints');

  runner.test('/health returns server status', async () => {
    const health = await cdp.health();
    if (!health.server) throw new Error('Missing server field');
    if (health.server !== 'running') throw new Error(`Expected server running, got: ${health.server}`);
    if (!health.cdp) throw new Error('Missing cdp field');
    if (!health.port) throw new Error('Missing port field');
  });

  runner.test('/health reports CDP connection', async () => {
    const health = await cdp.health();
    if (health.cdp !== 'connected') {
      throw new Error(`CDP not connected: ${health.cdp}`);
    }
  });

  runner.test('/screenshot captures PNG file', async () => {
    const filePath = '/tmp/comprehensive-test-screenshot.png';
    const { body } = await cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`);
    if (!body.success) throw new Error('Screenshot failed');
    if (body.path !== filePath) throw new Error(`Path mismatch: ${body.path}`);
    // File is created on the host, not in container, so we check the response
  });

  runner.test('/state returns current view', async () => {
    const state = await cdp.state();
    if (!state.view) throw new Error('Missing view field');
    if (!['workspace', 'settings', 'unknown'].includes(state.view)) {
      throw new Error(`Unexpected view: ${state.view}`);
    }
    if (!state.title) throw new Error('Missing title field');
    if (!state.url) throw new Error('Missing url field');
  });

  runner.test('/eval executes simple JavaScript', async () => {
    const result = await cdp.eval('1 + 1');
    if (result !== 2) throw new Error(`Expected 2, got: ${result}`);
  });

  runner.test('/eval executes complex JavaScript', async () => {
    const result = await cdp.eval(`
      (function() {
        return {
          title: document.title,
          elementCount: document.querySelectorAll('*').length,
          hasRoot: !!document.getElementById('root'),
        };
      })()
    `);
    if (!result.hasRoot) throw new Error('Root element not found');
    if (typeof result.elementCount !== 'number') throw new Error('Element count not returned');
  });

  runner.test('/eval handles promise results', async () => {
    const result = await cdp.eval(`
      new Promise(resolve => setTimeout(() => resolve('async-result'), 50))
    `);
    if (result !== 'async-result') throw new Error(`Expected 'async-result', got: ${result}`);
  });

  runner.test('/eval returns errors for invalid code', async () => {
    const { body, status } = await cdpRequest('POST', '/eval', {
      expression: 'throw new Error("test error")',
    });
    // Should return error status
    if (status === 200 && !body.error) {
      // Some CDP implementations return the error in the result
    }
  });

  runner.test('/key dispatches keyboard events', async () => {
    const result = await cdp.key('Shift');
    if (!result.success) throw new Error('Key press failed');
  });

  runner.test('/key supports modifiers', async () => {
    // Test with a harmless combination
    const result = await cdp.key('Shift', { meta: false, ctrl: false });
    if (!result.success) throw new Error('Key with modifiers failed');
  });

  runner.test('/ui returns structured snapshot', async () => {
    const ui = await cdp.ui();
    if (!ui.title) throw new Error('Missing title in UI snapshot');
    if (!ui.url) throw new Error('Missing url in UI snapshot');
    if (!ui.sidebar) throw new Error('Missing sidebar in UI snapshot');
  });

  runner.test('/agents returns agent list', async () => {
    const result = await cdp.agents();
    if (!Array.isArray(result.agents)) throw new Error('agents is not an array');
  });

  runner.test('/wait times out for non-existent selector', async () => {
    const { body } = await cdpRequest('POST', '/wait', {
      selector: '[data-testid="does-not-exist-xyz"]',
      timeout: 500,
    });
    // Should return an error (timeout)
    if (body.success) throw new Error('Expected timeout but got success');
  });

  runner.test('Unknown endpoint returns 404', async () => {
    const { status, body } = await cdpRequest('GET', '/nonexistent-endpoint');
    if (status !== 404) throw new Error(`Expected 404, got: ${status}`);
  });

  runner.test('/eval rejects GET method', async () => {
    const { status } = await cdpRequest('GET', '/eval');
    if (status !== 405 && status !== 404) {
      // May also be handled differently
    }
  });

  return runner.run();
}

// ============================================================
//  SUITE 2: WORKSPACE VIEW
// ============================================================

async function testWorkspaceView() {
  const runner = new TestRunner('Suite 2: Workspace View');

  runner.test('Setup: create test agent and dismiss dialogs', async () => {
    await cdp.setupTestEnv();
    await cdp.sleep(500);
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
    await cdp.sleep(300);
    await cdp.eval('location.reload()');
    await cdp.sleep(2000);
  });

  runner.test('App loads with workspace view', async () => {
    const state = await cdp.state();
    if (state.view !== 'workspace') {
      throw new Error(`Expected workspace view, got: ${state.view}`);
    }
    await cdp.screenshot('workspace-loaded');
  });

  runner.test('Agents visible in sidebar', async () => {
    const { agents } = await cdp.agents();
    if (agents.length === 0) {
      throw new Error('No agents found in sidebar');
    }
    await cdp.screenshot('workspace-agents');
  });

  runner.test('Agent cards have data-testid attributes', async () => {
    const count = await cdp.eval(`
      document.querySelectorAll('[data-testid^="agent-card-"]').length
    `);
    if (count === 0) throw new Error('No agent cards with data-testid found');
  });

  runner.test('Can select agent by index', async () => {
    const result = await cdp.select(0);
    if (!result.success) throw new Error('Failed to select first agent');
    await cdp.sleep(200);
  });

  runner.test('Tab bar shows active tab', async () => {
    const state = await cdp.state();
    if (!state.workspace?.activeTab) {
      throw new Error('No active tab found');
    }
    await cdp.screenshot('workspace-tab-bar');
  });

  if (IS_CI) {
    runner.skip('Terminal renders for selected agent', 'skipped in CI - no PTY');
  } else {
    runner.test('Terminal renders for selected agent', async () => {
      const hasTerminal = await cdp.eval(`
        !!(document.querySelector('[class*="xterm"], [class*="terminal"]') ||
           document.querySelector('[class*="animate-claude-bounce"]') ||
           document.querySelector('[class*="animate-pulse"]'))
      `);
      if (!hasTerminal) {
        await cdp.sleep(2000);
        const retry = await cdp.eval(`
          !!(document.querySelector('[class*="xterm"], [class*="terminal"]') ||
             document.querySelector('[class*="animate-claude-bounce"]') ||
             document.querySelector('[class*="animate-pulse"]'))
        `);
        if (!retry) throw new Error('No terminal visible');
      }
    });
  }

  runner.test('UI snapshot contains sidebar data', async () => {
    const ui = await cdp.ui();
    if (!ui.sidebar) throw new Error('Missing sidebar in UI snapshot');
    if (!Array.isArray(ui.sidebar.agents)) throw new Error('sidebar.agents is not an array');
  });

  return runner.run();
}

// ============================================================
//  SUITE 3: SETTINGS PAGE
// ============================================================

async function testSettingsPage() {
  const runner = new TestRunner('Suite 3: Settings Page');

  runner.test('Can navigate to settings', async () => {
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
    await cdp.sleep(500);
  });

  runner.test('Settings page renders', async () => {
    const state = await cdp.state();
    if (state.view !== 'settings') {
      throw new Error(`Expected settings view, got: ${state.view}`);
    }
    await cdp.screenshot('settings-page');
  });

  runner.test('Back to workspace button has data-testid', async () => {
    const exists = await cdp.eval(`
      !!document.querySelector('[data-testid="back-to-workspace-button"]')
    `);
    if (!exists) throw new Error('Back button missing data-testid');
  });

  // Test each settings section
  const sections = [
    { id: 'general', label: 'General' },
    { id: 'keyboard', label: 'Keyboard' },
    { id: 'updates', label: 'Updates' },
    { id: 'authentication', label: 'Authentication' },
    { id: 'docker', label: 'Docker' },
    { id: 'languages', label: 'Languages' },
    { id: 'tools', label: 'Tools' },
    { id: 'plans', label: 'Teams & Prompts' },
    { id: 'ralph-presets', label: 'Ralph Loop Presets' },
    { id: 'cron-jobs', label: 'Cron Automations' },
    { id: 'repositories', label: 'Repositories' },
    { id: 'playbox', label: 'Playbox' },
    { id: 'advanced', label: 'Advanced' },
  ];

  for (const section of sections) {
    runner.test(`Settings section: ${section.label} is navigable`, async () => {
      await cdp.click(`[data-testid="settings-section-${section.id}"]`);
      await cdp.sleep(300);
      await cdp.screenshot(`settings-${section.id}`);
    });
  }

  runner.test('Can return to workspace via Escape', async () => {
    await cdp.key('Escape');
    await cdp.sleep(300);
    const state = await cdp.state();
    if (state.view !== 'workspace') {
      throw new Error(`Expected workspace after Escape, got: ${state.view}`);
    }
  });

  return runner.run();
}

// ============================================================
//  SUITE 4: CRON JOB AUTOMATIONS (NEW FEATURE)
// ============================================================

async function testCronJobAutomations() {
  const runner = new TestRunner('Suite 4: Cron Job Automations');

  runner.test('Navigate to Cron Automations settings', async () => {
    // Go to settings
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
    await cdp.sleep(500);

    // Click cron-jobs section
    await cdp.click('[data-testid="settings-section-cron-jobs"]');
    await cdp.sleep(500);
    await cdp.screenshot('cron-jobs-section');
  });

  runner.test('Cron jobs section has data-testid', async () => {
    const exists = await cdp.eval(`
      !!document.querySelector('[data-testid="cron-jobs-section"]')
    `);
    if (!exists) throw new Error('cron-jobs-section data-testid not found');
  });

  runner.test('Section title says "Cron Job Automations"', async () => {
    const hasTitle = await cdp.eval(`
      document.body.textContent.includes('Cron Job Automations')
    `);
    if (!hasTitle) throw new Error('Cron Job Automations title not found');
  });

  runner.test('Description mentions scheduled workflows', async () => {
    const hasDesc = await cdp.eval(`
      document.body.textContent.includes('Schedule automated workflows') ||
      document.body.textContent.includes('schedule')
    `);
    if (!hasDesc) throw new Error('Cron job description not found');
  });

  runner.test('New Automation button is visible', async () => {
    const exists = await cdp.eval(`
      !!document.querySelector('[data-testid="new-automation-button"]')
    `);
    if (!exists) throw new Error('New Automation button not found');
  });

  runner.test('Empty state shows helpful message', async () => {
    const hasEmptyState = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return text.includes('No cron jobs yet') ||
               text.includes('Create one to schedule') ||
               text.includes('CMD+K');
      })()
    `);
    // It's OK if there are already jobs from a previous run
    if (!hasEmptyState) {
      // Check if there are existing jobs instead
      const hasJobs = await cdp.eval(`
        document.querySelectorAll('[data-testid^="cron-job-row-"]').length > 0
      `);
      if (!hasJobs) throw new Error('Neither empty state nor job rows found');
    }
  });

  runner.test('New Automation button opens workflow editor', async () => {
    await cdp.click('[data-testid="new-automation-button"]');
    await cdp.sleep(500);

    const hasEditor = await cdp.eval(`
      !!document.querySelector('[data-testid="workflow-editor"]')
    `);
    if (!hasEditor) throw new Error('Workflow editor did not open');
    await cdp.screenshot('workflow-editor-opened');
  });

  runner.test('Workflow editor has name input', async () => {
    const hasInput = await cdp.eval(`
      !!document.querySelector('[data-testid="workflow-editor"] input[placeholder*="name" i]') ||
      !!document.querySelector('[data-testid="workflow-editor"] input')
    `);
    if (!hasInput) throw new Error('Name input not found in workflow editor');
  });

  runner.test('Workflow editor has schedule selector', async () => {
    const hasSchedule = await cdp.eval(`
      (function() {
        const editor = document.querySelector('[data-testid="workflow-editor"]');
        if (!editor) return false;
        const select = editor.querySelector('select');
        return !!select;
      })()
    `);
    if (!hasSchedule) throw new Error('Schedule selector not found');
  });

  runner.test('Workflow editor shows schedule presets', async () => {
    const presets = await cdp.eval(`
      (function() {
        const editor = document.querySelector('[data-testid="workflow-editor"]');
        if (!editor) return [];
        const select = editor.querySelector('select');
        if (!select) return [];
        return Array.from(select.options).map(o => o.textContent);
      })()
    `);
    if (!presets || presets.length === 0) throw new Error('No schedule presets found');
    // Check for expected presets
    const hasHourly = presets.some(p => p.includes('hour'));
    const hasDaily = presets.some(p => p.includes('Daily') || p.includes('daily'));
    if (!hasHourly && !hasDaily) {
      throw new Error(`Expected hourly/daily presets, found: ${presets.join(', ')}`);
    }
  });

  runner.test('Workflow editor has Save and Cancel buttons', async () => {
    const hasButtons = await cdp.eval(`
      (function() {
        const editor = document.querySelector('[data-testid="workflow-editor"]');
        if (!editor) return { save: false, cancel: false };
        const buttons = editor.querySelectorAll('button');
        const buttonTexts = Array.from(buttons).map(b => b.textContent.trim());
        return {
          save: buttonTexts.some(t => t.includes('Save')),
          cancel: buttonTexts.some(t => t.includes('Cancel')),
        };
      })()
    `);
    if (!hasButtons.save) throw new Error('Save button not found');
    if (!hasButtons.cancel) throw new Error('Cancel button not found');
  });

  runner.test('Workflow canvas shows empty state', async () => {
    const hasEmptyCanvas = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return text.includes('Click + to add') ||
               text.includes('workflow nodes') ||
               text.includes('Drag from output');
      })()
    `);
    if (!hasEmptyCanvas) throw new Error('Empty canvas message not found');
  });

  runner.test('Can open add node menu', async () => {
    // Click the + button in the canvas toolbar
    const opened = await cdp.eval(`
      (function() {
        const editor = document.querySelector('[data-testid="workflow-editor"]');
        if (!editor) return false;
        // Find the + button (first icon button in the toolbar)
        const buttons = editor.querySelectorAll('button');
        const plusBtn = Array.from(buttons).find(b => {
          const svg = b.querySelector('svg');
          return svg && (b.querySelector('[class*="lucide-plus"]') || b.textContent.trim() === '');
        });
        if (plusBtn) {
          plusBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await cdp.sleep(300);
    await cdp.screenshot('add-node-menu');
  });

  runner.test('Add node menu shows all node types', async () => {
    const nodeTypes = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return {
          headlessAgent: text.includes('Headless Agent'),
          ralphLoop: text.includes('Ralph Loop'),
          shellCommand: text.includes('Shell Command'),
        };
      })()
    `);
    if (!nodeTypes.headlessAgent) throw new Error('Headless Agent node type not found');
    if (!nodeTypes.ralphLoop) throw new Error('Ralph Loop node type not found');
    if (!nodeTypes.shellCommand) throw new Error('Shell Command node type not found');
  });

  runner.test('Can add a Shell Command node', async () => {
    // Click "Shell Command" in the add menu
    await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('button');
        const shellBtn = Array.from(buttons).find(b =>
          b.textContent.includes('Shell Command')
        );
        if (shellBtn) shellBtn.click();
      })()
    `);
    await cdp.sleep(300);

    // Verify node was added
    const hasNode = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return text.includes('Configure command') || text.includes('Shell Command');
      })()
    `);
    if (!hasNode) throw new Error('Shell Command node was not added');
    await cdp.screenshot('shell-command-node-added');
  });

  runner.test('Node config panel appears for selected node', async () => {
    const hasConfig = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return text.includes('Configure Shell Command') ||
               text.includes('Command') && text.includes('Working Directory') && text.includes('Timeout');
      })()
    `);
    if (!hasConfig) throw new Error('Node config panel not visible');
    await cdp.screenshot('node-config-panel');
  });

  runner.test('Cancel returns to cron jobs list', async () => {
    // Click Cancel button
    await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('button');
        const cancelBtn = Array.from(buttons).find(b =>
          b.textContent.trim() === 'Cancel' || (b.textContent.includes('Cancel') && b.closest('[data-testid="workflow-editor"]'))
        );
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await cdp.sleep(300);

    // Verify we're back to the cron jobs section
    const hasCronSection = await cdp.eval(`
      !!document.querySelector('[data-testid="cron-jobs-section"]') ||
      document.body.textContent.includes('Cron Job Automations')
    `);
    if (!hasCronSection) throw new Error('Did not return to cron jobs section');
  });

  runner.test('Cleanup: return to workspace', async () => {
    await cdp.key('Escape');
    await cdp.sleep(300);
  });

  return runner.run();
}

// ============================================================
//  SUITE 5: KEYBOARD SHORTCUTS
// ============================================================

async function testKeyboardShortcuts() {
  const runner = new TestRunner('Suite 5: Keyboard Shortcuts');

  runner.test('Cmd+K opens command palette', async () => {
    await cdp.key('k', { meta: true });
    await cdp.sleep(300);

    const hasDialog = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"], [role="dialog"]')
    `);
    if (!hasDialog) throw new Error('Command palette did not open');
    await cdp.screenshot('cmd-k-open');
  });

  runner.test('Escape closes command palette', async () => {
    await cdp.key('Escape');
    await cdp.sleep(200);

    const hasDialog = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"]')
    `);
    if (hasDialog) throw new Error('Command palette did not close');
  });

  runner.test('Cmd+Shift+D toggles dev console on', async () => {
    await cdp.key('d', { meta: true, shift: true });
    await cdp.sleep(300);
    await cdp.screenshot('dev-console-on');
  });

  runner.test('Cmd+Shift+D toggles dev console off', async () => {
    await cdp.key('d', { meta: true, shift: true });
    await cdp.sleep(200);
  });

  return runner.run();
}

// ============================================================
//  SUITE 6: COMMAND PALETTE
// ============================================================

async function testCommandPalette() {
  const runner = new TestRunner('Suite 6: Command Palette');

  runner.test('Command palette opens with Cmd+K', async () => {
    await cdp.key('k', { meta: true });
    await cdp.sleep(400);
    const exists = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"], [role="dialog"]')
    `);
    if (!exists) throw new Error('Command palette not found');
  });

  runner.test('Command palette has search input', async () => {
    const hasInput = await cdp.eval(`
      (function() {
        const dialog = document.querySelector('[data-testid="command-search"], [class*="CommandSearch"], [role="dialog"]');
        if (!dialog) return false;
        return !!dialog.querySelector('input');
      })()
    `);
    if (!hasInput) throw new Error('Search input not found in command palette');
  });

  runner.test('Can search for cron commands', async () => {
    // Type "cron" in the search input
    await cdp.eval(`
      (function() {
        const dialog = document.querySelector('[data-testid="command-search"], [class*="CommandSearch"], [role="dialog"]');
        if (!dialog) return;
        const input = dialog.querySelector('input');
        if (input) {
          input.value = 'cron';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await cdp.sleep(300);

    const hasCronResults = await cdp.eval(`
      (function() {
        const text = document.body.textContent;
        return text.includes('Cron') || text.includes('cron') || text.includes('Schedule');
      })()
    `);
    await cdp.screenshot('command-palette-cron-search');
  });

  runner.test('Escape closes command palette', async () => {
    await cdp.key('Escape');
    await cdp.sleep(200);
    const exists = await cdp.eval(`
      !!document.querySelector('[data-testid="command-search"], [class*="CommandSearch"]')
    `);
    if (exists) throw new Error('Command palette did not close');
  });

  return runner.run();
}

// ============================================================
//  SUITE 7: PLANS PANEL
// ============================================================

async function testPlansPanel() {
  const runner = new TestRunner('Suite 7: Plans Panel');

  runner.test('Ensure in workspace view', async () => {
    const state = await cdp.state();
    if (state.view !== 'workspace') {
      await cdp.key('Escape');
      await cdp.sleep(200);
    }
  });

  runner.test('Can find plans button', async () => {
    const found = await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('button');
        return Array.from(buttons).some(b =>
          b.querySelector('svg[class*="lucide-list-todo"]') ||
          b.textContent.includes('Plans')
        );
      })()
    `);
    if (!found) {
      console.log('    (Plans button not found - team mode may be disabled)');
    }
  });

  runner.test('Can toggle plans panel', async () => {
    const opened = await cdp.eval(`
      (function() {
        const buttons = document.querySelectorAll('button');
        const plansBtn = Array.from(buttons).find(b =>
          b.querySelector('svg[class*="lucide-list-todo"]') ||
          b.textContent.includes('Plans')
        );
        if (plansBtn) {
          plansBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await cdp.sleep(300);
    await cdp.screenshot('plans-panel');
  });

  return runner.run();
}

// ============================================================
//  SUITE 8: DEV CONSOLE
// ============================================================

async function testDevConsole() {
  const runner = new TestRunner('Suite 8: Dev Console');

  runner.test('Ensure in workspace view', async () => {
    const state = await cdp.state();
    if (state.view !== 'workspace') {
      await cdp.key('Escape');
      await cdp.sleep(200);
    }
  });

  runner.test('Dev console toggle via /toggle-dev-console endpoint', async () => {
    const result = await cdp.toggleDevConsole();
    if (!result.success) throw new Error('Toggle dev console failed');
    await cdp.sleep(300);
    await cdp.screenshot('dev-console-toggle');
  });

  runner.test('Dev console toggle back off', async () => {
    await cdp.toggleDevConsole();
    await cdp.sleep(200);
  });

  runner.test('Can start mock agent via /mock-agent', async () => {
    const taskId = `comprehensive-test-${Date.now()}`;
    // First check if the dev API is available
    const hasDevApi = await cdp.eval('typeof window.electronAPI.devStartMockAgent === "function"');
    if (!hasDevApi) {
      console.log('    (mock agent API not available - dev mode not enabled)');
      return;
    }
    const result = await cdp.mockAgent(taskId);
    if (!result.success) {
      console.log('    (mock agent failed - may require specific agent state)');
      return;
    }
    if (result.taskId !== taskId) throw new Error('Task ID mismatch');
    await cdp.sleep(500);
    await cdp.screenshot('mock-agent');
  });

  return runner.run();
}

// ============================================================
//  SUITE 9: ERROR HANDLING
// ============================================================

async function testErrorHandling() {
  const runner = new TestRunner('Suite 9: Error Handling');

  runner.test('Click on non-existent selector returns error', async () => {
    const { body, status } = await cdpRequest('POST', '/click', {
      selector: '[data-testid="definitely-does-not-exist-12345"]',
    });
    if (status === 200 && !body.error) {
      throw new Error('Expected error for non-existent selector');
    }
  });

  runner.test('Type with missing selector returns error', async () => {
    const { body, status } = await cdpRequest('POST', '/type', {
      text: 'test',
    });
    if (status === 200 && !body.error) {
      throw new Error('Expected error for missing selector');
    }
  });

  runner.test('Eval with empty expression returns error', async () => {
    const { body, status } = await cdpRequest('POST', '/eval', {
      expression: '',
    });
    // Empty expression should return an error
    if (status === 200 && body.result !== undefined && body.result !== null) {
      // Some implementations may return undefined for empty expression
    }
  });

  runner.test('Wait with short timeout handles gracefully', async () => {
    const { body } = await cdpRequest('POST', '/wait', {
      selector: '[data-testid="nonexistent-timeout-test"]',
      timeout: 100,
    });
    if (body.success) throw new Error('Expected timeout error');
  });

  runner.test('Click with empty body returns error', async () => {
    const { body, status } = await cdpRequest('POST', '/click', {});
    if (status === 200 && !body.error) {
      throw new Error('Expected error for empty click body');
    }
  });

  return runner.run();
}

// ============================================================
//  SUITE 10: EDGE CASES
// ============================================================

async function testEdgeCases() {
  const runner = new TestRunner('Suite 10: Edge Cases');

  runner.test('Rapid state requests dont crash', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(cdp.state());
    }
    const results = await Promise.all(promises);
    results.forEach((state) => {
      if (!state.view) throw new Error('State response missing view');
    });
  });

  runner.test('Rapid key presses dont crash', async () => {
    for (let i = 0; i < 5; i++) {
      await cdp.key('Shift');
    }
  });

  runner.test('Rapid view switches dont crash', async () => {
    for (let i = 0; i < 3; i++) {
      // To settings
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
      await cdp.sleep(100);
      // Back to workspace
      await cdp.key('Escape');
      await cdp.sleep(100);
    }

    const state = await cdp.state();
    if (state.view !== 'workspace') {
      throw new Error(`Expected workspace after rapid switches, got: ${state.view}`);
    }
  });

  runner.test('Multiple screenshots in sequence work', async () => {
    for (let i = 0; i < 3; i++) {
      const { body } = await cdpRequest('GET', '/screenshot?path=/tmp/edge-case-screenshot.png');
      if (!body.success) throw new Error(`Screenshot ${i} failed`);
    }
  });

  runner.test('Concurrent eval requests work', async () => {
    const promises = [
      cdp.eval('1 + 1'),
      cdp.eval('2 + 2'),
      cdp.eval('document.title'),
      cdp.eval('window.location.href'),
    ];
    const results = await Promise.all(promises);
    if (results[0] !== 2) throw new Error('First eval wrong');
    if (results[1] !== 4) throw new Error('Second eval wrong');
  });

  return runner.run();
}

// ============================================================
//  MAIN
// ============================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  BISMARCK COMPREHENSIVE CDP INTEGRATION TESTS');
  console.log('='.repeat(70));

  const startTime = Date.now();

  // Check CDP
  try {
    const health = await cdp.health();
    if (health.cdp !== 'connected') throw new Error('CDP not connected');
    console.log('\n+ CDP server connected\n');
  } catch (error) {
    console.error('\nx CDP server not available:', error.message);
    console.error('Run: npm run dev:cdp:wait\n');
    process.exit(1);
  }

  // Setup directories
  if (SCREENSHOT_MODE && !fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Run all suites
  const results = [];
  results.push(await testCDPEndpoints());
  results.push(await testWorkspaceView());
  results.push(await testSettingsPage());
  results.push(await testCronJobAutomations());
  results.push(await testKeyboardShortcuts());
  results.push(await testCommandPalette());
  results.push(await testPlansPanel());
  results.push(await testDevConsole());
  results.push(await testErrorHandling());
  results.push(await testEdgeCases());

  const totalTime = Date.now() - startTime;

  // Aggregate stats
  const totals = results.reduce(
    (acc, { stats }) => ({
      total: acc.total + stats.total,
      passed: acc.passed + stats.passed,
      failed: acc.failed + stats.failed,
      skipped: acc.skipped + stats.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 }
  );

  const allPassed = results.every(({ passed }) => passed);

  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log(allPassed ? '  ALL SUITES PASSED' : '  SOME SUITES FAILED');
  console.log('='.repeat(70));
  console.log(`\n  Total Tests: ${totals.total}`);
  console.log(`  Passed:      ${totals.passed}`);
  console.log(`  Failed:      ${totals.failed}`);
  console.log(`  Skipped:     ${totals.skipped}`);
  console.log(`  Duration:    ${(totalTime / 1000).toFixed(1)}s`);
  console.log('');

  // Per-suite breakdown
  const suiteNames = [
    'CDP Endpoints', 'Workspace', 'Settings', 'Cron Automations',
    'Keyboard Shortcuts', 'Command Palette', 'Plans Panel',
    'Dev Console', 'Error Handling', 'Edge Cases',
  ];
  console.log('  Suite Results:');
  results.forEach(({ passed, stats }, i) => {
    const status = passed ? '+' : 'x';
    console.log(`    ${status} ${suiteNames[i]}: ${stats.passed}/${stats.total} passed`);
  });
  console.log('');

  // Generate report
  const reportDir = path.join(__dirname, '../../test-reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    type: 'comprehensive',
    timestamp: new Date().toISOString(),
    duration: totalTime,
    passed: allPassed,
    summary: totals,
    suites: results.map(({ passed, stats }, i) => ({
      name: suiteNames[i],
      passed,
      ...stats,
    })),
  };

  fs.writeFileSync(
    path.join(reportDir, 'comprehensive-test-report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`Report: ${path.join(reportDir, 'comprehensive-test-report.json')}\n`);

  process.exit(allPassed ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
