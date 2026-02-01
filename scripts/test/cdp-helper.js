#!/usr/bin/env node
/**
 * CDP (Chrome DevTools Protocol) Helper for Bismark Testing
 *
 * Provides a clean API for interacting with the Electron app via CDP.
 * Requires the app to be running with --remote-debugging-port=9222
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class CDPHelper {
  constructor(port = 9222) {
    this.port = port;
    this.ws = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
  }

  /**
   * Get the WebSocket URL for the Bismark page target
   */
  async getWebSocketUrl() {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${this.port}/json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const targets = JSON.parse(data);
            // Find the Bismark page target (not extension or service worker)
            const pageTarget = targets.find(t =>
              t.type === 'page' &&
              (t.title.includes('Bismark') || t.url.includes('localhost:5173'))
            );
            if (pageTarget) {
              resolve(pageTarget.webSocketDebuggerUrl);
            } else {
              reject(new Error('Could not find Bismark page target. Available targets: ' +
                targets.map(t => `${t.type}: ${t.title}`).join(', ')));
            }
          } catch (e) {
            reject(new Error('Failed to parse CDP targets: ' + e.message));
          }
        });
      }).on('error', (e) => {
        reject(new Error(`CDP not available at localhost:${this.port}. Is the app running with --remote-debugging-port=${this.port}? Error: ${e.message}`));
      });
    });
  }

  /**
   * Connect to the CDP endpoint
   */
  async connect() {
    const wsUrl = await this.getWebSocketUrl();

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        // Enable required domains
        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.send('DOM.enable');
        resolve();
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.id !== undefined) {
          const pending = this.pendingMessages.get(message.id);
          if (pending) {
            this.pendingMessages.delete(message.id);
            if (message.error) {
              pending.reject(new Error(message.error.message));
            } else {
              pending.resolve(message.result);
            }
          }
        }
      });

      this.ws.on('error', reject);

      this.ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  /**
   * Disconnect from CDP
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send a CDP command
   */
  async send(method, params = {}) {
    if (!this.ws) {
      throw new Error('Not connected to CDP');
    }

    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Evaluate JavaScript in the renderer context
   */
  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: options.returnByValue ?? true,
      ...options
    });

    if (result.exceptionDetails) {
      throw new Error(`Evaluation error: ${result.exceptionDetails.text}`);
    }

    return result.result?.value;
  }

  /**
   * Click on an element matching the selector
   */
  async click(selector) {
    await this.evaluate(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.click();
      })()
    `);
  }

  /**
   * Type text into an element
   */
  async type(selector, text) {
    await this.evaluate(`
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ${selector}');
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);
  }

  /**
   * Press a keyboard key (dispatches KeyboardEvent to window)
   */
  async pressKey(key, modifiers = {}) {
    const { meta = false, shift = false, ctrl = false, alt = false } = modifiers;

    await this.evaluate(`
      (function() {
        const event = new KeyboardEvent('keydown', {
          key: ${JSON.stringify(key)},
          code: 'Key' + ${JSON.stringify(key.toUpperCase())},
          metaKey: ${meta},
          shiftKey: ${shift},
          ctrlKey: ${ctrl},
          altKey: ${alt},
          bubbles: true,
          cancelable: true
        });
        window.dispatchEvent(event);
      })()
    `);
  }

  /**
   * Take a screenshot and optionally save to file
   */
  async screenshot(filePath = null) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      quality: 100
    });

    const buffer = Buffer.from(result.data, 'base64');

    if (filePath) {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, buffer);
    }

    return buffer;
  }

  /**
   * Wait for an element to appear in the DOM
   */
  async waitForSelector(selector, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const found = await this.evaluate(`
        !!document.querySelector(${JSON.stringify(selector)})
      `);

      if (found) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  /**
   * Wait for a condition function to return true
   */
  async waitFor(conditionExpression, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const result = await this.evaluate(conditionExpression);

      if (result) {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Timeout waiting for condition`);
  }

  /**
   * Get the current URL
   */
  async getUrl() {
    return this.evaluate('window.location.href');
  }

  /**
   * Get page title
   */
  async getTitle() {
    return this.evaluate('document.title');
  }

  /**
   * Get the app state (if exposed via window)
   */
  async getState() {
    return this.evaluate(`
      (function() {
        // Try to get React state from root element
        const root = document.getElementById('root');
        if (root && root._reactRootContainer) {
          // React 17 or earlier
          return { hasReactRoot: true };
        }
        // Check for exposed state
        if (window.__BISMARK_STATE__) {
          return window.__BISMARK_STATE__;
        }
        // Return basic DOM state
        return {
          title: document.title,
          url: window.location.href,
          hasRoot: !!document.getElementById('root'),
          bodyClasses: document.body.className
        };
      })()
    `);
  }

  /**
   * Trigger the dev console toggle (Cmd+Shift+D)
   */
  async toggleDevConsole() {
    await this.pressKey('d', { meta: true, shift: true });
  }

  /**
   * Start a mock agent via the dev console API
   */
  async startMockAgent(taskId) {
    return this.evaluate(`
      window.electronAPI.devStartMockAgent(${JSON.stringify(taskId)})
    `, { awaitPromise: true });
  }

  /**
   * Check if dev console is visible
   */
  async isDevConsoleVisible() {
    return this.evaluate(`
      !!document.querySelector('[data-testid="dev-console"]') ||
      !!document.querySelector('.dev-console')
    `);
  }
}

// Export for use as module
module.exports = { CDPHelper };
