import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import {
  initBenchmark,
  startTimer,
  endTimer,
  milestone,
  timeSync,
  timeAsync,
  recordRendererTiming,
  recordRendererMilestone,
  type BenchmarkPhase,
} from './startup-benchmark'

// Initialize benchmark at the very top, before any other initialization
initBenchmark()
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
  reorderTabs,
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
  checkHeadlessModeAvailable,
  getHeadlessAgentInfo,
  getHeadlessAgentInfoForPlan,
  stopHeadlessTaskAgent,
  destroyHeadlessAgent,
  startDiscussion,
  cancelDiscussion,
  requestFollowUps,
  onPlanStatusChange,
} from './plan-manager'
import {
  detectRepository,
  getAllRepositories,
  updateRepository,
  removeRepository,
  getRepositoryById,
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
  getRalphLoopPresets,
  addRalphLoopPreset,
  updateRalphLoopPreset,
  deleteRalphLoopPreset,
  getDebugSettings,
  updateDebugSettings,
  getPreventSleepSettings,
  updatePreventSleepSettings,
} from './settings-manager'
import { clearDebugSettingsCache } from './logger'
import { writeCrashLog } from './crash-logger'
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
  startHeadlessDiscussion,
  cancelHeadlessDiscussion,
  onStandaloneAgentStatusChange,
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
  getRalphLoopByTabId,
  onRalphLoopStatusChange,
} from './ralph-loop'
import { initializeDockerEnvironment } from './docker-sandbox'
import { initPowerSave, acquirePowerSave, releasePowerSave, setPreventSleepEnabled, cleanupPowerSave, getPowerSaveState } from './power-save'
import {
  initAutoUpdater,
  setAutoUpdaterWindow,
  checkForUpdatesOnLaunch,
  startPeriodicChecks,
  stopPeriodicChecks,
} from './auto-updater'
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
import { getChangedFiles, getFileDiff } from './git-diff'
import type { Workspace, AppPreferences, Repository, DiscoveredRepo, RalphLoopConfig, PromptType } from '../shared/types'
import type { AppSettings } from './settings-manager'

// Generate unique instance ID for socket isolation
const instanceId = randomUUID()

// Signal handlers for graceful shutdown on crash
process.on('uncaughtException', async (error) => {
  console.error('[Main] Uncaught exception:', error)

  // Write crash log to persistent storage
  writeCrashLog(error, 'uncaughtException', {
    component: 'main',
    operation: 'uncaughtException',
  })

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

  // Write crash log for unhandled rejections
  writeCrashLog(reason, 'unhandledRejection', {
    component: 'main',
    operation: 'unhandledRejection',
    additionalInfo: {
      promiseDetails: String(promise),
    },
  })
  // Don't exit for unhandled rejections, just log them
})

let mainWindow: BrowserWindow | null = null

function createWindow() {
  startTimer('window:BrowserWindow-new', 'window')
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  endTimer('window:BrowserWindow-new')

  // Maximize window in dev mode for better testing experience
  if (process.env.NODE_ENV === 'development') {
    mainWindow.maximize()
  }

  // Bring app to foreground on macOS (skip in dev mode to avoid stealing focus)
  if (process.env.NODE_ENV !== 'development') {
    app.focus({ steal: true })
    mainWindow.focus()
  }

  // Set the main window reference for socket server, plan manager, dev harness, queue, standalone headless, ralph loop, and auto-updater
  setMainWindow(mainWindow)
  setPlanManagerWindow(mainWindow)
  setDevHarnessWindow(mainWindow)
  setQueueMainWindow(mainWindow)
  setMainWindowForStandaloneHeadless(mainWindow)
  setMainWindowForRalphLoop(mainWindow)
  setAutoUpdaterWindow(mainWindow)

  startTimer('window:loadURL', 'window')
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
    setAutoUpdaterWindow(null)
  })

  // Create system tray
  createTray(mainWindow)

  // Listen for waiting count changes to update tray
  mainWindow.webContents.on('did-finish-load', () => {
    endTimer('window:loadURL')
    milestone('window-did-finish-load')
    startTimer('window:send-initial-state', 'window')
    // Send initial state to renderer
    const state = getState()
    mainWindow?.webContents.send('initial-state', state)
    endTimer('window:send-initial-state')
  })
}

// Register IPC handlers
function registerIpcHandlers() {
  // Workspace management
  ipcMain.handle('get-workspaces', () => {
    return getWorkspaces()
  })

  ipcMain.handle('save-workspace', async (_event, workspace: Workspace) => {
    // Check if this is a new agent (not an existing one)
    const existingWorkspaces = getWorkspaces()
    const isNewAgent = !existingWorkspaces.find((w) => w.id === workspace.id)

    // Save the workspace first
    const savedWorkspace = saveWorkspace(workspace)

    // If this is a new agent with a repositoryId, check if we need to auto-generate
    // purpose and completion criteria
    if (isNewAgent && workspace.repositoryId) {
      const repo = await getRepositoryById(workspace.repositoryId)
      // Only generate if the repository exists but lacks purpose/completionCriteria
      if (repo && !repo.purpose && !repo.completionCriteria) {
        console.log('[Main] Auto-generating description for new agent:', workspace.name)
        // Run generation in background (don't await)
        generateDescriptions([
          {
            path: repo.rootPath,
            name: repo.name,
            remoteUrl: repo.remoteUrl,
          },
        ])
          .then((results) => {
            if (results.length > 0 && results[0].purpose) {
              // Update the repository with the generated description
              updateRepository(repo.id, {
                purpose: results[0].purpose,
                completionCriteria: results[0].completionCriteria,
                protectedBranches: results[0].protectedBranches,
              })
              console.log('[Main] Auto-generated description for:', repo.name)
            }
          })
          .catch((err) => {
            console.error('[Main] Failed to auto-generate description:', err)
          })
      }
    }

    return savedWorkspace
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
    console.log('[Main] create-terminal called for workspace:', workspaceId)
    try {
      // Use the queue for terminal creation with full setup
      const terminalId = await queueTerminalCreationWithSetup(workspaceId, mainWindow)
      console.log('[Main] create-terminal succeeded:', terminalId)
      return terminalId
    } catch (err) {
      console.error('[Main] create-terminal FAILED for workspace', workspaceId, ':', err)
      throw err
    }
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

  ipcMain.handle('delete-tab', async (_event, tabId: string) => {
    const tab = getState().tabs.find((t) => t.id === tabId)
    if (tab) {
      // Check if this is a Ralph Loop tab and clean it up
      const ralphLoop = getRalphLoopByTabId(tabId)
      if (ralphLoop) {
        try {
          // Cancel the running loop if any
          if (ralphLoop.status === 'running' || ralphLoop.status === 'paused') {
            await cancelRalphLoop(ralphLoop.id)
          }
          // Clean up all resources (worktree, branches, workspaces)
          await cleanupRalphLoop(ralphLoop.id)
        } catch (error) {
          console.error('[main] Failed to cleanup Ralph Loop on tab delete:', error)
        }
      }

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

  ipcMain.handle('reorder-tabs', (_event, tabIds: string[]) => {
    return reorderTabs(tabIds)
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
  ipcMain.handle('start-standalone-headless-agent', async (_event, agentId: string, prompt: string, model: 'opus' | 'sonnet', tabId?: string) => {
    return startStandaloneHeadlessAgent(agentId, prompt, model, tabId)
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

  // Headless discussion (Discuss: Headless Agent)
  ipcMain.handle('start-headless-discussion', async (_event, agentId: string) => {
    return startHeadlessDiscussion(agentId)
  })

  ipcMain.handle('cancel-headless-discussion', async (_event, discussionId: string) => {
    return cancelHeadlessDiscussion(discussionId)
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

  // Git diff operations
  ipcMain.handle('get-changed-files', async (_event, directory: string) => {
    return getChangedFiles(directory)
  })

  ipcMain.handle('get-file-diff', async (_event, directory: string, filepath: string) => {
    return getFileDiff(directory, filepath)
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
    console.log('[Main] setup-wizard:bulk-create-agents called with', repos.length, 'repos')
    try {
      const result = await bulkCreateAgents(repos)
      console.log('[Main] setup-wizard:bulk-create-agents succeeded, created', result.length, 'agents')
      return result
    } catch (err) {
      console.error('[Main] setup-wizard:bulk-create-agents FAILED:', err)
      throw err
    }
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
    console.log('[Main] setup-wizard:enable-plan-mode called with', enabled)
    try {
      const result = await enablePlanMode(enabled)
      console.log('[Main] setup-wizard:enable-plan-mode succeeded')
      return result
    } catch (err) {
      console.error('[Main] setup-wizard:enable-plan-mode FAILED:', err)
      throw err
    }
  })

  ipcMain.handle('setup-wizard:detect-and-save-github-token', async () => {
    return detectAndSaveGitHubToken()
  })

  ipcMain.handle('setup-wizard:group-agents-into-tabs', async (_event, agents: Workspace[]) => {
    console.log('[Main] setup-wizard:group-agents-into-tabs called with', agents.length, 'agents')
    try {
      const result = await groupAgentsIntoTabs(agents)
      console.log('[Main] setup-wizard:group-agents-into-tabs succeeded, created', result.length, 'tabs')
      return result
    } catch (err) {
      console.error('[Main] setup-wizard:group-agents-into-tabs FAILED:', err)
      throw err
    }
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

  ipcMain.handle('set-custom-prompt', async (_event, type: PromptType, template: string | null) => {
    return setCustomPrompt(type, template)
  })

  ipcMain.handle('get-default-prompt', (_event, type: PromptType) => {
    return getDefaultPrompt(type)
  })

  // Playbox settings
  ipcMain.handle('update-playbox-settings', async (_event, settings: { personaMode?: 'none' | 'bismarck' | 'otto' | 'custom'; customPersonaPrompt?: string | null }) => {
    return updatePlayboxSettings(settings)
  })

  ipcMain.handle('get-playbox-settings', async () => {
    const appSettings = await loadSettings()
    return appSettings.playbox
  })

  // Ralph Loop preset management
  ipcMain.handle('get-ralph-loop-presets', async () => {
    return getRalphLoopPresets()
  })

  ipcMain.handle('add-ralph-loop-preset', async (_event, preset: { label: string; description: string; prompt: string; completionPhrase: string; maxIterations: number; model: 'opus' | 'sonnet' }) => {
    return addRalphLoopPreset(preset)
  })

  ipcMain.handle('update-ralph-loop-preset', async (_event, id: string, updates: { label?: string; description?: string; prompt?: string; completionPhrase?: string; maxIterations?: number; model?: 'opus' | 'sonnet' }) => {
    return updateRalphLoopPreset(id, updates)
  })

  ipcMain.handle('delete-ralph-loop-preset', async (_event, id: string) => {
    return deleteRalphLoopPreset(id)
  })

  // Debug settings
  ipcMain.handle('get-debug-settings', async () => {
    return getDebugSettings()
  })

  ipcMain.handle('update-debug-settings', async (_event, settings: { enabled?: boolean; logPath?: string }) => {
    await updateDebugSettings(settings)
    // Clear the logger's cache so it picks up the new settings immediately
    clearDebugSettingsCache()
  })

  // Prevent sleep settings
  ipcMain.handle('get-prevent-sleep-settings', async () => {
    return getPreventSleepSettings()
  })

  ipcMain.handle('update-prevent-sleep-settings', async (_event, settings: { enabled?: boolean }) => {
    await updatePreventSleepSettings(settings)
    if (settings.enabled !== undefined) {
      setPreventSleepEnabled(settings.enabled)
    }
  })

  ipcMain.handle('get-power-save-state', () => {
    return getPowerSaveState()
  })

  // Crash logging (for renderer process errors)
  ipcMain.handle('report-renderer-crash', async (_event, error: { message: string; stack?: string; name?: string }, context?: { component?: string; operation?: string }) => {
    const errorObj = new Error(error.message)
    errorObj.name = error.name || 'RendererError'
    errorObj.stack = error.stack
    writeCrashLog(errorObj, 'renderer', {
      component: context?.component || 'renderer',
      operation: context?.operation,
    })
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

  // Benchmark timing handlers (always registered, used by renderer)
  ipcMain.on('benchmark-timing', (_, { label, phase, startMs, durationMs }) => {
    recordRendererTiming(label, phase as BenchmarkPhase, startMs, durationMs)
  })

  ipcMain.on('benchmark-milestone', (_, { name }) => {
    recordRendererMilestone(name)
  })
}

app.whenReady().then(async () => {
  startTimer('main:app-whenReady', 'main')

  // Set instance ID for socket isolation
  timeSync('main:setInstanceId', 'main', () => setInstanceId(instanceId))

  // Initialize config directory structure
  timeSync('main:ensureConfigDirExists', 'main', () => ensureConfigDirExists())

  // Cleanup orphaned processes from previous sessions
  await timeAsync('main:cleanupOrphanedProcesses', 'main', () => cleanupOrphanedProcesses())

  // Initialize state
  timeSync('main:initializeState', 'main', () => initializeState())

  // Initialize standalone headless module
  timeSync('main:initStandaloneHeadless', 'main', () => initStandaloneHeadless())

  // Initialize Ralph Loop module
  timeSync('main:initRalphLoop', 'main', () => initRalphLoop())

  // Initialize power save blocker
  // Acquire/release is driven entirely by status change callbacks from each module —
  // no per-IPC-handler calls needed.
  await timeAsync('main:initPowerSave', 'main', async () => {
    const preventSleepSettings = await getPreventSleepSettings()
    initPowerSave(preventSleepSettings.enabled)

    const PLAN_ACTIVE_STATUSES = new Set(['delegating', 'in_progress'])
    onPlanStatusChange((planId, status) => {
      if (PLAN_ACTIVE_STATUSES.has(status)) {
        acquirePowerSave(`plan:${planId}`)
      } else {
        releasePowerSave(`plan:${planId}`)
      }
    })

    const STANDALONE_ACTIVE_STATUSES = new Set(['starting', 'running'])
    onStandaloneAgentStatusChange((headlessId, status) => {
      if (STANDALONE_ACTIVE_STATUSES.has(status)) {
        acquirePowerSave(`standalone:${headlessId}`)
      } else {
        releasePowerSave(`standalone:${headlessId}`)
      }
    })

    const RALPH_ACTIVE_STATUSES = new Set(['running'])
    onRalphLoopStatusChange((loopId, status) => {
      if (RALPH_ACTIVE_STATUSES.has(status)) {
        acquirePowerSave(`ralph:${loopId}`)
      } else {
        releasePowerSave(`ralph:${loopId}`)
      }
    })
  })

  // Create hook script and configure Claude settings
  timeSync('main:createHookScript', 'main', () => createHookScript())
  timeSync('main:configureClaudeHook', 'main', () => configureClaudeHook())

  // Register IPC handlers before creating window
  timeSync('main:registerIpcHandlers', 'main', () => registerIpcHandlers())

  // Initialize auto-updater
  timeSync('main:initAutoUpdater', 'main', () => initAutoUpdater())

  startTimer('main:createWindow', 'main')
  createWindow()
  endTimer('main:createWindow')

  endTimer('main:app-whenReady')
  milestone('main-ready')

  // Check for updates on launch (async, non-blocking)
  checkForUpdatesOnLaunch().then(() => {
    startPeriodicChecks()
  })

  // Initialize Docker environment for headless mode (async, non-blocking)
  // This builds the Docker image if it doesn't exist
  startTimer('main:initializeDockerEnvironment', 'main')
  initializeDockerEnvironment().then((result) => {
    endTimer('main:initializeDockerEnvironment')
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
    endTimer('main:initializeDockerEnvironment')
    console.error('[Main] Docker initialization error:', err)
  })
})

app.on('window-all-closed', async () => {
  clearQueue()
  closeAllTerminals()
  closeAllSocketServers()
  stopPeriodicChecks()
  cleanupPowerSave()
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
  cleanupPowerSave()
  await cleanupPlanManager()
  await cleanupDevHarness()
  destroyTray()
})
