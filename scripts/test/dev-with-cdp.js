#!/usr/bin/env node
/**
 * Unified Dev+CDP Command
 *
 * Starts all development services in one command:
 * - Vite dev server (port 5173)
 * - Electron with CDP enabled (port 9222)
 * - CDP HTTP server (port 9333)
 *
 * Usage:
 *   node scripts/test/dev-with-cdp.js           # Start all services
 *   node scripts/test/dev-with-cdp.js --clean   # Kill existing processes first
 *   node scripts/test/dev-with-cdp.js --check   # Check if services are running
 *
 * Or via npm:
 *   npm run dev:cdp
 *   npm run dev:cdp:clean
 *   npm run dev:check
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const PORTS = {
  VITE: 5173,
  CDP: 9222,
  CDP_SERVER: 9333
};

const PROJECT_DIR = path.resolve(__dirname, '../..');
const DOCKER_DIR = path.join(PROJECT_DIR, 'docker');
const MOCK_IMAGE = 'bismark-agent-mock:test';
const children = [];

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * Wait for a port to be listening
 */
async function waitForPort(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await isPortInUse(port)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Wait for HTTP endpoint to respond
 */
async function waitForHttp(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

/**
 * Kill process on a port
 */
function killProcessOnPort(port) {
  try {
    const result = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim();
    if (result) {
      const pids = result.split('\n');
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), 'SIGTERM');
          console.log(`  Killed process ${pid} on port ${port}`);
        } catch (e) {
          // Process may have already exited
        }
      }
    }
  } catch {
    // No process on port
  }
}

/**
 * Check service status using HTTP requests (more reliable than port binding)
 */
async function checkServices() {
  // Check Vite by making HTTP request
  const viteUp = await waitForHttp(`http://localhost:${PORTS.VITE}/`, 2000);

  // Check Electron CDP endpoint
  const cdpUp = await waitForHttp(`http://localhost:${PORTS.CDP}/json`, 2000);

  // Check CDP server health endpoint
  const cdpServerUp = await waitForHttp(`http://localhost:${PORTS.CDP_SERVER}/health`, 2000);

  console.log('Service Status:');
  console.log(`  Vite (${PORTS.VITE}):          ${viteUp ? 'UP' : 'DOWN'}`);
  console.log(`  Electron CDP (${PORTS.CDP}):  ${cdpUp ? 'UP' : 'DOWN'}`);
  console.log(`  CDP Server (${PORTS.CDP_SERVER}):    ${cdpServerUp ? 'UP' : 'DOWN'}`);
  console.log('');

  const allUp = viteUp && cdpUp && cdpServerUp;
  if (allUp) {
    console.log('All services running.');
  } else {
    console.log('Some services not running. Use `npm run dev:cdp` to start.');
  }

  return allUp;
}

/**
 * Clean up existing processes
 */
async function cleanup() {
  console.log('Cleaning up existing processes...');
  killProcessOnPort(PORTS.CDP_SERVER);
  killProcessOnPort(PORTS.CDP);
  killProcessOnPort(PORTS.VITE);

  // Also kill by process name pattern
  try {
    execSync('pkill -f "electron.*bismark" 2>/dev/null || true', { encoding: 'utf-8' });
  } catch {}

  // Wait for ports to be free
  await new Promise(r => setTimeout(r, 1000));
  console.log('');
}

/**
 * Start Vite dev server
 */
function startVite() {
  return new Promise((resolve, reject) => {
    console.log('Starting Vite dev server...');

    const vite = spawn('npm', ['run', 'dev'], {
      cwd: PROJECT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    children.push(vite);

    vite.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('Local:') || text.includes('ready in')) {
        console.log(`  Vite ready on port ${PORTS.VITE}`);
        resolve(vite);
      }
    });

    vite.stderr.on('data', (data) => {
      // Vite outputs to stderr too
      const text = data.toString();
      if (text.includes('Local:') || text.includes('ready in')) {
        console.log(`  Vite ready on port ${PORTS.VITE}`);
        resolve(vite);
      }
    });

    vite.on('error', reject);
    vite.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Vite exited with code ${code}`));
      }
    });

    // Fallback: check port
    setTimeout(async () => {
      if (await isPortInUse(PORTS.VITE)) {
        console.log(`  Vite ready on port ${PORTS.VITE}`);
        resolve(vite);
      }
    }, 5000);
  });
}

/**
 * Build main process
 */
function buildMain() {
  console.log('Building main process...');
  execSync('npm run build:main', {
    cwd: PROJECT_DIR,
    stdio: 'inherit'
  });
  console.log('  Build complete');
}

/**
 * Check if Docker is available
 */
function isDockerAvailable() {
  try {
    execSync('docker version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Docker image exists
 */
function dockerImageExists(imageName) {
  try {
    execSync(`docker image inspect ${imageName}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build mock Docker image if it doesn't exist
 */
function ensureMockDockerImage() {
  if (!isDockerAvailable()) {
    console.log('Docker not available, skipping mock image build');
    return false;
  }

  if (dockerImageExists(MOCK_IMAGE)) {
    console.log(`Mock image ${MOCK_IMAGE} already exists`);
    return true;
  }

  console.log(`Building mock Docker image ${MOCK_IMAGE}...`);
  try {
    execSync(`docker build -t ${MOCK_IMAGE} -f Dockerfile.mock .`, {
      cwd: DOCKER_DIR,
      stdio: 'inherit'
    });
    console.log(`  Mock image ${MOCK_IMAGE} built successfully`);
    return true;
  } catch (error) {
    console.error(`  Failed to build mock image: ${error.message}`);
    return false;
  }
}

/**
 * Start Electron with CDP
 */
function startElectron() {
  return new Promise((resolve, reject) => {
    console.log('Starting Electron with CDP...');

    const electron = spawn('npx', ['electron', `--remote-debugging-port=${PORTS.CDP}`, '.'], {
      cwd: PROJECT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'development' }
    });

    children.push(electron);

    electron.stdout.on('data', (data) => {
      // Electron output
    });

    electron.stderr.on('data', (data) => {
      // Electron often outputs to stderr
    });

    electron.on('error', reject);
    electron.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`  Electron exited with code ${code}`);
      }
    });

    // Wait for CDP endpoint
    waitForHttp(`http://localhost:${PORTS.CDP}/json`, 30000).then((ready) => {
      if (ready) {
        console.log(`  Electron CDP ready on port ${PORTS.CDP}`);
        resolve(electron);
      } else {
        reject(new Error('Electron CDP endpoint not available'));
      }
    });
  });
}

/**
 * Start CDP server
 */
function startCdpServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting CDP server...');

    const server = spawn('node', ['scripts/test/cdp-server.js'], {
      cwd: PROJECT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    children.push(server);

    server.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('running on')) {
        console.log(`  CDP server ready on port ${PORTS.CDP_SERVER}`);
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`  CDP server error: ${data}`);
    });

    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`CDP server exited with code ${code}`));
      }
    });

    // Fallback: check port
    setTimeout(async () => {
      if (await isPortInUse(PORTS.CDP_SERVER)) {
        console.log(`  CDP server ready on port ${PORTS.CDP_SERVER}`);
        resolve(server);
      }
    }, 3000);
  });
}

/**
 * Graceful shutdown
 */
function shutdown() {
  console.log('\nShutting down...');
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const check = args.includes('--check');

  // Check mode
  if (check) {
    const allUp = await checkServices();
    process.exit(allUp ? 0 : 1);
  }

  // Clean mode
  if (clean) {
    await cleanup();
  }

  // Check if services are already running
  const viteRunning = await isPortInUse(PORTS.VITE);
  const cdpRunning = await isPortInUse(PORTS.CDP);
  const cdpServerRunning = await isPortInUse(PORTS.CDP_SERVER);

  if (viteRunning && cdpRunning && cdpServerRunning) {
    console.log('All services already running.');
    await checkServices();
    process.exit(0);
  }

  // Register shutdown handlers
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Starting Bismark development environment with CDP...');
  console.log('');

  try {
    // Start Vite if not running
    if (!viteRunning) {
      await startVite();
    } else {
      console.log(`Vite already running on port ${PORTS.VITE}`);
    }

    // Build main process
    buildMain();

    // Ensure mock Docker image is built (for testing without real Claude API)
    ensureMockDockerImage();

    // Start Electron if not running
    if (!cdpRunning) {
      await startElectron();
    } else {
      console.log(`Electron CDP already running on port ${PORTS.CDP}`);
    }

    // Start CDP server if not running
    if (!cdpServerRunning) {
      await startCdpServer();
    } else {
      console.log(`CDP server already running on port ${PORTS.CDP_SERVER}`);
    }

    console.log('');
    console.log('=== All Services Ready ===');
    console.log('');
    console.log('Ports:');
    console.log(`  Vite:         http://localhost:${PORTS.VITE}`);
    console.log(`  Electron CDP: http://localhost:${PORTS.CDP}/json`);
    console.log(`  CDP Server:   http://localhost:${PORTS.CDP_SERVER}/health`);
    console.log('');
    console.log('Quick commands:');
    console.log('  curl localhost:9333/health');
    console.log('  curl "localhost:9333/screenshot?path=/tmp/claude/test.png"');
    console.log('  curl localhost:9333/state');
    console.log('');
    console.log('Press Ctrl+C to stop all services');

    // Keep running to manage child processes
    await new Promise(() => {});

  } catch (error) {
    console.error('Error starting services:', error.message);
    shutdown();
    process.exit(1);
  }
}

main();
