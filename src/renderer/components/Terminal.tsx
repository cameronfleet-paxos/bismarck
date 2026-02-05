import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { ThemeName } from '@/shared/types'
import { themes } from '@/shared/constants'

// Regex that matches both URLs and file paths
// URLs: http:// and https:// patterns
// File paths: /absolute/path or ~/home/path, optionally with :line or :line:col
const URL_AND_FILE_PATH_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+|(?:\/[\w.-]+)+(?::(\d+)(?::(\d+))?)?|~\/[\w./-]+(?::(\d+)(?::(\d+))?)?/g

interface TerminalProps {
  terminalId: string
  theme: ThemeName
  isBooting: boolean
  isVisible?: boolean
  registerWriter: (terminalId: string, writer: (data: string) => void) => void
  unregisterWriter: (terminalId: string) => void
  getBufferedContent?: (terminalId: string) => string | null
}

export function Terminal({
  terminalId,
  theme,
  isBooting,
  isVisible = true,
  registerWriter,
  unregisterWriter,
  getBufferedContent,
}: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!terminalRef.current || initializedRef.current) return
    initializedRef.current = true

    const themeColors = themes[theme]

    const xterm = new XTerm({
      theme: {
        background: themeColors.bg,
        foreground: themeColors.fg,
        cursor: themeColors.fg,
        cursorAccent: themeColors.bg,
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: true,
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon(
      (_event, uri) => {
        // Handle file paths - convert to file:// URL
        if (uri.startsWith('/') || uri.startsWith('~')) {
          // Extract path without line numbers
          const pathOnly = uri.replace(/:\d+(?::\d+)?$/, '')
          const expandedPath = pathOnly.startsWith('~')
            ? pathOnly.replace('~', process.env.HOME || '')
            : pathOnly
          window.electronAPI.openExternal(`file://${expandedPath}`)
        } else {
          // Regular URL
          window.electronAPI.openExternal(uri)
        }
      },
      {
        urlRegex: URL_AND_FILE_PATH_REGEX,
      }
    )
    xterm.loadAddon(webLinksAddon)

    xterm.open(terminalRef.current)
    fitAddon.fit()

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // Replay buffered content before registering the writer
    // This restores terminal history when the component is remounted (e.g., after tab move)
    if (getBufferedContent) {
      const bufferedContent = getBufferedContent(terminalId)
      if (bufferedContent) {
        xterm.write(bufferedContent)
      }
    }

    // Handle user input
    xterm.onData((data) => {
      window.electronAPI.writeTerminal(terminalId, data)
    })

    // Register this terminal's write function with the parent
    registerWriter(terminalId, (data: string) => {
      if (xtermRef.current) {
        xtermRef.current.write(data)
      }
    })

    // Initial resize
    const { cols, rows } = xterm
    window.electronAPI.resizeTerminal(terminalId, cols, rows)

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = xtermRef.current
        window.electronAPI.resizeTerminal(terminalId, cols, rows)
      }
    })

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    return () => {
      resizeObserver.disconnect()
      xterm.dispose()
      unregisterWriter(terminalId)
      initializedRef.current = false
    }
    // Note: isVisible intentionally not in deps - we only check it at init time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])


  // Update theme when it changes
  useEffect(() => {
    if (xtermRef.current) {
      const themeColors = themes[theme]
      xtermRef.current.options.theme = {
        background: themeColors.bg,
        foreground: themeColors.fg,
        cursor: themeColors.fg,
        cursorAccent: themeColors.bg,
      }
    }
  }, [theme])

  // Re-fit and refresh terminal when it becomes visible
  // Uses multiple fit attempts with increasing delays to handle race conditions
  // when returning from settings view or moving between tabs
  useEffect(() => {
    if (isVisible && fitAddonRef.current && xtermRef.current) {
      const fitTerminal = () => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = xtermRef.current
          window.electronAPI.resizeTerminal(terminalId, cols, rows)
          // Force a full redraw of the terminal canvas
          xtermRef.current.refresh(0, rows - 1)
        }
      }

      // Multiple fit attempts with increasing delays to ensure at least one
      // occurs after the browser has fully computed layout
      const delays = [0, 50, 150, 300]
      const timers = delays.map((delay) =>
        setTimeout(() => {
          requestAnimationFrame(fitTerminal)
        }, delay)
      )

      // Focus after initial fit
      const focusTimer = setTimeout(() => {
        xtermRef.current?.focus()
      }, 50)

      return () => {
        timers.forEach(clearTimeout)
        clearTimeout(focusTimer)
      }
    }
  }, [isVisible, terminalId])

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: themes[theme].bg }}>
      {isBooting && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ backgroundColor: themes[theme].bg }}
        >
          <div className="flex flex-col items-center gap-3">
            <pre
              className="animate-claude-bounce font-mono text-xl leading-tight select-none"
              style={{ color: '#D97757' }}
            >
              {` ▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝`}
            </pre>
            <span
              className="animate-pulse text-sm"
              style={{ color: '#D97757' }}
            >
              booting...
            </span>
          </div>
        </div>
      )}
      <div
        ref={terminalRef}
        className={`w-full h-full overflow-hidden ${isBooting ? 'invisible' : ''}`}
      />
    </div>
  )
}
