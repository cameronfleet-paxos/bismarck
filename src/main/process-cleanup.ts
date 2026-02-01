/**
 * Cleanup orphaned processes and stale socket files from previous Bismark sessions.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { execWithPath } from './exec-utils'

// Use shared exec utility with extended PATH
const execAsync = execWithPath

const SOCKET_BASE_DIR = '/tmp/bm'
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Cleanup orphaned processes and stale socket files from previous sessions.
 * This should be called on app startup.
 */
export async function cleanupOrphanedProcesses(): Promise<void> {
  console.log('[Cleanup] Starting orphaned process cleanup...')

  await Promise.all([
    cleanupStaleSocketDirs(),
    cleanupOrphanedPtyProcesses(),
  ])

  console.log('[Cleanup] Cleanup complete')
}

/**
 * Remove socket directories in /tmp/bm/ that are older than 24 hours.
 * These are left over from previous sessions that didn't clean up properly.
 */
async function cleanupStaleSocketDirs(): Promise<void> {
  try {
    const exists = await fs.access(SOCKET_BASE_DIR).then(() => true).catch(() => false)
    if (!exists) {
      return
    }

    const now = Date.now()
    const entries = await fs.readdir(SOCKET_BASE_DIR, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const dirPath = path.join(SOCKET_BASE_DIR, entry.name)
      try {
        const stats = await fs.stat(dirPath)
        const age = now - stats.mtimeMs

        if (age > STALE_THRESHOLD_MS) {
          console.log(`[Cleanup] Removing stale socket dir: ${dirPath} (${Math.round(age / 1000 / 60 / 60)}h old)`)
          await fs.rm(dirPath, { recursive: true, force: true })
        }
      } catch (error) {
        // Ignore errors for individual directories
        console.warn(`[Cleanup] Failed to check/remove ${dirPath}:`, error)
      }
    }
  } catch (error) {
    console.warn('[Cleanup] Failed to cleanup socket directories:', error)
  }
}

/**
 * Kill orphaned PTY processes that have BISMARK_WORKSPACE_ID env var set.
 * These are child processes from previous sessions that weren't properly terminated.
 */
async function cleanupOrphanedPtyProcesses(): Promise<void> {
  try {
    // Use ps to find processes with BISMARK_WORKSPACE_ID in their environment
    // This works on macOS and Linux
    // We look for shell processes (zsh, bash) that have the BISMARK env var
    const { stdout } = await execAsync(
      'ps -eo pid,ppid,command | grep -E "BISMARK_|claude" | grep -v grep || true'
    )

    if (!stdout.trim()) {
      return
    }

    // Parse the output to get PIDs
    // Note: This is a heuristic - we can't directly see env vars from ps
    // Instead, we use a more targeted approach: look for processes with our specific env var
    const { stdout: envOutput } = await execAsync(
      `for pid in $(pgrep -f "claude\\|node-pty"); do
        if ps -p $pid -o pid= > /dev/null 2>&1; then
          env_vars=$(ps eww -p $pid 2>/dev/null | grep BISMARK_WORKSPACE_ID || true)
          if [ -n "$env_vars" ]; then
            echo $pid
          fi
        fi
      done 2>/dev/null || true`
    ).catch(() => ({ stdout: '' }))

    const pids = envOutput.trim().split('\n').filter(Boolean)

    if (pids.length > 0) {
      console.log(`[Cleanup] Found ${pids.length} orphaned PTY processes: ${pids.join(', ')}`)

      for (const pid of pids) {
        try {
          // Send SIGTERM first for graceful shutdown
          process.kill(parseInt(pid, 10), 'SIGTERM')
          console.log(`[Cleanup] Killed orphaned process: ${pid}`)
        } catch (error) {
          // Process may have already exited
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            console.warn(`[Cleanup] Failed to kill process ${pid}:`, error)
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Cleanup] Failed to cleanup orphaned processes:', error)
  }
}

/**
 * Kill all processes with a specific BISMARK_INSTANCE_ID.
 * Used during graceful shutdown to ensure all child processes are terminated.
 */
export async function killProcessesByInstanceId(instanceId: string): Promise<void> {
  try {
    const { stdout } = await execAsync(
      `for pid in $(pgrep -f "node\\|zsh\\|bash"); do
        if ps -p $pid -o pid= > /dev/null 2>&1; then
          env_vars=$(ps eww -p $pid 2>/dev/null | grep "BISMARK_INSTANCE_ID=${instanceId}" || true)
          if [ -n "$env_vars" ]; then
            echo $pid
          fi
        fi
      done 2>/dev/null || true`
    ).catch(() => ({ stdout: '' }))

    const pids = stdout.trim().split('\n').filter(Boolean)

    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM')
      } catch {
        // Ignore errors - process may have already exited
      }
    }
  } catch {
    // Ignore errors during shutdown
  }
}
