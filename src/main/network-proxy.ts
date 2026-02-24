/**
 * Network Proxy Manager - Squid proxy for container network isolation
 *
 * Manages a shared Squid proxy container that acts as the sole egress gateway
 * for agent containers on an internal Docker network. Enforces domain-level
 * ACLs to restrict outbound HTTP/HTTPS traffic.
 *
 * Architecture:
 *   [Agent containers] ── bismarck-internal (internal:true) ── [Squid Proxy] ── bismarck-external ── Internet
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnWithPath } from './exec-utils'
import { loadSettings } from './settings-manager'
import { devLog } from './dev-log'
import { logger } from './logger'

const SQUID_CONTAINER_NAME = 'bismarck-squid'
const INTERNAL_NETWORK = 'bismarck-internal'
const EXTERNAL_NETWORK = 'bismarck-external'
const SQUID_IMAGE = 'ubuntu/squid:latest'
const SQUID_PORT = 3128

let proxyRunning = false

/**
 * Get the proxy URL that containers should use
 */
export function getNetworkProxyUrl(): string {
  return `http://${SQUID_CONTAINER_NAME}:${SQUID_PORT}`
}

/**
 * Apply network isolation args to a docker run command.
 * Adds --network, proxy env vars if isolation is enabled and proxy is running.
 */
export function applyNetworkIsolationArgs(args: string[], settings: { docker: { networkIsolation?: { enabled: boolean } } }): void {
  if (!settings.docker.networkIsolation?.enabled) return
  if (!proxyRunning) return

  const proxyUrl = getNetworkProxyUrl()
  args.push('--network', INTERNAL_NETWORK)
  args.push('-e', `HTTP_PROXY=${proxyUrl}`)
  args.push('-e', `HTTPS_PROXY=${proxyUrl}`)
  args.push('-e', `http_proxy=${proxyUrl}`)
  args.push('-e', `https_proxy=${proxyUrl}`)
  args.push('-e', 'NO_PROXY=host.docker.internal,localhost,127.0.0.1')
  args.push('-e', 'no_proxy=host.docker.internal,localhost,127.0.0.1')
}

/**
 * Check if network isolation is enabled in settings
 */
export async function isNetworkIsolationEnabled(): Promise<boolean> {
  const settings = await loadSettings()
  return settings.docker.networkIsolation?.enabled === true
}

/**
 * Check if the network proxy is currently running
 */
export function isNetworkProxyRunning(): boolean {
  return proxyRunning
}

/**
 * Generate squid.conf from the allowed hosts list
 */
function generateSquidConf(allowedHosts: string[]): string {
  // Normalize hosts to Squid dstdomain format (leading dot = domain + all subdomains)
  // Then deduplicate: if ".npmjs.org" is present, remove ".registry.npmjs.org" since
  // Squid 6.x fatally errors on subdomain entries that overlap with parent domains.
  const normalizedDomains = allowedHosts.map(host => {
    if (host.startsWith('*.')) return '.' + host.slice(2)
    return '.' + host
  })

  // Remove domains that are subdomains of another entry in the list
  const deduplicated = normalizedDomains.filter(domain => {
    return !normalizedDomains.some(other =>
      other !== domain && domain.endsWith(other)
    )
  })

  // Remove exact duplicates
  const unique = [...new Set(deduplicated)]

  const domainAcls = unique
    .map(d => `acl allowed_domains dstdomain ${d}`)
    .join('\n')

  return `# Bismarck network isolation proxy - auto-generated
http_port ${SQUID_PORT}

# Allowlisted domains
${domainAcls}

# Allow host.docker.internal (for tool proxy communication)
acl host_docker_internal dstdomain host.docker.internal
http_access allow host_docker_internal

# HTTPS CONNECT
acl SSL_ports port 443
acl CONNECT method CONNECT
http_access allow CONNECT SSL_ports allowed_domains
http_access allow allowed_domains

# Deny everything else
http_access deny all
`
}

/**
 * Write squid.conf to a temp file and return the path
 */
function writeSquidConf(allowedHosts: string[]): string {
  const tmpDir = path.join(os.tmpdir(), 'bismarck-squid')
  fs.mkdirSync(tmpDir, { recursive: true })
  const confPath = path.join(tmpDir, 'squid.conf')
  fs.writeFileSync(confPath, generateSquidConf(allowedHosts))
  return confPath
}

/**
 * Run a docker command and return stdout
 */
function dockerExec(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawnWithPath('docker', args, { stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })
    proc.on('close', (code) => {
      resolve({ success: code === 0, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    proc.on('error', (err) => {
      resolve({ success: false, stdout: '', stderr: err.message })
    })
  })
}

/**
 * Check if a docker container is running by name
 */
async function isContainerRunning(name: string): Promise<boolean> {
  const result = await dockerExec(['ps', '-q', '-f', `name=^${name}$`])
  return result.success && result.stdout.length > 0
}

/**
 * Check if a docker network exists
 */
async function networkExists(name: string): Promise<boolean> {
  const result = await dockerExec(['network', 'inspect', name])
  return result.success
}

/**
 * Pull the Squid image if not present
 */
async function ensureSquidImage(): Promise<boolean> {
  // Check if image exists locally
  const inspectResult = await dockerExec(['image', 'inspect', SQUID_IMAGE])
  if (inspectResult.success) return true

  devLog('[NetworkProxy] Pulling Squid image:', SQUID_IMAGE)
  logger.info('docker', 'Pulling Squid proxy image', undefined, { image: SQUID_IMAGE })

  const pullResult = await dockerExec(['pull', SQUID_IMAGE])
  if (!pullResult.success) {
    logger.error('docker', 'Failed to pull Squid image', undefined, {
      error: pullResult.stderr.substring(0, 200),
    })
    return false
  }

  devLog('[NetworkProxy] Squid image pulled successfully')
  return true
}

/**
 * Ensure the network proxy is running.
 * Creates Docker networks and starts Squid if needed.
 */
export async function ensureNetworkProxy(): Promise<void> {
  const settings = await loadSettings()

  if (!settings.docker.networkIsolation?.enabled) {
    devLog('[NetworkProxy] Network isolation is disabled, skipping')
    return
  }

  const allowedHosts = settings.docker.networkIsolation.allowedHosts || []

  // Check if already running
  if (await isContainerRunning(SQUID_CONTAINER_NAME)) {
    devLog('[NetworkProxy] Squid proxy already running')
    proxyRunning = true
    return
  }

  devLog('[NetworkProxy] Starting network proxy...')
  logger.info('docker', 'Starting Squid network proxy')

  // 1. Ensure Squid image is available
  const imageReady = await ensureSquidImage()
  if (!imageReady) {
    logger.error('docker', 'Failed to ensure Squid image')
    throw new Error('Failed to pull Squid proxy image')
  }
  logger.info('docker', 'Squid image ready')

  // 2. Create Docker networks if they don't exist
  if (!(await networkExists(INTERNAL_NETWORK))) {
    devLog('[NetworkProxy] Creating internal network:', INTERNAL_NETWORK)
    const result = await dockerExec(['network', 'create', '--internal', INTERNAL_NETWORK])
    if (!result.success) {
      logger.error('docker', 'Failed to create internal network', undefined, { error: result.stderr })
      throw new Error(`Failed to create internal network: ${result.stderr}`)
    }
  }

  if (!(await networkExists(EXTERNAL_NETWORK))) {
    devLog('[NetworkProxy] Creating external network:', EXTERNAL_NETWORK)
    const result = await dockerExec(['network', 'create', EXTERNAL_NETWORK])
    if (!result.success) {
      logger.error('docker', 'Failed to create external network', undefined, { error: result.stderr })
      throw new Error(`Failed to create external network: ${result.stderr}`)
    }
  }
  logger.info('docker', 'Docker networks ready')

  // 3. Generate and write squid.conf
  const confPath = writeSquidConf(allowedHosts)
  devLog('[NetworkProxy] Wrote squid.conf to:', confPath)

  // 4. Start Squid container on the internal network
  const runResult = await dockerExec([
    'run', '-d',
    '--name', SQUID_CONTAINER_NAME,
    '--rm',
    '--network', INTERNAL_NETWORK,
    '-v', `${confPath}:/etc/squid/squid.conf:ro`,
    SQUID_IMAGE,
  ])

  if (!runResult.success) {
    logger.error('docker', 'Failed to start Squid container', undefined, { error: runResult.stderr })
    throw new Error(`Failed to start Squid container: ${runResult.stderr}`)
  }

  devLog('[NetworkProxy] Squid container started:', runResult.stdout.substring(0, 12))
  logger.info('docker', 'Squid container started', undefined, { containerId: runResult.stdout.substring(0, 12) })

  // 5. Connect Squid to the external network (gives it internet access)
  const connectResult = await dockerExec([
    'network', 'connect', EXTERNAL_NETWORK, SQUID_CONTAINER_NAME,
  ])

  if (!connectResult.success) {
    logger.error('docker', 'Failed to connect Squid to external network', undefined, { error: connectResult.stderr })
    await dockerExec(['rm', '-f', SQUID_CONTAINER_NAME])
    throw new Error(`Failed to connect Squid to external network: ${connectResult.stderr}`)
  }

  // 6. Wait for Squid to be healthy (poll for readiness)
  devLog('[NetworkProxy] Waiting for Squid to be ready...')
  const maxAttempts = 20
  for (let i = 0; i < maxAttempts; i++) {
    // First check if the container is still running (it may have crashed with --rm)
    if (!(await isContainerRunning(SQUID_CONTAINER_NAME))) {
      logger.error('docker', 'Squid container exited unexpectedly during startup')
      throw new Error('Squid proxy container exited during startup')
    }
    const healthCheck = await dockerExec([
      'exec', SQUID_CONTAINER_NAME, 'squid', '-k', 'check',
    ])
    if (healthCheck.success) {
      devLog('[NetworkProxy] Squid proxy is ready')
      proxyRunning = true
      logger.info('docker', 'Squid network proxy started successfully')
      return
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // If we get here, Squid didn't become ready in time but container is still running
  if (await isContainerRunning(SQUID_CONTAINER_NAME)) {
    logger.warn('docker', 'Squid proxy may not be fully ready, proceeding anyway')
    proxyRunning = true
  } else {
    logger.error('docker', 'Squid container is not running after startup timeout')
    throw new Error('Squid proxy container is not running after startup')
  }
}

/**
 * Stop the network proxy and clean up Docker resources
 */
export async function stopNetworkProxy(): Promise<void> {
  devLog('[NetworkProxy] Stopping network proxy...')
  logger.info('docker', 'Stopping Squid network proxy')

  // Stop and remove Squid container
  await dockerExec(['rm', '-f', SQUID_CONTAINER_NAME])

  // Remove networks (ignore errors if containers are still attached)
  await dockerExec(['network', 'rm', INTERNAL_NETWORK])
  await dockerExec(['network', 'rm', EXTERNAL_NETWORK])

  proxyRunning = false
  devLog('[NetworkProxy] Network proxy stopped')
  logger.info('docker', 'Squid network proxy stopped')
}

/**
 * Reload proxy configuration (after allowlist changes)
 * Regenerates squid.conf and tells Squid to reconfigure without restart
 */
export async function reloadProxyConfig(): Promise<void> {
  if (!proxyRunning) return

  const settings = await loadSettings()
  const allowedHosts = settings.docker.networkIsolation?.allowedHosts || []

  devLog('[NetworkProxy] Reloading proxy config...')
  logger.info('docker', 'Reloading Squid proxy configuration')

  // 1. Generate new config (writes to host path that's bind-mounted into the container)
  writeSquidConf(allowedHosts)

  // 2. Tell Squid to reconfigure (it reads the updated bind-mounted config)
  const reconfigResult = await dockerExec([
    'exec', SQUID_CONTAINER_NAME, 'squid', '-k', 'reconfigure',
  ])

  if (!reconfigResult.success) {
    logger.error('docker', 'Failed to reconfigure Squid', undefined, {
      error: reconfigResult.stderr,
    })
    return
  }

  devLog('[NetworkProxy] Proxy config reloaded')
  logger.info('docker', 'Squid proxy configuration reloaded')
}

/**
 * Clean up orphaned proxy resources (called on app startup)
 */
export async function cleanupOrphanedProxy(): Promise<void> {
  // Stop any leftover Squid container from a previous session
  const running = await isContainerRunning(SQUID_CONTAINER_NAME)
  if (running) {
    devLog('[NetworkProxy] Cleaning up orphaned Squid container')
    await dockerExec(['rm', '-f', SQUID_CONTAINER_NAME])
  }

  // Clean up orphaned networks (only if no containers are using them)
  for (const net of [INTERNAL_NETWORK, EXTERNAL_NETWORK]) {
    if (await networkExists(net)) {
      const rmResult = await dockerExec(['network', 'rm', net])
      if (rmResult.success) {
        devLog(`[NetworkProxy] Removed orphaned network: ${net}`)
      }
      // Ignore errors - network may have active containers
    }
  }
}
