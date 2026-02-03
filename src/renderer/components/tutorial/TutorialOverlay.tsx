import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { TutorialStepDefinition } from './tutorial-steps'

interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
  rx?: number
}

interface TutorialOverlayProps {
  step: TutorialStepDefinition
  isActive: boolean
  children?: React.ReactNode
}

const SPOTLIGHT_PADDING = 8
const SPOTLIGHT_RADIUS = 8

export function TutorialOverlay({ step, isActive, children }: TutorialOverlayProps) {
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null)

  const calculateSpotlight = useCallback(() => {
    if (!isActive) {
      setSpotlightRect(null)
      return
    }

    const targetElement = document.querySelector(`[data-tutorial="${step.target}"]`)
    if (!targetElement) {
      console.warn(`Tutorial target element not found: [data-tutorial="${step.target}"]`)
      setSpotlightRect(null)
      return
    }

    const rect = targetElement.getBoundingClientRect()
    setSpotlightRect({
      x: rect.x - SPOTLIGHT_PADDING,
      y: rect.y - SPOTLIGHT_PADDING,
      width: rect.width + SPOTLIGHT_PADDING * 2,
      height: rect.height + SPOTLIGHT_PADDING * 2,
      rx: SPOTLIGHT_RADIUS,
    })
  }, [isActive, step.target])

  // Calculate spotlight position on mount and when step changes
  useEffect(() => {
    calculateSpotlight()
  }, [calculateSpotlight])

  // Recalculate on window resize with debounce
  useEffect(() => {
    if (!isActive) return

    let timeoutId: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(calculateSpotlight, 150)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(timeoutId)
    }
  }, [isActive, calculateSpotlight])

  // Recalculate when DOM mutations occur (e.g., elements added/removed)
  useEffect(() => {
    if (!isActive) return

    const observer = new MutationObserver(() => {
      calculateSpotlight()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tutorial'],
    })

    return () => observer.disconnect()
  }, [isActive, calculateSpotlight])

  if (!isActive || !spotlightRect) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] pointer-events-none"
      style={{ isolation: 'isolate' }}
    >
      {/* SVG overlay with spotlight cutout */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        style={{ zIndex: 9999 }}
      >
        <defs>
          <mask id="tutorial-spotlight-mask">
            {/* White background (visible area) */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {/* Black cutout (transparent area) */}
            <rect
              x={spotlightRect.x}
              y={spotlightRect.y}
              width={spotlightRect.width}
              height={spotlightRect.height}
              rx={spotlightRect.rx}
              fill="black"
            />
          </mask>
        </defs>

        {/* Dark overlay with cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask="url(#tutorial-spotlight-mask)"
          style={{ transition: 'all 300ms ease-in-out' }}
        />

        {/* Highlight border around spotlight */}
        <rect
          x={spotlightRect.x}
          y={spotlightRect.y}
          width={spotlightRect.width}
          height={spotlightRect.height}
          rx={spotlightRect.rx}
          fill="none"
          stroke="rgba(59, 130, 246, 0.8)"
          strokeWidth="2"
          style={{
            transition: 'all 300ms ease-in-out',
            pointerEvents: 'none',
          }}
        />
      </svg>

      {/* Tooltip content positioned relative to spotlight */}
      {children && (
        <div
          className="absolute pointer-events-auto"
          style={{
            top: spotlightRect.y + spotlightRect.height + 16,
            left: Math.max(16, Math.min(
              window.innerWidth - 400 - 16,
              spotlightRect.x + spotlightRect.width / 2 - 200
            )),
            zIndex: 10000,
          }}
        >
          {children}
        </div>
      )}
    </div>,
    document.body
  )
}
