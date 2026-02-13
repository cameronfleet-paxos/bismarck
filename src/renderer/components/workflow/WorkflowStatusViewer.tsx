import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, MinusCircle, Loader2, Circle } from 'lucide-react'
import { nodeTypeConfig, getNodeSummary } from './WorkflowNode'
import type { WorkflowNode, WorkflowEdge } from '@/shared/cron-types'

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

interface WorkflowStatusViewerProps {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  nodeStatuses: Map<string, NodeStatus>
}

function StatusBadge({ status }: { status: NodeStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-400" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-400" />
    case 'skipped':
      return <MinusCircle className="h-4 w-4 text-muted-foreground" />
    case 'pending':
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/50" />
  }
}

export function WorkflowStatusViewer({ nodes, edges, nodeStatuses }: WorkflowStatusViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Auto-fit on mount and when nodes change
  useEffect(() => {
    if (nodes.length === 0 || !containerRef.current) return

    const minX = Math.min(...nodes.map(n => n.position.x))
    const maxX = Math.max(...nodes.map(n => n.position.x)) + 220
    const minY = Math.min(...nodes.map(n => n.position.y))
    const maxY = Math.max(...nodes.map(n => n.position.y)) + 80

    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const scaleX = cw / (maxX - minX + 80)
    const scaleY = ch / (maxY - minY + 80)
    const newZoom = Math.min(scaleX, scaleY, 1.5)

    setZoom(newZoom)
    setPan({
      x: (cw - (maxX - minX) * newZoom) / 2 - minX * newZoom,
      y: (ch - (maxY - minY) * newZoom) / 2 - minY * newZoom,
    })
  }, [nodes])

  const getNodeCenter = (nodeId: string): { x: number; y: number } => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    return { x: node.position.x + 100, y: node.position.y + 40 }
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-muted/30 rounded-lg">
      {/* SVG edges */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {edges.map(edge => {
            const from = getNodeCenter(edge.source)
            const to = getNodeCenter(edge.target)
            const fromY = from.y + 40
            const toY = to.y - 40
            return (
              <path
                key={edge.id}
                d={`M ${from.x} ${fromY} C ${from.x} ${fromY + 50}, ${to.x} ${toY - 50}, ${to.x} ${toY}`}
                fill="none"
                stroke="oklch(0.6 0.05 250)"
                strokeWidth={2}
                markerEnd="url(#status-arrowhead)"
              />
            )
          })}
          <defs>
            <marker
              id="status-arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="oklch(0.6 0.05 250)" />
            </marker>
          </defs>
        </g>
      </svg>

      {/* Nodes */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          zIndex: 2,
        }}
      >
        {nodes.map(node => {
          const config = nodeTypeConfig[node.type]
          const Icon = config.icon
          const status = nodeStatuses.get(node.id) || 'pending'
          const isRunning = status === 'running'

          return (
            <div
              key={node.id}
              className="absolute select-none"
              style={{
                left: node.position.x,
                top: node.position.y,
                width: 220,
              }}
            >
              <div
                className={`rounded-lg border ${config.border} ${config.bg} bg-card shadow-sm transition-all ${
                  isRunning ? 'ring-2 ring-blue-500/50' : ''
                }`}
              >
                <div className="flex items-center gap-2 p-3">
                  <div className={`shrink-0 ${config.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {node.label || config.label}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {getNodeSummary(node)}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={status} />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none" style={{ zIndex: 3 }}>
          <p className="text-sm">No workflow nodes</p>
        </div>
      )}
    </div>
  )
}
