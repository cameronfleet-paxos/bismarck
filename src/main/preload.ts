import { contextBridge, ipcRenderer } from 'electron'
import type { Workspace, AppState, AgentTab, AppPreferences, Plan, TaskAssignment, PlanActivity, Repository, HeadlessAgentInfo, StreamEvent, BranchStrategy, BeadTask, PromptType } from '../shared/types'

contextBridge.exposeInMainWorld('electronAPI', {
  // Workspace management
  getWorkspaces: (): Promise<Workspace[]> =>
    ipcRenderer.invoke('get-workspaces'),
  saveWorkspace: (workspace: Workspace): Promise<Workspace> =>
    ipcRenderer.invoke('save-workspace', workspace),
  deleteWorkspace: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-workspace', id),

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
  updateRepository: (id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches'>>): Promise<Repository | undefined> =>
    ipcRenderer.invoke('update-repository', id, updates),

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
  updateToolPaths: (paths: { bd?: string | null; gh?: string | null; git?: string | null }) =>
    ipcRenderer.invoke('update-tool-paths', paths),
  detectToolPaths: () =>
    ipcRenderer.invoke('detect-tool-paths'),
  addProxiedTool: (tool: { name: string; hostPath: string; description?: string }) =>
    ipcRenderer.invoke('add-proxied-tool', tool),
  removeProxiedTool: (id: string) =>
    ipcRenderer.invoke('remove-proxied-tool', id),
  updateDockerSshSettings: (settings: { enabled?: boolean }) =>
    ipcRenderer.invoke('update-docker-ssh-settings', settings),
  setRawSettings: (settings: unknown) =>
    ipcRenderer.invoke('set-raw-settings', settings),

  // Prompt management
  getCustomPrompts: (): Promise<{ orchestrator: string | null; planner: string | null; discussion: string | null }> =>
    ipcRenderer.invoke('get-custom-prompts'),
  setCustomPrompt: (type: PromptType, template: string | null): Promise<void> =>
    ipcRenderer.invoke('set-custom-prompt', type, template),
  getDefaultPrompt: (type: PromptType): Promise<string> =>
    ipcRenderer.invoke('get-default-prompt', type),

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
})
