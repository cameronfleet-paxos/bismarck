#!/usr/bin/env node
/**
 * CDP Server - Persistent HTTP server for fast CDP interactions
 *
 * Maintains a WebSocket connection to the Electron app and exposes
 * HTTP endpoints for fast command execution (~50ms vs ~2s per action).
 *
 * Start: node scripts/test/cdp-server.js
 * Or:    npm run test:server
 *
 * Endpoints:
 *   GET  /screenshot?path=/tmp/x.png  - Take screenshot
 *   GET  /state                       - Get app state
 *   POST /eval                        - Evaluate JS (body = expression)
 *   POST /click                       - Click element (body = {selector} or {text})
 *   POST /type                        - Type into element (body = {selector, text})
 *   POST /key                         - Press key (body = {key, meta, shift, ctrl, alt})
 *   POST /setup-test-env              - Bypass onboarding by creating test agents
 *   GET  /health                      - Check server and CDP connection status
 */

const http = require('http');
const { CDPHelper } = require('./cdp-helper');

const PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);

let cdp = null;
let connecting = false;

/**
 * Ensure CDP connection is established
 */
async function ensureConnected() {
  if (cdp && cdp.ws && cdp.ws.readyState === 1) {
    return true;
  }

  if (connecting) {
    // Wait for existing connection attempt
    await new Promise(resolve => setTimeout(resolve, 100));
    return ensureConnected();
  }

  connecting = true;
  try {
    cdp = new CDPHelper(CDP_PORT);
    await cdp.connect();
    console.log('Connected to CDP');
    return true;
  } catch (error) {
    cdp = null;
    throw error;
  } finally {
    connecting = false;
  }
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        // If not JSON, treat as raw expression
        resolve({ expression: body });
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res, message, status = 500) {
  sendJson(res, { error: message }, status);
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Health check doesn't require CDP connection
  if (path === '/health') {
    const connected = cdp && cdp.ws && cdp.ws.readyState === 1;
    sendJson(res, {
      server: 'running',
      cdp: connected ? 'connected' : 'disconnected',
      port: PORT
    });
    return;
  }

  // All other endpoints require CDP connection
  try {
    await ensureConnected();
  } catch (error) {
    sendError(res, `CDP connection failed: ${error.message}. Is the app running with --remote-debugging-port=${CDP_PORT}?`, 503);
    return;
  }

  try {
    switch (path) {
      case '/screenshot': {
        const outputPath = url.searchParams.get('path') || '/tmp/claude/bismarck-screenshot.png';
        await cdp.screenshot(outputPath);
        sendJson(res, { success: true, path: outputPath });
        break;
      }

      case '/state': {
        const state = await cdp.evaluate(`
          (function() {
            const body = document.body.innerText;
            const header = document.querySelector('[data-testid="app-header"]')?.textContent?.trim() || '';

            // Detect current view based on specific UI elements
            let view = 'unknown';

            // Settings view: has back to workspace button
            const hasBackToWorkspace = !!document.querySelector('[data-testid="back-to-workspace-button"]');

            // Workspace view: has workspace tabs in the tab bar area
            const tabBar = document.querySelector('[data-testid="tab-bar"]');
            const hasWorkspaceTabs = !!tabBar;

            // Plans panel: Check if plans sidebar is visible
            const plansPanelVisible = !!document.querySelector('[data-testid="plan-sidebar"]');

            if (hasBackToWorkspace) {
              view = 'settings';
            } else if (hasWorkspaceTabs) {
              view = 'workspace';
            }

            // Settings-specific info
            let settings = null;
            if (view === 'settings') {
              const sections = ['general', 'docker', 'tool-paths', 'proxied-tools', 'plans-prompts', 'repositories'];
              // Find active section button (has bg-primary class)
              const activeSection = sections.find(s => {
                const el = document.querySelector(\`[data-testid="settings-section-\${s}"]\`);
                return el && el.classList.contains('bg-primary');
              }) || 'general';
              settings = { activeSection };
            }

            // Workspace-specific info
            let workspace = null;
            if (view === 'workspace') {
              // Find workspace tabs using data-testid
              const tabs = tabBar ? [...tabBar.querySelectorAll('[data-testid^="tab-item-"]')] : [];
              // Active tab has bg-background class (not just hover:bg-muted/50)
              const activeTab = tabs.find(t => t.classList.contains('bg-background'));
              // Count agent cards using data-testid
              const agentCount = document.querySelectorAll('[data-testid^="agent-card-"]').length;
              workspace = {
                activeTab: activeTab?.textContent?.trim()?.replace(/\\s+/g, ' ') || null,
                agentCount,
                plansPanelOpen: plansPanelVisible
              };
            }

            return {
              view,
              title: document.title,
              url: location.href,
              header: header,
              settings,
              workspace
            };
          })()
        `);
        sendJson(res, state);
        break;
      }

      case '/eval': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        const expression = body.expression || body;
        if (!expression || typeof expression !== 'string') {
          sendError(res, 'Missing expression in body', 400);
          return;
        }
        const result = await cdp.evaluate(expression);
        sendJson(res, { result });
        break;
      }

      case '/click': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        if (body.selector) {
          await cdp.click(body.selector);
          sendJson(res, { success: true, selector: body.selector });
        } else if (body.text) {
          // Click by text content
          await cdp.evaluate(`
            (function() {
              const elements = [...document.querySelectorAll('button, a, [role="button"], [onclick]')];
              const el = elements.find(e => e.textContent.includes(${JSON.stringify(body.text)}));
              if (!el) throw new Error('Element with text not found: ${body.text}');
              el.click();
            })()
          `);
          sendJson(res, { success: true, text: body.text });
        } else {
          sendError(res, 'Missing selector or text in body', 400);
        }
        break;
      }

      case '/type': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        if (!body.selector || body.text === undefined) {
          sendError(res, 'Missing selector or text in body', 400);
          return;
        }
        await cdp.type(body.selector, body.text);
        sendJson(res, { success: true, selector: body.selector });
        break;
      }

      case '/key': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        if (!body.key) {
          sendError(res, 'Missing key in body', 400);
          return;
        }
        await cdp.pressKey(body.key, {
          meta: body.meta || false,
          shift: body.shift || false,
          ctrl: body.ctrl || false,
          alt: body.alt || false
        });
        sendJson(res, { success: true, key: body.key });
        break;
      }

      case '/toggle-dev-console': {
        await cdp.toggleDevConsole();
        sendJson(res, { success: true });
        break;
      }

      case '/mock-agent': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        const taskId = body.taskId || `test-${Date.now()}`;
        await cdp.startMockAgent(taskId);
        sendJson(res, { success: true, taskId });
        break;
      }

      case '/wait': {
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        if (body.selector) {
          await cdp.waitForSelector(body.selector, body.timeout || 10000);
          sendJson(res, { success: true, selector: body.selector });
        } else if (body.condition) {
          const result = await cdp.waitFor(body.condition, body.timeout || 10000);
          sendJson(res, { success: true, result });
        } else {
          sendError(res, 'Missing selector or condition in body', 400);
        }
        break;
      }

      case '/ui': {
        // Fast text-based UI snapshot - returns structured view of the app
        const ui = await cdp.evaluate(`
          (function() {
            const result = {
              title: document.title,
              url: location.href,
              header: {},
              sidebar: { tabs: [], agents: [] },
              main: { agent: null, terminal: null }
            };

            // Header info
            const headerBadge = document.querySelector('header [class*=badge], header span[class*=rounded]');
            if (headerBadge) result.header.status = headerBadge.textContent.trim();

            // Sidebar tabs
            const tabs = document.querySelectorAll('[role=tablist] button, nav button');
            tabs.forEach(t => {
              const text = t.textContent.trim();
              const isActive = t.getAttribute('aria-selected') === 'true' || t.classList.contains('active') || t.dataset.state === 'active';
              if (text) result.sidebar.tabs.push({ name: text, active: isActive });
            });

            // Agent cards in sidebar
            const agentCards = document.querySelectorAll('[data-testid^="agent-card-"]');
            agentCards.forEach(card => {
              const nameEl = card.querySelector('[data-testid^="agent-card-name-"]');
              if (!nameEl) return;
              const name = nameEl.textContent.trim();
              const badge = card.querySelector('[class*=badge], span[class*=rounded-full]');
              const status = badge?.textContent?.trim() || '';
              const isSelected = card.classList.contains('ring-2') || card.getAttribute('aria-selected') === 'true' || card.dataset.selected === 'true';
              const path = card.querySelector('p, span[class*=text-xs]')?.textContent?.trim() || '';
              result.sidebar.agents.push({ name, status, selected: isSelected, path });
            });

            // Main content area
            const mainHeader = document.querySelector('main h1, main h2, [class*=main] h1');
            if (mainHeader) result.main.agent = mainHeader.textContent.trim();

            // Currently selected agent from header
            const agentHeader = document.querySelector('[class*=header] h2, [class*=header] span[class*=font-medium]');
            if (agentHeader) result.main.agent = agentHeader.textContent.trim();

            // Terminal content (last few lines)
            const terminal = document.querySelector('[class*=terminal], [class*=xterm], pre');
            if (terminal) {
              const text = terminal.textContent || '';
              const lines = text.split('\\n').filter(l => l.trim()).slice(-10);
              result.main.terminal = lines;
            }

            // Any visible dialogs/modals
            const dialog = document.querySelector('[role=dialog], [class*=modal], [class*=Dialog]');
            if (dialog) {
              const title = dialog.querySelector('h2, h3, [class*=title]')?.textContent?.trim();
              result.dialog = { title, visible: true };
            }

            // Current agent status badge
            const statusBadge = document.querySelector('main [class*=badge], [class*=status]');
            if (statusBadge) result.main.status = statusBadge.textContent.trim();

            return result;
          })()
        `);
        sendJson(res, ui);
        break;
      }

      case '/agents': {
        // Get list of all agents with their states
        const agents = await cdp.evaluate(`
          (function() {
            const agents = [];
            const cards = document.querySelectorAll('[data-testid^="agent-card-"]');
            cards.forEach((card, idx) => {
              const nameEl = card.querySelector('[data-testid^="agent-card-name-"]');
              if (!nameEl) return;
              const name = nameEl.textContent.trim();
              const badge = card.querySelector('[class*=badge], span[class*=rounded-full]');
              const status = badge?.textContent?.trim() || 'idle';
              const isSelected = card.classList.contains('ring-2') || card.classList.contains('border-primary');
              const pathEl = card.querySelector('p[class*=text-xs], span[class*=truncate]');
              const path = pathEl?.textContent?.trim() || '';
              agents.push({ idx, name, status, selected: isSelected, path });
            });
            return agents;
          })()
        `);
        sendJson(res, { agents });
        break;
      }

      case '/select': {
        // Select an agent by name or index
        if (req.method !== 'POST') {
          sendError(res, 'Method not allowed. Use POST.', 405);
          return;
        }
        const body = await parseBody(req);
        const result = await cdp.evaluate(`
          (function() {
            const cards = document.querySelectorAll('[data-testid^="agent-card-"]');
            for (const [idx, card] of cards.entries()) {
              const nameEl = card.querySelector('[data-testid^="agent-card-name-"]');
              if (!nameEl) continue;
              const name = nameEl.textContent.trim();
              const match = ${JSON.stringify(body.name)} ? name === ${JSON.stringify(body.name)} : idx === ${body.index || 0};
              if (match) {
                card.click();
                return { success: true, selected: name };
              }
            }
            return { success: false, error: 'Agent not found' };
          })()
        `);
        sendJson(res, result);
        break;
      }

      case '/setup-test-env': {
        // Bypass onboarding by creating test agents
        // POST body can optionally specify:
        // { agents: [{ path: "/path/to/repo", name: "repo-name" }] }
        const body = await parseBody(req);

        // Default: create one test agent pointing to current working directory
        const agents = body.agents || [{
          path: process.cwd(),
          name: require('path').basename(process.cwd())
        }];

        // Convert to DiscoveredRepo format expected by the IPC handler
        const repos = agents.map(a => ({
          path: a.path,
          name: a.name || require('path').basename(a.path)
        }));

        const result = await cdp.evaluate(`
          (async function() {
            try {
              const created = await window.electronAPI.setupWizardBulkCreateAgents(${JSON.stringify(repos)});
              return { success: true, agents: created.map(a => ({ id: a.id, name: a.name, path: a.path })) };
            } catch (error) {
              return { success: false, error: error.message };
            }
          })()
        `);

        if (result.success) {
          sendJson(res, result);
        } else {
          sendError(res, result.error || 'Failed to create test agents', 500);
        }
        break;
      }

      default:
        sendError(res, `Unknown endpoint: ${path}`, 404);
    }
  } catch (error) {
    // Check if connection was lost
    if (error.message.includes('Not connected') || (cdp && (!cdp.ws || cdp.ws.readyState !== 1))) {
      cdp = null;
      sendError(res, `CDP connection lost: ${error.message}. Retry the request.`, 503);
    } else {
      sendError(res, error.message, 500);
    }
  }
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`CDP Server running on http://127.0.0.1:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /health                      - Check server status');
  console.log('  GET  /screenshot?path=/tmp/x.png  - Take screenshot');
  console.log('  GET  /state                       - Get app state');
  console.log('  POST /eval                        - Evaluate JS');
  console.log('  POST /click                       - Click element');
  console.log('  POST /type                        - Type into element');
  console.log('  POST /key                         - Press key');
  console.log('  GET  /toggle-dev-console          - Toggle dev console');
  console.log('  POST /mock-agent                  - Start mock agent');
  console.log('  POST /wait                        - Wait for selector/condition');
  console.log('  POST /setup-test-env              - Bypass onboarding (create test agents)');
  console.log('');
  console.log('Press Ctrl+C to stop');

  // Try to connect to CDP on startup
  ensureConnected().catch(err => {
    console.log(`Note: CDP not available yet (${err.message})`);
    console.log('Will connect on first request.');
  });
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (cdp) {
    cdp.disconnect();
  }
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (cdp) {
    cdp.disconnect();
  }
  server.close();
  process.exit(0);
});
