import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface SetupTerminalProps {
  terminalId: string
}

// Dark terminal theme colors
const TERMINAL_THEME = {
  background: '#1a1a1a',
  foreground: '#e0e0e0',
  cursor: '#e0e0e0',
  cursorAccent: '#1a1a1a',
}

export function SetupTerminal({ terminalId }: SetupTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!terminalRef.current || initializedRef.current) return
    initializedRef.current = true

    const xterm = new XTerm({
      theme: TERMINAL_THEME,
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

    // Handle user input
    xterm.onData((data) => {
      window.electronAPI.setupWizardWriteFixTerminal(terminalId, data)
    })

    // Set up data listener
    window.electronAPI.onSetupTerminalData((id: string, data: string) => {
      if (id === terminalId && xtermRef.current) {
        xtermRef.current.write(data)
      }
    })

    // Initial resize
    const { cols, rows } = xterm
    window.electronAPI.setupWizardResizeFixTerminal(terminalId, cols, rows)

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit()
        const { cols, rows } = xtermRef.current
        window.electronAPI.setupWizardResizeFixTerminal(terminalId, cols, rows)
      }
    })

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current)
    }

    // Focus terminal
    setTimeout(() => {
      xterm.focus()
    }, 100)

    return () => {
      resizeObserver.disconnect()
      xterm.dispose()
      window.electronAPI.removeSetupTerminalListeners()
      initializedRef.current = false
    }
  }, [terminalId])

  return (
    <div
      ref={terminalRef}
      className="w-full h-full overflow-hidden rounded"
      style={{ backgroundColor: TERMINAL_THEME.background }}
    />
  )
}
