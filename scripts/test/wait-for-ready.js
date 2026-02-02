#!/usr/bin/env node
/**
 * Wait for all CDP services to be ready
 *
 * Polls the three endpoints until all return healthy, then exits.
 * Used by npm run dev:cdp:wait to provide a single command that
 * starts services and waits for them to be ready.
 *
 * Usage:
 *   node scripts/test/wait-for-ready.js
 *   node scripts/test/wait-for-ready.js --timeout=120
 */

const http = require('http');

const PORTS = {
  VITE: 5173,
  CDP: 9222,
  CDP_SERVER: 9333
};

const DEFAULT_TIMEOUT = 60000; // 60 seconds

/**
 * Check if an HTTP endpoint is responding
 */
function checkEndpoint(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Check all services
 */
async function checkAllServices() {
  const [vite, cdp, cdpServer] = await Promise.all([
    checkEndpoint(`http://localhost:${PORTS.VITE}/`),
    checkEndpoint(`http://localhost:${PORTS.CDP}/json`),
    checkEndpoint(`http://localhost:${PORTS.CDP_SERVER}/health`)
  ]);

  return { vite, cdp, cdpServer, allReady: vite && cdp && cdpServer };
}

/**
 * Main polling loop
 */
async function main() {
  // Parse timeout from args
  const args = process.argv.slice(2);
  let timeout = DEFAULT_TIMEOUT;

  for (const arg of args) {
    if (arg.startsWith('--timeout=')) {
      timeout = parseInt(arg.split('=')[1], 10) * 1000;
    }
  }

  console.log(`Waiting for services to be ready (timeout: ${timeout / 1000}s)...`);

  const start = Date.now();
  const pollInterval = 1000; // 1 second between checks

  while (Date.now() - start < timeout) {
    const status = await checkAllServices();

    if (status.allReady) {
      console.log('');
      console.log('All services ready:');
      console.log(`  Vite (${PORTS.VITE}):          UP`);
      console.log(`  Electron CDP (${PORTS.CDP}):  UP`);
      console.log(`  CDP Server (${PORTS.CDP_SERVER}):    UP`);
      process.exit(0);
    }

    // Show progress
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const statusStr = [
      status.vite ? 'Vite:UP' : 'Vite:...',
      status.cdp ? 'CDP:UP' : 'CDP:...',
      status.cdpServer ? 'Server:UP' : 'Server:...'
    ].join(' | ');
    process.stdout.write(`\r  [${elapsed}s] ${statusStr}    `);

    await new Promise(r => setTimeout(r, pollInterval));
  }

  // Timeout reached
  console.log('');
  console.error(`Timeout: Services not ready after ${timeout / 1000}s`);
  const finalStatus = await checkAllServices();
  console.error('Final status:');
  console.error(`  Vite (${PORTS.VITE}):          ${finalStatus.vite ? 'UP' : 'DOWN'}`);
  console.error(`  Electron CDP (${PORTS.CDP}):  ${finalStatus.cdp ? 'UP' : 'DOWN'}`);
  console.error(`  CDP Server (${PORTS.CDP_SERVER}):    ${finalStatus.cdpServer ? 'UP' : 'DOWN'}`);
  process.exit(1);
}

main();
