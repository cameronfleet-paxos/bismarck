/**
 * Crash Logger for Bismarck
 *
 * Writes crash dumps to ~/.bismarck/crash-logs/ for persistent error tracking.
 * Each crash is saved with timestamp, stack trace, and available context.
 */

import * as fs from 'fs'
import * as path from 'path'
import { getConfigDir } from './config'

// Maximum number of crash logs to keep
const MAX_CRASH_LOGS = 50

/**
 * Get the crash logs directory
 */
export function getCrashLogsDir(): string {
  return path.join(getConfigDir(), 'crash-logs')
}

/**
 * Ensure crash logs directory exists
 */
function ensureCrashLogsDir(): void {
  const dir = getCrashLogsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Generate crash log filename with timestamp
 */
function generateCrashLogFilename(): string {
  const now = new Date()
  const timestamp = now.toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-')
    .replace('T', '_')
    .replace('Z', '')
  return `crash-${timestamp}.log`
}

/**
 * Format error for crash log
 */
function formatError(error: Error | unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n\nStack trace:\n${error.stack || 'No stack trace available'}`
  }
  return String(error)
}

/**
 * Context that may be available during a crash
 */
export interface CrashContext {
  planId?: string
  taskId?: string
  agentId?: string
  component?: string // e.g., 'main', 'headless-agent', 'terminal', 'renderer'
  operation?: string // e.g., 'spawnContainerAgent', 'executeTask'
  additionalInfo?: Record<string, unknown>
}

/**
 * Write a crash log to disk
 */
export function writeCrashLog(
  error: Error | unknown,
  source: 'uncaughtException' | 'unhandledRejection' | 'renderer' | 'headless-agent' | 'startup' | 'other',
  context?: CrashContext
): string | null {
  try {
    ensureCrashLogsDir()

    const filename = generateCrashLogFilename()
    const filepath = path.join(getCrashLogsDir(), filename)

    const timestamp = new Date().toISOString()
    const lines: string[] = [
      '='.repeat(80),
      'BISMARCK CRASH LOG',
      '='.repeat(80),
      '',
      `Timestamp: ${timestamp}`,
      `Source: ${source}`,
      `Node Version: ${process.version}`,
      `Platform: ${process.platform}`,
      `Architecture: ${process.arch}`,
      '',
    ]

    // Add context if available
    if (context) {
      lines.push('--- Context ---')
      if (context.component) lines.push(`Component: ${context.component}`)
      if (context.operation) lines.push(`Operation: ${context.operation}`)
      if (context.planId) lines.push(`Plan ID: ${context.planId}`)
      if (context.taskId) lines.push(`Task ID: ${context.taskId}`)
      if (context.agentId) lines.push(`Agent ID: ${context.agentId}`)
      if (context.additionalInfo) {
        lines.push('Additional Info:')
        for (const [key, value] of Object.entries(context.additionalInfo)) {
          try {
            lines.push(`  ${key}: ${JSON.stringify(value)}`)
          } catch {
            lines.push(`  ${key}: [unserializable]`)
          }
        }
      }
      lines.push('')
    }

    lines.push('--- Error ---')
    lines.push(formatError(error))
    lines.push('')
    lines.push('='.repeat(80))

    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8')

    // Clean up old crash logs
    cleanupOldCrashLogs()

    // Also log to console
    console.error(`[CrashLogger] Crash log written to: ${filepath}`)

    return filepath
  } catch (writeError) {
    // If we can't write the crash log, just log to console
    console.error('[CrashLogger] Failed to write crash log:', writeError)
    console.error('[CrashLogger] Original error:', error)
    return null
  }
}

/**
 * Clean up old crash logs, keeping only the most recent MAX_CRASH_LOGS
 */
function cleanupOldCrashLogs(): void {
  try {
    const dir = getCrashLogsDir()
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime) // Sort by most recent first

    // Remove old logs beyond the limit
    if (files.length > MAX_CRASH_LOGS) {
      for (const file of files.slice(MAX_CRASH_LOGS)) {
        try {
          fs.unlinkSync(file.path)
        } catch {
          // Ignore deletion errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Get list of recent crash logs
 */
export function getRecentCrashLogs(): Array<{ filename: string; timestamp: Date; path: string }> {
  try {
    const dir = getCrashLogsDir()
    if (!fs.existsSync(dir)) {
      return []
    }

    return fs.readdirSync(dir)
      .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
      .map(f => ({
        filename: f,
        path: path.join(dir, f),
        timestamp: fs.statSync(path.join(dir, f)).mtime
      }))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  } catch {
    return []
  }
}
