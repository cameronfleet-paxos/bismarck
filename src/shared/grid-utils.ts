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
