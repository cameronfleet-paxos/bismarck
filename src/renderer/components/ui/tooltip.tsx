import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const TooltipRoot = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground border shadow-md animate-in fade-in-0 zoom-in-95',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

// Simple wrapper for common use case
interface TooltipProps {
  content: string
  children: React.ReactNode
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  delayMs?: number
}

function Tooltip({
  content,
  children,
  className,
  side = 'top',
  delayMs = 100,
}: TooltipProps) {
  return (
    <TooltipProvider delayDuration={delayMs}>
      <TooltipRoot>
        <TooltipTrigger asChild>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} className={className}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent }
