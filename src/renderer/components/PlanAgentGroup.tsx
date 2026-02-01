import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { AgentCard } from '@/renderer/components/WorkspaceCard'
import type { Agent, AgentTab, Plan, PlanStatus } from '@/shared/types'

interface PlanAgentGroupProps {
  plan: Plan
  agents: Agent[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  // Agent card props passed through
  activeTerminals: { terminalId: string; workspaceId: string }[]
  waitingQueue: string[]
  focusedAgentId: string | null
  tabs: AgentTab[]
  activeTabId: string | null
  onAgentClick: (agentId: string, agentTab: AgentTab | undefined) => void
  onEditAgent: (agent: Agent) => void
  onDeleteAgent: (agentId: string) => void
  onLaunchAgent: (agentId: string) => void
  onStopAgent: (agentId: string) => void
  onMoveToTab: (agentId: string, tabId: string) => void
  onStopHeadless: (agent: Agent) => void
}

function getPlanStatusIcon(status: PlanStatus): React.ReactNode {
  switch (status) {
    case 'delegating':
    case 'in_progress':
      return <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
    case 'ready_for_review':
      return <span className="w-2 h-2 rounded-full bg-yellow-500" />
    case 'completed':
      return <span className="w-2 h-2 rounded-full bg-green-500" />
    case 'failed':
      return <span className="w-2 h-2 rounded-full bg-red-500" />
    case 'draft':
    default:
      return <span className="w-2 h-2 rounded-full bg-gray-500" />
  }
}

export function PlanAgentGroup({
  plan,
  agents,
  isCollapsed,
  onToggleCollapse,
  activeTerminals,
  waitingQueue,
  focusedAgentId,
  tabs,
  activeTabId,
  onAgentClick,
  onEditAgent,
  onDeleteAgent,
  onLaunchAgent,
  onStopAgent,
  onMoveToTab,
  onStopHeadless,
}: PlanAgentGroupProps) {
  const waitingCount = agents.filter((a) => waitingQueue.includes(a.id)).length
  const activeCount = agents.filter((a) =>
    activeTerminals.some((t) => t.workspaceId === a.id)
  ).length

  return (
    <div className="mb-3">
      {/* Group Header */}
      <button
        onClick={onToggleCollapse}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors text-left"
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        {getPlanStatusIcon(plan.status)}
        <span className="font-medium text-sm truncate flex-1">{plan.title}</span>
        <span className="text-xs text-muted-foreground">
          {activeCount}/{agents.length}
        </span>
        {waitingCount > 0 && (
          <span className="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">
            {waitingCount}
          </span>
        )}
      </button>

      {/* Collapsible Content */}
      {!isCollapsed && (
        <div className="ml-3 pl-3 border-l border-border/50 mt-1 space-y-2">
          {agents.map((agent) => {
            const agentTab = tabs.find((t) => t.workspaceIds.includes(agent.id))
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                isActive={activeTerminals.some((t) => t.workspaceId === agent.id)}
                isWaiting={waitingQueue.includes(agent.id)}
                isFocused={focusedAgentId === agent.id}
                tabs={tabs}
                currentTabId={agentTab?.id}
                onClick={() => onAgentClick(agent.id, agentTab)}
                onEdit={() => onEditAgent(agent)}
                onDelete={() => onDeleteAgent(agent.id)}
                onLaunch={() => onLaunchAgent(agent.id)}
                onStop={() => onStopAgent(agent.id)}
                onMoveToTab={(tabId) => onMoveToTab(agent.id, tabId)}
                onStopHeadless={() => onStopHeadless(agent)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
