/**
 * Standalone Terminal
 *
 * Manages standalone terminals (plain shell, no Claude) that occupy workspace grid slots.
 * Created via CMD-K "Add Terminal" command.
 */

import * as os from 'os'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { devLog } from './dev-log'
import {
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
} from './config'
import {
  getOrCreateTabForWorkspaceWithPreference,
  addWorkspaceToTab,
  setActiveTab,
  addActiveWorkspace,
  removeActiveWorkspace,
  removeWorkspaceFromTab,
} from './state-manager'
import { createPlainTerminal, closeTerminal, getTerminalForWorkspace } from './terminal'
import type { Agent, ThemeName } from '../shared/types'

// Word lists for fun random names (shared style with standalone-headless)
const ADJECTIVES = [
  'fluffy', 'happy', 'brave', 'swift', 'clever', 'gentle', 'mighty', 'calm',
  'wild', 'eager', 'jolly', 'lucky', 'plucky', 'zesty', 'snappy', 'peppy'
]

const NOUNS = [
  'bunny', 'panda', 'koala', 'otter', 'falcon', 'dolphin', 'fox', 'owl',
  'tiger', 'eagle', 'wolf', 'bear', 'hawk', 'lynx', 'raven', 'seal'
]

const THEMES: ThemeName[] = ['gray', 'teal', 'blue', 'green', 'purple', 'orange', 'pink', 'red', 'brown']

function generateRandomPhrase(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective}-${noun}`
}

let mainWindow: BrowserWindow | null = null

export function setMainWindowForStandaloneTerminal(window: BrowserWindow | null): void {
  mainWindow = window
}

function emitStateUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const { getState } = require('./state-manager')
    mainWindow.webContents.send('state-update', getState())
  }
}

/**
 * Create a standalone terminal workspace and spawn a plain shell.
 * Returns { workspaceId, terminalId, tabId }
 */
export function createStandaloneTerminal(
  targetTabId?: string,
  directory?: string
): { workspaceId: string; terminalId: string; tabId: string } {
  const workspaceId = randomUUID()
  const phrase = generateRandomPhrase()
  const cwd = directory || os.homedir()
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)]

  const existingWorkspaces = getWorkspaces()
  const newAgent: Agent = {
    id: workspaceId,
    name: `terminal: ${phrase}`,
    directory: cwd,
    purpose: 'Plain shell terminal',
    theme,
    icon: getRandomUniqueIcon(existingWorkspaces),
    isStandaloneTerminal: true,
  }

  // Save the workspace
  saveWorkspace(newAgent)

  // Add to active workspaces and place in grid
  addActiveWorkspace(workspaceId)
  const tab = getOrCreateTabForWorkspaceWithPreference(workspaceId, targetTabId)
  addWorkspaceToTab(workspaceId, tab.id)
  setActiveTab(tab.id)

  // Spawn the plain shell terminal
  const terminalId = createPlainTerminal(workspaceId, mainWindow, cwd)

  devLog(`[StandaloneTerminal] Created terminal: ${phrase} (${workspaceId}) in tab ${tab.id}`)

  // Emit state update so renderer picks up the new workspace
  emitStateUpdate()

  // Notify renderer of the new terminal
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('terminal-created', { terminalId, workspaceId })
  }

  return { workspaceId, terminalId, tabId: tab.id }
}

/**
 * Close and clean up a standalone terminal.
 */
export function closeStandaloneTerminal(workspaceId: string): void {
  // Close the PTY terminal if running
  const terminalId = getTerminalForWorkspace(workspaceId)
  if (terminalId) {
    closeTerminal(terminalId)
  }

  // Remove from grid and active workspaces
  removeWorkspaceFromTab(workspaceId)
  removeActiveWorkspace(workspaceId)

  // Delete the workspace entry
  deleteWorkspace(workspaceId)

  devLog(`[StandaloneTerminal] Closed terminal: ${workspaceId}`)

  // Emit state update
  emitStateUpdate()
}
