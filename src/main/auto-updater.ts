/**
 * Auto-Updater Module
 *
 * Checks for updates using the GitHub Releases API and notifies users
 * when a new version is available. Users manually install updates via
 * the one-line curl command.
 */

import { app, ipcMain, BrowserWindow, clipboard } from 'electron'
import { loadSettings, updateSettings } from './settings-manager'
import * as https from 'https'
import * as crypto from 'crypto'
import * as fs from 'fs'
import { devLog } from './dev-log'

// GitHub repository info
const GITHUB_OWNER = 'cameronfleet-paxos'
const GITHUB_REPO = 'bismarck'

// Update status that gets sent to renderer
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseUrl: string; currentVersion: string; significantlyOutdated: boolean; sha256: string | null }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string }

let mainWindow: BrowserWindow | null = null
let periodicCheckInterval: NodeJS.Timeout | null = null
let currentStatus: UpdateStatus = { state: 'idle' }

// Dev-only: override the reported app version to test update flows
let devVersionOverride: string | null = null

// Check interval: 10 minutes
const CHECK_INTERVAL_MS = 10 * 60 * 1000

// Delay before first check on launch: 5 seconds
const LAUNCH_CHECK_DELAY_MS = 5000

/**
 * Set the main window reference for IPC communication
 */
export function setAutoUpdaterWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

/**
 * Send update status to renderer
 */
function sendStatusToRenderer(status: UpdateStatus): void {
  currentStatus = status
  devLog('[AutoUpdater] sendStatusToRenderer:', status.state, 'mainWindow:', !!mainWindow)
  if (mainWindow && !mainWindow.isDestroyed()) {
    devLog('[AutoUpdater] Sending update-status IPC to renderer')
    mainWindow.webContents.send('update-status', status)
  } else {
    devLog('[AutoUpdater] WARNING: mainWindow not available, cannot send status')
  }
}

/**
 * Get the current app version
 */
export function getAppVersion(): string {
  return devVersionOverride ?? app.getVersion()
}

/**
 * Check if we're in development mode
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

/**
 * Compare two semver versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  // Remove leading 'v' if present
  const clean1 = v1.replace(/^v/, '')
  const clean2 = v2.replace(/^v/, '')

  const parts1 = clean1.split('.').map(Number)
  const parts2 = clean2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }
  return 0
}

/**
 * Check if the version is significantly outdated (more than 1 minor or major version behind)
 * Returns true if the user should be prompted to update
 */
function isSignificantlyOutdated(currentVersion: string, latestVersion: string): boolean {
  const clean1 = currentVersion.replace(/^v/, '')
  const clean2 = latestVersion.replace(/^v/, '')

  const parts1 = clean1.split('.').map(Number)
  const parts2 = clean2.split('.').map(Number)

  const majorDiff = (parts2[0] || 0) - (parts1[0] || 0)
  const minorDiff = (parts2[1] || 0) - (parts1[1] || 0)

  // Significantly outdated if: major version behind OR more than 1 minor version behind
  return majorDiff > 0 || minorDiff > 1
}

/**
 * Extract SHA-256 checksum from a release body.
 * Looks for the pattern: **SHA-256:** `<hex>`
 */
function extractChecksumFromBody(body: string): string | null {
  const match = body.match(/\*\*SHA-256:\*\*\s*`([a-f0-9]{64})`/i)
  return match ? match[1] : null
}

/**
 * Verify the SHA-256 checksum of a downloaded file
 */
function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const fileBuffer = fs.readFileSync(filePath)
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  devLog(`[AutoUpdater] Checksum verification: expected=${expectedChecksum}, actual=${hash}`)
  return hash === expectedChecksum
}

/**
 * Fetch the latest release from GitHub API
 */
async function fetchLatestRelease(): Promise<{ version: string; releaseUrl: string; sha256: string | null } | null> {
  devLog('[AutoUpdater] fetchLatestRelease: starting request to GitHub API')
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': `Bismarck/${getAppVersion()}`,
        'Accept': 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache'
      }
    }

    devLog('[AutoUpdater] fetchLatestRelease: request options:', JSON.stringify(options))

    const req = https.request(options, (res) => {
      devLog('[AutoUpdater] fetchLatestRelease: response status:', res.statusCode)
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        devLog('[AutoUpdater] fetchLatestRelease: response complete, length:', data.length)
        if (res.statusCode === 404) {
          // No releases yet
          devLog('[AutoUpdater] fetchLatestRelease: 404 - no releases found')
          resolve(null)
          return
        }

        if (res.statusCode !== 200) {
          devLog('[AutoUpdater] fetchLatestRelease: non-200 status, body:', data.substring(0, 200))
          reject(new Error(`GitHub API returned status ${res.statusCode}`))
          return
        }

        try {
          const release = JSON.parse(data)
          devLog('[AutoUpdater] fetchLatestRelease: parsed release tag_name:', release.tag_name)
          const sha256 = extractChecksumFromBody(release.body || '')
          devLog('[AutoUpdater] fetchLatestRelease: extracted sha256:', sha256 ?? '(none)')
          resolve({
            version: release.tag_name,
            releaseUrl: release.html_url,
            sha256
          })
        } catch (e) {
          devLog('[AutoUpdater] fetchLatestRelease: failed to parse JSON:', data.substring(0, 200))
          reject(new Error('Failed to parse GitHub response'))
        }
      })
    })

    req.on('error', (e) => {
      devLog('[AutoUpdater] fetchLatestRelease: request error:', e.message)
      reject(e)
    })

    req.setTimeout(10000, () => {
      devLog('[AutoUpdater] fetchLatestRelease: request timed out')
      req.destroy()
      reject(new Error('Request timed out'))
    })

    req.end()
  })
}

/**
 * Check for updates
 */
async function checkForUpdates(): Promise<UpdateStatus> {
  devLog('[AutoUpdater] Checking for updates...')
  sendStatusToRenderer({ state: 'checking' })

  try {
    const latestRelease = await fetchLatestRelease()

    if (!latestRelease) {
      devLog('[AutoUpdater] No releases found')
      const status: UpdateStatus = { state: 'up-to-date' }
      sendStatusToRenderer(status)
      return status
    }

    const currentVersion = getAppVersion()
    const latestVersion = latestRelease.version.replace(/^v/, '')

    devLog(`[AutoUpdater] Current: v${currentVersion}, Latest: v${latestVersion}`)

    if (compareVersions(latestVersion, currentVersion) > 0) {
      const significantlyOutdated = isSignificantlyOutdated(currentVersion, latestVersion)
      // Log when the detected latest version changes (e.g. v0.6.1 -> v0.6.2)
      if (currentStatus.state === 'available' && currentStatus.version !== latestVersion) {
        devLog(`[AutoUpdater] Latest version changed: ${currentStatus.version} -> ${latestVersion}`)
      }
      devLog('[AutoUpdater] Update available:', latestVersion, significantlyOutdated ? '(significantly outdated)' : '')
      const status: UpdateStatus = {
        state: 'available',
        version: latestVersion,
        releaseUrl: latestRelease.releaseUrl,
        currentVersion,
        significantlyOutdated,
        sha256: latestRelease.sha256
      }
      sendStatusToRenderer(status)
      return status
    } else {
      devLog('[AutoUpdater] Already up to date')
      const status: UpdateStatus = { state: 'up-to-date' }
      sendStatusToRenderer(status)
      return status
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[AutoUpdater] Error checking for updates:', message)
    const status: UpdateStatus = { state: 'error', message }
    sendStatusToRenderer(status)
    return status
  }
}

/**
 * Initialize the auto-updater
 * Sets up IPC communication
 */
export function initAutoUpdater(): void {
  // Register IPC handlers (even in dev mode for testing)
  registerIpcHandlers()

  if (isDevelopment()) {
    devLog('[AutoUpdater] Running in development mode')
  }

  devLog('[AutoUpdater] Initialized')
}

/**
 * Register IPC handlers for renderer communication
 */
function registerIpcHandlers(): void {
  // Handle renderer-ready signal to re-send current status
  // This fixes the race condition where the renderer mounts after the launch check completes
  ipcMain.on('renderer-ready', () => {
    devLog('[AutoUpdater] Received renderer-ready signal, currentStatus:', currentStatus.state)
    if (currentStatus.state !== 'idle') {
      devLog('[AutoUpdater] Re-sending current status to renderer')
      sendStatusToRenderer(currentStatus)
    } else {
      devLog('[AutoUpdater] Status is idle, not re-sending')
    }
  })

  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates()
  })

  // Get current update status
  ipcMain.handle('get-update-status', () => {
    return currentStatus
  })

  // Get update settings
  ipcMain.handle('get-update-settings', async () => {
    const settings = await loadSettings()
    return settings.updates
  })

  // Set update settings
  ipcMain.handle('set-update-settings', async (_event, settingsUpdate: { autoCheck?: boolean }) => {
    // Only update if autoCheck is provided
    if (settingsUpdate.autoCheck !== undefined) {
      await updateSettings({ updates: { autoCheck: settingsUpdate.autoCheck } })
      // Start/stop periodic checks based on setting
      if (settingsUpdate.autoCheck) {
        startPeriodicChecks()
      } else {
        stopPeriodicChecks()
      }
    }
    const settings = await loadSettings()
    return settings.updates
  })

  // Get app version
  ipcMain.handle('get-app-version', () => {
    return getAppVersion()
  })

  // Copy text to clipboard
  ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
    clipboard.writeText(text)
  })

  // Note: 'open-external' is registered in main.ts, don't duplicate here

  // Dev-only: override reported version to test update flows
  ipcMain.handle('dev-set-version-override', (_event, version: string | null) => {
    devVersionOverride = version
    devLog('[AutoUpdater] Version override set to:', version ?? '(cleared)')
    return { version: version ?? app.getVersion() }
  })
}

/**
 * Check for updates on launch (with delay)
 * Only checks if auto-check is enabled in settings
 */
export async function checkForUpdatesOnLaunch(): Promise<void> {
  devLog('[AutoUpdater] checkForUpdatesOnLaunch called')
  const settings = await loadSettings()
  devLog('[AutoUpdater] settings.updates.autoCheck:', settings.updates.autoCheck)
  if (!settings.updates.autoCheck) {
    devLog('[AutoUpdater] Auto-check disabled, skipping launch check')
    return
  }

  devLog(`[AutoUpdater] Scheduling launch check in ${LAUNCH_CHECK_DELAY_MS}ms`)
  // Wait before checking - await the delay so callers know when the check is done
  await new Promise<void>((resolve) => {
    setTimeout(async () => {
      try {
        devLog('[AutoUpdater] Performing launch check...')
        await checkForUpdates()
        devLog('[AutoUpdater] Launch check completed, currentStatus:', currentStatus.state)
      } catch (error) {
        console.error('[AutoUpdater] Launch check failed:', error)
      }
      resolve()
    }, LAUNCH_CHECK_DELAY_MS)
  })
}

/**
 * Start periodic update checks
 */
export function startPeriodicChecks(): void {
  // Don't start if already running
  if (periodicCheckInterval) {
    return
  }

  periodicCheckInterval = setInterval(async () => {
    const settings = await loadSettings()
    if (!settings.updates.autoCheck) {
      stopPeriodicChecks()
      return
    }

    try {
      devLog('[AutoUpdater] Performing periodic check...')
      await checkForUpdates()
    } catch (error) {
      console.error('[AutoUpdater] Periodic check failed:', error)
    }
  }, CHECK_INTERVAL_MS)

  devLog('[AutoUpdater] Periodic checks started')
}

/**
 * Stop periodic update checks
 */
export function stopPeriodicChecks(): void {
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval)
    periodicCheckInterval = null
    devLog('[AutoUpdater] Periodic checks stopped')
  }
}
