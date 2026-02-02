import type { Workspace, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, Repository, HeadlessAgentInfo, StreamEvent, BranchStrategy, BeadTask, PromptType } from '../shared/types'
import type { AppSettings, ProxiedTool } from '../main/settings-manager'

export interface ElectronAPI {
  // Workspace management
  getWorkspaces: () => Promise<Workspace[]>
  saveWorkspace: (workspace: Workspace) => Promise<Workspace>
  deleteWorkspace: (id: string) => Promise<void>

  // Terminal management
  createTerminal: (workspaceId: string) => Promise<string>
  writeTerminal: (terminalId: string, data: string) => Promise<void>
  resizeTerminal: (
    terminalId: string,
    cols: number,
    rows: number
  ) => Promise<void>
  closeTerminal: (terminalId: string) => Promise<void>
  stopWorkspace: (workspaceId: string) => Promise<void>

  // State management
  getState: () => Promise<AppState>
  setFocusedWorkspace: (workspaceId: string | undefined) => Promise<void>

  // Tab management
  createTab: (name?: string) => Promise<AgentTab>
  renameTab: (tabId: string, name: string) => Promise<void>
  deleteTab: (
    tabId: string
  ) => Promise<{ success: boolean; workspaceIds: string[] }>
  setActiveTab: (tabId: string) => Promise<void>
  getTabs: () => Promise<AgentTab[]>
  reorderWorkspaceInTab: (
    tabId: string,
    workspaceId: string,
    newPosition: number
  ) => Promise<boolean>
  moveWorkspaceToTab: (
    workspaceId: string,
    targetTabId: string,
    position?: number
  ) => Promise<boolean>

  // Waiting queue management
  getWaitingQueue: () => Promise<string[]>
  acknowledgeWaiting: (workspaceId: string) => Promise<void>

  // Preferences management
  getPreferences: () => Promise<AppPreferences>
  setPreferences: (preferences: Partial<AppPreferences>) => Promise<AppPreferences>

  // Plan management (Team Mode)
  createPlan: (title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: BranchStrategy }) => Promise<Plan>
  getPlans: () => Promise<Plan[]>
  executePlan: (planId: string, referenceAgentId: string) => Promise<Plan | null>
  startDiscussion: (planId: string, referenceAgentId: string) => Promise<Plan | null>
  cancelDiscussion: (planId: string) => Promise<Plan | null>
  cancelPlan: (planId: string) => Promise<Plan | null>
  restartPlan: (planId: string) => Promise<Plan | null>
  completePlan: (planId: string) => Promise<Plan | null>
  requestFollowUps: (planId: string) => Promise<Plan | null>
  getTaskAssignments: (planId: string) => Promise<TaskAssignment[]>
  getPlanActivities: (planId: string) => Promise<PlanActivity[]>
  getBeadTasks: (planId: string) => Promise<BeadTask[]>
  setPlanSidebarOpen: (open: boolean) => Promise<void>
  setActivePlanId: (planId: string | null) => Promise<void>
  deletePlan: (planId: string) => Promise<void>
  deletePlans: (planIds: string[]) => Promise<{ deleted: string[]; errors: Array<{ planId: string; error: string }> }>
  clonePlan: (planId: string, options?: { includeDiscussion?: boolean }) => Promise<Plan>

  // Headless agent management
  getHeadlessAgentInfo: (taskId: string) => Promise<HeadlessAgentInfo | undefined>
  getHeadlessAgentsForPlan: (planId: string) => Promise<HeadlessAgentInfo[]>
  stopHeadlessAgent: (taskId: string) => Promise<void>
  destroyHeadlessAgent: (taskId: string, isStandalone: boolean) => Promise<{ success: boolean; error?: string }>

  // Standalone headless agent management
  startStandaloneHeadlessAgent: (agentId: string, prompt: string, model: 'opus' | 'sonnet') => Promise<{ headlessId: string; workspaceId: string }>
  getStandaloneHeadlessAgents: () => Promise<HeadlessAgentInfo[]>
  stopStandaloneHeadlessAgent: (headlessId: string) => Promise<void>
  standaloneHeadlessConfirmDone: (headlessId: string) => Promise<void>
  standaloneHeadlessStartFollowup: (headlessId: string, prompt: string) => Promise<{ headlessId: string; workspaceId: string }>

  // OAuth token management
  getOAuthToken: () => Promise<string | null>
  setOAuthToken: (token: string) => Promise<boolean>
  hasOAuthToken: () => Promise<boolean>
  runOAuthSetup: () => Promise<string>
  clearOAuthToken: () => Promise<boolean>

  // Git repository management
  detectGitRepository: (directory: string) => Promise<Repository | null>
  getRepositories: () => Promise<Repository[]>
  updateRepository: (id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches'>>) => Promise<Repository | undefined>
  addRepository: (path: string) => Promise<Repository | null>
  removeRepository: (id: string) => Promise<boolean>

  // Settings management
  getSettings: () => Promise<AppSettings>
  updateDockerResourceLimits: (limits: { cpu?: string; memory?: string }) => Promise<void>
  addDockerImage: (image: string) => Promise<void>
  removeDockerImage: (image: string) => Promise<boolean>
  setSelectedDockerImage: (image: string) => Promise<void>
  updateToolPaths: (paths: { bd?: string | null; gh?: string | null; git?: string | null }) => Promise<void>
  detectToolPaths: () => Promise<{ bd: string | null; gh: string | null; git: string | null }>
  addProxiedTool: (tool: { name: string; hostPath: string; description?: string }) => Promise<ProxiedTool>
  removeProxiedTool: (id: string) => Promise<boolean>
  updateDockerSshSettings: (settings: { enabled?: boolean }) => Promise<void>
  setRawSettings: (settings: unknown) => Promise<AppSettings>

  // Prompt management
  getCustomPrompts: () => Promise<{ orchestrator: string | null; planner: string | null; discussion: string | null }>
  setCustomPrompt: (type: PromptType, template: string | null) => Promise<void>
  getDefaultPrompt: (type: PromptType) => Promise<string>

  // Terminal events
  onTerminalData: (
    callback: (terminalId: string, data: string) => void
  ) => void
  onTerminalExit: (callback: (terminalId: string, code: number) => void) => void

  // Agent waiting events
  onAgentWaiting: (callback: (workspaceId: string) => void) => void
  onFocusWorkspace: (callback: (workspaceId: string) => void) => void
  onMaximizeWorkspace: (callback: (workspaceId: string) => void) => void
  onWaitingQueueChanged: (callback: (queue: string[]) => void) => void
  onInitialState: (callback: (state: AppState) => void) => void

  // Plan events (Team Mode)
  onPlanUpdate: (callback: (plan: Plan) => void) => void
  onPlanDeleted: (callback: (planId: string) => void) => void
  onTaskAssignmentUpdate: (callback: (assignment: TaskAssignment) => void) => void
  onPlanActivity: (callback: (activity: PlanActivity) => void) => void
  onStateUpdate: (callback: (state: AppState) => void) => void
  onTerminalCreated: (callback: (data: { terminalId: string; workspaceId: string }) => void) => void

  // Headless agent events
  onHeadlessAgentStarted: (callback: (data: { taskId: string; planId: string; worktreePath: string }) => void) => void
  onHeadlessAgentUpdate: (callback: (info: HeadlessAgentInfo) => void) => void
  onHeadlessAgentEvent: (callback: (data: { planId: string; taskId: string; event: StreamEvent }) => void) => void

  // Bead task events
  onBeadTasksUpdated: (callback: (planId: string) => void) => void

  // Terminal queue status
  onTerminalQueueStatus: (callback: (status: { queued: number; active: number; pending: string[] }) => void) => void

  // External URL handling
  openExternal: (url: string) => Promise<void>

  // Open Docker Desktop
  openDockerDesktop: () => Promise<{ success: boolean; error?: string }>

  // File reading
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>

  // Settings management (Tool Paths)
  detectToolPaths?: () => Promise<{ bd: string | null; gh: string | null; git: string | null }>
  getToolPaths?: () => Promise<{ bd: string | null; gh: string | null; git: string | null }>
  updateToolPaths?: (paths: Partial<{ bd: string | null; gh: string | null; git: string | null }>) => Promise<void>

  // Tray updates
  updateTray: (count: number) => void

  // Cleanup
  removeAllListeners: () => void

  // Dev test harness (development mode only)
  devRunMockFlow?: (options?: { eventIntervalMs?: number; startDelayMs?: number }) => Promise<{ planId: string; planDir: string; tasks: Array<{ id: string; subject: string }> } | undefined>
  devStartMockAgent?: (taskId: string, planId?: string, worktreePath?: string, options?: { eventIntervalMs?: number }) => Promise<void>
  devStopMock?: () => Promise<void>
  devSetMockFlowOptions?: (options: { eventIntervalMs?: number; startDelayMs?: number }) => Promise<{ eventIntervalMs: number; startDelayMs: number }>
  devGetMockFlowOptions?: () => Promise<{ eventIntervalMs: number; startDelayMs: number }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
