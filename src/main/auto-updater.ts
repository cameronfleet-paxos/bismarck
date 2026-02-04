/**
 * Auto-Updater Module
 *
 * Handles automatic updates using electron-updater with GitHub Releases.
 * Users can toggle auto-updates in Settings, and a non-intrusive notification
 * banner prompts them to restart when updates are downloaded.
 */

import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater'
import { loadSettings, updateSettings } from './settings-manager'

// Update status that gets sent to renderer
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; progress: number }
  | { state: 'downloaded'; version: string }
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status)
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
 * Initialize the auto-updater
 * Sets up event handlers and IPC communication
 */
export function initAutoUpdater(): void {
  // Skip in development mode
  if (isDevelopment()) {
    console.log('[AutoUpdater] Skipping initialization in development mode')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false // We'll handle downloads manually
  autoUpdater.autoInstallOnAppQuit = true

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update...')
    sendStatusToRenderer({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[AutoUpdater] Update available:', info.version)
    sendStatusToRenderer({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No update available')
    sendStatusToRenderer({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    console.log('[AutoUpdater] Download progress:', Math.round(progress.percent), '%')
    sendStatusToRenderer({ state: 'downloading', progress: progress.percent })
  })

  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    console.log('[AutoUpdater] Update downloaded:', event.version)
    sendStatusToRenderer({ state: 'downloaded', version: event.version })
  })

  autoUpdater.on('error', (error: Error) => {
    console.error('[AutoUpdater] Error:', error.message)
    sendStatusToRenderer({ state: 'error', message: error.message })
  })

  // Register IPC handlers
  registerIpcHandlers()

  console.log('[AutoUpdater] Initialized')
}

/**
 * Register IPC handlers for renderer communication
 */
function registerIpcHandlers(): void {
  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    if (isDevelopment()) {
      console.log('[AutoUpdater] Skipping check in development mode')
      return { state: 'not-available' }
    }
    try {
      await autoUpdater.checkForUpdates()
      return currentStatus
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { state: 'error', message }
    }
  })

  // Download update
  ipcMain.handle('download-update', async () => {
    if (isDevelopment()) {
      console.log('[AutoUpdater] Skipping download in development mode')
      return { state: 'not-available' }
    }
    try {
      await autoUpdater.downloadUpdate()
      return currentStatus
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { state: 'error', message }
    }
  })

  // Install update (quit and install)
  ipcMain.handle('install-update', () => {
    if (isDevelopment()) {
      console.log('[AutoUpdater] Skipping install in development mode')
      return
    }
    autoUpdater.quitAndInstall(false, true)
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
}

/**
 * Check for updates on launch (with delay)
 * Only checks if auto-check is enabled in settings
 */
export async function checkForUpdatesOnLaunch(): Promise<void> {
  if (isDevelopment()) {
    console.log('[AutoUpdater] Skipping launch check in development mode')
    return
  }

  const settings = await loadSettings()
  if (!settings.updates.autoCheck) {
    console.log('[AutoUpdater] Auto-check disabled, skipping launch check')
    return
  }

  // Wait before checking
  setTimeout(async () => {
    try {
      console.log('[AutoUpdater] Performing launch check...')
      await autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[AutoUpdater] Launch check failed:', error)
    }
  }, LAUNCH_CHECK_DELAY_MS)
}

/**
 * Start periodic update checks
 */
export function startPeriodicChecks(): void {
  if (isDevelopment()) {
    console.log('[AutoUpdater] Skipping periodic checks in development mode')
    return
  }

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
      await autoUpdater.checkForUpdates()
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
