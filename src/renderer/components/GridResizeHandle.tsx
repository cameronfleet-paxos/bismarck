import React, { useCallback, useRef, useState } from 'react'

export interface GridResizeHandleProps {
  /**
   * Orientation: 'vertical' for column resize, 'horizontal' for row resize
   */
  orientation: 'vertical' | 'horizontal'

  /**
   * Index of the handle (0-based). For vertical handles, this is between columns.
   * Handle at index i is between cells i and i+1.
   */
  index: number

  /**
   * Callback when dragging completes with the total delta in pixels
   */
  onDragEnd: (index: number, delta: number) => void

  /**
   * Callback when handle is double-clicked (to reset proportions)
   */
  onDoubleClick: (index: number) => void

  /**
   * Container dimensions for calculating drag bounds
   */
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function GridResizeHandle({
  orientation,
  index,
  onDragEnd,
  onDoubleClick,
  containerRef: _containerRef,
}: GridResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false)
  const startPosRef = useRef<number>(0)
  const currentDeltaRef = useRef<number>(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      startPosRef.current = orientation === 'vertical' ? e.clientX : e.clientY
      currentDeltaRef.current = 0

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY
        currentDeltaRef.current = currentPos - startPosRef.current
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)

        // Call onDragEnd with final delta
        if (currentDeltaRef.current !== 0) {
          onDragEnd(index, currentDeltaRef.current)
        }
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [orientation, index, onDragEnd]
  )

  const handleDoubleClick = useCallback(() => {
    onDoubleClick(index)
  }, [index, onDoubleClick])

  const isVertical = orientation === 'vertical'

  return (
    <div
      data-testid={`resize-handle-${orientation}-${index}`}
      className={`
        absolute
        ${isVertical ? 'cursor-col-resize' : 'cursor-row-resize'}
        ${isDragging ? 'bg-blue-500/50' : 'hover:bg-gray-400/30'}
        transition-colors
        z-20
      `}
      style={{
        // Vertical handles: 8px wide, full height, positioned between columns
        ...(isVertical && {
          width: '8px',
          height: '100%',
          top: 0,
          left: `calc(${((index + 1) * 100) / (index + 2)}% - 4px)`, // Centered on grid gap
        }),
        // Horizontal handles: full width, 8px tall, positioned between rows
        ...(!isVertical && {
          width: '100%',
          height: '8px',
          left: 0,
          top: `calc(${((index + 1) * 100) / (index + 2)}% - 4px)`, // Centered on grid gap
        }),
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Visual indicator - 4px visible line in center of handle */}
      <div
        className={`
          ${isVertical ? 'w-1 h-full mx-auto' : 'h-1 w-full my-auto'}
          ${isDragging ? 'bg-blue-500' : 'bg-gray-300'}
          transition-colors
        `}
      />
    </div>
  )
}
