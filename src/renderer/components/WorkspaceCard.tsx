import { Pencil, Trash2, Play, Square, MoreVertical, Container, GripVertical } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu'
import { AgentIcon } from '@/renderer/components/AgentIcon'
import type { Agent, AgentTab } from '@/shared/types'
import { themes } from '@/shared/constants'

interface AgentCardProps {
  agent: Agent
  isActive: boolean
  isWaiting?: boolean
  isFocused?: boolean
  tabs?: AgentTab[]
  currentTabId?: string
  onEdit: () => void
  onDelete: () => void
  onLaunch: () => void
  onStop: () => void
  onClick: () => void
  onMoveToTab?: (tabId: string) => void
  onStopHeadless?: () => void
  // Drag-and-drop props for sidebar reordering
  draggable?: boolean
  isDragging?: boolean
  isDropTarget?: boolean
  isEditMode?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: () => void
  onDragLeave?: () => void
  onDrop?: () => void
  // Tutorial
  dataTutorial?: string
}

export function AgentCard({
  agent,
  isActive,
  isWaiting,
  isFocused,
  tabs,
  currentTabId,
  onEdit,
  onDelete,
  onLaunch,
  onStop,
  onClick,
  onMoveToTab,
  onStopHeadless,
  draggable,
  isDragging,
  isDropTarget,
  isEditMode,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  dataTutorial,
}: AgentCardProps) {
  // Only enable drag when both draggable and isEditMode are true
  const canDrag = draggable && isEditMode
  const themeColors = themes[agent.theme]

  return (
    <div
      data-tutorial={dataTutorial}
      draggable={canDrag}
      className={`
        relative rounded-lg p-4 cursor-pointer transition-all
        ${isActive && isFocused ? 'ring-2 ring-primary' : ''}
        ${isActive && !isFocused ? 'hover:ring-1 hover:ring-primary/50' : ''}
        ${!isActive ? 'hover:border-primary/50' : ''}
        ${isWaiting ? 'animate-pulse ring-2 ring-yellow-500' : ''}
        ${isFocused ? 'border-2' : 'border'}
        ${isDragging ? 'opacity-50' : ''}
        ${isDropTarget ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}
      `}
      style={{
        borderColor: isFocused ? 'white' : 'rgba(255, 255, 255, 0.15)'
      }}
      onClick={onClick}
      onDragStart={(e) => {
        e.dataTransfer.setData('agentId', agent.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (canDrag) {
          e.preventDefault()
          onDragOver?.()
        }
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
    >
      {/* Top: Icon + title */}
      <div className="flex items-center gap-2 mb-1">
        {canDrag && (
          <GripVertical className="w-4 h-4 text-muted-foreground/50 cursor-grab flex-shrink-0" />
        )}
        <div
          className="w-5 h-5 rounded-sm flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: themeColors.bg }}
        >
          <AgentIcon icon={agent.icon} className="w-4 h-4" />
        </div>
        <h3 className="font-medium truncate flex-1">{agent.name}</h3>
        {agent.isHeadless && (
          <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded flex-shrink-0 flex items-center gap-1">
            <Container className="w-3 h-3" />
            Headless
          </span>
        )}
        {isWaiting && (
          <span className="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded flex-shrink-0">
            Waiting
          </span>
        )}
      </div>

      {/* Middle: Directory path */}
      <p className="text-xs text-muted-foreground/60 truncate mb-2">
        {agent.directory}
      </p>

      {/* Bottom: Horizontal action icons */}
      <div className="flex flex-row gap-1 justify-end">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
        {tabs && tabs.length > 0 && onMoveToTab && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to Tab</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {tabs.map((tab) => (
                <DropdownMenuItem
                  key={tab.id}
                  disabled={tab.id === currentTabId}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMoveToTab(tab.id)
                  }}
                >
                  {tab.name}
                  {tab.id === currentTabId && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      (current)
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {agent.isHeadless ? (
          // Headless agents only show a stop button (they can't be manually started)
          <Button
            variant="destructive"
            size="icon-xs"
            title="Stop headless container"
            onClick={(e) => {
              e.stopPropagation()
              onStopHeadless?.()
            }}
          >
            <Square className="h-3 w-3" />
          </Button>
        ) : isActive ? (
          <Button
            variant="destructive"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation()
              onStop()
            }}
          >
            <Square className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(e) => {
              e.stopPropagation()
              onLaunch()
            }}
          >
            <Play className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

// Backwards compatibility export
export { AgentCard as WorkspaceCard }
