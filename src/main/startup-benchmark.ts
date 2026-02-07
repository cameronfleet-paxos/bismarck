/**
 * Startup Performance Benchmark
 *
 * Collects timing data for startup analysis.
 * ALWAYS ENABLED - no environment checks, always logs to disk.
 *
 * Output locations:
 * - Primary log: ~/.bismarck/startup-benchmark.log (append-mode, survives restarts)
 * - JSON snapshot: ~/.bismarck/startup-benchmark.json (overwritten each launch)
 * - Console: All timings also logged to stdout for dev visibility
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { devLog } from './dev-log'

// Types
export type BenchmarkPhase = 'main' | 'window' | 'renderer' | 'agent' | 'ipc'

export interface TimingEntry {
  label: string
  phase: BenchmarkPhase
  startMs: number      // ms since app start
  durationMs: number
  endMs: number
  timestamp: string    // ISO timestamp for log correlation
}

export interface Milestone {
  name: string
  ms: number           // ms since app start
  timestamp: string
}

export interface StartupBenchmark {
  appStartTimestamp: string
  appVersion: string
  nodeVersion: string
  electronVersion: string
  platform: string
  timings: TimingEntry[]
  milestones: Milestone[]
}

// Module-level state
let appStartTime: number = 0
let benchmark: StartupBenchmark | null = null
const pendingTimers: Map<string, { phase: BenchmarkPhase; startMs: number }> = new Map()
let firstAgentReady = false
let snapshotWritten = false

// Use .bismarck-dev in development mode to match config.ts pattern
const CONFIG_DIR_NAME = process.env.NODE_ENV === 'development' ? '.bismarck-dev' : '.bismarck'

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  const homeDir = app?.getPath('home') || process.env.HOME || ''
  return path.join(homeDir, CONFIG_DIR_NAME)
}

/**
 * Get the log file path
 */
function getLogPath(): string {
  return path.join(getConfigDir(), 'startup-benchmark.log')
}

/**
 * Get the JSON snapshot path
 */
function getSnapshotPath(): string {
  return path.join(getConfigDir(), 'startup-benchmark.json')
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    try {
      fs.mkdirSync(configDir, { recursive: true })
    } catch {
      // Ignore errors - will fail gracefully on write
    }
  }
}

/**
 * Write a line to the log file (append-mode)
 */
function writeToLog(line: string): void {
  try {
    ensureConfigDir()
    fs.appendFileSync(getLogPath(), line + '\n')
  } catch (error) {
    console.warn('[Benchmark] Failed to write to log:', error)
  }
}

/**
 * Write the JSON snapshot
 */
function writeSnapshot(): void {
  if (!benchmark || snapshotWritten) return

  try {
    ensureConfigDir()
    const tempPath = getSnapshotPath() + '.tmp'
    fs.writeFileSync(tempPath, JSON.stringify(benchmark, null, 2))
    fs.renameSync(tempPath, getSnapshotPath())
    snapshotWritten = true
    devLog(`[Benchmark] Snapshot written to ${getSnapshotPath()}`)
  } catch (error) {
    console.warn('[Benchmark] Failed to write snapshot:', error)
  }
}

/**
 * Initialize the benchmark module.
 * Call this at the very top of main.ts, before any other imports.
 */
export function initBenchmark(): void {
  appStartTime = Date.now()
  const timestamp = new Date().toISOString()

  benchmark = {
    appStartTimestamp: timestamp,
    appVersion: app?.getVersion?.() || 'unknown',
    nodeVersion: process.version,
    electronVersion: process.versions.electron || 'unknown',
    platform: process.platform,
    timings: [],
    milestones: [],
  }

  // Record app-start milestone
  milestone('app-start')

  // Write session start marker to log
  writeToLog(`\n[${timestamp}] ========== NEW SESSION ==========`)
  writeToLog(`[${timestamp}] [INFO] Version: ${benchmark.appVersion} | Node: ${benchmark.nodeVersion} | Electron: ${benchmark.electronVersion} | Platform: ${benchmark.platform}`)

  // Set up fallback to write snapshot after 30 seconds if no agent boots
  setTimeout(() => {
    if (!snapshotWritten) {
      milestone('snapshot-timeout')
      writeSnapshot()
    }
  }, 30000)
}

/**
 * Start timing a labeled operation.
 * @param label - Unique label for this timing (e.g., "main:cleanupOrphanedProcesses")
 * @param phase - The phase this timing belongs to
 */
export function startTimer(label: string, phase: BenchmarkPhase): void {
  if (!appStartTime) return

  const startMs = Date.now() - appStartTime
  pendingTimers.set(label, { phase, startMs })
}

/**
 * End timing for a labeled operation.
 * Immediately writes to log file.
 * @param label - The label used in startTimer()
 * @returns The duration in milliseconds
 */
export function endTimer(label: string): number {
  if (!appStartTime || !benchmark) return 0

  const pending = pendingTimers.get(label)
  if (!pending) {
    console.warn(`[Benchmark] Timer "${label}" not found`)
    return 0
  }

  pendingTimers.delete(label)

  const endMs = Date.now() - appStartTime
  const durationMs = endMs - pending.startMs
  const timestamp = new Date().toISOString()

  const entry: TimingEntry = {
    label,
    phase: pending.phase,
    startMs: pending.startMs,
    durationMs,
    endMs,
    timestamp,
  }

  benchmark.timings.push(entry)

  // Write to log immediately
  const logLine = `[${timestamp}] [TIMING] ${label} phase=${pending.phase} start=${pending.startMs}ms dur=${durationMs}ms end=${endMs}ms`
  writeToLog(logLine)
  devLog(logLine)

  return durationMs
}

/**
 * Record an absolute time milestone.
 * Immediately writes to log file.
 * @param name - Name of the milestone (e.g., "first-agent-ready")
 */
export function milestone(name: string): void {
  if (!appStartTime || !benchmark) return

  const ms = Date.now() - appStartTime
  const timestamp = new Date().toISOString()

  const entry: Milestone = { name, ms, timestamp }
  benchmark.milestones.push(entry)

  // Write to log immediately
  const logLine = `[${timestamp}] [MILESTONE] ${name} at=${ms}ms`
  writeToLog(logLine)
  devLog(logLine)

  // Trigger snapshot write on first agent ready
  if (name === 'first-agent-ready' && !firstAgentReady) {
    firstAgentReady = true
    writeSnapshot()
  }
}

/**
 * Record a timing from the renderer process (received via IPC).
 * @param label - The timing label
 * @param phase - The phase (should always be 'renderer')
 * @param startMs - Start time in ms since renderer script start
 * @param durationMs - Duration in ms
 */
export function recordRendererTiming(
  label: string,
  phase: BenchmarkPhase,
  startMs: number,
  durationMs: number
): void {
  if (!appStartTime || !benchmark) return

  // Renderer times are relative to renderer start, not app start
  // We need to adjust based on when we received this timing
  const receiveTime = Date.now() - appStartTime
  const timestamp = new Date().toISOString()

  // Estimate when the timing ended relative to app start
  // This is approximate since we don't know exact renderer start time
  const endMs = receiveTime
  const adjustedStartMs = endMs - durationMs

  const entry: TimingEntry = {
    label,
    phase,
    startMs: adjustedStartMs,
    durationMs,
    endMs,
    timestamp,
  }

  benchmark.timings.push(entry)

  // Write to log immediately
  const logLine = `[${timestamp}] [TIMING] ${label} phase=${phase} start=${adjustedStartMs}ms dur=${durationMs}ms end=${endMs}ms (renderer)`
  writeToLog(logLine)
  devLog(logLine)
}

/**
 * Record a milestone from the renderer process (received via IPC).
 */
export function recordRendererMilestone(name: string): void {
  if (!appStartTime || !benchmark) return

  const ms = Date.now() - appStartTime
  const timestamp = new Date().toISOString()

  const entry: Milestone = { name, ms, timestamp }
  benchmark.milestones.push(entry)

  // Write to log immediately
  const logLine = `[${timestamp}] [MILESTONE] ${name} at=${ms}ms (renderer)`
  writeToLog(logLine)
  devLog(logLine)
}

/**
 * Convenience function to time a synchronous operation.
 */
export function timeSync<T>(label: string, phase: BenchmarkPhase, fn: () => T): T {
  startTimer(label, phase)
  try {
    return fn()
  } finally {
    endTimer(label)
  }
}

/**
 * Convenience function to time an async operation.
 */
export async function timeAsync<T>(
  label: string,
  phase: BenchmarkPhase,
  fn: () => Promise<T>
): Promise<T> {
  startTimer(label, phase)
  try {
    return await fn()
  } finally {
    endTimer(label)
  }
}

/**
 * Get the current benchmark data (for debugging).
 */
export function getBenchmark(): StartupBenchmark | null {
  return benchmark
}

/**
 * Get the app start time (for renderer to calculate relative times).
 */
export function getAppStartTime(): number {
  return appStartTime
}
