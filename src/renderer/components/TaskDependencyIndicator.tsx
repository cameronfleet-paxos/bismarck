import { Lock, ArrowRight } from 'lucide-react'
import type { TaskNode } from '@/shared/types'

interface TaskDependencyIndicatorProps {
  node: TaskNode
  className?: string
}

export function TaskDependencyIndicator({ node, className = '' }: TaskDependencyIndicatorProps) {
  const hasBlockers = node.blockedBy.length > 0
  const blocksOthers = node.blocks.length > 0
  const incompleteBlockers = node.status === 'blocked' ? node.blockedBy.length : 0

  if (!hasBlockers && !blocksOthers && !node.isOnCriticalPath) {
    return null
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {/* Critical path indicator */}
      {node.isOnCriticalPath && (
        <span
          className="px-1 py-0.5 rounded text-[9px] font-medium bg-orange-500/20 text-orange-500"
          title="On critical path"
        >
          critical
        </span>
      )}

      {/* Blocked by indicator */}
      {incompleteBlockers > 0 && (
        <span
          className="flex items-center gap-0.5 text-red-400"
          title={`Blocked by ${incompleteBlockers} task${incompleteBlockers > 1 ? 's' : ''}`}
        >
          <Lock className="h-3 w-3" />
          <span className="text-[10px]">{incompleteBlockers}</span>
        </span>
      )}

      {/* Blocks others indicator */}
      {blocksOthers && (
        <span
          className="flex items-center gap-0.5 text-muted-foreground"
          title={`Blocks ${node.blocks.length} task${node.blocks.length > 1 ? 's' : ''}`}
        >
          <ArrowRight className="h-3 w-3" />
          <span className="text-[10px]">{node.blocks.length}</span>
        </span>
      )}
    </div>
  )
}
