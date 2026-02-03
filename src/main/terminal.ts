import * as pty from 'node-pty'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { getWorkspaceById, saveWorkspace } from './config'
import { getInstanceId } from './socket-server'

/**
 * Check if a Claude session exists with content.
 * Claude stores sessions in ~/.claude/projects/<project-path-hash>/<session-id>.jsonl
 */
function claudeSessionExists(sessionId: string): boolean {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(claudeDir)) return false

  // Look through project directories for the session file
  try {
    const projectDirs = fs.readdirSync(claudeDir)
    for (const dir of projectDirs) {
      const sessionFile = path.join(claudeDir, dir, `${sessionId}.jsonl`)
      if (fs.existsSync(sessionFile)) {
        // Check if file has content (not just empty)
        const stats = fs.statSync(sessionFile)
        return stats.size > 0
      }
    }
  } catch {
    // If we can't read the directory, assume session doesn't exist
    return false
  }
  return false
}

interface TerminalProcess {
  pty: pty.IPty
  workspaceId: string
  emitter: EventEmitter
}

const terminals: Map<string, TerminalProcess> = new Map()

export function createTerminal(
  workspaceId: string,
  mainWindow: BrowserWindow | null,
  initialPrompt?: string,
  claudeFlags?: string,
  autoAcceptMode?: boolean
): string {
  const workspace = getWorkspaceById(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }

  const terminalId = `terminal-${workspaceId}-${Date.now()}`
  const shell = process.env.SHELL || '/bin/zsh'

  // Validate directory exists, fall back to home if not
  let cwd = workspace.directory
  if (!fs.existsSync(cwd)) {
    console.warn(`Directory ${cwd} does not exist, using home directory`)
    cwd = os.homedir()
  }

  // Get or generate session ID for Claude session persistence
  let sessionId = workspace.sessionId
  let claudeCmd: string

  if (sessionId && claudeSessionExists(sessionId)) {
    // Session exists with content - resume it
    // Put flags BEFORE --resume so prompt isn't confused with flag arguments
    claudeCmd = `claude`
    if (claudeFlags) {
      claudeCmd += ` ${claudeFlags}`
    }
    claudeCmd += ` --resume ${sessionId}`
  } else {
    // No session or empty session - generate ID and start new session
    if (!sessionId) {
      sessionId = crypto.randomUUID()
      saveWorkspace({ ...workspace, sessionId })
    }
    // Put flags BEFORE --session-id so prompt isn't confused with flag arguments
    claudeCmd = `claude`
    if (claudeFlags) {
      claudeCmd += ` ${claudeFlags}`
    }
    claudeCmd += ` --session-id ${sessionId}`
  }

  // If an initial prompt is provided, append it to the command
  // Claude will process this prompt automatically when it starts
  if (initialPrompt) {
    // Escape single quotes in the prompt and wrap in single quotes
    const escapedPrompt = initialPrompt.replace(/'/g, "'\\''")
    claudeCmd += ` '${escapedPrompt}'`
  }
  claudeCmd += '\n'

  // Spawn interactive shell
  const ptyProcess = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      BISMARCK_WORKSPACE_ID: workspaceId,
      BISMARCK_INSTANCE_ID: getInstanceId(),
      // Help Claude find its own executable for subagent spawning
      CLAUDE_CODE_ENTRY_POINT: process.env.CLAUDE_CODE_ENTRY_POINT || 'claude',
    },
  })

  // Create emitter for terminal output listening
  const emitter = new EventEmitter()

  terminals.set(terminalId, {
    pty: ptyProcess,
    workspaceId,
    emitter,
  })

  // Forward data to renderer and emit for listeners
  ptyProcess.onData((data) => {
    emitter.emit('data', data)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', terminalId, data)
    }
  })

  // Detect /clear command and clear session ID so next open starts fresh
  // Claude outputs "(no content)" after /clear completes
  ptyProcess.onData((data) => {
    if (data.includes('(no content)')) {
      const currentWorkspace = getWorkspaceById(workspaceId)
      if (currentWorkspace?.sessionId) {
        saveWorkspace({ ...currentWorkspace, sessionId: undefined })
        console.log(`[Terminal] Cleared session ID for workspace ${workspaceId} after /clear`)
      }
    }
  })

  // Auto-accept workspace trust prompts for .bismarck directories
  // This handles both the main terminal and subagents spawned by Claude's Task tool
  // The prompt shows "Yes, I trust this folder" as option 1
  // Buffer data to handle prompts that arrive across multiple chunks
  let trustPromptBuffer = ''
  let trustPromptDebounce = false
  let trustBufferClearTimeout: NodeJS.Timeout | null = null

  ptyProcess.onData((data) => {
    // Accumulate data for trust prompt detection
    trustPromptBuffer += data

    // Clear buffer after 2 seconds of inactivity to avoid stale matches
    if (trustBufferClearTimeout) clearTimeout(trustBufferClearTimeout)
    trustBufferClearTimeout = setTimeout(() => {
      trustPromptBuffer = ''
    }, 2000)

    // Check for the trust prompt in accumulated buffer (matches both .bismarck and .bismarck-dev)
    if (trustPromptBuffer.includes('Yes, I trust this folder') && (trustPromptBuffer.includes('.bismarck') || trustPromptBuffer.includes('.bismarck-dev'))) {
      if (trustPromptDebounce) return
      trustPromptDebounce = true
      trustPromptBuffer = '' // Clear buffer once matched
      console.log(`[Terminal] Auto-accepting workspace trust prompt for bismarck directory`)
      // Send '1' to select "Yes, I trust this folder" after a short delay
      setTimeout(() => {
        ptyProcess.write('1\r')
        trustPromptDebounce = false
      }, 200)
    }
  })

  // Auto-cycle to "accept edits on" mode for task agents
  // Shift+Tab cycles through accept modes until we see the desired state
  if (autoAcceptMode) {
    let acceptModeAttempts = 0
    const MAX_ACCEPT_MODE_ATTEMPTS = 5
    let acceptModeDebounce = false
    let acceptModeDone = false

    ptyProcess.onData((data) => {
      if (acceptModeDone) return

      // Already in accept mode - stop listening
      if (data.includes('accept edits on')) {
        console.log(`[Terminal] Task agent in auto-accept mode`)
        acceptModeDone = true
        return
      }

      // Claude is ready (showing status line) but not in accept mode yet
      // Look for the mode indicator without "accept edits on"
      if (data.includes('⏵') && !data.includes('accept edits on')) {
        if (acceptModeDebounce) return
        if (acceptModeAttempts >= MAX_ACCEPT_MODE_ATTEMPTS) {
          console.log(`[Terminal] Max accept mode attempts reached`)
          acceptModeDone = true
          return
        }

        acceptModeDebounce = true
        acceptModeAttempts++
        console.log(`[Terminal] Cycling accept mode (attempt ${acceptModeAttempts})`)

        setTimeout(() => {
          ptyProcess.write('\x1b[Z') // Shift+Tab
          acceptModeDebounce = false
        }, 300)
      }
    })
  }

  // Auto-start claude when shell prompt is detected (instead of fixed delay)
  // This ensures asdf and other shell initialization is complete
  let promptDetected = false
  const promptHandler = (data: string) => {
    // Detect common shell prompts (ends with $, %, >, or contains username@hostname)
    if (!promptDetected && (
      /[$%>]\s*$/.test(data) ||
      /\w+@\w+/.test(data) ||
      data.includes(os.userInfo().username)
    )) {
      promptDetected = true
      // Small additional delay to ensure shell is fully ready
      setTimeout(() => {
        ptyProcess.write(claudeCmd)
      }, 100)
    }
  }
  ptyProcess.onData(promptHandler)

  // Fallback: if no prompt detected after 3 seconds, send anyway
  setTimeout(() => {
    if (!promptDetected) {
      promptDetected = true
      ptyProcess.write(claudeCmd)
    }
  }, 3000)

  // Handle process exit
  ptyProcess.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', terminalId, exitCode)
    }
    terminals.delete(terminalId)
  })

  return terminalId
}

export function writeTerminal(terminalId: string, data: string): void {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    terminal.pty.write(data)
  }
}

export function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): void {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    terminal.pty.resize(cols, rows)
  }
}

export function closeTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    terminal.pty.kill()
    terminals.delete(terminalId)
  }
}

export function closeAllTerminals(): void {
  for (const [id] of terminals) {
    closeTerminal(id)
  }
}

export function getTerminalWorkspaceId(terminalId: string): string | undefined {
  return terminals.get(terminalId)?.workspaceId
}

export function getActiveTerminalIds(): string[] {
  return Array.from(terminals.keys())
}

/**
 * Get terminal ID for a workspace
 */
export function getTerminalForWorkspace(workspaceId: string): string | undefined {
  console.log(`[Terminal] Looking for workspace ${workspaceId} in terminals:`, Array.from(terminals.entries()).map(([id, t]) => ({ id, workspaceId: t.workspaceId })))
  for (const [terminalId, terminal] of terminals) {
    if (terminal.workspaceId === workspaceId) {
      return terminalId
    }
  }
  return undefined
}

/**
 * Get terminal emitter for listening to output
 */
export function getTerminalEmitter(terminalId: string): EventEmitter | undefined {
  return terminals.get(terminalId)?.emitter
}

/**
 * Inject text into a terminal (for task assignment prompts)
 * Types text character-by-character to simulate actual typing and avoid bracketed paste mode
 */
export async function injectTextToTerminal(terminalId: string, text: string): Promise<void> {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    // Type character-by-character with small delays to simulate actual typing
    // This bypasses bracketed paste detection which triggers on rapid bulk input
    await typeTextToTerminal(terminal.pty, text)
  }
}

/**
 * Type text character-by-character to simulate actual keyboard typing
 * This avoids triggering bracketed paste mode detection
 */
async function typeTextToTerminal(ptyProcess: pty.IPty, text: string, delayMs: number = 5): Promise<void> {
  for (const char of text) {
    ptyProcess.write(char)
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}

/**
 * Inject a prompt into terminal using bulk write (for Claude Code prompts)
 * Handles paste detection by waiting for the paste preview before sending Enter
 */
export async function injectPromptToTerminal(terminalId: string, prompt: string): Promise<void> {
  const terminal = terminals.get(terminalId)
  if (!terminal) return

  // Send entire prompt at once (will trigger paste detection for multi-line)
  terminal.pty.write(prompt)

  // Wait for paste detection to process and show preview
  // Claude shows "[Pasted text #N +X lines]" when paste is detected
  // We need to wait for this, then send Enter to confirm
  const pasteDetected = await waitForOutput(terminal.emitter, 'Pasted text', 2000)

  if (pasteDetected) {
    // Paste was detected, wait a moment then send Enter to confirm
    await new Promise(resolve => setTimeout(resolve, 100))
    terminal.pty.write('\r')
  } else {
    // No paste detection (short prompt), just send Enter
    await new Promise(resolve => setTimeout(resolve, 50))
    terminal.pty.write('\r')
  }
}

/**
 * Helper to wait for specific output pattern from terminal emitter
 */
function waitForOutput(emitter: EventEmitter, pattern: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      emitter.removeListener('data', handler)
      resolve(false)
    }, timeoutMs)

    const handler = (data: string) => {
      if (data.includes(pattern)) {
        clearTimeout(timer)
        emitter.removeListener('data', handler)
        resolve(true)
      }
    }

    emitter.on('data', handler)
  })
}

/**
 * Wait for terminal output matching a pattern
 * Returns true if pattern matched, false if timeout
 */
/**
 * Send /exit command to a terminal to trigger graceful shutdown
 * Used to programmatically exit Claude sessions when work is detected as complete
 */
export function sendExitToTerminal(terminalId: string): void {
  const terminal = terminals.get(terminalId)
  if (terminal) {
    terminal.pty.write('/exit\r')
  }
}

export function waitForTerminalOutput(
  terminalId: string,
  pattern: string | RegExp,
  timeoutMs: number = 5000
): Promise<boolean> {
  return new Promise((resolve) => {
    const terminal = terminals.get(terminalId)
    if (!terminal) {
      resolve(false)
      return
    }

    const timer = setTimeout(() => {
      terminal.emitter.removeListener('data', handler)
      resolve(false)
    }, timeoutMs)

    const handler = (data: string) => {
      const matches = typeof pattern === 'string'
        ? data.includes(pattern)
        : pattern.test(data)
      if (matches) {
        clearTimeout(timer)
        terminal.emitter.removeListener('data', handler)
        resolve(true)
      }
    }

    terminal.emitter.on('data', handler)
  })
}
