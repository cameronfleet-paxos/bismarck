import * as pty from 'node-pty'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { getWorkspaceById, saveWorkspace, getConfigDir } from './config'
import { getInstanceId } from './socket-server'
import { startTimer, endTimer, milestone } from './startup-benchmark'
import { devLog } from './dev-log'
import { buildInteractiveDockerArgs, type InteractiveDockerOptions } from './docker-sandbox'
import { getAgentProvider } from '../shared/types'
import type { AgentProvider } from '../shared/types'
import { findBinary } from './exec-utils'

/**
 * Strip ANSI escape codes from terminal output
 * This is essential for reliable shell prompt detection since prompts
 * are often wrapped in color codes and other escape sequences
 */
function stripAnsi(str: string): string {
  // Remove all ANSI escape sequences:
  // - CSI sequences: \x1b[ followed by params and final byte
  // - OSC sequences: \x1b] followed by content and terminator
  // - Single-character escapes: \x1b followed by single char
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, '')    // OSC sequences (title, etc.) terminated by BEL
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')  // OSC sequences terminated by ST
    .replace(/\x1b[()][AB012]/g, '')       // Character set selection
    .replace(/\x1b[>=<]/g, '')             // Keypad mode changes
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')   // DEC private mode set/reset
}

// Track first agent ready for benchmark milestone
let firstAgentReadyReported = false

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

/**
 * Recursively find all .jsonl files under a directory.
 * Used for scanning Codex session storage.
 */
function findJsonlFilesRecursive(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results.push(...findJsonlFilesRecursive(fullPath))
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath)
      }
    }
  } catch {
    // Directory may not exist or be inaccessible
  }
  return results
}

/**
 * Check if a Codex session exists by its UUID.
 * Codex stores sessions in ~/.codex/sessions/ as JSONL files.
 * The first line is SessionMeta JSON containing the session UUID in the `id` field.
 */
function codexSessionExists(sessionId: string): boolean {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) return false

  const jsonlFiles = findJsonlFilesRecursive(sessionsDir)
  for (const file of jsonlFiles) {
    try {
      const firstLine = fs.readFileSync(file, 'utf-8').split('\n')[0]
      const meta = JSON.parse(firstLine)
      // Handle both bare SessionMeta and RolloutLine envelope format
      const id = meta.id || meta.payload?.id
      if (id === sessionId) return true
    } catch {
      continue
    }
  }
  return false
}

/**
 * Find the most recent Codex session for a given working directory.
 * Scans ~/.codex/sessions/ recursively, reads SessionMeta from first line of each JSONL file,
 * and matches by cwd field. Returns the session UUID or null if not found.
 */
function findCodexSessionForDirectory(directory: string): string | null {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) return null

  // Find all session files, sorted newest first
  const jsonlFiles = findJsonlFilesRecursive(sessionsDir)
    .map(file => ({ file, mtime: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(entry => entry.file)

  for (const file of jsonlFiles) {
    try {
      const firstLine = fs.readFileSync(file, 'utf-8').split('\n')[0]
      const meta = JSON.parse(firstLine)
      // Handle both bare SessionMeta and RolloutLine envelope format
      const cwd = meta.cwd || meta.payload?.cwd
      if (cwd === directory) {
        return meta.id || meta.payload?.id || null
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Build the Claude CLI command string.
 * Extracted from existing inline code — flag ordering preserved (flags before --resume/--session-id).
 */
function buildClaudeCommand(options: {
  sessionId?: string
  resume: boolean
  claudeFlags?: string
  initialPrompt?: string
}): string {
  let cmd = 'claude'
  if (options.claudeFlags) cmd += ` ${options.claudeFlags}`
  if (options.resume && options.sessionId) {
    cmd += ` --resume ${options.sessionId}`
  } else if (options.sessionId) {
    cmd += ` --session-id ${options.sessionId}`
  }
  if (options.initialPrompt) {
    const escaped = options.initialPrompt.replace(/'/g, "'\\''")
    cmd += ` '${escaped}'`
  }
  return cmd + '\n'
}

/**
 * Build the Codex CLI command string.
 * New session: codex --cd <dir> [prompt]
 * Resume: codex resume <UUID> --cd <dir>
 * Directory paths are single-quoted to handle spaces.
 */
function buildCodexCommand(options: {
  directory: string
  sessionId?: string
  resume: boolean
  initialPrompt?: string
}): string {
  if (options.resume && options.sessionId) {
    return `codex resume ${options.sessionId} --cd '${options.directory}'\n`
  }
  let cmd = `codex --cd '${options.directory}'`
  if (options.initialPrompt) {
    const escaped = options.initialPrompt.replace(/'/g, "'\\''")
    cmd += ` '${escaped}'`
  }
  return cmd + '\n'
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

  // Determine agent provider
  const provider = getAgentProvider(workspace)

  // Check if codex binary is available
  let skipCommand = false
  if (provider === 'codex') {
    const codexPath = findBinary('codex')
    if (!codexPath) {
      skipCommand = true
    }
  }

  // Build provider-specific agent command
  let agentCmd = ''

  if (provider === 'claude') {
    // Claude session management (unchanged behavior)
    let sessionId = workspace.sessionId
    let resume = false
    if (sessionId && claudeSessionExists(sessionId)) {
      resume = true
    } else if (!sessionId) {
      sessionId = crypto.randomUUID()
      saveWorkspace({ ...workspace, sessionId })
    }
    agentCmd = buildClaudeCommand({ sessionId, resume, claudeFlags, initialPrompt })
  } else if (provider === 'codex' && !skipCommand) {
    // Codex session management
    let sessionId = workspace.sessionId
    let resume = false
    if (sessionId && codexSessionExists(sessionId)) {
      resume = true
    }
    agentCmd = buildCodexCommand({ directory: cwd, sessionId, resume, initialPrompt })
  }

  // Write CWD-based mapping file for Codex agents
  // The codex-notify-hook.sh uses this to route attention events to the correct workspace
  if (provider === 'codex') {
    try {
      const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)
      const sessionsDir = path.join(getConfigDir(), 'sessions')
      fs.mkdirSync(sessionsDir, { recursive: true })
      const mappingPath = path.join(sessionsDir, `codex-${hash}.json`)
      fs.writeFileSync(mappingPath, JSON.stringify({
        workspaceId,
        instanceId: getInstanceId(),
      }))
    } catch (err) {
      devLog(`[Terminal] Failed to write Codex mapping file for workspace ${workspaceId}:`, err)
    }
  }

  // Benchmark: start PTY spawn timing
  startTimer(`agent:pty-spawn:${workspaceId}`, 'agent')

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

  // Benchmark: PTY spawned
  endTimer(`agent:pty-spawn:${workspaceId}`)
  startTimer(`agent:shell-prompt:${workspaceId}`, 'agent')

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
  // Codex has no /clear equivalent (/new instead, which doesn't need session clearing)
  if (provider === 'claude') {
    ptyProcess.onData((data) => {
      if (data.includes('(no content)')) {
        const currentWorkspace = getWorkspaceById(workspaceId)
        if (currentWorkspace?.sessionId) {
          saveWorkspace({ ...currentWorkspace, sessionId: undefined })
          devLog(`[Terminal] Cleared session ID for workspace ${workspaceId} after /clear`)
        }
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
      endTimer(`agent:shell-prompt:${workspaceId}`)
      startTimer(`agent:claude-start:${workspaceId}`, 'agent')
      // Small additional delay to ensure shell is fully ready
      setTimeout(() => {
        if (skipCommand) {
          // Codex binary not found — write styled error to terminal
          ptyProcess.write("printf '\\n\\033[31m  codex not found\\033[0m\\n\\n  Install with: \\033[36mnpm install -g @openai/codex\\033[0m\\n  Or:           \\033[36mbrew install --cask codex\\033[0m\\n\\n'\n")
        } else {
          ptyProcess.write(agentCmd)
          // For non-Claude providers, report ready immediately after command write
          // (no TUI ready signal to detect — Codex's Ratatui TUI has no simple indicator)
          if (provider !== 'claude') {
            endTimer(`agent:claude-start:${workspaceId}`)
            if (!firstAgentReadyReported) {
              firstAgentReadyReported = true
              milestone('first-agent-ready')
            }
          }
        }
      }, 100)
    }
  }
  ptyProcess.onData(promptHandler)

  // Fallback: if no prompt detected after 3 seconds, send anyway
  setTimeout(() => {
    if (!promptDetected) {
      promptDetected = true
      endTimer(`agent:shell-prompt:${workspaceId}`)
      startTimer(`agent:claude-start:${workspaceId}`, 'agent')
      if (skipCommand) {
        ptyProcess.write("printf '\\n\\033[31m  codex not found\\033[0m\\n\\n  Install with: \\033[36mnpm install -g @openai/codex\\033[0m\\n  Or:           \\033[36mbrew install --cask codex\\033[0m\\n\\n'\n")
      } else {
        ptyProcess.write(agentCmd)
      }
    }
  }, 3000)

  // Detect when agent is ready
  if (provider === 'claude') {
    // Claude shows the status line with ⏵ when ready
    let claudeReadyDetected = false
    ptyProcess.onData((data) => {
      if (!claudeReadyDetected && data.includes('⏵')) {
        claudeReadyDetected = true
        endTimer(`agent:claude-start:${workspaceId}`)
        if (!firstAgentReadyReported) {
          firstAgentReadyReported = true
          milestone('first-agent-ready')
        }
      }
    })
  }

  // Handle process exit
  ptyProcess.onExit(({ exitCode }) => {
    // For Codex agents, discover and save the session ID on exit
    if (provider === 'codex') {
      try {
        const currentWorkspace = getWorkspaceById(workspaceId)
        if (currentWorkspace) {
          const sessionId = findCodexSessionForDirectory(currentWorkspace.directory)
          if (sessionId) {
            saveWorkspace({ ...currentWorkspace, sessionId })
            devLog(`[Terminal] Captured Codex session ${sessionId} for workspace ${workspaceId}`)
          }
        }
      } catch (err) {
        devLog(`[Terminal] Failed to capture Codex session for workspace ${workspaceId}:`, err)
      }
    }

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

export function closeAllTerminals(excludeIds?: Set<string>): void {
  for (const [id] of terminals) {
    if (excludeIds && excludeIds.has(id)) continue
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
  devLog(`[Terminal] Looking for workspace ${workspaceId} in terminals:`, Array.from(terminals.entries()).map(([id, t]) => ({ id, workspaceId: t.workspaceId })))
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

/**
 * Create a plain terminal (shell only, no Claude agent).
 * Used for the "Open Terminal" feature accessible via CMD-K.
 */
export function createPlainTerminal(
  directory: string,
  mainWindow: BrowserWindow | null,
): string {
  const terminalId = `plain-terminal-${Date.now()}`
  const shell = process.env.SHELL || '/bin/zsh'

  // Validate directory exists, fall back to home if not
  let cwd = directory
  if (!fs.existsSync(cwd)) {
    console.warn(`Directory ${cwd} does not exist, using home directory`)
    cwd = os.homedir()
  }

  // Spawn interactive shell (no Claude)
  const ptyProcess = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  })

  // Create emitter for terminal output listening
  const emitter = new EventEmitter()

  terminals.set(terminalId, {
    pty: ptyProcess,
    workspaceId: `plain-${terminalId}`, // Use a synthetic workspaceId
    emitter,
  })

  // Forward data to renderer (uses same 'terminal-data' channel as agent terminals)
  ptyProcess.onData((data) => {
    emitter.emit('data', data)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', terminalId, data)
    }
  })

  // Handle process exit
  ptyProcess.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', terminalId, exitCode)
    }
    terminals.delete(terminalId)
  })

  return terminalId
}

/**
 * Create a Docker terminal (interactive Docker container via PTY).
 * Used for interactive Docker terminal sessions.
 */
export async function createDockerTerminal(
  options: InteractiveDockerOptions,
  mainWindow: BrowserWindow | null,
): Promise<{ terminalId: string; containerName: string }> {
  const terminalId = `docker-terminal-${Date.now()}`
  const { args: dockerArgs, containerName } = await buildInteractiveDockerArgs(options)

  // Validate directory exists, fall back to home if not
  let cwd = options.workingDir
  if (!fs.existsSync(cwd)) {
    console.warn(`Directory ${cwd} does not exist, using home directory`)
    cwd = os.homedir()
  }

  // Spawn docker run -it via PTY
  const ptyProcess = pty.spawn('docker', dockerArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd,
    env: {
      ...process.env,
    },
  })

  // Create emitter for terminal output listening
  const emitter = new EventEmitter()

  terminals.set(terminalId, {
    pty: ptyProcess,
    workspaceId: `plain-${terminalId}`, // Reuse plain- prefix for zero rendering changes
    emitter,
  })

  // Forward data to renderer
  ptyProcess.onData((data) => {
    emitter.emit('data', data)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', terminalId, data)
    }
  })

  // Handle process exit
  ptyProcess.onExit(({ exitCode }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', terminalId, exitCode)
    }
    terminals.delete(terminalId)
  })

  return { terminalId, containerName }
}

/**
 * Setup terminal process (no workspace, ephemeral)
 */
interface SetupTerminalProcess {
  pty: pty.IPty
  emitter: EventEmitter
}

const setupTerminals: Map<string, SetupTerminalProcess> = new Map()

/**
 * Create a terminal for the setup wizard's "Fix with Claude" feature.
 * This terminal is workspace-less and uses the home directory as cwd.
 * It spawns Claude with the given installation prompt.
 */
export function createSetupTerminal(
  mainWindow: BrowserWindow | null,
  initialPrompt: string
): string {
  const terminalId = `setup-terminal-${Date.now()}`
  const shell = process.env.SHELL || '/bin/zsh'
  const cwd = os.homedir()

  // Build Claude command with the prompt
  const escapedPrompt = initialPrompt.replace(/'/g, "'\\''")
  const claudeCmd = `claude '${escapedPrompt}'\n`

  // Spawn interactive shell
  const ptyProcess = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  })

  // Create emitter for terminal output listening
  const emitter = new EventEmitter()

  setupTerminals.set(terminalId, {
    pty: ptyProcess,
    emitter,
  })

  // Forward data to renderer
  ptyProcess.onData((data) => {
    emitter.emit('data', data)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('setup-terminal-data', terminalId, data)
    }
  })

  // Auto-start Claude when shell prompt is detected
  let promptDetected = false
  const promptHandler = (data: string) => {
    // Detect common shell prompts
    if (!promptDetected && (
      /[$%>]\s*$/.test(data) ||
      /\w+@\w+/.test(data) ||
      data.includes(os.userInfo().username)
    )) {
      promptDetected = true
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
      mainWindow.webContents.send('setup-terminal-exit', terminalId, exitCode)
    }
    setupTerminals.delete(terminalId)
  })

  return terminalId
}

/**
 * Write to a setup terminal
 */
export function writeSetupTerminal(terminalId: string, data: string): void {
  const terminal = setupTerminals.get(terminalId)
  if (terminal) {
    terminal.pty.write(data)
  }
}

/**
 * Resize a setup terminal
 */
export function resizeSetupTerminal(
  terminalId: string,
  cols: number,
  rows: number
): void {
  const terminal = setupTerminals.get(terminalId)
  if (terminal) {
    terminal.pty.resize(cols, rows)
  }
}

/**
 * Close a setup terminal
 */
export function closeSetupTerminal(terminalId: string): void {
  const terminal = setupTerminals.get(terminalId)
  if (terminal) {
    terminal.pty.kill()
    setupTerminals.delete(terminalId)
  }
}
