import { memo, useCallback } from 'react'
import { AgentCard } from '@/renderer/components/WorkspaceCard'
import type { Agent, AgentTab } from '@/shared/types'

interface SidebarAgentCardProps {
  agent: Agent
  isActive: boolean
  isWaiting: boolean
  isFocused: boolean
  tabs: AgentTab[]
  currentTabId: string | undefined
  dataTutorial: string | undefined
  activeTabId: string | null
  isDragging: boolean
  isDropTarget: boolean
  isEditMode: boolean
  sidebarDraggedAgentId: string | null
  sidebarDropTargetAgentId: string | null
  onAgentClick: (agentId: string, agentTab: AgentTab | undefined) => void
  onEditAgent: (agent: Agent) => void
  onDeleteAgent: (agentId: string) => void
  onCloneAgent: (agent: Agent) => void
  onLaunchAgent: (agentId: string) => void
  onStopAgent: (agentId: string) => void
  onMoveToTab: (agentId: string, tabId: string) => void
  onStopHeadless: (agent: Agent) => void
  onDragStart: (agentId: string) => void
  onDragEnd: () => void
  onDragOver: (agentId: string) => void
  onDragLeave: (agentId: string) => void
  onDrop: (agentId: string) => void
}

export const SidebarAgentCard = memo(function SidebarAgentCard({
  agent,
  isActive,
  isWaiting,
  isFocused,
  tabs,
  currentTabId,
  dataTutorial,
  isDragging,
  isDropTarget,
  isEditMode,
  onAgentClick,
  onEditAgent,
  onDeleteAgent,
  onCloneAgent,
  onLaunchAgent,
  onStopAgent,
  onMoveToTab,
  onStopHeadless,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: SidebarAgentCardProps) {
  const agentTab = tabs.find((t) => t.workspaceIds.includes(agent.id))

  const handleClick = useCallback(() => {
    onAgentClick(agent.id, agentTab)
  }, [agent.id, agentTab, onAgentClick])

  const handleEdit = useCallback(() => onEditAgent(agent), [agent, onEditAgent])
  const handleDelete = useCallback(() => onDeleteAgent(agent.id), [agent.id, onDeleteAgent])
  const handleClone = useCallback(() => onCloneAgent(agent), [agent, onCloneAgent])
  const handleLaunch = useCallback(() => onLaunchAgent(agent.id), [agent.id, onLaunchAgent])
  const handleStop = useCallback(() => onStopAgent(agent.id), [agent.id, onStopAgent])
  const handleMoveToTab = useCallback((tabId: string) => onMoveToTab(agent.id, tabId), [agent.id, onMoveToTab])
  const handleStopHeadless = useCallback(() => onStopHeadless(agent), [agent, onStopHeadless])
  const handleDragStart = useCallback(() => onDragStart(agent.id), [agent.id, onDragStart])
  const handleDragOver = useCallback(() => onDragOver(agent.id), [agent.id, onDragOver])
  const handleDragLeave = useCallback(() => onDragLeave(agent.id), [agent.id, onDragLeave])
  const handleDrop = useCallback(() => onDrop(agent.id), [agent.id, onDrop])

  return (
    <AgentCard
      agent={agent}
      isActive={isActive}
      isWaiting={isWaiting}
      isFocused={isFocused}
      tabs={tabs}
      currentTabId={currentTabId ?? agentTab?.id}
      dataTutorial={dataTutorial}
      onClick={handleClick}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onClone={handleClone}
      onLaunch={handleLaunch}
      onStop={handleStop}
      onMoveToTab={handleMoveToTab}
      onStopHeadless={handleStopHeadless}
      draggable={true}
      isDragging={isDragging}
      isDropTarget={isDropTarget}
      isEditMode={isEditMode}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  )
})
