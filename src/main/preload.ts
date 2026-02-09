import { contextBridge, ipcRenderer } from 'electron'
import type { Workspace, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, Repository, HeadlessAgentInfo, StreamEvent, BranchStrategy, BeadTask, PromptType, DiscoveredRepo, PlanModeDependencies, RalphLoopConfig, RalphLoopState, DescriptionProgressEvent, DiffResult, FileDiffContent } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace management
  getWorkspaces: (): Promise<Workspace[]> =>
    ipcRenderer.invoke('get-workspaces'),
  saveWorkspace: (workspace: Workspace): Promise<Workspace> =>
    ipcRenderer.invoke('save-workspace', workspace),
  deleteWorkspace: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-workspace', id),
  reorderWorkspaces: (workspaceIds: string[]): Promise<void> =>
    ipcRenderer.invoke('reorder-workspaces', workspaceIds),

  // Terminal management
  createTerminal: (workspaceId: string): Promise<string> =>
    ipcRenderer.invoke('create-terminal', workspaceId),
  writeTerminal: (terminalId: string, data: string): Promise<void> =>
    ipcRenderer.invoke('write-terminal', terminalId, data),
  resizeTerminal: (
    terminalId: string,
    cols: number,
    rows: number
  ): Promise<void> =>
    ipcRenderer.invoke('resize-terminal', terminalId, cols, rows),
  closeTerminal: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('close-terminal', terminalId),
  stopWorkspace: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('stop-workspace', workspaceId),

  // Plain terminal management (non-agent shell terminals)
  createPlainTerminal: (directory: string): Promise<{ terminalId: string; tabId: string }> =>
    ipcRenderer.invoke('create-plain-terminal', directory),
  closePlainTerminal: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('close-plain-terminal', terminalId),

  // State management
  getState: (): Promise<AppState> => ipcRenderer.invoke('get-state'),
  setFocusedWorkspace: (workspaceId: string | undefined): Promise<void> =>
    ipcRenderer.invoke('set-focused-workspace', workspaceId),

  // Tab management
  createTab: (name?: string): Promise<AgentTab> =>
    ipcRenderer.invoke('create-tab', name),
  renameTab: (tabId: string, name: string): Promise<void> =>
    ipcRenderer.invoke('rename-tab', tabId, name),
  deleteTab: (
    tabId: string
  ): Promise<{ success: boolean; workspaceIds: string[] }> =>
    ipcRenderer.invoke('delete-tab', tabId),
  setActiveTab: (tabId: string): Promise<void> =>
    ipcRenderer.invoke('set-active-tab', tabId),
  getTabs: (): Promise<AgentTab[]> => ipcRenderer.invoke('get-tabs'),
  getTabPlanStatus: (tabId: string): Promise<{
    hasPlan: boolean
    planId?: string
    planTitle?: string
    planStatus?: string
    isInProgress: boolean
  }> => ipcRenderer.invoke('get-tab-plan-status', tabId),
  reorderTabs: (tabIds: string[]): Promise<boolean> =>
    ipcRenderer.invoke('reorder-tabs', tabIds),
  reorderWorkspaceInTab: (
    tabId: string,
    workspaceId: string,
    newPosition: number
  ): Promise<boolean> =>
    ipcRenderer.invoke('reorder-workspace-in-tab', tabId, workspaceId, newPosition),
  moveWorkspaceToTab: (
    workspaceId: string,
    targetTabId: string,
    position?: number
  ): Promise<boolean> =>
    ipcRenderer.invoke('move-workspace-to-tab', workspaceId, targetTabId, position),

  // Waiting queue management
  getWaitingQueue: (): Promise<string[]> =>
    ipcRenderer.invoke('get-waiting-queue'),
  acknowledgeWaiting: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('acknowledge-waiting', workspaceId),

  // Preferences management
  getPreferences: (): Promise<AppPreferences> =>
    ipcRenderer.invoke('get-preferences'),
  setPreferences: (preferences: Partial<AppPreferences>): Promise<AppPreferences> =>
    ipcRenderer.invoke('set-preferences', preferences),

  // Plan management (Team Mode)
  createPlan: (title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: BranchStrategy }): Promise<Plan> =>
    ipcRenderer.invoke('create-plan', title, description, options),
  getPlans: (): Promise<Plan[]> =>
    ipcRenderer.invoke('get-plans'),
  executePlan: (planId: string, referenceAgentId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('execute-plan', planId, referenceAgentId),
  startDiscussion: (planId: string, referenceAgentId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('start-discussion', planId, referenceAgentId),
  cancelDiscussion: (planId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('cancel-discussion', planId),
  cancelPlan: (planId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('cancel-plan', planId),
  restartPlan: (planId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('restart-plan', planId),
  completePlan: (planId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('complete-plan', planId),
  requestFollowUps: (planId: string): Promise<Plan | null> =>
    ipcRenderer.invoke('request-follow-ups', planId),
  getTaskAssignments: (planId: string): Promise<TaskAssignment[]> =>
    ipcRenderer.invoke('get-task-assignments', planId),
  getPlanActivities: (planId: string): Promise<PlanActivity[]> =>
    ipcRenderer.invoke('get-plan-activities', planId),
  getBeadTasks: (planId: string): Promise<BeadTask[]> =>
    ipcRenderer.invoke('get-bead-tasks', planId),
  setPlanSidebarOpen: (open: boolean): Promise<void> =>
    ipcRenderer.invoke('set-plan-sidebar-open', open),
  setActivePlanId: (planId: string | null): Promise<void> =>
    ipcRenderer.invoke('set-active-plan-id', planId),
  deletePlan: (planId: string): Promise<void> =>
    ipcRenderer.invoke('delete-plan', planId),
  deletePlans: (planIds: string[]): Promise<{ deleted: string[]; errors: Array<{ planId: string; error: string }> }> =>
    ipcRenderer.invoke('delete-plans', planIds),
  clonePlan: (planId: string, options?: { includeDiscussion?: boolean }): Promise<Plan> =>
    ipcRenderer.invoke('clone-plan', planId, options),

  // Headless agent management
  getHeadlessAgentInfo: (taskId: string): Promise<HeadlessAgentInfo | undefined> =>
    ipcRenderer.invoke('get-headless-agent-info', taskId),
  getHeadlessAgentsForPlan: (planId: string): Promise<HeadlessAgentInfo[]> =>
    ipcRenderer.invoke('get-headless-agents-for-plan', planId),
  stopHeadlessAgent: (taskId: string): Promise<void> =>
    ipcRenderer.invoke('stop-headless-agent', taskId),
  destroyHeadlessAgent: (taskId: string, isStandalone: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('destroy-headless-agent', taskId, isStandalone),

  // Standalone headless agent management
  startStandaloneHeadlessAgent: (agentId: string, prompt: string, model: 'opus' | 'sonnet', tabId?: string, options?: { planPhase?: boolean }): Promise<{ headlessId: string; workspaceId: string; tabId: string }> =>
    ipcRenderer.invoke('start-standalone-headless-agent', agentId, prompt, model, tabId, options),
  getStandaloneHeadlessAgents: (): Promise<HeadlessAgentInfo[]> =>
    ipcRenderer.invoke('get-standalone-headless-agents'),
  stopStandaloneHeadlessAgent: (headlessId: string): Promise<void> =>
    ipcRenderer.invoke('stop-standalone-headless-agent', headlessId),
  standaloneHeadlessConfirmDone: (headlessId: string): Promise<void> =>
    ipcRenderer.invoke('standalone-headless:confirm-done', headlessId),
  standaloneHeadlessStartFollowup: (headlessId: string, prompt: string, model?: 'opus' | 'sonnet'): Promise<{ headlessId: string; workspaceId: string }> =>
    ipcRenderer.invoke('standalone-headless:start-followup', headlessId, prompt, model),
  standaloneHeadlessRestart: (headlessId: string, model: 'opus' | 'sonnet'): Promise<{ headlessId: string; workspaceId: string }> =>
    ipcRenderer.invoke('standalone-headless:restart', headlessId, model),

  // Headless discussion (Discuss: Headless Agent)
  startHeadlessDiscussion: (agentId: string, initialPrompt: string): Promise<{ discussionId: string; workspaceId: string; tabId: string }> =>
    ipcRenderer.invoke('start-headless-discussion', agentId, initialPrompt),
  cancelHeadlessDiscussion: (discussionId: string): Promise<void> =>
    ipcRenderer.invoke('cancel-headless-discussion', discussionId),

  // Ralph Loop discussion (Discuss: Ralph Loop)
  startRalphLoopDiscussion: (agentId: string, initialPrompt: string): Promise<{ discussionId: string; workspaceId: string; tabId: string }> =>
    ipcRenderer.invoke('start-ralph-loop-discussion', agentId, initialPrompt),
  cancelRalphLoopDiscussion: (discussionId: string): Promise<void> =>
    ipcRenderer.invoke('cancel-ralph-loop-discussion', discussionId),

  // Ralph Loop management
  startRalphLoop: (config: RalphLoopConfig): Promise<RalphLoopState> =>
    ipcRenderer.invoke('start-ralph-loop', config),
  cancelRalphLoop: (loopId: string): Promise<void> =>
    ipcRenderer.invoke('cancel-ralph-loop', loopId),
  pauseRalphLoop: (loopId: string): Promise<void> =>
    ipcRenderer.invoke('pause-ralph-loop', loopId),
  resumeRalphLoop: (loopId: string): Promise<void> =>
    ipcRenderer.invoke('resume-ralph-loop', loopId),
  retryRalphLoop: (loopId: string): Promise<void> =>
    ipcRenderer.invoke('retry-ralph-loop', loopId),
  getRalphLoopState: (loopId: string): Promise<RalphLoopState | undefined> =>
    ipcRenderer.invoke('get-ralph-loop-state', loopId),
  getAllRalphLoops: (): Promise<RalphLoopState[]> =>
    ipcRenderer.invoke('get-all-ralph-loops'),
  cleanupRalphLoop: (loopId: string): Promise<void> =>
    ipcRenderer.invoke('cleanup-ralph-loop', loopId),

  // OAuth token management
  getOAuthToken: (): Promise<string | null> =>
    ipcRenderer.invoke('get-oauth-token'),
  setOAuthToken: (token: string): Promise<boolean> =>
    ipcRenderer.invoke('set-oauth-token', token),
  hasOAuthToken: (): Promise<boolean> =>
    ipcRenderer.invoke('has-oauth-token'),
  runOAuthSetup: (): Promise<string> =>
    ipcRenderer.invoke('run-oauth-setup'),
  clearOAuthToken: (): Promise<boolean> =>
    ipcRenderer.invoke('clear-oauth-token'),

  // Terminal events - use removeAllListeners before adding to prevent duplicates
  onTerminalData: (
    callback: (terminalId: string, data: string) => void
  ): void => {
    ipcRenderer.removeAllListeners('terminal-data')
    ipcRenderer.on('terminal-data', (_event, terminalId, data) =>
      callback(terminalId, data)
    )
  },
  onTerminalExit: (
    callback: (terminalId: string, code: number) => void
  ): void => {
    ipcRenderer.removeAllListeners('terminal-exit')
    ipcRenderer.on('terminal-exit', (_event, terminalId, code) =>
      callback(terminalId, code)
    )
  },

  // Agent waiting events
  onAgentWaiting: (callback: (workspaceId: string) => void): void => {
    ipcRenderer.on('agent-waiting', (_event, workspaceId) =>
      callback(workspaceId)
    )
  },
  onFocusWorkspace: (callback: (workspaceId: string) => void): void => {
    ipcRenderer.on('focus-workspace', (_event, workspaceId) =>
      callback(workspaceId)
    )
  },
  onMaximizeWorkspace: (callback: (workspaceId: string) => void): void => {
    ipcRenderer.on('maximize-workspace', (_event, workspaceId) =>
      callback(workspaceId)
    )
  },
  onWaitingQueueChanged: (callback: (queue: string[]) => void): void => {
    ipcRenderer.on('waiting-queue-changed', (_event, queue) => callback(queue))
  },
  onInitialState: (callback: (state: AppState) => void): void => {
    ipcRenderer.on('initial-state', (_event, state) => callback(state))
  },

  // Plan events (Team Mode)
  onPlanUpdate: (callback: (plan: Plan) => void): void => {
    ipcRenderer.on('plan-update', (_event, plan) => callback(plan))
  },
  onPlanDeleted: (callback: (planId: string) => void): void => {
    ipcRenderer.on('plan-deleted', (_event, planId) => callback(planId))
  },
  onTaskAssignmentUpdate: (callback: (assignment: TaskAssignment) => void): void => {
    ipcRenderer.on('task-assignment-update', (_event, assignment) => callback(assignment))
  },
  onPlanActivity: (callback: (activity: PlanActivity) => void): void => {
    ipcRenderer.on('plan-activity', (_event, activity) => callback(activity))
  },
  onStateUpdate: (callback: (state: AppState) => void): void => {
    ipcRenderer.on('state-update', (_event, state) => callback(state))
  },
  onTerminalCreated: (callback: (data: { terminalId: string; workspaceId: string }) => void): void => {
    ipcRenderer.on('terminal-created', (_event, data) => callback(data))
  },

  // Headless agent events
  onHeadlessAgentStarted: (callback: (data: { taskId: string; planId: string; worktreePath: string }) => void): void => {
    ipcRenderer.on('headless-agent-started', (_event, data) => callback(data))
  },
  onHeadlessAgentUpdate: (callback: (info: HeadlessAgentInfo) => void): void => {
    ipcRenderer.on('headless-agent-update', (_event, info) => callback(info))
  },
  onHeadlessAgentEvent: (callback: (data: { planId: string; taskId: string; event: StreamEvent }) => void): void => {
    ipcRenderer.on('headless-agent-event', (_event, data) => callback(data))
  },

  // Ralph Loop events
  onRalphLoopUpdate: (callback: (state: RalphLoopState) => void): void => {
    ipcRenderer.on('ralph-loop-update', (_event, state) => callback(state))
  },
  onRalphLoopEvent: (callback: (data: { loopId: string; iterationNumber: number; event: StreamEvent }) => void): void => {
    ipcRenderer.on('ralph-loop-event', (_event, data) => callback(data))
  },
  onRalphLoopDiscussionComplete: (callback: (data: {
    referenceAgentId: string
    prompt: string
    completionPhrase: string
    maxIterations: number
    model: 'opus' | 'sonnet'
  }) => void): void => {
    ipcRenderer.on('ralph-loop-discussion-complete', (_event, data) => callback(data))
  },
  onDiscussionCompleting: (callback: (data: {
    discussionId: string
    workspaceId: string
    tabId: string
    message: string
  }) => void): void => {
    ipcRenderer.on('discussion-completing', (_event, data) => callback(data))
  },

  // Description generation progress events
  onDescriptionGenerationProgress: (callback: (event: DescriptionProgressEvent) => void): void => {
    ipcRenderer.on('description-generation-progress', (_event, progress) => callback(progress))
  },
  removeDescriptionGenerationProgressListener: (): void => {
    ipcRenderer.removeAllListeners('description-generation-progress')
  },

  // Bead task events
  onBeadTasksUpdated: (callback: (planId: string) => void): void => {
    ipcRenderer.on('bead-tasks-updated', (_event, planId) => callback(planId))
  },

  // Terminal queue status
  onTerminalQueueStatus: (callback: (status: { queued: number; active: number; pending: string[] }) => void): void => {
    ipcRenderer.on('terminal-queue-status', (_event, status) => callback(status))
  },

  // Git repository management
  detectGitRepository: (directory: string): Promise<Repository | null> =>
    ipcRenderer.invoke('detect-git-repository', directory),
  getRepositories: (): Promise<Repository[]> =>
    ipcRenderer.invoke('get-repositories'),
  updateRepository: (id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'>>): Promise<Repository | undefined> =>
    ipcRenderer.invoke('update-repository', id, updates),
  addRepository: (path: string): Promise<Repository | null> =>
    ipcRenderer.invoke('add-repository', path),
  removeRepository: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('remove-repository', id),

  // Git diff operations
  getChangedFiles: (directory: string): Promise<DiffResult> =>
    ipcRenderer.invoke('get-changed-files', directory),
  getFileDiff: (directory: string, filepath: string, force?: boolean): Promise<FileDiffContent> =>
    ipcRenderer.invoke('get-file-diff', directory, filepath, force),
  isGitRepo: (directory: string): Promise<boolean> =>
    ipcRenderer.invoke('is-git-repo', directory),
  revertFile: (directory: string, filepath: string): Promise<void> =>
    ipcRenderer.invoke('revert-file', directory, filepath),
  writeFileContent: (directory: string, filepath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file-content', directory, filepath, content),
  revertAllFiles: (directory: string): Promise<void> =>
    ipcRenderer.invoke('revert-all-files', directory),

  // Setup wizard
  setupWizardShowFolderPicker: (): Promise<string | null> =>
    ipcRenderer.invoke('setup-wizard:show-folder-picker'),
  setupWizardGetCommonRepoPaths: (): Promise<string[]> =>
    ipcRenderer.invoke('setup-wizard:get-common-repo-paths'),
  setupWizardScanForRepositories: (parentPath: string, depth?: number): Promise<DiscoveredRepo[]> =>
    ipcRenderer.invoke('setup-wizard:scan-for-repositories', parentPath, depth),
  setupWizardBulkCreateAgents: (repos: (DiscoveredRepo & { purpose?: string; completionCriteria?: string; protectedBranches?: string[] })[]): Promise<Workspace[]> =>
    ipcRenderer.invoke('setup-wizard:bulk-create-agents', repos),
  setupWizardSaveDefaultReposPath: (reposPath: string): Promise<void> =>
    ipcRenderer.invoke('setup-wizard:save-default-repos-path', reposPath),
  setupWizardGetDefaultReposPath: (): Promise<string | null> =>
    ipcRenderer.invoke('setup-wizard:get-default-repos-path'),
  setupWizardGenerateDescriptions: (repos: DiscoveredRepo[]): Promise<Array<{ repoPath: string; purpose: string; completionCriteria: string; protectedBranches: string[]; error?: string }>> =>
    ipcRenderer.invoke('setup-wizard:generate-descriptions', repos),
  setupWizardCheckPlanModeDeps: (): Promise<PlanModeDependencies> =>
    ipcRenderer.invoke('setup-wizard:check-plan-mode-deps'),
  setupWizardEnablePlanMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('setup-wizard:enable-plan-mode', enabled),
  setupWizardDetectAndSaveGitHubToken: (): Promise<{ success: boolean; source: string | null }> =>
    ipcRenderer.invoke('setup-wizard:detect-and-save-github-token'),
  setupWizardGroupAgentsIntoTabs: (agents: Workspace[]): Promise<AgentTab[]> =>
    ipcRenderer.invoke('setup-wizard:group-agents-into-tabs', agents),

  // Setup wizard terminal for "Fix with Claude" feature
  setupWizardCreateFixTerminal: (): Promise<string> =>
    ipcRenderer.invoke('setup-wizard:create-fix-terminal'),
  setupWizardWriteFixTerminal: (terminalId: string, data: string): Promise<void> =>
    ipcRenderer.invoke('setup-wizard:write-fix-terminal', terminalId, data),
  setupWizardResizeFixTerminal: (terminalId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('setup-wizard:resize-fix-terminal', terminalId, cols, rows),
  setupWizardCloseFixTerminal: (terminalId: string): Promise<void> =>
    ipcRenderer.invoke('setup-wizard:close-fix-terminal', terminalId),
  onSetupTerminalData: (callback: (terminalId: string, data: string) => void): void => {
    ipcRenderer.removeAllListeners('setup-terminal-data')
    ipcRenderer.on('setup-terminal-data', (_event, terminalId, data) =>
      callback(terminalId, data)
    )
  },
  onSetupTerminalExit: (callback: (terminalId: string, code: number) => void): void => {
    ipcRenderer.removeAllListeners('setup-terminal-exit')
    ipcRenderer.on('setup-terminal-exit', (_event, terminalId, code) =>
      callback(terminalId, code)
    )
  },
  removeSetupTerminalListeners: (): void => {
    ipcRenderer.removeAllListeners('setup-terminal-data')
    ipcRenderer.removeAllListeners('setup-terminal-exit')
  },

  // Docker image pull
  setupWizardPullDockerImage: (): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('setup-wizard:pull-docker-image'),
  onDockerPullProgress: (callback: (message: string) => void): void => {
    ipcRenderer.removeAllListeners('docker-pull-progress')
    ipcRenderer.on('docker-pull-progress', (_event, message) => callback(message))
  },
  removeDockerPullProgressListener: (): void => {
    ipcRenderer.removeAllListeners('docker-pull-progress')
  },

  // Docker image status
  checkDockerImageStatus: (imageName: string): Promise<{ dockerAvailable: boolean; exists: boolean; imageId?: string; created?: string; size?: number }> =>
    ipcRenderer.invoke('check-docker-image-status', imageName),
  pullDockerImage: (imageName: string): Promise<{ success: boolean; output: string; alreadyUpToDate: boolean }> =>
    ipcRenderer.invoke('pull-docker-image', imageName),

  // GitHub token management
  hasGitHubToken: (): Promise<boolean> =>
    ipcRenderer.invoke('has-github-token'),
  setGitHubToken: (token: string): Promise<boolean> =>
    ipcRenderer.invoke('set-github-token', token),
  clearGitHubToken: (): Promise<boolean> =>
    ipcRenderer.invoke('clear-github-token'),
  checkGitHubTokenScopes: (): Promise<{ valid: boolean; scopes: string[]; missingScopes: string[]; ssoConfigured: boolean | null; error?: string }> =>
    ipcRenderer.invoke('check-github-token-scopes'),

  // Settings management
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateDockerResourceLimits: (limits: { cpu?: string; memory?: string }) =>
    ipcRenderer.invoke('update-docker-resource-limits', limits),
  addDockerImage: (image: string) =>
    ipcRenderer.invoke('add-docker-image', image),
  removeDockerImage: (image: string) =>
    ipcRenderer.invoke('remove-docker-image', image),
  setSelectedDockerImage: (image: string) =>
    ipcRenderer.invoke('set-selected-docker-image', image),
  updateToolPaths: (paths: { bd?: string | null; bb?: string | null; gh?: string | null; git?: string | null }) =>
    ipcRenderer.invoke('update-tool-paths', paths),
  detectToolPaths: () =>
    ipcRenderer.invoke('detect-tool-paths'),
  toggleProxiedTool: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-proxied-tool', id, enabled),
  getToolAuthStatuses: () =>
    ipcRenderer.invoke('get-tool-auth-statuses'),
  checkToolAuth: () =>
    ipcRenderer.invoke('check-tool-auth'),
  runToolReauth: (toolId: string) =>
    ipcRenderer.invoke('run-tool-reauth', toolId),
  onToolAuthStatus: (callback: (statuses: Array<{ toolId: string; toolName: string; state: string; reauthHint?: string; message?: string }>) => void): void => {
    ipcRenderer.removeAllListeners('tool-auth-status')
    ipcRenderer.on('tool-auth-status', (_event, statuses) => callback(statuses))
  },
  removeToolAuthStatusListener: (): void => {
    ipcRenderer.removeAllListeners('tool-auth-status')
  },
  updateDockerSshSettings: (settings: { enabled?: boolean }) =>
    ipcRenderer.invoke('update-docker-ssh-settings', settings),
  updateDockerSocketSettings: (settings: { enabled?: boolean; path?: string }) =>
    ipcRenderer.invoke('update-docker-socket-settings', settings),
  updateDockerSharedBuildCacheSettings: (settings: { enabled?: boolean }) =>
    ipcRenderer.invoke('update-docker-shared-build-cache-settings', settings),
  setRawSettings: (settings: unknown) =>
    ipcRenderer.invoke('set-raw-settings', settings),

  // Prompt management
  getCustomPrompts: (): Promise<{ orchestrator: string | null; planner: string | null; discussion: string | null; task: string | null; standalone_headless: string | null; standalone_followup: string | null; headless_discussion: string | null; critic: string | null }> =>
    ipcRenderer.invoke('get-custom-prompts'),
  setCustomPrompt: (type: PromptType, template: string | null): Promise<void> =>
    ipcRenderer.invoke('set-custom-prompt', type, template),
  getDefaultPrompt: (type: PromptType): Promise<string> =>
    ipcRenderer.invoke('get-default-prompt', type),

  // Playbox settings
  updatePlayboxSettings: (settings: { personaMode?: 'none' | 'bismarck' | 'otto' | 'custom'; customPersonaPrompt?: string | null }): Promise<void> =>
    ipcRenderer.invoke('update-playbox-settings', settings),
  getPlayboxSettings: (): Promise<{ personaMode: 'none' | 'bismarck' | 'otto' | 'custom'; customPersonaPrompt: string | null }> =>
    ipcRenderer.invoke('get-playbox-settings'),

  // Ralph Loop preset management
  getRalphLoopPresets: (): Promise<Array<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }>> =>
    ipcRenderer.invoke('get-ralph-loop-presets'),
  addRalphLoopPreset: (preset: { label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }): Promise<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }> =>
    ipcRenderer.invoke('add-ralph-loop-preset', preset),
  updateRalphLoopPreset: (id: string, updates: { label?: string; description?: string; prompt?: string; completionPhrase?: string; maxIterations?: number; model?: 'opus' | 'sonnet' }): Promise<{ id: string; label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' } | undefined> =>
    ipcRenderer.invoke('update-ralph-loop-preset', id, updates),
  deleteRalphLoopPreset: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-ralph-loop-preset', id),

  // Debug settings
  getDebugSettings: (): Promise<{ enabled: boolean; logPath: string }> =>
    ipcRenderer.invoke('get-debug-settings'),
  updateDebugSettings: (settings: { enabled?: boolean; logPath?: string }): Promise<void> =>
    ipcRenderer.invoke('update-debug-settings', settings),

  // Prevent sleep settings
  getPreventSleepSettings: (): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke('get-prevent-sleep-settings'),
  updatePreventSleepSettings: (settings: { enabled?: boolean }): Promise<void> =>
    ipcRenderer.invoke('update-prevent-sleep-settings', settings),
  getPowerSaveState: (): Promise<{ enabled: boolean; active: boolean; reasons: string[] }> =>
    ipcRenderer.invoke('get-power-save-state'),

  // Crash logging (for renderer process errors)
  reportRendererCrash: (error: { message: string; stack?: string; name?: string }, context?: { component?: string; operation?: string }): Promise<void> =>
    ipcRenderer.invoke('report-renderer-crash', error, context),

  // Auto-update management
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  getUpdateSettings: () => ipcRenderer.invoke('get-update-settings'),
  setUpdateSettings: (settings: { autoCheck?: boolean }) =>
    ipcRenderer.invoke('set-update-settings', settings),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateStatus: (callback: (status: { state: string; version?: string; releaseUrl?: string; message?: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { state: string; version?: string; releaseUrl?: string; message?: string }) => callback(status)
    ipcRenderer.on('update-status', handler)
    // Return an unsubscribe function for this specific listener
    return () => {
      ipcRenderer.removeListener('update-status', handler)
    }
  },
  removeUpdateStatusListener: (): void => {
    ipcRenderer.removeAllListeners('update-status')
  },
  signalRendererReady: (): void => {
    ipcRenderer.send('renderer-ready')
  },

  // Clipboard management
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),

  // External URL handling
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // Open Docker Desktop
  openDockerDesktop: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-docker-desktop'),

  // File reading
  readFile: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> =>
    ipcRenderer.invoke('read-file', filePath),

  // Tray updates
  updateTray: (count: number): void => {
    ipcRenderer.send('update-tray', count)
  },

  // Startup benchmark timing (for renderer → main communication)
  sendBenchmarkTiming: (label: string, phase: string, startMs: number, durationMs: number): void => {
    ipcRenderer.send('benchmark-timing', { label, phase, startMs, durationMs })
  },
  sendBenchmarkMilestone: (name: string): void => {
    ipcRenderer.send('benchmark-milestone', { name })
  },

  // Cleanup
  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners('terminal-data')
    ipcRenderer.removeAllListeners('terminal-exit')
    ipcRenderer.removeAllListeners('agent-waiting')
    ipcRenderer.removeAllListeners('focus-workspace')
    ipcRenderer.removeAllListeners('maximize-workspace')
    ipcRenderer.removeAllListeners('waiting-queue-changed')
    ipcRenderer.removeAllListeners('initial-state')
    ipcRenderer.removeAllListeners('plan-update')
    ipcRenderer.removeAllListeners('plan-deleted')
    ipcRenderer.removeAllListeners('task-assignment-update')
    ipcRenderer.removeAllListeners('plan-activity')
    ipcRenderer.removeAllListeners('state-update')
    ipcRenderer.removeAllListeners('terminal-created')
    ipcRenderer.removeAllListeners('headless-agent-started')
    ipcRenderer.removeAllListeners('headless-agent-update')
    ipcRenderer.removeAllListeners('headless-agent-event')
    ipcRenderer.removeAllListeners('terminal-queue-status')
    ipcRenderer.removeAllListeners('bead-tasks-updated')
    ipcRenderer.removeAllListeners('ralph-loop-update')
    ipcRenderer.removeAllListeners('ralph-loop-event')
    ipcRenderer.removeAllListeners('description-generation-progress')
    ipcRenderer.removeAllListeners('setup-terminal-data')
    ipcRenderer.removeAllListeners('setup-terminal-exit')
    ipcRenderer.removeAllListeners('update-status')
    ipcRenderer.removeAllListeners('docker-pull-progress')
    ipcRenderer.removeAllListeners('tool-auth-status')
    ipcRenderer.removeAllListeners('debug-log-lines')
  },

  // Dev test harness (development mode only)
  devRunMockFlow: (options?: { eventIntervalMs?: number; startDelayMs?: number }): Promise<{ planId: string; planDir: string; tasks: Array<{ id: string; subject: string }> } | undefined> =>
    ipcRenderer.invoke('dev-run-mock-flow', options),
  devStartMockAgent: (taskId: string, planId?: string, worktreePath?: string, options?: { eventIntervalMs?: number }): Promise<void> =>
    ipcRenderer.invoke('dev-start-mock-agent', taskId, planId, worktreePath, options),
  devStopMock: (): Promise<void> =>
    ipcRenderer.invoke('dev-stop-mock'),
  devSetMockFlowOptions: (options: { eventIntervalMs?: number; startDelayMs?: number }): Promise<{ eventIntervalMs: number; startDelayMs: number }> =>
    ipcRenderer.invoke('dev-set-mock-flow-options', options),
  devGetMockFlowOptions: (): Promise<{ eventIntervalMs: number; startDelayMs: number }> =>
    ipcRenderer.invoke('dev-get-mock-flow-options'),
  devSetVersionOverride: (version: string | null): Promise<{ version: string }> =>
    ipcRenderer.invoke('dev-set-version-override', version),
  devResetSettings: (): Promise<void> =>
    ipcRenderer.invoke('dev-reset-settings'),
  devStartDebugLogTail: (numInitialLines?: number): Promise<{ logPath: string; initialContent: string }> =>
    ipcRenderer.invoke('dev-start-debug-log-tail', numInitialLines),
  devStopDebugLogTail: (): Promise<void> =>
    ipcRenderer.invoke('dev-stop-debug-log-tail'),
  onDebugLogLines: (callback: (lines: string) => void) => {
    ipcRenderer.on('debug-log-lines', (_event, lines: string) => callback(lines))
  },
})
