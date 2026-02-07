/**
 * Tool Auth Checker
 *
 * Generic periodic auth checker for any proxied tool with an `authCheck` config.
 * Checks auth status by running the configured command and mapping exit codes:
 *   0 = valid, 1 = needs reauth, anything else = error
 *
 * Pushes status updates to the renderer via IPC.
 */

import { BrowserWindow } from 'electron'
import { logger } from './logger'
import { loadSettings, type ProxiedTool } from './settings-manager'
import { spawnWithPath } from './exec-utils'

export interface ToolAuthStatus {
  toolId: string
  toolName: string
  state: 'valid' | 'needs-reauth' | 'error'
  reauthHint?: string
  message?: string
}

let mainWindow: BrowserWindow | null = null
let checkInterval: ReturnType<typeof setInterval> | null = null
let initialCheckTimeout: ReturnType<typeof setTimeout> | null = null
let currentStatuses: ToolAuthStatus[] = []

/**
 * Set the main window reference for pushing status updates
 */
export function setAuthCheckerWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

/**
 * Check auth for a single proxied tool
 */
export async function checkToolAuth(tool: ProxiedTool): Promise<ToolAuthStatus> {
  if (!tool.authCheck) {
    return { toolId: tool.id, toolName: tool.name, state: 'valid' }
  }

  const [command, ...args] = tool.authCheck.command

  return new Promise((resolve) => {
    try {
      const proc = spawnWithPath(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        timeout: 10000,
      })

      let stderr = ''
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ toolId: tool.id, toolName: tool.name, state: 'valid' })
        } else if (code === 1) {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            state: 'needs-reauth',
            reauthHint: tool.authCheck!.reauthHint,
          })
        } else {
          resolve({
            toolId: tool.id,
            toolName: tool.name,
            state: 'error',
            message: stderr.trim() || `Auth check exited with code ${code}`,
          })
        }
      })

      proc.on('error', (err) => {
        resolve({
          toolId: tool.id,
          toolName: tool.name,
          state: 'error',
          message: err.message,
        })
      })
    } catch (err) {
      resolve({
        toolId: tool.id,
        toolName: tool.name,
        state: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  })
}

/**
 * Check auth for all enabled proxied tools that have authCheck configured
 */
export async function checkAllToolAuth(): Promise<ToolAuthStatus[]> {
  const settings = await loadSettings()
  const toolsWithAuth = settings.docker.proxiedTools.filter(
    t => t.enabled && t.authCheck
  )

  if (toolsWithAuth.length === 0) {
    currentStatuses = []
    pushStatusToRenderer()
    return []
  }

  const statuses = await Promise.all(toolsWithAuth.map(checkToolAuth))
  currentStatuses = statuses
  pushStatusToRenderer()

  // Log any tools needing reauth
  for (const status of statuses) {
    if (status.state === 'needs-reauth') {
      logger.info('proxy', `${status.toolName}: needs re-authentication`)
    } else if (status.state === 'error') {
      logger.warn('proxy', `${status.toolName}: auth check error - ${status.message}`)
    }
  }

  return statuses
}

/**
 * Get current auth statuses (cached from last check)
 */
export function getToolAuthStatuses(): ToolAuthStatus[] {
  return [...currentStatuses]
}

/**
 * Push current statuses to renderer via IPC
 */
function pushStatusToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tool-auth-status', currentStatuses)
  }
}

/**
 * Start periodic auth checks
 * Initial check after 3s, then every 5 minutes
 */
export function startToolAuthChecks(): void {
  stopToolAuthChecks()

  // Initial check after 3 seconds
  initialCheckTimeout = setTimeout(() => {
    checkAllToolAuth().catch(err => {
      logger.error('proxy', `Initial check failed: ${err}`)
    })
  }, 3000)

  // Periodic checks every 5 minutes
  checkInterval = setInterval(() => {
    checkAllToolAuth().catch(err => {
      logger.error('proxy', `Periodic check failed: ${err}`)
    })
  }, 5 * 60 * 1000)
}

/**
 * Stop periodic auth checks
 */
export function stopToolAuthChecks(): void {
  if (initialCheckTimeout) {
    clearTimeout(initialCheckTimeout)
    initialCheckTimeout = null
  }
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
