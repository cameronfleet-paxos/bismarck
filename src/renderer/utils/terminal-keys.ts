import type { Terminal } from '@xterm/xterm'

/**
 * Attach iTerm2-compatible keyboard shortcuts to an xterm.js terminal.
 * xterm.js doesn't send the escape sequences that shells expect on macOS,
 * so we intercept key combos and send the readline control characters directly.
 */
export function attachMacKeyHandler(xterm: Terminal): void {
  xterm.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true

    // Option+Arrow: word navigation
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.key === 'ArrowLeft') {
        xterm.input('\x1bb') // ESC+b = word backward
        return false
      }
      if (event.key === 'ArrowRight') {
        xterm.input('\x1bf') // ESC+f = word forward
        return false
      }
      if (event.key === 'Backspace') {
        xterm.input('\x17') // Ctrl+W = delete word backward
        return false
      }
    }

    // Cmd+Arrow/Delete: line navigation and deletion
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      if (event.key === 'ArrowLeft') {
        xterm.input('\x01') // Ctrl+A = beginning of line
        return false
      }
      if (event.key === 'ArrowRight') {
        xterm.input('\x05') // Ctrl+E = end of line
        return false
      }
      if (event.key === 'Backspace') {
        xterm.input('\x15') // Ctrl+U = delete to line start
        return false
      }
    }

    return true
  })
}
