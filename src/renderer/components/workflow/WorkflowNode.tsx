import { Container, RefreshCw, TerminalSquare, X } from 'lucide-react'
import type { WorkflowNode } from '@/shared/cron-types'

interface WorkflowCanvasNodeProps {
  node: WorkflowNode
  isSelected: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onConnectStart: () => void
  onConnectEnd: () => void
  onDelete: () => void
}

const nodeTypeConfig = {
  'headless-agent': {
    icon: Container,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    selectedBorder: 'border-blue-500',
    label: 'Headless Agent',
  },
  'ralph-loop': {
    icon: RefreshCw,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    selectedBorder: 'border-purple-500',
    label: 'Ralph Loop',
  },
  'shell-command': {
    icon: TerminalSquare,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    selectedBorder: 'border-green-500',
    label: 'Shell Command',
  },
}

export function WorkflowCanvasNode({
  node,
  isSelected,
  onMouseDown,
  onConnectStart,
  onConnectEnd,
  onDelete,
}: WorkflowCanvasNodeProps) {
  const config = nodeTypeConfig[node.type]
  const Icon = config.icon

  return (
    <div
      className={`absolute select-none`}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: 200,
      }}
    >
      {/* Input handle (top) */}
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-muted border-2 border-muted-foreground/30 hover:border-primary hover:bg-primary/20 cursor-crosshair z-10"
        onMouseUp={(e) => {
          e.stopPropagation()
          onConnectEnd()
        }}
      />

      {/* Node body */}
      <div
        className={`rounded-lg border ${isSelected ? config.selectedBorder : config.border} ${config.bg} bg-card shadow-sm cursor-move transition-colors`}
        onMouseDown={onMouseDown}
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
          {isSelected && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="shrink-0 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Output handle (bottom) */}
      <div
        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-muted border-2 border-muted-foreground/30 hover:border-primary hover:bg-primary/20 cursor-crosshair z-10"
        onMouseDown={(e) => {
          e.stopPropagation()
          onConnectStart()
        }}
      />
    </div>
  )
}

function getNodeSummary(node: WorkflowNode): string {
  switch (node.type) {
    case 'headless-agent': {
      const data = node.data as { prompt?: string; model?: string }
      if (data.prompt) return data.prompt.slice(0, 40) + (data.prompt.length > 40 ? '...' : '')
      return 'Configure agent...'
    }
    case 'ralph-loop': {
      const data = node.data as { prompt?: string; maxIterations?: number }
      if (data.prompt) return `${data.maxIterations || '?'}x: ${data.prompt.slice(0, 30)}...`
      return 'Configure loop...'
    }
    case 'shell-command': {
      const data = node.data as { command?: string }
      if (data.command) return data.command.slice(0, 40) + (data.command.length > 40 ? '...' : '')
      return 'Configure command...'
    }
    default:
      return ''
  }
}
