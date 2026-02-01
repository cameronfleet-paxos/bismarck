/**
 * Centralized queue for terminal creation with concurrency limiting.
 * Prevents posix_spawnp failures that occur when too many PTYs are spawned rapidly.
 */

import { BrowserWindow } from 'electron'
import { createTerminal } from './terminal'
import { createSocketServer } from './socket-server'
import { addActiveWorkspace, getOrCreateTabForWorkspace, addWorkspaceToTab, setActiveTab } from './state-manager'

const SPAWN_CONCURRENCY = 10
const SPAWN_DELAY_MS = 100

interface QueuedTerminal {
  workspaceId: string
  mainWindow: BrowserWindow | null
  options?: {
    initialPrompt?: string
    claudeFlags?: string
    autoAcceptMode?: boolean
  }
  resolve: (terminalId: string) => void
  reject: (error: Error) => void
}

const queue: QueuedTerminal[] = []
let activeSpawns = 0
let isProcessing = false
let mainWindowRef: BrowserWindow | null = null

/**
 * Set the main window reference for emitting queue status updates
 */
export function setQueueMainWindow(window: BrowserWindow | null): void {
  mainWindowRef = window
}

/**
 * Emit queue status to renderer
 */
function emitQueueStatus(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('terminal-queue-status', {
      queued: queue.length,
      active: activeSpawns,
      pending: queue.map(q => q.workspaceId),
    })
  }
}

/**
 * Process the queue, spawning terminals up to the concurrency limit
 */
async function processQueue(): Promise<void> {
  if (isProcessing) return
  isProcessing = true

  try {
    while (queue.length > 0 && activeSpawns < SPAWN_CONCURRENCY) {
      const item = queue.shift()
      if (!item) break

      activeSpawns++
      emitQueueStatus()

      // Spawn terminal asynchronously
      spawnTerminal(item).finally(() => {
        activeSpawns--
        emitQueueStatus()

        // Continue processing after delay
        if (queue.length > 0) {
          setTimeout(() => processQueue(), SPAWN_DELAY_MS)
        }
      })

      // Small delay between spawns to avoid overwhelming the system
      if (queue.length > 0 && activeSpawns < SPAWN_CONCURRENCY) {
        await new Promise(resolve => setTimeout(resolve, SPAWN_DELAY_MS))
      }
    }
  } finally {
    isProcessing = false
  }
}

/**
 * Spawn a single terminal
 */
async function spawnTerminal(item: QueuedTerminal): Promise<void> {
  try {
    const terminalId = createTerminal(
      item.workspaceId,
      item.mainWindow,
      item.options?.initialPrompt,
      item.options?.claudeFlags,
      item.options?.autoAcceptMode
    )
    item.resolve(terminalId)
  } catch (error) {
    console.error(`[TerminalQueue] Failed to spawn terminal for ${item.workspaceId}:`, error)
    item.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Queue a terminal creation request.
 * Returns a promise that resolves with the terminal ID when the terminal is created.
 */
export function queueTerminalCreation(
  workspaceId: string,
  mainWindow: BrowserWindow | null,
  options?: {
    initialPrompt?: string
    claudeFlags?: string
    autoAcceptMode?: boolean
  }
): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push({
      workspaceId,
      mainWindow,
      options,
      resolve,
      reject,
    })

    emitQueueStatus()
    processQueue()
  })
}

/**
 * Queue terminal creation with full workspace setup (socket server, tab placement).
 * This is the replacement for the direct createTerminal call in the create-terminal IPC handler.
 */
export async function queueTerminalCreationWithSetup(
  workspaceId: string,
  mainWindow: BrowserWindow | null
): Promise<string> {
  // Create socket server for this workspace
  createSocketServer(workspaceId)

  // Add to active workspaces
  addActiveWorkspace(workspaceId)

  // Auto-place workspace in a tab with space (or create new tab)
  const tab = getOrCreateTabForWorkspace(workspaceId)
  addWorkspaceToTab(workspaceId, tab.id)
  setActiveTab(tab.id)

  // Queue the terminal creation
  return queueTerminalCreation(workspaceId, mainWindow)
}

/**
 * Get current queue status
 */
export function getQueueStatus(): { queued: number; active: number; pending: string[] } {
  return {
    queued: queue.length,
    active: activeSpawns,
    pending: queue.map(q => q.workspaceId),
  }
}

/**
 * Clear all pending items from the queue (for cleanup)
 */
export function clearQueue(): void {
  while (queue.length > 0) {
    const item = queue.shift()
    if (item) {
      item.reject(new Error('Queue cleared'))
    }
  }
  emitQueueStatus()
}
