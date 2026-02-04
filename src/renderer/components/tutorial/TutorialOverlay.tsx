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
const TOOLTIP_WIDTH = 400
const TOOLTIP_GAP = 16

function getTooltipPosition(
  spotlight: SpotlightRect,
  placement: 'top' | 'bottom' | 'left' | 'right' = 'bottom'
): React.CSSProperties {
  const tooltipHeight = 250 // Approximate height for positioning calculations

  // Calculate horizontal center position (used for top/bottom placements)
  const horizontalCenter = Math.max(
    TOOLTIP_GAP,
    Math.min(
      window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_GAP,
      spotlight.x + spotlight.width / 2 - TOOLTIP_WIDTH / 2
    )
  )

  // Calculate vertical center position (used for left/right placements)
  const verticalCenter = Math.max(
    TOOLTIP_GAP,
    Math.min(
      window.innerHeight - tooltipHeight - TOOLTIP_GAP,
      spotlight.y + spotlight.height / 2 - tooltipHeight / 2
    )
  )

  // Check available space in each direction
  const spaceAbove = spotlight.y - TOOLTIP_GAP
  const spaceBelow = window.innerHeight - (spotlight.y + spotlight.height) - TOOLTIP_GAP
  const spaceLeft = spotlight.x - TOOLTIP_GAP
  const spaceRight = window.innerWidth - (spotlight.x + spotlight.width) - TOOLTIP_GAP

  // Determine effective placement with fallback
  let effectivePlacement = placement

  if (placement === 'top' && spaceAbove < tooltipHeight) {
    // Not enough space above, try right side of spotlight
    effectivePlacement = spaceRight >= TOOLTIP_WIDTH ? 'right' : 'bottom'
  } else if (placement === 'bottom' && spaceBelow < tooltipHeight) {
    effectivePlacement = spaceAbove >= tooltipHeight ? 'top' : 'right'
  } else if (placement === 'left' && spaceLeft < TOOLTIP_WIDTH) {
    effectivePlacement = spaceRight >= TOOLTIP_WIDTH ? 'right' : 'bottom'
  } else if (placement === 'right' && spaceRight < TOOLTIP_WIDTH) {
    effectivePlacement = spaceLeft >= TOOLTIP_WIDTH ? 'left' : 'bottom'
  }

  switch (effectivePlacement) {
    case 'top':
      return {
        top: Math.max(TOOLTIP_GAP, spotlight.y - tooltipHeight - TOOLTIP_GAP),
        left: horizontalCenter,
        zIndex: 10000,
      }
    case 'bottom':
      return {
        top: Math.min(
          window.innerHeight - tooltipHeight - TOOLTIP_GAP,
          spotlight.y + spotlight.height + TOOLTIP_GAP
        ),
        left: horizontalCenter,
        zIndex: 10000,
      }
    case 'left':
      return {
        top: verticalCenter,
        left: Math.max(TOOLTIP_GAP, spotlight.x - TOOLTIP_WIDTH - TOOLTIP_GAP),
        zIndex: 10000,
      }
    case 'right':
      return {
        top: verticalCenter,
        left: Math.min(
          window.innerWidth - TOOLTIP_WIDTH - TOOLTIP_GAP,
          spotlight.x + spotlight.width + TOOLTIP_GAP
        ),
        zIndex: 10000,
      }
  }
}

export function TutorialOverlay({ step, isActive, children }: TutorialOverlayProps) {
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null)

  // Centered mode: when target is 'center' OR when target element is not found (fallback)
  const isCentered = step.target === 'center' || (spotlightRect && spotlightRect.width === 0 && spotlightRect.height === 0)

  const calculateSpotlight = useCallback(() => {
    if (!isActive) {
      setSpotlightRect(null)
      return
    }

    // Special case: 'center' target shows no spotlight, just dark overlay with centered tooltip
    if (step.target === 'center') {
      // Set a dummy rect so the overlay renders, but we won't show a spotlight
      setSpotlightRect({ x: 0, y: 0, width: 0, height: 0 })
      return
    }

    const targetElement = document.querySelector(`[data-tutorial="${step.target}"]`)
    if (!targetElement) {
      console.warn(`Tutorial target element not found: [data-tutorial="${step.target}"], falling back to centered`)
      // Fallback to centered display when target not found
      setSpotlightRect({ x: 0, y: 0, width: 0, height: 0 })
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
  // Calculate spotlight position on mount and when step changes
  // Delay calculation to allow onEnter actions to execute first
  useEffect(() => {
    const timer = setTimeout(calculateSpotlight, 150)
    return () => clearTimeout(timer)
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
      {/* SVG overlay with spotlight cutout (or solid overlay for centered) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        style={{ zIndex: 9999 }}
      >
        {!isCentered && (
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
        )}

        {/* Dark overlay - solid for centered, with cutout for spotlight */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.75)"
          mask={isCentered ? undefined : "url(#tutorial-spotlight-mask)"}
          style={{ transition: 'all 300ms ease-in-out' }}
        />

        {/* Highlight border around spotlight (not shown for centered) */}
        {!isCentered && (
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
        )}
      </svg>

      {/* Tooltip content - centered or positioned relative to spotlight */}
      {children && (
        <div
          className="absolute pointer-events-auto"
          style={isCentered
            ? {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 10000,
              }
            : getTooltipPosition(spotlightRect, step.placement)
          }
        >
          {children}
        </div>
      )}
    </div>,
    document.body
  )
}
