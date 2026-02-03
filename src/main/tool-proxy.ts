/**
 * Tool Proxy Server
 *
 * A local HTTP server that proxies sensitive tool operations for containerized agents.
 * Agents call this proxy instead of running tools directly, keeping tokens on the host.
 *
 * Security benefits:
 * - Tokens never enter containers
 * - Bismarck controls what operations are allowed
 * - Can log/audit all sensitive operations
 * - Easy to add rate limiting or approval flows later
 */

import * as http from 'http'
import * as net from 'net'
import * as path from 'path'
import { EventEmitter } from 'events'
import { logger } from './logger'
import { spawnWithPath } from './exec-utils'
import { getConfigDir } from './config'

export interface ToolProxyConfig {
  port: number // Default: 9847
  tools: {
    gh: { enabled: boolean }
    bd: { enabled: boolean }
    git: { enabled: boolean }
  }
}

const DEFAULT_CONFIG: ToolProxyConfig = {
  port: 9847,
  tools: {
    gh: { enabled: true },
    bd: { enabled: true },
    git: { enabled: true },
  },
}

// Port range for dynamic allocation
const PORT_RANGE_START = 9847
const PORT_RANGE_END = 9857

/**
 * Check if a port is available for binding
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const testServer = net.createServer()
    testServer.once('error', () => resolve(false))
    testServer.once('listening', () => {
      testServer.close(() => resolve(true))
    })
    testServer.listen(port, '0.0.0.0')
  })
}

/**
 * Find the first available port in the configured range
 */
async function findAvailablePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    const available = await isPortAvailable(port)
    if (available) return port
  }
  throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`)
}

interface ProxyRequest {
  args: string[]
  stdin?: string
}

interface ProxyResponse {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
}

// Event emitter for proxy activity logging
export const proxyEvents = new EventEmitter()

let server: http.Server | null = null
let currentConfig: ToolProxyConfig = DEFAULT_CONFIG

/**
 * Execute a command and return the result
 */
async function executeCommand(
  command: string,
  args: string[],
  stdin?: string,
  options?: { cwd?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Use spawnWithPath to ensure tools like gh, bd are found in user paths
    const proc = spawnWithPath(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: options?.cwd,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    if (stdin) {
      proc.stdin?.write(stdin)
      proc.stdin?.end()
    }

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      })
    })

    proc.on('error', (err) => {
      resolve({
        stdout,
        stderr: err.message,
        exitCode: 1,
      })
    })
  })
}

/**
 * Parse JSON body from request
 */
async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, status: number, data: ProxyResponse): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Handle gh CLI proxy requests
 */
async function handleGhRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  subpath: string
): Promise<void> {
  if (!currentConfig.tools.gh.enabled) {
    logger.warn('proxy', 'gh tool is disabled, rejecting request')
    sendJson(res, 403, { success: false, error: 'gh tool is disabled' })
    return
  }

  try {
    const body = (await parseBody(req)) as ProxyRequest & { cwd?: string }

    // Args already include subcommands from gh-proxy-wrapper.sh
    // The subpath is only used for logging/routing, not command building
    const args = body.args || []
    const cwd = body.cwd

    logger.debug('proxy', `gh request: ${args.join(' ')}`, cwd ? { worktreePath: cwd } : undefined, { subpath })

    // DEBUG: Log git-related env vars and cwd
    const gitEnvVars = Object.entries(process.env).filter(([k]) => k.startsWith('GIT_')).map(([k, v]) => `${k}=${v}`)
    logger.info('proxy', `DEBUG gh env - cwd: ${cwd}, GIT vars: ${gitEnvVars.join(', ') || 'none'}`)

    // Log the operation
    proxyEvents.emit('gh', { subpath, args, cwd })

    const result = await executeCommand('gh', args, body.stdin, cwd ? { cwd } : undefined)

    logger.proxyRequest('gh', args, result.exitCode === 0, undefined, {
      exitCode: result.exitCode,
      stderrPreview: result.stderr?.substring(0, 100),
    })

    sendJson(res, 200, {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('proxy', `gh request failed: ${errorMsg}`)
    sendJson(res, 400, {
      success: false,
      error: errorMsg,
    })
  }
}

/**
 * Get the plan-specific directory path
 */
function getPlanDir(planId: string): string {
  return path.join(getConfigDir(), 'plans', planId)
}

/**
 * Handle bd CLI proxy requests
 */
async function handleBdRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!currentConfig.tools.bd.enabled) {
    logger.warn('proxy', 'bd tool is disabled, rejecting request')
    sendJson(res, 403, { success: false, error: 'bd tool is disabled' })
    return
  }

  try {
    const body = (await parseBody(req)) as ProxyRequest & { planId?: string }

    // Get plan ID from request body or header
    const planId =
      body.planId || (req.headers['x-bismarck-plan-id'] as string | undefined)
    if (!planId) {
      logger.warn('proxy', 'bd request missing planId')
      sendJson(res, 400, {
        success: false,
        error: 'planId required (in body or X-Bismarck-Plan-Id header)',
      })
      return
    }

    const planDir = getPlanDir(planId)

    // Filter out --sandbox from args (we add it ourselves to ensure it's always present)
    const filteredArgs = (body.args || []).filter((arg: string) => arg !== '--sandbox')

    // Build bd command with --sandbox flag
    const args = ['--sandbox', ...filteredArgs]

    logger.debug('proxy', `bd request: ${args.join(' ')}`, { planId })

    // Log the operation
    proxyEvents.emit('bd', { planId, args })

    // Execute in plan directory context
    const result = await executeCommand('bd', args, body.stdin, { cwd: planDir })

    // Emit specialized event on successful bd close
    if (result.exitCode === 0 && filteredArgs.includes('close')) {
      const closeIndex = filteredArgs.indexOf('close')
      const taskId = filteredArgs[closeIndex + 1]
      if (taskId && !taskId.startsWith('-')) {
        logger.info('proxy', 'bd close succeeded, emitting bd-close-success', { planId }, { taskId })
        proxyEvents.emit('bd-close-success', { planId, taskId })
      }
    }

    logger.proxyRequest('bd', args, result.exitCode === 0, { planId }, {
      exitCode: result.exitCode,
    })

    sendJson(res, 200, {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('proxy', `bd request failed: ${errorMsg}`)
    sendJson(res, 400, {
      success: false,
      error: errorMsg,
    })
  }
}

/**
 * Handle git CLI proxy requests
 * Runs git commands on the host where the worktree reference can be resolved
 */
async function handleGitRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!currentConfig.tools.git.enabled) {
    logger.warn('proxy', 'git tool is disabled, rejecting request')
    sendJson(res, 403, { success: false, error: 'git tool is disabled' })
    return
  }

  try {
    const body = (await parseBody(req)) as ProxyRequest & { cwd?: string }

    // The cwd should be the host path to the worktree
    // Container sends /workspace but we need the actual host path
    const cwd = body.cwd
    if (!cwd) {
      logger.warn('proxy', 'git request missing cwd')
      sendJson(res, 400, {
        success: false,
        error: 'cwd required - specify the host path to run git commands in',
      })
      return
    }

    // Validate the path exists on host
    const fs = await import('fs/promises')
    try {
      await fs.access(cwd)
    } catch {
      logger.warn('proxy', `git request invalid cwd: ${cwd}`)
      sendJson(res, 400, {
        success: false,
        error: `Directory not found on host: ${cwd}`,
      })
      return
    }

    const args = body.args || []

    logger.debug('proxy', `git request: ${args.join(' ')}`, { worktreePath: cwd })

    // Log the operation
    proxyEvents.emit('git', { cwd, args })

    // Execute git command on host
    const result = await executeCommand('git', args, body.stdin, { cwd })

    logger.proxyRequest('git', args, result.exitCode === 0, { worktreePath: cwd }, {
      exitCode: result.exitCode,
    })

    sendJson(res, 200, {
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    logger.error('proxy', `git request failed: ${errorMsg}`)
    sendJson(res, 400, {
      success: false,
      error: errorMsg,
    })
  }
}

/**
 * Handle health check requests
 */
function handleHealthCheck(res: http.ServerResponse): void {
  sendJson(res, 200, { success: true, stdout: 'ok' })
}

/**
 * Main request handler
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = req.url || '/'
  const method = req.method || 'GET'

  // CORS headers for container access
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  // Handle preflight
  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Route requests
  if (url === '/health' && method === 'GET') {
    handleHealthCheck(res)
  } else if (url.startsWith('/gh') && method === 'POST') {
    const subpath = url.substring(3) // Remove '/gh' prefix
    await handleGhRequest(req, res, subpath || '/')
  } else if (url.startsWith('/bd') && method === 'POST') {
    await handleBdRequest(req, res)
  } else if (url.startsWith('/git') && method === 'POST') {
    await handleGitRequest(req, res)
  } else {
    sendJson(res, 404, { success: false, error: 'Not found' })
  }
}

/**
 * Start the tool proxy server
 */
export async function startToolProxy(config: Partial<ToolProxyConfig> = {}): Promise<void> {
  if (server) {
    logger.debug('proxy', 'Server already running')
    return
  }

  // Find available port if not explicitly specified
  const port = config.port ?? (await findAvailablePort())
  currentConfig = { ...DEFAULT_CONFIG, ...config, port }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        logger.error('proxy', 'Request error', undefined, {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
        sendJson(res, 500, { success: false, error: 'Internal server error' })
      })
    })

    server.on('error', (err) => {
      logger.error('proxy', 'Server error', undefined, {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
      reject(err)
    })

    server.listen(currentConfig.port, '0.0.0.0', () => {
      logger.info('proxy', `Server listening on port ${currentConfig.port}`)
      proxyEvents.emit('started', { port: currentConfig.port })
      resolve()
    })
  })
}

/**
 * Stop the tool proxy server
 */
export function stopToolProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }

    server.close(() => {
      logger.info('proxy', 'Server stopped')
      server = null
      proxyEvents.emit('stopped')
      resolve()
    })
  })
}

/**
 * Get the proxy URL for containers to use
 */
export function getProxyUrl(): string {
  return `http://host.docker.internal:${currentConfig.port}`
}

/**
 * Check if proxy server is running
 */
export function isProxyRunning(): boolean {
  return server !== null
}

/**
 * Get current proxy configuration
 */
export function getProxyConfig(): ToolProxyConfig {
  return { ...currentConfig }
}
