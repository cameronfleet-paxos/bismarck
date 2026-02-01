import { Circle, CheckCircle2, Loader2, AlertCircle, Send, Lock, Clock } from 'lucide-react'
import type { TaskAssignment, Agent, TaskNode, TaskNodeStatus } from '@/shared/types'
import { TaskDependencyIndicator } from './TaskDependencyIndicator'

interface TaskCardProps {
  assignment?: TaskAssignment
  agent?: Agent
  node?: TaskNode  // For showing planned tasks with graph info
  title?: string   // Override title if node not provided
  taskId?: string  // Override taskId if node not provided
}

// Status configuration for all possible task states
const statusConfig: Record<TaskNodeStatus, {
  icon: React.ReactNode
  label: string
  badgeClass: string
}> = {
  pending: {
    icon: <Clock className="h-3 w-3 text-muted-foreground" />,
    label: 'Pending',
    badgeClass: 'bg-muted text-muted-foreground',
  },
  sent: {
    icon: <Send className="h-3 w-3 text-blue-500" />,
    label: 'Sent',
    badgeClass: 'bg-blue-500/20 text-blue-500',
  },
  in_progress: {
    icon: <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />,
    label: 'In Progress',
    badgeClass: 'bg-yellow-500/20 text-yellow-500',
  },
  completed: {
    icon: <CheckCircle2 className="h-3 w-3 text-green-500" />,
    label: 'Completed',
    badgeClass: 'bg-green-500/20 text-green-500',
  },
  failed: {
    icon: <AlertCircle className="h-3 w-3 text-red-500" />,
    label: 'Failed',
    badgeClass: 'bg-red-500/20 text-red-500',
  },
  planned: {
    icon: <Circle className="h-3 w-3 text-muted-foreground" />,
    label: 'Planned',
    badgeClass: 'bg-muted text-muted-foreground',
  },
  ready: {
    icon: <Circle className="h-3 w-3 text-blue-500" />,
    label: 'Ready',
    badgeClass: 'bg-blue-500/10 text-blue-500 border border-blue-500/50',
  },
  blocked: {
    icon: <Lock className="h-3 w-3 text-red-400" />,
    label: 'Blocked',
    badgeClass: 'bg-red-500/10 text-red-400',
  },
}

export function TaskCard({ assignment, agent, node, title, taskId }: TaskCardProps) {
  // Determine status from node or assignment
  const status: TaskNodeStatus = node?.status || assignment?.status || 'planned'
  const config = statusConfig[status]

  // Determine display values
  const displayTitle = title || node?.title
  const displayId = taskId || node?.id || assignment?.beadId || ''

  // Border styling based on status
  const borderClass = node?.isOnCriticalPath
    ? 'border-orange-500/50'
    : status === 'ready'
    ? 'border-blue-500/50'
    : 'border-border'

  return (
    <div className={`flex items-center gap-2 p-2 rounded border bg-card ${borderClass}`}>
      {config.icon}
      <div className="flex-1 min-w-0">
        {displayTitle && (
          <div className="text-xs font-medium truncate">
            {displayTitle}
          </div>
        )}
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          {displayId}
        </div>
        {agent && (
          <div className="text-[10px] text-muted-foreground">
            {agent.name}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Dependency indicator */}
        {node && <TaskDependencyIndicator node={node} />}

        {/* Status badge */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.badgeClass}`}>
          {config.label}
        </span>
      </div>
    </div>
  )
}
