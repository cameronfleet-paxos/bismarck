import { memo } from 'react'
import { Folder, Loader2 } from 'lucide-react'
import type { Agent, Plan, PlanStatus } from '@/shared/types'

interface CollapsedPlanGroupProps {
  plan: Plan
  agents: Agent[]
  waitingQueue: string[]
  activeTerminals: { terminalId: string; workspaceId: string }[]
  onExpandSidebar: () => void
}

function isActivePlanStatus(status: PlanStatus): boolean {
  return status === 'delegating' || status === 'in_progress'
}

export const CollapsedPlanGroup = memo(function CollapsedPlanGroup({
  plan,
  agents,
  waitingQueue,
  activeTerminals,
  onExpandSidebar,
}: CollapsedPlanGroupProps) {
  const waitingCount = agents.filter((a) => waitingQueue.includes(a.id)).length
  const hasActiveAgents = agents.some((a) =>
    activeTerminals.some((t) => t.workspaceId === a.id)
  )
  const isActive = isActivePlanStatus(plan.status)

  return (
    <button
      onClick={onExpandSidebar}
      className={`relative p-1.5 rounded-md hover:brightness-110 transition-[box-shadow,filter] duration-150 cursor-pointer bg-accent/50 ${
        waitingCount > 0 ? 'ring-2 ring-yellow-500' : ''
      }`}
      title={`${plan.title} (${agents.length} agents)`}
    >
      <div className="relative">
        <Folder className="w-5 h-5" />
        {/* Spinning loader overlay for active plans */}
        {isActive && hasActiveAgents && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
          </div>
        )}
      </div>
      {/* Agent count badge */}
      <span className="absolute -top-1 -right-1 text-[10px] bg-primary text-primary-foreground px-1 rounded-full min-w-[14px] text-center">
        {agents.length}
      </span>
    </button>
  )
})
