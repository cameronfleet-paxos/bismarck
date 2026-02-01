/**
 * Centralized Logger for Bismark
 *
 * Provides structured logging with:
 * - Global debug log: /tmp/claude/bismark-debug.log
 * - Plan-specific logs: ~/.bismark/plans/{planId}/debug.log
 * - Categories for filtering (plan, task, worktree, agent, git, bd, docker, proxy)
 * - Timing utilities for performance tracking
 * - Context (planId, taskId, agentId) for correlation
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Log categories for filtering
export type LogCategory =
  | 'plan'
  | 'task'
  | 'worktree'
  | 'agent'
  | 'git'
  | 'bd'
  | 'docker'
  | 'proxy'
  | 'general'

// Log levels
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

// Context for log correlation
export interface LogContext {
  planId?: string
  taskId?: string
  agentId?: string
  worktreePath?: string
  branch?: string
  repo?: string
}

// Global debug log path
const GLOBAL_LOG_PATH = '/tmp/claude/bismark-debug.log'

// Ensure log directory exists
function ensureLogDir(logPath: string): void {
  const dir = path.dirname(logPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Get plan-specific log path
function getPlanLogPath(planId: string): string {
  return path.join(os.homedir(), '.bismark', 'plans', planId, 'debug.log')
}

// Format context for log line
function formatContext(context?: LogContext): string {
  if (!context) return ''

  const parts: string[] = []
  if (context.planId) parts.push(`planId=${context.planId}`)
  if (context.taskId) parts.push(`taskId=${context.taskId}`)
  if (context.agentId) parts.push(`agentId=${context.agentId}`)
  if (context.worktreePath) parts.push(`worktree=${context.worktreePath}`)
  if (context.branch) parts.push(`branch=${context.branch}`)
  if (context.repo) parts.push(`repo=${context.repo}`)

  return parts.length > 0 ? ' ' + parts.join(' ') : ''
}

// Format data object for logging
function formatData(data?: object): string {
  if (!data) return ''
  try {
    // Truncate long strings in data
    const truncated = JSON.stringify(data, (key, value) => {
      if (typeof value === 'string' && value.length > 500) {
        return value.substring(0, 500) + '...[truncated]'
      }
      return value
    })
    return ` data=${truncated}`
  } catch {
    return ' data=[unserializable]'
  }
}

// Write log entry to file
function writeLog(
  level: LogLevel,
  category: LogCategory,
  message: string,
  context?: LogContext,
  data?: object
): void {
  const timestamp = new Date().toISOString()
  const contextStr = formatContext(context)
  const dataStr = formatData(data)
  const line = `[${timestamp}] [${level}] [${category}] ${message}${contextStr}${dataStr}\n`

  // Write to global log
  try {
    ensureLogDir(GLOBAL_LOG_PATH)
    fs.appendFileSync(GLOBAL_LOG_PATH, line)
  } catch {
    // Ignore write errors to global log
  }

  // Write to plan-specific log if planId is provided
  if (context?.planId) {
    try {
      const planLogPath = getPlanLogPath(context.planId)
      ensureLogDir(planLogPath)
      fs.appendFileSync(planLogPath, line)
    } catch {
      // Ignore write errors to plan log
    }
  }

  // Also log to console for development
  if (level === 'ERROR') {
    console.error(`[${category}] ${message}${contextStr}`)
  } else if (level === 'WARN') {
    console.warn(`[${category}] ${message}${contextStr}`)
  } else {
    console.log(`[${category}] ${message}${contextStr}`)
  }
}

// Timing storage for performance tracking
const timings: Map<string, number> = new Map()

/**
 * Logger instance with methods for each log level
 */
export const logger = {
  /**
   * Log debug message - for detailed troubleshooting
   */
  debug(
    category: LogCategory,
    message: string,
    context?: LogContext,
    data?: object
  ): void {
    writeLog('DEBUG', category, message, context, data)
  },

  /**
   * Log info message - for normal operation milestones
   */
  info(
    category: LogCategory,
    message: string,
    context?: LogContext,
    data?: object
  ): void {
    writeLog('INFO', category, message, context, data)
  },

  /**
   * Log warning message - for recoverable issues
   */
  warn(
    category: LogCategory,
    message: string,
    context?: LogContext,
    data?: object
  ): void {
    writeLog('WARN', category, message, context, data)
  },

  /**
   * Log error message - for failures
   */
  error(
    category: LogCategory,
    message: string,
    context?: LogContext,
    data?: object
  ): void {
    writeLog('ERROR', category, message, context, data)
  },

  /**
   * Start a timing measurement
   * @param label - Unique label for this timing
   */
  time(label: string): void {
    timings.set(label, Date.now())
  },

  /**
   * End a timing measurement and log it
   * @param label - The label used in time()
   * @param category - Log category
   * @param message - Message to include (duration will be appended)
   * @param context - Optional log context
   */
  timeEnd(
    label: string,
    category: LogCategory,
    message: string,
    context?: LogContext
  ): number {
    const startTime = timings.get(label)
    if (!startTime) {
      logger.warn(category, `Timer "${label}" not found`, context)
      return 0
    }

    const duration = Date.now() - startTime
    timings.delete(label)

    writeLog('INFO', category, `${message} (${duration}ms)`, context)
    return duration
  },

  /**
   * Log a git command execution
   */
  gitCommand(
    command: string,
    cwd: string,
    context?: LogContext,
    result?: { stdout?: string; stderr?: string; error?: string }
  ): void {
    const logContext = { ...context, repo: cwd }
    if (result?.error) {
      logger.error('git', `Command failed: ${command}`, logContext, {
        error: result.error,
        stderr: result.stderr,
      })
    } else {
      logger.debug('git', `Executed: ${command}`, logContext, {
        stdout: result?.stdout?.substring(0, 200),
      })
    }
  },

  /**
   * Log a bd (beads) command execution
   */
  bdCommand(
    command: string,
    planId: string,
    result?: { stdout?: string; stderr?: string; error?: string }
  ): void {
    const context = { planId }
    if (result?.error) {
      logger.error('bd', `Command failed: ${command}`, context, {
        error: result.error,
        stderr: result.stderr,
      })
    } else {
      logger.debug('bd', `Executed: ${command}`, context, {
        stdout: result?.stdout?.substring(0, 200),
      })
    }
  },

  /**
   * Log plan execution state change
   */
  planStateChange(
    planId: string,
    fromStatus: string,
    toStatus: string,
    reason?: string
  ): void {
    logger.info(
      'plan',
      `Status changed: ${fromStatus} -> ${toStatus}`,
      { planId },
      reason ? { reason } : undefined
    )
  },

  /**
   * Log task processing
   */
  taskProcessing(
    planId: string,
    taskId: string,
    action: string,
    details?: object
  ): void {
    logger.info('task', `${action}`, { planId, taskId }, details)
  },

  /**
   * Log worktree operations
   */
  worktreeOp(
    operation: 'create' | 'remove' | 'prune',
    repoPath: string,
    worktreePath: string,
    context?: LogContext,
    details?: object
  ): void {
    logger.info(
      'worktree',
      `${operation}: ${worktreePath}`,
      { ...context, repo: repoPath, worktreePath },
      details
    )
  },

  /**
   * Log agent lifecycle events
   */
  agentEvent(
    event: 'start' | 'stop' | 'complete' | 'error' | 'spawn',
    agentId: string,
    context?: LogContext,
    details?: object
  ): void {
    const level = event === 'error' ? 'ERROR' : 'INFO'
    writeLog(level, 'agent', `Agent ${event}: ${agentId}`, context, details)
  },

  /**
   * Log Docker container events
   */
  dockerEvent(
    event: 'spawn' | 'exit' | 'error' | 'stdout' | 'stderr',
    containerId: string,
    context?: LogContext,
    details?: object
  ): void {
    const level = event === 'error' ? 'ERROR' : 'DEBUG'
    writeLog(
      level,
      'docker',
      `Container ${event}: ${containerId}`,
      context,
      details
    )
  },

  /**
   * Log proxy requests
   */
  proxyRequest(
    tool: 'gh' | 'bd' | 'git',
    args: string[],
    success: boolean,
    context?: LogContext,
    details?: object
  ): void {
    const level = success ? 'DEBUG' : 'ERROR'
    writeLog(
      level,
      'proxy',
      `${tool} request: ${args.join(' ')}`,
      context,
      details
    )
  },
}

/**
 * Create a scoped logger with preset context
 * Useful for functions that always log with the same planId/taskId
 */
export function createScopedLogger(defaultContext: LogContext) {
  return {
    debug(category: LogCategory, message: string, data?: object): void {
      logger.debug(category, message, defaultContext, data)
    },
    info(category: LogCategory, message: string, data?: object): void {
      logger.info(category, message, defaultContext, data)
    },
    warn(category: LogCategory, message: string, data?: object): void {
      logger.warn(category, message, defaultContext, data)
    },
    error(category: LogCategory, message: string, data?: object): void {
      logger.error(category, message, defaultContext, data)
    },
    time(label: string): void {
      logger.time(label)
    },
    timeEnd(label: string, category: LogCategory, message: string): number {
      return logger.timeEnd(label, category, message, defaultContext)
    },
  }
}

export default logger
