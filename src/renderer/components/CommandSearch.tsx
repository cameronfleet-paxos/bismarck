import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Container, ChevronLeft } from 'lucide-react'
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

type CommandMode = 'commands' | 'agent-select' | 'prompt-input'

interface Command {
  id: string
  label: string
  icon: React.ElementType
}

const commands: Command[] = [
  { id: 'start-headless', label: 'Start: Headless Agent', icon: Container },
]

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: Agent[]
  activeTerminals: ActiveTerminal[]
  waitingQueue: string[]
  tabs: AgentTab[]
  activeTabId: string | null
  onSelectAgent: (agentId: string) => void
  onStartHeadless?: (agentId: string, prompt: string) => void
}

export function CommandSearch({
  open,
  onOpenChange,
  agents,
  activeTerminals,
  waitingQueue,
  tabs,
  onSelectAgent,
  onStartHeadless,
}: CommandSearchProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<CommandMode>('commands')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [prompt, setPrompt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Filter agents for selection (exclude orchestrators, plan agents, and headless agents)
  const selectableAgents = useMemo(() => {
    return agents.filter(agent =>
      !agent.isOrchestrator &&
      !agent.isPlanAgent &&
      !agent.parentPlanId &&
      !agent.isHeadless &&
      !agent.isStandaloneHeadless
    )
  }, [agents])

  // Filter agents based on query
  const filteredAgents = useMemo(() => {
    const baseAgents = mode === 'agent-select' ? selectableAgents : agents
    if (!query.trim()) {
      return baseAgents
    }
    const lowerQuery = query.toLowerCase()
    return baseAgents.filter(agent => {
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
  }, [agents, selectableAgents, query, mode])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands
    }
    const lowerQuery = query.toLowerCase()
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(lowerQuery)
    )
  }, [query])

  // Get the current list length based on mode
  const currentListLength = mode === 'commands'
    ? filteredCommands.length + filteredAgents.length
    : filteredAgents.length

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setQuery('')
      setMode('commands')
      setSelectedAgent(null)
      setPrompt('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus appropriate input when mode changes
  useEffect(() => {
    if (mode === 'prompt-input') {
      setTimeout(() => textareaRef.current?.focus(), 0)
    } else {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [mode])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleBack = () => {
    if (mode === 'prompt-input') {
      setMode('agent-select')
      setPrompt('')
    } else if (mode === 'agent-select') {
      setMode('commands')
      setSelectedAgent(null)
      setQuery('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape goes back or closes
    if (e.key === 'Escape') {
      e.preventDefault()
      if (mode !== 'commands') {
        handleBack()
      } else {
        onOpenChange(false)
      }
      return
    }

    // In prompt-input mode, handle differently
    if (mode === 'prompt-input') {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (selectedAgent && prompt.trim() && onStartHeadless) {
          onStartHeadless(selectedAgent.id, prompt.trim())
          onOpenChange(false)
        }
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, currentListLength - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        handleSelect()
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) {
          setSelectedIndex(prev => Math.max(prev - 1, 0))
        } else {
          setSelectedIndex(prev => Math.min(prev + 1, currentListLength - 1))
        }
        break
      case 'Backspace':
        if (query === '' && mode !== 'commands') {
          e.preventDefault()
          handleBack()
        }
        break
    }
  }

  const handleSelect = () => {
    if (mode === 'commands') {
      // Check if selecting a command or an agent
      if (selectedIndex < filteredCommands.length) {
        const command = filteredCommands[selectedIndex]
        if (command.id === 'start-headless') {
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        }
      } else {
        // Selected an agent directly
        const agentIndex = selectedIndex - filteredCommands.length
        const agent = filteredAgents[agentIndex]
        if (agent) {
          onSelectAgent(agent.id)
          onOpenChange(false)
        }
      }
    } else if (mode === 'agent-select') {
      const agent = filteredAgents[selectedIndex]
      if (agent) {
        setSelectedAgent(agent)
        setMode('prompt-input')
        setQuery('')
      }
    }
  }

  const handleSubmitPrompt = () => {
    if (selectedAgent && prompt.trim() && onStartHeadless) {
      onStartHeadless(selectedAgent.id, prompt.trim())
      onOpenChange(false)
    }
  }

  const isAgentActive = (agentId: string) => activeTerminals.some(t => t.workspaceId === agentId)
  const isAgentWaiting = (agentId: string) => waitingQueue.includes(agentId)
  const getAgentTab = (agentId: string) => tabs.find(t => t.workspaceIds.includes(agentId))

  const getPlaceholder = () => {
    switch (mode) {
      case 'commands':
        return 'Search commands or agents...'
      case 'agent-select':
        return 'Select reference agent...'
      default:
        return ''
    }
  }

  const getTitle = () => {
    switch (mode) {
      case 'agent-select':
        return 'Start: Headless Agent'
      case 'prompt-input':
        return `Headless Agent - ${selectedAgent?.name}`
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0"
        showCloseButton={false}
      >
        {/* Title bar for non-command modes */}
        {mode !== 'commands' && (
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
            <button
              onClick={handleBack}
              className="p-1 rounded hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">{getTitle()}</span>
          </div>
        )}

        {/* Prompt input mode */}
        {mode === 'prompt-input' ? (
          <div className="p-4">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter prompt for headless agent..."
              className="w-full h-32 p-3 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground">
                Working directory: {selectedAgent?.directory}
              </span>
              <button
                onClick={handleSubmitPrompt}
                disabled={!prompt.trim()}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Agent
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Search input */}
            <div className="flex items-center border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                placeholder={getPlaceholder()}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent border-0 outline-none px-3 py-3 text-sm placeholder:text-muted-foreground"
              />
              <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">esc</kbd>
            </div>

            {/* Results list */}
            <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
              {mode === 'commands' && (
                <>
                  {/* Commands section */}
                  {filteredCommands.length > 0 && (
                    <>
                      <div className="px-4 py-1 text-xs text-muted-foreground font-medium">
                        Commands
                      </div>
                      {filteredCommands.map((command, index) => {
                        const Icon = command.icon
                        const isSelected = index === selectedIndex
                        return (
                          <div
                            key={command.id}
                            data-index={index}
                            onClick={() => {
                              setSelectedIndex(index)
                              handleSelect()
                            }}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                              isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                            }`}
                          >
                            <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-blue-500/20">
                              <Icon className="w-5 h-5 text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">{command.label}</span>
                            </div>
                            {isSelected && (
                              <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                ↵
                              </kbd>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )}

                  {/* Agents section in commands mode */}
                  {filteredAgents.length > 0 && (
                    <>
                      <div className="px-4 py-1 text-xs text-muted-foreground font-medium mt-2">
                        Agents
                      </div>
                      {filteredAgents.map((agent, index) => {
                        const adjustedIndex = filteredCommands.length + index
                        const isActive = isAgentActive(agent.id)
                        const isWaiting = isAgentWaiting(agent.id)
                        const tab = getAgentTab(agent.id)
                        const themeColors = themes[agent.theme]
                        const isSelected = adjustedIndex === selectedIndex

                        return (
                          <div
                            key={agent.id}
                            data-index={adjustedIndex}
                            onClick={() => {
                              onSelectAgent(agent.id)
                              onOpenChange(false)
                            }}
                            onMouseEnter={() => setSelectedIndex(adjustedIndex)}
                            className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                              isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                            }`}
                          >
                            <div
                              className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                              style={{ backgroundColor: themeColors.bg }}
                            >
                              <AgentIcon icon={agent.icon} className="w-5 h-5" />
                            </div>
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
                            {tab && (
                              <div className="text-xs text-muted-foreground shrink-0">
                                {tab.name}
                              </div>
                            )}
                            {isSelected && (
                              <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                                ↵
                              </kbd>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )}

                  {filteredCommands.length === 0 && filteredAgents.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No results found
                    </div>
                  )}
                </>
              )}

              {mode === 'agent-select' && (
                <>
                  {filteredAgents.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No agents found
                    </div>
                  ) : (
                    filteredAgents.map((agent, index) => {
                      const themeColors = themes[agent.theme]
                      const isSelected = index === selectedIndex

                      return (
                        <div
                          key={agent.id}
                          data-index={index}
                          onClick={() => {
                            setSelectedIndex(index)
                            handleSelect()
                          }}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                            isSelected ? 'bg-accent' : 'hover:bg-accent/50'
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                            style={{ backgroundColor: themeColors.bg }}
                          >
                            <AgentIcon icon={agent.icon} className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{agent.name}</span>
                            </div>
                            {agent.directory && (
                              <div className="text-xs text-muted-foreground truncate">
                                {agent.directory}
                              </div>
                            )}
                          </div>
                          {isSelected && (
                            <kbd className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                              ↵
                            </kbd>
                          )}
                        </div>
                      )
                    })
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* Footer with hints */}
        <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          {mode === 'prompt-input' ? (
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
              submit
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd>
                select
              </span>
            </>
          )}
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 py-0.5 rounded">esc</kbd>
            {mode === 'commands' ? 'close' : 'back'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
