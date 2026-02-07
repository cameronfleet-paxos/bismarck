import { useState, useRef, useEffect } from 'react'
import { Plus, X, Pencil, GripVertical } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import type { AgentTab } from '@/shared/types'

interface TabBarProps {
  tabs: AgentTab[]
  activeTabId: string | null
  onTabSelect: (tabId: string) => void
  onTabRename: (tabId: string, name: string) => void
  onTabDelete: (tabId: string) => void
  onTabCreate: () => void
  // Drag-and-drop support for moving agents between tabs
  draggedWorkspaceId?: string | null
  dropTargetTabId?: string | null
  onTabDragOver?: (tabId: string) => void
  onTabDragLeave?: () => void
  onTabDrop?: (workspaceId: string, tabId: string) => void
  // Tab reordering support
  onTabReorder?: (draggedTabId: string, targetTabId: string) => void
}

export function TabBar({
  tabs,
  activeTabId,
  onTabSelect,
  onTabRename,
  onTabDelete,
  onTabCreate,
  draggedWorkspaceId,
  dropTargetTabId,
  onTabDragOver,
  onTabDragLeave,
  onTabDrop,
  onTabReorder,
}: TabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [reorderDropTargetTabId, setReorderDropTargetTabId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingTabId])

  const handleStartRename = (tab: AgentTab) => {
    setEditingTabId(tab.id)
    setEditingName(tab.name)
  }

  const handleFinishRename = () => {
    if (editingTabId && editingName.trim()) {
      onTabRename(editingTabId, editingName.trim())
    }
    setEditingTabId(null)
    setEditingName('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename()
    } else if (e.key === 'Escape') {
      setEditingTabId(null)
      setEditingName('')
    }
  }

  return (
    <div data-testid="tab-bar" data-tutorial="tabs" className="border-b bg-muted/30 flex items-center px-2 py-1 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        const isEditing = editingTabId === tab.id
        const agentCount = tab.workspaceIds.filter(Boolean).length
        // Check if this tab can accept a dropped agent
        const canAcceptDrop = draggedWorkspaceId &&
          !tab.workspaceIds.includes(draggedWorkspaceId) &&
          (tab.isPlanTab || agentCount < 4)
        const isDropTarget = dropTargetTabId === tab.id && canAcceptDrop
        // Tab reordering state
        const isDraggingThisTab = draggedTabId === tab.id
        const isReorderDropTarget = reorderDropTargetTabId === tab.id && draggedTabId && draggedTabId !== tab.id

        return (
          <div
            key={tab.id}
            data-testid={`tab-item-${tab.id}`}
            draggable={!isEditing}
            className={`group flex items-center gap-1 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${
              tab.isPlanTab
                ? isActive
                  ? 'bg-blue-600 text-white border border-blue-500 shadow-sm'
                  : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
                : isActive
                  ? 'bg-background border shadow-sm'
                  : 'hover:bg-muted/50'
            } ${isDropTarget ? 'ring-2 ring-primary ring-offset-1' : ''} ${isDraggingThisTab ? 'opacity-50' : ''} ${isReorderDropTarget ? 'ring-2 ring-blue-500' : ''}`}
            onClick={() => !isEditing && onTabSelect(tab.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('tabId', tab.id)
              e.dataTransfer.effectAllowed = 'move'
              setDraggedTabId(tab.id)
            }}
            onDragEnd={() => {
              setDraggedTabId(null)
              setReorderDropTargetTabId(null)
            }}
            onDragOver={(e) => {
              // Check if we're dragging a tab (for reordering)
              const isTabDrag = e.dataTransfer.types.includes('tabid')
              if (isTabDrag && draggedTabId && draggedTabId !== tab.id) {
                e.preventDefault()
                setReorderDropTargetTabId(tab.id)
              } else if (canAcceptDrop) {
                // Agent drop
                e.preventDefault()
                onTabDragOver?.(tab.id)
              }
            }}
            onDragLeave={() => {
              setReorderDropTargetTabId(null)
              onTabDragLeave?.()
            }}
            onDrop={(e) => {
              e.preventDefault()
              // Check if it's a tab reorder
              const droppedTabId = e.dataTransfer.getData('tabId')
              if (droppedTabId && onTabReorder && droppedTabId !== tab.id) {
                onTabReorder(droppedTabId, tab.id)
                setDraggedTabId(null)
                setReorderDropTargetTabId(null)
                return
              }
              // Otherwise, it's an agent drop
              const workspaceId = e.dataTransfer.getData('workspaceId')
              if (workspaceId && onTabDrop && canAcceptDrop) {
                onTabDrop(workspaceId, tab.id)
              }
            }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={handleKeyDown}
                className="w-20 px-1 py-0 text-sm bg-transparent border-b border-primary outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <GripVertical className="w-3 h-3 text-muted-foreground/50 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    handleStartRename(tab)
                  }}
                >
                  {tab.name}
                </span>
                <span className="text-muted-foreground text-xs">
                  {tab.isPlanTab ? `(${agentCount})` : `(${agentCount}/4)`}
                </span>
              </>
            )}

            {!isEditing && (
              <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="p-0.5 hover:bg-muted rounded"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleStartRename(tab)
                  }}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
                {tabs.length > 1 && (
                  <button
                    className="p-0.5 hover:bg-destructive/20 rounded"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTabDelete(tab.id)
                    }}
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-1 h-7 w-7"
        onClick={onTabCreate}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
