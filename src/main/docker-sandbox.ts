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
import { Readable, PassThrough } from 'stream'
import { EventEmitter } from 'events'
import * as path from 'path'
import { getProxyUrl } from './tool-proxy'
import { getClaudeOAuthToken } from './config'
import { logger, LogContext } from './logger'
import { spawnWithPath } from './exec-utils'
import { loadSettings } from './settings-manager'

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
}

export interface ContainerResult {
  containerId: string
  stdout: PassThrough
  stderr: PassThrough
  stop: () => Promise<void>
  wait: () => Promise<number>
}

// Default image name - should match what's built by Dockerfile
const DEFAULT_IMAGE = 'bismarck-agent:latest'

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

  // Set working directory
  args.push('-w', '/workspace')

  // Environment variables
  const proxyUrl = config.proxyHost || getProxyUrl()
  args.push('-e', `TOOL_PROXY_URL=${proxyUrl}`)

  // Pass plan ID for bd proxy commands
  if (config.planId) {
    args.push('-e', `BISMARCK_PLAN_ID=${config.planId}`)
  }

  // Pass host worktree path for git proxy commands
  // The git wrapper needs to know the host path to execute commands
  args.push('-e', `BISMARCK_HOST_WORKTREE_PATH=${config.workingDir}`)

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

  // Pass Claude OAuth token to container for headless agents using Claude subscription
  const oauthToken = getClaudeOAuthToken()
  if (oauthToken) {
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`)
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

  // Image name
  args.push(config.image || DEFAULT_IMAGE)

  // For mock images, use the image's entrypoint instead of claude command
  if (!config.useEntrypoint) {
    // Claude command with arguments
    args.push('claude')
    args.push('--dangerously-skip-permissions')
    args.push('-p', config.prompt)
    args.push('--output-format', 'stream-json')
    args.push('--verbose')

    // Add any additional claude flags
    if (config.claudeFlags) {
      args.push(...config.claudeFlags)
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
  logger.debug('docker', `Docker command: docker ${args.join(' ')}`, logContext)

  const dockerProcess = spawnWithPath('docker', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // Close stdin immediately - Claude Code with -p flag doesn't need stdin
  // and leaving it open may prevent the process from starting properly
  dockerProcess.stdin?.end()

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
  imageName: string = DEFAULT_IMAGE
): Promise<boolean> {
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
 * Build the bismarck-agent Docker image
 */
export async function buildAgentImage(
  dockerfilePath: string,
  imageName: string = DEFAULT_IMAGE
): Promise<{ success: boolean; output: string }> {
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
 * Checks if Docker is available and builds the image if needed
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

  // Check if image exists
  const imageExists = await checkImageExists(DEFAULT_IMAGE)
  if (imageExists) {
    logger.info('docker', 'Docker image already exists', undefined, { image: DEFAULT_IMAGE })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: false,
      message: 'Docker environment ready',
    }
  }

  // Build the image
  logger.info('docker', 'Building Docker image', undefined, { image: DEFAULT_IMAGE })
  const dockerfilePath = getDockerfilePath()

  // Check if Dockerfile exists
  const fs = await import('fs/promises')
  try {
    await fs.access(dockerfilePath)
  } catch {
    logger.error('docker', 'Dockerfile not found', undefined, { path: dockerfilePath })
    return {
      success: false,
      dockerAvailable: true,
      imageBuilt: false,
      message: `Dockerfile not found at ${dockerfilePath}`,
    }
  }

  const buildResult = await buildAgentImage(dockerfilePath, DEFAULT_IMAGE)

  if (buildResult.success) {
    logger.info('docker', 'Docker image built successfully', undefined, { image: DEFAULT_IMAGE })
    return {
      success: true,
      dockerAvailable: true,
      imageBuilt: true,
      message: 'Docker image built successfully',
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
