/**
 * Development-only console logging for renderer process
 *
 * This module provides console.log/warn/error wrappers that only output
 * in development mode. This keeps the production app console clean while
 * preserving debugging output during development.
 */

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
 * Error to console - always logs (errors should be visible in production too)
 */
export function devError(...args: unknown[]): void {
  console.error(...args)
}
