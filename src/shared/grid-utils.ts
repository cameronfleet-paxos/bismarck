import type { GridSize } from './types'

export interface GridConfig {
  cols: number
  rows: number
  maxAgents: number
  positions: number[]
}

export function getGridConfig(gridSize: GridSize): GridConfig {
  switch (gridSize) {
    case '1x1':
      return { cols: 1, rows: 1, maxAgents: 1, positions: [0] }
    case '2x2':
      return { cols: 2, rows: 2, maxAgents: 4, positions: [0, 1, 2, 3] }
    case '2x3':
      return { cols: 2, rows: 3, maxAgents: 6, positions: [0, 1, 2, 3, 4, 5] }
    case '3x3':
      return { cols: 3, rows: 3, maxAgents: 9, positions: [0, 1, 2, 3, 4, 5, 6, 7, 8] }
    default:
      return { cols: 2, rows: 2, maxAgents: 4, positions: [0, 1, 2, 3] }
  }
}

export function getGridPosition(position: number, cols: number): { row: number; col: number } {
  return {
    row: Math.floor(position / cols) + 1, // 1-indexed for CSS grid
    col: (position % cols) + 1,
  }
}

// Minimum proportion constraint (15% of dimension)
const MIN_PROPORTION = 0.15

/**
 * Get default equal proportions for a grid dimension
 * @param count Number of columns or rows
 * @returns Array of equal proportions that sum to 1
 */
export function getDefaultProportions(count: number): number[] {
  const proportion = 1 / count
  return Array(count).fill(proportion)
}

/**
 * Normalize proportions to ensure they sum to 1 and respect minimum constraints
 * @param proportions Raw proportions array
 * @returns Normalized proportions that sum to 1
 */
export function normalizeProportions(proportions: number[]): number[] {
  if (proportions.length === 0) return []

  // Enforce minimum constraint
  const constrainedProps = proportions.map((p) => Math.max(p, MIN_PROPORTION))

  // Normalize to sum to 1
  const sum = constrainedProps.reduce((acc, p) => acc + p, 0)
  return constrainedProps.map((p) => p / sum)
}

/**
 * Convert proportions array to CSS grid template string
 * @param proportions Normalized proportions (e.g., [0.6, 0.4])
 * @returns CSS grid template string (e.g., "3fr 2fr")
 */
export function proportionsToCssGrid(proportions: number[]): string {
  if (proportions.length === 0) return '1fr'

  // Convert to fractional units (multiply by 10 to avoid tiny decimals)
  const fractions = proportions.map((p) => Math.round(p * 100))
  return fractions.map((f) => `${f}fr`).join(' ')
}

/**
 * Update proportions after dragging a resize handle
 * @param proportions Current proportions
 * @param handleIndex Index of handle being dragged (0-based, between cells)
 * @param delta Change in pixels
 * @param containerSize Total container size in pixels
 * @returns Updated proportions with minimum constraints enforced
 */
export function updateProportionsFromDrag(
  proportions: number[],
  handleIndex: number,
  delta: number,
  containerSize: number
): number[] {
  if (handleIndex < 0 || handleIndex >= proportions.length - 1) return proportions
  if (containerSize <= 0) return proportions

  // Convert delta to proportion change
  const deltaProportions = delta / containerSize

  // Update adjacent cells (handleIndex is on the right/bottom of cell at handleIndex)
  const updated = [...proportions]
  updated[handleIndex] += deltaProportions
  updated[handleIndex + 1] -= deltaProportions

  // Normalize to enforce constraints
  return normalizeProportions(updated)
}
