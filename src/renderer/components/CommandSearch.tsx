import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Container, ChevronLeft, FileText, RefreshCw, Save, MessageSquare, HelpCircle, TerminalSquare, Clock, Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { AgentIcon } from '@/renderer/components/AgentIcon'
import { Switch } from '@/renderer/components/ui/switch'
import { Tooltip } from '@/renderer/components/ui/tooltip'
import { themes, STANDALONE_AGENT_TYPES } from '@/shared/constants'
import type { Agent, AgentTab, RalphLoopConfig, StandaloneAgentType } from '@/shared/types'
import { RALPH_LOOP_PRESETS, type RalphLoopPreset } from '@/shared/ralph-loop-presets'
import { useTutorial } from '@/renderer/components/tutorial'

interface ActiveTerminal {
  terminalId: string
  workspaceId: string
}

type CommandMode = 'commands' | 'agent-select' | 'prompt-input' | 'ralph-loop-config' | 'cron-schedule'

// Track which command triggered agent selection
type PendingCommand = 'headless' | 'headless-discussion' | 'ralph-loop' | 'ralph-loop-discussion' | 'open-terminal' | 'cron-headless' | 'docker-terminal' | 'docker-terminal-headless' | null

interface Command {
  id: string
  label: string
  icon: React.ElementType
}

const commands: Command[] = [
  { id: 'start-headless', label: 'Start: Headless Agent', icon: Container },
  { id: 'start-headless-discussion', label: 'Discuss: Headless Agent', icon: MessageSquare },
  { id: 'open-terminal', label: 'Open: Terminal', icon: TerminalSquare },
  { id: 'start-docker-terminal', label: 'Start: Docker Terminal', icon: Container },
  { id: 'start-docker-terminal-headless', label: 'Open: Headless Agent in Docker', icon: Container },
  { id: 'start-ralph-loop', label: 'Start: Ralph Loop', icon: RefreshCw },
  { id: 'start-ralph-loop-discussion', label: 'Discuss: Ralph Loop', icon: MessageSquare },
  { id: 'start-plan', label: 'Start: Plan', icon: FileText },
  { id: 'cron-headless', label: 'Cron: Headless Agent', icon: Clock },
  { id: 'cron-automation', label: 'Cron: Automation', icon: Settings },
]

interface CommandSearchProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: Agent[]
  activeTerminals: ActiveTerminal[]
  waitingQueue: string[]
  tabs: AgentTab[]
  activeTabId: string | null
  onSelectAgent: (agentId: string, options?: { agentType?: StandaloneAgentType }) => void
  onStartHeadless?: (agentId: string, prompt: string, model: 'opus' | 'sonnet', options?: { planPhase?: boolean; agentType?: StandaloneAgentType }) => void
  onStartHeadlessDiscussion?: (agentId: string, initialPrompt: string, model: 'opus' | 'sonnet') => void
  onStartRalphLoopDiscussion?: (agentId: string, initialPrompt: string) => void
  onStartPlan?: () => void
  onOpenTerminal?: (agentId: string) => void
  onStartDockerTerminal?: (agentId: string) => void
  onStartRalphLoop?: (config: RalphLoopConfig) => void
  onOpenCronAutomation?: () => void
  focusedHeadlessAgent?: { name: string; directory: string } | null
  onOpenDockerTerminalInWorktree?: (directory: string, name: string) => void
  prefillRalphLoopConfig?: {
    referenceAgentId: string
    prompt: string
    completionPhrase: string
    maxIterations: number
    model: 'opus' | 'sonnet'
  } | null
  prefillHeadlessMode?: 'opus' | 'sonnet' | null
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
  onStartHeadlessDiscussion,
  onStartRalphLoopDiscussion,
  onStartPlan,
  onOpenTerminal,
  onStartDockerTerminal,
  onStartRalphLoop,
  onOpenCronAutomation,
  focusedHeadlessAgent,
  onOpenDockerTerminalInWorktree,
  prefillRalphLoopConfig,
  prefillHeadlessMode,
}: CommandSearchProps) {
  const { isActive: tutorialActive } = useTutorial()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<CommandMode>('commands')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [prompt, setPrompt] = useState('')
  const [planPhase, setPlanPhase] = useState(true)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand>(null)
  const [headlessModelOverride, setHeadlessModelOverride] = useState<'opus' | 'sonnet' | null>(null)
  const [selectedAgentType, setSelectedAgentType] = useState<StandaloneAgentType | undefined>(undefined)

  // Cron schedule state
  const [cronSchedule, setCronSchedule] = useState('0 9 * * *')
  const [cronSchedulePreset, setCronSchedulePreset] = useState('0 9 * * *')

  // Ralph Loop config state
  const [completionPhrase, setCompletionPhrase] = useState('<promise>COMPLETE</promise>')
  const [maxIterations, setMaxIterations] = useState(50)
  const [ralphModel, setRalphModel] = useState<'opus' | 'sonnet'>('sonnet')
  const [selectedPreset, setSelectedPreset] = useState<string>('custom')
  const [customPresets, setCustomPresets] = useState<RalphLoopPreset[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [savePresetLabel, setSavePresetLabel] = useState('')
  const [savePresetDescription, setSavePresetDescription] = useState('')

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

  // Headless agents only (for Docker terminal in headless worktree)
  const headlessAgents = useMemo(() => {
    return agents.filter(agent => agent.isHeadless || agent.isStandaloneHeadless)
  }, [agents])

  // Filter agents based on query
  const filteredAgents = useMemo(() => {
    const baseAgents = mode === 'agent-select'
      ? (pendingCommand === 'docker-terminal-headless' ? headlessAgents : selectableAgents)
      : agents
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
  }, [agents, selectableAgents, headlessAgents, query, mode, pendingCommand])

  // Build dynamic commands list (includes contextual commands based on focused agent)
  const dynamicCommands = useMemo(() => {
    const cmds = [...commands]
    if (focusedHeadlessAgent) {
      const dockerIdx = cmds.findIndex(c => c.id === 'start-docker-terminal')
      cmds.splice(dockerIdx + 1, 0, {
        id: 'docker-terminal-focused-agent',
        label: `Docker: ${focusedHeadlessAgent.name}`,
        icon: Container,
      })
    }
    return cmds
  }, [focusedHeadlessAgent])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return dynamicCommands
    }
    const lowerQuery = query.toLowerCase()
    return dynamicCommands.filter(cmd =>
      cmd.label.toLowerCase().includes(lowerQuery)
    )
  }, [query, dynamicCommands])

  // Get the current list length based on mode
  const currentListLength = mode === 'commands'
    ? filteredCommands.length + filteredAgents.length
    : filteredAgents.length

  // Load custom presets on mount
  useEffect(() => {
    const loadCustomPresets = async () => {
      try {
        const presets = await window.electronAPI.getRalphLoopPresets()
        setCustomPresets(presets)
      } catch (error) {
        console.error('Failed to load custom presets:', error)
      }
    }
    loadCustomPresets()
  }, [])

  // All available presets (built-in + custom)
  const allPresets = useMemo(() => {
    return [...RALPH_LOOP_PRESETS, ...customPresets]
  }, [customPresets])

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setShowSaveDialog(false)
      setSavePresetLabel('')
      setSavePresetDescription('')

      // Check if we're opening in headless agent mode (via Cmd+J / Cmd+Shift+J)
      if (prefillHeadlessMode) {
        setHeadlessModelOverride(prefillHeadlessMode)
        setPendingCommand('headless')
        setPlanPhase(true)
        setPrompt('')
        // If there's only one selectable agent, skip to prompt-input
        const available = agents.filter(agent =>
          !agent.isOrchestrator &&
          !agent.isPlanAgent &&
          !agent.parentPlanId &&
          !agent.isHeadless &&
          !agent.isStandaloneHeadless
        )
        if (available.length === 1) {
          setSelectedAgent(available[0])
          setMode('prompt-input')
          setTimeout(() => textareaRef.current?.focus(), 0)
        } else {
          setMode('agent-select')
          setTimeout(() => inputRef.current?.focus(), 0)
        }
      // Check if we have prefill config from Ralph Loop discussion
      } else if (prefillRalphLoopConfig) {
        // Find the reference agent and jump directly to ralph-loop-config mode
        const agent = agents.find(a => a.id === prefillRalphLoopConfig.referenceAgentId)
        if (agent) {
          setSelectedAgent(agent)
          setMode('ralph-loop-config')
          setPendingCommand('ralph-loop')
          setPlanPhase(true)
          setPrompt(prefillRalphLoopConfig.prompt)
          setCompletionPhrase(prefillRalphLoopConfig.completionPhrase)
          setMaxIterations(prefillRalphLoopConfig.maxIterations)
          setRalphModel(prefillRalphLoopConfig.model)
          setSelectedPreset('custom')
          setTimeout(() => textareaRef.current?.focus(), 0)
        } else {
          // Agent not found, reset to default state
          setMode('commands')
          setSelectedAgent(null)
          setPrompt('')
          setPlanPhase(true)
          setPendingCommand(null)
          setCompletionPhrase('<promise>COMPLETE</promise>')
          setMaxIterations(50)
          setRalphModel('sonnet')
          setSelectedPreset('custom')
          setTimeout(() => inputRef.current?.focus(), 0)
        }
      } else {
        // Normal open - reset to defaults
        setMode('commands')
        setSelectedAgent(null)
        setPrompt('')
        setPlanPhase(true)
        setPendingCommand(null)
        setHeadlessModelOverride(null)
        setSelectedAgentType(undefined)
        setCompletionPhrase('<promise>COMPLETE</promise>')
        setMaxIterations(50)
        setRalphModel('sonnet')
        setSelectedPreset('custom')
        setTimeout(() => inputRef.current?.focus(), 0)
      }

      // Reload custom presets
      window.electronAPI.getRalphLoopPresets().then(setCustomPresets).catch(console.error)
    }
  }, [open, prefillRalphLoopConfig, prefillHeadlessMode, agents])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus appropriate input when mode changes
  useEffect(() => {
    if (mode === 'prompt-input' || mode === 'ralph-loop-config') {
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
    if (mode === 'cron-schedule') {
      setMode('prompt-input')
    } else if (mode === 'prompt-input') {
      setMode('agent-select')
      setPrompt('')
      setSelectedAgentType(undefined)
    } else if (mode === 'ralph-loop-config') {
      setMode('agent-select')
      setPrompt('')
    } else if (mode === 'agent-select') {
      setMode('commands')
      setSelectedAgent(null)
      setPendingCommand(null)
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
        // Cmd+Shift+Enter -> Opus, Cmd+Enter -> Sonnet (or override from hotkey)
        const model = e.shiftKey ? 'opus' : (headlessModelOverride || 'sonnet')
        handleSubmitPrompt(model)
      }
      return
    }

    // In ralph-loop-config mode, handle Cmd+Enter to start
    if (mode === 'ralph-loop-config') {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleStartRalphLoop()
      }
      return
    }

    // In cron-schedule mode, handle Enter to create
    if (mode === 'cron-schedule') {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmitCronSchedule()
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

  const handleSelect = (overrideIndex?: number) => {
    const idx = overrideIndex ?? selectedIndex
    if (mode === 'commands') {
      // Check if selecting a command or an agent
      if (idx < filteredCommands.length) {
        const command = filteredCommands[idx]
        if (command.id === 'open-terminal') {
          setPendingCommand('open-terminal')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-docker-terminal') {
          setPendingCommand('docker-terminal')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-headless') {
          setPendingCommand('headless')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-headless-discussion') {
          setPendingCommand('headless-discussion')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-ralph-loop') {
          setPendingCommand('ralph-loop')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-ralph-loop-discussion') {
          setPendingCommand('ralph-loop-discussion')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'start-plan') {
          onStartPlan?.()
          onOpenChange(false)
        } else if (command.id === 'cron-headless') {
          setPendingCommand('cron-headless')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        } else if (command.id === 'cron-automation') {
          onOpenCronAutomation?.()
          onOpenChange(false)
        } else if (command.id === 'docker-terminal-focused-agent') {
          if (focusedHeadlessAgent) {
            onOpenDockerTerminalInWorktree?.(focusedHeadlessAgent.directory, focusedHeadlessAgent.name)
            onOpenChange(false)
          }
        } else if (command.id === 'start-docker-terminal-headless') {
          setPendingCommand('docker-terminal-headless')
          setMode('agent-select')
          setQuery('')
          setSelectedIndex(0)
        }
      } else {
        // Selected an agent directly
        const agentIndex = idx - filteredCommands.length
        const agent = filteredAgents[agentIndex]
        if (agent) {
          onSelectAgent(agent.id, selectedAgentType ? { agentType: selectedAgentType } : undefined)
          onOpenChange(false)
        }
      }
    } else if (mode === 'agent-select') {
      const agent = filteredAgents[idx]
      if (agent) {
        if (pendingCommand === 'open-terminal') {
          // Immediately open terminal for the selected agent's directory
          onOpenTerminal?.(agent.id)
          onOpenChange(false)
          return
        }
        if (pendingCommand === 'docker-terminal') {
          onStartDockerTerminal?.(agent.id)
          onOpenChange(false)
          return
        }
        if (pendingCommand === 'docker-terminal-headless') {
          onOpenDockerTerminalInWorktree?.(agent.directory, agent.name)
          onOpenChange(false)
          return
        }
        setSelectedAgent(agent)
        if (pendingCommand === 'ralph-loop') {
          setMode('ralph-loop-config')
        } else {
          setMode('prompt-input')
        }
        setQuery('')
      }
    }
  }

  const handleStartRalphLoop = () => {
    if (selectedAgent && prompt.trim() && onStartRalphLoop) {
      const config: RalphLoopConfig = {
        prompt: prompt.trim(),
        completionPhrase,
        maxIterations,
        model: ralphModel,
        referenceAgentId: selectedAgent.id,
      }
      onStartRalphLoop(config)
      onOpenChange(false)
    }
  }

  const handleSubmitCronSchedule = async () => {
    if (selectedAgent && prompt.trim() && cronSchedule) {
      try {
        const jobName = `${selectedAgent.name} - ${prompt.trim().slice(0, 30)}`
        await window.electronAPI.createCronJob({
          name: jobName,
          schedule: cronSchedule,
          enabled: true,
          workflowGraph: {
            nodes: [{
              id: crypto.randomUUID(),
              type: 'headless-agent' as const,
              position: { x: 200, y: 100 },
              data: {
                referenceAgentId: selectedAgent.id,
                prompt: prompt.trim(),
                model: 'sonnet' as const,
                planPhase,
              },
              label: 'Headless Agent',
            }],
            edges: [],
          },
        })
        onOpenChange(false)
        onOpenCronAutomation?.()
      } catch (error) {
        console.error('Failed to create cron job:', error)
      }
    }
  }

  const handleSubmitPrompt = (model: 'opus' | 'sonnet') => {
    if (selectedAgent && prompt.trim()) {
      if (pendingCommand === 'cron-headless') {
        // Transition to schedule picker instead of launching
        setMode('cron-schedule')
        return
      }
      if (pendingCommand === 'headless-discussion') {
        onStartHeadlessDiscussion?.(selectedAgent.id, prompt.trim(), model)
        onOpenChange(false)
      } else if (pendingCommand === 'ralph-loop-discussion') {
        onStartRalphLoopDiscussion?.(selectedAgent.id, prompt.trim())
        onOpenChange(false)
      } else if (onStartHeadless) {
        onStartHeadless(selectedAgent.id, prompt.trim(), model, { planPhase, agentType: selectedAgentType })
        onOpenChange(false)
      }
    }
  }

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId)
    const preset = allPresets.find(p => p.id === presetId)
    if (preset) {
      setPrompt(preset.prompt)
      setCompletionPhrase(preset.completionPhrase)
      setMaxIterations(preset.maxIterations)
      setRalphModel(preset.model)
    }
  }

  const handleSavePreset = async () => {
    if (!savePresetLabel.trim() || !prompt.trim()) return

    try {
      await window.electronAPI.addRalphLoopPreset({
        label: savePresetLabel.trim(),
        description: savePresetDescription.trim(),
        prompt: prompt,
        completionPhrase: completionPhrase,
        maxIterations: maxIterations,
        model: ralphModel,
      })
      // Reload presets
      const presets = await window.electronAPI.getRalphLoopPresets()
      setCustomPresets(presets)
      setShowSaveDialog(false)
      setSavePresetLabel('')
      setSavePresetDescription('')
    } catch (error) {
      console.error('Failed to save preset:', error)
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
        if (pendingCommand === 'open-terminal') return 'Open: Terminal'
        if (pendingCommand === 'docker-terminal') return 'Start: Docker Terminal'
        if (pendingCommand === 'docker-terminal-headless') return 'Open: Headless Agent in Docker'
        if (pendingCommand === 'ralph-loop') return 'Start: Ralph Loop'
        if (pendingCommand === 'ralph-loop-discussion') return 'Discuss: Ralph Loop'
        if (pendingCommand === 'headless-discussion') return 'Discuss: Headless Agent'
        if (pendingCommand === 'cron-headless') return 'Cron: Headless Agent'
        return 'Start: Headless Agent'
      case 'prompt-input':
        if (pendingCommand === 'cron-headless') return `Cron: Headless Agent - ${selectedAgent?.name}`
        if (pendingCommand === 'headless-discussion') return `Discuss: Headless Agent - ${selectedAgent?.name}`
        if (pendingCommand === 'ralph-loop-discussion') return `Discuss: Ralph Loop - ${selectedAgent?.name}`
        return `Headless Agent - ${selectedAgent?.name}`
      case 'cron-schedule':
        return `Schedule - ${selectedAgent?.name}`
      case 'ralph-loop-config':
        return `Ralph Loop - ${selectedAgent?.name}`
      default:
        return null
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tutorial="cmd-k"
        className="sm:max-w-xl p-0 gap-0 overflow-hidden top-[20%] translate-y-0"
        preventCloseOnOutsideInteraction={tutorialActive}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command Search</DialogTitle>
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
          <div className="p-4" onKeyDown={handleKeyDown}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={pendingCommand === 'headless-discussion' || pendingCommand === 'ralph-loop-discussion'
                ? "Describe what you want to build or accomplish..."
                : "Enter prompt for headless agent..."}
              className="w-full h-32 p-3 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-muted-foreground truncate">
                {selectedAgent?.directory}
              </span>
              {pendingCommand !== 'headless-discussion' && pendingCommand !== 'ralph-loop-discussion' && (
                <div className="flex items-center gap-2 shrink-0">
                  <Tooltip
                    content="Agent will create a read-only plan before coding. You cannot interact with it — use discussion mode to collaborate on a plan."
                    side="top"
                    className="!whitespace-normal w-72 right-0 left-auto translate-x-0"
                  >
                    <label
                      htmlFor="plan-toggle"
                      className="text-xs text-muted-foreground cursor-pointer flex items-center gap-0.5"
                    >Plan <HelpCircle className="h-3 w-3" /></label>
                  </Tooltip>
                  <Switch
                    id="plan-toggle"
                    checked={planPhase}
                    onCheckedChange={setPlanPhase}
                  />
                </div>
              )}
            </div>
            {/* Agent type selector (headless agents only, not discussion modes) */}
            {pendingCommand !== 'headless-discussion' && pendingCommand !== 'ralph-loop-discussion' && pendingCommand !== 'cron-headless' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-muted-foreground">Role</span>
                <div className="flex gap-1">
                  {STANDALONE_AGENT_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setSelectedAgentType(selectedAgentType === type.value ? undefined : type.value)}
                      className={`px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer ${
                        selectedAgentType === type.value
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                      }`}
                      title={type.description}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end mt-2">
              {pendingCommand === 'ralph-loop-discussion' ? (
                <button
                  onClick={() => handleSubmitPrompt('sonnet')}
                  disabled={!prompt.trim()}
                  className="px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Start Discussion
                </button>
              ) : pendingCommand === 'headless-discussion' ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleSubmitPrompt('sonnet')}
                    disabled={!prompt.trim()}
                    className="px-2 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Discuss Sonnet
                  </button>
                  <button
                    onClick={() => handleSubmitPrompt('opus')}
                    disabled={!prompt.trim()}
                    className="px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Discuss Opus
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleSubmitPrompt('sonnet')}
                    disabled={!prompt.trim()}
                    className="px-2 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Launch Sonnet
                  </button>
                  <button
                    onClick={() => handleSubmitPrompt('opus')}
                    disabled={!prompt.trim()}
                    className="px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    Launch Opus
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : mode === 'cron-schedule' ? (
          <div className="p-4 space-y-4" onKeyDown={handleKeyDown}>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Schedule</label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  { label: 'Every hour', cron: '0 * * * *' },
                  { label: 'Every 6 hours', cron: '0 */6 * * *' },
                  { label: 'Daily at 9am', cron: '0 9 * * *' },
                  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
                  { label: 'Weekly (Mon 9am)', cron: '0 9 * * 1' },
                ].map((preset) => (
                  <button
                    key={preset.cron}
                    onClick={() => {
                      setCronSchedule(preset.cron)
                      setCronSchedulePreset(preset.cron)
                    }}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded ${
                      cronSchedulePreset === preset.cron
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  onClick={() => setCronSchedulePreset('custom')}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded ${
                    cronSchedulePreset === 'custom'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                >
                  Custom
                </button>
              </div>
              {cronSchedulePreset === 'custom' && (
                <input
                  type="text"
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="* * * * * (min hour dom month dow)"
                  className="w-full p-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                />
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="font-medium">Agent:</span> {selectedAgent?.name}
              <br />
              <span className="font-medium">Prompt:</span> {prompt.trim().slice(0, 60)}{prompt.length > 60 ? '...' : ''}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSubmitCronSchedule}
                disabled={!cronSchedule}
                className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Create Cron Job
              </button>
            </div>
          </div>
        ) : mode === 'ralph-loop-config' ? (
          <div className="p-4 space-y-4">
            {/* Preset selector */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Preset</label>
              <div className="flex flex-wrap gap-1.5">
                {/* Built-in presets */}
                {RALPH_LOOP_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded ${
                      selectedPreset === preset.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
                {/* Custom presets with different styling */}
                {customPresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handlePresetSelect(preset.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded border ${
                      selectedPreset === preset.id
                        ? 'bg-purple-600 text-white border-purple-600'
                        : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/20'
                    }`}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt textarea */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Prompt</label>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value)
                  // If user edits, switch to custom preset indicator
                  if (selectedPreset !== 'custom') {
                    setSelectedPreset('custom')
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Enter prompt for Ralph Loop..."
                className="w-full min-h-40 p-3 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Completion phrase */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Completion Phrase</label>
              <input
                type="text"
                value={completionPhrase}
                onChange={(e) => setCompletionPhrase(e.target.value)}
                placeholder="<promise>COMPLETE</promise>"
                className="w-full p-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
              <p className="text-xs text-muted-foreground mt-1">Loop stops when this exact text is output</p>
            </div>

            {/* Max iterations and model row */}
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Max Iterations</label>
                <input
                  type="number"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
                  min={1}
                  max={500}
                  className="w-full p-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Model</label>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setRalphModel('sonnet')}
                    className={`flex-1 px-2.5 py-2 text-xs font-medium rounded ${
                      ralphModel === 'sonnet'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    Sonnet
                  </button>
                  <button
                    onClick={() => setRalphModel('opus')}
                    className={`flex-1 px-2.5 py-2 text-xs font-medium rounded ${
                      ralphModel === 'opus'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                  >
                    Opus
                  </button>
                </div>
              </div>
            </div>

            {/* Save preset dialog */}
            {showSaveDialog && (
              <div className="p-3 border rounded-md bg-muted/30 space-y-3">
                <div className="text-xs font-medium">Save as Preset</div>
                <input
                  type="text"
                  value={savePresetLabel}
                  onChange={(e) => setSavePresetLabel(e.target.value)}
                  placeholder="Preset name"
                  className="w-full p-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
                <input
                  type="text"
                  value={savePresetDescription}
                  onChange={(e) => setSavePresetDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full p-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowSaveDialog(false)}
                    className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePreset}
                    disabled={!savePresetLabel.trim()}
                    className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Working directory and start button */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                Working directory: {selectedAgent?.directory}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSaveDialog(true)}
                  disabled={!prompt.trim() || showSaveDialog}
                  className="px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  title="Save as preset"
                >
                  <Save className="h-3 w-3" />
                  Save Preset
                </button>
                <button
                  onClick={handleStartRalphLoop}
                  disabled={!prompt.trim()}
                  className="px-4 py-1.5 text-xs font-medium bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Loop
                </button>
              </div>
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
                              handleSelect(index)
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
                              onSelectAgent(agent.id, selectedAgentType ? { agentType: selectedAgentType } : undefined)
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
                            handleSelect(index)
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

        {/* Role selector for commands/agent-select modes */}
        {(mode === 'commands' || mode === 'agent-select') && (
          <div className="border-t px-4 py-1.5 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Role</span>
            <div className="flex gap-1">
              {STANDALONE_AGENT_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => setSelectedAgentType(selectedAgentType === type.value ? undefined : type.value)}
                  className={`px-2 py-0.5 text-xs rounded-full transition-colors cursor-pointer ${
                    selectedAgentType === type.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                  }`}
                  title={type.description}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer with hints */}
        <div className="border-t px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          {mode === 'prompt-input' && pendingCommand === 'cron-headless' ? (
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
              set schedule
            </span>
          ) : mode === 'prompt-input' ? (
            <>
              <span className="flex items-center gap-1">
                <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
                {headlessModelOverride === 'opus' ? 'Opus' : 'Sonnet'}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+⇧+↵</kbd>
                Opus
              </span>
            </>
          ) : mode === 'cron-schedule' ? (
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
              create cron job
            </span>
          ) : mode === 'ralph-loop-config' ? (
            <span className="flex items-center gap-1">
              <kbd className="bg-muted px-1 py-0.5 rounded">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+↵</kbd>
              start loop
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
