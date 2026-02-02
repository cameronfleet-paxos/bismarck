import { useState, useEffect, useRef, useMemo } from 'react'
import { Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
} from '@/renderer/components/ui/dialog'
import { AgentIcon } from '@/renderer/components/AgentIcon'
import { themes } from '@/shared/constants'
import type { Agent, AgentTab } from '@/shared/types'

interface ActiveTerminal {
  terminalId: string
  workspaceId: string
}

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: Agent[]
  activeTerminals: ActiveTerminal[]
  waitingQueue: string[]
  tabs: AgentTab[]
  activeTabId: string | null
  onSelectAgent: (agentId: string) => void
}

export function CommandSearch({
  open,
  onOpenChange,
  agents,
  activeTerminals,
  waitingQueue,
  tabs,
  onSelectAgent,
}: CommandSearchProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter agents based on query
  const filteredAgents = useMemo(() => {
    if (!query.trim()) {
      return agents
    }
    const lowerQuery = query.toLowerCase()
    return agents.filter(agent => {
      const nameMatch = agent.name.toLowerCase().includes(lowerQuery)
      const purposeMatch = agent.purpose?.toLowerCase().includes(lowerQuery)
      const directoryMatch = agent.directory?.toLowerCase().includes(lowerQuery)
      return nameMatch || purposeMatch || directoryMatch
    }).sort((a, b) => {
      // Prioritize exact matches, then starts-with, then contains
      const aName = a.name.toLowerCase()
      const bName = b.name.toLowerCase()
      const aExact = aName === lowerQuery
      const bExact = bName === lowerQuery
      if (aExact && !bExact) return -1
      if (bExact && !aExact) return 1
      const aStarts = aName.startsWith(lowerQuery)
      const bStarts = bName.startsWith(lowerQuery)
      if (aStarts && !bStarts) return -1
      if (bStarts && !aStarts) return 1
      return 0
    })
  }, [agents, query])

  // Reset selection when query or open state changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, open])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, filteredAgents.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredAgents[selectedIndex]) {
          onSelectAgent(filteredAgents[selectedIndex].id)
          onOpenChange(false)
        }
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) {
          setSelectedIndex(prev => Math.max(prev - 1, 0))
        } else {
          setSelectedIndex(prev => Math.min(prev + 1, filteredAgents.length - 1))
        }
        break
    }
  }

  const isAgentActive = (agentId: string) => activeTerminals.some(t => t.workspaceId === agentId)
  const isAgentWaiting = (agentId: string) => waitingQueue.includes(agentId)
  const getAgentTab = (agentId: string) => tabs.find(t => t.workspaceIds.includes(agentId))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0"
        showCloseButton={false}
      >
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search agents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-0 outline-none px-3 py-3 text-sm placeholder:text-muted-foreground"
          />
          <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">esc</kbd>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {filteredAgents.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No agents found
            </div>
          ) : (
            filteredAgents.map((agent, index) => {
              const isActive = isAgentActive(agent.id)
              const isWaiting = isAgentWaiting(agent.id)
              const tab = getAgentTab(agent.id)
              const themeColors = themes[agent.theme]
              const isSelected = index === selectedIndex

              return (
                <div
                  key={agent.id}
                  data-index={index}
                  onClick={() => {
                    onSelectAgent(agent.id)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  {/* Agent icon with theme background */}
                  <div
                    className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                    style={{ backgroundColor: themeColors.bg }}
                  >
                    <AgentIcon icon={agent.icon} className="w-5 h-5" />
                  </div>

                  {/* Agent info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{agent.name}</span>
                      {isActive && !isWaiting && (
                        <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">
                          Running
                        </span>
                      )}
                      {isWaiting && (
                        <span className="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">
                          Waiting
                        </span>
                      )}
                    </div>
                    {agent.purpose && (
                      <div className="text-xs text-muted-foreground truncate">
                        {agent.purpose}
                      </div>
                    )}
                  </div>

                  {/* Tab indicator */}
                  {tab && (
                    <div className="text-xs text-muted-foreground shrink-0">
                      {tab.name}
                    </div>
                  )}

                  {/* Keyboard hint for selected item */}
                  {isSelected && (
                    <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                      ↵
                    </kbd>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer with hints */}
        <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 py-0.5 rounded">esc</kbd>
            close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
