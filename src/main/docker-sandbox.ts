/**
 * Docker Sandbox Manager
 *
 * Manages Docker container lifecycle for running Claude Code agents
 * in isolated, sandboxed environments.
 *
 * Each container:
 * - Runs Claude Code with --dangerously-skip-permissions
 * - Has worktree/plan directories mounted
 * - Uses tool proxy for sensitive operations (gh, etc.)
 * - Streams JSON output for parsing
 */

import { ChildProcess } from 'child_process'
import { Readable, Writable, PassThrough } from 'stream'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import * as https from 'https'
import { getProxyUrl, getProxyToken } from './tool-proxy'
import { getClaudeOAuthToken } from './config'
import { logger, LogContext } from './logger'
import { spawnWithPath } from './exec-utils'
import { loadSettings, saveSettings, getBuildBuddyApiKey } from './settings-manager'
import { devLog } from './dev-log'

export interface InteractiveDockerOptions {
  workingDir: string          // Host directory to mount at /workspace
  command: string[]           // Command to run (e.g., ['claude', '--dangerously-skip-permissions'])
  claudeConfigDir?: string    // Host ~/.claude to mount (for skills, hooks, etc.)
  env?: Record<string, string> // Additional env vars
  containerName?: string      // Docker container name (auto-generated if not set)
}

export interface ContainerConfig {
  image: string // Docker image name (e.g., "bismarck-agent:latest")
  workingDir: string // Path to mount as /workspace
  planDir?: string // Path to mount as /plan (for bd commands)
  planId?: string // Plan ID for bd proxy commands
  proxyHost?: string // Override proxy URL (default: auto-detect)
  env?: Record<string, string> // Additional environment variables
  prompt: string // The prompt to send to Claude
  claudeFlags?: string[] // Additional claude CLI flags
  useEntrypoint?: boolean // If true, use image's entrypoint instead of claude command (for mock images)
  sharedCacheDir?: string // Host path to shared Go build cache (per-repo)
  sharedModCacheDir?: string // Host path to shared Go module cache (per-repo)
  pnpmStoreDir?: string // Host path to shared pnpm store
  mode?: 'plan' // If 'plan', run in plan mode (stream-json output)
  inputMode?: 'prompt' | 'stream-json' // If 'stream-json', use --input-format stream-json and deliver prompt via stdin (keeps stdin open for nudges)
  planOutputDir?: string // Host path to mount as /plan-output (writable, for plan file capture)
  wrapperDir?: string // Host path to tool wrapper scripts (mounted at /bismarck-tools)
}

export interface ContainerResult {
  containerId: string
  stdin: Writable | null
  stdout: PassThrough
  stderr: PassThrough
  stop: () => Promise<void>
  wait: () => Promise<number>
}

export interface DockerImageInfo {
  exists: boolean
  imageId?: string       // Short 12-char ID
  fullImageId?: string   // Full sha256:... ID
  created?: string
  size?: number
  digest?: string        // Registry digest from RepoDigests (sha256:...)
  labels?: Record<string, string>  // Image labels from Config.Labels
}

// Docker Hub registry image
export const IMAGE_REPO = 'bismarckapp/bismarck-agent'

function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('electron').app.getVersion()
  } catch {
    return 'latest'
  }
}

export function getDefaultImage(): string {
  return `${IMAGE_REPO}:${getAppVersion()}`
}

export function getDefaultImageLatest(): string {
  return `${IMAGE_REPO}:latest`
}

// Mock image for testing without real Claude API calls
export const MOCK_IMAGE = 'bismarck-agent-mock:test'

// Event emitter for container lifecycle events
export const containerEvents = new EventEmitter()

// Track running containers for cleanup
const runningContainers: Map<
  string,
  {
    process: ChildProcess
    containerId: string | null
  }
> = new Map()

/**
 * Build docker run arguments for an interactive Docker terminal session.
 * Generic and reusable for any interactive Docker use case.
 */
export async function buildInteractiveDockerArgs(options: InteractiveDockerOptions): Promise<{ args: string[]; containerName: string }> {
  const settings = await loadSettings()
  const { getSelectedDockerImage, getGitHubToken } = await import('./settings-manager')

  // Generate a container name if not provided
  const containerName = options.containerName || `bismarck-terminal-${Date.now()}`

  const args: string[] = [
    'run',
    '--rm',
    '-it', // Interactive + TTY for full TUI support
    '--name', containerName,
  ]

  // Mount working directory
  args.push('-v', `${options.workingDir}:/workspace`)
  args.push('-w', '/workspace')

  // Mount host ~/.claude read-write so Claude Code can persist settings,
  // theme preferences, and session state across interactive runs.
  if (options.claudeConfigDir) {
    args.push('-v', `${options.claudeConfigDir}:/home/agent/.claude`)

    // Mount a patched settings.json with hooks removed — host hook commands
    // reference absolute host paths that don't exist inside the container.
    const fs = await import('fs')
    const os = await import('os')
    const settingsPath = path.join(options.claudeConfigDir, 'settings.json')
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      delete settings.hooks
      const tmpDir = path.join(os.tmpdir(), 'bismarck-docker')
      fs.mkdirSync(tmpDir, { recursive: true })
      const patchedSettingsPath = path.join(tmpDir, 'settings.json')
      fs.writeFileSync(patchedSettingsPath, JSON.stringify(settings, null, 2))
      args.push('-v', `${patchedSettingsPath}:/home/agent/.claude/settings.json`)
    } catch { /* settings.json missing or invalid — skip */ }
  }

  // Tool proxy URL + token
  const proxyUrl = getProxyUrl()
  args.push('-e', `TOOL_PROXY_URL=${proxyUrl}`)
  const token = getProxyToken()
  if (token) {
    args.push('-e', `TOOL_PROXY_TOKEN=${token}`)
  }

  // Host worktree path for git proxy commands
  args.push('-e', `BISMARCK_HOST_WORKTREE_PATH=${options.workingDir}`)

  // SSH agent forwarding
  if (settings.docker.sshAgent?.enabled !== false) {
    if (process.platform === 'darwin') {
      args.push('--mount', 'type=bind,src=/run/host-services/ssh-auth.sock,target=/ssh-agent')
      args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent')
      args.push('--group-add', '0')
    } else if (process.env.SSH_AUTH_SOCK) {
      args.push('-v', `${process.env.SSH_AUTH_SOCK}:/ssh-agent`)
      args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent')
    }
  }

  // Docker socket forwarding if enabled
  if (settings.docker.dockerSocket?.enabled) {
    const socketPath = settings.docker.dockerSocket.path || '/var/run/docker.sock'
    args.push('-v', `${socketPath}:${socketPath}`)
    if (process.platform !== 'darwin' || settings.docker.sshAgent?.enabled === false) {
      args.push('--group-add', '0')
    }
    if (process.platform === 'darwin' || process.platform === 'win32') {
      args.push('-e', 'TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal')
    }
    args.push('-e', `DOCKER_HOST=unix://${socketPath}`)
  }

  // Tool wrapper mounts (generate wrappers for custom proxied tools)
  const { generateToolWrappers } = await import('./wrapper-generator')
  const wrapperDir = await generateToolWrappers(`interactive-${Date.now()}`)
  if (wrapperDir) {
    args.push('-v', `${wrapperDir}:/bismarck-tools:ro`)
    args.push('-e', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/bismarck-tools')
  }

  // OAuth token
  const oauthToken = getClaudeOAuthToken()
  if (oauthToken) {
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`)
  }

  // Claude Code interactive mode requires hasCompletedOnboarding in ~/.claude.json
  // to skip the auth/onboarding flow when CLAUDE_CODE_OAUTH_TOKEN is set.
  // Read the host's file, inject the flag, and mount a patched copy.
  if (options.claudeConfigDir) {
    const fs = await import('fs')
    const os = await import('os')
    const claudeJsonPath = path.join(path.dirname(options.claudeConfigDir), '.claude.json')
    let claudeJson: Record<string, unknown> = {}
    try {
      claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf-8'))
    } catch { /* file missing or invalid — start fresh */ }
    claudeJson.hasCompletedOnboarding = true
    const tmpDir = path.join(os.tmpdir(), 'bismarck-docker')
    fs.mkdirSync(tmpDir, { recursive: true })
    const patchedPath = path.join(tmpDir, 'claude.json')
    fs.writeFileSync(patchedPath, JSON.stringify(claudeJson))
    args.push('-v', `${patchedPath}:/home/agent/.claude.json`)
  }

  // GitHub token
  const githubToken = await getGitHubToken()
  if (githubToken) {
    args.push('-e', `GITHUB_TOKEN=${githubToken}`)
  }

  // Additional env vars
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`)
    }
  }

  // host.docker.internal
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    args.push('--add-host', 'host.docker.internal:host-gateway')
  }

  // Network isolation: route traffic through Squid proxy on internal network
  const { applyNetworkIsolationArgs } = await import('./network-proxy')
  applyNetworkIsolationArgs(args, settings)

  // Resource limits
  if (settings.docker.resourceLimits?.memory) {
    args.push('--memory', settings.docker.resourceLimits.memory)
  }
  if (settings.docker.resourceLimits?.cpu) {
    args.push('--cpus', settings.docker.resourceLimits.cpu)
  }
  if (settings.docker.resourceLimits?.gomaxprocs) {
    args.push('-e', `GOMAXPROCS=${settings.docker.resourceLimits.gomaxprocs}`)
  }

  // Image
  const selectedImage = await getSelectedDockerImage()
  args.push(selectedImage)

  // Command
  args.push(...options.command)

  return { args, containerName }
}

/**
 * Build the docker run command arguments
 */
async function buildDockerArgs(config: ContainerConfig): Promise<string[]> {
  const settings = await loadSettings()

  const args: string[] = [
    'run',
    '--rm', // Remove container after exit
    '-i', // Interactive (for stdin)
  ]

  // Mount working directory
  args.push('-v', `${config.workingDir}:/workspace`)

  // Mount plan directory if provided
  if (config.planDir) {
    args.push('-v', `${config.planDir}:/plan:ro`)
  }

  // Mount plan output directory if provided (writable, for plan file capture)
  if (config.planOutputDir) {
    args.push('-v', `${config.planOutputDir}:/plan-output`)
  }

  // Set working directory
  args.push('-w', '/workspace')

  // Environment variables
  const proxyUrl = config.proxyHost || getProxyUrl()
  args.push('-e', `TOOL_PROXY_URL=${proxyUrl}`)

  // Pass proxy auth token so container can authenticate with tool proxy
  const token = getProxyToken()
  if (token) {
    args.push('-e', `TOOL_PROXY_TOKEN=${token}`)
  }

  // Pass plan ID for bd proxy commands
  if (config.planId) {
    args.push('-e', `BISMARCK_PLAN_ID=${config.planId}`)
  }

  // Pass host worktree path for git proxy commands
  // The git wrapper needs to know the host path to execute commands
  args.push('-e', `BISMARCK_HOST_WORKTREE_PATH=${config.workingDir}`)

  // Redirect Go temp dir to workspace volume to avoid filling container overlay fs
  // GOTMPDIR must be per-worktree (scratch files can collide between concurrent builds)
  args.push('-e', 'GOTMPDIR=/workspace/.tmp')

  // Redirect Go build cache: use shared per-repo cache if enabled, otherwise per-worktree
  if (settings.docker.sharedBuildCache?.enabled && config.sharedCacheDir) {
    args.push('-v', `${config.sharedCacheDir}:/shared-cache`)
    args.push('-e', 'GOCACHE=/shared-cache')
  } else {
    args.push('-e', 'GOCACHE=/workspace/.tmp/go-build')
  }

  // Redirect Go module cache: use shared per-repo cache if enabled, otherwise per-worktree
  if (settings.docker.sharedBuildCache?.enabled && config.sharedModCacheDir) {
    args.push('-v', `${config.sharedModCacheDir}:/shared-modcache`)
    args.push('-e', 'GOMODCACHE=/shared-modcache')
  } else {
    args.push('-e', 'GOMODCACHE=/workspace/.tmp/go-mod')
  }

  // Mount pnpm store: share host store with container if enabled
  if (settings.docker.pnpmStore?.enabled && config.pnpmStoreDir) {
    args.push('-v', `${config.pnpmStoreDir}:/shared-pnpm-store`)
    args.push('-e', 'npm_config_store_dir=/shared-pnpm-store')
  }

  // Forward SSH agent for private repo access (Bazel, Go modules)
  // This allows real git (used outside /workspace) to authenticate with GitHub
  // On macOS, Docker Desktop provides a special socket path for SSH agent forwarding
  // because direct Unix socket mounting isn't supported
  if (settings.docker.sshAgent?.enabled !== false) {
    if (process.platform === 'darwin') {
      // Docker Desktop on macOS provides SSH agent at this fixed path
      args.push('--mount', 'type=bind,src=/run/host-services/ssh-auth.sock,target=/ssh-agent')
      args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent')
      // The socket is owned by root:root, so add agent user to root group for access
      args.push('--group-add', '0')
    } else if (process.env.SSH_AUTH_SOCK) {
      // On Linux, mount the actual SSH agent socket
      args.push('-v', `${process.env.SSH_AUTH_SOCK}:/ssh-agent`)
      args.push('-e', 'SSH_AUTH_SOCK=/ssh-agent')
    }
  }

  // Mount Docker socket for testcontainers support (opt-in)
  // This enables containers to spawn sibling containers for integration tests
  if (settings.docker.dockerSocket?.enabled) {
    const socketPath = settings.docker.dockerSocket.path || '/var/run/docker.sock'
    args.push('-v', `${socketPath}:${socketPath}`)

    // Docker socket appears as root:root inside the container on macOS Docker Desktop
    // Add agent user to root group (0) for socket access
    // Note: This is already done for SSH agent on macOS, but we need it for all platforms
    // when Docker socket is enabled
    if (process.platform !== 'darwin' || settings.docker.sshAgent?.enabled === false) {
      args.push('--group-add', '0')
    }

    // For Docker Desktop (macOS/Windows), testcontainers needs to know how to reach
    // spawned containers since they run as siblings, not children
    if (process.platform === 'darwin' || process.platform === 'win32') {
      args.push('-e', 'TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal')
    }

    // Explicitly set DOCKER_HOST for clarity
    args.push('-e', `DOCKER_HOST=unix://${socketPath}`)
  }

  // Mount custom tool wrappers if generated
  if (config.wrapperDir) {
    args.push('-v', `${config.wrapperDir}:/bismarck-tools:ro`)
    args.push('-e', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/bismarck-tools')
  }

  // Pass Claude OAuth token to container for headless agents using Claude subscription
  const oauthToken = getClaudeOAuthToken()
  devLog('[DockerSandbox] OAuth token present:', !!oauthToken, oauthToken ? `(len=${oauthToken.length})` : '')
  if (oauthToken) {
    // Validate token length - valid tokens are ~108 chars, truncated tokens are shorter
    if (oauthToken.length < 100) {
      console.warn('[DockerSandbox] WARNING: OAuth token appears truncated (length:', oauthToken.length, '), expected ~108 chars')
    }
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`)
  }

  // Pass BuildBuddy API key to container
  const buildBuddyKey = await getBuildBuddyApiKey()
  if (buildBuddyKey) {
    args.push('-e', `BUILDBUDDY_API_KEY=${buildBuddyKey}`)
  }

  // Mount BuildBuddy MCP server if configured
  if (settings.docker.buildbuddyMcp?.enabled) {
    let mcpHostPath = settings.docker.buildbuddyMcp.hostPath

    // Auto-detect if hostPath is not explicitly configured
    if (!mcpHostPath) {
      const { detectBuildBuddyMcpPath } = await import('./buildbuddy-mcp-detect')
      const detection = await detectBuildBuddyMcpPath()
      if (detection.path) {
        mcpHostPath = detection.path
        devLog('[DockerSandbox] Auto-detected BuildBuddy MCP path:', mcpHostPath, `(from ${detection.source})`)
      }
    }

    if (mcpHostPath) {
      try {
        await fs.access(path.join(mcpHostPath, 'dist', 'index.js'))
        devLog('[DockerSandbox] Mounting BuildBuddy MCP server from:', mcpHostPath)
        args.push('-v', `${mcpHostPath}:/mcp/buildbuddy:ro`)
        args.push('-e', 'BAZEL_BINDIR=/workspace/bazel-bin')

        // Merge MCP config into host's ~/.claude.json so we don't clobber
        // auth state, onboarding flags, or other fields Claude Code needs.
        const hostClaudeJsonPath = path.join(os.homedir(), '.claude.json')
        let claudeJson: Record<string, unknown> = {}
        try {
          const raw = await fs.readFile(hostClaudeJsonPath, 'utf-8')
          claudeJson = JSON.parse(raw)
        } catch { /* file missing or invalid — start fresh */ }

        claudeJson.hasCompletedOnboarding = true

        // Build the MCP server entry pointing to the container path
        const bbMcpEntry = {
          type: 'stdio',
          command: 'node',
          args: ['/mcp/buildbuddy/dist/index.js'],
          env: {
            BAZEL_BINDIR: '/workspace/bazel-bin',
          },
        }

        // Set top-level mcpServers (overrides host paths with container paths)
        const topLevelMcp = (claudeJson.mcpServers || {}) as Record<string, unknown>
        topLevelMcp.buildbuddy = bbMcpEntry
        claudeJson.mcpServers = topLevelMcp

        // Also inject under projects["/workspace"] for per-project discovery
        const projects = (claudeJson.projects || {}) as Record<string, Record<string, unknown>>
        const workspaceProject = projects['/workspace'] || {}
        const existingMcp = (workspaceProject.mcpServers || {}) as Record<string, unknown>
        workspaceProject.mcpServers = { ...existingMcp, buildbuddy: bbMcpEntry }
        workspaceProject.hasTrustDialogAccepted = true
        workspaceProject.hasCompletedProjectOnboarding = true
        projects['/workspace'] = workspaceProject
        claudeJson.projects = projects

        const tmpConfigPath = path.join(os.tmpdir(), `bismarck-claude-config-${Date.now()}.json`)
        await fs.writeFile(tmpConfigPath, JSON.stringify(claudeJson, null, 2))
        args.push('-v', `${tmpConfigPath}:/home/agent/.claude.json:ro`)
      } catch {
        logger.error('docker', 'BuildBuddy MCP dist/index.js not found at configured path', undefined, {
          path: mcpHostPath,
        })
        containerEvents.emit('config-warning', {
          type: 'buildbuddy-mcp',
          message: `BuildBuddy MCP server not found at ${mcpHostPath}/dist/index.js — may need rebuild`,
        })
      }
    } else {
      logger.error('docker', 'BuildBuddy MCP enabled but path could not be detected. Install with: claude mcp add buildbuddy -s user')
      containerEvents.emit('config-warning', {
        type: 'buildbuddy-mcp',
        message: 'BuildBuddy MCP server not found. Install with: claude mcp add buildbuddy -s user',
      })
    }
  }

  // Add any custom environment variables
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      args.push('-e', `${key}=${value}`)
    }
  }

  // Enable host.docker.internal on Mac/Windows (Linux needs special handling)
  if (process.platform === 'darwin' || process.platform === 'win32') {
    // Docker Desktop handles this automatically
  } else {
    // Linux: add host network or use special flag
    args.push('--add-host', 'host.docker.internal:host-gateway')
  }

  // Network isolation: route traffic through Squid proxy on internal network
  const { applyNetworkIsolationArgs } = await import('./network-proxy')
  applyNetworkIsolationArgs(args, settings)

  // Resource limits
  if (settings.docker.resourceLimits?.memory) {
    args.push('--memory', settings.docker.resourceLimits.memory)
  }
  if (settings.docker.resourceLimits?.cpu) {
    args.push('--cpus', settings.docker.resourceLimits.cpu)
  }
  if (settings.docker.resourceLimits?.gomaxprocs) {
    args.push('-e', `GOMAXPROCS=${settings.docker.resourceLimits.gomaxprocs}`)
  }

  // Image name
  args.push(config.image || getDefaultImage())

  // For mock images, use the image's entrypoint instead of claude command
  if (!config.useEntrypoint) {
    if (config.mode === 'plan') {
      // Plan mode: read-only analysis with restricted tools, stream-json output, uses sonnet for speed
      // Write is included so Claude can write the plan to .bismarck-plan.md for file-based capture
      args.push('claude')
      args.push('--dangerously-skip-permissions')
      args.push('--allowedTools', 'Read,Grep,Glob,Task,Write')
      args.push('-p', config.prompt)
      args.push('--output-format', 'stream-json')
      args.push('--verbose')
      args.push('--model', 'sonnet')
    } else {
      // Execution mode: full permissions, stream-json output
      args.push('claude')
      args.push('--dangerously-skip-permissions')
      if (config.inputMode === 'stream-json') {
        // stream-json input: prompt is delivered via stdin, enables multi-turn nudges
        args.push('--input-format', 'stream-json')
      } else {
        // Default: prompt passed as CLI argument
        args.push('-p', config.prompt)
      }
      args.push('--output-format', 'stream-json')
      args.push('--verbose')

      // Add any additional claude flags
      if (config.claudeFlags) {
        args.push(...config.claudeFlags)
      }
    }
  }

  return args
}

/**
 * Spawn a containerized agent
 */
export async function spawnContainerAgent(
  config: ContainerConfig
): Promise<ContainerResult> {
  const args = await buildDockerArgs(config)
  const trackingId = `container-${Date.now()}`
  const logContext: LogContext = {
    planId: config.planId,
    worktreePath: config.workingDir,
  }

  // Extract key environment variables for logging (filter out sensitive tokens)
  const envVarsForLog = args
    .filter((arg, i) => args[i - 1] === '-e')
    .filter(env => !env.includes('OAUTH_TOKEN') && !env.includes('API_KEY'))
    .map(env => env.split('=')[0] + '=' + (env.includes('WORKTREE') || env.includes('PROXY') ? env.split('=')[1] : '[set]'))

  logger.info('docker', `Spawning container`, logContext, {
    image: config.image,
    useEntrypoint: config.useEntrypoint,
    workingDir: config.workingDir,
    envVars: envVarsForLog,
  })

  // Redact sensitive env var values from full docker command log
  const SENSITIVE_ENV_PATTERNS = ['TOKEN', 'SECRET', 'KEY', 'OAUTH', 'PASSWORD', 'CREDENTIAL']
  const redactedArgs = args.map((arg, i) => {
    if (args[i - 1] === '-e' && arg.includes('=')) {
      const eqIdx = arg.indexOf('=')
      const varName = arg.substring(0, eqIdx)
      if (SENSITIVE_ENV_PATTERNS.some(p => varName.toUpperCase().includes(p))) {
        return `${varName}=[REDACTED]`
      }
    }
    return arg
  })
  logger.debug('docker', `Docker command: docker ${redactedArgs.join(' ')}`, logContext)

  const dockerProcess = spawnWithPath('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // For stream-json input mode, keep stdin open so we can send nudge messages later.
  // For prompt mode (-p flag), close stdin immediately.
  const stdinStream: Writable | null = config.inputMode === 'stream-json' ? dockerProcess.stdin ?? null : null
  if (config.inputMode !== 'stream-json') {
    dockerProcess.stdin?.end()
  }

  // Create pass-through streams for stdout/stderr
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  // Pipe docker output to our streams
  dockerProcess.stdout?.pipe(stdout)
  dockerProcess.stderr?.pipe(stderr)

  // Track the process
  runningContainers.set(trackingId, {
    process: dockerProcess,
    containerId: null,
  })

  // Extract container ID from initial output if available
  // Docker outputs container ID when using certain modes
  let containerId: string | null = null

  // Wait function
  const wait = (): Promise<number> => {
    return new Promise((resolve, reject) => {
      dockerProcess.on('close', (code) => {
        runningContainers.delete(trackingId)
        containerEvents.emit('stopped', { trackingId, code })
        resolve(code ?? 1)
      })

      dockerProcess.on('error', (err) => {
        runningContainers.delete(trackingId)
        containerEvents.emit('error', { trackingId, error: err })
        reject(err)
      })
    })
  }

  // Stop function
  const stop = async (): Promise<void> => {
    logger.info('docker', `Stopping container ${trackingId}`, logContext, {
      pid: dockerProcess.pid,
      killed: dockerProcess.killed,
      exitCode: dockerProcess.exitCode,
    })

    // First try graceful termination
    const sigTermSuccess = dockerProcess.kill('SIGTERM')
    logger.debug('docker', 'Sent SIGTERM to container', logContext, {
      success: sigTermSuccess,
      pid: dockerProcess.pid,
    })

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Force kill if still running
    if (!dockerProcess.killed) {
      logger.info('docker', 'Container still running after SIGTERM, sending SIGKILL', logContext, {
        pid: dockerProcess.pid,
      })
      const sigKillSuccess = dockerProcess.kill('SIGKILL')
      logger.debug('docker', 'Sent SIGKILL to container', logContext, {
        success: sigKillSuccess,
        pid: dockerProcess.pid,
      })
    } else {
      logger.debug('docker', 'Container already killed after SIGTERM', logContext)
    }

    runningContainers.delete(trackingId)
    logger.info('docker', `Container stop completed ${trackingId}`, logContext, {
      finalKilledState: dockerProcess.killed,
      finalExitCode: dockerProcess.exitCode,
    })
  }

  containerEvents.emit('started', { trackingId, config })
  logger.info('docker', `Container started: ${trackingId}`, logContext)

  return {
    containerId: containerId || trackingId,
    stdin: stdinStream,
    stdout,
    stderr,
    stop,
    wait,
  }
}

/**
 * Check if Docker is available and working
 */
export async function checkDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawnWithPath('docker', ['version'], { stdio: 'pipe' })

    proc.on('close', (code) => {
      resolve(code === 0)
    })

    proc.on('error', () => {
      resolve(false)
    })
  })
}

/**
 * Check if the bismarck-agent image exists
 */
export async function checkImageExists(
  imageName?: string
): Promise<boolean> {
  if (!imageName) imageName = getDefaultImage()
  return new Promise((resolve) => {
    const proc = spawnWithPath('docker', ['image', 'inspect', imageName], {
      stdio: 'pipe',
    })

    proc.on('close', (code) => {
      resolve(code === 0)
    })

    proc.on('error', () => {
      resolve(false)
    })
  })
}

/**
 * Get detailed info about a Docker image
 */
export async function getImageInfo(
  imageName?: string
): Promise<DockerImageInfo> {
  if (!imageName) imageName = getDefaultImage()
  return new Promise((resolve) => {
    const proc = spawnWithPath(
      'docker',
      ['image', 'inspect', '--format', '{{json .}}', imageName],
      { stdio: 'pipe' }
    )

    let output = ''

    proc.stdout?.on('data', (data) => {
      output += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ exists: false })
        return
      }

      try {
        const info = JSON.parse(output.trim())

        // Extract registry digest from RepoDigests (e.g., "bismarckapp/bismarck-agent@sha256:abc...")
        let digest: string | undefined
        if (Array.isArray(info.RepoDigests) && info.RepoDigests.length > 0) {
          const repoDigest = info.RepoDigests[0] as string
          const atIdx = repoDigest.indexOf('@')
          if (atIdx !== -1) {
            digest = repoDigest.substring(atIdx + 1)
          }
        }

        // Extract labels from Config.Labels
        const labels: Record<string, string> | undefined =
          info.Config?.Labels && typeof info.Config.Labels === 'object'
            ? info.Config.Labels
            : undefined

        resolve({
          exists: true,
          imageId: info.Id?.replace('sha256:', '').substring(0, 12),
          fullImageId: info.Id || undefined,
          created: info.Created,
          size: info.Size,
          digest,
          labels,
        })
      } catch {
        resolve({ exists: true })
      }
    })

    proc.on('error', () => {
      resolve({ exists: false })
    })
  })
}

/**
 * Build the bismarck-agent Docker image
 */
export async function buildAgentImage(
  dockerfilePath: string,
  imageName?: string
): Promise<{ success: boolean; output: string }> {
  if (!imageName) imageName = getDefaultImage()
  return new Promise((resolve) => {
    const contextDir = path.dirname(dockerfilePath)
    const proc = spawnWithPath(
      'docker',
      ['build', '-t', imageName, '-f', dockerfilePath, contextDir],
      { stdio: 'pipe' }
    )

    let output = ''

    proc.stdout?.on('data', (data) => {
      output += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      output += data.toString()
    })

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        output,
      })
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: err.message,
      })
    })
  })
}

/**
 * Pull a Docker image from a registry (e.g., Docker Hub)
 */
export async function pullImage(
  imageName?: string,
  onProgress?: (message: string) => void
): Promise<{ success: boolean; output: string }> {
  if (!imageName) imageName = getDefaultImage()
  return new Promise((resolve) => {
    logger.info('docker', 'Pulling Docker image', undefined, { image: imageName })
    const proc = spawnWithPath('docker', ['pull', imageName], { stdio: 'pipe' })

    let output = ''

    proc.stdout?.on('data', (data) => {
      const text = data.toString()
      output += text
      onProgress?.(text.trim())
    })

    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      output += text
      onProgress?.(text.trim())
    })

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info('docker', 'Docker image pulled successfully', undefined, { image: imageName })
      } else {
        logger.error('docker', 'Failed to pull Docker image', undefined, { image: imageName, exitCode: code })
      }
      resolve({
        success: code === 0,
        output,
      })
    })

    proc.on('error', (err) => {
      logger.error('docker', 'Error pulling Docker image', undefined, { error: err.message })
      resolve({
        success: false,
        output: err.message,
      })
    })
  })
}

/**
 * Stop all running containers (for cleanup)
 */
export async function stopAllContainers(): Promise<void> {
  logger.info('docker', `Stopping ${runningContainers.size} running containers`)

  const stopPromises: Promise<void>[] = []

  for (const [trackingId, container] of runningContainers) {
    stopPromises.push(
      (async () => {
        try {
          container.process.kill('SIGTERM')
          await new Promise((resolve) => setTimeout(resolve, 1000))
          if (!container.process.killed) {
            container.process.kill('SIGKILL')
          }
          logger.debug('docker', `Stopped container ${trackingId}`)
        } catch (err) {
          logger.error('docker', `Error stopping container ${trackingId}`, undefined, {
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      })()
    )
  }

  await Promise.all(stopPromises)
  runningContainers.clear()
}

/**
 * Get count of running containers
 */
export function getRunningContainerCount(): number {
  return runningContainers.size
}

/**
 * List running container tracking IDs
 */
export function listRunningContainers(): string[] {
  return Array.from(runningContainers.keys())
}

/**
 * Get the path to the Dockerfile in the app
 */
export function getDockerfilePath(): string {
  // In development, use the source directory
  // In production, use the app resources directory
  const isDev = process.env.NODE_ENV === 'development'

  if (isDev) {
    // Development: __dirname is dist/main/main, go up to project root then into docker/
    // dist/main/main -> dist/main -> dist -> project root -> docker
    return path.join(__dirname, '..', '..', '..', 'docker', 'Dockerfile')
  } else {
    // Production: in the app resources
    return path.join(process.resourcesPath || __dirname, 'docker', 'Dockerfile')
  }
}

/**
 * Initialize Docker environment for headless mode
 * Checks if Docker is available and pulls the image if needed
 */
export async function initializeDockerEnvironment(): Promise<{
  success: boolean
  dockerAvailable: boolean
  imageBuilt: boolean
  message: string
}> {
  logger.info('docker', 'Initializing Docker environment')

  // Check if Docker is available
  const dockerAvailable = await checkDockerAvailable()
  if (!dockerAvailable) {
    logger.warn('docker', 'Docker not available')
    return {
      success: false,
      dockerAvailable: false,
      imageBuilt: false,
      message: 'Docker is not available. Headless mode will be disabled.',
    }
  }

  logger.info('docker', 'Docker is available')

  const versionedImage = getDefaultImage()
  const latestImage = getDefaultImageLatest()

  // Try pulling the versioned image first (pinned to app version)
  logger.info('docker', 'Pulling Docker image from registry', undefined, { image: versionedImage })
  let pullResult = await pullImage(versionedImage)

  if (pullResult.success) {
    logger.info('docker', 'Docker image pulled successfully', undefined, { image: versionedImage })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: true,
      message: 'Docker image pulled successfully',
    }
  }

  // Versioned tag failed - try :latest as fallback
  logger.warn('docker', 'Failed to pull versioned image, trying :latest fallback', undefined, {
    versionedImage,
    pullOutput: pullResult.output.substring(0, 200),
  })
  pullResult = await pullImage(latestImage)

  if (pullResult.success) {
    logger.info('docker', 'Docker image pulled successfully (:latest fallback)', undefined, { image: latestImage })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: true,
      message: 'Docker image pulled successfully (:latest fallback)',
    }
  }

  // Both pulls failed - check for cached local images
  logger.warn('docker', 'Failed to pull Docker images', undefined, {
    pullOutput: pullResult.output.substring(0, 200),
  })

  // Check versioned first, then latest
  const versionedExists = await checkImageExists(versionedImage)
  if (versionedExists) {
    logger.info('docker', 'Using cached local image', undefined, { image: versionedImage })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: false,
      message: 'Using cached Docker image (pull failed, likely offline)',
    }
  }

  const latestExists = await checkImageExists(latestImage)
  if (latestExists) {
    logger.info('docker', 'Using cached local :latest image', undefined, { image: latestImage })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: false,
      message: 'Using cached Docker image :latest (pull failed, likely offline)',
    }
  }

  // No local image either - fallback to local build in dev mode only
  logger.warn('docker', 'No cached image available, attempting local build fallback')

  const isDev = process.env.NODE_ENV === 'development'
  if (!isDev) {
    logger.error('docker', 'Cannot build locally in production mode')
    return {
      success: false,
      dockerAvailable: true,
      imageBuilt: false,
      message: `Failed to pull Docker image: ${pullResult.output.substring(0, 200)}`,
    }
  }

  logger.info('docker', 'Dev mode: attempting local Dockerfile build', undefined, { image: versionedImage })
  const dockerfilePath = getDockerfilePath()

  const fs = await import('fs/promises')
  try {
    await fs.access(dockerfilePath)
  } catch {
    logger.error('docker', 'Dockerfile not found for local build', undefined, { path: dockerfilePath })
    return {
      success: false,
      dockerAvailable: true,
      imageBuilt: false,
      message: `Failed to pull image and Dockerfile not found at ${dockerfilePath}`,
    }
  }

  const buildResult = await buildAgentImage(dockerfilePath, versionedImage)

  if (buildResult.success) {
    logger.info('docker', 'Docker image built successfully (dev fallback)', undefined, { image: versionedImage })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: true,
      message: 'Docker image built successfully (local build)',
    }
  } else {
    logger.error('docker', 'Failed to build Docker image', undefined, {
      output: buildResult.output.substring(0, 500),
    })
    return {
      success: false,
      dockerAvailable: true,
      imageBuilt: false,
      message: `Failed to build Docker image: ${buildResult.output.substring(0, 200)}`,
    }
  }
}

/**
 * Persist the digest of a pulled image to settings.
 * If the image is the official image (versioned or :latest), also tracks the upstream template digest/version.
 * Returns whether the base image was updated (for notifying BYO users).
 */
export async function persistImageDigest(imageName: string): Promise<{ baseImageUpdated: boolean }> {
  const imageInfo = await getImageInfo(imageName)
  if (!imageInfo.exists || !imageInfo.digest) return { baseImageUpdated: false }

  const settings = await loadSettings()
  let baseImageUpdated = false

  settings.docker.imageDigests[imageName] = imageInfo.digest

  if (imageName === getDefaultImage() || imageName === getDefaultImageLatest()) {
    const previousDigest = settings.docker.upstreamTemplateDigest
    if (previousDigest && previousDigest !== imageInfo.digest) {
      baseImageUpdated = true
    }
    settings.docker.upstreamTemplateDigest = imageInfo.digest
    settings.docker.upstreamTemplateVersion = imageInfo.labels?.['org.opencontainers.image.version'] ?? null
  }

  await saveSettings(settings)
  return { baseImageUpdated }
}

// --- Registry digest verification ---

const registryDigestCache = new Map<string, { digest: string; timestamp: number }>()
const REGISTRY_CACHE_TTL = 60 * 60 * 1000 // 1 hour

function httpsGet(url: string, headers: Record<string, string>, method: 'GET' | 'HEAD' = 'GET'): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        timeout: 10_000,
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body,
          })
        )
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    req.end()
  })
}

async function fetchDockerHubToken(): Promise<string | null> {
  try {
    const resp = await httpsGet(
      `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${IMAGE_REPO}:pull`,
      { Accept: 'application/json' }
    )
    if (resp.statusCode !== 200) return null
    const data = JSON.parse(resp.body)
    return data.token ?? null
  } catch (err) {
    logger.debug('docker', `Failed to fetch Docker Hub token: ${err}`)
    return null
  }
}

async function fetchManifestDigest(tag: string, token: string): Promise<string | null> {
  try {
    const resp = await httpsGet(
      `https://registry-1.docker.io/v2/${IMAGE_REPO}/manifests/${tag}`,
      {
        Authorization: `Bearer ${token}`,
        Accept: [
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.index.v1+json',
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
        ].join(', '),
      },
      'HEAD'
    )
    if (resp.statusCode !== 200) return null
    return resp.headers['docker-content-digest'] ?? null
  } catch (err) {
    logger.debug('docker', `Failed to fetch manifest digest: ${err}`)
    return null
  }
}

/**
 * Fetch the registry digest for an official image from Docker Hub.
 * Returns null for non-official images or on any failure.
 */
export async function fetchRegistryDigest(imageName: string): Promise<string | null> {
  if (!imageName.startsWith(IMAGE_REPO + ':')) return null

  const cached = registryDigestCache.get(imageName)
  if (cached && Date.now() - cached.timestamp < REGISTRY_CACHE_TTL) {
    return cached.digest
  }

  const tag = imageName.substring(IMAGE_REPO.length + 1)
  const token = await fetchDockerHubToken()
  if (!token) return null

  const digest = await fetchManifestDigest(tag, token)
  if (!digest) return null

  registryDigestCache.set(imageName, { digest, timestamp: Date.now() })
  return digest
}

/**
 * Clear cached registry digest (call after pulling a new image).
 */
export function clearRegistryDigestCache(imageName?: string): void {
  if (imageName) {
    registryDigestCache.delete(imageName)
  } else {
    registryDigestCache.clear()
  }
}
