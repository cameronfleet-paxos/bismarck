/**
 * Terminal Buffer Manager
 *
 * Stores terminal output for each terminal ID so that when terminals are
 * unmounted (e.g., when moving agents between tabs) and remounted, we can
 * replay the buffered content to restore the terminal state.
 *
 * This solves the issue where the Terminal component key changes when moving
 * between tabs, causing React to unmount the old instance and mount a new one,
 * losing all buffer content.
 */

// Maximum buffer size in bytes to prevent memory issues
const MAX_BUFFER_SIZE = 1024 * 1024 // 1MB per terminal

interface TerminalBuffer {
  data: string
  size: number
}

class TerminalBufferManager {
  private buffers: Map<string, TerminalBuffer> = new Map()

  /**
   * Append data to a terminal's buffer
   */
  append(terminalId: string, data: string): void {
    const existing = this.buffers.get(terminalId)
    if (existing) {
      // Append new data
      existing.data += data
      existing.size += data.length

      // Trim if exceeds max size - keep the end of the buffer
      if (existing.size > MAX_BUFFER_SIZE) {
        // Find a good break point near the trim point (e.g., after a newline)
        const trimPoint = existing.size - MAX_BUFFER_SIZE
        let breakPoint = existing.data.indexOf('\n', trimPoint)
        if (breakPoint === -1 || breakPoint > trimPoint + 1000) {
          // No newline found nearby, just trim at the calculated point
          breakPoint = trimPoint
        } else {
          breakPoint += 1 // Include the newline
        }
        existing.data = existing.data.slice(breakPoint)
        existing.size = existing.data.length
      }
    } else {
      // Create new buffer
      let bufferData = data
      if (data.length > MAX_BUFFER_SIZE) {
        // Trim from the start if initial data is too large
        bufferData = data.slice(data.length - MAX_BUFFER_SIZE)
      }
      this.buffers.set(terminalId, {
        data: bufferData,
        size: bufferData.length,
      })
    }
  }

  /**
   * Get the buffered content for a terminal
   */
  getBuffer(terminalId: string): string | null {
    return this.buffers.get(terminalId)?.data ?? null
  }

  /**
   * Check if a terminal has buffered content
   */
  hasBuffer(terminalId: string): boolean {
    const buffer = this.buffers.get(terminalId)
    return buffer !== undefined && buffer.size > 0
  }

  /**
   * Clear the buffer for a terminal (e.g., when the terminal is closed)
   */
  clear(terminalId: string): void {
    this.buffers.delete(terminalId)
  }

  /**
   * Clear all buffers
   */
  clearAll(): void {
    this.buffers.clear()
  }

  /**
   * Get statistics about buffer usage (for debugging)
   */
  getStats(): { terminalCount: number; totalSize: number } {
    let totalSize = 0
    for (const buffer of this.buffers.values()) {
      totalSize += buffer.size
    }
    return {
      terminalCount: this.buffers.size,
      totalSize,
    }
  }
}

// Export singleton instance
export const terminalBuffer = new TerminalBufferManager()
