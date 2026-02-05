import * as React from 'react'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  children: React.ReactNode
  className?: string
  side?: 'top' | 'bottom'
  delayMs?: number
}

export function Tooltip({
  content,
  children,
  className,
  side = 'top',
  delayMs = 100,
}: TooltipProps) {
  const [show, setShow] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), delayMs)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setShow(false)
  }

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {show && (
        <div
          role="tooltip"
          className={cn(
            'absolute z-50 px-2 py-1 text-xs font-medium text-popover-foreground bg-popover border rounded shadow-md whitespace-nowrap pointer-events-none',
            side === 'top' && 'bottom-full left-1/2 -translate-x-1/2 mb-1',
            side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-1',
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  )
}
