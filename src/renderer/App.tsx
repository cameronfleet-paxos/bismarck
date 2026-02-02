import './index.css'
import './electron.d.ts'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, ChevronRight, ChevronLeft, Settings, Check, X, Maximize2, Minimize2, ListTodo, Container, CheckCircle2, FileText } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { AgentModal } from '@/renderer/components/WorkspaceModal'
import { AgentCard } from '@/renderer/components/WorkspaceCard'
import { AgentIcon } from '@/renderer/components/AgentIcon'
import { Terminal } from '@/renderer/components/Terminal'
import { TabBar } from '@/renderer/components/TabBar'
import { Logo } from '@/renderer/components/Logo'
import { SettingsModal } from '@/renderer/components/SettingsModal'
import { SettingsPage } from '@/renderer/components/SettingsPage'
import { PlanSidebar } from '@/renderer/components/PlanSidebar'
import { PlanCreator } from '@/renderer/components/PlanCreator'
import { HeadlessTerminal } from '@/renderer/components/HeadlessTerminal'
import { DevConsole } from '@/renderer/components/DevConsole'
import { PlanAgentGroup } from '@/renderer/components/PlanAgentGroup'
import { CollapsedPlanGroup } from '@/renderer/components/CollapsedPlanGroup'
import { BootProgressIndicator } from '@/renderer/components/BootProgressIndicator'
import { Breadcrumb } from '@/renderer/components/Breadcrumb'
import { AttentionQueue } from '@/renderer/components/AttentionQueue'
import type { Agent, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, HeadlessAgentInfo, BranchStrategy } from '@/shared/types'
import { themes } from '@/shared/constants'
import { getGridConfig, getGridPosition } from '@/shared/grid-utils'

interface ActiveTerminal {
  terminalId: string
  workspaceId: string
}

// App-level routing
type AppView = 'main' | 'settings'

// Type for terminal write functions
type TerminalWriter = (data: string) => void

function App() {
  // View routing
  const [currentView, setCurrentView] = useState<AppView>('main')

  const [agents, setAgents] = useState<Agent[]>([])
  const [activeTerminals, setActiveTerminals] = useState<ActiveTerminal[]>([])
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<AgentTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>()
  const [waitingQueue, setWaitingQueue] = useState<string[]>([])
  const [preferences, setPreferences] = useState<AppPreferences>({
    attentionMode: 'focus',
    operatingMode: 'solo',
    agentModel: 'sonnet',
    gridSize: '2x2',
  })

  // Team mode state
  const [plans, setPlans] = useState<Plan[]>([])
  const [taskAssignments, setTaskAssignments] = useState<TaskAssignment[]>([])
  const [planActivities, setPlanActivities] = useState<Map<string, PlanActivity[]>>(new Map())
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false)

  // Headless agent state
  const [headlessAgents, setHeadlessAgents] = useState<Map<string, HeadlessAgentInfo>>(new Map())

  // Left sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [planCreatorOpen, setPlanCreatorOpen] = useState(false)

  // Track which terminals have finished booting (by terminalId)
  const [bootedTerminals, setBootedTerminals] = useState<Set<string>>(new Set())

  // Drag-and-drop state
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null)
  const [dropTargetPosition, setDropTargetPosition] = useState<number | null>(null)
  const [dropTargetTabId, setDropTargetTabId] = useState<string | null>(null)

  // Manual maximize state per tab (independent of waiting queue expand mode)
  const [maximizedAgentIdByTab, setMaximizedAgentIdByTab] = useState<Record<string, string | null>>({})

  // Stop confirmation dialog state
  const [stopConfirmAgentId, setStopConfirmAgentId] = useState<string | null>(null)

  // Dev console state (development only)
  const [devConsoleOpen, setDevConsoleOpen] = useState(false)

  // Collapsed plan groups in sidebar
  const [collapsedPlanGroups, setCollapsedPlanGroups] = useState<Set<string>>(new Set())

  // Plan ID to auto-expand in sidebar (cleared after consumption)
  const [expandPlanId, setExpandPlanId] = useState<string | null>(null)

  // Clear expandPlanId after it's been consumed by the sidebar
  useEffect(() => {
    if (expandPlanId) {
      const timer = setTimeout(() => setExpandPlanId(null), 100)
      return () => clearTimeout(timer)
    }
  }, [expandPlanId])

  // Terminal queue status for boot progress indicator
  const [terminalQueueStatus, setTerminalQueueStatus] = useState<{ queued: number; active: number }>({ queued: 0, active: 0 })

  // Central registry of terminal writers - Map of terminalId -> write function
  const terminalWritersRef = useRef<Map<string, TerminalWriter>>(new Map())

  // Register/unregister terminal writers - stable functions for Terminal components
  const registerWriter = useCallback(
    (terminalId: string, writer: TerminalWriter) => {
      terminalWritersRef.current.set(terminalId, writer)
    },
    []
  )

  const unregisterWriter = useCallback((terminalId: string) => {
    terminalWritersRef.current.delete(terminalId)
  }, [])

  // Load agents and state on mount
  useEffect(() => {
    loadAgents()
    loadPreferences()
    loadPlansData()
    setupEventListeners()

    return () => {
      window.electronAPI?.removeAllListeners?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mark terminals as booted after 10 seconds
  useEffect(() => {
    const timers: NodeJS.Timeout[] = []

    activeTerminals.forEach(({ terminalId }) => {
      if (!bootedTerminals.has(terminalId)) {
        const timer = setTimeout(() => {
          setBootedTerminals((prev) => new Set(prev).add(terminalId))
        }, 10000)
        timers.push(timer)
      }
    })

    return () => {
      timers.forEach((timer) => clearTimeout(timer))
    }
  }, [activeTerminals, bootedTerminals])

  const handleFocusAgent = useCallback((agentId: string) => {
    // If switching away from a waiting agent we were focused on, acknowledge it
    if (focusedAgentId && focusedAgentId !== agentId && waitingQueue.includes(focusedAgentId)) {
      window.electronAPI?.acknowledgeWaiting?.(focusedAgentId)
      setWaitingQueue((prev) => prev.filter((id) => id !== focusedAgentId))
    }
    setFocusedAgentId(agentId)
    window.electronAPI?.setFocusedWorkspace?.(agentId)
    // Acknowledge if this agent was waiting
    if (waitingQueue.includes(agentId)) {
      window.electronAPI?.acknowledgeWaiting?.(agentId)
      setWaitingQueue((prev) => prev.filter((id) => id !== agentId))
    }
  }, [focusedAgentId, waitingQueue])

  // Keyboard shortcuts for expand mode and dev console
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to return to main view from settings
      if (e.key === 'Escape' && currentView === 'settings') {
        e.preventDefault()
        setCurrentView('main')
        return
      }

      // Cmd/Ctrl+Shift+D to toggle dev console (development only)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        setDevConsoleOpen(prev => !prev)
        return
      }

      // Determine if we're in auto-expand mode (not manually maximized)
      // For keyboard shortcuts, we need to check the current active tab's maximized state
      const activeTabMaximizedAgentId = activeTabId ? (maximizedAgentIdByTab[activeTabId] || null) : null
      const isExpandModeActive = preferences.attentionMode === 'expand' && waitingQueue.length > 0
      const autoExpandedAgentId = isExpandModeActive ? waitingQueue[0] : null
      const expandedAgentId = activeTabMaximizedAgentId || autoExpandedAgentId
      const isAutoExpanded = expandedAgentId === autoExpandedAgentId && !activeTabMaximizedAgentId

      // Cmd/Ctrl+D to dismiss current waiting agent in expand mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        if (preferences.attentionMode === 'expand' && expandedAgentId && isAutoExpanded) {
          e.preventDefault()
          handleFocusAgent(expandedAgentId)
        }
      }

      // Cmd/Ctrl+N for next waiting agent
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        if (preferences.attentionMode === 'expand' && waitingQueue.length > 1) {
          e.preventDefault()
          const currentAgentId = waitingQueue[0]
          const nextAgentId = waitingQueue[1]

          // Acknowledge/dismiss the current agent
          window.electronAPI?.acknowledgeWaiting?.(currentAgentId)
          setWaitingQueue((prev) => prev.filter((id) => id !== currentAgentId))

          // Switch to tab containing next agent
          const tab = tabs.find((t) => t.workspaceIds.includes(nextAgentId))
          if (tab && tab.id !== activeTabId) {
            window.electronAPI?.setActiveTab?.(tab.id)
            setActiveTabId(tab.id)
          }

          // Focus on next agent but DON'T acknowledge it
          setFocusedAgentId(nextAgentId)
          window.electronAPI?.setFocusedWorkspace?.(nextAgentId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, preferences.attentionMode, waitingQueue, tabs, activeTabId, maximizedAgentIdByTab, handleFocusAgent])

  const loadPreferences = async () => {
    const prefs = await window.electronAPI?.getPreferences?.()
    if (prefs) {
      setPreferences(prefs)
    }
  }

  const loadPlansData = async () => {
    const loadedPlans = await window.electronAPI?.getPlans?.()
    if (loadedPlans) {
      setPlans(loadedPlans)

      // Load activities for all plans (including completed plans for history viewing)
      const activitiesMap = new Map<string, PlanActivity[]>()
      for (const plan of loadedPlans) {
        const activities = await window.electronAPI?.getPlanActivities?.(plan.id)
        if (activities && activities.length > 0) {
          activitiesMap.set(plan.id, activities)
        }
      }
      if (activitiesMap.size > 0) {
        setPlanActivities(activitiesMap)
      }

      // Load task assignments and headless agents for the active plan if there is one
      const activePlan = loadedPlans.find(p => p.status === 'delegating' || p.status === 'in_progress')
      if (activePlan) {
        const loadedAssignments = await window.electronAPI?.getTaskAssignments?.(activePlan.id)
        if (loadedAssignments) {
          setTaskAssignments(loadedAssignments)
        }
        // Load headless agents for the active plan
        const loadedHeadlessAgents = await window.electronAPI?.getHeadlessAgentsForPlan?.(activePlan.id)
        if (loadedHeadlessAgents && loadedHeadlessAgents.length > 0) {
          console.log('[Renderer] Loaded headless agents from main process:', loadedHeadlessAgents.length)
          setHeadlessAgents((prev) => {
            const newMap = new Map(prev)
            for (const info of loadedHeadlessAgents) {
              if (info.taskId) {
                newMap.set(info.taskId, info)
              }
            }
            return newMap
          })
        }
      }
    }
  }

  const handlePreferencesChange = async (newPrefs: Partial<AppPreferences>) => {
    const updated = await window.electronAPI?.setPreferences?.(newPrefs)
    if (updated) {
      setPreferences(updated)
    }
  }

  const setupEventListeners = () => {
    // Listen for initial state from main process
    window.electronAPI?.onInitialState?.((state: AppState) => {
      setTabs(state.tabs || [])
      setActiveTabId(state.activeTabId)
      if (state.focusedWorkspaceId) {
        setFocusedAgentId(state.focusedWorkspaceId)
      }
      // Resume active agents
      if (state.activeWorkspaceIds.length > 0) {
        resumeAgents(state.activeWorkspaceIds)
      }
    })

    // Listen for focus agent events
    window.electronAPI?.onFocusWorkspace?.((agentId: string) => {
      setFocusedAgentId(agentId)
    })

    // Listen for maximize agent events
    window.electronAPI?.onMaximizeWorkspace?.((agentId: string) => {
      // Find which tab contains this agent and maximize it there
      setTabs(currentTabs => {
        const tab = currentTabs.find(t => t.workspaceIds.includes(agentId))
        if (tab) {
          setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: agentId }))
        }
        return currentTabs
      })
    })

    // Listen for waiting queue changes
    window.electronAPI?.onWaitingQueueChanged?.((queue: string[]) => {
      setWaitingQueue(queue)
      window.electronAPI?.updateTray?.(queue.length)
    })

    // Listen for agent waiting events
    window.electronAPI?.onAgentWaiting?.((agentId: string) => {
      console.log(`[Renderer] Received agent-waiting event for ${agentId}`)
      setWaitingQueue((prev) => {
        console.log(`[Renderer] Current queue: ${JSON.stringify(prev)}`)
        if (!prev.includes(agentId)) {
          const newQueue = [...prev, agentId]
          console.log(`[Renderer] Updated queue: ${JSON.stringify(newQueue)}`)
          window.electronAPI?.updateTray?.(newQueue.length)
          return newQueue
        }
        return prev
      })
    })

    // Global terminal data listener - routes data to the appropriate terminal writer
    window.electronAPI?.onTerminalData?.((terminalId: string, data: string) => {
      // Detect Claude banner to end boot phase early
      // Claude outputs "Claude Code" in its startup banner
      if (data.includes('Claude Code')) {
        setBootedTerminals((prev) => {
          if (!prev.has(terminalId)) {
            return new Set(prev).add(terminalId)
          }
          return prev
        })
      }

      const writer = terminalWritersRef.current.get(terminalId)
      if (writer) {
        writer(data)
      }
    })

    // Global terminal exit listener
    window.electronAPI?.onTerminalExit?.((terminalId: string, code: number) => {
      const writer = terminalWritersRef.current.get(terminalId)
      if (writer) {
        writer(`\r\n\x1b[33mProcess exited with code ${code}\x1b[0m\r\n`)
      }
    })

    // Plan event listeners (Team Mode)
    window.electronAPI?.onPlanUpdate?.((plan: Plan) => {
      console.log('[Renderer] Received plan-update', { id: plan.id, orchestratorTabId: plan.orchestratorTabId, status: plan.status })
      setPlans((prev) => {
        const index = prev.findIndex((p) => p.id === plan.id)
        if (index >= 0) {
          const updated = [...prev]
          updated[index] = plan
          return updated
        }
        return [...prev, plan]
      })

      // Clear headless agents when plan is restarted (returns to draft/discussed) or cancelled (failed)
      if (plan.status === 'draft' || plan.status === 'discussed' || plan.status === 'failed') {
        setHeadlessAgents((prev) => {
          const agentsToRemove: string[] = []
          for (const [taskId, info] of prev) {
            if (info.planId === plan.id) {
              agentsToRemove.push(taskId)
            }
          }
          if (agentsToRemove.length > 0) {
            console.log('[Renderer] Clearing headless agents for plan', {
              planId: plan.id,
              planStatus: plan.status,
              agentsToRemove,
              totalAgentsBefore: prev.size,
            })
            const newMap = new Map(prev)
            for (const taskId of agentsToRemove) {
              newMap.delete(taskId)
            }
            console.log('[Renderer] Headless agents cleared', { totalAgentsAfter: newMap.size })
            return newMap
          }
          return prev
        })
      }
    })

    window.electronAPI?.onPlanDeleted?.((planId: string) => {
      console.log('[Renderer] Received plan-deleted', { planId })
      setPlans((prev) => prev.filter((p) => p.id !== planId))
      // Clear any headless agents associated with this plan
      setHeadlessAgents((prev) => {
        const newMap = new Map(prev)
        for (const [taskId, info] of prev) {
          if (info.planId === planId) {
            newMap.delete(taskId)
          }
        }
        return newMap
      })
      // Clear plan activities
      setPlanActivities((prev) => {
        const newMap = new Map(prev)
        newMap.delete(planId)
        return newMap
      })
    })

    window.electronAPI?.onTaskAssignmentUpdate?.((assignment: TaskAssignment) => {
      setTaskAssignments((prev) => {
        const index = prev.findIndex((a) => a.beadId === assignment.beadId)
        if (index >= 0) {
          const updated = [...prev]
          updated[index] = assignment
          return updated
        }
        return [...prev, assignment]
      })
    })

    window.electronAPI?.onPlanActivity?.((activity: PlanActivity) => {
      setPlanActivities((prev) => {
        const newMap = new Map(prev)
        const existing = newMap.get(activity.planId) || []
        newMap.set(activity.planId, [...existing, activity])
        return newMap
      })
    })

    // Listen for state updates (tab changes from orchestrator)
    window.electronAPI?.onStateUpdate?.((state: AppState) => {
      setTabs(state.tabs || [])
      if (state.activeTabId) {
        setActiveTabId(state.activeTabId)
      }

      // Clean up maximized state for workspaces that no longer exist in any tab
      const allWorkspaceIds = new Set(
        (state.tabs || []).flatMap(t => t.workspaceIds)
      )
      setMaximizedAgentIdByTab(prev => {
        const updated = { ...prev }
        let changed = false
        for (const tabId of Object.keys(updated)) {
          if (updated[tabId] && !allWorkspaceIds.has(updated[tabId]!)) {
            updated[tabId] = null
            changed = true
          }
        }
        return changed ? updated : prev
      })

      // Reload agents to pick up new orchestrator workspaces
      loadAgents()
    })

    // Listen for terminal-created events (from orchestrator/plan manager)
    window.electronAPI?.onTerminalCreated?.((data) => {
      setActiveTerminals((prev) => {
        // Avoid duplicates
        if (prev.some(t => t.terminalId === data.terminalId)) return prev
        return [...prev, { terminalId: data.terminalId, workspaceId: data.workspaceId }]
      })
      // Also reload agents to ensure orchestrator workspace is in state
      loadAgents()
    })

    // Headless agent events
    window.electronAPI?.onHeadlessAgentStarted?.((data) => {
      console.log('[Renderer] Received headless-agent-started', data)
      window.electronAPI?.getHeadlessAgentInfo?.(data.taskId).then((info) => {
        console.log('[Renderer] getHeadlessAgentInfo returned:', info)
        if (info) {
          setHeadlessAgents((prev) => {
            const newMap = new Map(prev).set(data.taskId, info)
            console.log('[Renderer] Updated headlessAgents map, size:', newMap.size)
            return newMap
          })
        }
      })
    })

    window.electronAPI?.onHeadlessAgentUpdate?.((info: HeadlessAgentInfo) => {
      console.log('[Renderer] Received headless-agent-update', { taskId: info.taskId, status: info.status })
      const taskId = info.taskId
      if (taskId) {
        setHeadlessAgents((prev) => {
          const newMap = new Map(prev).set(taskId, info)
          console.log('[Renderer] Updated headlessAgents via update event, size:', newMap.size)
          return newMap
        })
      }
    })

    window.electronAPI?.onHeadlessAgentEvent?.((data) => {
      setHeadlessAgents((prev) => {
        const updated = new Map(prev)
        const existing = updated.get(data.taskId)
        if (existing) {
          updated.set(data.taskId, {
            ...existing,
            events: [...existing.events, data.event],
          })
        }
        return updated
      })
    })

    // Terminal queue status for boot progress indicator
    window.electronAPI?.onTerminalQueueStatus?.((status) => {
      setTerminalQueueStatus({ queued: status.queued, active: status.active })
    })
  }

  const resumeAgents = async (agentIds: string[]) => {
    for (const agentId of agentIds) {
      try {
        // Start fresh claude session (don't try to resume - agent IDs are not valid Claude session IDs)
        const terminalId = await window.electronAPI.createTerminal(agentId)
        setActiveTerminals((prev) => [
          ...prev,
          { terminalId, workspaceId: agentId },
        ])
      } catch (e) {
        console.error(`Failed to start agent ${agentId}:`, e)
      }
    }
    // Refresh tabs after resuming
    const state = await window.electronAPI.getState()
    setTabs(state.tabs || [])
    setActiveTabId(state.activeTabId)
  }

  const loadAgents = async () => {
    const ws = await window.electronAPI.getWorkspaces()
    setAgents(ws)
  }

  const handleSaveAgent = async (agent: Agent) => {
    await window.electronAPI.saveWorkspace(agent)
    await loadAgents()
    setEditingAgent(undefined)
  }

  const handleDeleteAgent = async (id: string) => {
    // Stop terminal if running
    const activeTerminal = activeTerminals.find((t) => t.workspaceId === id)
    if (activeTerminal) {
      await window.electronAPI.closeTerminal(activeTerminal.terminalId)
      await window.electronAPI.stopWorkspace(id)
      setActiveTerminals((prev) => prev.filter((t) => t.workspaceId !== id))
    }
    await window.electronAPI.deleteWorkspace(id)
    await loadAgents()
    setWaitingQueue((prev) => prev.filter((wid) => wid !== id))
    // Refresh tabs
    const state = await window.electronAPI.getState()
    setTabs(state.tabs || [])
  }

  const handleLaunchAgent = async (agentId: string) => {
    // Check if already running
    if (activeTerminals.some((t) => t.workspaceId === agentId)) {
      // Find which tab contains this agent and switch to it
      const tab = tabs.find((t) => t.workspaceIds.includes(agentId))
      if (tab) {
        setActiveTabId(tab.id)
        await window.electronAPI?.setActiveTab?.(tab.id)
      }
      setFocusedAgentId(agentId)
      window.electronAPI?.setFocusedWorkspace?.(agentId)
      return
    }

    const terminalId = await window.electronAPI.createTerminal(agentId)
    setActiveTerminals((prev) => [...prev, { terminalId, workspaceId: agentId }])
    setFocusedAgentId(agentId)
    window.electronAPI?.setFocusedWorkspace?.(agentId)

    // Refresh tabs to get the updated state (main process handles tab placement)
    const state = await window.electronAPI.getState()
    setTabs(state.tabs || [])
    setActiveTabId(state.activeTabId)
  }

  const handleStopAgent = async (agentId: string) => {
    const activeTerminal = activeTerminals.find(
      (t) => t.workspaceId === agentId
    )
    if (activeTerminal) {
      await window.electronAPI.closeTerminal(activeTerminal.terminalId)
      await window.electronAPI.stopWorkspace(agentId)
      setActiveTerminals((prev) =>
        prev.filter((t) => t.workspaceId !== agentId)
      )
      setWaitingQueue((prev) => prev.filter((id) => id !== agentId))
      if (focusedAgentId === agentId) {
        setFocusedAgentId(null)
        window.electronAPI?.setFocusedWorkspace?.(undefined)
      }
      // Clear maximize if this agent was maximized in any tab
      setMaximizedAgentIdByTab(prev => {
        const updated = { ...prev }
        let changed = false
        for (const tabId of Object.keys(updated)) {
          if (updated[tabId] === agentId) {
            updated[tabId] = null
            changed = true
          }
        }
        return changed ? updated : prev
      })
      // Refresh tabs
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
    }
  }

  const handleEditAgent = (agent: Agent) => {
    setEditingAgent(agent)
    setModalOpen(true)
  }

  const handleStopHeadlessAgent = async (agent: Agent) => {
    if (agent.taskId) {
      await window.electronAPI?.stopHeadlessAgent?.(agent.taskId)
      // Remove from headless agents map
      setHeadlessAgents((prev) => {
        const newMap = new Map(prev)
        newMap.delete(agent.taskId!)
        return newMap
      })
      // Reload agents to remove the headless agent workspace
      await loadAgents()
    }
  }

  const handleAddAgent = () => {
    setEditingAgent(undefined)
    setModalOpen(true)
  }

  const handleNextWaiting = () => {
    if (waitingQueue.length > 1) {
      const currentAgentId = waitingQueue[0]
      const nextAgentId = waitingQueue[1]

      // Acknowledge/dismiss the current agent
      window.electronAPI?.acknowledgeWaiting?.(currentAgentId)
      setWaitingQueue((prev) => prev.filter((id) => id !== currentAgentId))

      // Switch to the tab containing the next agent
      const tab = tabs.find((t) => t.workspaceIds.includes(nextAgentId))
      if (tab && tab.id !== activeTabId) {
        handleTabSelect(tab.id)
      }

      // Focus on the next agent but DON'T acknowledge it yet
      // (it stays in queue so expand mode shows it)
      setFocusedAgentId(nextAgentId)
      window.electronAPI?.setFocusedWorkspace?.(nextAgentId)
    }
  }

  // Tab handlers
  const handleTabSelect = async (tabId: string) => {
    setActiveTabId(tabId)
    await window.electronAPI?.setActiveTab?.(tabId)
  }

  const handleTabRename = async (tabId: string, name: string) => {
    await window.electronAPI?.renameTab?.(tabId, name)
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, name } : t))
    )
  }

  const handleTabDelete = async (tabId: string) => {
    const result = await window.electronAPI?.deleteTab?.(tabId)
    if (result?.success) {
      // Stop all agents in the deleted tab
      for (const workspaceId of result.workspaceIds) {
        const terminal = activeTerminals.find(
          (t) => t.workspaceId === workspaceId
        )
        if (terminal) {
          await window.electronAPI.closeTerminal(terminal.terminalId)
          setActiveTerminals((prev) =>
            prev.filter((t) => t.workspaceId !== workspaceId)
          )
        }
      }
      // Refresh tabs
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
      setActiveTabId(state.activeTabId)
    }
  }

  const handleTabCreate = async () => {
    const newTab = await window.electronAPI?.createTab?.()
    if (newTab) {
      setTabs((prev) => [...prev, newTab])
      setActiveTabId(newTab.id)
      await window.electronAPI?.setActiveTab?.(newTab.id)
    }
  }

  const handleMoveAgentToTab = async (agentId: string, targetTabId: string) => {
    const success = await window.electronAPI?.moveWorkspaceToTab?.(agentId, targetTabId)
    if (success) {
      // Refresh tabs to get updated state
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
      // Switch to the target tab if we moved an active agent
      if (activeTerminals.some((t) => t.workspaceId === agentId)) {
        setActiveTabId(targetTabId)
        await window.electronAPI?.setActiveTab?.(targetTabId)
      }
    }
  }

  const handleDropOnTab = async (workspaceId: string, targetTabId: string) => {
    const success = await window.electronAPI?.moveWorkspaceToTab?.(workspaceId, targetTabId)
    if (success) {
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
      // Switch to target tab
      setActiveTabId(targetTabId)
      await window.electronAPI?.setActiveTab?.(targetTabId)
    }
    setDropTargetTabId(null)
    setDraggedWorkspaceId(null)
  }

  const handleReorderInTab = async (sourceWorkspaceId: string, targetPosition: number) => {
    if (!activeTabId) return

    const success = await window.electronAPI?.reorderWorkspaceInTab?.(
      activeTabId,
      sourceWorkspaceId,
      targetPosition
    )
    if (success) {
      // Refresh tabs to get updated state
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
    }
  }

  const getTerminalForAgent = useCallback(
    (agentId: string) => {
      return activeTerminals.find((t) => t.workspaceId === agentId)
    },
    [activeTerminals]
  )

  const isAgentWaiting = (agentId: string) => waitingQueue.includes(agentId)

  // Get headless agents for a plan tab
  const getHeadlessAgentsForTab = useCallback((tab: AgentTab): HeadlessAgentInfo[] => {
    const plan = plans.find((p) => p.orchestratorTabId === tab.id)
    if (!plan) {
      // Only log for plan tabs to avoid noise
      if (tab.isPlanTab) {
        console.log('[Renderer] getHeadlessAgentsForTab: No plan found for tab', tab.id, 'plans:', plans.map(p => ({ id: p.id, tabId: p.orchestratorTabId })))
      }
      return []
    }
    const agents = Array.from(headlessAgents.values()).filter((info) => info.planId === plan.id)
    console.log('[Renderer] getHeadlessAgentsForTab:', { tabId: tab.id, planId: plan.id, agentsFound: agents.length, headlessAgentsTotal: headlessAgents.size, allHeadless: Array.from(headlessAgents.entries()) })
    return agents
  }, [plans, headlessAgents])

  // Debug: Log headlessAgents state changes
  useEffect(() => {
    console.log('[Renderer] headlessAgents state changed:', headlessAgents.size, Array.from(headlessAgents.keys()))
  }, [headlessAgents])

  // Group agents by plan for sidebar display
  const groupAgentsByPlan = useCallback(() => {
    const planGroups: Map<string, { plan: Plan; agents: Agent[] }> = new Map()
    const standaloneAgents: Agent[] = []

    // Helper to add agent to a plan group
    const addToPlanGroup = (plan: Plan, agent: Agent) => {
      const existing = planGroups.get(plan.id)
      if (existing) {
        existing.agents.push(agent)
      } else {
        planGroups.set(plan.id, { plan, agents: [agent] })
      }
    }

    for (const agent of agents) {
      // Check if this is an orchestrator or plan agent - group by their plan
      if (agent.isOrchestrator) {
        const plan = plans.find((p) => p.orchestratorWorkspaceId === agent.id)
        if (plan) {
          addToPlanGroup(plan, agent)
          continue
        }
      }
      if (agent.isPlanAgent) {
        const plan = plans.find((p) => p.planAgentWorkspaceId === agent.id)
        if (plan) {
          addToPlanGroup(plan, agent)
          continue
        }
      }

      // Check if this is a task agent with parentPlanId
      if (agent.parentPlanId) {
        const plan = plans.find((p) => p.id === agent.parentPlanId)
        if (plan) {
          addToPlanGroup(plan, agent)
        } else {
          // Plan not found, treat as standalone
          standaloneAgents.push(agent)
        }
      } else {
        standaloneAgents.push(agent)
      }
    }

    // Sort plan groups by status: active first, then ready_for_review, then completed
    const statusOrder: Record<string, number> = {
      delegating: 0,
      in_progress: 0,
      ready_for_review: 1,
      completed: 2,
      failed: 2,
      draft: 3,
    }
    const sortedPlanGroups = Array.from(planGroups.values()).sort((a, b) => {
      const aOrder = statusOrder[a.plan.status] ?? 4
      const bOrder = statusOrder[b.plan.status] ?? 4
      return aOrder - bOrder
    })

    return { planGroups: sortedPlanGroups, standaloneAgents }
  }, [agents, plans])

  // Plan handlers (Team Mode)
  // Note: We don't update local state here because the onPlanUpdate event listener handles it
  const handleCreatePlan = async (title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: BranchStrategy }) => {
    await window.electronAPI?.createPlan?.(title, description, options)
  }

  const handleExecutePlan = async (planId: string, referenceAgentId: string) => {
    console.log('[App] handleExecutePlan called:', { planId, referenceAgentId })
    console.log('[App] electronAPI available:', !!window.electronAPI)
    console.log('[App] executePlan available:', !!window.electronAPI?.executePlan)
    const result = await window.electronAPI?.executePlan?.(planId, referenceAgentId)
    console.log('[App] executePlan result:', result)

    // Navigate to the plan's tab
    if (result?.orchestratorTabId) {
      setActiveTabId(result.orchestratorTabId)
      await window.electronAPI?.setActiveTab?.(result.orchestratorTabId)
    }

    // Expand the plan in sidebar
    setExpandPlanId(planId)

    return result
  }

  const handleStartDiscussion = async (planId: string, referenceAgentId: string) => {
    await window.electronAPI?.startDiscussion?.(planId, referenceAgentId)
  }

  const handleCancelDiscussion = async (planId: string) => {
    await window.electronAPI?.cancelDiscussion?.(planId)
  }

  const handleCancelPlan = async (planId: string) => {
    await window.electronAPI?.cancelPlan?.(planId)
  }

  const handleRestartPlan = async (planId: string) => {
    await window.electronAPI?.restartPlan?.(planId)
  }

  const handleCompletePlan = async (planId: string) => {
    await window.electronAPI?.completePlan?.(planId)
  }

  const handleRequestFollowUps = async (planId: string) => {
    await window.electronAPI?.requestFollowUps?.(planId)
  }

  const handleDeletePlans = async (planIds: string[]) => {
    await window.electronAPI?.deletePlans?.(planIds)
  }

  const handleClonePlan = async (planId: string, options?: { includeDiscussion?: boolean }) => {
    await window.electronAPI?.clonePlan?.(planId, options)
  }

  const handleSelectPlan = async (planId: string | null) => {
    setActivePlanId(planId)
    window.electronAPI?.setActivePlanId?.(planId)
    // Load task assignments for the selected plan
    if (planId) {
      const loadedAssignments = await window.electronAPI?.getTaskAssignments?.(planId)
      if (loadedAssignments) {
        setTaskAssignments(loadedAssignments)
      }
    } else {
      setTaskAssignments([])
    }
  }

  const handleTogglePlanSidebar = () => {
    const newOpen = !planSidebarOpen
    setPlanSidebarOpen(newOpen)
    window.electronAPI?.setPlanSidebarOpen?.(newOpen)
  }

  // Count active plans for badge
  const activePlansCount = plans.filter(
    (p) => p.status === 'delegating' || p.status === 'in_progress'
  ).length

  // Grid configuration based on user preference
  const gridConfig = getGridConfig(preferences.gridSize)
  const gridPositions = gridConfig.positions

  // Empty state
  if (agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <h1 className="text-foreground mb-4">
            <Logo size="lg" />
          </h1>
          <p className="text-muted-foreground mb-6">
            No agents configured. Add one to get started.
          </p>
          <Button onClick={handleAddAgent}>
            <Plus className="h-4 w-4 mr-2" />
            Add Agent
          </Button>
        </div>
        <AgentModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          agent={editingAgent}
          onSave={handleSaveAgent}
        />
      </div>
    )
  }

  // Render both views but show only one - prevents terminal unmount/remount
  return (
    <>
      {/* Settings view - rendered on top when active */}
      {currentView === 'settings' && (
        <SettingsPage onBack={() => setCurrentView('main')} />
      )}

      {/* Main workspace view - always rendered to preserve terminal state */}
      <div className={`h-screen bg-background flex flex-col ${currentView === 'settings' ? 'hidden' : ''}`}>
      {/* Header */}
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <BootProgressIndicator
            queued={terminalQueueStatus.queued}
            active={terminalQueueStatus.active}
          />
          {waitingQueue.length > 0 && (
            <span className="bg-yellow-500 text-black text-xs font-medium px-2 py-0.5 rounded-full">
              {waitingQueue.length} waiting
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {waitingQueue.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextWaiting}
              className="text-yellow-600 border-yellow-500 hover:bg-yellow-500/10"
            >
              <ChevronRight className="h-4 w-4 mr-1" />
              Next ({waitingQueue.length - 1})
            </Button>
          )}
          <Button size="sm" onClick={handleAddAgent}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
          {preferences.operatingMode === 'team' && (
            <Button
              size="sm"
              variant={planSidebarOpen ? 'secondary' : 'ghost'}
              onClick={handleTogglePlanSidebar}
            >
              <ListTodo className="h-4 w-4 mr-1" />
              Plans
              {activePlansCount > 0 && (
                <span className="ml-1 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
                  {activePlansCount}
                </span>
              )}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCurrentView('settings')}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabRename={handleTabRename}
        onTabDelete={handleTabDelete}
        onTabCreate={handleTabCreate}
        draggedWorkspaceId={draggedWorkspaceId}
        dropTargetTabId={dropTargetTabId}
        onTabDragOver={(tabId) => setDropTargetTabId(tabId)}
        onTabDragLeave={() => setDropTargetTabId(null)}
        onTabDrop={handleDropOnTab}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Agent list */}
        <aside className={`${sidebarCollapsed ? 'w-12' : 'w-64'} border-r flex flex-col overflow-hidden transition-all duration-200`}>
          {/* Header with toggle */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} p-2 border-b`}>
            {!sidebarCollapsed && <span className="text-sm font-medium">Agents</span>}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="h-6 w-6"
            >
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-hide p-2">
            {sidebarCollapsed ? (
              /* Collapsed: icon-only view - horizontal layout */
              (() => {
                const { planGroups, standaloneAgents } = groupAgentsByPlan()
                return (
                  <div className="flex flex-row flex-wrap gap-2 justify-center">
                    {/* Plan groups */}
                    {planGroups.map(({ plan, agents: planAgents }) => (
                      <CollapsedPlanGroup
                        key={plan.id}
                        plan={plan}
                        agents={planAgents}
                        waitingQueue={waitingQueue}
                        activeTerminals={activeTerminals}
                        onExpandSidebar={() => setSidebarCollapsed(false)}
                      />
                    ))}
                    {/* Standalone agents */}
                    {standaloneAgents.map((agent) => {
                      const isActive = activeTerminals.some((t) => t.workspaceId === agent.id)
                      const isWaiting = isAgentWaiting(agent.id)
                      const isFocused = focusedAgentId === agent.id
                      const agentTab = tabs.find((t) => t.workspaceIds.includes(agent.id))
                      const themeColors = themes[agent.theme]
                      return (
                        <button
                          key={agent.id}
                          onClick={() => {
                            setSidebarCollapsed(false)
                            if (isActive) {
                              if (agentTab && agentTab.id !== activeTabId) {
                                handleTabSelect(agentTab.id)
                              }
                              handleFocusAgent(agent.id)
                            }
                          }}
                          className={`p-1.5 rounded-md hover:brightness-110 transition-all ${
                            isWaiting ? 'ring-2 ring-yellow-500' : ''
                          } ${isFocused ? 'ring-2 ring-white/50' : ''}`}
                          style={{ backgroundColor: themeColors.bg }}
                          title={agent.name}
                        >
                          <AgentIcon icon={agent.icon} className="w-5 h-5" />
                        </button>
                      )
                    })}
                  </div>
                )
              })()
            ) : (
              /* Expanded: full cards with plan grouping */
              (() => {
                const { planGroups, standaloneAgents } = groupAgentsByPlan()
                const handleAgentClick = (agentId: string, agentTab: AgentTab | undefined) => {
                  if (activeTerminals.some((t) => t.workspaceId === agentId)) {
                    if (agentTab && agentTab.id !== activeTabId) {
                      handleTabSelect(agentTab.id)
                    }
                    handleFocusAgent(agentId)
                  }
                }
                return (
                  <div className="space-y-3">
                    {/* Plan groups */}
                    {planGroups.map(({ plan, agents: planAgents }) => (
                      <PlanAgentGroup
                        key={plan.id}
                        plan={plan}
                        agents={planAgents}
                        isCollapsed={collapsedPlanGroups.has(plan.id)}
                        onToggleCollapse={() => {
                          setCollapsedPlanGroups((prev) => {
                            const next = new Set(prev)
                            if (next.has(plan.id)) {
                              next.delete(plan.id)
                            } else {
                              next.add(plan.id)
                            }
                            return next
                          })
                        }}
                        activeTerminals={activeTerminals}
                        waitingQueue={waitingQueue}
                        focusedAgentId={focusedAgentId}
                        tabs={tabs}
                        activeTabId={activeTabId}
                        onAgentClick={handleAgentClick}
                        onEditAgent={handleEditAgent}
                        onDeleteAgent={handleDeleteAgent}
                        onLaunchAgent={handleLaunchAgent}
                        onStopAgent={handleStopAgent}
                        onMoveToTab={handleMoveAgentToTab}
                        onStopHeadless={handleStopHeadlessAgent}
                      />
                    ))}
                    {/* Standalone agents */}
                    {standaloneAgents.map((agent) => {
                      const agentTab = tabs.find((t) =>
                        t.workspaceIds.includes(agent.id)
                      )
                      return (
                        <AgentCard
                          key={agent.id}
                          agent={agent}
                          isActive={activeTerminals.some(
                            (t) => t.workspaceId === agent.id
                          )}
                          isWaiting={isAgentWaiting(agent.id)}
                          isFocused={focusedAgentId === agent.id}
                          tabs={tabs}
                          currentTabId={agentTab?.id}
                          onClick={() => {
                            if (activeTerminals.some((t) => t.workspaceId === agent.id)) {
                              if (agentTab && agentTab.id !== activeTabId) {
                                handleTabSelect(agentTab.id)
                              }
                              handleFocusAgent(agent.id)
                            }
                          }}
                          onEdit={() => handleEditAgent(agent)}
                          onDelete={() => handleDeleteAgent(agent.id)}
                          onLaunch={() => handleLaunchAgent(agent.id)}
                          onStop={() => handleStopAgent(agent.id)}
                          onMoveToTab={(tabId) => handleMoveAgentToTab(agent.id, tabId)}
                          onStopHeadless={() => handleStopHeadlessAgent(agent)}
                        />
                      )
                    })}
                  </div>
                )
              })()
            )}
          </div>
        </aside>

        {/* Terminal area - Fixed 2x2 grid per tab */}
        <main className="flex-1 overflow-hidden p-2 relative">
          {/* Render all tabs, with expand mode applied via CSS */}
          {tabs.map((tab) => {
            const isActiveTab = tab.id === activeTabId
            const tabWorkspaceIds = tab.workspaceIds
            const isExpandModeActive = preferences.attentionMode === 'expand' && waitingQueue.length > 0
            // Auto-expand the first waiting agent in expand mode
            const autoExpandedAgentId = isExpandModeActive ? waitingQueue[0] : null
            // Use per-tab maximized state - only applies when this tab is active
            const tabMaximizedAgentId = isActiveTab ? (maximizedAgentIdByTab[tab.id] || null) : null
            const expandedAgentId = tabMaximizedAgentId || autoExpandedAgentId
            // In auto-expand mode (attention mode), show the tab containing the waiting agent
            // For manual maximize, the tab must be active (handled above by nulling tabMaximizedAgentId)
            const tabContainsAutoExpandedAgent = autoExpandedAgentId && tabWorkspaceIds.includes(autoExpandedAgentId)
            const shouldShowTab = tabContainsAutoExpandedAgent ? true : isActiveTab

            return (
              <div
                key={tab.id}
                className={`absolute inset-2 ${shouldShowTab ? '' : 'invisible pointer-events-none'}`}
              >
                {tabWorkspaceIds.length === 0 && getHeadlessAgentsForTab(tab).length === 0 ? (
                  tab.isPlanTab && plans.find(p => p.orchestratorTabId === tab.id && p.status === 'discussed') ? (
                    <div className="h-full flex flex-col items-center justify-center text-center gap-4 p-8">
                      <CheckCircle2 className="h-12 w-12 text-green-500" />
                      <div>
                        <h3 className="text-lg font-medium">Discussion Complete</h3>
                        <p className="text-muted-foreground mt-2">
                          Open the Plans panel to select a reference agent and execute your plan.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setPlanSidebarOpen(true)}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Open Plans
                      </Button>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      Launch an agent to see the terminal
                    </div>
                  )
                ) : tab.isPlanTab ? (
                  // Scrollable 2-column grid for plan tabs (unlimited agents)
                  // Use CSS grid with fixed row heights that match the regular 2x2 layout
                  <div
                    className="h-full overflow-y-auto grid gap-2 p-1 relative"
                    style={{
                      gridTemplateColumns: '1fr 1fr',
                      gridAutoRows: 'calc(50% - 4px)',
                    }}
                  >
                    {activeTerminals
                      .filter((t) => tabWorkspaceIds.includes(t.workspaceId))
                      .map((terminal) => {
                        const workspaceId = terminal.workspaceId
                        const agent = agents.find((a) => a.id === workspaceId)
                        if (!agent) return null

                        const isWaiting = isAgentWaiting(workspaceId)
                        const isFocused = focusedAgentId === workspaceId
                        const isExpanded = expandedAgentId === workspaceId
                        const isAutoExpanded = autoExpandedAgentId === workspaceId

                        return (
                          <div
                            key={`${terminal.terminalId}-${tab.id}`}
                            className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                              isFocused ? 'ring-2 ring-primary' : ''
                            } ${isWaiting ? 'ring-2 ring-yellow-500' : ''} ${
                              !isExpanded && expandedAgentId ? 'invisible' : ''
                            } ${isExpanded ? 'absolute inset-0 z-10' : ''}`}
                            onClick={() => {
                              if (!isExpanded) {
                                handleFocusAgent(workspaceId)
                              }
                            }}
                          >
                            <div
                              className={`px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between ${
                                isWaiting ? 'bg-yellow-500/20' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <AgentIcon icon={agent.icon} className="w-4 h-4" />
                                <span>{agent.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {isWaiting && (
                                  <span className="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">
                                    Waiting
                                  </span>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (isExpanded) {
                                      setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: null }))
                                    } else {
                                      setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: workspaceId }))
                                    }
                                  }}
                                  className="h-6 w-6 p-0"
                                >
                                  {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setStopConfirmAgentId(workspaceId)
                                  }}
                                  className="h-6 w-6 p-0"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                                {isAutoExpanded && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleFocusAgent(workspaceId)
                                      }}
                                      className="h-6 text-xs"
                                    >
                                      <Check className="h-3 w-3 mr-1" />
                                      Dismiss {navigator.platform.includes('Mac') ? '⌘D' : 'Ctrl+D'}
                                    </Button>
                                    {waitingQueue.length > 1 && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleNextWaiting()
                                        }}
                                        className="h-6 text-xs text-yellow-600 border-yellow-500 hover:bg-yellow-500/10"
                                      >
                                        <ChevronRight className="h-3 w-3 mr-1" />
                                        Next ({waitingQueue.length - 1}) {navigator.platform.includes('Mac') ? '⌘N' : 'Ctrl+N'}
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="h-[calc(100%-2rem)]">
                              <Terminal
                                terminalId={terminal.terminalId}
                                theme={agent.theme}
                                isBooting={!bootedTerminals.has(terminal.terminalId)}
                                isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                                registerWriter={registerWriter}
                                unregisterWriter={unregisterWriter}
                              />
                            </div>
                          </div>
                        )
                      })}
                    {/* Headless agent terminals */}
                    {getHeadlessAgentsForTab(tab).map((info) => {
                      console.log('[Renderer] Rendering HeadlessTerminal for', { taskId: info.taskId, status: info.status })
                      const isExpanded = expandedAgentId === info.id
                      return (
                        <div
                          key={info.id}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10' : ''}`}
                        >
                          <div className="px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span>Task {info.taskId}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => window.electronAPI.openDockerDesktop()}
                                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors cursor-pointer"
                                title="Open Docker Desktop"
                              >
                                <Container className="h-3 w-3" />
                                <span>Docker</span>
                              </button>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                info.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                info.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                info.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>{info.status}</span>
                              <Button size="sm" variant="ghost" onClick={() => setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: isExpanded ? null : info.id }))} className="h-6 w-6 p-0">
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <HeadlessTerminal events={info.events} theme="teal" status={info.status} isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  // Regular grid for normal tabs (size based on user preference)
                  <div
                    className="h-full grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${gridConfig.cols}, 1fr)`,
                      gridTemplateRows: `repeat(${gridConfig.rows}, 1fr)`,
                    }}
                  >
                    {/* Render active terminals - keyed by terminalId, positioned by CSS grid */}
                    {/* Iterate over activeTerminals (stable order) and look up position from tabWorkspaceIds */}
                    {activeTerminals
                      .filter((t) => tabWorkspaceIds.includes(t.workspaceId))
                      .map((terminal) => {
                        const workspaceId = terminal.workspaceId
                        const position = tabWorkspaceIds.indexOf(workspaceId)
                        if (position === -1) return null
                        const agent = agents.find((a) => a.id === workspaceId)
                        if (!agent) return null

                      const { row: gridRow, col: gridCol } = getGridPosition(position, gridConfig.cols)
                      const isDropTarget = dropTargetPosition === position && isActiveTab
                      const isWaiting = isAgentWaiting(workspaceId)
                      const isFocused = focusedAgentId === workspaceId
                      const isExpanded = expandedAgentId === workspaceId
                      const isAutoExpanded = autoExpandedAgentId === workspaceId // for showing Dismiss/Next buttons
                      const isDragging = draggedWorkspaceId === workspaceId

                      return (
                        <div
                          key={`${terminal.terminalId}-${tab.id}`}
                          style={{ gridRow, gridColumn: gridCol }}
                          draggable={!expandedAgentId}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('workspaceId', workspaceId)
                            setDraggedWorkspaceId(workspaceId)
                          }}
                          onDragEnd={() => {
                            setDraggedWorkspaceId(null)
                            setDropTargetPosition(null)
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (!expandedAgentId) {
                              setDropTargetPosition(position)
                            }
                          }}
                          onDragLeave={() => setDropTargetPosition(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            const sourceId = e.dataTransfer.getData('workspaceId')
                            if (sourceId && sourceId !== workspaceId && !expandedAgentId) {
                              handleReorderInTab(sourceId, position)
                            }
                            setDropTargetPosition(null)
                            setDraggedWorkspaceId(null)
                          }}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            isFocused ? 'ring-2 ring-primary' : ''
                          } ${isWaiting ? 'ring-2 ring-yellow-500' : ''} ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10' : ''} ${
                            isDragging ? 'opacity-50' : ''
                          } ${isDropTarget && !isDragging ? 'ring-2 ring-primary ring-offset-2' : ''} ${
                            !expandedAgentId ? 'cursor-grab active:cursor-grabbing' : ''
                          }`}
                          onClick={() => {
                            // In expand mode, clicking the terminal shouldn't dismiss it
                            // Only the Dismiss button should do that
                            if (!isExpanded) {
                              handleFocusAgent(workspaceId)
                            }
                          }}
                        >
                          <div
                            className={`px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between ${
                              isWaiting ? 'bg-yellow-500/20' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <AgentIcon icon={agent.icon} className="w-4 h-4" />
                              <span>{agent.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {isWaiting && (
                                <span className="text-xs bg-yellow-500 text-black px-1.5 py-0.5 rounded">
                                  Waiting
                                </span>
                              )}
                              {/* Maximize/Minimize button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (isExpanded) {
                                    setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: null })) // minimize
                                  } else {
                                    setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: workspaceId })) // maximize
                                  }
                                }}
                                className="h-6 w-6 p-0"
                              >
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                              {/* X (stop) button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setStopConfirmAgentId(workspaceId)
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                              {/* Existing expand mode buttons (only show for auto-expanded) */}
                              {isAutoExpanded && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleFocusAgent(workspaceId)
                                    }}
                                    className="h-6 text-xs"
                                  >
                                    <Check className="h-3 w-3 mr-1" />
                                    Dismiss {navigator.platform.includes('Mac') ? '⌘D' : 'Ctrl+D'}
                                  </Button>
                                  {waitingQueue.length > 1 && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleNextWaiting()
                                      }}
                                      className="h-6 text-xs text-yellow-600 border-yellow-500 hover:bg-yellow-500/10"
                                    >
                                      <ChevronRight className="h-3 w-3 mr-1" />
                                      Next ({waitingQueue.length - 1}) {navigator.platform.includes('Mac') ? '⌘N' : 'Ctrl+N'}
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <Terminal
                              terminalId={terminal.terminalId}
                              theme={agent.theme}
                              isBooting={!bootedTerminals.has(terminal.terminalId)}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              registerWriter={registerWriter}
                              unregisterWriter={unregisterWriter}
                            />
                          </div>
                        </div>
                      )
                    })}

                    {/* Render empty slots separately - keyed by position */}
                    {gridPositions.map((position) => {
                      if (tabWorkspaceIds[position]) return null // Skip if occupied
                      const { row: gridRow, col: gridCol } = getGridPosition(position, gridConfig.cols)
                      const isDropTarget = dropTargetPosition === position && isActiveTab

                      return (
                        <div
                          key={`empty-${tab.id}-${position}`}
                          style={{ gridRow, gridColumn: gridCol }}
                          className={`rounded-lg border border-dashed flex items-center justify-center text-muted-foreground/40 transition-colors ${
                            expandedAgentId ? 'invisible' : ''
                          } ${
                            isDropTarget
                              ? 'border-primary bg-primary/10 border-solid'
                              : 'border-muted-foreground/20'
                          }`}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (!expandedAgentId) {
                              setDropTargetPosition(position)
                            }
                          }}
                          onDragLeave={() => setDropTargetPosition(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            const sourceId = e.dataTransfer.getData('workspaceId')
                            if (sourceId && !expandedAgentId) {
                              handleReorderInTab(sourceId, position)
                            }
                            setDropTargetPosition(null)
                            setDraggedWorkspaceId(null)
                          }}
                        >
                          <span className="text-sm">
                            {isDropTarget ? 'Drop here' : 'Empty slot'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </main>

        {/* Plan Sidebar (Team Mode only) */}
        {preferences.operatingMode === 'team' && (
          <PlanSidebar
            open={planSidebarOpen}
            onClose={() => {
              setPlanSidebarOpen(false)
              window.electronAPI?.setPlanSidebarOpen?.(false)
            }}
            plans={plans}
            taskAssignments={taskAssignments}
            planActivities={planActivities}
            agents={agents}
            activePlanId={activePlanId}
            expandPlanId={expandPlanId}
            onCreatePlan={() => setPlanCreatorOpen(true)}
            onSelectPlan={handleSelectPlan}
            onExecutePlan={handleExecutePlan}
            onStartDiscussion={handleStartDiscussion}
            onCancelDiscussion={handleCancelDiscussion}
            onCancelPlan={handleCancelPlan}
            onRestartPlan={handleRestartPlan}
            onCompletePlan={handleCompletePlan}
            onRequestFollowUps={handleRequestFollowUps}
            onDeletePlans={handleDeletePlans}
            onClonePlan={handleClonePlan}
          />
        )}
      </div>

      <AgentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        agent={editingAgent}
        onSave={handleSaveAgent}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        preferences={preferences}
        onPreferencesChange={handlePreferencesChange}
      />

      {/* Stop Agent Confirmation Dialog */}
      <Dialog
        open={stopConfirmAgentId !== null}
        onOpenChange={(open) => !open && setStopConfirmAgentId(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Stop Agent</DialogTitle>
            <DialogDescription>
              Are you sure you want to stop this agent? Any unsaved progress will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStopConfirmAgentId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (stopConfirmAgentId) {
                  handleStopAgent(stopConfirmAgentId)
                  setStopConfirmAgentId(null)
                }
              }}
            >
              Stop Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Plan Creator Modal (Team Mode) */}
      <PlanCreator
        open={planCreatorOpen}
        onOpenChange={setPlanCreatorOpen}
        onCreatePlan={handleCreatePlan}
      />

      {/* Attention Queue (queue mode only) */}
      {preferences.attentionMode === 'queue' && waitingQueue.length > 0 && currentView === 'main' && (
        <AttentionQueue
          waitingQueue={waitingQueue}
          agents={agents}
          onFocusAgent={handleFocusAgent}
        />
      )}

      {/* Dev Console (development only) */}
      <DevConsole
        open={devConsoleOpen}
        onClose={() => setDevConsoleOpen(false)}
      />
    </div>
    </>
  )
}

export default App
