import { useRef, useState, useEffect, useCallback } from 'react'
import { X, Minus } from 'lucide-react'
import { Terminal } from './Terminal'
import type { ThemeName } from '@/shared/types'

interface FloatingTerminalProps {
  terminalId: string
  name: string
  theme: ThemeName
  onClose: () => void
  registerWriter: (terminalId: string, writer: (data: string) => void) => void
  unregisterWriter: (terminalId: string) => void
  getBufferedContent: (terminalId: string) => string | null
}

const MIN_WIDTH = 400
const MIN_HEIGHT = 240
const DEFAULT_WIDTH = 680
const DEFAULT_HEIGHT = 420

export function FloatingTerminal({
  terminalId,
  name,
  theme,
  onClose,
  registerWriter,
  unregisterWriter,
  getBufferedContent,
}: FloatingTerminalProps) {
  const [pos, setPos] = useState({ x: 80, y: 80 })
  const [size, setSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT })
  const [minimized, setMinimized] = useState(false)
  const [visible, setVisible] = useState(true)

  const dragging = useRef(false)
  const resizing = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const resizeStart = useRef({ mouseX: 0, mouseY: 0, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT })

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    e.preventDefault()
  }, [pos])

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    resizing.current = true
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.w, h: size.h }
    e.preventDefault()
    e.stopPropagation()
  }, [size])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
      } else if (resizing.current) {
        const dx = e.clientX - resizeStart.current.mouseX
        const dy = e.clientY - resizeStart.current.mouseY
        setSize({
          w: Math.max(MIN_WIDTH, resizeStart.current.w + dx),
          h: Math.max(MIN_HEIGHT, resizeStart.current.h + dy),
        })
      }
    }
    const onMouseUp = () => {
      dragging.current = false
      resizing.current = false
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div
      className="fixed z-50 flex flex-col rounded-lg border border-border shadow-2xl overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 'auto' : size.h,
        backgroundColor: '#1a1a1a',
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-muted/80 border-b border-border select-none cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onTitleMouseDown}
      >
        <span className="text-xs font-medium text-foreground flex-1 truncate">{name}</span>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={() => setMinimized(m => !m)}
          className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={minimized ? 'Restore' : 'Minimize'}
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
          title="Close"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Terminal body */}
      {!minimized && (
        <div className="flex-1 overflow-hidden relative">
          <Terminal
            terminalId={terminalId}
            theme={theme}
            isBooting={false}
            isVisible={visible}
            registerWriter={registerWriter}
            unregisterWriter={unregisterWriter}
            getBufferedContent={getBufferedContent}
          />
          {/* Resize handle */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
            onMouseDown={onResizeMouseDown}
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.15) 50%)',
            }}
          />
        </div>
      )}
    </div>
  )
}
