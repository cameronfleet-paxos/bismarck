import type { Workspace, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, Repository, HeadlessAgentInfo, StreamEvent, BranchStrategy, TeamMode, BeadTask, PromptType, DiscoveredRepo, RalphLoopConfig, RalphLoopState, DescriptionProgressEvent, DiffResult, FileDiffContent } from '../shared/types'
import type { AppSettings, ProxiedTool } from '../main/settings-manager'

// Tool auth status from the auth checker
export interface ToolAuthStatus {
  toolId: string
  toolName: string
  state: 'valid' | 'needs-reauth' | 'error'
  reauthHint?: string
  message?: string
}

// Update status types
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseUrl: string; currentVersion: string; significantlyOutdated: boolean }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string }

export interface ElectronAPI {
  // Workspace management
  getWorkspaces: () => Promise<Workspace[]>
  saveWorkspace: (workspace: Workspace) => Promise<Workspace>
  deleteWorkspace: (id: string) => Promise<void>
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>

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

  // Plain terminal management (non-agent shell terminals)
  createPlainTerminal: (directory: string, name?: string) => Promise<{ terminalId: string; tabId: string }>
  closePlainTerminal: (terminalId: string) => Promise<void>
  renamePlainTerminal: (terminalId: string, name: string) => Promise<void>
  restorePlainTerminal: (pt: { id: string; terminalId: string; tabId: string; name: string; directory: string }) => Promise<{ terminalId: string; plainId: string } | null>

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
  getTabPlanStatus: (tabId: string) => Promise<{
    hasPlan: boolean
    planId?: string
    planTitle?: string
    planStatus?: string
    isInProgress: boolean
  }>
  reorderTabs: (tabIds: string[]) => Promise<boolean>
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
  createPlan: (title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: BranchStrategy; teamMode?: TeamMode }) => Promise<Plan>
  getPlans: () => Promise<Plan[]>
  executePlan: (planId: string, referenceAgentId: string, teamMode?: TeamMode) => Promise<Plan | null>
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
  startStandaloneHeadlessAgent: (agentId: string, prompt: string, model: 'opus' | 'sonnet' | 'haiku', tabId?: string, options?: { planPhase?: boolean }) => Promise<{ headlessId: string; workspaceId: string; tabId: string }>
  getStandaloneHeadlessAgents: () => Promise<HeadlessAgentInfo[]>
  stopStandaloneHeadlessAgent: (headlessId: string) => Promise<void>
  standaloneHeadlessConfirmDone: (headlessId: string) => Promise<void>
  standaloneHeadlessStartFollowup: (headlessId: string, prompt: string, model?: 'opus' | 'sonnet' | 'haiku', options?: { planPhase?: boolean }) => Promise<{ headlessId: string; workspaceId: string; tabId: string }>
  standaloneHeadlessRestart: (headlessId: string, model: 'opus' | 'sonnet' | 'haiku') => Promise<{ headlessId: string; workspaceId: string }>

  // Headless discussion (Discuss: Headless Agent)
  startHeadlessDiscussion: (agentId: string, initialPrompt: string) => Promise<{ discussionId: string; workspaceId: string; tabId: string }>
  cancelHeadlessDiscussion: (discussionId: string) => Promise<void>

  // Ralph Loop discussion (Discuss: Ralph Loop)
  startRalphLoopDiscussion: (agentId: string, initialPrompt: string) => Promise<{ discussionId: string; workspaceId: string; tabId: string }>
  cancelRalphLoopDiscussion: (discussionId: string) => Promise<void>

  // Ralph Loop management
  startRalphLoop: (config: RalphLoopConfig) => Promise<RalphLoopState>
  cancelRalphLoop: (loopId: string) => Promise<void>
  pauseRalphLoop: (loopId: string) => Promise<void>
  resumeRalphLoop: (loopId: string) => Promise<void>
  retryRalphLoop: (loopId: string) => Promise<void>
  getRalphLoopState: (loopId: string) => Promise<RalphLoopState | undefined>
  getAllRalphLoops: () => Promise<RalphLoopState[]>
  cleanupRalphLoop: (loopId: string) => Promise<void>

  // Ralph Loop presets
  getRalphLoopPresets: () => Promise<Array<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }>>
  addRalphLoopPreset: (preset: { label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }) => Promise<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }>
  updateRalphLoopPreset: (id: string, updates: { label?: string; description?: string; prompt?: string; completionPhrase?: string; maxIterations?: number; model?: 'opus' | 'sonnet' }) => Promise<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' } | undefined>
  deleteRalphLoopPreset: (id: string) => Promise<boolean>

  // OAuth token management
  getOAuthToken: () => Promise<string | null>
  setOAuthToken: (token: string) => Promise<boolean>
  hasOAuthToken: () => Promise<boolean>
  runOAuthSetup: () => Promise<string>
  clearOAuthToken: () => Promise<boolean>

  // Git repository management
  detectGitRepository: (directory: string) => Promise<Repository | null>
  getRepositories: () => Promise<Repository[]>
  updateRepository: (id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'>>) => Promise<Repository | undefined>
  addRepository: (path: string) => Promise<Repository | null>
  removeRepository: (id: string) => Promise<boolean>

  // Git diff operations
  getChangedFiles: (directory: string) => Promise<DiffResult>
  getFileDiff: (directory: string, filepath: string, force?: boolean) => Promise<FileDiffContent>
  isGitRepo: (directory: string) => Promise<boolean>
  revertFile: (directory: string, filepath: string) => Promise<void>
  writeFileContent: (directory: string, filepath: string, content: string) => Promise<void>
  revertAllFiles: (directory: string) => Promise<void>

  // Setup wizard
  setupWizardShowFolderPicker: () => Promise<string | null>
  setupWizardGetCommonRepoPaths: () => Promise<string[]>
  setupWizardScanForRepositories: (parentPath: string, depth?: number) => Promise<DiscoveredRepo[]>
  setupWizardBulkCreateAgents: (repos: (DiscoveredRepo & { purpose?: string; completionCriteria?: string; protectedBranches?: string[] })[]) => Promise<Workspace[]>
  setupWizardSaveDefaultReposPath: (reposPath: string) => Promise<void>
  setupWizardGetDefaultReposPath: () => Promise<string | null>
  setupWizardGenerateDescriptions: (repos: DiscoveredRepo[]) => Promise<Array<{ repoPath: string; purpose: string; completionCriteria: string; protectedBranches: string[]; error?: string }>>
  setupWizardCheckPlanModeDeps: () => Promise<import('../shared/types').PlanModeDependencies>
  setupWizardEnablePlanMode: (enabled: boolean) => Promise<void>
  setupWizardDetectAndSaveGitHubToken: () => Promise<{ success: boolean; source: string | null; reason?: string }>
  setupWizardGroupAgentsIntoTabs: (agents: Workspace[]) => Promise<AgentTab[]>

  // Setup wizard terminal for "Fix with Claude" feature
  setupWizardCreateFixTerminal: () => Promise<string>
  setupWizardWriteFixTerminal: (terminalId: string, data: string) => Promise<void>
  setupWizardResizeFixTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>
  setupWizardCloseFixTerminal: (terminalId: string) => Promise<void>
  onSetupTerminalData: (callback: (terminalId: string, data: string) => void) => void
  onSetupTerminalExit: (callback: (terminalId: string, code: number) => void) => void
  removeSetupTerminalListeners: () => void

  // Docker image pull
  setupWizardPullDockerImage: () => Promise<{ success: boolean; output: string }>
  onDockerPullProgress: (callback: (message: string) => void) => void
  removeDockerPullProgressListener: () => void

  // Docker image status
  checkDockerImageStatus: (imageName: string) => Promise<{ dockerAvailable: boolean; exists: boolean; imageId?: string; created?: string; size?: number; digest?: string; labels?: Record<string, string>; verified?: boolean }>
  pullDockerImage: (imageName: string) => Promise<{ success: boolean; output: string; alreadyUpToDate: boolean }>

  // Base image update notification (for BYO image users)
  onBaseImageUpdated: (callback: (data: { newVersion: string | null; newDigest: string | null }) => void) => void
  removeBaseImageUpdatedListener: () => void

  // GitHub token management
  hasGitHubToken: () => Promise<boolean>
  setGitHubToken: (token: string) => Promise<boolean>
  clearGitHubToken: () => Promise<boolean>
  checkGitHubTokenScopes: () => Promise<{ valid: boolean; scopes: string[]; missingScopes: string[]; ssoConfigured: boolean | null; error?: string }>

  // Settings management
  getSettings: () => Promise<AppSettings>
  updateDockerResourceLimits: (limits: { cpu?: string; memory?: string; gomaxprocs?: string }) => Promise<void>
  addDockerImage: (image: string) => Promise<void>
  removeDockerImage: (image: string) => Promise<boolean>
  setSelectedDockerImage: (image: string) => Promise<void>
  updateToolPaths: (paths: { bd?: string | null; bb?: string | null; gh?: string | null; git?: string | null }) => Promise<void>
  detectToolPaths: () => Promise<{ bd: string | null; bb: string | null; gh: string | null; git: string | null }>
  toggleProxiedTool: (id: string, enabled: boolean) => Promise<ProxiedTool | undefined>
  getToolAuthStatuses: () => Promise<ToolAuthStatus[]>
  checkToolAuth: () => Promise<ToolAuthStatus[]>
  runToolReauth: (toolId: string) => Promise<void>
  onToolAuthStatus: (callback: (statuses: ToolAuthStatus[]) => void) => void
  removeToolAuthStatusListener: () => void
  updateDockerSshSettings: (settings: { enabled?: boolean }) => Promise<void>
  updateDockerSocketSettings: (settings: { enabled?: boolean; path?: string }) => Promise<void>
  updateDockerSharedBuildCacheSettings: (settings: { enabled?: boolean }) => Promise<void>
  setRawSettings: (settings: unknown) => Promise<AppSettings>

  // Prompt management
  getCustomPrompts: () => Promise<{ orchestrator: string | null; planner: string | null; discussion: string | null; task: string | null; standalone_headless: string | null; standalone_followup: string | null; headless_discussion: string | null; critic: string | null; ralph_loop_discussion: string | null; manager: string | null; architect: string | null }>
  setCustomPrompt: (type: PromptType, template: string | null) => Promise<void>
  getDefaultPrompt: (type: PromptType) => Promise<string>

  // Playbox settings
  updatePlayboxSettings: (settings: { personaMode?: 'none' | 'bismarck' | 'otto' | 'custom'; customPersonaPrompt?: string | null }) => Promise<void>
  getPlayboxSettings: () => Promise<{ personaMode: 'none' | 'bismarck' | 'otto' | 'custom'; customPersonaPrompt: string | null }>

  // Debug settings
  getDebugSettings: () => Promise<{ enabled: boolean; logPath: string }>
  updateDebugSettings: (settings: { enabled?: boolean; logPath?: string }) => Promise<void>

  // Prevent sleep settings
  getPreventSleepSettings: () => Promise<{ enabled: boolean }>
  updatePreventSleepSettings: (settings: { enabled?: boolean }) => Promise<void>
  getPowerSaveState: () => Promise<{ enabled: boolean; active: boolean; reasons: string[] }>

  // Crash logging (for renderer process errors)
  reportRendererCrash: (error: { message: string; stack?: string; name?: string }, context?: { component?: string; operation?: string }) => Promise<void>

  // Auto-update management
  checkForUpdates: () => Promise<UpdateStatus>
  getUpdateStatus: () => Promise<UpdateStatus>
  getUpdateSettings: () => Promise<{ autoCheck: boolean }>
  setUpdateSettings: (settings: { autoCheck?: boolean }) => Promise<{ autoCheck: boolean }>
  getAppVersion: () => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => void | (() => void)
  removeUpdateStatusListener: () => void
  signalRendererReady?: () => void

  // Clipboard management
  copyToClipboard: (text: string) => Promise<void>

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

  // Ralph Loop events
  onRalphLoopUpdate: (callback: (state: RalphLoopState) => void) => void
  onRalphLoopEvent: (callback: (data: { loopId: string; iterationNumber: number; event: StreamEvent }) => void) => void
  onRalphLoopDiscussionComplete: (callback: (data: { referenceAgentId: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }) => void) => void

  // Discussion handoff events
  onDiscussionCompleting: (callback: (data: { discussionId: string; workspaceId: string; tabId: string; message: string }) => void) => void

  // Description generation progress events
  onDescriptionGenerationProgress: (callback: (event: DescriptionProgressEvent) => void) => void
  removeDescriptionGenerationProgressListener: () => void

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
  detectToolPaths?: () => Promise<{ bd: string | null; bb: string | null; gh: string | null; git: string | null }>
  getToolPaths?: () => Promise<{ bd: string | null; bb: string | null; gh: string | null; git: string | null }>
  updateToolPaths?: (paths: Partial<{ bd: string | null; bb: string | null; gh: string | null; git: string | null }>) => Promise<void>

  // Tray updates
  updateTray: (count: number) => void

  // Startup benchmark timing
  sendBenchmarkTiming?: (label: string, phase: string, startMs: number, durationMs: number) => void
  sendBenchmarkMilestone?: (name: string) => void

  // Cleanup
  removeAllListeners: () => void

  // Dev test harness (development mode only)
  devRunMockFlow?: (options?: { eventIntervalMs?: number; startDelayMs?: number }) => Promise<{ planId: string; planDir: string; tasks: Array<{ id: string; subject: string }> } | undefined>
  devStartMockAgent?: (taskId: string, planId?: string, worktreePath?: string, options?: { eventIntervalMs?: number }) => Promise<void>
  devStopMock?: () => Promise<void>
  devSetMockFlowOptions?: (options: { eventIntervalMs?: number; startDelayMs?: number }) => Promise<{ eventIntervalMs: number; startDelayMs: number }>
  devGetMockFlowOptions?: () => Promise<{ eventIntervalMs: number; startDelayMs: number }>
  devSetVersionOverride?: (version: string | null) => Promise<{ version: string }>
  devResetSettings?: () => Promise<void>
  devStartDebugLogTail?: (numInitialLines?: number) => Promise<{ logPath: string; initialContent: string }>
  devStopDebugLogTail?: () => Promise<void>
  onDebugLogLines?: (callback: (lines: string) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
