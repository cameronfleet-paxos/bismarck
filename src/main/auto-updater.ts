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

// GitHub repository info
const GITHUB_OWNER = 'cameronfleet-paxos'
const GITHUB_REPO = 'bismarck'

// Update status that gets sent to renderer
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseUrl: string }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string }

let mainWindow: BrowserWindow | null = null
let periodicCheckInterval: NodeJS.Timeout | null = null
let currentStatus: UpdateStatus = { state: 'idle' }

// Check interval: 4 hours
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

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
  console.log('[AutoUpdater] sendStatusToRenderer:', status.state, 'mainWindow:', !!mainWindow)
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('[AutoUpdater] Sending update-status IPC to renderer')
    mainWindow.webContents.send('update-status', status)
  } else {
    console.log('[AutoUpdater] WARNING: mainWindow not available, cannot send status')
  }
}

/**
 * Get the current app version
 */
export function getAppVersion(): string {
  return app.getVersion()
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
 * Fetch the latest release from GitHub API
 */
async function fetchLatestRelease(): Promise<{ version: string; releaseUrl: string } | null> {
  console.log('[AutoUpdater] fetchLatestRelease: starting request to GitHub API')
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': `Bismarck/${getAppVersion()}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    console.log('[AutoUpdater] fetchLatestRelease: request options:', JSON.stringify(options))

    const req = https.request(options, (res) => {
      console.log('[AutoUpdater] fetchLatestRelease: response status:', res.statusCode)
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        console.log('[AutoUpdater] fetchLatestRelease: response complete, length:', data.length)
        if (res.statusCode === 404) {
          // No releases yet
          console.log('[AutoUpdater] fetchLatestRelease: 404 - no releases found')
          resolve(null)
          return
        }

        if (res.statusCode !== 200) {
          console.log('[AutoUpdater] fetchLatestRelease: non-200 status, body:', data.substring(0, 200))
          reject(new Error(`GitHub API returned status ${res.statusCode}`))
          return
        }

        try {
          const release = JSON.parse(data)
          console.log('[AutoUpdater] fetchLatestRelease: parsed release tag_name:', release.tag_name)
          resolve({
            version: release.tag_name,
            releaseUrl: release.html_url
          })
        } catch (e) {
          console.log('[AutoUpdater] fetchLatestRelease: failed to parse JSON:', data.substring(0, 200))
          reject(new Error('Failed to parse GitHub response'))
        }
      })
    })

    req.on('error', (e) => {
      console.log('[AutoUpdater] fetchLatestRelease: request error:', e.message)
      reject(e)
    })

    req.setTimeout(10000, () => {
      console.log('[AutoUpdater] fetchLatestRelease: request timed out')
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
  console.log('[AutoUpdater] Checking for updates...')
  sendStatusToRenderer({ state: 'checking' })

  try {
    const latestRelease = await fetchLatestRelease()

    if (!latestRelease) {
      console.log('[AutoUpdater] No releases found')
      const status: UpdateStatus = { state: 'up-to-date' }
      sendStatusToRenderer(status)
      return status
    }

    const currentVersion = getAppVersion()
    const latestVersion = latestRelease.version.replace(/^v/, '')

    console.log(`[AutoUpdater] Current: v${currentVersion}, Latest: v${latestVersion}`)

    if (compareVersions(latestVersion, currentVersion) > 0) {
      console.log('[AutoUpdater] Update available:', latestVersion)
      const status: UpdateStatus = {
        state: 'available',
        version: latestVersion,
        releaseUrl: latestRelease.releaseUrl
      }
      sendStatusToRenderer(status)
      return status
    } else {
      console.log('[AutoUpdater] Already up to date')
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
    console.log('[AutoUpdater] Running in development mode')
  }

  console.log('[AutoUpdater] Initialized')
}

/**
 * Register IPC handlers for renderer communication
 */
function registerIpcHandlers(): void {
  // Handle renderer-ready signal to re-send current status
  // This fixes the race condition where the renderer mounts after the launch check completes
  ipcMain.on('renderer-ready', () => {
    console.log('[AutoUpdater] Received renderer-ready signal, currentStatus:', currentStatus.state)
    if (currentStatus.state !== 'idle') {
      console.log('[AutoUpdater] Re-sending current status to renderer')
      sendStatusToRenderer(currentStatus)
    } else {
      console.log('[AutoUpdater] Status is idle, not re-sending')
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
}

/**
 * Check for updates on launch (with delay)
 * Only checks if auto-check is enabled in settings
 */
export async function checkForUpdatesOnLaunch(): Promise<void> {
  console.log('[AutoUpdater] checkForUpdatesOnLaunch called')
  const settings = await loadSettings()
  console.log('[AutoUpdater] settings.updates.autoCheck:', settings.updates.autoCheck)
  if (!settings.updates.autoCheck) {
    console.log('[AutoUpdater] Auto-check disabled, skipping launch check')
    return
  }

  console.log(`[AutoUpdater] Scheduling launch check in ${LAUNCH_CHECK_DELAY_MS}ms`)
  // Wait before checking
  setTimeout(async () => {
    try {
      console.log('[AutoUpdater] Performing launch check...')
      await checkForUpdates()
      console.log('[AutoUpdater] Launch check completed, currentStatus:', currentStatus.state)
    } catch (error) {
      console.error('[AutoUpdater] Launch check failed:', error)
    }
  }, LAUNCH_CHECK_DELAY_MS)
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
      console.log('[AutoUpdater] Performing periodic check...')
      await checkForUpdates()
    } catch (error) {
      console.error('[AutoUpdater] Periodic check failed:', error)
    }
  }, CHECK_INTERVAL_MS)

  console.log('[AutoUpdater] Periodic checks started')
}

/**
 * Stop periodic update checks
 */
export function stopPeriodicChecks(): void {
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval)
    periodicCheckInterval = null
    console.log('[AutoUpdater] Periodic checks stopped')
  }
}
