import { AgentIcon } from '@/renderer/components/AgentIcon'
import type { Agent } from '@/shared/types'
import { themes } from '@/shared/constants'
import { X } from 'lucide-react'

interface AttentionQueueProps {
  waitingQueue: string[]
  agents: Agent[]
  onFocusAgent: (agentId: string, options?: { skipAcknowledge?: boolean }) => void
  onDismissAgent: (agentId: string) => void
}

export function AttentionQueue({ waitingQueue, agents, onFocusAgent, onDismissAgent }: AttentionQueueProps) {
  if (waitingQueue.length === 0) return null

  // Get agent data for each waiting agent
  const waitingAgents = waitingQueue
    .map(id => agents.find(a => a.id === id))
    .filter((a): a is Agent => a !== undefined)

  return (
    <div data-tutorial="attention" className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-2 bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Queue label */}
      <span className="text-xs text-muted-foreground mr-1">
        {waitingQueue.length} waiting
      </span>

      {/* Agent icons */}
      <div className="flex items-center gap-1.5">
        {waitingAgents.slice(0, 8).map((agent) => {
          const themeColors = themes[agent.theme]
          return (
            <div key={agent.id} className="relative group">
              <button
                onClick={() => onFocusAgent(agent.id, { skipAcknowledge: true })}
                className="w-8 h-8 rounded-md hover:brightness-125 transition-all ring-2 ring-yellow-500 hover:ring-yellow-400 flex items-center justify-center"
                style={{ backgroundColor: themeColors.bg }}
                title={`Go to ${agent.name}`}
              >
                <AgentIcon icon={agent.icon} className="w-5 h-5" />
              </button>
              {/* Dismiss button (appears on hover) */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDismissAgent(agent.id)
                }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title={`Dismiss ${agent.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
        {waitingAgents.length > 8 && (
          <span className="text-xs text-muted-foreground ml-1">+{waitingAgents.length - 8}</span>
        )}
      </div>
    </div>
  )
}
