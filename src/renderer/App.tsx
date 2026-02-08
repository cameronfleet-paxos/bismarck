import './index.css'
import './electron.d.ts'
import { useState, useEffect, useCallback, useRef, useLayoutEffect, ReactNode } from 'react'
import { benchmarkStartTime, sendTiming, sendMilestone } from './main'
import { Plus, ChevronRight, ChevronLeft, Settings, Check, X, Maximize2, Minimize2, ListTodo, Container, CheckCircle2, FileText, Play, Pencil, Eye, GitBranch, GitCommitHorizontal, GitCompareArrows, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { devLog } from './utils/dev-log'
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
import type { UpdateStatus } from '@/renderer/electron.d'
import { CommandSearch } from '@/renderer/components/CommandSearch'
import { PlanAgentGroup } from '@/renderer/components/PlanAgentGroup'
import { CollapsedPlanGroup } from '@/renderer/components/CollapsedPlanGroup'
import { SpawningPlaceholder } from '@/renderer/components/SpawningPlaceholder'
import { PromptViewerModal } from '@/renderer/components/PromptViewerModal'
import { FollowUpModal } from '@/renderer/components/FollowUpModal'
import { BootProgressIndicator } from '@/renderer/components/BootProgressIndicator'
import { Breadcrumb } from '@/renderer/components/Breadcrumb'
import { AttentionQueue } from '@/renderer/components/AttentionQueue'
import { SetupWizard } from '@/renderer/components/SetupWizard'
import { TutorialProvider, useTutorial } from '@/renderer/components/tutorial'
import type { TutorialAction } from '@/renderer/components/tutorial'
import { DiffOverlay } from '@/renderer/components/DiffOverlay'
import { ElapsedTime } from '@/renderer/components/ElapsedTime'
import type { Agent, AgentModel, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, HeadlessAgentInfo, BranchStrategy, RalphLoopConfig, RalphLoopState, RalphLoopIteration, KeyboardShortcut, KeyboardShortcuts, SpawningHeadlessInfo } from '@/shared/types'
import { themes } from '@/shared/constants'
import { getGridConfig, getGridPosition } from '@/shared/grid-utils'
import { extractPRUrl } from '@/shared/pr-utils'
import { terminalBuffer } from '@/renderer/utils/terminal-buffer'

interface ActiveTerminal {
  terminalId: string
  workspaceId: string
}

// Check if a keyboard event matches a configured shortcut
function matchesShortcut(e: KeyboardEvent, shortcut: KeyboardShortcut | undefined): boolean {
  if (!shortcut) return false
  const metaOrCtrl = e.metaKey || e.ctrlKey
  return (
    e.key.toLowerCase() === shortcut.key.toLowerCase() &&
    (shortcut.modifiers.meta ? metaOrCtrl : !metaOrCtrl) &&
    (shortcut.modifiers.shift ? e.shiftKey : !e.shiftKey) &&
    (shortcut.modifiers.alt ? e.altKey : !e.altKey)
  )
}

// Default keyboard shortcuts for use when preferences haven't loaded
const defaultKeyboardShortcuts: KeyboardShortcuts = {
  commandPalette: { key: 'k', modifiers: { meta: true, shift: false, alt: false } },
  dismissAgent: { key: 'n', modifiers: { meta: true, shift: false, alt: false } },
  devConsole: { key: 'd', modifiers: { meta: true, shift: true, alt: false } },
  toggleAgentSidebar: { key: 'b', modifiers: { meta: true, shift: false, alt: false } },
  togglePlansSidebar: { key: 'p', modifiers: { meta: true, shift: true, alt: false } },
  nextTab: { key: ']', modifiers: { meta: true, shift: true, alt: false } },
  previousTab: { key: '[', modifiers: { meta: true, shift: true, alt: false } },
  newTab: { key: 't', modifiers: { meta: true, shift: false, alt: false } },
  closeTab: { key: 'w', modifiers: { meta: true, shift: false, alt: false } },
  toggleMaximizeAgent: { key: 'm', modifiers: { meta: true, shift: true, alt: false } },
  closeAgent: { key: 'w', modifiers: { meta: true, shift: true, alt: false } },
}

// Format a keyboard shortcut for compact display (e.g., "⌘K")
function formatShortcutCompact(shortcut: KeyboardShortcut): string {
  const isMac = navigator.platform.includes('Mac')
  const parts: string[] = []
  if (shortcut.modifiers.meta) {
    parts.push(isMac ? '⌘' : 'Ctrl+')
  }
  if (shortcut.modifiers.alt) {
    parts.push(isMac ? '⌥' : 'Alt+')
  }
  if (shortcut.modifiers.shift) {
    parts.push(isMac ? '⇧' : 'Shift+')
  }
  parts.push(shortcut.key.toUpperCase())
  return parts.join('')
}

// App-level routing
type AppView = 'main' | 'settings'

// Type for terminal write functions
type TerminalWriter = (data: string) => void

// Helper component to trigger tutorial when needed
function TutorialTrigger({ shouldStart, onTriggered }: { shouldStart: boolean; onTriggered: () => void }) {
  const { startTutorial, isActive } = useTutorial()
  const hasTriggeredRef = useRef(false)

  // Reset trigger flag when shouldStart becomes true (enables restart tutorial)
  useEffect(() => {
    if (shouldStart) {
      hasTriggeredRef.current = false
    }
  }, [shouldStart])

  useEffect(() => {
    if (shouldStart && !isActive && !hasTriggeredRef.current) {
      // Delay to ensure all elements are rendered
      const timer = setTimeout(() => {
        startTutorial()
        hasTriggeredRef.current = true
        onTriggered()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [shouldStart, isActive, startTutorial, onTriggered])

  return null
}

function App() {
  // View routing
  const [currentView, setCurrentView] = useState<AppView>('main')

  const [agents, setAgents] = useState<Agent[]>([])
  const [activeTerminals, setActiveTerminals] = useState<ActiveTerminal[]>([])
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const focusedAgentIdRef = useRef<string | null>(null)  // Ref for synchronous access in event handlers
  const [tabs, setTabs] = useState<AgentTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>()
  const [waitingQueue, setWaitingQueue] = useState<string[]>([])
  const [simulatedAttentionAgentId, setSimulatedAttentionAgentId] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<AppPreferences>({
    attentionMode: 'focus',
    operatingMode: 'solo',
    agentModel: 'sonnet',
    gridSize: '2x2',
  })
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)

  // Team mode state
  const [plans, setPlans] = useState<Plan[]>([])
  const [taskAssignments, setTaskAssignments] = useState<TaskAssignment[]>([])
  const [planActivities, setPlanActivities] = useState<Map<string, PlanActivity[]>>(new Map())
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false)

  // Headless agent state
  const [headlessAgents, setHeadlessAgents] = useState<Map<string, HeadlessAgentInfo>>(new Map())

  // Ralph Loop state
  const [ralphLoops, setRalphLoops] = useState<Map<string, RalphLoopState>>(new Map())

  // Left sidebar collapse state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarEditMode, setSidebarEditMode] = useState(false)
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [planCreatorOpen, setPlanCreatorOpen] = useState(false)

  // Track which terminals have finished booting (by terminalId)
  const [bootedTerminals, setBootedTerminals] = useState<Set<string>>(new Set())

  // Drag-and-drop state (for terminal grid)
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null)
  const [dropTargetPosition, setDropTargetPosition] = useState<number | null>(null)
  const [dropTargetTabId, setDropTargetTabId] = useState<string | null>(null)

  // Drag-and-drop state for sidebar agent reordering
  const [sidebarDraggedAgentId, setSidebarDraggedAgentId] = useState<string | null>(null)
  const [sidebarDropTargetAgentId, setSidebarDropTargetAgentId] = useState<string | null>(null)

  // Drag-and-drop state for headless agents in plan tabs
  const [draggedHeadlessId, setDraggedHeadlessId] = useState<string | null>(null)
  const [dropTargetHeadlessId, setDropTargetHeadlessId] = useState<string | null>(null)
  // Custom order for headless agents per plan (id -> display index)
  const [headlessAgentOrder, setHeadlessAgentOrder] = useState<Map<string, string[]>>(new Map())

  // Track headless agents that are currently spawning (show loading placeholder)
  const [spawningHeadless, setSpawningHeadless] = useState<Map<string, SpawningHeadlessInfo>>(new Map())

  // Manual maximize state per tab (independent of waiting queue expand mode)
  const [maximizedAgentIdByTab, setMaximizedAgentIdByTab] = useState<Record<string, string | null>>({})

  // Stop confirmation dialog state
  const [stopConfirmAgentId, setStopConfirmAgentId] = useState<string | null>(null)

  // Tab delete confirmation dialog state
  const [deleteConfirmTabId, setDeleteConfirmTabId] = useState<string | null>(null)
  // Track tabs currently being closed (show spinner)
  const [closingTabIds, setClosingTabIds] = useState<Set<string>>(new Set())
  const [deleteConfirmPlanInfo, setDeleteConfirmPlanInfo] = useState<{
    hasPlan: boolean
    planTitle?: string
    isInProgress: boolean
  } | null>(null)

  // Diff overlay state (tracks which workspace has diff open)
  const [diffOpenForWorkspace, setDiffOpenForWorkspace] = useState<string | null>(null)

  // Track whether agent was expanded before diff was opened (to restore on close)
  const [expandedBeforeDiff, setExpandedBeforeDiff] = useState<boolean>(false)

  // Track which agent directories are git repos (for hiding diff button)
  const [gitRepoStatus, setGitRepoStatus] = useState<Map<string, boolean>>(new Map())

  // Track file change counts per workspace for diff badge
  const [fileChangeCounts, setFileChangeCounts] = useState<Map<string, number>>(new Map())

  // Destroy agent confirmation dialog state
  const [destroyAgentTarget, setDestroyAgentTarget] = useState<{info: HeadlessAgentInfo; isStandalone: boolean} | null>(null)
  const [isDestroying, setIsDestroying] = useState(false)

  // Prompt viewer modal state
  const [promptViewerInfo, setPromptViewerInfo] = useState<HeadlessAgentInfo | null>(null)

  // Follow-up modal state
  const [followUpInfo, setFollowUpInfo] = useState<HeadlessAgentInfo | null>(null)

  // Loading state for standalone headless agent actions
  const [confirmingDoneIds, setConfirmingDoneIds] = useState<Set<string>>(new Set())
  const [startingFollowUpIds, setStartingFollowUpIds] = useState<Set<string>>(new Set())
  const [restartingIds, setRestartingIds] = useState<Set<string>>(new Set())

  // Discussion completing spinner state (overlays the discussion workspace)
  const [discussionCompletingWorkspaceId, setDiscussionCompletingWorkspaceId] = useState<string | null>(null)

  // Dev console state (development only)
  const [devConsoleOpen, setDevConsoleOpen] = useState(false)
  const [simulateNewUser, setSimulateNewUser] = useState(false)

  // Command search state (CMD-K)
  const [commandSearchOpen, setCommandSearchOpen] = useState(false)
  const [prefillRalphLoopConfig, setPrefillRalphLoopConfig] = useState<{
    referenceAgentId: string
    prompt: string
    completionPhrase: string
    maxIterations: number
    model: 'opus' | 'sonnet'
  } | null>(null)

  // Terminal search state (CMD-F) - tracks which agent has search open
  const [terminalSearchAgentId, setTerminalSearchAgentId] = useState<string | null>(null)

  // Discussion execute state - maps planId to selected agent id
  const [discussionExecuteAgent, setDiscussionExecuteAgent] = useState<Record<string, string>>({})
  const [discussionExecuting, setDiscussionExecuting] = useState<Record<string, boolean>>({})


  // Collapsed plan groups in sidebar
  const [collapsedPlanGroups, setCollapsedPlanGroups] = useState<Set<string>>(new Set())

  // Plan ID to auto-expand in sidebar (cleared after consumption)
  const [expandPlanId, setExpandPlanId] = useState<string | null>(null)

  // Tutorial state - trigger after setup wizard completes
  const [shouldStartTutorial, setShouldStartTutorial] = useState(false)
  const tutorialStartTriggeredRef = useRef(false)

  // Trigger tutorial on load if setup is done but tutorial hasn't been completed
  // This handles the "Restart Tutorial" flow where page reloads with tutorialCompleted: false
  // Wait for preferencesLoaded to avoid triggering before tutorialCompleted is loaded from disk
  useEffect(() => {
    if (preferencesLoaded && agents.length > 0 && !preferences.tutorialCompleted && !tutorialStartTriggeredRef.current) {
      setShouldStartTutorial(true)
    }
  }, [preferencesLoaded, agents.length, preferences.tutorialCompleted])

  // Check git repo status for agent directories (to hide diff button for non-git repos)
  useEffect(() => {
    const directories = new Set(agents.map(a => a.directory))
    const unchecked = [...directories].filter(d => !gitRepoStatus.has(d))
    if (unchecked.length === 0) return

    Promise.all(
      unchecked.map(async (dir) => {
        try {
          const isGit = await window.electronAPI.isGitRepo(dir)
          return [dir, isGit] as const
        } catch {
          // If check fails (e.g., IPC not available), assume git repo to keep button visible
          return [dir, true] as const
        }
      })
    ).then((results) => {
      setGitRepoStatus(prev => {
        const next = new Map(prev)
        for (const [dir, isGit] of results) {
          next.set(dir, isGit)
        }
        return next
      })
    })
  }, [agents])

  // Poll file change counts for visible agents (for diff badge)
  useEffect(() => {
    const pollChangeCounts = async () => {
      if (preferences.showDiffView === false) return
      const activeTab = tabs.find(t => t.id === activeTabId)
      if (!activeTab) return

      const agentsToCheck = activeTerminals
        .filter(t => activeTab.workspaceIds.includes(t.workspaceId))
        .map(t => agents.find(a => a.id === t.workspaceId))
        .filter((a): a is Agent => !!a && !a.isHeadless && !a.isStandaloneHeadless && gitRepoStatus.get(a.directory) !== false)

      if (agentsToCheck.length === 0) return

      const results = await Promise.allSettled(
        agentsToCheck.map(async (agent) => {
          const result = await window.electronAPI.getChangedFiles(agent.directory)
          return [agent.id, result.files.length] as const
        })
      )

      setFileChangeCounts(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r.status === 'fulfilled') {
            next.set(r.value[0], r.value[1])
          }
        }
        return next
      })
    }

    pollChangeCounts()
    const interval = setInterval(pollChangeCounts, 5000)
    return () => clearInterval(interval)
  }, [activeTabId, activeTerminals, agents, gitRepoStatus, tabs, preferences.showDiffView])

  // Clear expandPlanId after it's been consumed by the sidebar
  useEffect(() => {
    if (expandPlanId) {
      const timer = setTimeout(() => setExpandPlanId(null), 100)
      return () => clearTimeout(timer)
    }
  }, [expandPlanId])

  // Terminal queue status for boot progress indicator
  const [terminalQueueStatus, setTerminalQueueStatus] = useState<{ queued: number; active: number }>({ queued: 0, active: 0 })

  // Update available state for header notification
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string; releaseUrl: string; currentVersion: string; significantlyOutdated: boolean } | null>(null)
  // Popup for significantly outdated versions (only shows once per session)
  const [showUpdatePopup, setShowUpdatePopup] = useState(false)
  const updatePopupShownRef = useRef(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | undefined>(undefined)

  // Tool auth status (for tools like bb that need SSO re-auth)
  const [toolsNeedingReauth, setToolsNeedingReauth] = useState<Array<{ toolId: string; toolName: string; state: string; reauthHint?: string }>>([])

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

  // Get buffered terminal content for restoring state after remount
  const getBufferedContent = useCallback((terminalId: string) => {
    return terminalBuffer.getBuffer(terminalId)
  }, [])

  // Load standalone headless agents from main process
  const loadStandaloneHeadlessAgents = async () => {
    const standaloneAgents = await window.electronAPI?.getStandaloneHeadlessAgents?.()
    if (standaloneAgents?.length) {
      setHeadlessAgents((prev) => {
        const newMap = new Map(prev)
        for (const info of standaloneAgents) {
          if (info.taskId) {
            newMap.set(info.taskId, info)
          }
        }
        return newMap
      })
    }
  }

  const loadRalphLoops = async () => {
    const loops = await window.electronAPI?.getAllRalphLoops?.()
    if (loops?.length) {
      setRalphLoops(new Map(loops.map(loop => [loop.id, loop])))
    }
  }

  // Load agents and state on mount
  useEffect(() => {
    const mountStartTime = performance.now()
    sendMilestone('renderer:App-mount')

    // Wrap data loading with timing
    const loadWithTiming = async () => {
      const start = performance.now()
      await loadAgents()
      sendTiming('renderer:loadAgents', start - benchmarkStartTime, performance.now() - start)

      const prefStart = performance.now()
      await loadPreferences()
      sendTiming('renderer:loadPreferences', prefStart - benchmarkStartTime, performance.now() - prefStart)

      const plansStart = performance.now()
      await loadPlansData()
      sendTiming('renderer:loadPlansData', plansStart - benchmarkStartTime, performance.now() - plansStart)

      const headlessStart = performance.now()
      await loadStandaloneHeadlessAgents()
      sendTiming('renderer:loadStandaloneHeadless', headlessStart - benchmarkStartTime, performance.now() - headlessStart)

      const ralphStart = performance.now()
      await loadRalphLoops()
      sendTiming('renderer:loadRalphLoops', ralphStart - benchmarkStartTime, performance.now() - ralphStart)

      sendTiming('renderer:App-mount-total', mountStartTime - benchmarkStartTime, performance.now() - mountStartTime)
      sendMilestone('renderer-data-loaded')
    }

    loadWithTiming()

    const setupStart = performance.now()
    setupEventListeners()
    sendTiming('renderer:setupEventListeners', setupStart - benchmarkStartTime, performance.now() - setupStart)

    return () => {
      window.electronAPI?.removeAllListeners?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track first render complete (runs after DOM mutations but before paint)
  const firstRenderRef = useRef(false)
  useLayoutEffect(() => {
    if (!firstRenderRef.current) {
      firstRenderRef.current = true
      sendMilestone('renderer-first-render-complete')
    }
  }, [])

  // Keep focusedAgentIdRef in sync with focusedAgentId state
  useEffect(() => {
    focusedAgentIdRef.current = focusedAgentId
  }, [focusedAgentId])

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

  // Subscribe to update status for header notification
  // Uses polling to handle the race condition where the 5-second launch check
  // completes after the renderer mounts but before listeners are stable
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null
    let mounted = true

    // Poll for update status until we get a definitive result
    const pollForStatus = async () => {
      if (!mounted) return

      try {
        const status = await window.electronAPI?.getUpdateStatus?.()
        if (!mounted) return

        devLog('[App] Polled update status:', status?.state)

        if (status?.state === 'available') {
          devLog('[App] Update available:', status.version, status.significantlyOutdated ? '(significantly outdated)' : '')
          setUpdateAvailable({ version: status.version, releaseUrl: status.releaseUrl, currentVersion: status.currentVersion, significantlyOutdated: status.significantlyOutdated })
          // Show popup for significantly outdated versions (once per session)
          if (status.significantlyOutdated && !updatePopupShownRef.current) {
            updatePopupShownRef.current = true
            setShowUpdatePopup(true)
          }
          // Stop polling once we have a result
          if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
          }
        } else if (status?.state === 'up-to-date' || status?.state === 'error') {
          // Stop polling on definitive results
          if (pollInterval) {
            clearInterval(pollInterval)
            pollInterval = null
          }
        }
        // Keep polling if state is 'idle' or 'checking'
      } catch (error) {
        console.error('[App] Error polling update status:', error)
      }
    }

    // Initial check
    pollForStatus()

    // Poll every 2 seconds for up to 30 seconds (covers the 5-second delay + buffer)
    pollInterval = setInterval(pollForStatus, 2000)

    // Stop polling after 30 seconds regardless
    const maxPollTimeout = setTimeout(() => {
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }
    }, 30000)

    // Also listen for push updates (for periodic checks and manual checks from Settings)
    const unsubscribe = window.electronAPI?.onUpdateStatus?.((status: UpdateStatus) => {
      devLog('[App] Received update status push:', status.state)
      if (status.state === 'available') {
        setUpdateAvailable({ version: status.version, releaseUrl: status.releaseUrl, currentVersion: status.currentVersion, significantlyOutdated: status.significantlyOutdated })
        // Show popup for significantly outdated versions (once per session)
        if (status.significantlyOutdated && !updatePopupShownRef.current) {
          updatePopupShownRef.current = true
          setShowUpdatePopup(true)
        }
      } else {
        setUpdateAvailable(null)
      }
    })

    return () => {
      mounted = false
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      clearTimeout(maxPollTimeout)
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // Listen for tool auth status updates (e.g., bb SSO expiry)
  useEffect(() => {
    // Get initial statuses
    window.electronAPI?.getToolAuthStatuses?.().then((statuses) => {
      const needsReauth = statuses?.filter((s: { state: string }) => s.state === 'needs-reauth') || []
      setToolsNeedingReauth(needsReauth)
    })

    // Listen for push updates
    window.electronAPI?.onToolAuthStatus?.((statuses) => {
      const needsReauth = statuses?.filter((s: { state: string }) => s.state === 'needs-reauth') || []
      setToolsNeedingReauth(needsReauth)
    })

    return () => {
      window.electronAPI?.removeToolAuthStatusListener?.()
    }
  }, [])

  const handleFocusAgent = useCallback((agentId: string) => {
    // If switching away from a waiting agent we were focused on, acknowledge it
    if (focusedAgentId && focusedAgentId !== agentId && waitingQueue.includes(focusedAgentId)) {
      window.electronAPI?.acknowledgeWaiting?.(focusedAgentId)
      setWaitingQueue((prev) => prev.filter((id) => id !== focusedAgentId))
    }
    // Switch to the tab containing this agent
    const tab = tabs.find((t) => t.workspaceIds.includes(agentId))
    if (tab && tab.id !== activeTabId) {
      window.electronAPI?.setActiveTab?.(tab.id)
      setActiveTabId(tab.id)
    }
    setFocusedAgentId(agentId)
    window.electronAPI?.setFocusedWorkspace?.(agentId)
    // Acknowledge if this agent was waiting
    if (waitingQueue.includes(agentId)) {
      window.electronAPI?.acknowledgeWaiting?.(agentId)
      setWaitingQueue((prev) => prev.filter((id) => id !== agentId))
    }
  }, [focusedAgentId, waitingQueue, tabs, activeTabId])

  // Close diff overlay and restore agent expansion state
  const closeDiffAndRestore = useCallback((tabId: string) => {
    if (!expandedBeforeDiff) {
      setMaximizedAgentIdByTab(prev => ({ ...prev, [tabId]: null }))
    }
    setDiffOpenForWorkspace(null)
  }, [expandedBeforeDiff])

  // Keyboard shortcuts for expand mode and dev console
  useEffect(() => {
    const shortcuts = preferences.keyboardShortcuts || defaultKeyboardShortcuts

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to return to main view from settings or close command search
      if (e.key === 'Escape') {
        if (terminalSearchAgentId) {
          e.preventDefault()
          setTerminalSearchAgentId(null)
          return
        }
        if (currentView === 'settings') {
          e.preventDefault()
          setCurrentView('main')
          return
        }
        if (commandSearchOpen) {
          e.preventDefault()
          setCommandSearchOpen(false)
          return
        }
      }

      // CMD+F: Open terminal search for focused agent
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        // Focus the current agent if we have one (interactive or headless)
        const focusedId = focusedAgentIdRef.current
        if (focusedId) {
          setTerminalSearchAgentId(focusedId)
        }
        return
      }

      // Dev console shortcut (development only)
      if (matchesShortcut(e, shortcuts.devConsole)) {
        e.preventDefault()
        setDevConsoleOpen(prev => !prev)
        return
      }

      // Command palette shortcut
      if (matchesShortcut(e, shortcuts.commandPalette)) {
        e.preventDefault()
        setCommandSearchOpen(true)
        return
      }

      // Toggle agent sidebar shortcut
      if (matchesShortcut(e, shortcuts.toggleAgentSidebar)) {
        e.preventDefault()
        setSidebarCollapsed(prev => !prev)
        return
      }

      // Toggle plans sidebar shortcut (only in team mode)
      if (matchesShortcut(e, shortcuts.togglePlansSidebar)) {
        if (preferences.operatingMode === 'team') {
          e.preventDefault()
          const newOpen = !planSidebarOpen
          setPlanSidebarOpen(newOpen)
          window.electronAPI?.setPlanSidebarOpen?.(newOpen)
        }
        return
      }

      // Next tab shortcut
      if (matchesShortcut(e, shortcuts.nextTab)) {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex(t => t.id === activeTabId)
          const nextIndex = (currentIndex + 1) % tabs.length
          const nextTabId = tabs[nextIndex].id
          setActiveTabId(nextTabId)
          window.electronAPI?.setActiveTab?.(nextTabId)
        }
        return
      }

      // Previous tab shortcut
      if (matchesShortcut(e, shortcuts.previousTab)) {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex(t => t.id === activeTabId)
          const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
          const prevTabId = tabs[prevIndex].id
          setActiveTabId(prevTabId)
          window.electronAPI?.setActiveTab?.(prevTabId)
        }
        return
      }

      // New tab shortcut
      if (matchesShortcut(e, shortcuts.newTab)) {
        e.preventDefault()
        window.electronAPI?.createTab?.().then((newTab) => {
          if (newTab) {
            setActiveTabId(newTab.id)
          }
        })
        return
      }

      // Close tab shortcut
      if (matchesShortcut(e, shortcuts.closeTab)) {
        e.preventDefault()
        if (activeTabId && tabs.length > 1) {
          // Don't close if it's the only tab
          const activeTab = tabs.find(t => t.id === activeTabId)
          if (activeTab) {
            // Trigger deletion - this will show confirmation if there are agents
            handleTabDeleteRequest(activeTabId)
          }
        }
        return
      }

      // Toggle maximize agent shortcut
      if (matchesShortcut(e, shortcuts.toggleMaximizeAgent)) {
        e.preventDefault()
        if (activeTabId && focusedAgentIdRef.current) {
          const currentMaximized = maximizedAgentIdByTab[activeTabId]
          if (currentMaximized === focusedAgentIdRef.current) {
            // Already maximized, minimize
            setMaximizedAgentIdByTab(prev => ({ ...prev, [activeTabId]: null }))
          } else {
            // Maximize the focused agent
            setMaximizedAgentIdByTab(prev => ({ ...prev, [activeTabId]: focusedAgentIdRef.current }))
          }
        }
        return
      }

      // Close agent shortcut
      if (matchesShortcut(e, shortcuts.closeAgent)) {
        e.preventDefault()
        if (focusedAgentIdRef.current) {
          window.electronAPI?.stopWorkspace?.(focusedAgentIdRef.current)
        }
        return
      }

      // Cmd+D: Toggle diff overlay for focused agent
      if (e.key === 'd' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        if (preferences.showDiffView === false) return

        // If diff is already open, close it and restore expansion state
        if (diffOpenForWorkspace) {
          const tabForDiff = tabs.find(t => t.workspaceIds.includes(diffOpenForWorkspace))
          if (tabForDiff) {
            closeDiffAndRestore(tabForDiff.id)
          } else {
            setDiffOpenForWorkspace(null)
          }
          return
        }

        // Otherwise, open diff for the focused agent (if any)
        if (focusedAgentId) {
          const tabForAgent = tabs.find(t => t.workspaceIds.includes(focusedAgentId))
          if (tabForAgent) {
            const activeTabMaxId = maximizedAgentIdByTab[tabForAgent.id] || null
            const isExpandMode = preferences.attentionMode === 'expand' && waitingQueue.length > 0
            const autoExpId = isExpandMode ? waitingQueue[0] : null
            const isCurrentlyExpanded = activeTabMaxId === focusedAgentId || autoExpId === focusedAgentId
            setExpandedBeforeDiff(isCurrentlyExpanded)
            setMaximizedAgentIdByTab(prev => ({ ...prev, [tabForAgent.id]: focusedAgentId }))
          }
          setDiffOpenForWorkspace(focusedAgentId)
        }
        return
      }

      // Determine if we're in auto-expand mode (not manually maximized)
      // For keyboard shortcuts, we need to check the current active tab's maximized state
      const activeTabMaximizedAgentId = activeTabId ? (maximizedAgentIdByTab[activeTabId] || null) : null
      const isExpandModeActive = preferences.attentionMode === 'expand' && waitingQueue.length > 0
      const autoExpandedAgentId = isExpandModeActive ? waitingQueue[0] : null
      const expandedAgentId = activeTabMaximizedAgentId || autoExpandedAgentId
      const isAutoExpanded = expandedAgentId === autoExpandedAgentId && !activeTabMaximizedAgentId
      // Check if we're currently viewing a waiting agent on a different tab (auto-expanded to that tab)
      const waitingAgentTab = autoExpandedAgentId ? tabs.find(t => t.workspaceIds.includes(autoExpandedAgentId)) : null
      const isViewingAutoExpandedTab = waitingAgentTab && waitingAgentTab.id !== activeTabId

      // Dismiss agent shortcut
      // Works in both 'expand' and 'focus' attention modes
      if (matchesShortcut(e, shortcuts.dismissAgent)) {
        // In expand mode, allow dismiss if auto-expanded OR if viewing a waiting agent on a different tab
        const isExpandMode = preferences.attentionMode === 'expand' && (isAutoExpanded || isViewingAutoExpandedTab)
        const isFocusMode = preferences.attentionMode === 'focus' && waitingQueue.length > 0

        if (isExpandMode || isFocusMode) {
          e.preventDefault()
          const currentAgentId = waitingQueue[0]

          // Acknowledge/dismiss the current agent
          window.electronAPI?.acknowledgeWaiting?.(currentAgentId)
          setWaitingQueue((prev) => prev.filter((id) => id !== currentAgentId))
          handleFocusAgent(currentAgentId)

          // If there's a next agent, switch to it
          if (waitingQueue.length > 1) {
            const nextAgentId = waitingQueue[1]

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
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, commandSearchOpen, terminalSearchAgentId, preferences.attentionMode, preferences.keyboardShortcuts, preferences.operatingMode, waitingQueue, tabs, activeTabId, maximizedAgentIdByTab, handleFocusAgent, planSidebarOpen, diffOpenForWorkspace, focusedAgentId, closeDiffAndRestore])

  const loadPreferences = async () => {
    const prefs = await window.electronAPI?.getPreferences?.()
    if (prefs) {
      setPreferences(prefs)
    }
    setPreferencesLoaded(true)
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
          devLog('[Renderer] Loaded headless agents from main process:', loadedHeadlessAgents.length)
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

  // Tutorial completion handlers
  const handleTutorialComplete = async () => {
    await handlePreferencesChange({ tutorialCompleted: true })
    setShouldStartTutorial(false)
  }

  const handleTutorialSkip = async () => {
    await handlePreferencesChange({ tutorialCompleted: true })
    setShouldStartTutorial(false)
  }

  const handleTutorialAction = useCallback((action: TutorialAction) => {
    switch (action) {
      case 'openCommandPalette':
        setCommandSearchOpen(true)
        break
      case 'closeCommandPalette':
        setCommandSearchOpen(false)
        break
      case 'simulateAttention':
        // Find an agent visible in the grid (must be in activeTerminals)
        const visibleAgentId = activeTerminals.find(t => {
          const agent = agents.find(a => a.id === t.workspaceId)
          return agent && !agent.isHeadless && !agent.isStandaloneHeadless && !agent.isPlanAgent
        })?.workspaceId
        if (visibleAgentId) {
          setSimulatedAttentionAgentId(visibleAgentId)
          setWaitingQueue(prev => prev.includes(visibleAgentId) ? prev : [...prev, visibleAgentId])
        }
        break
      case 'clearSimulatedAttention':
        if (simulatedAttentionAgentId) {
          setWaitingQueue(prev => prev.filter(id => id !== simulatedAttentionAgentId))
          setSimulatedAttentionAgentId(null)
        }
        break
    }
  }, [agents, activeTerminals, simulatedAttentionAgentId])

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
      devLog(`[Renderer] Received agent-waiting event for ${agentId}`)
      // Check if user is already focused on this agent using the ref
      if (focusedAgentIdRef.current === agentId) {
        devLog(`[Renderer] Agent ${agentId} already focused, auto-acknowledging`)
        window.electronAPI?.acknowledgeWaiting?.(agentId)
        return  // Don't add to waiting queue or trigger attention
      }

      // Add to waiting queue since user isn't focused on this agent
      setWaitingQueue((prev) => {
        devLog(`[Renderer] Current queue: ${JSON.stringify(prev)}`)
        if (!prev.includes(agentId)) {
          const newQueue = [...prev, agentId]
          devLog(`[Renderer] Updated queue: ${JSON.stringify(newQueue)}`)
          window.electronAPI?.updateTray?.(newQueue.length)
          return newQueue
        }
        return prev
      })
    })

    // Global terminal data listener - routes data to the appropriate terminal writer
    window.electronAPI?.onTerminalData?.((terminalId: string, data: string) => {
      // Buffer all terminal data so we can restore it when terminals are remounted
      // (e.g., when moving agents between tabs)
      terminalBuffer.append(terminalId, data)

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
      const exitMessage = `\r\n\x1b[33mProcess exited with code ${code}\x1b[0m\r\n`
      // Buffer the exit message so it persists if terminal is remounted
      terminalBuffer.append(terminalId, exitMessage)

      const writer = terminalWritersRef.current.get(terminalId)
      if (writer) {
        writer(exitMessage)
      }
    })

    // Plan event listeners (Team Mode)
    window.electronAPI?.onPlanUpdate?.((plan: Plan) => {
      devLog('[Renderer] Received plan-update', { id: plan.id, orchestratorTabId: plan.orchestratorTabId, status: plan.status })
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
            devLog('[Renderer] Clearing headless agents for plan', {
              planId: plan.id,
              planStatus: plan.status,
              agentsToRemove,
              totalAgentsBefore: prev.size,
            })
            const newMap = new Map(prev)
            for (const taskId of agentsToRemove) {
              newMap.delete(taskId)
            }
            devLog('[Renderer] Headless agents cleared', { totalAgentsAfter: newMap.size })
            return newMap
          }
          return prev
        })
      }
    })

    window.electronAPI?.onPlanDeleted?.((planId: string) => {
      devLog('[Renderer] Received plan-deleted', { planId })
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

    // Discussion completing spinner (overlay on the discussion terminal)
    window.electronAPI?.onDiscussionCompleting?.((data) => {
      devLog('[Renderer] Received discussion-completing', data)
      setDiscussionCompletingWorkspaceId(data.workspaceId)
    })

    // Headless agent events
    window.electronAPI?.onHeadlessAgentStarted?.((data) => {
      devLog('[Renderer] Received headless-agent-started', data)
      // Clear discussion completing spinner - the handoff agent has started
      setDiscussionCompletingWorkspaceId(null)
      window.electronAPI?.getHeadlessAgentInfo?.(data.taskId).then((info) => {
        devLog('[Renderer] getHeadlessAgentInfo returned:', info)
        if (info) {
          setHeadlessAgents((prev) => {
            const newMap = new Map(prev).set(data.taskId, info)
            devLog('[Renderer] Updated headlessAgents map, size:', newMap.size)
            return newMap
          })
        }
      })
    })

    window.electronAPI?.onHeadlessAgentUpdate?.((info: HeadlessAgentInfo) => {
      devLog('[Renderer] Received headless-agent-update', { taskId: info.taskId, status: info.status })
      const taskId = info.taskId
      if (taskId) {
        setHeadlessAgents((prev) => {
          const newMap = new Map(prev).set(taskId, info)
          devLog('[Renderer] Updated headlessAgents via update event, size:', newMap.size)
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

    // Ralph Loop event listeners
    window.electronAPI?.onRalphLoopUpdate?.((state: RalphLoopState) => {
      devLog('[Renderer] Received ralph-loop-update', { id: state.id, status: state.status, iteration: state.currentIteration })
      setRalphLoops((prev) => {
        const newMap = new Map(prev)
        newMap.set(state.id, state)
        return newMap
      })
    })

    window.electronAPI?.onRalphLoopEvent?.((data) => {
      setRalphLoops((prev) => {
        const updated = new Map(prev)
        const existing = updated.get(data.loopId)
        if (existing) {
          // Find and update the iteration
          const updatedIterations = existing.iterations.map((iter) => {
            if (iter.iterationNumber === data.iterationNumber) {
              return {
                ...iter,
                events: [...iter.events, data.event],
              }
            }
            return iter
          })
          updated.set(data.loopId, {
            ...existing,
            iterations: updatedIterations,
          })
        }
        return updated
      })
    })

    // Ralph Loop discussion complete - open CMD-K with pre-populated values
    window.electronAPI?.onRalphLoopDiscussionComplete?.((data) => {
      setPrefillRalphLoopConfig({
        referenceAgentId: data.referenceAgentId,
        prompt: data.prompt,
        completionPhrase: data.completionPhrase,
        maxIterations: data.maxIterations,
        model: data.model,
      })
      setCommandSearchOpen(true)
    })

    // Terminal queue status for boot progress indicator
    window.electronAPI?.onTerminalQueueStatus?.((status) => {
      setTerminalQueueStatus({ queued: status.queued, active: status.active })
    })
  }

  const resumeAgents = async (agentIds: string[]) => {
    for (const agentId of agentIds) {
      try {
        // Skip headless agents - they don't use interactive terminals
        const agent = agents.find((a) => a.id === agentId)
        if (agent?.isHeadless || agent?.isStandaloneHeadless) {
          continue
        }
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
      // Clear the terminal buffer to free memory
      terminalBuffer.clear(activeTerminal.terminalId)
    }
    await window.electronAPI.deleteWorkspace(id)
    await loadAgents()
    setWaitingQueue((prev) => prev.filter((wid) => wid !== id))
    // Refresh tabs
    const state = await window.electronAPI.getState()
    setTabs(state.tabs || [])
  }

  const handleLaunchAgent = async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId)

    // Skip terminal creation for headless agents - they use HeadlessTerminal component
    if (agent?.isHeadless || agent?.isStandaloneHeadless) {
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

  const handleAddTerminal = async (agent: Agent) => {
    // Save the new terminal-only agent
    await window.electronAPI.saveWorkspace(agent)
    await loadAgents()

    // Launch the terminal
    await handleLaunchAgent(agent.id)
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

  const handleCloneAgent = async (agent: Agent) => {
    // Create cloned agent with new ID and modified name
    const clonedAgent: Agent = {
      id: crypto.randomUUID(),
      name: `${agent.name} (Copy)`,
      directory: agent.directory,
      purpose: agent.purpose,
      theme: agent.theme,
      icon: agent.icon,
      repositoryId: agent.repositoryId,
      // Explicitly exclude session/runtime fields - they should not be cloned
    }
    await window.electronAPI.saveWorkspace(clonedAgent)
    await loadAgents()
  }

  // Handle sidebar agent reorder via drag-and-drop
  const handleSidebarAgentReorder = async (draggedId: string, targetId: string) => {
    // Get standalone agents only (plan agents shouldn't be reordered this way)
    const { standaloneAgents } = groupAgentsByPlan()
    const currentOrder = standaloneAgents.map(a => a.id)

    const dragIndex = currentOrder.indexOf(draggedId)
    const targetIndex = currentOrder.indexOf(targetId)

    if (dragIndex === -1 || targetIndex === -1 || dragIndex === targetIndex) {
      return
    }

    // Remove dragged item and insert at target position
    const newOrder = [...currentOrder]
    newOrder.splice(dragIndex, 1)
    newOrder.splice(targetIndex, 0, draggedId)

    // Persist the new order
    await window.electronAPI?.reorderWorkspaces?.(newOrder)
    await loadAgents()
  }

  // Handle headless agent reorder via drag-and-drop within plan tab
  const handleHeadlessAgentReorder = (planId: string, draggedId: string, targetId: string) => {
    setHeadlessAgentOrder((prev) => {
      const newMap = new Map(prev)
      const currentOrder = newMap.get(planId) || []

      // Get all headless agents for this plan
      const planAgentIds = Array.from(headlessAgents.values())
        .filter((info) => info.planId === planId)
        .map((info) => info.id)

      // Build the order array - use existing order or default to current list order
      let orderedIds = currentOrder.length > 0
        ? currentOrder.filter((id) => planAgentIds.includes(id))
        : planAgentIds

      // Add any new agents that aren't in the order yet
      for (const id of planAgentIds) {
        if (!orderedIds.includes(id)) {
          orderedIds.push(id)
        }
      }

      const dragIndex = orderedIds.indexOf(draggedId)
      const targetIndex = orderedIds.indexOf(targetId)

      if (dragIndex === -1 || targetIndex === -1 || dragIndex === targetIndex) {
        return prev
      }

      // Remove dragged item and insert at target position
      orderedIds = [...orderedIds]
      orderedIds.splice(dragIndex, 1)
      orderedIds.splice(targetIndex, 0, draggedId)

      newMap.set(planId, orderedIds)
      return newMap
    })
  }

  // Handle Ralph Loop iteration reorder via drag-and-drop
  const handleRalphLoopReorder = (loopId: string, draggedUniqueId: string, targetUniqueId: string) => {
    setHeadlessAgentOrder((prev) => {
      const key = `ralph-loop-${loopId}`
      const newMap = new Map(prev)
      const currentOrder = newMap.get(key) || []

      // Get all iteration unique IDs for this loop
      const loopState = ralphLoops.get(loopId)
      if (!loopState) return prev
      const iterationIds = loopState.iterations.map(
        (iter) => `ralph-${loopState.id}-iter-${iter.iterationNumber}`
      )

      // Build the order array - use existing order or default to current list order
      let orderedIds = currentOrder.length > 0
        ? currentOrder.filter((id) => iterationIds.includes(id))
        : iterationIds

      // Add any new iterations that aren't in the order yet
      for (const id of iterationIds) {
        if (!orderedIds.includes(id)) {
          orderedIds.push(id)
        }
      }

      const dragIndex = orderedIds.indexOf(draggedUniqueId)
      const targetIndex = orderedIds.indexOf(targetUniqueId)

      if (dragIndex === -1 || targetIndex === -1 || dragIndex === targetIndex) {
        return prev
      }

      // Remove dragged item and insert at target position
      orderedIds = [...orderedIds]
      orderedIds.splice(dragIndex, 1)
      orderedIds.splice(targetIndex, 0, draggedUniqueId)

      newMap.set(key, orderedIds)
      return newMap
    })
  }

  const handleStopHeadlessAgent = async (agent: Agent) => {
    // Trigger the destroy confirmation dialog (same behavior as delete button)
    if (agent.taskId) {
      const info = headlessAgents.get(agent.taskId)
      if (info) {
        setDestroyAgentTarget({ info, isStandalone: false })
      }
    }
  }

  const handleStandaloneConfirmDone = async (headlessId: string) => {
    setConfirmingDoneIds(prev => new Set(prev).add(headlessId))
    try {
      await window.electronAPI?.standaloneHeadlessConfirmDone?.(headlessId)
      // Remove from headless agents map
      setHeadlessAgents((prev) => {
        const newMap = new Map(prev)
        newMap.delete(headlessId)
        return newMap
      })
      // Reload agents to pick up workspace deletion
      await loadAgents()
      // Refresh tabs
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
    } finally {
      setConfirmingDoneIds(prev => {
        const next = new Set(prev)
        next.delete(headlessId)
        return next
      })
    }
  }

  const handleDestroyAgent = async () => {
    if (!destroyAgentTarget) return
    const { info, isStandalone } = destroyAgentTarget
    setIsDestroying(true)
    try {
      await window.electronAPI?.destroyHeadlessAgent?.(info.taskId!, isStandalone)
      // Remove from headless agents map
      setHeadlessAgents((prev) => {
        const newMap = new Map(prev)
        newMap.delete(info.taskId!)
        return newMap
      })
      // Reload agents to pick up workspace deletion
      await loadAgents()
      // Refresh tabs
      const state = await window.electronAPI.getState()
      setTabs(state.tabs || [])
    } finally {
      setIsDestroying(false)
      setDestroyAgentTarget(null)
    }
  }

  // Open follow-up modal for a standalone headless agent
  const handleStandaloneStartFollowup = async (headlessId: string) => {
    // Fetch fresh info from main process (has complete events array in memory)
    const allAgents = await window.electronAPI?.getStandaloneHeadlessAgents?.()
    const freshInfo = allAgents?.find(a => a.taskId === headlessId)
    if (freshInfo) {
      setFollowUpInfo(freshInfo)
      return
    }
    // Fall back to renderer state
    const info = headlessAgents.get(headlessId)
    if (info) {
      setFollowUpInfo(info)
    }
  }

  // Execute the follow-up after user submits from modal
  const executeFollowUp = async (prompt: string, model: AgentModel) => {
    const headlessId = followUpInfo?.taskId
    if (!headlessId) return

    setStartingFollowUpIds(prev => new Set(prev).add(headlessId))
    try {
      const result = await window.electronAPI?.standaloneHeadlessStartFollowup?.(headlessId, prompt, model)
      if (result) {
        // Remove old agent info from map
        setHeadlessAgents((prev) => {
          const newMap = new Map(prev)
          newMap.delete(headlessId)
          return newMap
        })
        // Reload agents to pick up the new workspace
        await loadAgents()
        // Refresh tabs
        const state = await window.electronAPI.getState()
        setTabs(state.tabs || [])
        // Close the modal
        setFollowUpInfo(null)
      }
    } finally {
      setStartingFollowUpIds(prev => {
        const next = new Set(prev)
        next.delete(headlessId)
        return next
      })
    }
  }

  // Restart an interrupted standalone headless agent
  const handleStandaloneRestart = async (headlessId: string) => {
    setRestartingIds(prev => new Set(prev).add(headlessId))
    try {
      const result = await window.electronAPI?.standaloneHeadlessRestart?.(headlessId, preferences.agentModel === 'opus' ? 'opus' : 'sonnet')
      if (result) {
        // Remove old agent info from map
        setHeadlessAgents((prev) => {
          const newMap = new Map(prev)
          newMap.delete(headlessId)
          return newMap
        })
        // Reload agents to pick up the new workspace
        await loadAgents()
        // Refresh tabs
        const state = await window.electronAPI.getState()
        setTabs(state.tabs || [])
      }
    } finally {
      setRestartingIds(prev => {
        const next = new Set(prev)
        next.delete(headlessId)
        return next
      })
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

  // Command search handler
  const handleCommandSearchSelect = async (agentId: string) => {
    // Find the tab containing this agent
    const tab = tabs.find(t => t.workspaceIds.includes(agentId))
    if (tab && tab.id !== activeTabId) {
      setActiveTabId(tab.id)
      await window.electronAPI?.setActiveTab?.(tab.id)
    }

    // Focus the agent
    handleFocusAgent(agentId)

    // If agent is not running, launch it
    const isActive = activeTerminals.some(t => t.workspaceId === agentId)
    if (!isActive) {
      handleLaunchAgent(agentId)
    }
  }

  // Start standalone headless agent handler
  const handleStartStandaloneHeadless = async (agentId: string, prompt: string, model: 'opus' | 'sonnet') => {
    // Generate a unique spawning ID for this placeholder
    const spawningId = `spawning-${Date.now()}`
    const referenceAgent = agents.find(a => a.id === agentId)
    const tabId = activeTabId || tabs[0]?.id

    if (!referenceAgent || !tabId) return

    // Create spawning info for placeholder rendering
    const spawningInfo: SpawningHeadlessInfo = {
      id: spawningId,
      referenceAgentId: agentId,
      tabId,
      prompt,
      model,
      startedAt: Date.now(),
      // Capture metadata for resilient rendering (in case agent lookup fails later)
      referenceName: referenceAgent.name,
      referenceIcon: referenceAgent.icon,
      referenceTheme: referenceAgent.theme,
    }

    // Add spawning placeholder immediately
    setSpawningHeadless(prev => new Map(prev).set(spawningId, spawningInfo))

    try {
      const result = await window.electronAPI?.startStandaloneHeadlessAgent?.(agentId, prompt, model, tabId)
      if (result) {
        // Update skeleton's tabId if the actual tab differs from what we predicted
        // Note: The main process already navigates to the correct tab via setActiveTab(),
        // and the renderer's onStateUpdate handler processes that before we get here.
        // We just need to move the skeleton to match.
        if (result.tabId !== tabId) {
          setSpawningHeadless(prev => {
            const next = new Map(prev)
            const info = next.get(spawningId)
            if (info) {
              next.set(spawningId, { ...info, tabId: result.tabId })
            }
            return next
          })
        }
        // Reload agents to pick up the new headless agent workspace
        await loadAgents()
        // The workspace will be added to a tab via IPC event, which will trigger state update
      }
    } finally {
      // Clear loading state - the real terminal will now be visible
      setSpawningHeadless(prev => {
        const next = new Map(prev)
        next.delete(spawningId)
        return next
      })
    }
  }

  // Start headless discussion handler
  const handleStartHeadlessDiscussion = async (agentId: string, initialPrompt: string) => {
    try {
      const result = await window.electronAPI?.startHeadlessDiscussion?.(agentId, initialPrompt)
      if (result) {
        // Reload agents to pick up the new discussion workspace
        await loadAgents()
      }
    } catch (error) {
      console.error('Failed to start headless discussion:', error)
    }
  }

  // Start Ralph Loop discussion handler
  const handleStartRalphLoopDiscussion = async (agentId: string, initialPrompt: string) => {
    try {
      const result = await window.electronAPI?.startRalphLoopDiscussion?.(agentId, initialPrompt)
      if (result) {
        // Reload agents to pick up the new discussion workspace
        await loadAgents()
      }
    } catch (error) {
      console.error('Failed to start Ralph Loop discussion:', error)
    }
  }

  // Start Ralph Loop handler
  const handleStartRalphLoop = async (config: RalphLoopConfig) => {
    const result = await window.electronAPI?.startRalphLoop?.(config)
    if (result) {
      // Store the Ralph Loop state
      setRalphLoops((prev) => {
        const newMap = new Map(prev)
        newMap.set(result.id, result)
        return newMap
      })
      // Reload agents to pick up the new iteration workspaces
      await loadAgents()
    }
  }

  // Tab handlers
  const handleTabSelect = async (tabId: string) => {
    if (activeTabId && activeTabId !== tabId) {
      // In expanded attention mode, clear maximized state when switching tabs
      if (preferences.attentionMode === 'expand') {
        setMaximizedAgentIdByTab(prev => ({ ...prev, [activeTabId]: null }))
      }

      // If the auto-expanded agent (waitingQueue[0]) is in the old tab, acknowledge it
      // This prevents fullscreen attention window from persisting when switching tabs
      const oldTab = tabs.find(t => t.id === activeTabId)
      if (oldTab && waitingQueue.length > 0) {
        const autoExpandedAgentId = waitingQueue[0]
        if (oldTab.workspaceIds.includes(autoExpandedAgentId)) {
          window.electronAPI?.acknowledgeWaiting?.(autoExpandedAgentId)
          setWaitingQueue(prev => prev.filter(id => id !== autoExpandedAgentId))
        }
      }
    }
    setActiveTabId(tabId)
    await window.electronAPI?.setActiveTab?.(tabId)
  }

  const handleTabRename = async (tabId: string, name: string) => {
    await window.electronAPI?.renameTab?.(tabId, name)
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, name } : t))
    )
  }

  const handleTabDeleteRequest = async (tabId: string) => {
    // Check if this tab has an in-progress plan
    const planStatus = await window.electronAPI?.getTabPlanStatus?.(tabId)
    setDeleteConfirmPlanInfo(planStatus || null)
    // Show confirmation dialog instead of deleting immediately
    setDeleteConfirmTabId(tabId)
  }

  const handleTabDelete = async (tabId: string) => {
    // Mark the tab as closing to show spinner
    setClosingTabIds((prev) => new Set(prev).add(tabId))
    try {
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
    } finally {
      // Remove from closing state (in case of failure or success)
      setClosingTabIds((prev) => {
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
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

  const handleTabReorder = async (draggedTabId: string, targetTabId: string) => {
    const currentOrder = tabs.map((t) => t.id)
    const dragIndex = currentOrder.indexOf(draggedTabId)
    const targetIndex = currentOrder.indexOf(targetTabId)

    if (dragIndex === -1 || targetIndex === -1 || dragIndex === targetIndex) {
      return
    }

    // Remove dragged item and insert at target position
    const newOrder = [...currentOrder]
    newOrder.splice(dragIndex, 1)
    newOrder.splice(targetIndex, 0, draggedTabId)

    // Persist the new order
    await window.electronAPI?.reorderTabs?.(newOrder)
    const state = await window.electronAPI.getState()
    setTabs(state.tabs || [])
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
        devLog('[Renderer] getHeadlessAgentsForTab: No plan found for tab', tab.id, 'plans:', plans.map(p => ({ id: p.id, tabId: p.orchestratorTabId })))
      }
      return []
    }
    const agentInfos = Array.from(headlessAgents.values()).filter((info) => info.planId === plan.id)
    devLog('[Renderer] getHeadlessAgentsForTab:', { tabId: tab.id, planId: plan.id, agentsFound: agentInfos.length, headlessAgentsTotal: headlessAgents.size, allHeadless: Array.from(headlessAgents.entries()) })

    // Apply custom order if available
    const customOrder = headlessAgentOrder.get(plan.id)
    if (customOrder && customOrder.length > 0) {
      const orderedInfos: HeadlessAgentInfo[] = []
      for (const id of customOrder) {
        const info = agentInfos.find((i) => i.id === id)
        if (info) {
          orderedInfos.push(info)
        }
      }
      // Add any agents not in the custom order at the end
      for (const info of agentInfos) {
        if (!customOrder.includes(info.id)) {
          orderedInfos.push(info)
        }
      }
      return orderedInfos
    }

    return agentInfos
  }, [plans, headlessAgents, headlessAgentOrder])

  // Get standalone headless agents for a regular tab
  const getStandaloneHeadlessForTab = useCallback((tab: AgentTab): Array<{ agent: Agent; info: HeadlessAgentInfo }> => {
    // Find agents in this tab that are standalone headless
    const results: Array<{ agent: Agent; info: HeadlessAgentInfo }> = []
    for (const workspaceId of tab.workspaceIds) {
      const agent = agents.find(a => a.id === workspaceId)
      if (agent?.isStandaloneHeadless && agent.taskId) {
        const info = headlessAgents.get(agent.taskId)
        if (info) {
          results.push({ agent, info })
        }
      }
    }
    return results
  }, [agents, headlessAgents])

  // Get spawning placeholders for a tab
  const getSpawningPlaceholdersForTab = useCallback((tabId: string): Array<{ spawningInfo: SpawningHeadlessInfo; referenceAgent: Agent | undefined }> => {
    const results: Array<{ spawningInfo: SpawningHeadlessInfo; referenceAgent: Agent | undefined }> = []
    for (const [, spawningInfo] of spawningHeadless) {
      if (spawningInfo.tabId === tabId) {
        const referenceAgent = agents.find(a => a.id === spawningInfo.referenceAgentId)
        // Always include - spawningInfo has fallback metadata for resilient rendering
        results.push({ spawningInfo, referenceAgent })
      }
    }
    return results
  }, [spawningHeadless, agents])

  // Get Ralph Loop iterations for a tab (used for Ralph Loop tabs which are plan-like)
  const getRalphLoopIterationsForTab = useCallback((tab: AgentTab): Array<{ loopState: RalphLoopState; iteration: RalphLoopIteration; agent: Agent | undefined }> => {
    const results: Array<{ loopState: RalphLoopState; iteration: RalphLoopIteration; agent: Agent | undefined }> = []
    devLog('[Renderer] getRalphLoopIterationsForTab:', { tabId: tab.id, ralphLoopsSize: ralphLoops.size, ralphLoopIds: Array.from(ralphLoops.keys()) })
    for (const [, loopState] of ralphLoops) {
      devLog('[Renderer] Checking loop:', { loopId: loopState.id, loopTabId: loopState.tabId, targetTabId: tab.id, match: loopState.tabId === tab.id })
      if (loopState.tabId === tab.id) {
        // Return ALL iterations, not just the running/most recent one
        for (const iteration of loopState.iterations) {
          const agent = agents.find(a => a.id === iteration.workspaceId)
          results.push({ loopState, iteration, agent })
        }

        // Apply custom order if available
        const key = `ralph-loop-${loopState.id}`
        const customOrder = headlessAgentOrder.get(key)
        if (customOrder && customOrder.length > 0) {
          results.sort((a, b) => {
            const aId = `ralph-${a.loopState.id}-iter-${a.iteration.iterationNumber}`
            const bId = `ralph-${b.loopState.id}-iter-${b.iteration.iterationNumber}`
            const aIdx = customOrder.indexOf(aId)
            const bIdx = customOrder.indexOf(bId)
            if (aIdx === -1 && bIdx === -1) return 0
            if (aIdx === -1) return 1
            if (bIdx === -1) return -1
            return aIdx - bIdx
          })
        }
      }
    }
    return results
  }, [ralphLoops, agents, headlessAgentOrder])

  // Debug: Log headlessAgents state changes
  useEffect(() => {
    devLog('[Renderer] headlessAgents state changed:', headlessAgents.size, Array.from(headlessAgents.keys()))
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
    devLog('[App] handleExecutePlan called:', { planId, referenceAgentId })
    devLog('[App] electronAPI available:', !!window.electronAPI)
    devLog('[App] executePlan available:', !!window.electronAPI?.executePlan)
    const result = await window.electronAPI?.executePlan?.(planId, referenceAgentId)
    devLog('[App] executePlan result:', result)

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

  // Simulation mode - shows empty state UI without affecting data (read-only)
  if (simulateNewUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <h1 className="text-foreground mb-4">
            <Logo size="lg" />
          </h1>
          <p className="text-muted-foreground mb-6">
            No agents configured. Add one to get started.
          </p>
          <Button disabled>
            <Plus className="h-4 w-4 mr-2" />
            Add Agent
          </Button>
          <p className="text-xs text-muted-foreground mt-4">
            [Simulation Mode - Read Only]
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setSimulateNewUser(false)}
          >
            Exit Simulation
          </Button>
        </div>
        {/* DevConsole still available to exit simulation */}
        <DevConsole
          open={devConsoleOpen}
          onClose={() => setDevConsoleOpen(false)}
          simulateNewUser={simulateNewUser}
          onToggleSimulateNewUser={() => setSimulateNewUser(false)}
        />
      </div>
    )
  }

  // Empty state - show setup wizard
  if (agents.length === 0) {
    return (
      <>
        <SetupWizard
          onComplete={async (newAgents) => {
            devLog('[App.onComplete] Starting with', newAgents?.length, 'agents')

            // Group agents into logical tabs using Haiku analysis
            if (newAgents && newAgents.length > 0) {
              devLog('[App.onComplete] Grouping agents into tabs...')
              await window.electronAPI.setupWizardGroupAgentsIntoTabs(newAgents)
              devLog('[App.onComplete] Agents grouped into tabs')
            }

            // Create terminals BEFORE loadAgents triggers the wizard → main app transition
            // This prevents race conditions where terminals aren't created because
            // loadAgents() sets agents.length > 0 which unmounts the wizard
            const createdTerminals: { terminalId: string; workspaceId: string }[] = []
            if (newAgents && newAgents.length > 0) {
              devLog('[App.onComplete] Creating terminals for', newAgents.length, 'agents...')
              for (const agent of newAgents) {
                // Skip headless agents - they don't use terminals
                if (!agent.isHeadless && !agent.isStandaloneHeadless) {
                  devLog('[App.onComplete] Creating terminal for agent:', agent.id, agent.name)
                  const terminalId = await window.electronAPI.createTerminal(agent.id)
                  devLog('[App.onComplete] Terminal created:', terminalId)
                  createdTerminals.push({ terminalId, workspaceId: agent.id })
                }
              }
              devLog('[App.onComplete] All terminals created:', createdTerminals.length)
            }

            // NOW load agents - this triggers the wizard → main app transition
            devLog('[App.onComplete] Loading agents...')
            await loadAgents()
            devLog('[App.onComplete] Agents loaded')

            // Set terminals state after loadAgents (state updates are batched)
            if (createdTerminals.length > 0) {
              setActiveTerminals((prev) => [...prev, ...createdTerminals])
            }

            // Refresh tabs to get the grouped state
            devLog('[App.onComplete] Refreshing tabs state...')
            const state = await window.electronAPI.getState()
            setTabs(state.tabs || [])
            setActiveTabId(state.activeTabId)

            // Reload preferences to get updated operatingMode from wizard
            // This ensures the tutorial includes the correct steps based on plan mode selection
            devLog('[App.onComplete] Loading preferences...')
            const freshPrefs = await window.electronAPI.getPreferences()
            setPreferences(freshPrefs)
            // Trigger tutorial after setup wizard completes (if not already completed)
            if (!freshPrefs.tutorialCompleted) {
              setShouldStartTutorial(true)
            }
            devLog('[App.onComplete] Complete!')
          }}
          onSkip={() => {
            // Open the manual agent creation modal
            handleAddAgent()
          }}
        />
        <AgentModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          agent={editingAgent}
          onSave={handleSaveAgent}
        />
      </>
    )
  }

  // Render both views but show only one - prevents terminal unmount/remount
  return (
    <TutorialProvider
      operatingMode={preferences.operatingMode}
      tutorialCompleted={preferences.tutorialCompleted}
      onTutorialComplete={handleTutorialComplete}
      onTutorialSkip={handleTutorialSkip}
      onAction={handleTutorialAction}
    >
      <TutorialTrigger
        shouldStart={shouldStartTutorial}
        onTriggered={() => {
          setShouldStartTutorial(false)
          tutorialStartTriggeredRef.current = true
        }}
      />
      {/* Settings view - rendered on top when active */}
      {currentView === 'settings' && (
        <SettingsPage
          onBack={() => {
            loadPreferences() // Reload preferences to pick up any changes made in settings
            setCurrentView('main')
          }}
          initialSection={settingsInitialSection}
          onSectionChange={() => setSettingsInitialSection(undefined)}
        />
      )}

      {/* Main workspace view - always rendered to preserve terminal state */}
      <div className={`h-screen bg-background flex flex-col ${currentView === 'settings' ? 'hidden' : ''}`}>
      {/* Header */}
      <header data-testid="app-header" className="relative border-b px-4 py-2 flex items-center justify-between">
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
        {/* Search hint */}
        <span
          onClick={() => setCommandSearchOpen(true)}
          className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground transition-colors"
        >
          {formatShortcutCompact((preferences.keyboardShortcuts || defaultKeyboardShortcuts).commandPalette)} to search
        </span>
        <div className="flex items-center gap-2">
          {toolsNeedingReauth.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="text-yellow-600/70 cursor-pointer hover:text-yellow-500 transition-colors"
                onClick={() => {
                  setSettingsInitialSection('tools')
                  setCurrentView('settings')
                }}
                title="Click to view tool auth details"
              >
                {toolsNeedingReauth.map(t => t.toolName).join(', ')}: re-auth required
              </span>
            </div>
          )}
          {updateAvailable && (
            <div className="flex items-center gap-1.5 text-xs">
              <span
                className="text-yellow-600/70 cursor-pointer hover:text-yellow-500 transition-colors"
                onClick={() => {
                  setSettingsInitialSection('updates')
                  setCurrentView('settings')
                }}
                title="Click to view update details"
              >
                Update: v{updateAvailable.currentVersion} → <span
                  className="underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.electronAPI.openExternal(updateAvailable.releaseUrl)
                  }}
                  title="View release notes on GitHub"
                >v{updateAvailable.version}</span>
              </span>
            </div>
          )}
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
          <Button size="sm" onClick={handleAddAgent} data-testid="add-agent-button">
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
          {preferences.operatingMode === 'team' && (
            <Button
              data-testid="plans-button"
              data-tutorial="plan-mode"
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
            data-testid="settings-button"
            data-tutorial="settings-button"
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
        onTabDelete={handleTabDeleteRequest}
        onTabCreate={handleTabCreate}
        draggedWorkspaceId={draggedWorkspaceId}
        dropTargetTabId={dropTargetTabId}
        onTabDragOver={(tabId) => setDropTargetTabId(tabId)}
        onTabDragLeave={() => setDropTargetTabId(null)}
        onTabDrop={handleDropOnTab}
        onTabReorder={handleTabReorder}
        closingTabIds={closingTabIds}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Agent list */}
        <aside className={`${sidebarCollapsed ? 'w-12' : 'w-64'} border-r flex flex-col overflow-hidden transition-all duration-200`}>
          {/* Header with toggle */}
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'} p-2 border-b`}>
            {!sidebarCollapsed && (
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">Agents</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleAddAgent}
                  className="h-5 w-5"
                  title="Add new agent"
                >
                  <Plus className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarEditMode(!sidebarEditMode)}
                  className={`h-5 w-5 ${sidebarEditMode ? 'bg-primary/20 text-primary' : ''}`}
                  title={sidebarEditMode ? 'Exit reorder mode' : 'Reorder agents'}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            )}
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
                            if (isActive) {
                              // Navigate to agent without expanding sidebar
                              if (agentTab && agentTab.id !== activeTabId) {
                                handleTabSelect(agentTab.id)
                              }
                              handleFocusAgent(agent.id)
                            } else {
                              // For inactive agents, expand sidebar to show details
                              setSidebarCollapsed(false)
                            }
                          }}
                          className={`p-1.5 rounded-md hover:brightness-110 transition-all cursor-pointer ${
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
                  <div data-tutorial="agents" className="space-y-3">
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
                        onCloneAgent={handleCloneAgent}
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
                          dataTutorial={simulatedAttentionAgentId === agent.id ? 'waiting-agent' : undefined}
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
                          onClone={() => handleCloneAgent(agent)}
                          onLaunch={() => handleLaunchAgent(agent.id)}
                          onStop={() => handleStopAgent(agent.id)}
                          onMoveToTab={(tabId) => handleMoveAgentToTab(agent.id, tabId)}
                          onStopHeadless={() => handleStopHeadlessAgent(agent)}
                          // Drag-and-drop for sidebar reordering
                          draggable={true}
                          isDragging={sidebarDraggedAgentId === agent.id}
                          isDropTarget={sidebarDropTargetAgentId === agent.id}
                          isEditMode={sidebarEditMode}
                          onDragStart={() => setSidebarDraggedAgentId(agent.id)}
                          onDragEnd={() => {
                            setSidebarDraggedAgentId(null)
                            setSidebarDropTargetAgentId(null)
                          }}
                          onDragOver={() => {
                            if (sidebarDraggedAgentId && sidebarDraggedAgentId !== agent.id) {
                              setSidebarDropTargetAgentId(agent.id)
                            }
                          }}
                          onDragLeave={() => {
                            if (sidebarDropTargetAgentId === agent.id) {
                              setSidebarDropTargetAgentId(null)
                            }
                          }}
                          onDrop={() => {
                            if (sidebarDraggedAgentId && sidebarDraggedAgentId !== agent.id) {
                              handleSidebarAgentReorder(sidebarDraggedAgentId, agent.id)
                            }
                            setSidebarDraggedAgentId(null)
                            setSidebarDropTargetAgentId(null)
                          }}
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
            // When a waiting agent is on a different tab, render that tab on top
            // Active tab gets z-10, waiting agent tab gets z-20 to appear above
            const zIndex = tabContainsAutoExpandedAgent && !isActiveTab ? 'z-20' : isActiveTab ? 'z-10' : ''

            return (
              <div
                key={tab.id}
                className={`absolute inset-2 bg-background ${shouldShowTab ? '' : 'invisible pointer-events-none'} ${zIndex}`}
              >
                {tabWorkspaceIds.length === 0 && getHeadlessAgentsForTab(tab).length === 0 && getRalphLoopIterationsForTab(tab).length === 0 && getSpawningPlaceholdersForTab(tab.id).length === 0 ? (
                  (() => {
                    const discussedPlan = tab.isPlanTab && plans.find(p => p.orchestratorTabId === tab.id && p.status === 'discussed')
                    if (discussedPlan) {
                      const selectedAgentId = discussionExecuteAgent[discussedPlan.id] || ''
                      const isExecuting = discussionExecuting[discussedPlan.id] || false
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-center gap-4 p-8">
                          <CheckCircle2 className="h-12 w-12 text-green-500" />
                          <div>
                            <h3 className="text-lg font-medium">Discussion Complete</h3>
                            <p className="text-muted-foreground mt-2">
                              Ready to execute your plan. Select a reference agent:
                            </p>
                          </div>

                          {/* Agent selector */}
                          <select
                            value={selectedAgentId}
                            onChange={(e) => setDiscussionExecuteAgent(prev => ({ ...prev, [discussedPlan.id]: e.target.value }))}
                            className="w-64 border rounded px-3 py-2 bg-background text-foreground"
                            disabled={isExecuting}
                          >
                            <option value="">Select reference agent...</option>
                            {agents
                              .filter(a => !a.isOrchestrator && !a.isPlanAgent && !a.parentPlanId)
                              .map(agent => (
                                <option key={agent.id} value={agent.id}>
                                  {agent.name}
                                </option>
                              ))}
                          </select>

                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPlanSidebarOpen(true)}
                              disabled={isExecuting}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Review Plan
                            </Button>
                            <Button
                              size="sm"
                              disabled={!selectedAgentId || isExecuting}
                              onClick={async () => {
                                if (!selectedAgentId) return
                                setDiscussionExecuting(prev => ({ ...prev, [discussedPlan.id]: true }))
                                try {
                                  const result = await handleExecutePlan(discussedPlan.id, selectedAgentId)
                                  // Clean up state
                                  setDiscussionExecuteAgent(prev => {
                                    const next = { ...prev }
                                    delete next[discussedPlan.id]
                                    return next
                                  })
                                  // Delete the old discussion tab if a new one was created
                                  if (result?.orchestratorTabId && result.orchestratorTabId !== tab.id) {
                                    await handleTabDelete(tab.id)
                                  }
                                  // Expand the plan in sidebar
                                  setExpandPlanId(discussedPlan.id)
                                } finally {
                                  setDiscussionExecuting(prev => {
                                    const next = { ...prev }
                                    delete next[discussedPlan.id]
                                    return next
                                  })
                                }
                              }}
                            >
                              {isExecuting ? (
                                <>Executing...</>
                              ) : (
                                <>
                                  <Play className="h-4 w-4 mr-2" />
                                  Execute Plan
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        Launch an agent to see the terminal
                      </div>
                    )
                  })()
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
                            } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''}`}
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
                                      Dismiss {navigator.platform.includes('Mac') ? '⌘N' : 'Ctrl+N'}
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
                                searchOpen={terminalSearchAgentId === agent.id}
                                onSearchClose={() => setTerminalSearchAgentId(null)}
                                registerWriter={registerWriter}
                                unregisterWriter={unregisterWriter}
                                getBufferedContent={getBufferedContent}
                              />
                            </div>
                          </div>
                        )
                      })}
                    {/* Headless agent terminals */}
                    {getHeadlessAgentsForTab(tab).map((info) => {
                      devLog('[Renderer] Rendering HeadlessTerminal for', { taskId: info.taskId, status: info.status })
                      const isExpanded = expandedAgentId === info.id
                      const prUrl = extractPRUrl(info.events)
                      const isDragging = draggedHeadlessId === info.id
                      const isDropTarget = dropTargetHeadlessId === info.id && !isDragging
                      return (
                        <div
                          key={info.id}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== info.id) {
                              setDropTargetHeadlessId(info.id)
                            }
                          }}
                          onDragLeave={() => {
                            if (dropTargetHeadlessId === info.id) {
                              setDropTargetHeadlessId(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== info.id && info.planId) {
                              handleHeadlessAgentReorder(info.planId, draggedHeadlessId, info.id)
                            }
                            setDraggedHeadlessId(null)
                            setDropTargetHeadlessId(null)
                          }}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''} ${
                            isDragging ? 'opacity-50' : ''
                          } ${isDropTarget ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}`}
                        >
                          <div
                            draggable={!expandedAgentId}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('headlessId', info.id)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggedHeadlessId(info.id)
                            }}
                            onDragEnd={() => {
                              setDraggedHeadlessId(null)
                              setDropTargetHeadlessId(null)
                            }}
                            className={`px-3 py-1.5 border-b text-sm font-medium flex items-center justify-between ${
                              info.agentType === 'critic' ? 'bg-amber-500/15' : 'bg-card'
                            } ${!expandedAgentId ? 'cursor-grab active:cursor-grabbing' : ''}`}
                          >
                            <div className="flex items-center gap-2">
                              <span>{info.agentType === 'critic' ? 'Critic' : 'Task'} {info.taskId}</span>
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
                              {info.model && (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  info.model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
                                  info.model === 'haiku' ? 'bg-green-500/20 text-green-400' :
                                  'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {info.model === 'opus' ? 'Opus' : info.model === 'haiku' ? 'Haiku' : 'Sonnet'}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                info.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                info.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                info.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>{info.status}</span>
                              {preferences.showAgentTimer !== false && (
                                <ElapsedTime startedAt={info.startedAt} completedAt={info.completedAt} />
                              )}
                              {info.originalPrompt && (
                                <Button size="sm" variant="ghost" onClick={() => setPromptViewerInfo(info)} className="h-6 w-6 p-0" title="View prompt">
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: isExpanded ? null : info.id }))} className="h-6 w-6 p-0">
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDestroyAgentTarget({ info, isStandalone: false })}
                                disabled={info.status === 'starting' || info.status === 'stopping'}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                                title="Destroy agent"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <HeadlessTerminal
                              events={info.events}
                              theme="teal"
                              status={info.status}
                              model={info.model}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              searchOpen={terminalSearchAgentId === info.id}
                              onSearchClose={() => setTerminalSearchAgentId(null)}
                            />
                          </div>
                        </div>
                      )
                    })}
                    {/* Standalone headless agents (e.g., Ralph Loop iterations) */}
                    {getStandaloneHeadlessForTab(tab).map(({ agent, info }) => {
                      const isExpanded = expandedAgentId === info.id
                      const isDragging = draggedHeadlessId === agent.id
                      const isDropTarget = dropTargetHeadlessId === agent.id && !isDragging
                      return (
                        <div
                          key={`standalone-${info.id}-${tab.id}`}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== agent.id) {
                              setDropTargetHeadlessId(agent.id)
                            }
                          }}
                          onDragLeave={() => {
                            if (dropTargetHeadlessId === agent.id) {
                              setDropTargetHeadlessId(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== agent.id) {
                              // Only handle drops from other standalone agents in this tab
                              const standaloneAgents = getStandaloneHeadlessForTab(tab)
                              const draggedAgent = standaloneAgents.find(s => s.agent.id === draggedHeadlessId)
                              if (draggedAgent) {
                                const targetPosition = tab.workspaceIds.indexOf(agent.id)
                                if (targetPosition !== -1) {
                                  handleReorderInTab(draggedHeadlessId, targetPosition)
                                }
                              }
                            }
                            setDraggedHeadlessId(null)
                            setDropTargetHeadlessId(null)
                          }}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''} ${
                            isDragging ? 'opacity-50' : ''
                          } ${isDropTarget ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}`}
                        >
                          <div
                            draggable={!expandedAgentId}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('standaloneHeadlessId', agent.id)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggedHeadlessId(agent.id)
                            }}
                            onDragEnd={() => {
                              setDraggedHeadlessId(null)
                              setDropTargetHeadlessId(null)
                            }}
                            className={`px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between ${
                              !expandedAgentId ? 'cursor-grab active:cursor-grabbing' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <AgentIcon icon={agent.icon} className="w-4 h-4" />
                              <span>{agent.name}</span>
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
                              {info.model && (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  info.model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
                                  info.model === 'haiku' ? 'bg-green-500/20 text-green-400' :
                                  'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {info.model === 'opus' ? 'Opus' : info.model === 'haiku' ? 'Haiku' : 'Sonnet'}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                info.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                info.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                info.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>{info.status}</span>
                              {preferences.showAgentTimer !== false && (
                                <ElapsedTime startedAt={info.startedAt} completedAt={info.completedAt} />
                              )}
                              {info.originalPrompt && (
                                <Button size="sm" variant="ghost" onClick={() => setPromptViewerInfo(info)} className="h-6 w-6 p-0" title="View prompt">
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: isExpanded ? null : info.id }))} className="h-6 w-6 p-0">
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDestroyAgentTarget({ info, isStandalone: true })}
                                disabled={info.status === 'starting' || info.status === 'stopping'}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                                title="Destroy agent"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <HeadlessTerminal
                              events={info.events}
                              theme={agent.theme}
                              status={info.status}
                              model={info.model}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              isStandalone={true}
                              searchOpen={terminalSearchAgentId === info.id}
                              onSearchClose={() => setTerminalSearchAgentId(null)}
                              onConfirmDone={() => handleStandaloneConfirmDone(info.taskId!)}
                              onStartFollowUp={() => handleStandaloneStartFollowup(info.taskId!)}
                              onRestart={() => handleStandaloneRestart(info.taskId!)}
                              isConfirmingDone={confirmingDoneIds.has(info.taskId!)}
                              isStartingFollowUp={startingFollowUpIds.has(info.taskId!)}
                              isRestarting={restartingIds.has(info.taskId!)}
                            />
                          </div>
                        </div>
                      )
                    })}
                    {/* Spawning placeholders for plan view */}
                    {getSpawningPlaceholdersForTab(tab.id).map(({ spawningInfo, referenceAgent }) => (
                      <div
                        key={`spawning-${spawningInfo.id}`}
                        className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                          expandedAgentId ? 'invisible' : ''
                        }`}
                      >
                        <SpawningPlaceholder info={spawningInfo} referenceAgent={referenceAgent} />
                      </div>
                    ))}
                    {/* Ralph Loop iterations (stored in ralphLoops state, not headlessAgents) */}
                    {getRalphLoopIterationsForTab(tab).map(({ loopState, iteration, agent }) => {
                      const uniqueId = `ralph-${loopState.id}-iter-${iteration.iterationNumber}`
                      const isExpanded = expandedAgentId === uniqueId
                      const isDragging = draggedHeadlessId === uniqueId
                      const isDropTarget = dropTargetHeadlessId === uniqueId && !isDragging
                      return (
                        <div
                          key={uniqueId}
                          onDragOver={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== uniqueId) {
                              setDropTargetHeadlessId(uniqueId)
                            }
                          }}
                          onDragLeave={() => {
                            if (dropTargetHeadlessId === uniqueId) {
                              setDropTargetHeadlessId(null)
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedHeadlessId && draggedHeadlessId !== uniqueId) {
                              // Only handle drops from other Ralph Loop iterations
                              if (draggedHeadlessId.startsWith(`ralph-${loopState.id}-iter-`)) {
                                handleRalphLoopReorder(loopState.id, draggedHeadlessId, uniqueId)
                              }
                            }
                            setDraggedHeadlessId(null)
                            setDropTargetHeadlessId(null)
                          }}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''} ${
                            isDragging ? 'opacity-50' : ''
                          } ${isDropTarget ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}`}
                        >
                          <div
                            draggable={!expandedAgentId}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('ralphIterationId', uniqueId)
                              e.dataTransfer.effectAllowed = 'move'
                              setDraggedHeadlessId(uniqueId)
                            }}
                            onDragEnd={() => {
                              setDraggedHeadlessId(null)
                              setDropTargetHeadlessId(null)
                            }}
                            className={`px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between ${
                              !expandedAgentId ? 'cursor-grab active:cursor-grabbing' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {agent && <AgentIcon icon={agent.icon} className="w-4 h-4" />}
                              <span>{agent?.name || `Ralph: ${loopState.phrase} (iter ${iteration.iterationNumber})`}</span>
                              {/* Git Summary */}
                              {loopState.gitSummary && (
                                <div className="flex items-center gap-2 ml-2 text-xs text-muted-foreground">
                                  {loopState.gitSummary.commits.length > 0 && (
                                    <span className="flex items-center gap-1" title={`${loopState.gitSummary.commits.length} commit${loopState.gitSummary.commits.length !== 1 ? 's' : ''}`}>
                                      <GitCommitHorizontal className="h-3 w-3" />
                                      <span>{loopState.gitSummary.commits.length}</span>
                                    </span>
                                  )}
                                </div>
                              )}
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
                              {loopState.config.model && (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  loopState.config.model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
                                  'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {loopState.config.model === 'opus' ? 'Opus' : 'Sonnet'}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                iteration.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                iteration.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                iteration.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>{iteration.status}</span>
                              {iteration.status === 'failed' && iteration.iterationNumber === loopState.currentIteration && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => window.electronAPI.retryRalphLoop(loopState.id)}
                                  className="h-6 px-2 text-xs text-orange-400 hover:text-orange-300 hover:bg-orange-500/20"
                                  title="Retry - start a new iteration on this loop"
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Retry
                                </Button>
                              )}
                              {preferences.showAgentTimer !== false && (
                                <ElapsedTime startedAt={iteration.startedAt} completedAt={iteration.completedAt} />
                              )}
                              <span className="text-xs text-muted-foreground">iter {iteration.iterationNumber}/{loopState.config.maxIterations}</span>
                              {loopState.config.prompt && (
                                <Button size="sm" variant="ghost" onClick={() => setPromptViewerInfo({ id: uniqueId, planId: loopState.id, status: iteration.status === 'pending' ? 'starting' : iteration.status, events: iteration.events, originalPrompt: loopState.config.prompt, worktreePath: loopState.worktreeInfo.path, startedAt: iteration.startedAt })} className="h-6 w-6 p-0" title="View prompt">
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: isExpanded ? null : uniqueId }))} className="h-6 w-6 p-0">
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <HeadlessTerminal
                              events={iteration.events}
                              theme={agent?.theme || 'purple'}
                              status={iteration.status === 'pending' ? 'starting' : iteration.status}
                              model={loopState.config.model}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              searchOpen={terminalSearchAgentId === uniqueId}
                              onSearchClose={() => setTerminalSearchAgentId(null)}
                            />
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
                    {/* Only render agents that fit within the current grid size */}
                    {activeTerminals
                      .filter((t) => tabWorkspaceIds.includes(t.workspaceId))
                      .map((terminal) => {
                        const workspaceId = terminal.workspaceId
                        const position = tabWorkspaceIds.indexOf(workspaceId)
                        if (position === -1 || position >= gridConfig.maxAgents) return null
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
                          data-tutorial={simulatedAttentionAgentId === workspaceId ? 'waiting-agent' : undefined}
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
                          } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''} ${
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
                              {/* Diff toggle button (only for non-headless agents in git repos) */}
                              {preferences.showDiffView !== false && !agent.isHeadless && !agent.isStandaloneHeadless && gitRepoStatus.get(agent.directory) !== false && (
                                <div className="relative">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (diffOpenForWorkspace === workspaceId) {
                                        closeDiffAndRestore(tab.id)
                                      } else {
                                        setExpandedBeforeDiff(isExpanded)
                                        setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: workspaceId }))
                                        setDiffOpenForWorkspace(workspaceId)
                                      }
                                    }}
                                    title="View Changes (Cmd+D)"
                                    className="h-6 w-6 p-0"
                                  >
                                    <GitCompareArrows className="h-3 w-3" />
                                  </Button>
                                  {fileChangeCounts.has(workspaceId) && (
                                    <span className={`absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full text-[9px] font-bold flex items-center justify-center text-white px-0.5 pointer-events-none ${
                                      fileChangeCounts.get(workspaceId) === 0
                                        ? 'bg-green-500'
                                        : fileChangeCounts.get(workspaceId)! >= 10
                                          ? 'bg-red-500'
                                          : 'bg-orange-500'
                                    }`}>
                                      {fileChangeCounts.get(workspaceId)! > 99 ? '99+' : fileChangeCounts.get(workspaceId)}
                                    </span>
                                  )}
                                </div>
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
                                    Dismiss {navigator.platform.includes('Mac') ? '⌘N' : 'Ctrl+N'}
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
                          <div className="h-[calc(100%-2rem)] relative">
                            <Terminal
                              terminalId={terminal.terminalId}
                              theme={agent.theme}
                              isBooting={!bootedTerminals.has(terminal.terminalId)}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              searchOpen={terminalSearchAgentId === agent.id}
                              onSearchClose={() => setTerminalSearchAgentId(null)}
                              registerWriter={registerWriter}
                              unregisterWriter={unregisterWriter}
                              getBufferedContent={getBufferedContent}
                            />
                            {/* Diff overlay (absolute position over terminal) */}
                            {preferences.showDiffView !== false && diffOpenForWorkspace === workspaceId && (
                              <DiffOverlay
                                directory={agent.directory}
                                onClose={() => closeDiffAndRestore(tab.id)}
                              />
                            )}
                            {/* Discussion completing overlay */}
                            {discussionCompletingWorkspaceId === workspaceId && (
                              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90">
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">Starting headless agent...</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Render standalone headless agents */}
                    {getStandaloneHeadlessForTab(tab).map(({ agent, info }) => {
                      const position = tabWorkspaceIds.indexOf(agent.id)
                      if (position === -1 || position >= gridConfig.maxAgents) return null
                      const { row: gridRow, col: gridCol } = getGridPosition(position, gridConfig.cols)
                      const isExpanded = expandedAgentId === info.id
                      const prUrl = extractPRUrl(info.events)
                      const isDropTarget = dropTargetPosition === position && isActiveTab
                      const isDragging = draggedWorkspaceId === agent.id

                      return (
                        <div
                          key={`headless-${info.id}-${tab.id}`}
                          style={{ gridRow, gridColumn: gridCol }}
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
                            if (sourceId && sourceId !== agent.id && !expandedAgentId) {
                              handleReorderInTab(sourceId, position)
                            }
                            setDropTargetPosition(null)
                            setDraggedWorkspaceId(null)
                          }}
                          className={`rounded-lg border overflow-hidden transition-all duration-200 ${
                            !isExpanded && expandedAgentId ? 'invisible' : ''
                          } ${isExpanded ? 'absolute inset-0 z-10 bg-background' : ''} ${
                            isDragging ? 'opacity-50' : ''
                          } ${isDropTarget && !isDragging ? 'ring-2 ring-primary ring-offset-2' : ''}`}
                        >
                          <div
                            draggable={!expandedAgentId}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('workspaceId', agent.id)
                              setDraggedWorkspaceId(agent.id)
                            }}
                            onDragEnd={() => {
                              setDraggedWorkspaceId(null)
                              setDropTargetPosition(null)
                            }}
                            className={`px-3 py-1.5 border-b bg-card text-sm font-medium flex items-center justify-between ${
                              !expandedAgentId ? 'cursor-grab active:cursor-grabbing' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <AgentIcon icon={agent.icon} className="w-4 h-4" />
                              <span>{agent.name}</span>
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
                              {info.model && (
                                <span className={`text-xs px-1.5 py-0.5 rounded ${
                                  info.model === 'opus' ? 'bg-purple-500/20 text-purple-400' :
                                  info.model === 'haiku' ? 'bg-green-500/20 text-green-400' :
                                  'bg-blue-500/20 text-blue-400'
                                }`}>
                                  {info.model === 'opus' ? 'Opus' : info.model === 'haiku' ? 'Haiku' : 'Sonnet'}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                info.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                                info.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                info.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>{info.status}</span>
                              {preferences.showAgentTimer !== false && (
                                <ElapsedTime startedAt={info.startedAt} completedAt={info.completedAt} />
                              )}
                              {info.originalPrompt && (
                                <Button size="sm" variant="ghost" onClick={() => setPromptViewerInfo(info)} className="h-6 w-6 p-0" title="View prompt">
                                  <Eye className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setMaximizedAgentIdByTab(prev => ({ ...prev, [tab.id]: isExpanded ? null : info.id }))}
                                className="h-6 w-6 p-0"
                              >
                                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDestroyAgentTarget({ info, isStandalone: true })}
                                disabled={info.status === 'starting' || info.status === 'stopping'}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                                title="Destroy agent"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="h-[calc(100%-2rem)]">
                            <HeadlessTerminal
                              events={info.events}
                              theme={agent.theme}
                              status={info.status}
                              model={info.model}
                              isVisible={currentView === 'main' && !!shouldShowTab && (!expandedAgentId || isExpanded)}
                              isStandalone={true}
                              searchOpen={terminalSearchAgentId === info.id}
                              onSearchClose={() => setTerminalSearchAgentId(null)}
                              onConfirmDone={() => handleStandaloneConfirmDone(info.taskId!)}
                              onStartFollowUp={() => handleStandaloneStartFollowup(info.taskId!)}
                              onRestart={() => handleStandaloneRestart(info.taskId!)}
                              isConfirmingDone={confirmingDoneIds.has(info.taskId!)}
                              isStartingFollowUp={startingFollowUpIds.has(info.taskId!)}
                              isRestarting={restartingIds.has(info.taskId!)}
                            />
                          </div>
                        </div>
                      )
                    })}

                    {/* Render spawning placeholders */}
                    {getSpawningPlaceholdersForTab(tab.id).map(({ spawningInfo, referenceAgent }, index) => {
                      // Position after existing workspaces
                      const position = tabWorkspaceIds.length + index
                      if (position >= gridConfig.maxAgents) return null
                      const { row: gridRow, col: gridCol } = getGridPosition(position, gridConfig.cols)

                      return (
                        <div
                          key={`spawning-${spawningInfo.id}`}
                          style={{ gridRow, gridColumn: gridCol }}
                          className={`transition-all duration-200 ${
                            expandedAgentId ? 'invisible' : ''
                          }`}
                        >
                          <SpawningPlaceholder info={spawningInfo} referenceAgent={referenceAgent} />
                        </div>
                      )
                    })}

                    {/* Render empty slots separately - keyed by position */}
                    {gridPositions.map((position) => {
                      if (tabWorkspaceIds[position]) return null // Skip if occupied
                      // Also skip if there's a spawning placeholder in this position
                      const spawningCount = getSpawningPlaceholdersForTab(tab.id).length
                      if (position >= tabWorkspaceIds.length && position < tabWorkspaceIds.length + spawningCount) return null
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

      {/* Delete Tab Confirmation Dialog */}
      <Dialog
        open={deleteConfirmTabId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteConfirmTabId(null)
            setDeleteConfirmPlanInfo(null)
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className={deleteConfirmPlanInfo?.isInProgress ? 'text-red-400' : ''}>
              {deleteConfirmPlanInfo?.isInProgress ? 'Cancel Running Plan?' : 'Close Tab'}
            </DialogTitle>
            <DialogDescription>
              {deleteConfirmPlanInfo?.isInProgress ? (
                <>
                  <span className="font-medium text-foreground">"{deleteConfirmPlanInfo.planTitle}"</span> has agents actively running.
                  Closing this tab will:
                </>
              ) : (
                'Are you sure you want to close this tab? All workspaces in this tab will be closed.'
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteConfirmPlanInfo?.isInProgress && (
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li>Stop all running agents</li>
              <li>Cancel the plan execution</li>
              <li>Clean up worktrees and branches</li>
            </ul>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteConfirmTabId(null)
                setDeleteConfirmPlanInfo(null)
              }}
            >
              {deleteConfirmPlanInfo?.isInProgress ? 'Keep Running' : 'Cancel'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmTabId) {
                  handleTabDelete(deleteConfirmTabId)
                  setDeleteConfirmTabId(null)
                  setDeleteConfirmPlanInfo(null)
                }
              }}
            >
              {deleteConfirmPlanInfo?.isInProgress ? 'Cancel Plan & Close' : 'Close Tab'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destroy Agent Confirmation Dialog */}
      {destroyAgentTarget && (
        <Dialog open onOpenChange={(open) => !open && setDestroyAgentTarget(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-red-400">Destroy Agent?</DialogTitle>
              <DialogDescription>
                This will permanently delete:
              </DialogDescription>
            </DialogHeader>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
              <li>The Docker container (if running)</li>
              <li>The git worktree</li>
              <li>Local and remote branches</li>
            </ul>
            <p className="text-sm text-yellow-500">This action cannot be undone.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDestroyAgentTarget(null)} disabled={isDestroying}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleDestroyAgent} disabled={isDestroying}>
                {isDestroying ? 'Destroying...' : 'Destroy'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Prompt Viewer Modal */}
      <PromptViewerModal info={promptViewerInfo} onClose={() => setPromptViewerInfo(null)} />

      {/* Follow-up Modal */}
      <FollowUpModal
        info={followUpInfo}
        defaultModel={preferences.agentModel}
        onClose={() => setFollowUpInfo(null)}
        onSubmit={executeFollowUp}
        isSubmitting={followUpInfo?.taskId ? startingFollowUpIds.has(followUpInfo.taskId) : false}
      />

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
        simulateNewUser={simulateNewUser}
        onToggleSimulateNewUser={() => setSimulateNewUser(!simulateNewUser)}
      />

      {/* Command Search (CMD-K) */}
      <CommandSearch
        open={commandSearchOpen}
        onOpenChange={(open) => {
          setCommandSearchOpen(open)
          if (!open) {
            // Clear prefill when closing
            setPrefillRalphLoopConfig(null)
          }
        }}
        agents={agents}
        activeTerminals={activeTerminals}
        waitingQueue={waitingQueue}
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectAgent={handleCommandSearchSelect}
        onStartHeadless={handleStartStandaloneHeadless}
        onStartHeadlessDiscussion={handleStartHeadlessDiscussion}
        onStartRalphLoopDiscussion={handleStartRalphLoopDiscussion}
        onStartPlan={() => setPlanCreatorOpen(true)}
        onStartRalphLoop={handleStartRalphLoop}
        onAddTerminal={handleAddTerminal}
        prefillRalphLoopConfig={prefillRalphLoopConfig}
      />

      {/* Update Available Popup (for significantly outdated versions) */}
      <Dialog open={showUpdatePopup} onOpenChange={setShowUpdatePopup}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Update Recommended</DialogTitle>
            <DialogDescription>
              You're running v{updateAvailable?.currentVersion}, but v{updateAvailable?.version} is available.
              We recommend updating to get the latest features and bug fixes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUpdatePopup(false)}
            >
              Skip for now
            </Button>
            <Button
              onClick={() => {
                setShowUpdatePopup(false)
                setSettingsInitialSection('updates')
                setCurrentView('settings')
              }}
            >
              View Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </TutorialProvider>
  )
}

export default App
