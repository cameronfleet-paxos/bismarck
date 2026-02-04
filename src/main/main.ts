import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import {
  ensureConfigDirExists,
  getWorkspaces,
  saveWorkspace,
  deleteWorkspace,
  reorderWorkspaces,
  getClaudeOAuthToken,
  setClaudeOAuthToken,
  clearClaudeOAuthToken,
  loadPlans,
} from './config'
import { runSetupToken } from './oauth-setup'
import {
  writeTerminal,
  resizeTerminal,
  closeTerminal,
  closeAllTerminals,
  getTerminalForWorkspace,
  createSetupTerminal,
  writeSetupTerminal,
  resizeSetupTerminal,
  closeSetupTerminal,
} from './terminal'
import {
  queueTerminalCreationWithSetup,
  setQueueMainWindow,
  clearQueue,
} from './terminal-queue'
import { cleanupOrphanedProcesses } from './process-cleanup'
import {
  createSocketServer,
  closeSocketServer,
  closeAllSocketServers,
  setMainWindow,
  getWaitingQueue,
  removeFromWaitingQueue,
  setInstanceId,
} from './socket-server'
import { configureClaudeHook, createHookScript } from './hook-manager'
import { createTray, updateTray, destroyTray } from './tray'
import {
  initializeState,
  getState,
  addActiveWorkspace,
  removeActiveWorkspace,
  setFocusedWorkspace,
  createTab,
  renameTab,
  deleteTab,
  setActiveTab,
  addWorkspaceToTab,
  removeWorkspaceFromTab,
  getOrCreateTabForWorkspace,
  getPreferences,
  setPreferences,
  reorderWorkspaceInTab,
  moveWorkspaceToTab,
  getTabs,
  setPlanSidebarOpen,
  setActivePlanId,
} from './state-manager'
import {
  createPlan,
  getPlans,
  deletePlanById,
  deletePlansById,
  clonePlan,
  executePlan,
  cancelPlan,
  restartPlan,
  getTaskAssignments,
  getPlanActivities,
  setPlanManagerWindow,
  startTaskPolling,
  stopTaskPolling,
  completePlan,
  cleanupPlanManager,
  setHeadlessMode,
  isHeadlessModeEnabled,
  checkHeadlessModeAvailable,
  getHeadlessAgentInfo,
  getHeadlessAgentInfoForPlan,
  stopHeadlessTaskAgent,
  destroyHeadlessAgent,
  startDiscussion,
  cancelDiscussion,
  requestFollowUps,
} from './plan-manager'
import {
  detectRepository,
  getAllRepositories,
  updateRepository,
  removeRepository,
} from './repository-manager'
import {
  showFolderPicker,
  getCommonRepoPaths,
  scanForRepositories,
  bulkCreateAgents,
  saveDefaultReposPath,
  getDefaultReposPath,
  checkPlanModeDependencies,
  enablePlanMode,
  detectAndSaveGitHubToken,
  generateInstallationPrompt,
} from './setup-wizard'
import { generateDescriptions } from './description-generator'
import { groupAgentsIntoTabs } from './repo-grouper'
import {
  getSettings,
  saveSettings,
  updateDockerResourceLimits,
  addDockerImage,
  removeDockerImage,
  setSelectedDockerImage,
  updateToolPaths,
  addProxiedTool,
  removeProxiedTool,
  updateDockerSshSettings,
  updateDockerSocketSettings,
  getCustomPrompts,
  setCustomPrompt,
  hasGitHubToken,
  setGitHubToken,
  updatePlayboxSettings,
  loadSettings,
} from './settings-manager'
import { getDefaultPrompt } from './prompt-templates'
import { bdList } from './bd-client'
import {
  startStandaloneHeadlessAgent,
  getStandaloneHeadlessAgents,
  stopStandaloneHeadlessAgent,
  setMainWindowForStandaloneHeadless,
  initStandaloneHeadless,
  confirmStandaloneAgentDone,
  startFollowUpAgent,
  cleanupStandaloneWorktree,
  restartStandaloneHeadlessAgent,
} from './standalone-headless'
import {
  startRalphLoop,
  cancelRalphLoop,
  pauseRalphLoop,
  resumeRalphLoop,
  getRalphLoopState,
  getAllRalphLoops,
  cleanupRalphLoop,
  setMainWindowForRalphLoop,
  initRalphLoop,
} from './ralph-loop'
import { initializeDockerEnvironment } from './docker-sandbox'
import {
  setDevHarnessWindow,
  runMockFlow,
  startMockAgent,
  stopMockFlow,
  getMockAgentInfo,
  getMockAgentsForPlan,
  cleanupDevHarness,
  setMockFlowOptions,
  getMockFlowOptions,
  type MockFlowOptions,
} from './dev-test-harness'
import type { Workspace, AppPreferences, Repository, DiscoveredRepo, RalphLoopConfig } from '../shared/types'
import type { AppSettings } from './settings-manager'

// Generate unique instance ID for socket isolation
const instanceId = randomUUID()

// Signal handlers for graceful shutdown on crash
process.on('uncaughtException', async (error) => {
  console.error('[Main] Uncaught exception:', error)
  try {
    clearQueue()
    closeAllTerminals()
    closeAllSocketServers()
    await cleanupPlanManager()
    await cleanupDevHarness()
  } catch (cleanupError) {
    console.error('[Main] Cleanup error during crash:', cleanupError)
  }
  process.exit(1)
})

process.on('unhandledRejection', async (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason)
  // Don't exit for unhandled rejections, just log them
})

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  // Bring app to foreground on macOS (skip in dev mode to avoid stealing focus)
  if (process.env.NODE_ENV !== 'development') {
    app.focus({ steal: true })
    mainWindow.focus()
  }

  // Set the main window reference for socket server, plan manager, dev harness, queue, standalone headless, and ralph loop
  setMainWindow(mainWindow)
  setPlanManagerWindow(mainWindow)
  setDevHarnessWindow(mainWindow)
  setQueueMainWindow(mainWindow)
  setMainWindowForStandaloneHeadless(mainWindow)
  setMainWindowForRalphLoop(mainWindow)

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
    setPlanManagerWindow(null)
    setDevHarnessWindow(null)
    setQueueMainWindow(null)
  })

  // Create system tray
  createTray(mainWindow)

  // Listen for waiting count changes to update tray
  mainWindow.webContents.on('did-finish-load', () => {
    // Send initial state to renderer
    const state = getState()
    mainWindow?.webContents.send('initial-state', state)
  })
}

// Register IPC handlers
function registerIpcHandlers() {
  // Workspace management
  ipcMain.handle('get-workspaces', () => {
    return getWorkspaces()
  })

  ipcMain.handle('save-workspace', (_event, workspace: Workspace) => {
    return saveWorkspace(workspace)
  })

  ipcMain.handle('delete-workspace', async (_event, id: string) => {
    const workspace = getWorkspaces().find(w => w.id === id)

    // Clean up headless agent worktrees and branches
    if (workspace?.isHeadless && workspace.taskId) {
      if (workspace.isStandaloneHeadless) {
        // Standalone headless agent cleanup
        await cleanupStandaloneWorktree(workspace.taskId)
      } else {
        // Plan-based headless agent cleanup
        await destroyHeadlessAgent(workspace.taskId, false)
      }
    }

    // Close terminal first to ensure PTY process is killed
    const terminalId = getTerminalForWorkspace(id)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeWorkspaceFromTab(id)
    deleteWorkspace(id)
    removeActiveWorkspace(id)
    closeSocketServer(id)
  })

  ipcMain.handle('reorder-workspaces', (_event, workspaceIds: string[]) => {
    reorderWorkspaces(workspaceIds)
  })

  // Terminal management
  ipcMain.handle('create-terminal', async (_event, workspaceId: string) => {
    // Use the queue for terminal creation with full setup
    return queueTerminalCreationWithSetup(workspaceId, mainWindow)
  })

  ipcMain.handle('write-terminal', (_event, terminalId: string, data: string) => {
    writeTerminal(terminalId, data)
  })

  ipcMain.handle(
    'resize-terminal',
    (_event, terminalId: string, cols: number, rows: number) => {
      resizeTerminal(terminalId, cols, rows)
    }
  )

  ipcMain.handle('close-terminal', (_event, terminalId: string) => {
    closeTerminal(terminalId)
  })

  // State management
  ipcMain.handle('get-state', () => {
    return getState()
  })

  ipcMain.handle('set-focused-workspace', (_event, workspaceId: string | undefined) => {
    setFocusedWorkspace(workspaceId)
  })

  ipcMain.handle('maximize-workspace', (_event, workspaceId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('maximize-workspace', workspaceId)
    }
  })

  ipcMain.handle('stop-workspace', (_event, workspaceId: string) => {
    // Close terminal first to ensure PTY process is killed
    const terminalId = getTerminalForWorkspace(workspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeWorkspaceFromTab(workspaceId)
    removeActiveWorkspace(workspaceId)
    closeSocketServer(workspaceId)
  })

  // Tab management
  ipcMain.handle('create-tab', (_event, name?: string) => {
    return createTab(name)
  })

  ipcMain.handle('rename-tab', (_event, tabId: string, name: string) => {
    renameTab(tabId, name)
  })

  ipcMain.handle('delete-tab', (_event, tabId: string) => {
    const tab = getState().tabs.find((t) => t.id === tabId)
    if (tab) {
      // Return workspace IDs that need to be stopped
      const workspaceIds = [...tab.workspaceIds]
      const success = deleteTab(tabId)
      return { success, workspaceIds }
    }
    return { success: false, workspaceIds: [] }
  })

  ipcMain.handle('set-active-tab', (_event, tabId: string) => {
    setActiveTab(tabId)
  })

  ipcMain.handle('get-tabs', () => {
    return getTabs()
  })

  ipcMain.handle(
    'reorder-workspace-in-tab',
    (_event, tabId: string, workspaceId: string, newPosition: number) => {
      return reorderWorkspaceInTab(tabId, workspaceId, newPosition)
    }
  )

  ipcMain.handle(
    'move-workspace-to-tab',
    (_event, workspaceId: string, targetTabId: string, position?: number) => {
      return moveWorkspaceToTab(workspaceId, targetTabId, position)
    }
  )

  // Waiting queue management
  ipcMain.handle('get-waiting-queue', () => {
    return getWaitingQueue()
  })

  ipcMain.handle('acknowledge-waiting', (_event, workspaceId: string) => {
    removeFromWaitingQueue(workspaceId)
    updateTray(getWaitingQueue().length)
  })

  // Update tray when waiting count changes
  ipcMain.on('update-tray', (_event, count: number) => {
    updateTray(count)
  })

  // Preferences management
  ipcMain.handle('get-preferences', () => {
    return getPreferences()
  })

  ipcMain.handle('set-preferences', (_event, preferences: Partial<AppPreferences>) => {
    const updated = setPreferences(preferences)
    // Start/stop task polling based on operating mode
    if (preferences.operatingMode === 'team') {
      // Find active plan to resume polling for
      const plans = loadPlans()
      const activePlan = plans.find(p => p.status === 'delegating' || p.status === 'in_progress')
      if (activePlan) {
        startTaskPolling(activePlan.id)
      }
    } else if (preferences.operatingMode === 'solo') {
      stopTaskPolling()
    }
    return updated
  })

  // Settings management (Tool Paths)
  ipcMain.handle('detect-tool-paths', async () => {
    const { detectToolPaths } = await import('./settings-manager')
    return detectToolPaths()
  })

  ipcMain.handle('get-tool-paths', async () => {
    const { getToolPaths } = await import('./settings-manager')
    return getToolPaths()
  })

  ipcMain.handle('update-tool-paths', async (_event, paths: Partial<AppSettings['paths']>) => {
    const { updateToolPaths } = await import('./settings-manager')
    await updateToolPaths(paths)
  })

  // Plan management (Team Mode)
  ipcMain.handle('create-plan', async (_event, title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: 'feature_branch' | 'raise_prs' }) => {
    return await createPlan(title, description, options)
  })

  ipcMain.handle('get-plans', () => {
    return getPlans()
  })

  ipcMain.handle('execute-plan', async (_event, planId: string, referenceAgentId: string) => {
    console.log('[Main] execute-plan IPC received:', { planId, referenceAgentId })
    const result = await executePlan(planId, referenceAgentId)
    console.log('[Main] execute-plan result:', result?.status)
    return result
  })

  ipcMain.handle('start-discussion', async (_event, planId: string, referenceAgentId: string) => {
    return startDiscussion(planId, referenceAgentId)
  })

  ipcMain.handle('cancel-discussion', async (_event, planId: string) => {
    return cancelDiscussion(planId)
  })

  ipcMain.handle('cancel-plan', async (_event, planId: string) => {
    return cancelPlan(planId)
  })

  ipcMain.handle('restart-plan', async (_event, planId: string) => {
    return restartPlan(planId)
  })

  ipcMain.handle('complete-plan', async (_event, planId: string) => {
    return completePlan(planId)
  })

  ipcMain.handle('request-follow-ups', async (_event, planId: string) => {
    return requestFollowUps(planId)
  })

  ipcMain.handle('get-task-assignments', (_event, planId: string) => {
    return getTaskAssignments(planId)
  })

  ipcMain.handle('get-plan-activities', (_event, planId: string) => {
    return getPlanActivities(planId)
  })

  ipcMain.handle('get-bead-tasks', async (_event, planId: string) => {
    try {
      return await bdList(planId, { status: 'all' })
    } catch (error) {
      console.error('[Main] Failed to get bead tasks:', error)
      return []
    }
  })

  ipcMain.handle('set-plan-sidebar-open', (_event, open: boolean) => {
    setPlanSidebarOpen(open)
  })

  ipcMain.handle('set-active-plan-id', (_event, planId: string | null) => {
    setActivePlanId(planId)
  })

  ipcMain.handle('delete-plan', async (_event, planId: string) => {
    return deletePlanById(planId)
  })

  ipcMain.handle('delete-plans', async (_event, planIds: string[]) => {
    return deletePlansById(planIds)
  })

  ipcMain.handle('clone-plan', async (_event, planId: string, options?: { includeDiscussion?: boolean }) => {
    return clonePlan(planId, options)
  })

  // Headless mode management
  ipcMain.handle('set-headless-mode', (_event, enabled: boolean) => {
    setHeadlessMode(enabled)
    return enabled
  })

  ipcMain.handle('get-headless-mode', () => {
    return isHeadlessModeEnabled()
  })

  ipcMain.handle('check-headless-mode-available', async () => {
    return checkHeadlessModeAvailable()
  })

  ipcMain.handle('get-headless-agent-info', (_event, taskId: string) => {
    return getHeadlessAgentInfo(taskId)
  })

  ipcMain.handle('get-headless-agents-for-plan', (_event, planId: string) => {
    return getHeadlessAgentInfoForPlan(planId)
  })

  ipcMain.handle('stop-headless-agent', async (_event, taskId: string) => {
    return stopHeadlessTaskAgent(taskId)
  })

  ipcMain.handle('destroy-headless-agent', async (_event, taskId: string, isStandalone: boolean) => {
    return destroyHeadlessAgent(taskId, isStandalone)
  })

  // Standalone headless agent management
  ipcMain.handle('start-standalone-headless-agent', async (_event, agentId: string, prompt: string, model: 'opus' | 'sonnet') => {
    return startStandaloneHeadlessAgent(agentId, prompt, model)
  })

  ipcMain.handle('get-standalone-headless-agents', () => {
    return getStandaloneHeadlessAgents()
  })

  ipcMain.handle('stop-standalone-headless-agent', async (_event, headlessId: string) => {
    return stopStandaloneHeadlessAgent(headlessId)
  })

  ipcMain.handle('standalone-headless:confirm-done', async (_event, headlessId: string) => {
    return confirmStandaloneAgentDone(headlessId)
  })

  ipcMain.handle('standalone-headless:start-followup', async (_event, headlessId: string, prompt: string) => {
    return startFollowUpAgent(headlessId, prompt)
  })

  ipcMain.handle('standalone-headless:restart', async (_event, headlessId: string, model: 'opus' | 'sonnet') => {
    return restartStandaloneHeadlessAgent(headlessId, model)
  })

  // Ralph Loop management
  ipcMain.handle('start-ralph-loop', async (_event, config: RalphLoopConfig) => {
    return startRalphLoop(config)
  })

  ipcMain.handle('cancel-ralph-loop', async (_event, loopId: string) => {
    return cancelRalphLoop(loopId)
  })

  ipcMain.handle('pause-ralph-loop', async (_event, loopId: string) => {
    return pauseRalphLoop(loopId)
  })

  ipcMain.handle('resume-ralph-loop', async (_event, loopId: string) => {
    return resumeRalphLoop(loopId)
  })

  ipcMain.handle('get-ralph-loop-state', (_event, loopId: string) => {
    return getRalphLoopState(loopId)
  })

  ipcMain.handle('get-all-ralph-loops', () => {
    return getAllRalphLoops()
  })

  ipcMain.handle('cleanup-ralph-loop', async (_event, loopId: string) => {
    return cleanupRalphLoop(loopId)
  })

  // OAuth token management
  ipcMain.handle('get-oauth-token', () => {
    return getClaudeOAuthToken()
  })

  ipcMain.handle('set-oauth-token', (_event, token: string) => {
    setClaudeOAuthToken(token)
    return true
  })

  ipcMain.handle('has-oauth-token', () => {
    return !!getClaudeOAuthToken()
  })

  ipcMain.handle('run-oauth-setup', async () => {
    return runSetupToken()
  })

  ipcMain.handle('clear-oauth-token', () => {
    clearClaudeOAuthToken()
    return true
  })

  // External URL handling
  ipcMain.handle('open-external', (_event, url: string) => {
    return shell.openExternal(url)
  })

  // Open Docker Desktop application
  ipcMain.handle('open-docker-desktop', async () => {
    try {
      // On macOS, open Docker Desktop app
      const { exec } = await import('child_process')
      const { promisify } = await import('util')
      const execAsync = promisify(exec)
      await execAsync('open -a "Docker Desktop"')
      return { success: true }
    } catch (error) {
      console.error('Failed to open Docker Desktop:', error)
      return { success: false, error: String(error) }
    }
  })

  // File reading (for discussion output, etc.)
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Git repository management
  ipcMain.handle('detect-git-repository', async (_event, directory: string) => {
    return detectRepository(directory)
  })

  ipcMain.handle('get-repositories', async () => {
    return getAllRepositories()
  })

  ipcMain.handle('get-all-repositories', async () => {
    return getAllRepositories()
  })

  ipcMain.handle('update-repository', async (_event, id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches'>>) => {
    return updateRepository(id, updates)
  })

  ipcMain.handle('add-repository', async (_event, path: string) => {
    return detectRepository(path)
  })

  ipcMain.handle('remove-repository', async (_event, id: string) => {
    return removeRepository(id)
  })

  // Setup wizard
  ipcMain.handle('setup-wizard:show-folder-picker', async () => {
    return showFolderPicker()
  })

  ipcMain.handle('setup-wizard:get-common-repo-paths', async () => {
    return getCommonRepoPaths()
  })

  ipcMain.handle('setup-wizard:scan-for-repositories', async (_event, parentPath: string, depth?: number) => {
    return scanForRepositories(parentPath, depth)
  })

  ipcMain.handle('setup-wizard:bulk-create-agents', async (_event, repos: DiscoveredRepo[]) => {
    return bulkCreateAgents(repos)
  })

  ipcMain.handle('setup-wizard:save-default-repos-path', async (_event, reposPath: string) => {
    return saveDefaultReposPath(reposPath)
  })

  ipcMain.handle('setup-wizard:get-default-repos-path', async () => {
    return getDefaultReposPath()
  })

  ipcMain.handle('setup-wizard:generate-descriptions', async (_event, repos: DiscoveredRepo[]) => {
    return generateDescriptions(repos, (progressEvent) => {
      mainWindow?.webContents.send('description-generation-progress', progressEvent)
    })
  })

  ipcMain.handle('setup-wizard:check-plan-mode-deps', async () => {
    return checkPlanModeDependencies()
  })

  ipcMain.handle('setup-wizard:enable-plan-mode', async (_event, enabled: boolean) => {
    return enablePlanMode(enabled)
  })

  ipcMain.handle('setup-wizard:detect-and-save-github-token', async () => {
    return detectAndSaveGitHubToken()
  })

  ipcMain.handle('setup-wizard:group-agents-into-tabs', async (_event, agents: Workspace[]) => {
    return groupAgentsIntoTabs(agents)
  })

  // Setup wizard terminal for "Fix with Claude" feature
  ipcMain.handle('setup-wizard:create-fix-terminal', async () => {
    const deps = await checkPlanModeDependencies()
    const prompt = generateInstallationPrompt(deps)
    const terminalId = createSetupTerminal(mainWindow, prompt)
    return terminalId
  })

  ipcMain.handle('setup-wizard:write-fix-terminal', (_event, terminalId: string, data: string) => {
    writeSetupTerminal(terminalId, data)
  })

  ipcMain.handle('setup-wizard:resize-fix-terminal', (_event, terminalId: string, cols: number, rows: number) => {
    resizeSetupTerminal(terminalId, cols, rows)
  })

  ipcMain.handle('setup-wizard:close-fix-terminal', (_event, terminalId: string) => {
    closeSetupTerminal(terminalId)
  })

  // GitHub token management
  ipcMain.handle('has-github-token', async () => {
    return hasGitHubToken()
  })

  ipcMain.handle('set-github-token', async (_event, token: string) => {
    await setGitHubToken(token)
    return true
  })

  ipcMain.handle('clear-github-token', async () => {
    await setGitHubToken(null)
    return true
  })

  // Settings management
  ipcMain.handle('get-settings', async () => {
    return getSettings()
  })

  ipcMain.handle('update-docker-resource-limits', async (_event, limits: { cpu?: string; memory?: string }) => {
    return updateDockerResourceLimits(limits)
  })

  ipcMain.handle('add-docker-image', async (_event, image: string) => {
    return addDockerImage(image)
  })

  ipcMain.handle('remove-docker-image', async (_event, image: string) => {
    return removeDockerImage(image)
  })

  ipcMain.handle('set-selected-docker-image', async (_event, image: string) => {
    return setSelectedDockerImage(image)
  })

  ipcMain.handle('add-proxied-tool', async (_event, tool: { name: string; hostPath: string; description?: string }) => {
    return addProxiedTool(tool)
  })

  ipcMain.handle('remove-proxied-tool', async (_event, id: string) => {
    return removeProxiedTool(id)
  })

  ipcMain.handle('update-docker-ssh-settings', async (_event, settings: { enabled?: boolean }) => {
    return updateDockerSshSettings(settings)
  })

  ipcMain.handle('update-docker-socket-settings', async (_event, settings: { enabled?: boolean; path?: string }) => {
    return updateDockerSocketSettings(settings)
  })

  ipcMain.handle('set-raw-settings', async (_event, settings: unknown) => {
    return saveSettings(settings as AppSettings)
  })

  // Prompt management
  ipcMain.handle('get-custom-prompts', async () => {
    return getCustomPrompts()
  })

  ipcMain.handle('set-custom-prompt', async (_event, type: 'orchestrator' | 'planner' | 'discussion' | 'task', template: string | null) => {
    return setCustomPrompt(type, template)
  })

  ipcMain.handle('get-default-prompt', (_event, type: 'orchestrator' | 'planner' | 'discussion' | 'task') => {
    return getDefaultPrompt(type)
  })

  // Playbox settings
  ipcMain.handle('update-playbox-settings', async (_event, settings: { bismarckMode?: boolean }) => {
    return updatePlayboxSettings(settings)
  })

  ipcMain.handle('get-playbox-settings', async () => {
    const appSettings = await loadSettings()
    return appSettings.playbox
  })

  // Dev test harness (development mode only)
  if (process.env.NODE_ENV === 'development') {
    ipcMain.handle('dev-run-mock-flow', async (_event, options?: Partial<MockFlowOptions>) => {
      return runMockFlow(options)
    })

    ipcMain.handle('dev-start-mock-agent', async (_event, taskId: string, planId?: string, worktreePath?: string, options?: { eventIntervalMs?: number }) => {
      return startMockAgent(taskId, planId, worktreePath, options)
    })

    ipcMain.handle('dev-stop-mock', async () => {
      return stopMockFlow()
    })

    ipcMain.handle('dev-get-mock-agent-info', (_event, taskId: string) => {
      return getMockAgentInfo(taskId)
    })

    ipcMain.handle('dev-get-mock-agents-for-plan', (_event, planId: string) => {
      return getMockAgentsForPlan(planId)
    })

    ipcMain.handle('dev-set-mock-flow-options', (_event, options: Partial<MockFlowOptions>) => {
      setMockFlowOptions(options)
      return getMockFlowOptions()
    })

    ipcMain.handle('dev-get-mock-flow-options', () => {
      return getMockFlowOptions()
    })
  }
}

app.whenReady().then(async () => {
  // Set instance ID for socket isolation
  setInstanceId(instanceId)

  // Initialize config directory structure
  ensureConfigDirExists()

  // Cleanup orphaned processes from previous sessions
  await cleanupOrphanedProcesses()

  // Initialize state
  initializeState()

  // Initialize standalone headless module
  initStandaloneHeadless()

  // Initialize Ralph Loop module
  initRalphLoop()

  // Create hook script and configure Claude settings
  createHookScript()
  configureClaudeHook()

  // Register IPC handlers before creating window
  registerIpcHandlers()

  createWindow()

  // Initialize Docker environment for headless mode (async, non-blocking)
  // This builds the Docker image if it doesn't exist
  initializeDockerEnvironment().then((result) => {
    if (result.success) {
      console.log('[Main] Docker environment ready:', result.message)
      if (result.imageBuilt) {
        // Notify renderer that image was built
        mainWindow?.webContents.send('docker-image-built', result)
      }
    } else {
      console.warn('[Main] Docker environment not ready:', result.message)
      // Headless mode will fall back to interactive mode
    }
  }).catch((err) => {
    console.error('[Main] Docker initialization error:', err)
  })
})

app.on('window-all-closed', async () => {
  clearQueue()
  closeAllTerminals()
  closeAllSocketServers()
  await cleanupPlanManager()
  await cleanupDevHarness()
  destroyTray()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

app.on('before-quit', async () => {
  clearQueue()
  closeAllTerminals()
  closeAllSocketServers()
  await cleanupPlanManager()
  await cleanupDevHarness()
  destroyTray()
})
