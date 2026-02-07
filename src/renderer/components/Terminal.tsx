import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { ThemeName } from '@/shared/types'
import { themes } from '@/shared/constants'
import { TerminalSearch, SearchOptions, SearchResult } from './TerminalSearch'

interface TerminalProps {
  terminalId: string
  theme: ThemeName
  isBooting: boolean
  isVisible?: boolean
  searchOpen?: boolean
  onSearchClose?: () => void
  registerWriter: (terminalId: string, writer: (data: string) => void) => void
  unregisterWriter: (terminalId: string) => void
  getBufferedContent?: (terminalId: string) => string | null
}

export interface TerminalRef {
  openSearch: () => void
  closeSearch: () => void
}

export const Terminal = forwardRef<TerminalRef, TerminalProps>(function Terminal({
  terminalId,
  theme,
  isBooting,
  isVisible = true,
  searchOpen: externalSearchOpen,
  onSearchClose,
  registerWriter,
  unregisterWriter,
  getBufferedContent,
}, ref) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const initializedRef = useRef(false)
  const [internalSearchOpen, setInternalSearchOpen] = useState(false)

  // Use external state if provided, otherwise use internal state
  const searchOpen = externalSearchOpen !== undefined ? externalSearchOpen : internalSearchOpen

  // Expose search control methods via ref
  useImperativeHandle(ref, () => ({
    openSearch: () => {
      if (externalSearchOpen === undefined) {
        setInternalSearchOpen(true)
      }
    },
    closeSearch: () => {
      if (externalSearchOpen === undefined) {
        setInternalSearchOpen(false)
      }
      // Clear search highlighting when closing
      searchAddonRef.current?.clearDecorations()
    },
  }), [externalSearchOpen])

  const handleSearchClose = useCallback(() => {
    if (onSearchClose) {
      onSearchClose()
    } else {
      setInternalSearchOpen(false)
    }
    searchAddonRef.current?.clearDecorations()
  }, [onSearchClose])

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
      scrollback: 10000,
    })

    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)

    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.electronAPI.openExternal(uri)
    })
    xterm.loadAddon(webLinksAddon)

    // Add search addon
    const searchAddon = new SearchAddon()
    xterm.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    // Allow OS-level navigation keys to pass through
    xterm.attachCustomKeyEventHandler((event) => {
      // Allow Cmd+arrows and Option+arrows for text navigation
      if ((event.metaKey || event.altKey) &&
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
           event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        return false // false means "don't handle in xterm, pass to app"
      }
      // Allow Cmd+Backspace for delete line
      if (event.metaKey && event.key === 'Backspace') {
        return false
      }
      return true // true means "let xterm handle this key"
    })

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

  // Search handlers
  const handleSearch = useCallback((query: string, options: SearchOptions): SearchResult => {
    if (!searchAddonRef.current || !query) {
      return { found: false }
    }

    const found = searchAddonRef.current.findNext(query, {
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regex: options.regex,
    })

    // xterm search addon doesn't provide match count, so we can't show it
    return { found, totalMatches: found ? undefined : 0 }
  }, [])

  const handleFindNext = useCallback((): SearchResult => {
    if (!searchAddonRef.current) {
      return { found: false }
    }

    const found = searchAddonRef.current.findNext()
    return { found }
  }, [])

  const handleFindPrevious = useCallback((): SearchResult => {
    if (!searchAddonRef.current) {
      return { found: false }
    }

    const found = searchAddonRef.current.findPrevious()
    return { found }
  }, [])

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

      {/* Search overlay */}
      <TerminalSearch
        isOpen={searchOpen}
        onClose={handleSearchClose}
        onSearch={handleSearch}
        onFindNext={handleFindNext}
        onFindPrevious={handleFindPrevious}
      />
    </div>
  )
})
