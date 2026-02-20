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

import * as crypto from 'crypto'
import * as http from 'http'
import * as net from 'net'
import * as path from 'path'
import { EventEmitter } from 'events'
import { logger } from './logger'
import { spawnWithPath, getEnvWithPath } from './exec-utils'
import { getConfigDir } from './config'
import { getGitHubToken, loadSettings } from './settings-manager'
import { getGitUserConfig } from './git-utils'

export interface ToolProxyConfig {
  port: number // Default: 9847
  tools: Record<string, { enabled: boolean }>
}

const DEFAULT_CONFIG: ToolProxyConfig = {
  port: 9847,
  tools: {
    gh: { enabled: true },
    bd: { enabled: true },
    git: { enabled: true },
    bb: { enabled: false },
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
let proxyToken: string | null = null

/**
 * Execute a command and return the result
 */
async function executeCommand(
  command: string,
  args: string[],
  stdin?: string,
  options?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Build environment with any extra vars (e.g., GITHUB_TOKEN)
    const env = options?.env ? getEnvWithPath(options.env) : undefined

    // Use spawnWithPath to ensure tools like gh, bd are found in user paths
    const proc = spawnWithPath(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      cwd: options?.cwd,
      ...(env ? { env } : {}),
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
  if (!(currentConfig.tools['gh']?.enabled ?? false)) {
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

    // Log the operation
    proxyEvents.emit('gh', { subpath, args, cwd })

    // Get GitHub token from settings and pass to gh command
    const githubToken = await getGitHubToken()
    const env: Record<string, string> = {}
    if (githubToken) {
      env.GITHUB_TOKEN = githubToken
    }

    const result = await executeCommand('gh', args, body.stdin, { cwd, env: Object.keys(env).length > 0 ? env : undefined })

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
 *
 * If planId is an absolute path (e.g., reference agent directory for Ralph Loops),
 * use it directly. Otherwise, treat it as a plan name and construct the path.
 */
function getPlanDir(planId: string): string {
  // If planId is an absolute path, use it directly
  if (path.isAbsolute(planId)) {
    return planId
  }
  // Otherwise, treat as a plan name under ~/.bismarck/plans/
  return path.join(getConfigDir(), 'plans', planId)
}

/**
 * Handle bd CLI proxy requests
 */
async function handleBdRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!(currentConfig.tools['bd']?.enabled ?? false)) {
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
  if (!(currentConfig.tools['git']?.enabled ?? false)) {
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

    // Auto-inject Co-authored-by trailer for git commit commands
    if (args[0] === 'commit') {
      const msgIndex = args.indexOf('-m')
      if (msgIndex !== -1 && msgIndex + 1 < args.length) {
        const msg = args[msgIndex + 1]
        if (!msg.toLowerCase().includes('co-authored-by:')) {
          args[msgIndex + 1] = msg + '\n\nCo-authored-by: Claude <noreply@anthropic.com>'
        }
      }
    }

    logger.info('proxy', `git request received: git ${args.join(' ')}`, { worktreePath: cwd })

    // Log the operation
    proxyEvents.emit('git', { cwd, args })

    // Get git user config for identity to ensure commits have correct author/committer
    // Pass cwd to get repo-local config (e.g., user.email from .git/config or inherited from parent repo)
    const gitConfig = await getGitUserConfig(cwd)
    const env: Record<string, string> = {}
    if (gitConfig.userName) {
      env.GIT_AUTHOR_NAME = gitConfig.userName
      env.GIT_COMMITTER_NAME = gitConfig.userName
    }
    if (gitConfig.userEmail) {
      env.GIT_AUTHOR_EMAIL = gitConfig.userEmail
      env.GIT_COMMITTER_EMAIL = gitConfig.userEmail
    }

    // Execute git command on host with identity environment
    const result = await executeCommand('git', args, body.stdin, {
      cwd,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    logger.info('proxy', `git request completed: git ${args.slice(0, 2).join(' ')}...`, { worktreePath: cwd }, {
      exitCode: result.exitCode,
      success: result.exitCode === 0,
      stdoutLen: result.stdout?.length || 0,
      stderrLen: result.stderr?.length || 0,
      stderrPreview: result.stderr?.substring(0, 200) || '',
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
 * Handle bb CLI proxy requests
 */
async function handleBbRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!(currentConfig.tools['bb']?.enabled ?? false)) {
    logger.warn('proxy', 'bb tool is disabled, rejecting request')
    sendJson(res, 403, { success: false, error: 'bb tool is disabled' })
    return
  }

  try {
    const body = (await parseBody(req)) as ProxyRequest & { cwd?: string }

    const args = body.args || []
    const cwd = body.cwd

    logger.debug('proxy', `bb request: ${args.join(' ')}`, cwd ? { worktreePath: cwd } : undefined)

    // Log the operation
    proxyEvents.emit('bb', { args, cwd })

    // Forward BUILDBUDDY_API_KEY so bb works outside git repos (e.g., worktrees)
    // Forward GITHUB_TOKEN so bb remote can authenticate to private repos for Go modules
    const env: Record<string, string> = {}
    if (process.env.BUILDBUDDY_API_KEY) {
      env.BUILDBUDDY_API_KEY = process.env.BUILDBUDDY_API_KEY
    }
    if (process.env.GITHUB_TOKEN) {
      env.GITHUB_TOKEN = process.env.GITHUB_TOKEN
    }

    const result = await executeCommand('bb', args, body.stdin, {
      cwd,
      env: Object.keys(env).length > 0 ? env : undefined,
    })

    logger.proxyRequest('bb', args, result.exitCode === 0, undefined, {
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
    logger.error('proxy', `bb request failed: ${errorMsg}`)
    sendJson(res, 400, {
      success: false,
      error: errorMsg,
    })
  }
}

/**
 * Handle generic tool proxy requests
 * Fallback handler for tools that don't have specialized handlers
 */
async function handleGenericToolRequest(
  toolName: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!(currentConfig.tools[toolName]?.enabled ?? false)) {
    logger.warn('proxy', `${toolName} tool is disabled, rejecting request`)
    sendJson(res, 403, { success: false, error: `${toolName} tool is disabled` })
    return
  }

  try {
    const body = (await parseBody(req)) as ProxyRequest & { cwd?: string }

    const args = body.args || []
    const cwd = body.cwd

    logger.debug('proxy', `${toolName} request: ${args.join(' ')}`, cwd ? { worktreePath: cwd } : undefined)

    proxyEvents.emit('tool', { toolName, args, cwd })

    const result = await executeCommand(toolName, args, body.stdin, { cwd })

    logger.info('proxy', `${toolName} request completed`, undefined, {
      tool: toolName,
      args: args.slice(0, 3).join(' '),
      success: result.exitCode === 0,
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
    logger.error('proxy', `${toolName} request failed: ${errorMsg}`)
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

  // Health check is exempt from auth (reveals nothing sensitive)
  if (url === '/health' && method === 'GET') {
    handleHealthCheck(res)
    return
  }

  // Verify bearer token on all other endpoints
  if (proxyToken) {
    const authHeader = req.headers['authorization']
    if (!authHeader || authHeader !== `Bearer ${proxyToken}`) {
      logger.warn('proxy', 'Rejected request with invalid/missing auth token', undefined, { url, method })
      sendJson(res, 401, { success: false, error: 'Unauthorized' })
      return
    }
  }

  // Route requests
  if (url.startsWith('/gh') && method === 'POST') {
    const subpath = url.substring(3) // Remove '/gh' prefix
    await handleGhRequest(req, res, subpath || '/')
  } else if (url.startsWith('/bd') && method === 'POST') {
    await handleBdRequest(req, res)
  } else if (url.startsWith('/git') && method === 'POST') {
    await handleGitRequest(req, res)
  } else if (url.startsWith('/bb') && method === 'POST') {
    await handleBbRequest(req, res)
  } else if (method === 'POST') {
    // Generic fallback: extract tool name from URL path (e.g., /npm -> "npm")
    const match = url.match(/^\/([a-zA-Z0-9_-]+)/)
    if (match) {
      const toolName = match[1]
      await handleGenericToolRequest(toolName, req, res)
    } else {
      sendJson(res, 404, { success: false, error: 'Not found' })
    }
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

  // Read enabled state from settings for all proxied tools
  const settings = await loadSettings()
  const proxiedTools = settings.docker.proxiedTools
  const toolsConfig: Record<string, { enabled: boolean }> = proxiedTools.reduce(
    (acc, t) => {
      acc[t.name] = { enabled: t.enabled }
      return acc
    },
    {} as Record<string, { enabled: boolean }>
  )

  // Generate per-session auth token
  proxyToken = crypto.randomBytes(32).toString('hex')

  // Find available port if not explicitly specified
  const port = config.port ?? (await findAvailablePort())
  currentConfig = { ...DEFAULT_CONFIG, ...config, port, tools: { ...toolsConfig, ...config.tools } }

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
      const enabledTools = Object.entries(currentConfig.tools)
        .reduce((acc, [name, cfg]) => { acc[`${name}Enabled`] = cfg.enabled; return acc }, {} as Record<string, boolean>)
      logger.info('proxy', `Tool proxy server started`, undefined, {
        port: currentConfig.port,
        url: `http://host.docker.internal:${currentConfig.port}`,
        ...enabledTools,
      })
      proxyEvents.emit('started', { port: currentConfig.port })
      resolve()
    })
  })
}

/**
 * Hot-reload tool configuration from settings without restarting the server
 */
export async function reloadToolConfig(): Promise<void> {
  const settings = await loadSettings()
  const proxiedTools = settings.docker.proxiedTools
  currentConfig.tools = proxiedTools.reduce(
    (acc, t) => {
      acc[t.name] = { enabled: t.enabled }
      return acc
    },
    {} as Record<string, { enabled: boolean }>
  )
  logger.info('proxy', 'Tool config reloaded', undefined, {
    tools: Object.entries(currentConfig.tools)
      .map(([name, cfg]) => `${name}:${cfg.enabled ? 'on' : 'off'}`)
      .join(', '),
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
      proxyToken = null
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
 * Get the current proxy auth token (for passing to containers)
 */
export function getProxyToken(): string | null {
  return proxyToken
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
