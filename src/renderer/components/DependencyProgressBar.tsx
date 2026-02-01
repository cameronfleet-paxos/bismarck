import type { GraphStats } from '@/shared/types'

interface DependencyProgressBarProps {
  stats: GraphStats
  className?: string
}

export function DependencyProgressBar({ stats, className = '' }: DependencyProgressBarProps) {
  const { total, completed, inProgress, sent, ready, blocked, failed } = stats

  if (total === 0) return null

  // Calculate percentages
  const completedPct = (completed / total) * 100
  const inProgressPct = ((inProgress + sent) / total) * 100
  const readyPct = (ready / total) * 100
  const blockedPct = (blocked / total) * 100
  const failedPct = (failed / total) * 100

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
        {completedPct > 0 && (
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${completedPct}%` }}
            title={`${completed} completed`}
          />
        )}
        {inProgressPct > 0 && (
          <div
            className="h-full bg-yellow-500 transition-all duration-300"
            style={{ width: `${inProgressPct}%` }}
            title={`${inProgress + sent} in progress`}
          />
        )}
        {readyPct > 0 && (
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${readyPct}%` }}
            title={`${ready} ready`}
          />
        )}
        {blockedPct > 0 && (
          <div
            className="h-full bg-muted-foreground/30 transition-all duration-300"
            style={{ width: `${blockedPct}%` }}
            title={`${blocked} blocked`}
          />
        )}
        {failedPct > 0 && (
          <div
            className="h-full bg-red-500 transition-all duration-300"
            style={{ width: `${failedPct}%` }}
            title={`${failed} failed`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        {completed > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {completed} done
          </span>
        )}
        {(inProgress + sent) > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {inProgress + sent} running
          </span>
        )}
        {ready > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {ready} ready
          </span>
        )}
        {blocked > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
            {blocked} blocked
          </span>
        )}
        {failed > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {failed} failed
          </span>
        )}
      </div>
    </div>
  )
}
