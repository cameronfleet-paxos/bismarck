/**
 * Development-only logger for renderer process
 *
 * In production builds, all log calls become no-ops.
 * Uses import.meta.env.DEV which Vite sets based on build mode.
 */

// Check if we're in development mode
const isDev = import.meta.env.DEV

/**
 * Log to console only in development mode
 */
export function devLog(...args: unknown[]): void {
  if (isDev) {
    console.log(...args)
  }
}

/**
 * Warn to console only in development mode
 */
export function devWarn(...args: unknown[]): void {
  if (isDev) {
    console.warn(...args)
  }
}

/**
 * Error logs are always shown (even in production)
 */
export function devError(...args: unknown[]): void {
  console.error(...args)
}

/**
 * Development-only logger with scoped prefix
 * @param prefix - Prefix for all log messages (e.g., '[Renderer]')
 */
export function createDevLogger(prefix: string) {
  return {
    log: (...args: unknown[]) => devLog(prefix, ...args),
    warn: (...args: unknown[]) => devWarn(prefix, ...args),
    error: (...args: unknown[]) => devError(prefix, ...args),
  }
}

// Pre-created loggers for common scopes
export const rendererLog = createDevLogger('[Renderer]')
export const appLog = createDevLogger('[App]')
