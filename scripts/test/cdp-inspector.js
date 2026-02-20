#!/usr/bin/env node
/**
 * CDP Inspector - Interactive CLI tool for exploring CDP endpoints
 *
 * Provides a REPL-like interface for interacting with the running Bismarck app
 * via the CDP server. Useful for debugging UI state, exploring elements,
 * and manually testing interactions.
 *
 * Usage:
 *   node scripts/test/cdp-inspector.js
 *   npm run dev:inspector
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start app and CDP server)
 *
 * Commands:
 *   /screenshot [name]     - Take a screenshot
 *   /state                 - Get current app state
 *   /ui                    - Get structured UI snapshot
 *   /agents                - List all agents
 *   /select <name|index>   - Select an agent
 *   /eval <code>           - Evaluate JavaScript
 *   /click <selector|text> - Click an element
 *   /type <selector> <text> - Type text into element
 *   /key <key> [modifiers] - Press keyboard key (e.g., /key k meta)
 *   /wait <selector>       - Wait for element to appear
 *   /health                - Check CDP connection
 *   /endpoints             - List all CDP server endpoints
 *   /testids               - List all data-testid elements
 *   /dom <selector>        - Inspect DOM element properties
 *   /history               - Show command history
 *   /save [file]           - Save session history to file
 *   /help                  - Show this help
 *   /quit                  - Exit inspector
 */

const http = require('http');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const CDP_SERVER_PORT = parseInt(process.env.CDP_SERVER_PORT || '9333', 10);
const CDP_SERVER_HOST = process.env.CDP_SERVER_HOST || 'localhost';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function c(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Pretty-print JSON with syntax highlighting
 */
function prettyJson(obj, indent = 2) {
  const json = JSON.stringify(obj, null, indent);
  return json
    .replace(/"([^"]+)":/g, `${colors.cyan}"$1"${colors.reset}:`)
    .replace(/: "([^"]*)"/g, `: ${colors.green}"$1"${colors.reset}`)
    .replace(/: (\d+)/g, `: ${colors.yellow}$1${colors.reset}`)
    .replace(/: (true|false)/g, `: ${colors.magenta}$1${colors.reset}`)
    .replace(/: (null)/g, `: ${colors.dim}$1${colors.reset}`);
}

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
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${data}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Session history
const sessionHistory = [];
const commandHistory = [];

function logResult(command, result, error = null) {
  sessionHistory.push({
    timestamp: new Date().toISOString(),
    command,
    result: error ? null : result,
    error: error ? error.message : null,
  });
}

/**
 * Command handlers
 */
const commands = {
  async screenshot(args) {
    const name = args[0] || `inspector-${Date.now()}`;
    const dir = path.join(__dirname, '../../test-screenshots/inspector');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.png`);
    const result = await cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`);
    console.log(c('green', `Screenshot saved: ${filePath}`));
    return result;
  },

  async state() {
    const result = await cdpRequest('GET', '/state');
    console.log(prettyJson(result));
    return result;
  },

  async ui() {
    const result = await cdpRequest('GET', '/ui');
    console.log(prettyJson(result));
    return result;
  },

  async agents() {
    const result = await cdpRequest('GET', '/agents');
    if (result.agents && result.agents.length > 0) {
      console.log(c('bright', `\n  Agents (${result.agents.length}):\n`));
      result.agents.forEach((agent, i) => {
        const selected = agent.selected ? c('green', ' [selected]') : '';
        const status = agent.status ? c('yellow', ` (${agent.status})`) : '';
        console.log(`  ${c('cyan', i)} ${c('bright', agent.name)}${status}${selected}`);
        if (agent.path) console.log(`    ${c('dim', agent.path)}`);
      });
      console.log('');
    } else {
      console.log(c('yellow', 'No agents found'));
    }
    return result;
  },

  async select(args) {
    const target = args[0];
    if (!target) {
      console.log(c('red', 'Usage: /select <name|index>'));
      return;
    }
    const body = isNaN(target) ? { name: target } : { index: parseInt(target) };
    const result = await cdpRequest('POST', '/select', body);
    console.log(prettyJson(result));
    return result;
  },

  async eval(args) {
    const expression = args.join(' ');
    if (!expression) {
      console.log(c('red', 'Usage: /eval <javascript expression>'));
      return;
    }
    const result = await cdpRequest('POST', '/eval', { expression });
    console.log(prettyJson(result));
    return result;
  },

  async click(args) {
    const target = args.join(' ');
    if (!target) {
      console.log(c('red', 'Usage: /click <selector|text>'));
      return;
    }
    const body = target.startsWith('[') || target.startsWith('.') || target.startsWith('#')
      ? { selector: target }
      : { text: target };
    const result = await cdpRequest('POST', '/click', body);
    console.log(c('green', `Clicked: ${target}`));
    return result;
  },

  async type(args) {
    if (args.length < 2) {
      console.log(c('red', 'Usage: /type <selector> <text>'));
      return;
    }
    const selector = args[0];
    const text = args.slice(1).join(' ');
    const result = await cdpRequest('POST', '/type', { selector, text });
    console.log(c('green', `Typed "${text}" into ${selector}`));
    return result;
  },

  async key(args) {
    if (args.length === 0) {
      console.log(c('red', 'Usage: /key <key> [meta] [shift] [ctrl] [alt]'));
      return;
    }
    const key = args[0];
    const modifiers = {};
    for (let i = 1; i < args.length; i++) {
      const mod = args[i].toLowerCase();
      if (['meta', 'shift', 'ctrl', 'alt'].includes(mod)) {
        modifiers[mod] = true;
      }
    }
    const result = await cdpRequest('POST', '/key', { key, ...modifiers });
    const modStr = Object.keys(modifiers).length > 0
      ? ` + ${Object.keys(modifiers).join('+')}`
      : '';
    console.log(c('green', `Pressed: ${key}${modStr}`));
    return result;
  },

  async wait(args) {
    const selector = args.join(' ');
    if (!selector) {
      console.log(c('red', 'Usage: /wait <selector>'));
      return;
    }
    console.log(c('dim', `Waiting for: ${selector}...`));
    const result = await cdpRequest('POST', '/wait', { selector, timeout: 10000 });
    console.log(c('green', `Found: ${selector}`));
    return result;
  },

  async health() {
    const result = await cdpRequest('GET', '/health');
    const cdpStatus = result.cdp === 'connected'
      ? c('green', 'connected')
      : c('red', 'disconnected');
    console.log(`  Server: ${c('green', result.server)}`);
    console.log(`  CDP:    ${cdpStatus}`);
    console.log(`  Port:   ${result.port}`);
    return result;
  },

  async endpoints() {
    console.log(c('bright', '\n  CDP Server Endpoints:\n'));
    const endpoints = [
      { method: 'GET', path: '/health', desc: 'Check server and CDP connection status' },
      { method: 'GET', path: '/screenshot?path=<file>', desc: 'Take screenshot, save to file' },
      { method: 'GET', path: '/state', desc: 'Get current app state (view, tabs, agents)' },
      { method: 'GET', path: '/ui', desc: 'Get structured UI snapshot' },
      { method: 'GET', path: '/agents', desc: 'List all agents with status' },
      { method: 'GET', path: '/toggle-dev-console', desc: 'Toggle dev console (Cmd+Shift+D)' },
      { method: 'POST', path: '/eval', desc: 'Evaluate JavaScript expression' },
      { method: 'POST', path: '/click', desc: 'Click element by selector or text' },
      { method: 'POST', path: '/type', desc: 'Type text into input element' },
      { method: 'POST', path: '/key', desc: 'Press keyboard key with modifiers' },
      { method: 'POST', path: '/wait', desc: 'Wait for selector or condition' },
      { method: 'POST', path: '/select', desc: 'Select agent by name or index' },
      { method: 'POST', path: '/mock-agent', desc: 'Start mock headless agent' },
      { method: 'POST', path: '/setup-test-env', desc: 'Bypass onboarding, create test agents' },
    ];
    endpoints.forEach(({ method, path: p, desc }) => {
      const methodColor = method === 'GET' ? 'green' : 'yellow';
      console.log(`  ${c(methodColor, method.padEnd(5))} ${c('cyan', p.padEnd(30))} ${c('dim', desc)}`);
    });
    console.log('');
  },

  async testids() {
    const result = await cdpRequest('POST', '/eval', {
      expression: `
        (function() {
          const elements = document.querySelectorAll('[data-testid]');
          const testids = [];
          elements.forEach(el => {
            const testid = el.getAttribute('data-testid');
            const tag = el.tagName.toLowerCase();
            const visible = el.offsetParent !== null || el.offsetHeight > 0;
            const text = el.textContent?.trim()?.slice(0, 50) || '';
            testids.push({ testid, tag, visible, text });
          });
          return testids;
        })()
      `,
    });
    if (result.result && result.result.length > 0) {
      console.log(c('bright', `\n  data-testid elements (${result.result.length}):\n`));
      result.result.forEach(({ testid, tag, visible, text }) => {
        const vis = visible ? c('green', 'visible') : c('dim', 'hidden');
        const txt = text ? c('dim', ` "${text.slice(0, 40)}"`) : '';
        console.log(`  ${c('cyan', testid.padEnd(40))} <${c('yellow', tag)}> [${vis}]${txt}`);
      });
      console.log('');
    } else {
      console.log(c('yellow', 'No data-testid elements found'));
    }
    return result;
  },

  async dom(args) {
    const selector = args.join(' ');
    if (!selector) {
      console.log(c('red', 'Usage: /dom <selector>'));
      return;
    }
    const result = await cdpRequest('POST', '/eval', {
      expression: `
        (function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return { error: 'Element not found: ${selector}' };
          return {
            tag: el.tagName.toLowerCase(),
            id: el.id || null,
            className: el.className || null,
            textContent: el.textContent?.trim()?.slice(0, 200) || null,
            innerHTML: el.innerHTML?.slice(0, 500) || null,
            attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
            rect: el.getBoundingClientRect(),
            children: el.children.length,
            visible: el.offsetParent !== null || el.offsetHeight > 0,
          };
        })()
      `,
    });
    if (result.result?.error) {
      console.log(c('red', result.result.error));
    } else {
      console.log(prettyJson(result.result));
    }
    return result;
  },

  async history() {
    if (commandHistory.length === 0) {
      console.log(c('dim', 'No commands in history'));
      return;
    }
    console.log(c('bright', '\n  Command History:\n'));
    commandHistory.forEach((cmd, i) => {
      console.log(`  ${c('dim', String(i + 1).padStart(3))} ${cmd}`);
    });
    console.log('');
  },

  async save(args) {
    const filename = args[0] || `inspector-session-${Date.now()}.json`;
    const dir = path.join(__dirname, '../../test-reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, JSON.stringify(sessionHistory, null, 2));
    console.log(c('green', `Session saved: ${filePath}`));
  },

  async help() {
    console.log(c('bright', '\n  CDP Inspector Commands:\n'));
    const cmds = [
      ['/screenshot [name]', 'Take a screenshot'],
      ['/state', 'Get current app state'],
      ['/ui', 'Get structured UI snapshot'],
      ['/agents', 'List all agents'],
      ['/select <name|idx>', 'Select an agent'],
      ['/eval <code>', 'Evaluate JavaScript'],
      ['/click <sel|text>', 'Click an element'],
      ['/type <sel> <text>', 'Type text into element'],
      ['/key <key> [mods]', 'Press keyboard key'],
      ['/wait <selector>', 'Wait for element'],
      ['/health', 'Check CDP connection'],
      ['/endpoints', 'List all CDP endpoints'],
      ['/testids', 'List data-testid elements'],
      ['/dom <selector>', 'Inspect DOM element'],
      ['/history', 'Show command history'],
      ['/save [file]', 'Save session to file'],
      ['/help', 'Show this help'],
      ['/quit', 'Exit inspector'],
    ];
    cmds.forEach(([cmd, desc]) => {
      console.log(`  ${c('cyan', cmd.padEnd(25))} ${c('dim', desc)}`);
    });
    console.log(`\n  ${c('dim', 'Tip: Any input not starting with / is evaluated as JavaScript')}\n`);
  },
};

/**
 * Main REPL loop
 */
async function main() {
  console.log(c('bright', '\n  CDP Inspector v1.0'));
  console.log(c('dim', `  Connecting to CDP server at ${CDP_SERVER_HOST}:${CDP_SERVER_PORT}...\n`));

  // Check connection
  try {
    const health = await cdpRequest('GET', '/health');
    if (health.cdp === 'connected') {
      console.log(c('green', '  Connected to CDP server and Electron app'));
    } else {
      console.log(c('yellow', '  CDP server running but Electron app not connected'));
      console.log(c('dim', '  The connection will be established on the first command'));
    }
  } catch (error) {
    console.log(c('red', `  Cannot connect to CDP server: ${error.message}`));
    console.log(c('dim', '  Make sure the app is running: npm run dev:cdp:wait'));
    process.exit(1);
  }

  console.log(c('dim', '  Type /help for commands\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c('cyan', 'cdp> '),
    historySize: 200,
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    commandHistory.push(input);

    if (input === '/quit' || input === '/exit' || input === '/q') {
      console.log(c('dim', 'Goodbye!'));
      process.exit(0);
    }

    try {
      if (input.startsWith('/')) {
        const parts = input.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (commands[cmd]) {
          const result = await commands[cmd](args);
          logResult(input, result);
        } else {
          console.log(c('red', `Unknown command: /${cmd}. Type /help for available commands.`));
        }
      } else {
        // Treat as JavaScript evaluation
        const result = await cdpRequest('POST', '/eval', { expression: input });
        console.log(prettyJson(result));
        logResult(input, result);
      }
    } catch (error) {
      console.log(c('red', `Error: ${error.message}`));
      logResult(input, null, error);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(c('dim', '\nGoodbye!'));
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
