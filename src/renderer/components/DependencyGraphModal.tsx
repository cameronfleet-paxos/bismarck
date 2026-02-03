import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { X, ZoomIn, ZoomOut, RotateCcw, CheckCircle2, Loader2, Lock, Circle, AlertCircle, Send, Clock } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import type { DependencyGraph, TaskNode, GraphStats } from '@/shared/types'
import { getUpstreamChain, getDownstreamChain } from '@/renderer/utils/build-dependency-graph'

interface DependencyGraphModalProps {
  isOpen: boolean
  onClose: () => void
  graph: DependencyGraph
  stats: GraphStats
  planTitle: string
}

// Layout constants
const NODE_WIDTH = 200
const NODE_HEIGHT = 56
const HORIZONTAL_GAP = 60
const VERTICAL_GAP = 24
const PADDING = 40

// Edge port distribution constants
const PORT_SPACING = 8          // Pixels between ports
const MAX_PORT_RANGE = 0.6      // Use 60% of node height for ports

// Status icons and colors - using actual color values for SVG compatibility
const statusConfig: Record<string, {
  icon: React.ReactNode
  color: string
  bgColor: string
  fillColor: string
  strokeColor: string
}> = {
  completed: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-green-500',
    bgColor: 'bg-green-500/20 border-green-500',
    fillColor: 'rgba(34, 197, 94, 0.15)',
    strokeColor: 'rgb(34, 197, 94)',
  },
  in_progress: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/20 border-yellow-500',
    fillColor: 'rgba(234, 179, 8, 0.15)',
    strokeColor: 'rgb(234, 179, 8)',
  },
  sent: {
    icon: <Send className="h-4 w-4" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/20 border-blue-500',
    fillColor: 'rgba(59, 130, 246, 0.15)',
    strokeColor: 'rgb(59, 130, 246)',
  },
  pending: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted border-border',
    fillColor: 'rgba(107, 114, 128, 0.1)',
    strokeColor: 'rgb(107, 114, 128)',
  },
  ready: {
    icon: <Circle className="h-4 w-4" />,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10 border-blue-500',
    fillColor: 'rgba(59, 130, 246, 0.1)',
    strokeColor: 'rgb(59, 130, 246)',
  },
  blocked: {
    icon: <Lock className="h-4 w-4" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-400',
    fillColor: 'rgba(251, 146, 60, 0.1)',
    strokeColor: 'rgb(251, 146, 60)',
  },
  planned: {
    icon: <Circle className="h-4 w-4" />,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted border-border',
    fillColor: 'rgba(107, 114, 128, 0.1)',
    strokeColor: 'rgb(107, 114, 128)',
  },
  failed: {
    icon: <AlertCircle className="h-4 w-4" />,
    color: 'text-red-500',
    bgColor: 'bg-red-500/20 border-red-500',
    fillColor: 'rgba(239, 68, 68, 0.15)',
    strokeColor: 'rgb(239, 68, 68)',
  },
}

interface NodePosition {
  x: number
  y: number
}

/**
 * Calculate node positions for the graph layout
 * Nodes are positioned by depth (left to right), with vertical spacing within each depth
 */
function calculateLayout(graph: DependencyGraph): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>()

  // Group nodes by depth
  const depthGroups = new Map<number, TaskNode[]>()
  for (const node of graph.nodes.values()) {
    const group = depthGroups.get(node.depth) || []
    group.push(node)
    depthGroups.set(node.depth, group)
  }

  // Position nodes
  for (let depth = 0; depth <= graph.maxDepth; depth++) {
    const nodesAtDepth = depthGroups.get(depth) || []
    const x = PADDING + depth * (NODE_WIDTH + HORIZONTAL_GAP)

    // Sort nodes at this depth by their blockers to minimize edge crossings
    nodesAtDepth.sort((a, b) => {
      const aBlocker = a.blockedBy[0] || ''
      const bBlocker = b.blockedBy[0] || ''
      return aBlocker.localeCompare(bBlocker)
    })

    nodesAtDepth.forEach((node, index) => {
      const y = PADDING + index * (NODE_HEIGHT + VERTICAL_GAP)
      positions.set(node.id, { x, y })
    })
  }

  return positions
}

/**
 * Calculate SVG dimensions based on node positions
 */
function calculateSvgDimensions(
  positions: Map<string, NodePosition>,
  maxDepth: number,
  maxNodesInColumn: number
): { width: number; height: number } {
  const width = PADDING * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * HORIZONTAL_GAP
  const height = PADDING * 2 + maxNodesInColumn * NODE_HEIGHT + (maxNodesInColumn - 1) * VERTICAL_GAP

  return { width: Math.max(width, 400), height: Math.max(height, 200) }
}

interface EdgePort {
  sourcePort: number  // Y offset from node center for source
  targetPort: number  // Y offset from node center for target
}

/**
 * Calculate vertical port offsets for edges to prevent overlapping.
 * Edges are distributed along the vertical edge of nodes, sorted by the Y position
 * of their counterpart to minimize crossings.
 */
function calculateEdgePorts(
  edges: DependencyGraph['edges'],
  positions: Map<string, NodePosition>
): Map<string, EdgePort> {
  const ports = new Map<string, EdgePort>()

  // Group edges by their source node (outgoing edges)
  const outgoingByNode = new Map<string, Array<{ to: string; edgeKey: string }>>()
  // Group edges by their target node (incoming edges)
  const incomingByNode = new Map<string, Array<{ from: string; edgeKey: string }>>()

  for (const edge of edges) {
    const edgeKey = `${edge.from}-${edge.to}`

    const outgoing = outgoingByNode.get(edge.from) || []
    outgoing.push({ to: edge.to, edgeKey })
    outgoingByNode.set(edge.from, outgoing)

    const incoming = incomingByNode.get(edge.to) || []
    incoming.push({ from: edge.from, edgeKey })
    incomingByNode.set(edge.to, incoming)
  }

  // Calculate source ports (right side of source nodes)
  for (const [nodeId, outgoing] of outgoingByNode) {
    // Sort by target Y position for clean routing
    outgoing.sort((a, b) => {
      const posA = positions.get(a.to)
      const posB = positions.get(b.to)
      return (posA?.y ?? 0) - (posB?.y ?? 0)
    })

    const count = outgoing.length
    const maxRange = NODE_HEIGHT * MAX_PORT_RANGE
    const totalSpan = Math.min((count - 1) * PORT_SPACING, maxRange)
    const startOffset = -totalSpan / 2

    outgoing.forEach((edge, index) => {
      const offset = count === 1 ? 0 : startOffset + (index * totalSpan) / (count - 1)
      const existing = ports.get(edge.edgeKey) || { sourcePort: 0, targetPort: 0 }
      ports.set(edge.edgeKey, { ...existing, sourcePort: offset })
    })
  }

  // Calculate target ports (left side of target nodes)
  for (const [nodeId, incoming] of incomingByNode) {
    // Sort by source Y position for clean routing
    incoming.sort((a, b) => {
      const posA = positions.get(a.from)
      const posB = positions.get(b.from)
      return (posA?.y ?? 0) - (posB?.y ?? 0)
    })

    const count = incoming.length
    const maxRange = NODE_HEIGHT * MAX_PORT_RANGE
    const totalSpan = Math.min((count - 1) * PORT_SPACING, maxRange)
    const startOffset = -totalSpan / 2

    incoming.forEach((edge, index) => {
      const offset = count === 1 ? 0 : startOffset + (index * totalSpan) / (count - 1)
      const existing = ports.get(edge.edgeKey) || { sourcePort: 0, targetPort: 0 }
      ports.set(edge.edgeKey, { ...existing, targetPort: offset })
    })
  }

  return ports
}

export function DependencyGraphModal({
  isOpen,
  onClose,
  graph,
  stats,
  planTitle,
}: DependencyGraphModalProps) {
  const [zoom, setZoom] = useState(1)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Calculate layout
  const positions = useMemo(() => calculateLayout(graph), [graph])

  // Calculate max nodes in any column for height calculation
  const maxNodesInColumn = useMemo(() => {
    const depthCounts = new Map<number, number>()
    for (const node of graph.nodes.values()) {
      depthCounts.set(node.depth, (depthCounts.get(node.depth) || 0) + 1)
    }
    return Math.max(1, ...depthCounts.values())
  }, [graph])

  // Calculate SVG dimensions
  const dimensions = useMemo(
    () => calculateSvgDimensions(positions, graph.maxDepth, maxNodesInColumn),
    [positions, graph.maxDepth, maxNodesInColumn]
  )

  // Calculate edge port offsets for distributed connections
  const edgePorts = useMemo(
    () => calculateEdgePorts(graph.edges, positions),
    [graph.edges, positions]
  )

  // Get highlighted nodes (for hover/selection)
  const highlightedNodes = useMemo(() => {
    const nodeId = hoveredNodeId || selectedNodeId
    if (!nodeId) return new Set<string>()

    const upstream = getUpstreamChain(nodeId, graph)
    const downstream = getDownstreamChain(nodeId, graph)
    return new Set([nodeId, ...upstream, ...downstream])
  }, [hoveredNodeId, selectedNodeId, graph])

  // Selected node details
  const selectedNode = selectedNodeId ? graph.nodes.get(selectedNodeId) : null

  // Zoom handlers
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.2, 2)), [])
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.2, 0.4)), [])
  const handleZoomReset = useCallback(() => setZoom(1), [])

  // Reset selection when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedNodeId(null)
      setHoveredNodeId(null)
      setZoom(1)
    }
  }, [isOpen])

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedNodeId) {
          setSelectedNodeId(null)
        } else {
          onClose()
        }
      }
    }

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, selectedNodeId, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div>
          <h2 className="font-medium">Dependency Graph</h2>
          <p className="text-sm text-muted-foreground">{planTitle}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b bg-muted/30 shrink-0 text-sm">
        <span className="flex items-center gap-1 text-green-500">
          <CheckCircle2 className="h-3 w-3" />
          {stats.completed}/{stats.total}
        </span>
        {stats.inProgress + stats.sent > 0 && (
          <span className="flex items-center gap-1 text-yellow-500">
            <Loader2 className="h-3 w-3" />
            {stats.inProgress + stats.sent} running
          </span>
        )}
        {stats.ready > 0 && (
          <span className="flex items-center gap-1 text-blue-500">
            <Circle className="h-3 w-3" />
            {stats.ready} ready
          </span>
        )}
        {stats.blocked > 0 && (
          <span className="flex items-center gap-1 text-orange-400">
            <Lock className="h-3 w-3" />
            {stats.blocked} blocked
          </span>
        )}

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoom <= 0.4}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoom >= 2}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleZoomReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Legend:</span>
          <span className="text-orange-500">══ critical</span>
          <span className="text-muted-foreground">── dependency</span>
        </div>
      </div>

      {/* Graph area */}
      <div className="flex-1 min-h-0 flex">
        {/* Graph container - centered */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto flex items-center justify-center"
          onClick={() => setSelectedNodeId(null)}
        >
          <svg
            width={dimensions.width * zoom}
            height={dimensions.height * zoom}
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            className="select-none"
          >
            {/* Edges */}
            <g>
              {graph.edges.map((edge) => {
                const fromPos = positions.get(edge.from)
                const toPos = positions.get(edge.to)
                if (!fromPos || !toPos) return null

                const isHighlighted =
                  highlightedNodes.has(edge.from) && highlightedNodes.has(edge.to)
                const opacity = highlightedNodes.size > 0 && !isHighlighted ? 0.2 : 1

                // Get port offsets for this edge
                const edgeKey = `${edge.from}-${edge.to}`
                const ports = edgePorts.get(edgeKey) || { sourcePort: 0, targetPort: 0 }

                // Bezier curve from right edge of source to left edge of target
                // Apply port offsets to distribute edges vertically
                const startX = fromPos.x + NODE_WIDTH
                const startY = fromPos.y + NODE_HEIGHT / 2 + ports.sourcePort
                const endX = toPos.x
                const endY = toPos.y + NODE_HEIGHT / 2 + ports.targetPort
                const controlOffset = (endX - startX) / 2

                // Add slight curve variation based on port offset to avoid overlapping curves
                const curveVariation = (ports.sourcePort + ports.targetPort) * 0.3
                const path = `M ${startX} ${startY} C ${startX + controlOffset} ${startY + curveVariation}, ${endX - controlOffset} ${endY - curveVariation}, ${endX} ${endY}`

                const markerId = edge.isOnCriticalPath ? 'arrowhead-critical' : 'arrowhead'

                return (
                  <path
                    key={edgeKey}
                    d={path}
                    fill="none"
                    stroke={edge.isOnCriticalPath ? '#f97316' : '#6b7280'}
                    strokeWidth={edge.isOnCriticalPath ? 3 : 1.5}
                    strokeOpacity={opacity}
                    markerEnd={`url(#${markerId})`}
                  />
                )
              })}
            </g>

            {/* Arrow marker definitions */}
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="#6b7280"
                />
              </marker>
              <marker
                id="arrowhead-critical"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon
                  points="0 0, 10 3.5, 0 7"
                  fill="#f97316"
                />
              </marker>
            </defs>

            {/* Nodes */}
            {Array.from(graph.nodes.values()).map((node) => {
              const pos = positions.get(node.id)
              if (!pos) return null

              const config = statusConfig[node.status] || statusConfig.planned
              const isSelected = selectedNodeId === node.id
              const isHovered = hoveredNodeId === node.id
              const isInChain = highlightedNodes.has(node.id)
              const opacity =
                highlightedNodes.size > 0 && !isInChain ? 0.3 : 1

              // Determine stroke based on state
              let strokeColor = config.strokeColor
              let strokeWidth = 1.5
              if (isSelected) {
                strokeColor = 'rgb(147, 197, 253)' // primary blue
                strokeWidth = 2
              } else if (isHovered) {
                strokeWidth = 2
              } else if (node.isOnCriticalPath) {
                strokeColor = '#f97316' // orange-500
                strokeWidth = 2
              }

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedNodeId(node.id)
                  }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  style={{ cursor: 'pointer', opacity }}
                >
                  {/* Node background */}
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill={config.fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />

                  {/* Status icon */}
                  <foreignObject x={10} y={NODE_HEIGHT / 2 - 8} width={16} height={16}>
                    <div className={config.color}>{config.icon}</div>
                  </foreignObject>

                  {/* Title */}
                  <text
                    x={32}
                    y={NODE_HEIGHT / 2 - 4}
                    fontSize={12}
                    fontWeight={500}
                    fill="#e5e7eb"
                  >
                    {node.title.length > 22
                      ? node.title.substring(0, 20) + '...'
                      : node.title}
                  </text>

                  {/* Task ID */}
                  <text
                    x={32}
                    y={NODE_HEIGHT / 2 + 12}
                    fontSize={10}
                    fill="#9ca3af"
                  >
                    {node.id}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="w-64 border-l bg-card p-4 overflow-y-auto shrink-0">
            <h3 className="font-medium mb-1">{selectedNode.title}</h3>
            <p className="text-xs text-muted-foreground font-mono mb-3">
              {selectedNode.id}
            </p>

            {/* Status */}
            <div className="mb-3">
              <span className="text-xs text-muted-foreground">Status:</span>
              <div
                className={`inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-xs ${
                  statusConfig[selectedNode.status]?.color || ''
                } ${statusConfig[selectedNode.status]?.bgColor || ''}`}
              >
                {statusConfig[selectedNode.status]?.icon}
                {selectedNode.status}
              </div>
            </div>

            {/* Critical path indicator */}
            {selectedNode.isOnCriticalPath && (
              <div className="mb-3 px-2 py-1 rounded bg-orange-500/10 text-orange-500 text-xs">
                On critical path
              </div>
            )}

            {/* Blocked by */}
            {selectedNode.blockedBy.length > 0 && (
              <div className="mb-3">
                <span className="text-xs text-muted-foreground">
                  Blocked by ({selectedNode.blockedBy.length}):
                </span>
                <div className="mt-1 space-y-1">
                  {selectedNode.blockedBy.map((blockerId) => {
                    const blocker = graph.nodes.get(blockerId)
                    return (
                      <button
                        key={blockerId}
                        className="w-full text-left text-xs p-1 rounded hover:bg-muted truncate"
                        onClick={() => setSelectedNodeId(blockerId)}
                      >
                        <span
                          className={statusConfig[blocker?.status || 'planned']?.color}
                        >
                          {statusConfig[blocker?.status || 'planned']?.icon}
                        </span>{' '}
                        {blocker?.title || blockerId}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Blocks */}
            {selectedNode.blocks.length > 0 && (
              <div className="mb-3">
                <span className="text-xs text-muted-foreground">
                  Blocks ({selectedNode.blocks.length}):
                </span>
                <div className="mt-1 space-y-1">
                  {selectedNode.blocks.map((blockedId) => {
                    const blocked = graph.nodes.get(blockedId)
                    return (
                      <button
                        key={blockedId}
                        className="w-full text-left text-xs p-1 rounded hover:bg-muted truncate"
                        onClick={() => setSelectedNodeId(blockedId)}
                      >
                        <span
                          className={statusConfig[blocked?.status || 'planned']?.color}
                        >
                          {statusConfig[blocked?.status || 'planned']?.icon}
                        </span>{' '}
                        {blocked?.title || blockedId}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Assignment info */}
            {selectedNode.assignment && (
              <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                <p>
                  Assigned:{' '}
                  {new Date(selectedNode.assignment.assignedAt).toLocaleString()}
                </p>
                {selectedNode.assignment.completedAt && (
                  <p>
                    Completed:{' '}
                    {new Date(selectedNode.assignment.completedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
