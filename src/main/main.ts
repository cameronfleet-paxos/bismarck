import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { devLog } from './dev-log'
import { reloadToolConfig, startToolProxy } from './tool-proxy'
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
  getConfigDir,
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
  createPlainTerminal,
  createDockerTerminal,
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
import { configureClaudeHook, configureCodexHook, createHookScript } from './hook-manager'
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
  getOrCreateTabForWorkspaceWithPreference,
  getPreferences,
  setPreferences,
  reorderWorkspaceInTab,
  moveWorkspaceToTab,
  reorderTabs,
  getTabs,
  setPlanSidebarOpen,
  setActivePlanId,
  addPlainTerminal,
  removePlainTerminal,
  renamePlainTerminal,
  getPlainTerminals,
  swapWorkspaceInTab,
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
  startDiscussion,
  cancelDiscussion,
  requestFollowUps,
  onPlanStatusChange,
} from './teams'
import {
  checkHeadlessModeAvailable,
  getHeadlessAgentInfo,
  getHeadlessAgentInfoForPlan,
  stopHeadlessTaskAgent,
  nudgeHeadlessTaskAgent,
  destroyHeadlessAgent,
  setHeadlessMainWindow,
} from './headless'
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
  getDefaultSettings,
  saveSettings,
  clearSettingsCache,
  updateDockerResourceLimits,
  addDockerImage,
  removeDockerImage,
  setSelectedDockerImage,
  updateToolPaths,
  updateProxiedTool,
  addProxiedTool,
  removeProxiedTool,
  updateDockerSshSettings,
  updateDockerSocketSettings,
  getCustomPrompts,
  setCustomPrompt,
  hasGitHubToken,
  setGitHubToken,
  checkGitHubTokenScopes,
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
  updateDockerSharedBuildCacheSettings,
  updateDockerPnpmStoreSettings,
  updateSettings,
} from './settings-manager'
import { clearDebugSettingsCache, getGlobalLogPath } from './logger'
import { writeCrashLog } from './crash-logger'
import { getDefaultPrompt } from './prompt-templates'
import { bdList } from './bd-client'
import {
  startStandaloneHeadlessAgent,
  getStandaloneHeadlessAgents,
  stopStandaloneHeadlessAgent,
  nudgeStandaloneHeadlessAgent,
  setMainWindowForStandaloneHeadless,
  initStandaloneHeadless,
  confirmStandaloneAgentDone,
  startFollowUpAgent,
  cleanupStandaloneWorktree,
  restartStandaloneHeadlessAgent,
  startHeadlessDiscussion,
  cancelHeadlessDiscussion,
  startRalphLoopDiscussion,
  cancelRalphLoopDiscussion,
  onStandaloneAgentStatusChange,
  getActiveDiscussionTerminalIds,
} from './headless'
import {
  startRalphLoop,
  cancelRalphLoop,
  pauseRalphLoop,
  resumeRalphLoop,
  retryRalphLoop,
  getRalphLoopState,
  getAllRalphLoops,
  cleanupRalphLoop,
  setMainWindowForRalphLoop,
  initRalphLoop,
  getRalphLoopByTabId,
  onRalphLoopStatusChange,
} from './ralph-loop'
import { initializeDockerEnvironment, pullImage, getDefaultImage, checkDockerAvailable, checkImageExists, getImageInfo, persistImageDigest, fetchRegistryDigest, clearRegistryDigestCache } from './docker-sandbox'
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
import { getChangedFiles, getFileDiff, revertFile, writeFileContent, revertAllFiles, getChangedFilesFromRef, getFileDiffFromRef, getChangedFilesForCommit, getFileDiffForCommit } from './git-diff'
import {
  setAuthCheckerWindow,
  startToolAuthChecks,
  stopToolAuthChecks,
  getToolAuthStatuses,
  checkAllToolAuth,
} from './tool-auth-checker'
import { isGitRepo, getCommitsBetween } from './git-utils'
import type { Workspace, AppPreferences, Repository, DiscoveredRepo, RalphLoopConfig, CustomizablePromptType, TeamMode } from '../shared/types'
import type { AppSettings } from './settings-manager'
import {
  loadAllCronJobs,
  loadCronJob,
  createCronJob,
  updateCronJob as updateCronJobFn,
  deleteCronJob,
  getCronJobRuns,
} from './cron-job-manager'
import {
  initCronScheduler,
  shutdownCronScheduler,
  setMainWindowForCronScheduler,
  handleCronJobUpdate,
  handleCronJobDelete,
  runCronJobNow,
  getNextRunTimeForExpression,
  validateCronExpression,
} from './cron-scheduler'

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
  setHeadlessMainWindow(mainWindow)
  setDevHarnessWindow(mainWindow)
  setQueueMainWindow(mainWindow)
  setMainWindowForStandaloneHeadless(mainWindow)
  setMainWindowForRalphLoop(mainWindow)
  setMainWindowForCronScheduler(mainWindow)
  setAutoUpdaterWindow(mainWindow)
  setAuthCheckerWindow(mainWindow)

  startTimer('window:loadURL', 'window')
  if (process.env.NODE_ENV === 'development') {
    const vitePort = process.env.VITE_PORT || '5173'
    mainWindow.loadURL(`http://localhost:${vitePort}`)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
    setPlanManagerWindow(null)
    setHeadlessMainWindow(null)
    setDevHarnessWindow(null)
    setQueueMainWindow(null)
    setAutoUpdaterWindow(null)
    setAuthCheckerWindow(null)
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
        devLog('[Main] Auto-generating description for new agent:', workspace.name)
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
              devLog('[Main] Auto-generated description for:', repo.name)
            }
          })
          .catch((err) => {
            console.error('[Main] Failed to auto-generate description:', err)
          })
      }
    }

    // If saving a Codex agent, ensure the notify hook is configured
    if (workspace.provider === 'codex') {
      configureCodexHook()
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
    devLog('[Main] create-terminal called for workspace:', workspaceId)
    try {
      // Use the queue for terminal creation with full setup
      const terminalId = await queueTerminalCreationWithSetup(workspaceId, mainWindow)
      devLog('[Main] create-terminal succeeded:', terminalId)
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

  // Plain terminal management (non-agent shell terminals)
  ipcMain.handle('create-plain-terminal', async (_event, directory: string, name?: string) => {
    const terminalId = createPlainTerminal(directory, mainWindow)
    const plainId = `plain-${terminalId}`

    // Place in next available grid slot (prefer active tab, same as headless agents)
    const state = getState()
    const tab = getOrCreateTabForWorkspaceWithPreference(plainId, state.activeTabId || undefined)
    addWorkspaceToTab(plainId, tab.id)
    setActiveTab(tab.id)

    // Persist plain terminal info for restoration on restart
    addPlainTerminal({ id: plainId, terminalId, tabId: tab.id, name: name || '', directory })

    return { terminalId, tabId: tab.id }
  })

  // Docker terminal management (interactive Docker container via PTY)
  ipcMain.handle('create-docker-terminal', async (_event, options: {
    directory: string
    command: string[]
    name?: string
    mountClaudeConfig?: boolean
    env?: Record<string, string>
  }) => {
    // Pre-flight checks
    const dockerAvailable = await checkDockerAvailable()
    if (!dockerAvailable) {
      throw new Error('Docker is not available. Please start Docker Desktop.')
    }

    // Ensure tool proxy is running
    await startToolProxy()

    // Build InteractiveDockerOptions
    const dockerOptions: import('./docker-sandbox').InteractiveDockerOptions = {
      workingDir: options.directory,
      command: options.command,
      env: options.env,
    }

    // Mount ~/.claude read-only if requested
    if (options.mountClaudeConfig) {
      const claudeDir = path.join(app.getPath('home'), '.claude')
      if (fs.existsSync(claudeDir)) {
        dockerOptions.claudeConfigDir = claudeDir
      }
    }

    const result = await createDockerTerminal(dockerOptions, mainWindow)
    const plainId = `plain-${result.terminalId}`

    // Place in next available grid slot (same as create-plain-terminal)
    const state = getState()
    const tab = getOrCreateTabForWorkspaceWithPreference(plainId, state.activeTabId || undefined)
    addWorkspaceToTab(plainId, tab.id)
    setActiveTab(tab.id)

    // Persist as plain terminal for tab management
    addPlainTerminal({ id: plainId, terminalId: result.terminalId, tabId: tab.id, name: options.name || '', directory: options.directory, isDocker: true, containerName: result.containerName, dockerCommand: options.command })

    return { terminalId: result.terminalId, tabId: tab.id, containerName: result.containerName }
  })

  ipcMain.handle('rename-plain-terminal', (_event, terminalId: string, name: string) => {
    renamePlainTerminal(terminalId, name)
  })

  ipcMain.handle('close-plain-terminal', (_event, terminalId: string) => {
    const plainId = `plain-${terminalId}`
    removeWorkspaceFromTab(plainId)
    removePlainTerminal(terminalId)
    closeTerminal(terminalId)
  })

  // Restore a plain terminal from a previous session (called by renderer after it's loaded)
  ipcMain.handle('restore-plain-terminal', async (_event, pt: { id: string; terminalId: string; tabId: string; name: string; directory: string; isDocker?: boolean; containerName?: string; dockerCommand?: string[] }) => {
    try {
      let newTerminalId: string
      let newContainerName: string | undefined

      if (pt.isDocker) {
        // Restore as Docker terminal — re-launch the container
        const dockerAvailable = await checkDockerAvailable()
        if (!dockerAvailable) {
          throw new Error('Docker is not available. Please start Docker Desktop.')
        }
        await startToolProxy()

        const dockerOptions: import('./docker-sandbox').InteractiveDockerOptions = {
          workingDir: pt.directory,
          command: pt.dockerCommand || ['bash'],
        }

        // Mount ~/.claude config if available
        const claudeDir = path.join(app.getPath('home'), '.claude')
        if (fs.existsSync(claudeDir)) {
          dockerOptions.claudeConfigDir = claudeDir
        }

        const result = await createDockerTerminal(dockerOptions, mainWindow)
        newTerminalId = result.terminalId
        newContainerName = result.containerName
      } else {
        newTerminalId = createPlainTerminal(pt.directory, mainWindow)
      }

      const newPlainId = `plain-${newTerminalId}`
      // Swap workspace ID in tabs
      swapWorkspaceInTab(pt.id, newPlainId)
      // Update persisted plain terminal entry
      removePlainTerminal(pt.terminalId)
      addPlainTerminal({ ...pt, id: newPlainId, terminalId: newTerminalId, containerName: newContainerName })
      return { terminalId: newTerminalId, plainId: newPlainId }
    } catch (err) {
      console.error(`Failed to restore ${pt.isDocker ? 'Docker' : 'plain'} terminal in ${pt.directory}:`, err)
      removePlainTerminal(pt.terminalId)
      removeWorkspaceFromTab(pt.id)
      return null
    }
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

      // Check if this is a plan tab with an in-progress plan
      const plans = getPlans()
      const planForTab = plans.find((p) => p.orchestratorTabId === tabId)
      if (planForTab && (planForTab.status === 'delegating' || planForTab.status === 'in_progress' || planForTab.status === 'discussing')) {
        try {
          // Cancel the plan properly - this stops all agents and cleans up worktrees
          await cancelPlan(planForTab.id)
          // cancelPlan already deletes the tab, so return success
          return { success: true, workspaceIds: [] }
        } catch (error) {
          console.error('[main] Failed to cancel plan on tab delete:', error)
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

  // Check if a tab has an in-progress plan (for confirmation dialog)
  ipcMain.handle('get-tab-team-plan-status', (_event, tabId: string) => {
    const plans = getPlans()
    const planForTab = plans.find((p) => p.orchestratorTabId === tabId)
    if (planForTab) {
      return {
        hasPlan: true,
        planId: planForTab.id,
        planTitle: planForTab.title,
        planStatus: planForTab.status,
        isInProgress: planForTab.status === 'delegating' || planForTab.status === 'in_progress' || planForTab.status === 'discussing',
      }
    }
    return { hasPlan: false, isInProgress: false }
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
  ipcMain.handle('create-team-plan', async (_event, title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: 'feature_branch' | 'raise_prs'; teamMode?: TeamMode }) => {
    return await createPlan(title, description, options)
  })

  ipcMain.handle('get-team-plans', () => {
    return getPlans()
  })

  ipcMain.handle('execute-team-plan', async (_event, planId: string, referenceAgentId: string, teamMode?: string) => {
    devLog('[Main] execute-team-plan IPC received:', { planId, referenceAgentId, teamMode })
    const result = await executePlan(planId, referenceAgentId, teamMode as TeamMode | undefined)
    devLog('[Main] execute-team-plan result:', result?.status)
    return result
  })

  ipcMain.handle('start-team-discussion', async (_event, planId: string, referenceAgentId: string) => {
    return startDiscussion(planId, referenceAgentId)
  })

  ipcMain.handle('cancel-team-discussion', async (_event, planId: string) => {
    return cancelDiscussion(planId)
  })

  ipcMain.handle('cancel-team-plan', async (_event, planId: string) => {
    return cancelPlan(planId)
  })

  ipcMain.handle('restart-team-plan', async (_event, planId: string) => {
    return restartPlan(planId)
  })

  ipcMain.handle('complete-team-plan', async (_event, planId: string) => {
    return completePlan(planId)
  })

  ipcMain.handle('request-team-follow-ups', async (_event, planId: string) => {
    return requestFollowUps(planId)
  })

  ipcMain.handle('get-team-task-assignments', (_event, planId: string) => {
    return getTaskAssignments(planId)
  })

  ipcMain.handle('get-team-plan-activities', (_event, planId: string) => {
    return getPlanActivities(planId)
  })

  ipcMain.handle('get-team-bead-tasks', async (_event, planId: string) => {
    try {
      return await bdList(planId, { status: 'all' })
    } catch (error) {
      console.error('[Main] Failed to get bead tasks:', error)
      return []
    }
  })

  ipcMain.handle('set-team-sidebar-open', (_event, open: boolean) => {
    setPlanSidebarOpen(open)
  })

  ipcMain.handle('set-active-team-plan-id', (_event, planId: string | null) => {
    setActivePlanId(planId)
  })

  ipcMain.handle('delete-team-plan', async (_event, planId: string) => {
    return deletePlanById(planId)
  })

  ipcMain.handle('delete-team-plans', async (_event, planIds: string[]) => {
    return deletePlansById(planIds)
  })

  ipcMain.handle('clone-team-plan', async (_event, planId: string, options?: { includeDiscussion?: boolean }) => {
    return clonePlan(planId, options)
  })

  // Headless mode management
  ipcMain.handle('check-headless-mode-available', async () => {
    return checkHeadlessModeAvailable()
  })

  ipcMain.handle('get-headless-agent-info', (_event, taskId: string) => {
    return getHeadlessAgentInfo(taskId)
  })

  ipcMain.handle('get-headless-agents-for-team-plan', (_event, planId: string) => {
    return getHeadlessAgentInfoForPlan(planId)
  })

  ipcMain.handle('stop-headless-agent', async (_event, taskId: string) => {
    return stopHeadlessTaskAgent(taskId)
  })

  ipcMain.handle('destroy-headless-agent', async (_event, taskId: string, isStandalone: boolean) => {
    return destroyHeadlessAgent(taskId, isStandalone)
  })

  ipcMain.handle('nudge-headless-agent', async (_event, taskId: string, message: string, isStandalone: boolean) => {
    if (isStandalone) {
      return nudgeStandaloneHeadlessAgent(taskId, message)
    } else {
      return nudgeHeadlessTaskAgent(taskId, message)
    }
  })

  // Standalone headless agent management
  ipcMain.handle('start-standalone-headless-agent', async (_event, agentId: string, prompt: string, model: 'opus' | 'sonnet', tabId?: string, options?: { planPhase?: boolean }) => {
    return startStandaloneHeadlessAgent(agentId, prompt, model, tabId, { skipPlanPhase: options?.planPhase === false })
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

  ipcMain.handle('standalone-headless:start-followup', async (_event, headlessId: string, prompt: string, model?: 'opus' | 'sonnet', options?: { planPhase?: boolean }) => {
    const skipPlanPhase = options?.planPhase === false
    return startFollowUpAgent(headlessId, prompt, model, { skipPlanPhase })
  })

  ipcMain.handle('standalone-headless:restart', async (_event, headlessId: string, model: 'opus' | 'sonnet') => {
    return restartStandaloneHeadlessAgent(headlessId, model)
  })

  // Headless discussion (Discuss: Headless Agent)
  ipcMain.handle('start-headless-discussion', async (_event, agentId: string, initialPrompt: string) => {
    return startHeadlessDiscussion(agentId, initialPrompt)
  })

  ipcMain.handle('cancel-headless-discussion', async (_event, discussionId: string) => {
    return cancelHeadlessDiscussion(discussionId)
  })

  // Ralph Loop discussion (Discuss: Ralph Loop)
  ipcMain.handle('start-ralph-loop-discussion', async (_event, agentId: string, initialPrompt: string) => {
    return startRalphLoopDiscussion(agentId, initialPrompt)
  })

  ipcMain.handle('cancel-ralph-loop-discussion', async (_event, discussionId: string) => {
    return cancelRalphLoopDiscussion(discussionId)
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

  ipcMain.handle('retry-ralph-loop', async (_event, loopId: string) => {
    return retryRalphLoop(loopId)
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

  // External URL handling - only allow http/https URLs
  ipcMain.handle('open-external', (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Blocked URL with disallowed protocol: ${parsed.protocol}`)
      }
    } catch (e) {
      if (e instanceof TypeError) {
        throw new Error(`Invalid URL: ${url}`)
      }
      throw e
    }
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

  // Path validation for file IPC handlers.
  // Restricts file access to the config directory (~/.bismarck) and
  // known workspace/repository directories.
  function isPathAllowed(requestedPath: string): boolean {
    const resolved = path.resolve(requestedPath)
    // Allow paths within the config directory (~/.bismarck)
    const configDir = path.resolve(getConfigDir())
    if (resolved.startsWith(configDir + path.sep) || resolved === configDir) {
      return true
    }
    // Allow paths within known workspace directories
    const workspaces = getWorkspaces()
    for (const ws of workspaces) {
      const wsDir = path.resolve(ws.directory)
      if (resolved.startsWith(wsDir + path.sep) || resolved === wsDir) {
        return true
      }
    }
    return false
  }

  // File reading (for discussion output, etc.)
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    try {
      const resolved = path.resolve(filePath)
      if (!isPathAllowed(resolved)) {
        return { success: false, error: 'Access denied: path is outside allowed directories' }
      }
      const content = await fs.promises.readFile(resolved, 'utf-8')
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

  ipcMain.handle('update-repository', async (_event, id: string, updates: Partial<Pick<Repository, 'name' | 'purpose' | 'completionCriteria' | 'protectedBranches' | 'guidance'>>) => {
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

  ipcMain.handle('get-file-diff', async (_event, directory: string, filepath: string, force?: boolean) => {
    return getFileDiff(directory, filepath, force)
  })

  ipcMain.handle('is-git-repo', async (_event, directory: string) => {
    return isGitRepo(directory)
  })

  ipcMain.handle('revert-file', async (_event, directory: string, filepath: string) => {
    return revertFile(directory, filepath)
  })

  ipcMain.handle('write-file-content', async (_event, directory: string, filepath: string, content: string) => {
    const resolvedDir = path.resolve(directory)
    if (!isPathAllowed(resolvedDir)) {
      throw new Error('Access denied: directory is outside allowed paths')
    }
    return writeFileContent(directory, filepath, content)
  })

  ipcMain.handle('revert-all-files', async (_event, directory: string) => {
    return revertAllFiles(directory)
  })

  // Ref-based git diff operations (for headless agents)
  ipcMain.handle('get-changed-files-from-ref', async (_event, directory: string, baseRef: string) => {
    return getChangedFilesFromRef(directory, baseRef)
  })

  ipcMain.handle('get-file-diff-from-ref', async (_event, directory: string, filepath: string, baseRef: string, force?: boolean) => {
    return getFileDiffFromRef(directory, filepath, baseRef, force)
  })

  ipcMain.handle('get-commits-between', async (_event, repoPath: string, baseRef: string, headRef: string) => {
    return getCommitsBetween(repoPath, baseRef, headRef)
  })

  ipcMain.handle('get-changed-files-for-commit', async (_event, directory: string, commitSha: string) => {
    return getChangedFilesForCommit(directory, commitSha)
  })

  ipcMain.handle('get-file-diff-for-commit', async (_event, directory: string, filepath: string, commitSha: string, force?: boolean) => {
    return getFileDiffForCommit(directory, filepath, commitSha, force)
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
    devLog('[Main] setup-wizard:bulk-create-agents called with', repos.length, 'repos')
    try {
      const result = await bulkCreateAgents(repos)
      devLog('[Main] setup-wizard:bulk-create-agents succeeded, created', result.length, 'agents')
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
    devLog('[Main] setup-wizard:enable-plan-mode called with', enabled)
    try {
      const result = await enablePlanMode(enabled)
      devLog('[Main] setup-wizard:enable-plan-mode succeeded')
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
    devLog('[Main] setup-wizard:group-agents-into-tabs called with', agents.length, 'agents')
    try {
      const result = await groupAgentsIntoTabs(agents)
      devLog('[Main] setup-wizard:group-agents-into-tabs succeeded, created', result.length, 'tabs')
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

  ipcMain.handle('setup-wizard:pull-docker-image', async () => {
    const result = await pullImage(getDefaultImage(), (message) => {
      mainWindow?.webContents.send('docker-pull-progress', message)
    })
    if (result.success) {
      clearRegistryDigestCache(getDefaultImage())
      const { baseImageUpdated } = await persistImageDigest(getDefaultImage())
      if (baseImageUpdated) {
        const settings = await loadSettings()
        if (settings.docker.selectedImage !== getDefaultImage()) {
          mainWindow?.webContents.send('base-image-updated', {
            newVersion: settings.docker.upstreamTemplateVersion,
            newDigest: settings.docker.upstreamTemplateDigest,
          })
        }
      }
    }
    return result
  })

  ipcMain.handle('check-docker-image-status', async (_event, imageName: string) => {
    const [dockerAvailable, imageInfo] = await Promise.all([
      checkDockerAvailable(),
      getImageInfo(imageName),
    ])
    let verified: boolean | undefined
    if (imageInfo.exists && imageInfo.digest) {
      const registryDigest = await fetchRegistryDigest(imageName)
      verified = registryDigest !== null && imageInfo.digest === registryDigest
    }
    return {
      dockerAvailable,
      ...imageInfo,
      verified,
    }
  })

  ipcMain.handle('pull-docker-image', async (_event, imageName: string) => {
    const result = await pullImage(imageName, (message) => {
      mainWindow?.webContents.send('docker-pull-progress', message)
    })
    if (result.success) {
      clearRegistryDigestCache(imageName)
      const { baseImageUpdated } = await persistImageDigest(imageName)
      if (baseImageUpdated) {
        const settings = await loadSettings()
        if (settings.docker.selectedImage !== getDefaultImage()) {
          mainWindow?.webContents.send('base-image-updated', {
            newVersion: settings.docker.upstreamTemplateVersion,
            newDigest: settings.docker.upstreamTemplateDigest,
          })
        }
      }
    }
    return {
      success: result.success,
      output: result.output,
      alreadyUpToDate: result.success && result.output.includes('Image is up to date'),
    }
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

  ipcMain.handle('check-github-token-scopes', async () => {
    return checkGitHubTokenScopes()
  })

  // Settings management
  ipcMain.handle('get-settings', async () => {
    return getSettings()
  })

  ipcMain.handle('update-settings', async (_event, updates) => {
    return await updateSettings(updates)
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

  ipcMain.handle('toggle-proxied-tool', async (_event, id: string, enabled: boolean) => {
    const result = updateProxiedTool(id, { enabled })
    reloadToolConfig()
    // Re-check auth statuses when a tool is toggled (async, don't block)
    checkAllToolAuth().catch(() => {})
    return result
  })

  ipcMain.handle('add-proxied-tool', async (_event, tool: { name: string; hostPath: string; description?: string; enabled: boolean; promptHint?: string }) => {
    const result = await addProxiedTool(tool)
    reloadToolConfig()
    return result
  })

  ipcMain.handle('remove-proxied-tool', async (_event, id: string) => {
    const result = await removeProxiedTool(id)
    reloadToolConfig()
    return result
  })

  // Tool auth status handlers
  ipcMain.handle('get-tool-auth-statuses', () => {
    return getToolAuthStatuses()
  })

  ipcMain.handle('check-tool-auth', async () => {
    return checkAllToolAuth()
  })

  ipcMain.handle('run-tool-reauth', async (_event, toolId: string) => {
    const settings = await getSettings()
    const tool = settings.docker.proxiedTools.find(t => t.id === toolId)
    if (!tool?.authCheck?.reauthCommand) {
      throw new Error(`No reauth command configured for tool ${toolId}`)
    }
    const { execWithPath } = await import('./exec-utils')
    const [cmd, ...args] = tool.authCheck.reauthCommand
    // Use hostPath if the command matches the tool name (e.g., 'bb' -> '/usr/local/bin/bb')
    const resolvedCmd = cmd === tool.name ? tool.hostPath : cmd
    const command = `"${resolvedCmd}" ${args.map(a => `"${a}"`).join(' ')}`
    devLog('[Main] run-tool-reauth: executing', command)
    // Fire and forget - don't await, let the process open the browser
    execWithPath(command).then(
      () => devLog('[Main] run-tool-reauth completed'),
      (err) => console.error('[Main] run-tool-reauth failed:', err)
    )
  })

  ipcMain.handle('update-docker-ssh-settings', async (_event, settings: { enabled?: boolean }) => {
    return updateDockerSshSettings(settings)
  })

  ipcMain.handle('update-docker-socket-settings', async (_event, settings: { enabled?: boolean; path?: string }) => {
    return updateDockerSocketSettings(settings)
  })

  ipcMain.handle('update-docker-shared-build-cache-settings', async (_event, settings: { enabled?: boolean }) => {
    return updateDockerSharedBuildCacheSettings(settings)
  })

  ipcMain.handle('update-docker-pnpm-store-settings', async (_event, settings: { enabled?: boolean; path?: string | null }) => {
    return updateDockerPnpmStoreSettings(settings)
  })

  ipcMain.handle('detect-pnpm-store-path', async () => {
    const { detectPnpmStorePath } = await import('./pnpm-detect')
    return detectPnpmStorePath()
  })

  ipcMain.handle('set-raw-settings', async (_event, settings: unknown) => {
    return saveSettings(settings as AppSettings)
  })

  ipcMain.handle('dev-reset-settings', async () => {
    const defaults = getDefaultSettings()
    await saveSettings(defaults)
    clearSettingsCache()
    return defaults
  })

  // Prompt management
  ipcMain.handle('get-custom-prompts', async () => {
    return getCustomPrompts()
  })

  ipcMain.handle('set-custom-prompt', async (_event, type: CustomizablePromptType, template: string | null) => {
    return setCustomPrompt(type, template)
  })

  ipcMain.handle('get-default-prompt', (_event, type: CustomizablePromptType) => {
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

    // Debug log tail - streams new lines from the global debug log
    let debugLogWatcher: ReturnType<typeof fs.watchFile> | null = null
    let debugLogOffset = 0

    ipcMain.handle('dev-start-debug-log-tail', async (_event, numInitialLines?: number) => {
      const logPath = getGlobalLogPath()

      // Stop existing watcher if any
      if (debugLogWatcher !== null) {
        fs.unwatchFile(logPath)
        debugLogWatcher = null
      }

      // Read initial lines (tail of file)
      let initialContent = ''
      try {
        const content = fs.readFileSync(logPath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        const tailLines = lines.slice(-(numInitialLines || 100))
        initialContent = tailLines.join('\n')
        debugLogOffset = content.length
      } catch {
        debugLogOffset = 0
      }

      // Watch for changes
      fs.watchFile(logPath, { interval: 500 }, (curr) => {
        if (curr.size <= debugLogOffset) return
        try {
          const fd = fs.openSync(logPath, 'r')
          const buffer = Buffer.alloc(curr.size - debugLogOffset)
          fs.readSync(fd, buffer, 0, buffer.length, debugLogOffset)
          fs.closeSync(fd)
          debugLogOffset = curr.size
          const newContent = buffer.toString('utf-8')
          const win = BrowserWindow.getAllWindows()[0]
          if (win) {
            win.webContents.send('debug-log-lines', newContent)
          }
        } catch {
          // Ignore read errors
        }
      })
      debugLogWatcher = {} as ReturnType<typeof fs.watchFile>

      return { logPath, initialContent }
    })

    ipcMain.handle('dev-stop-debug-log-tail', async () => {
      if (debugLogWatcher !== null) {
        const logPath = getGlobalLogPath()
        fs.unwatchFile(logPath)
        debugLogWatcher = null
        debugLogOffset = 0
      }
    })
  }

  // Benchmark timing handlers (always registered, used by renderer)
  ipcMain.on('benchmark-timing', (_, { label, phase, startMs, durationMs }) => {
    recordRendererTiming(label, phase as BenchmarkPhase, startMs, durationMs)
  })

  ipcMain.on('benchmark-milestone', (_, { name }) => {
    recordRendererMilestone(name)
  })

  // Cron Job Automations
  ipcMain.handle('get-cron-jobs', async () => {
    return loadAllCronJobs()
  })

  ipcMain.handle('get-cron-job', async (_event, id: string) => {
    return loadCronJob(id)
  })

  ipcMain.handle('create-cron-job', async (_event, data: { name: string; schedule: string; enabled: boolean; workflowGraph: import('../shared/cron-types').WorkflowGraph }) => {
    const job = createCronJob(data)
    handleCronJobUpdate(job.id)
    return job
  })

  ipcMain.handle('update-cron-job', async (_event, id: string, updates: Partial<import('../shared/cron-types').CronJob>) => {
    const job = updateCronJobFn(id, updates)
    if (job) handleCronJobUpdate(job.id)
    return job
  })

  ipcMain.handle('delete-cron-job', async (_event, id: string) => {
    handleCronJobDelete(id)
    return deleteCronJob(id)
  })

  ipcMain.handle('toggle-cron-job-enabled', async (_event, id: string, enabled: boolean) => {
    const job = updateCronJobFn(id, { enabled })
    if (job) handleCronJobUpdate(job.id)
    return job
  })

  ipcMain.handle('run-cron-job-now', async (_event, id: string) => {
    return runCronJobNow(id)
  })

  ipcMain.handle('get-cron-job-runs', async (_event, cronJobId: string) => {
    return getCronJobRuns(cronJobId)
  })

  ipcMain.handle('get-next-cron-run-time', async (_event, cronExpression: string) => {
    return getNextRunTimeForExpression(cronExpression)
  })

  ipcMain.handle('validate-cron-expression', async (_event, cron: string) => {
    return validateCronExpression(cron)
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

  // Initialize Cron Job Scheduler
  await timeAsync('main:initCronScheduler', 'main', () => initCronScheduler())

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
  timeSync('main:configureCodexHook', 'main', () => configureCodexHook())

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

  // Start periodic tool auth checks (for tools like bb with SSO auth)
  startToolAuthChecks()

  // Initialize Docker environment for headless mode (async, non-blocking)
  // This builds the Docker image if it doesn't exist
  startTimer('main:initializeDockerEnvironment', 'main')
  initializeDockerEnvironment().then(async (result) => {
    endTimer('main:initializeDockerEnvironment')
    if (result.success) {
      devLog('[Main] Docker environment ready:', result.message)
      if (result.imageBuilt) {
        // Notify renderer that image was built
        mainWindow?.webContents.send('docker-image-built', result)
      }
      // Persist digest after successful init (pull or cached)
      try {
        const { baseImageUpdated } = await persistImageDigest(getDefaultImage())
        if (baseImageUpdated) {
          const settings = await loadSettings()
          if (settings.docker.selectedImage !== getDefaultImage()) {
            mainWindow?.webContents.send('base-image-updated', {
              newVersion: settings.docker.upstreamTemplateVersion,
              newDigest: settings.docker.upstreamTemplateDigest,
            })
          }
        }
      } catch (err) {
        devLog('[Main] Failed to persist image digest:', err)
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
  // Preserve terminals for active discussions so they can complete and spawn headless agents
  const discussionTerminals = getActiveDiscussionTerminalIds()
  closeAllTerminals(discussionTerminals.size > 0 ? discussionTerminals : undefined)
  closeAllSocketServers()
  stopPeriodicChecks()
  stopToolAuthChecks()
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
  const discussionTerminals = getActiveDiscussionTerminalIds()
  closeAllTerminals(discussionTerminals.size > 0 ? discussionTerminals : undefined)
  closeAllSocketServers()
  cleanupPowerSave()
  await shutdownCronScheduler()
  await cleanupPlanManager()
  await cleanupDevHarness()
  destroyTray()
})
