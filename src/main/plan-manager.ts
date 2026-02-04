import { BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger, createScopedLogger, LogContext } from './logger'
import {
  loadPlans,
  savePlan,
  getPlanById,
  deletePlan,
  loadTaskAssignments,
  saveTaskAssignment,
  saveTaskAssignments,
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
  getWorktreePath,
  getPlanWorktreesPath,
  getClaudeOAuthToken,
  loadPlanActivities,
  savePlanActivities,
  loadHeadlessAgentInfo,
  saveHeadlessAgentInfo,
  withPlanLock,
  withGitPushLock,
} from './config'
import { bdCreate, bdList, bdUpdate, bdClose, bdAddDependency, bdGetDependents, BeadTask, ensureBeadsRepo, getPlanDir } from './bd-client'
import { injectTextToTerminal, injectPromptToTerminal, getTerminalForWorkspace, waitForTerminalOutput, closeTerminal, getTerminalEmitter } from './terminal'
import { queueTerminalCreation } from './terminal-queue'
import { createTab, addWorkspaceToTab, addActiveWorkspace, removeActiveWorkspace, removeWorkspaceFromTab, setActiveTab, deleteTab, getState, setFocusedWorkspace, getPreferences } from './state-manager'
import type { Plan, TaskAssignment, PlanStatus, Agent, PlanActivity, PlanActivityType, Workspace, PlanWorktree, Repository, StreamEvent, HeadlessAgentInfo, HeadlessAgentStatus, BranchStrategy, PlanCommit, PlanPullRequest, PlanDiscussion } from '../shared/types'
import {
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  pushBranch,
  pushBranchToRemoteBranch,
  getCommitsBetween,
  getGitHubUrlFromRemote,
  createBranch,
  getHeadCommit,
  fetchBranch,
  fetchBranchWithForce,
  rebaseOntoRemoteBranch,
  generateUniqueBranchName,
  remoteBranchExists,
  deleteRemoteBranch,
  deleteLocalBranch,
} from './git-utils'
import { buildPrompt, type PromptVariables } from './prompt-templates'
import {
  getRepositoryById,
  getAllRepositories,
} from './repository-manager'
import { HeadlessAgent, HeadlessAgentOptions } from './headless-agent'
import { runSetupToken } from './oauth-setup'
import { startToolProxy, stopToolProxy, isProxyRunning, proxyEvents } from './tool-proxy'
import { checkDockerAvailable, checkImageExists, stopAllContainers } from './docker-sandbox'
import { execWithPath } from './exec-utils'
import { getSelectedDockerImage } from './settings-manager'

let mainWindow: BrowserWindow | null = null
let pollInterval: NodeJS.Timeout | null = null
let syncInProgress = false // Guard against overlapping syncs

const POLL_INTERVAL_MS = 5000 // Poll bd every 5 seconds
const DEFAULT_MAX_PARALLEL_AGENTS = 4

// In-memory activity storage per plan
const planActivities: Map<string, PlanActivity[]> = new Map()

// In-memory guard to prevent duplicate plan execution (React StrictMode double-invocation)
const executingPlans: Set<string> = new Set()

// Track headless agents for cleanup and status
const headlessAgents: Map<string, HeadlessAgent> = new Map()

// Debounce timers for headless agent event persistence
const eventPersistTimers: Map<string, NodeJS.Timeout> = new Map()
const EVENT_PERSIST_DEBOUNCE_MS = 2000 // Persist events every 2 seconds max

// Track headless agent info for UI
const headlessAgentInfo: Map<string, HeadlessAgentInfo> = new Map()

/**
 * Register a headless agent info entry (for mock/test agents)
 */
export function registerHeadlessAgentInfo(info: HeadlessAgentInfo): void {
  headlessAgentInfo.set(info.taskId!, info)
}

/**
 * Emit headless agent update to renderer (exported for mock agents)
 */
export function emitHeadlessAgentUpdatePublic(info: HeadlessAgentInfo): void {
  emitHeadlessAgentUpdate(info)
}

/**
 * Emit headless agent event to renderer (exported for mock agents)
 */
export function emitHeadlessAgentEventPublic(planId: string, taskId: string, event: StreamEvent): void {
  emitHeadlessAgentEvent(planId, taskId, event)
}

// Feature flag for headless mode (can be made configurable later)
// Default to true to test Docker sandboxing
let useHeadlessMode = true

/**
 * Enable or disable headless Docker mode
 */
export function setHeadlessMode(enabled: boolean): void {
  useHeadlessMode = enabled
}

/**
 * Check if headless mode is enabled
 */
export function isHeadlessModeEnabled(): boolean {
  return useHeadlessMode
}

/**
 * Check if Docker is available for headless mode
 */
export async function checkHeadlessModeAvailable(): Promise<{
  available: boolean
  dockerAvailable: boolean
  imageExists: boolean
  message: string
}> {
  const dockerAvailable = await checkDockerAvailable()
  if (!dockerAvailable) {
    return {
      available: false,
      dockerAvailable: false,
      imageExists: false,
      message: 'Docker is not available. Install Docker to use headless mode.',
    }
  }

  const selectedImage = await getSelectedDockerImage()
  const imageExists = await checkImageExists(selectedImage)
  if (!imageExists) {
    return {
      available: false,
      dockerAvailable: true,
      imageExists: false,
      message: `Docker image '${selectedImage}' not found. Run: cd bismarck/docker && ./build.sh`,
    }
  }

  return {
    available: true,
    dockerAvailable: true,
    imageExists: true,
    message: 'Headless mode is available',
  }
}

/**
 * Get headless agent info for a task
 */
export function getHeadlessAgentInfo(taskId: string): HeadlessAgentInfo | undefined {
  return headlessAgentInfo.get(taskId)
}

/**
 * Get all headless agent info for a plan
 */
export function getHeadlessAgentInfoForPlan(planId: string): HeadlessAgentInfo[] {
  return Array.from(headlessAgentInfo.values()).filter(info => info.planId === planId)
}

/**
 * Generate a unique activity ID
 */
function generateActivityId(): string {
  return `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Add an activity to a plan's activity log
 */
export function addPlanActivity(
  planId: string,
  type: PlanActivityType,
  message: string,
  details?: string
): PlanActivity {
  const activity: PlanActivity = {
    id: generateActivityId(),
    planId,
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  }

  // Store in memory
  if (!planActivities.has(planId)) {
    planActivities.set(planId, [])
  }
  planActivities.get(planId)!.push(activity)

  // Persist to disk
  savePlanActivities(planId, planActivities.get(planId)!)

  // Emit to renderer
  emitPlanActivity(activity)

  return activity
}

/**
 * Get all activities for a plan
 */
export function getPlanActivities(planId: string): PlanActivity[] {
  return planActivities.get(planId) || []
}

/**
 * Clear activities for a plan
 */
export function clearPlanActivities(planId: string): void {
  planActivities.delete(planId)
}

/**
 * Set the main window reference for sending IPC events
 */
export function setPlanManagerWindow(window: BrowserWindow | null): void {
  mainWindow = window
  if (window) {
    initializePlanState()
  }
}

/**
 * Initialize plan state on startup - loads persisted activities and headless agent info
 */
function initializePlanState(): void {
  const plans = loadPlans()

  for (const plan of plans) {
    // Load activities for all plans (including completed) so history is viewable
    const activities = loadPlanActivities(plan.id)
    if (activities.length > 0) {
      planActivities.set(plan.id, activities)
      console.log(`[PlanManager] Loaded ${activities.length} activities for plan ${plan.id}`)
    }

    // Only load headless agent info for active plans (they may need monitoring)
    if (plan.status === 'delegating' || plan.status === 'in_progress' || plan.status === 'ready_for_review') {
      const agents = loadHeadlessAgentInfo(plan.id)
      for (const agent of agents) {
        if (agent.taskId) {
          headlessAgentInfo.set(agent.taskId, agent)
          console.log(`[PlanManager] Loaded headless agent info for task ${agent.taskId}`)
        }
      }
    }
  }
}

/**
 * Generate a unique plan ID
 */
function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a new plan in draft status
 */
export async function createPlan(
  title: string,
  description: string,
  options?: {
    maxParallelAgents?: number
    branchStrategy?: BranchStrategy
  }
): Promise<Plan> {
  const now = new Date().toISOString()
  const planId = generatePlanId()
  const branchStrategy = options?.branchStrategy ?? 'feature_branch'

  const plan: Plan = {
    id: planId,
    title,
    description,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    referenceAgentId: null,
    beadEpicId: null,
    orchestratorWorkspaceId: null,
    orchestratorTabId: null,
    maxParallelAgents: options?.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS,
    worktrees: [],
    branchStrategy,
    // Generate feature branch name for feature_branch strategy
    featureBranch: branchStrategy === 'feature_branch'
      ? `bismarck/${planId.split('-')[1]}/feature`
      : undefined,
    gitSummary: {
      commits: branchStrategy === 'feature_branch' ? [] : undefined,
      pullRequests: branchStrategy === 'raise_prs' ? [] : undefined,
    },
  }

  await savePlan(plan)
  emitPlanUpdate(plan)
  return plan
}

/**
 * Get all plans
 */
export function getPlans(): Plan[] {
  return loadPlans()
}

/**
 * Delete a plan and its associated data (plan directory)
 */
export async function deletePlanById(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  const logCtx: LogContext = { planId }
  if (!plan) {
    logger.warn('plan', `Plan not found for deletion: ${planId}`, logCtx)
    return
  }

  logger.info('plan', `Deleting plan: ${planId}`, logCtx, { title: plan.title })

  // Clean up any active agents/terminals
  if (plan.discussionAgentWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.discussionAgentWorkspaceId)
    if (terminalId) closeTerminal(terminalId)
    removeActiveWorkspace(plan.discussionAgentWorkspaceId)
    deleteWorkspace(plan.discussionAgentWorkspaceId)
  }

  if (plan.orchestratorWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.orchestratorWorkspaceId)
    if (terminalId) closeTerminal(terminalId)
    removeActiveWorkspace(plan.orchestratorWorkspaceId)
    deleteWorkspace(plan.orchestratorWorkspaceId)
  }

  if (plan.orchestratorTabId) {
    deleteTab(plan.orchestratorTabId)
  }

  // Clear in-memory state
  planActivities.delete(planId)
  executingPlans.delete(planId)

  // Remove from plans.json
  await deletePlan(planId)

  // Delete plan directory at ~/.bismarck/plans/<planId>/
  const planDir = getPlanDir(planId)
  try {
    await fs.rm(planDir, { recursive: true, force: true })
    logger.info('plan', `Deleted plan directory: ${planDir}`, logCtx)
  } catch (error) {
    // Directory may not exist, that's okay
    logger.debug('plan', `Could not delete plan directory (may not exist): ${planDir}`, logCtx)
  }

  // Emit deletion event
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('plan-deleted', planId)
  }
}

/**
 * Delete multiple plans
 */
export async function deletePlansById(planIds: string[]): Promise<{ deleted: string[]; errors: Array<{ planId: string; error: string }> }> {
  const deleted: string[] = []
  const errors: Array<{ planId: string; error: string }> = []

  for (const planId of planIds) {
    try {
      await deletePlanById(planId)
      deleted.push(planId)
    } catch (error) {
      errors.push({
        planId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { deleted, errors }
}

/**
 * Clone a plan - creates fresh copy with new ID
 * Copies: title, description, branchStrategy, maxParallelAgents
 * Optionally copies: discussion output (if includeDiscussion is true)
 */
export async function clonePlan(
  planId: string,
  options?: { includeDiscussion?: boolean }
): Promise<Plan> {
  const source = getPlanById(planId)
  if (!source) {
    throw new Error(`Plan not found: ${planId}`)
  }

  const now = new Date().toISOString()
  const newPlanId = generatePlanId()
  const logCtx: LogContext = { planId }

  const newPlan: Plan = {
    id: newPlanId,
    title: `${source.title} (Copy)`,
    description: source.description,
    status: options?.includeDiscussion && source.discussionOutputPath ? 'discussed' : 'draft',
    createdAt: now,
    updatedAt: now,
    referenceAgentId: null,
    beadEpicId: null,
    orchestratorWorkspaceId: null,
    orchestratorTabId: null,
    branchStrategy: source.branchStrategy,
    maxParallelAgents: source.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS,
    worktrees: [],
    // Generate new feature branch name for feature_branch strategy
    featureBranch: source.branchStrategy === 'feature_branch'
      ? `bismarck/${newPlanId.split('-')[1]}/feature`
      : undefined,
    gitSummary: {
      commits: source.branchStrategy === 'feature_branch' ? [] : undefined,
      pullRequests: source.branchStrategy === 'raise_prs' ? [] : undefined,
    },
  }

  // Copy discussion if requested and available
  if (options?.includeDiscussion && source.discussionOutputPath) {
    const newPlanDir = getPlanDir(newPlanId)

    // Ensure new plan directory exists
    await fs.mkdir(newPlanDir, { recursive: true })

    // Copy discussion output file
    const newDiscussionPath = path.join(newPlanDir, 'discussion-output.md')
    try {
      await fs.copyFile(source.discussionOutputPath, newDiscussionPath)
      newPlan.discussionOutputPath = newDiscussionPath
      logger.info('plan', `Copied discussion output to: ${newDiscussionPath}`, { planId: newPlanId })
    } catch (error) {
      logger.warn('plan', `Failed to copy discussion output: ${error}`, logCtx)
      // Downgrade status to draft if we couldn't copy the discussion
      newPlan.status = 'draft'
    }

    // Copy discussion object with new IDs
    if (source.discussion) {
      newPlan.discussion = {
        ...source.discussion,
        id: generateDiscussionId(),
        planId: newPlanId,
      }
    }
  }

  await savePlan(newPlan)
  emitPlanUpdate(newPlan)
  logger.info('plan', `Cloned plan ${planId} to ${newPlanId}`, logCtx, { newPlanId, title: newPlan.title })

  return newPlan
}

/**
 * Get task assignments for a specific plan
 */
export function getTaskAssignments(planId: string): TaskAssignment[] {
  return loadTaskAssignments(planId)
}

/**
 * Update a plan's status
 */
export async function updatePlanStatus(planId: string, status: PlanStatus): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  plan.status = status
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)
  emitPlanUpdate(plan)
  return plan
}

/**
 * Generate a unique discussion ID
 */
function generateDiscussionId(): string {
  return `disc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Build the prompt for the Discussion Agent
 * This agent engages the user in structured brainstorming BEFORE task creation
 */
async function buildDiscussionAgentPrompt(plan: Plan, codebasePath: string): Promise<string> {
  const planDir = getPlanDir(plan.id)

  const variables: PromptVariables = {
    planTitle: plan.title,
    planDescription: plan.description,
    codebasePath,
    planDir,
  }

  return buildPrompt('discussion', variables)
}

/**
 * Start a discussion phase for a plan
 * This engages the user in structured brainstorming before task creation
 */
export async function startDiscussion(planId: string, referenceAgentId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  // Only start discussion from draft status
  if (plan.status !== 'draft') {
    console.log(`[PlanManager] Cannot start discussion for plan ${planId} - status is ${plan.status}`)
    return plan
  }

  // Get reference workspace for codebase path
  const allAgents = getWorkspaces()
  const referenceWorkspace = allAgents.find(a => a.id === referenceAgentId)

  if (!referenceWorkspace) {
    addPlanActivity(planId, 'error', `Reference agent not found: ${referenceAgentId}`)
    return null
  }

  // Create discussion state
  const discussion: PlanDiscussion = {
    id: generateDiscussionId(),
    planId,
    status: 'active',
    messages: [],
    startedAt: new Date().toISOString(),
  }

  // Update plan status and set reference agent
  plan.status = 'discussing'
  plan.referenceAgentId = referenceAgentId
  plan.discussion = discussion
  plan.updatedAt = new Date().toISOString()

  // Create a dedicated tab for the discussion
  const discussionTab = createTab(`💬 ${plan.title.substring(0, 15)}`, { isPlanTab: true, planId: plan.id })
  plan.orchestratorTabId = discussionTab.id

  await savePlan(plan)
  emitPlanUpdate(plan)

  addPlanActivity(planId, 'info', 'Discussion phase started')

  // Create discussion agent workspace
  const discussionWorkspace: Workspace = {
    id: `discussion-${planId}`,
    name: `Discussion (${plan.title})`,
    directory: referenceWorkspace.directory, // Run in the codebase directory
    purpose: 'Plan discussion and refinement',
    theme: 'purple',
    icon: getRandomUniqueIcon(allAgents),
  }
  saveWorkspace(discussionWorkspace)
  plan.discussionAgentWorkspaceId = discussionWorkspace.id
  await savePlan(plan)

  // Create terminal for discussion agent
  if (mainWindow) {
    try {
      const discussionPrompt = await buildDiscussionAgentPrompt(plan, referenceWorkspace.directory)
      const claudeFlags = `--add-dir "${referenceWorkspace.directory}"`

      console.log(`[PlanManager] Creating terminal for discussion agent ${discussionWorkspace.id}`)
      const terminalId = await queueTerminalCreation(discussionWorkspace.id, mainWindow, {
        initialPrompt: discussionPrompt,
        claudeFlags,
      })
      console.log(`[PlanManager] Created discussion terminal: ${terminalId}`)

      addActiveWorkspace(discussionWorkspace.id)
      addWorkspaceToTab(discussionWorkspace.id, discussionTab.id)
      setActiveTab(discussionTab.id)

      // Notify renderer about the new terminal and maximize it
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId,
          workspaceId: discussionWorkspace.id,
        })
        // Send maximize event to renderer so it displays full screen
        mainWindow.webContents.send('maximize-workspace', discussionWorkspace.id)
      }

      // Set up listener for discussion agent completion
      // Watch for the discussion output file being written
      const discussionOutputPath = `${getPlanDir(planId)}/discussion-output.md`
      const discussionEmitter = getTerminalEmitter(terminalId)
      let completionTriggered = false

      if (discussionEmitter) {
        const exitHandler = async (data: string) => {
          if (completionTriggered) return

          // Check if discussion output file was written
          // Look for the Write tool output or file creation confirmation
          if (data.includes('discussion-output.md') && (data.includes('Wrote') || data.includes('lines to'))) {
            // Verify file exists before completing
            try {
              await fs.access(discussionOutputPath)
              completionTriggered = true
              discussionEmitter.removeListener('data', exitHandler)
              completeDiscussion(planId)
            } catch {
              // File not created yet, keep waiting
            }
          }
        }
        discussionEmitter.on('data', exitHandler)
      }

      addPlanActivity(planId, 'success', 'Discussion agent started - waiting for input')
      emitStateUpdate()
    } catch (error) {
      console.error(`[PlanManager] Failed to create discussion terminal:`, error)
      addPlanActivity(planId, 'error', 'Failed to start discussion', error instanceof Error ? error.message : 'Unknown error')
    }
  } else {
    console.error(`[PlanManager] Cannot create discussion terminal - mainWindow is null`)
    addPlanActivity(planId, 'error', 'Cannot start discussion - window not available')
  }

  return plan
}

/**
 * Complete the discussion phase and transition to execution
 */
async function completeDiscussion(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'discussing') return

  // Update discussion status
  if (plan.discussion) {
    plan.discussion.status = 'approved'
    plan.discussion.approvedAt = new Date().toISOString()
    // Generate a summary from the discussion (the agent should have done this)
    plan.discussion.summary = 'Discussion completed - see discussion-output.md for decisions made.'
  }

  // Store the path to the discussion output file
  plan.discussionOutputPath = `${getPlanDir(planId)}/discussion-output.md`

  // Cleanup discussion agent
  if (plan.discussionAgentWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.discussionAgentWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeActiveWorkspace(plan.discussionAgentWorkspaceId)
    removeWorkspaceFromTab(plan.discussionAgentWorkspaceId)
    deleteWorkspace(plan.discussionAgentWorkspaceId)
    plan.discussionAgentWorkspaceId = null
  }

  // Transition to 'discussed' status - ready for execution
  plan.status = 'discussed'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)

  addPlanActivity(planId, 'success', 'Discussion completed - ready for execution')
  emitPlanUpdate(plan)
  emitStateUpdate()
}

/**
 * Cancel a discussion and return to draft status
 */
export async function cancelDiscussion(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'discussing') return plan || null

  // Update discussion status
  if (plan.discussion) {
    plan.discussion.status = 'cancelled'
  }

  // Cleanup discussion agent
  if (plan.discussionAgentWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.discussionAgentWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeActiveWorkspace(plan.discussionAgentWorkspaceId)
    removeWorkspaceFromTab(plan.discussionAgentWorkspaceId)
    deleteWorkspace(plan.discussionAgentWorkspaceId)
    plan.discussionAgentWorkspaceId = null
  }

  // Delete the tab
  if (plan.orchestratorTabId) {
    deleteTab(plan.orchestratorTabId)
    plan.orchestratorTabId = null
  }

  // Return to draft status
  plan.status = 'draft'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)

  addPlanActivity(planId, 'info', 'Discussion cancelled - returned to draft')
  emitPlanUpdate(plan)
  emitStateUpdate()

  return plan
}

/**
 * Execute a plan using a reference agent's working directory
 */
export async function executePlan(planId: string, referenceAgentId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Starting plan execution', logCtx, { referenceAgentId, title: plan.title })

  // Guard against duplicate execution (can happen due to React StrictMode double-invocation)
  // Use in-memory set because status check alone isn't fast enough - the second call
  // arrives before the first call has persisted the status change
  if (executingPlans.has(planId) || plan.status === 'delegating' || plan.status === 'in_progress') {
    logger.info('plan', 'Skipping duplicate execution call', logCtx, {
      inExecutingSet: executingPlans.has(planId),
      status: plan.status,
    })
    return plan
  }

  // Mark as executing immediately to block any concurrent calls
  executingPlans.add(planId)
  logger.time(`plan-execute-${planId}`)

  // Clear any previous activities for this plan
  clearPlanActivities(planId)

  // Get reference agent name for logging
  const allAgents = getWorkspaces()
  const referenceAgent = allAgents.find(a => a.id === referenceAgentId)
  const referenceName = referenceAgent?.name || referenceAgentId
  const referenceWorkspace = allAgents.find(a => a.id === referenceAgentId)

  if (!referenceWorkspace) {
    logger.error('plan', 'Reference agent not found', logCtx, { referenceAgentId })
    addPlanActivity(planId, 'error', `Reference agent not found: ${referenceAgentId}`)
    return null
  }

  logger.info('plan', `Using reference workspace: ${referenceName}`, logCtx, {
    directory: referenceWorkspace.directory,
  })
  addPlanActivity(planId, 'info', `Plan execution started with reference: ${referenceName}`)

  // Ensure beads repo exists for this plan (creates ~/.bismarck/plans/{plan_id}/)
  const planDir = await ensureBeadsRepo(plan.id)

  // Update plan with reference agent and set status to delegating
  plan.referenceAgentId = referenceAgentId
  plan.status = 'delegating'
  plan.updatedAt = new Date().toISOString()

  // Create a dedicated tab for the orchestrator BEFORE emitting update
  // so renderer has the orchestratorTabId for headless agent lookup
  const orchestratorTab = createTab(plan.title.substring(0, 20), { isPlanTab: true, planId: plan.id })
  plan.orchestratorTabId = orchestratorTab.id

  await savePlan(plan)
  emitPlanUpdate(plan)

  // Create orchestrator workspace (runs in plan directory to work with bd tasks)
  const orchestratorWorkspace: Workspace = {
    id: `orchestrator-${planId}`,
    name: `Orchestrator (${plan.title})`,
    directory: planDir, // Orchestrator runs in plan directory
    purpose: 'Plan orchestration - monitors task completion',
    theme: 'gray',
    icon: getRandomUniqueIcon(allAgents),
    isOrchestrator: true, // Mark as orchestrator for filtering in processReadyTask
  }
  saveWorkspace(orchestratorWorkspace)
  plan.orchestratorWorkspaceId = orchestratorWorkspace.id
  await savePlan(plan)

  // Create terminal for orchestrator and add to its dedicated tab
  console.log(`[PlanManager] mainWindow is: ${mainWindow ? 'defined' : 'NULL'}`)
  if (mainWindow) {
    try {
      // Build the orchestrator prompt and pass it to queueTerminalCreation
      // Claude will automatically process it when it's ready
      // Pass --add-dir flag so orchestrator has permission to access plan directory without prompts
      const claudeFlags = `--add-dir "${planDir}"`
      const orchestratorPrompt = await buildOrchestratorPrompt(plan, allAgents)
      console.log(`[PlanManager] Creating terminal for orchestrator ${orchestratorWorkspace.id}`)
      const orchestratorTerminalId = await queueTerminalCreation(orchestratorWorkspace.id, mainWindow, {
        initialPrompt: orchestratorPrompt,
        claudeFlags,
      })
      console.log(`[PlanManager] Created terminal: ${orchestratorTerminalId}`)
      addActiveWorkspace(orchestratorWorkspace.id)
      addWorkspaceToTab(orchestratorWorkspace.id, orchestratorTab.id)
      addPlanActivity(planId, 'info', 'Orchestrator agent started')
      addPlanActivity(planId, 'success', 'Orchestrator monitoring started')

      // Notify renderer about the new terminal
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId: orchestratorTerminalId,
          workspaceId: orchestratorWorkspace.id,
        })
      }

      // Create plan agent workspace (runs in plan directory so bd commands work without cd)
      const planAgentWorkspace: Workspace = {
        id: `plan-agent-${planId}`,
        name: `Planner (${plan.title})`,
        directory: planDir, // Plan agent runs in plan directory for bd commands
        purpose: 'Initial discovery and task creation',
        theme: 'blue',
        icon: getRandomUniqueIcon(allAgents),
        isPlanAgent: true,
      }
      saveWorkspace(planAgentWorkspace)
      plan.planAgentWorkspaceId = planAgentWorkspace.id
      await savePlan(plan)

      // Create terminal with plan agent prompt
      // Pass --add-dir flags so plan agent can access both plan directory and codebase
      const planAgentClaudeFlags = `--add-dir "${planDir}" --add-dir "${referenceWorkspace.directory}"`
      const planAgentPrompt = await buildPlanAgentPrompt(plan, allAgents, referenceWorkspace.directory)
      console.log(`[PlanManager] Creating terminal for plan agent ${planAgentWorkspace.id}`)
      const planAgentTerminalId = await queueTerminalCreation(planAgentWorkspace.id, mainWindow, {
        initialPrompt: planAgentPrompt,
        claudeFlags: planAgentClaudeFlags,
      })
      console.log(`[PlanManager] Created plan agent terminal: ${planAgentTerminalId}`)
      addActiveWorkspace(planAgentWorkspace.id)
      addWorkspaceToTab(planAgentWorkspace.id, orchestratorTab.id)
      addPlanActivity(planId, 'info', 'Plan agent started')

      // Notify renderer about the plan agent terminal
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId: planAgentTerminalId,
          workspaceId: planAgentWorkspace.id,
        })
      }

      // Set up listener for plan agent exit
      const planAgentEmitter = getTerminalEmitter(planAgentTerminalId)
      if (planAgentEmitter) {
        const exitHandler = (data: string) => {
          // Claude shows "Goodbye!" when /exit is used
          if (data.includes('Goodbye') || data.includes('Session ended')) {
            planAgentEmitter.removeListener('data', exitHandler)
            cleanupPlanAgent(plan).catch((err) => {
              console.error('[PlanManager] Error cleaning up plan agent:', err)
            })
          }
        }
        planAgentEmitter.on('data', exitHandler)
      }

      // Emit state update so renderer knows about the new tab
      emitStateUpdate()
    } catch (error) {
      console.error(`[PlanManager] Failed to create orchestrator terminal:`, error)
      addPlanActivity(planId, 'error', 'Failed to start orchestrator', error instanceof Error ? error.message : 'Unknown error')
      // Clean up executingPlans to allow retry
      executingPlans.delete(planId)
      // Revert status since we couldn't actually execute
      plan.status = 'discussed'
      plan.updatedAt = new Date().toISOString()
      await savePlan(plan)
      emitPlanUpdate(plan)
      return plan
    }
  } else {
    console.error(`[PlanManager] Cannot create orchestrator terminal - mainWindow is null`)
    addPlanActivity(planId, 'error', 'Cannot start orchestrator - window not available')
    // Clean up executingPlans to allow retry
    executingPlans.delete(planId)
    // Revert status since we couldn't actually execute
    plan.status = 'discussed'
    plan.updatedAt = new Date().toISOString()
    await savePlan(plan)
    emitPlanUpdate(plan)
    return plan
  }

  // Start polling for task updates for this plan
  startTaskPolling(plan.id)
  addPlanActivity(planId, 'info', 'Watching for tasks...')

  return plan
}

/**
 * Cancel a plan
 */
export async function cancelPlan(planId: string): Promise<Plan | null> {
  const logCtx: LogContext = { planId }
  logger.info('plan', 'Cancelling plan', logCtx, { previousStatus: getPlanById(planId)?.status })

  const plan = getPlanById(planId)
  if (!plan) {
    logger.warn('plan', 'Cannot cancel plan - not found', logCtx)
    return null
  }

  // 1. Kill all agents immediately (closes terminals and stops containers)
  logger.info('plan', 'Killing all plan agents', logCtx)
  const killStartTime = Date.now()
  await killAllPlanAgents(plan)
  logger.info('plan', 'Finished killing all plan agents', logCtx, { durationMs: Date.now() - killStartTime })

  // 2. Update plan state BEFORE worktree cleanup so UI knows plan is cancelled immediately
  plan.status = 'failed'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)
  logger.info('plan', 'Plan status set to failed, emitting update', logCtx)
  emitPlanUpdate(plan)
  addPlanActivity(planId, 'error', 'Plan cancelled', 'Execution was stopped by user')

  // Remove from executing set
  executingPlans.delete(planId)

  // 3. Cleanup worktrees (slow - git operations, done after UI update)
  logger.info('plan', 'Cleaning up worktrees', logCtx)
  const cleanupStartTime = Date.now()
  await cleanupAllWorktreesOnly(planId)
  logger.info('plan', 'Finished cleaning up worktrees', logCtx, { durationMs: Date.now() - cleanupStartTime })

  logger.info('plan', 'Plan cancellation complete', logCtx)

  return plan
}

/**
 * Restart a failed plan, preserving any completed discussion
 * This cleans up all execution state and returns the plan to draft or discussed status
 */
export async function restartPlan(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  if (plan.status !== 'failed') {
    console.log(`[PlanManager] Cannot restart plan ${planId} - status is ${plan.status}`)
    return plan
  }

  // 1. Kill any remaining agents and close tabs (in case cancelPlan didn't fully cleanup)
  await killAllPlanAgents(plan)

  // 2. Cleanup any remaining worktrees
  await cleanupAllWorktreesOnly(planId)

  // 3. Delete remote branches (task branches and feature branch)
  await deleteRemoteBranchesForPlan(plan)

  // Target status: 'discussed' if had approved discussion, else 'draft'
  const hadApprovedDiscussion = plan.discussion?.status === 'approved'
  const targetStatus: PlanStatus = hadApprovedDiscussion ? 'discussed' : 'draft'

  // Clear execution state (keep discussion intact)
  plan.worktrees = []
  plan.gitSummary = {
    commits: plan.branchStrategy === 'feature_branch' ? [] : undefined,
    pullRequests: plan.branchStrategy === 'raise_prs' ? [] : undefined,
  }
  plan.beadEpicId = null
  plan.referenceAgentId = null
  plan.orchestratorWorkspaceId = null
  plan.orchestratorTabId = null
  plan.planAgentWorkspaceId = null
  // Reset feature branch so a new one is created on next execution
  plan.featureBranch = undefined

  plan.status = targetStatus
  plan.updatedAt = new Date().toISOString()

  // Clear activity log and task assignments
  clearPlanActivities(planId)
  saveTaskAssignments(planId, [])

  // Clear beads directory (tasks), keep discussion-output.md
  const planDir = getPlanDir(planId)
  const beadsDir = path.join(planDir, '.beads')
  try {
    await fs.rm(beadsDir, { recursive: true, force: true })
  } catch { /* ignore */ }

  await savePlan(plan)
  emitPlanUpdate(plan)
  addPlanActivity(planId, 'info', 'Plan restarted',
    hadApprovedDiscussion ? 'Discussion preserved' : 'Returned to draft')

  return plan
}

/**
 * Delete remote branches created during plan execution
 */
async function deleteRemoteBranchesForPlan(plan: Plan): Promise<void> {
  const branchesToDelete: { repoPath: string; branch: string }[] = []

  // Collect task branches from worktrees
  if (plan.worktrees) {
    for (const worktree of plan.worktrees) {
      if (worktree.branch && worktree.repositoryId) {
        const repo = await getRepositoryById(worktree.repositoryId)
        if (repo) {
          branchesToDelete.push({ repoPath: repo.rootPath, branch: worktree.branch })
        }
      }
    }
  }

  // Add feature branch if it exists
  if (plan.featureBranch) {
    // Find any repository to delete the feature branch from
    const repos = await getAllRepositories()
    if (repos.length > 0) {
      branchesToDelete.push({ repoPath: repos[0].rootPath, branch: plan.featureBranch })
    }
  }

  // Delete each branch, ignoring errors (branch may not exist on remote)
  for (const { repoPath, branch } of branchesToDelete) {
    try {
      await deleteRemoteBranch(repoPath, branch)
      console.log(`[PlanManager] Deleted remote branch: ${branch}`)
    } catch (error) {
      // Branch may not exist on remote, or already deleted
      console.log(`[PlanManager] Could not delete remote branch ${branch}: ${error}`)
    }
  }
}

/**
 * Kill all agents for a plan without cleaning up worktrees
 * This is fast because it just closes terminals/containers
 */
async function killAllPlanAgents(plan: Plan): Promise<void> {
  const logCtx: LogContext = { planId: plan.id }

  // Stop all headless agents for this plan first
  const headlessAgentCount = Array.from(headlessAgentInfo.values()).filter((info) => info.planId === plan.id).length
  logger.info('plan', 'Stopping headless agents', logCtx, { count: headlessAgentCount })
  await stopAllHeadlessAgents(plan.id)
  logger.info('plan', 'Headless agents stopped', logCtx)

  // Kill task agents (interactive mode)
  if (plan.worktrees) {
    const worktreesWithAgents = plan.worktrees.filter((w) => w.agentId)
    logger.debug('plan', 'Killing interactive task agents', logCtx, { count: worktreesWithAgents.length })
    for (const worktree of plan.worktrees) {
      if (worktree.agentId) {
        logger.debug('plan', 'Killing task agent', logCtx, { agentId: worktree.agentId, taskId: worktree.taskId })
        const terminalId = getTerminalForWorkspace(worktree.agentId)
        if (terminalId) closeTerminal(terminalId)
        removeActiveWorkspace(worktree.agentId)
        removeWorkspaceFromTab(worktree.agentId)
        deleteWorkspace(worktree.agentId)
      }
    }
  }

  // Kill plan agent
  if (plan.planAgentWorkspaceId) {
    logger.debug('plan', 'Killing plan agent', logCtx, { workspaceId: plan.planAgentWorkspaceId })
    const terminalId = getTerminalForWorkspace(plan.planAgentWorkspaceId)
    if (terminalId) closeTerminal(terminalId)
    removeActiveWorkspace(plan.planAgentWorkspaceId)
    removeWorkspaceFromTab(plan.planAgentWorkspaceId)
    deleteWorkspace(plan.planAgentWorkspaceId)
    plan.planAgentWorkspaceId = null
  }

  // Kill orchestrator
  if (plan.orchestratorWorkspaceId) {
    logger.debug('plan', 'Killing orchestrator', logCtx, { workspaceId: plan.orchestratorWorkspaceId })
    const terminalId = getTerminalForWorkspace(plan.orchestratorWorkspaceId)
    if (terminalId) closeTerminal(terminalId)
    removeActiveWorkspace(plan.orchestratorWorkspaceId)
    deleteWorkspace(plan.orchestratorWorkspaceId)
    plan.orchestratorWorkspaceId = null
  }

  // Delete orchestrator tab
  if (plan.orchestratorTabId) {
    logger.debug('plan', 'Deleting orchestrator tab', logCtx, { tabId: plan.orchestratorTabId })
    deleteTab(plan.orchestratorTabId)
    plan.orchestratorTabId = null
  }

  // Emit state update so renderer reloads workspaces (clears headless agents from sidebar)
  emitStateUpdate()

  logger.info('plan', 'All plan agents killed', logCtx)
}

/**
 * Cleanup worktrees only (without killing agents - they should already be killed)
 * This is the slow part due to git operations
 */
async function cleanupAllWorktreesOnly(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan) return

  // Clean up tracked worktrees (existing logic)
  if (plan.worktrees) {
    for (const worktree of plan.worktrees) {
      if (worktree.status === 'cleaned') continue

      const repository = await getRepositoryById(worktree.repositoryId)
      if (repository) {
        try {
          await removeWorktree(repository.rootPath, worktree.path, true)
        } catch {
          // Ignore errors, continue cleanup
        }
        // Delete the local branch after removing worktree
        if (worktree.branch) {
          try {
            await deleteLocalBranch(repository.rootPath, worktree.branch)
          } catch {
            // Branch may not exist or already deleted
          }
        }
      }
      worktree.status = 'cleaned'
    }
  }

  await savePlan(plan)

  // Also clean up the entire worktrees directory for this plan
  // This catches any directories not tracked in plan state
  const planWorktreesDir = getPlanWorktreesPath(planId)
  const repositories = await getAllRepositories()
  try {
    const stat = await fs.stat(planWorktreesDir)
    if (stat.isDirectory()) {
      // Get all repo subdirs
      const repoDirs = await fs.readdir(planWorktreesDir)
      for (const repoName of repoDirs) {
        const repoWorktreesPath = path.join(planWorktreesDir, repoName)
        let worktreeDirs: string[] = []
        try {
          worktreeDirs = await fs.readdir(repoWorktreesPath)
        } catch {
          // Directory may not exist or not be readable
          continue
        }

        // Find the actual repository to run git commands
        const repo = repositories.find(r => r.name === repoName)
        if (repo) {
          for (const wtDir of worktreeDirs) {
            const wtPath = path.join(repoWorktreesPath, wtDir)
            try {
              await removeWorktree(repo.rootPath, wtPath, true)
            } catch { /* ignore */ }
          }
        }
      }

      // Finally, remove the entire worktrees directory
      await fs.rm(planWorktreesDir, { recursive: true, force: true })
    }
  } catch { /* directory doesn't exist, ignore */ }

  // Prune stale worktree refs across all repos
  for (const repo of repositories) {
    try {
      await pruneWorktrees(repo.rootPath)
    } catch { /* ignore */ }
  }
}

/**
 * Cleanup orchestrator workspace, terminal, and tab for a plan
 */
async function cleanupOrchestrator(plan: Plan): Promise<void> {
  // Also cleanup plan agent if it's still running
  await cleanupPlanAgentSilent(plan)

  if (plan.orchestratorWorkspaceId) {
    // Close terminal
    const terminalId = getTerminalForWorkspace(plan.orchestratorWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }

    // Remove from active workspaces
    removeActiveWorkspace(plan.orchestratorWorkspaceId)

    // Delete workspace
    deleteWorkspace(plan.orchestratorWorkspaceId)
    plan.orchestratorWorkspaceId = null
  }

  // Delete the dedicated orchestrator tab
  if (plan.orchestratorTabId) {
    deleteTab(plan.orchestratorTabId)
    plan.orchestratorTabId = null

    // Emit state update so renderer knows the tab was removed
    emitStateUpdate()
  }
}

/**
 * Build the prompt to inject into the reference agent's terminal
 * Returns only instructions with trailing newline (no /clear - handled separately)
 * NOTE: This function is currently unused but kept for reference
 */
function buildReferencePrompt(plan: Plan, agents: Agent[]): string {
  // Filter out orchestrator agents from available agents
  const availableAgents = agents.filter(a => !a.isOrchestrator)

  const agentList = availableAgents
    .map((a) => `- ${a.name} (id: ${a.id}): ${a.purpose || 'General purpose agent'}`)
    .join('\n')

  const planDir = getPlanDir(plan.id)

  const instructions = `[BISMARCK PLAN REQUEST]
Plan ID: ${plan.id}
Title: ${plan.title}
Description: ${plan.description}

Available Agents:
${agentList}

Instructions:
IMPORTANT: All bd commands must run in ${planDir} directory.

1. Create bd epic: cd ${planDir} && bd --sandbox create --type epic "${plan.title}"
2. Create tasks: cd ${planDir} && bd --sandbox create --parent <epic-id> "task title"
3. Set dependencies: cd ${planDir} && bd --sandbox dep <blocking-task-id> --blocks <blocked-task-id>
4. Assign: cd ${planDir} && bd --sandbox update <task-id> --assignee <agent-name>
5. Mark FIRST task ready: cd ${planDir} && bd --sandbox update <first-task-id> --add-label bismarck-ready

The orchestrator will automatically mark dependent tasks ready when their blockers complete.
After marking a task with 'bismarck-ready', Bismarck will automatically send it to the assigned agent.`

  return instructions
}

/**
 * Start polling bd for task updates for a specific plan
 * @param planId - The ID of the plan to poll for
 */
export function startTaskPolling(planId: string): void {
  if (pollInterval) return // Already polling

  pollInterval = setInterval(async () => {
    await syncTasksForPlan(planId)
  }, POLL_INTERVAL_MS)

  // Do an immediate sync
  syncTasksForPlan(planId)
}

/**
 * Stop polling bd for task updates
 */
export function stopTaskPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

/**
 * Sync tasks from bd and dispatch to agents for a specific plan
 * Uses in-memory plan state via getPlanById instead of reading from disk
 * @param planId - The ID of the plan to sync tasks for
 */
async function syncTasksForPlan(planId: string): Promise<void> {
  // Guard against overlapping syncs - prevents race conditions when creating worktrees
  if (syncInProgress) {
    return
  }
  syncInProgress = true

  try {
    await doSyncTasksForPlan(planId)
  } finally {
    syncInProgress = false
  }
}

/**
 * Internal implementation of sync - called by syncTasksForPlan with guard
 */
async function doSyncTasksForPlan(planId: string): Promise<void> {
  // Get the plan from in-memory cache (via getPlanById which loads from disk only if not cached)
  const activePlan = getPlanById(planId)
  const logCtx: LogContext = { planId }

  // If plan no longer exists or is no longer active, stop polling
  // Include ready_for_review to detect new follow-up tasks
  if (!activePlan || (activePlan.status !== 'delegating' && activePlan.status !== 'in_progress' && activePlan.status !== 'ready_for_review')) {
    logger.debug('plan', 'Plan no longer active, stopping polling', logCtx, { status: activePlan?.status })
    stopTaskPolling()
    return
  }

  logger.debug('plan', 'Syncing tasks from bd', logCtx)

  try {
    // Get tasks marked as ready for Bismarck (from the active plan's directory)
    const readyTasks = await bdList(activePlan.id, { labels: ['bismarck-ready'], status: 'open' })
    if (readyTasks.length > 0) {
      logger.info('plan', `Found ${readyTasks.length} ready tasks`, logCtx, {
        taskIds: readyTasks.map(t => t.id),
      })
    }

    for (const task of readyTasks) {
      await processReadyTask(activePlan.id, task)
    }

    // Check for completed tasks and update assignments
    const allAssignments = loadTaskAssignments(activePlan.id)
    const closedTasks = await bdList(activePlan.id, { status: 'closed' })

    for (const assignment of allAssignments) {
      if (assignment.status === 'sent' || assignment.status === 'in_progress') {
        // Check if task is now closed in bd
        const closedTask = closedTasks.find((t) => t.id === assignment.beadId)
        if (closedTask) {
          assignment.status = 'completed'
          assignment.completedAt = new Date().toISOString()
          saveTaskAssignment(activePlan.id, assignment)
          emitTaskAssignmentUpdate(assignment)

          // Log completion
          const agent = getWorkspaces().find(a => a.id === assignment.agentId)
          addPlanActivity(
            activePlan.id,
            'success',
            `Task ${closedTask.id} completed`,
            agent ? `Completed by ${agent.name}` : undefined
          )
          // Task agents are kept alive - user can review their work and close them manually
        }
      }
    }

    // Update plan statuses based on task completion
    await updatePlanStatuses()

    // Notify renderer about task changes so UI can refresh
    emitBeadTasksUpdate(activePlan.id)
  } catch (error) {
    console.error('Error syncing tasks from bd:', error)
    addPlanActivity(
      activePlan.id,
      'error',
      'Failed to sync tasks',
      error instanceof Error ? error.message : 'bd command failed'
    )
  }
}

/**
 * Process a task that's ready to be sent to an agent
 * New model: Creates a fresh task agent with a worktree
 */
async function processReadyTask(planId: string, task: BeadTask): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan) return

  const logCtx: LogContext = { planId, taskId: task.id }
  logger.info('task', `Processing ready task: ${task.title}`, logCtx)

  // Check if we already have an assignment for this task
  const existingAssignments = loadTaskAssignments(planId)
  const existing = existingAssignments.find((a) => a.beadId === task.id)
  if (existing) {
    logger.debug('task', 'Task already assigned, skipping', logCtx)
    return // Already processing or processed
  }

  // Check if we can spawn more agents
  if (!canSpawnMoreAgents(planId)) {
    logger.debug('task', 'At max parallel agents, queuing task', logCtx, {
      maxParallel: plan.maxParallelAgents,
      activeCount: getActiveTaskAgentCount(planId),
    })
    // Queue for later - will be picked up on next poll when an agent finishes
    return
  }

  // Extract repository and worktree info from task
  // Expected format: task has repo and worktree in labels or description
  // The orchestrator sets these via: bd update <task-id> --repo "<repo-name>" --worktree "<name>"
  const repoLabel = task.labels?.find(l => l.startsWith('repo:'))
  const worktreeLabel = task.labels?.find(l => l.startsWith('worktree:'))

  if (!repoLabel || !worktreeLabel) {
    addPlanActivity(
      planId,
      'warning',
      `Task ${task.id} missing repo/worktree assignment`,
      'Orchestrator must assign repo and worktree before marking ready'
    )
    return
  }

  const repoName = repoLabel.substring('repo:'.length)
  const worktreeName = worktreeLabel.substring('worktree:'.length)

  // Find the repository
  const repositories = await getAllRepositories()
  const repository = repositories.find(r => r.name === repoName)

  if (!repository) {
    addPlanActivity(planId, 'warning', `Unknown repository: ${repoName}`, `Task ${task.id} cannot be dispatched`)
    return
  }

  // Log task discovery
  logger.info('task', `Task found: ${task.title}`, logCtx, {
    repo: repoName,
    worktree: worktreeName,
    blockedBy: task.blockedBy,
  })
  addPlanActivity(planId, 'info', `Processing task: ${task.id}`, `Repo: ${repoName}, Worktree: ${worktreeName}`)

  // For feature_branch strategy with dependent tasks, ensure we have the latest feature branch
  const hasBlockers = task.blockedBy && task.blockedBy.length > 0
  if (plan.branchStrategy === 'feature_branch' && hasBlockers && plan.featureBranch) {
    logger.debug('task', 'Checking for merge agent (dependent task)', logCtx, {
      featureBranch: plan.featureBranch,
      blockedBy: task.blockedBy,
    })

    // Check if we need to spawn a merge agent for parallel blocker tasks
    const mergeAgentSpawned = await maybeSpawnMergeAgent(plan, task)
    if (mergeAgentSpawned) {
      // Merge agent was spawned - this task will be retried after merge completes
      logger.info('task', 'Merge agent spawned, deferring task', logCtx)
      addPlanActivity(planId, 'info', `Merge agent spawned for task ${task.id}`, 'Waiting for parallel task commits to be merged')
      return
    }

    // Fetch the feature branch to ensure worktree has latest commits from blockers
    try {
      const featureBranchExists = await remoteBranchExists(repository.rootPath, plan.featureBranch)
      if (featureBranchExists) {
        logger.debug('task', 'Fetching feature branch for dependent task', logCtx, { branch: plan.featureBranch })
        await fetchBranch(repository.rootPath, plan.featureBranch, 'origin', logCtx)
        addPlanActivity(planId, 'info', `Fetched feature branch for dependent task`, plan.featureBranch)
      }
    } catch (error) {
      logger.warn('task', 'Failed to fetch feature branch', logCtx, {
        branch: plan.featureBranch,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      addPlanActivity(
        planId,
        'warning',
        `Failed to fetch feature branch`,
        error instanceof Error ? error.message : 'Unknown error'
      )
      // Continue anyway - the worktree creation will handle missing remote branch
    }
  }

  // Create task assignment
  const assignment: TaskAssignment = {
    beadId: task.id,
    agentId: '', // Will be set after agent creation
    planId: planId,
    status: 'pending',
    assignedAt: new Date().toISOString(),
  }
  saveTaskAssignment(planId, assignment)
  emitTaskAssignmentUpdate(assignment)

  // Create worktree and task agent
  logger.time(`worktree-setup-${task.id}`)
  const result = await createTaskAgentWithWorktree(planId, task, repository, worktreeName)
  if (!result) {
    logger.error('task', 'Failed to create task agent with worktree', logCtx)
    addPlanActivity(planId, 'error', `Failed to create task agent for ${task.id}`)
    return
  }

  const { agent, worktree } = result
  logger.timeEnd(`worktree-setup-${task.id}`, 'task', 'Worktree and agent created', logCtx)
  logger.info('task', 'Task agent created', { ...logCtx, agentId: agent.id }, {
    worktreePath: worktree.path,
    branch: worktree.branch,
  })
  assignment.agentId = agent.id

  // Branch based on execution mode
  if (useHeadlessMode) {
    logger.info('task', 'Starting headless agent', logCtx)
    // Headless mode: start agent in Docker container
    try {
      // Check for OAuth token before starting headless agent
      let token = getClaudeOAuthToken()
      if (!token) {
        // Notify renderer that OAuth setup is starting
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('oauth-setup-starting', { planId, taskId: task.id })
        }
        addPlanActivity(
          planId,
          'info',
          'OAuth token required - starting setup',
          'Opening browser for authentication...'
        )

        try {
          // Automatically run setup-token to get OAuth token
          token = await runSetupToken()
          addPlanActivity(planId, 'success', 'OAuth token obtained', 'Authentication successful')
        } catch (setupError) {
          addPlanActivity(
            planId,
            'error',
            'OAuth setup failed',
            setupError instanceof Error ? setupError.message : 'Unknown error'
          )
          throw new Error('OAuth token required for headless agents - setup failed')
        }
      }

      // Ensure tool proxy is running
      if (!isProxyRunning()) {
        await startToolProxy()
        addPlanActivity(planId, 'info', 'Tool proxy started')
      }
      setupBdCloseListener()

      await startHeadlessTaskAgent(planId, task, worktree, repository)

      // Set to in_progress immediately - agent is starting, not just queued
      assignment.status = 'in_progress'
      saveTaskAssignment(planId, assignment)
      emitTaskAssignmentUpdate(assignment)

      // Update bd labels
      await bdUpdate(planId, task.id, {
        removeLabels: ['bismarck-ready'],
        addLabels: ['bismarck-sent'],
      })

      // Notify renderer about headless agent
      console.log('[PlanManager] Sending headless-agent-started event', { taskId: task.id, planId, worktreePath: worktree.path })
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('headless-agent-started', {
          taskId: task.id,
          planId,
          worktreePath: worktree.path,
        })
        console.log('[PlanManager] headless-agent-started event sent successfully')
      } else {
        console.log('[PlanManager] Cannot send headless-agent-started - mainWindow:', mainWindow ? 'exists but destroyed' : 'null')
      }

      emitStateUpdate()
    } catch (error) {
      addPlanActivity(
        planId,
        'error',
        `Failed to start headless agent for ${task.id}`,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  } else {
    // Interactive mode: create terminal (existing behavior)
    if (mainWindow && plan.orchestratorTabId) {
      try {
        const taskPrompt = buildTaskPrompt(planId, task, repository)
        const planDir = getPlanDir(planId)
        const claudeFlags = `--add-dir "${worktree.path}" --add-dir "${planDir}"`

        const terminalId = await queueTerminalCreation(agent.id, mainWindow, {
          initialPrompt: taskPrompt,
          claudeFlags,
          autoAcceptMode: true,
        })
        addActiveWorkspace(agent.id)
        addWorkspaceToTab(agent.id, plan.orchestratorTabId)

        // Notify renderer about the new terminal
        mainWindow.webContents.send('terminal-created', {
          terminalId,
          workspaceId: agent.id,
        })

        // Set up listener for task completion
        const terminalEmitter = getTerminalEmitter(terminalId)
        if (terminalEmitter) {
          const exitHandler = async (data: string) => {
            if (data.includes('Goodbye') || data.includes('Session ended')) {
              terminalEmitter.removeListener('data', exitHandler)
              await markWorktreeReadyForReview(planId, task.id)
            }
          }
          terminalEmitter.on('data', exitHandler)
        }

        // Set to in_progress immediately - agent is starting, not just queued
        assignment.status = 'in_progress'
        saveTaskAssignment(planId, assignment)
        emitTaskAssignmentUpdate(assignment)

        // Update bd labels
        await bdUpdate(planId, task.id, {
          removeLabels: ['bismarck-ready'],
          addLabels: ['bismarck-sent'],
        })

        addPlanActivity(planId, 'success', `Task ${task.id} started`, `Agent created in worktree: ${worktreeName}`)
        emitStateUpdate()
      } catch (error) {
        addPlanActivity(
          planId,
          'error',
          `Failed to start task agent for ${task.id}`,
          error instanceof Error ? error.message : 'Unknown error'
        )
      }
    }
  }
}

/**
 * Build the prompt to inject into a worker agent's terminal for a task
 * Returns only instructions with trailing newline (no /clear - handled separately)
 */
function buildTaskPrompt(planId: string, task: BeadTask, repository?: Repository): string {
  const plan = getPlanById(planId)
  const planDir = getPlanDir(planId)
  // Prefer repository's detected defaultBranch over plan's potentially incorrect default
  const baseBranch = repository?.defaultBranch || 'main'

  // Build completion instructions based on branch strategy
  let completionInstructions: string
  if (plan?.branchStrategy === 'raise_prs') {
    completionInstructions = `2. Commit your changes with a clear message
3. Push your branch and create a PR using gh api (gh pr create has issues in worktrees):
   gh api repos/OWNER/REPO/pulls -f head="BRANCH" -f base="${baseBranch}" -f title="..." -f body="..."
4. Close task with PR URL: cd ${planDir} && bd --sandbox close ${task.id} --message "PR: <url>"`
  } else {
    // feature_branch strategy - just commit, pushing happens on completion
    completionInstructions = `2. Commit your changes with a clear message
3. Close task: cd ${planDir} && bd --sandbox close ${task.id} --message "Completed"`
  }

  const instructions = `[BISMARCK TASK ASSIGNMENT]
Task ID: ${task.id}
Title: ${task.title}

=== YOUR WORKING DIRECTORY ===
You are working in a dedicated git worktree for this task.
Branch: (see git branch)
Base: ${baseBranch}

=== COMPLETION REQUIREMENTS ===
1. Complete the work described in the task
${completionInstructions}

When finished, type /exit to signal completion.`

  return instructions
}

/**
 * Build the prompt to inject into the orchestrator agent's terminal
 * Returns only instructions with trailing newline (no /clear - handled separately)
 * Note: Orchestrator runs in the plan directory, so no 'cd' needed for bd commands
 */
async function buildOrchestratorPrompt(plan: Plan, agents: Agent[]): Promise<string> {
  // Get repositories from agents that have them
  const repositories = await getAllRepositories()

  // Find reference agent and its repository
  const referenceAgent = agents.find(a => a.id === plan.referenceAgentId)
  const referenceRepo = referenceAgent?.repositoryId
    ? repositories.find(r => r.id === referenceAgent.repositoryId)
    : null

  // Build repository list with purposes derived from agents
  const repoInfoList: string[] = []
  for (const repo of repositories) {
    // Find agents that use this repo to get purpose info
    const repoAgents = agents.filter(a => a.repositoryId === repo.id && !a.isOrchestrator && !a.isPlanAgent && !a.isTaskAgent)
    const purposes = repoAgents.map(a => a.purpose).filter(Boolean)
    const purpose = purposes.length > 0 ? purposes[0] : 'No description'

    repoInfoList.push(`- ${repo.name}: ${repo.rootPath} (branch: ${repo.defaultBranch})
    Purpose: ${purpose}`)
  }

  const repoList = repoInfoList.length > 0
    ? repoInfoList.join('\n')
    : '(No repositories detected - agents may not be linked to git repos)'

  const maxParallel = plan.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS

  const variables: PromptVariables = {
    planId: plan.id,
    planTitle: plan.title,
    repoList,
    maxParallel,
    referenceRepoName: referenceRepo?.name || repositories[0]?.name || 'unknown',
    referenceRepoPath: referenceRepo?.rootPath || '',
    referenceAgentName: referenceAgent?.name || 'unknown',
  }

  return buildPrompt('orchestrator', variables)
}

/**
 * Build the prompt for the planner that creates tasks
 * Note: Planner runs in the plan directory so bd commands work directly
 * It has access to the codebase via --add-dir flag for analysis
 *
 * The Planner is responsible for:
 * - Analyzing the codebase
 * - Creating epic + tasks
 * - Setting up dependencies
 *
 * The Orchestrator handles:
 * - Assigning tasks to agents
 * - Marking tasks as ready
 */
async function buildPlanAgentPrompt(plan: Plan, _agents: Agent[], codebasePath: string): Promise<string> {
  const planDir = getPlanDir(plan.id)

  // Include discussion context if a discussion was completed
  const discussionContext = plan.discussion?.status === 'approved' && plan.discussionOutputPath
    ? `
=== DISCUSSION OUTCOMES ===
A brainstorming discussion was completed before task creation.

Read the discussion outcomes at: ${plan.discussionOutputPath}

This file contains:
- Requirements agreed upon
- Architecture decisions made
- Testing strategy
- Edge cases to handle
- Proposed task breakdown with dependencies

IMPORTANT: Create tasks that match the structure in this file.
`
    : ''

  const variables: PromptVariables = {
    planId: plan.id,
    planTitle: plan.title,
    planDescription: plan.description,
    planDir,
    codebasePath,
    discussionContext,
  }

  return buildPrompt('planner', variables)
}

/**
 * Cleanup plan agent workspace, terminal for a plan
 */
async function cleanupPlanAgent(plan: Plan): Promise<void> {
  if (!plan.planAgentWorkspaceId) return

  // Close terminal
  const terminalId = getTerminalForWorkspace(plan.planAgentWorkspaceId)
  if (terminalId) {
    closeTerminal(terminalId)
  }

  // Remove from active workspaces
  removeActiveWorkspace(plan.planAgentWorkspaceId)

  // Remove from tab
  removeWorkspaceFromTab(plan.planAgentWorkspaceId)

  // Delete workspace config
  deleteWorkspace(plan.planAgentWorkspaceId)
  plan.planAgentWorkspaceId = null
  await savePlan(plan)

  addPlanActivity(plan.id, 'success', 'Plan agent completed task creation')
  emitStateUpdate()

  // Notify renderer to refresh task list now that plan agent has created tasks
  emitBeadTasksUpdate(plan.id)
}

/**
 * Cleanup plan agent without logging success (used for cancellation)
 */
async function cleanupPlanAgentSilent(plan: Plan): Promise<void> {
  if (!plan.planAgentWorkspaceId) return

  // Close terminal
  const terminalId = getTerminalForWorkspace(plan.planAgentWorkspaceId)
  if (terminalId) {
    closeTerminal(terminalId)
  }

  // Remove from active workspaces
  removeActiveWorkspace(plan.planAgentWorkspaceId)

  // Remove from tab
  removeWorkspaceFromTab(plan.planAgentWorkspaceId)

  // Delete workspace config
  deleteWorkspace(plan.planAgentWorkspaceId)
  plan.planAgentWorkspaceId = null
  await savePlan(plan)

  emitStateUpdate()
}

// ===============================================
// WORKTREE-BASED TASK AGENT FUNCTIONS
// ===============================================

/**
 * Check if we can spawn more task agents for a plan
 */
function canSpawnMoreAgents(planId: string): boolean {
  const plan = getPlanById(planId)
  if (!plan) return false

  const maxParallel = plan.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS
  const activeCount = getActiveTaskAgentCount(planId)

  return activeCount < maxParallel
}

/**
 * Get count of active task agents for a plan
 */
function getActiveTaskAgentCount(planId: string): number {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return 0

  return plan.worktrees.filter(w => w.status === 'active').length
}

/**
 * Generate a unique ID for a worktree
 */
function generateWorktreeId(): string {
  return `wt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a fresh worktree and task agent for a task
 */
async function createTaskAgentWithWorktree(
  planId: string,
  task: BeadTask,
  repository: Repository,
  worktreeName: string
): Promise<{ agent: Agent; worktree: PlanWorktree } | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId, taskId: task.id, repo: repository.name }
  logger.info('worktree', `Creating worktree for task`, logCtx, { worktreeName })

  // Include task ID suffix to guarantee uniqueness across parallel task creation
  // Task IDs are like "bismarck-6c8.1", extract the suffix after the dot
  const taskSuffix = task.id.includes('.') ? task.id.split('.').pop() : task.id.split('-').pop()
  const baseBranchName = `bismarck/${planId.split('-')[1]}/${worktreeName}-${taskSuffix}`

  // Generate a unique branch name in case a branch with this name already exists
  // (can happen if a plan is restarted and old branches weren't cleaned up)
  const branchName = await generateUniqueBranchName(repository.rootPath, baseBranchName)
  logger.debug('worktree', `Generated branch name: ${branchName}`, logCtx)

  // Determine worktree path
  const worktreePath = getWorktreePath(planId, repository.name, worktreeName)

  // Determine base branch based on strategy and task dependencies
  const baseBranch = await getBaseBranchForTask(plan, task, repository)

  // Create the worktree
  try {
    await createWorktree(repository.rootPath, worktreePath, branchName, baseBranch)
    addPlanActivity(planId, 'info', `Created worktree: ${worktreeName}`, `Branch: ${branchName}, Base: ${baseBranch}`)
  } catch (error) {
    addPlanActivity(
      planId,
      'error',
      `Failed to create worktree: ${worktreeName}`,
      error instanceof Error ? error.message : 'Unknown error'
    )
    return null
  }

  // Create task agent workspace pointing to the worktree
  const allAgents = getWorkspaces()
  const taskAgent: Agent = {
    id: `task-agent-${task.id}`,
    name: `Task: ${task.title.substring(0, 30)}`,
    directory: worktreePath,
    purpose: task.title,
    theme: 'teal',
    icon: getRandomUniqueIcon(allAgents),
    isTaskAgent: true,
    parentPlanId: planId,
    worktreePath: worktreePath,
    taskId: task.id,
    repositoryId: repository.id,
    isHeadless: useHeadlessMode,
  }
  saveWorkspace(taskAgent)

  // Create worktree tracking entry
  const planWorktree: PlanWorktree = {
    id: generateWorktreeId(),
    planId,
    taskId: task.id,
    repositoryId: repository.id,
    path: worktreePath,
    branch: branchName,
    agentId: taskAgent.id,
    status: 'active',
    createdAt: new Date().toISOString(),
    // Track task dependencies for merge logic
    blockedBy: task.blockedBy,
    baseBranch,
  }

  // Add worktree to plan (use lock to prevent race conditions with parallel agent spawns)
  await withPlanLock(planId, async () => {
    // Re-fetch plan inside lock to get latest state
    const currentPlan = getPlanById(planId)
    if (!currentPlan) throw new Error(`Plan ${planId} not found`)

    if (!currentPlan.worktrees) {
      currentPlan.worktrees = []
    }
    currentPlan.worktrees.push(planWorktree)
    await savePlan(currentPlan)
  })

  return { agent: taskAgent, worktree: planWorktree }
}

/**
 * Start a headless task agent in a Docker container
 */
async function startHeadlessTaskAgent(
  planId: string,
  task: BeadTask,
  worktree: PlanWorktree,
  repository: Repository
): Promise<void> {
  const planDir = getPlanDir(planId)
  const selectedImage = await getSelectedDockerImage()
  const logCtx: LogContext = { planId, taskId: task.id, worktreePath: worktree.path }
  logger.info('agent', 'Starting headless task agent', logCtx, {
    branch: worktree.branch,
    repo: repository.name,
    image: selectedImage,
  })
  const taskPrompt = buildTaskPromptForHeadless(planId, task, repository, worktree)
  logger.debug('agent', 'Built task prompt', logCtx, { promptLength: taskPrompt.length })

  // Get model from preferences
  const agentModel = getPreferences().agentModel || 'sonnet'

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: `headless-${task.id}`,
    taskId: task.id,
    planId,
    status: 'starting',
    worktreePath: worktree.path,
    events: [],
    startedAt: new Date().toISOString(),
    model: agentModel, // Store model for UI display
  }
  headlessAgentInfo.set(task.id, agentInfo)

  // Emit initial state
  emitHeadlessAgentUpdate(agentInfo)

  // Create and start headless agent
  const agent = new HeadlessAgent()
  headlessAgents.set(task.id, agent)

  // Set up event listeners
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)

    // Ensure task assignment status is in_progress when agent starts running
    // This handles edge cases where status might still be pending/sent
    if (status === 'running') {
      const assignments = loadTaskAssignments(planId)
      const assignment = assignments.find((a) => a.beadId === task.id)
      if (assignment && (assignment.status === 'sent' || assignment.status === 'pending')) {
        assignment.status = 'in_progress'
        saveTaskAssignment(planId, assignment)
        emitTaskAssignmentUpdate(assignment)
      }
    }
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(planId, task.id, event)
  })

  agent.on('message', (text: string) => {
    // Log messages as activities for visibility
    if (text.length > 100) {
      addPlanActivity(planId, 'info', `[${task.id}] ${text.substring(0, 100)}...`)
    }
  })

  agent.on('complete', async (result) => {
    // Check if bd close succeeded - if so, treat as success even if container was force-stopped (exit 143)
    const bdCloseSucceeded = tasksWithSuccessfulBdClose.has(task.id)
    const effectiveSuccess = result.success || bdCloseSucceeded

    logger.info('agent', 'Headless agent complete event received', { planId, taskId: task.id }, {
      success: result.success,
      exitCode: result.exitCode,
      bdCloseSucceeded,
      effectiveSuccess,
    })

    agentInfo.status = effectiveSuccess ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    // Clean up tracking
    headlessAgents.delete(task.id)
    tasksWithSuccessfulBdClose.delete(task.id)

    if (effectiveSuccess) {
      addPlanActivity(planId, 'success', `Task ${task.id} completed (headless)`)
      await markWorktreeReadyForReview(planId, task.id)
    } else {
      addPlanActivity(planId, 'error', `Task ${task.id} failed`, result.error)
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(task.id)
    addPlanActivity(planId, 'error', `Task ${task.id} container error`, error.message)
  })

  // Start the agent
  try {
    await agent.start({
      prompt: taskPrompt,
      worktreePath: worktree.path,
      planDir,
      planId,
      taskId: task.id,
      image: selectedImage,
      claudeFlags: ['--model', agentModel],
    })

    addPlanActivity(planId, 'info', `Task ${task.id} started (headless container)`)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(task.id)
    headlessAgentInfo.delete(task.id)

    throw error
  }
}

let bdCloseListenerSetup = false

// Track tasks that have successfully run bd close (even if container exit code is non-zero)
const tasksWithSuccessfulBdClose: Set<string> = new Set()

/**
 * Check if a task successfully ran bd close
 */
export function taskHasSuccessfulBdClose(taskId: string): boolean {
  return tasksWithSuccessfulBdClose.has(taskId)
}

/**
 * Set up listener for bd-close-success events to stop containers after grace period
 */
function setupBdCloseListener(): void {
  if (bdCloseListenerSetup) return
  bdCloseListenerSetup = true

  proxyEvents.on('bd-close-success', async ({ planId, taskId }: { planId: string; taskId: string }) => {
    const logCtx: LogContext = { planId, taskId }
    logger.info('proxy', 'Received bd-close-success, marking task as successfully closed', logCtx)

    // Mark this task as having successfully closed via bd
    tasksWithSuccessfulBdClose.add(taskId)

    logger.info('proxy', 'Scheduling container stop after 3s grace period', logCtx)

    // Grace period for agent to exit voluntarily via exit 0
    setTimeout(async () => {
      const agent = headlessAgents.get(taskId)
      if (!agent) {
        logger.info('agent', 'Agent already removed from tracking (exited cleanly)', logCtx)
        return
      }
      const status = agent.getStatus()
      if (status === 'running') {
        logger.info('agent', 'Container still running after bd close grace period, forcing stop', logCtx)
        await agent.stop()
      } else {
        logger.info('agent', 'Agent already stopped/completed', logCtx, { status })
      }
    }, 3000)
  })
}

/**
 * Stop a headless task agent
 */
export async function stopHeadlessTaskAgent(taskId: string): Promise<void> {
  const info = headlessAgentInfo.get(taskId)
  const logCtx: LogContext = { planId: info?.planId, taskId }

  logger.info('agent', 'Stopping headless task agent', logCtx, {
    hasAgent: headlessAgents.has(taskId),
    hasInfo: !!info,
    currentStatus: info?.status,
  })

  const agent = headlessAgents.get(taskId)
  if (agent) {
    const stopStartTime = Date.now()
    logger.debug('agent', 'Calling agent.stop()', logCtx)
    try {
      await agent.stop()
      logger.info('agent', 'Agent stop() completed', logCtx, { durationMs: Date.now() - stopStartTime })
    } catch (error) {
      logger.error('agent', 'Agent stop() threw error', logCtx, { error: String(error), durationMs: Date.now() - stopStartTime })
    }
    headlessAgents.delete(taskId)
    logger.debug('agent', 'Removed from headlessAgents map', logCtx)
  } else {
    logger.debug('agent', 'No agent instance found in map', logCtx)
  }

  headlessAgentInfo.delete(taskId)
  logger.debug('agent', 'Removed from headlessAgentInfo map', logCtx)
}

/**
 * Destroy a headless agent - stop container, remove worktree, delete branches
 */
export async function destroyHeadlessAgent(
  taskId: string,
  isStandalone: boolean
): Promise<{ success: boolean; error?: string }> {
  const logCtx: LogContext = { taskId }
  logger.info('agent', 'Destroying headless agent', logCtx, { isStandalone })

  try {
    if (isStandalone) {
      // Import standalone functions to avoid circular dependency at module load
      const { stopStandaloneHeadlessAgent, cleanupStandaloneWorktree } = await import('./standalone-headless')
      // Stop the agent if running
      await stopStandaloneHeadlessAgent(taskId)
      // Clean up worktree and branches (existing function handles all cleanup)
      await cleanupStandaloneWorktree(taskId)
    } else {
      // Get info before stopping (need planId for worktree lookup)
      const info = headlessAgentInfo.get(taskId)

      // Stop the agent
      await stopHeadlessTaskAgent(taskId)

      // Clean up worktree if exists
      if (info?.planId) {
        const plan = getPlanById(info.planId)
        const worktree = plan?.worktrees?.find(w => w.taskId === taskId)
        if (worktree) {
          const repo = await getRepositoryById(worktree.repositoryId)
          if (repo?.rootPath) {
            // Remove worktree
            try {
              await removeWorktree(repo.rootPath, worktree.path, true, logCtx)
            } catch (e) {
              logger.warn('agent', 'Worktree removal failed', logCtx, { error: String(e) })
            }

            // Delete local branch
            try {
              await deleteLocalBranch(repo.rootPath, worktree.branch, logCtx)
            } catch (e) {
              // may already be deleted
            }

            // Delete remote branch if exists
            try {
              if (await remoteBranchExists(repo.rootPath, worktree.branch)) {
                await deleteRemoteBranch(repo.rootPath, worktree.branch, 'origin', logCtx)
              }
            } catch (e) {
              logger.warn('agent', 'Remote branch deletion failed', logCtx, { error: String(e) })
            }

            // Mark worktree as cleaned in plan
            worktree.status = 'cleaned'
            await savePlan(plan!)
          }
        }
      }
    }

    return { success: true }
  } catch (error) {
    logger.error('agent', 'Failed to destroy agent', logCtx, { error: String(error) })
    return { success: false, error: String(error) }
  }
}

/**
 * Stop all headless agents for a plan
 */
async function stopAllHeadlessAgents(planId: string): Promise<void> {
  const logCtx: LogContext = { planId }

  // Collect all task IDs for this plan
  const taskIds: string[] = []
  for (const [taskId, info] of headlessAgentInfo) {
    if (info.planId === planId) {
      taskIds.push(taskId)
    }
  }

  logger.info('agent', 'Stopping all headless agents for plan', logCtx, {
    taskIds,
    totalHeadlessAgents: headlessAgents.size,
    totalHeadlessAgentInfo: headlessAgentInfo.size,
  })

  const promises: Promise<void>[] = []
  for (const taskId of taskIds) {
    promises.push(stopHeadlessTaskAgent(taskId))
  }

  await Promise.all(promises)
  logger.info('agent', 'All headless agents stopped for plan', logCtx, { stoppedCount: taskIds.length })
}

/**
 * Build task prompt for headless mode (includes container-specific instructions)
 */
function buildTaskPromptForHeadless(planId: string, task: BeadTask, repository?: Repository, worktree?: PlanWorktree): string {
  const plan = getPlanById(planId)
  // Use worktree's baseBranch if available (handles PR stacking), fall back to repository default
  const baseBranch = worktree?.baseBranch || repository?.defaultBranch || 'main'

  // Build completion instructions based on branch strategy
  let completionInstructions: string
  if (plan?.branchStrategy === 'raise_prs') {
    completionInstructions = `2. Commit your changes with a clear message
3. Push your branch and create a PR using gh api (gh pr create has issues in worktrees):
   gh api repos/OWNER/REPO/pulls -f head="BRANCH" -f base="${baseBranch}" -f title="..." -f body="..."
4. Close task with PR URL:
   bd close ${task.id} --message "PR: <url>"`
  } else {
    // feature_branch strategy - just commit, Bismarck handles pushing on completion
    completionInstructions = `2. Commit your changes with a clear message
3. Close the task to signal completion:
   bd close ${task.id} --message "Completed: <brief summary>"`
  }

  return `[BISMARCK TASK - HEADLESS MODE]
Task ID: ${task.id}
Title: ${task.title}

=== ENVIRONMENT ===
You are running in a Docker container with:
- Working directory: /workspace (your git worktree for this task)
- Plan directory: /plan (read-only reference)
- Tool proxy: git, gh, and bd commands are transparently proxied to the host

=== COMMANDS ===
All these commands work normally (they are proxied to the host automatically):

${plan?.branchStrategy === 'raise_prs' ? `1. Git:
   - git status
   - git add .
   - git commit -m "Your commit message"
   - git push origin HEAD (creates remote branch)

   IMPORTANT: For git commit, always use -m "message" inline.
   Do NOT use --file or -F flags - file paths don't work across the proxy.

2. GitHub CLI (gh):
   - Use gh api for PR creation (gh pr create has issues in worktrees):
     gh api repos/OWNER/REPO/pulls -f head="BRANCH" -f base="${baseBranch}" -f title="..." -f body="..."
   - gh pr view
   - All standard gh commands work` : `1. Git:
   - git status
   - git add .
   - git commit -m "Your commit message"

   IMPORTANT: For git commit, always use -m "message" inline.
   Do NOT use --file or -F flags - file paths don't work across the proxy.

   NOTE: Do NOT push your commits directly. Bismarck will automatically push
   your commits to the shared feature branch when you close the task.

2. GitHub CLI (gh):
   - gh pr view (view existing PRs)

   NOTE: In feature branch mode, Bismarck handles PR creation.`}

3. Beads Task Management (bd):
   - bd close ${task.id} --message "..."  (REQUIRED when done)
   - The --sandbox flag is added automatically

=== COMMIT STYLE ===
Keep commits simple and direct:
- Use: git commit -m "Brief description of change"
- Do NOT use HEREDOC, --file, or multi-step verification
- Commit once when work is complete, don't overthink it

=== YOUR WORKING DIRECTORY ===
You are in a dedicated git worktree: /workspace
Base branch: ${baseBranch}

=== COMPLETION REQUIREMENTS ===
1. Complete the work described in the task title
${completionInstructions}

CRITICAL: There is no interactive mode. You must:
- Complete all work
- Close the task with 'bd close ${task.id} --message "..."' to signal completion`
}

/**
 * Persist all headless agent info for a plan to disk
 */
function persistHeadlessAgentInfo(planId: string): void {
  const agents = Array.from(headlessAgentInfo.values()).filter(info => info.planId === planId)
  saveHeadlessAgentInfo(planId, agents)
}

/**
 * Emit headless agent update to renderer
 */
function emitHeadlessAgentUpdate(info: HeadlessAgentInfo): void {
  console.log('[PlanManager] Emitting headless-agent-update', { taskId: info.taskId, status: info.status })

  // Persist to disk on status changes
  persistHeadlessAgentInfo(info.planId)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-update', info)
  } else {
    console.log('[PlanManager] Cannot emit headless-agent-update - mainWindow:', mainWindow ? 'exists but destroyed' : 'null')
  }
}

/**
 * Emit headless agent event to renderer
 */
function emitHeadlessAgentEvent(planId: string, taskId: string, event: StreamEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-event', { planId, taskId, event })
  }

  // Debounced persistence for events (avoid writing on every single event)
  const timerKey = `${planId}:${taskId}`
  const existingTimer = eventPersistTimers.get(timerKey)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }
  eventPersistTimers.set(timerKey, setTimeout(() => {
    persistHeadlessAgentInfo(planId)
    eventPersistTimers.delete(timerKey)
  }, EVENT_PERSIST_DEBOUNCE_MS))
}

/**
 * Cleanup a task agent and its worktree
 */
async function cleanupTaskAgent(planId: string, taskId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return

  const worktree = plan.worktrees.find(w => w.taskId === taskId)
  if (!worktree) return

  const logCtx: LogContext = { planId, taskId, worktreePath: worktree.path }
  logger.info('task', 'Cleaning up task agent', logCtx)

  // Stop headless agent if running
  await stopHeadlessTaskAgent(taskId)

  const agent = getWorkspaces().find(a => a.id === worktree.agentId)

  // Close terminal if open (for interactive mode)
  if (agent) {
    logger.debug('task', 'Closing agent terminal', logCtx, { agentId: agent.id })
    const terminalId = getTerminalForWorkspace(agent.id)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeActiveWorkspace(agent.id)
    removeWorkspaceFromTab(agent.id)
    deleteWorkspace(agent.id)
  }

  // Remove the worktree from git
  const repository = await getRepositoryById(worktree.repositoryId)
  if (repository) {
    try {
      logger.info('worktree', 'Removing worktree', logCtx)
      await removeWorktree(repository.rootPath, worktree.path, true, logCtx)
      addPlanActivity(planId, 'info', `Removed worktree: ${worktree.path.split('/').pop()}`)
    } catch (error) {
      logger.error('worktree', 'Failed to remove worktree', logCtx, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      addPlanActivity(
        planId,
        'warning',
        `Failed to remove worktree`,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  // Update worktree status
  worktree.status = 'cleaned'
  await savePlan(plan)
  logger.info('task', 'Task agent cleanup complete', logCtx)
}

/**
 * Mark a worktree as ready for review (task agent completed)
 */
async function markWorktreeReadyForReview(planId: string, taskId: string): Promise<void> {
  // Use lock to safely read and modify the plan (prevents race conditions with parallel agents)
  const worktreeForStrategy = await withPlanLock(planId, async () => {
    const plan = getPlanById(planId)
    if (!plan || !plan.worktrees) return null

    const worktree = plan.worktrees.find(w => w.taskId === taskId)
    if (!worktree || worktree.status !== 'active') return null

    const logCtx: LogContext = { planId, taskId, worktreePath: worktree.path, branch: worktree.branch }
    logger.info('task', 'Marking worktree ready for review', logCtx)

    // Cleanup the agent window (but NOT the git worktree - that stays for review)
    if (worktree.agentId) {
      const agent = getWorkspaces().find(a => a.id === worktree.agentId)
      if (agent) {
        logger.debug('task', 'Cleaning up agent workspace', logCtx, { agentId: agent.id })
        const terminalId = getTerminalForWorkspace(agent.id)
        if (terminalId) {
          closeTerminal(terminalId)
        }
        removeActiveWorkspace(agent.id)
        removeWorkspaceFromTab(agent.id)
        deleteWorkspace(agent.id)
      }
    }

    worktree.status = 'ready_for_review'
    // Note: agentId kept for reference even though agent is cleaned up
    await savePlan(plan)
    emitPlanUpdate(plan)
    emitStateUpdate()

    logger.info('task', 'Task completed and ready for review', logCtx)
    addPlanActivity(planId, 'success', `Task ${taskId} ready for review`, `Worktree: ${worktree.branch}`)

    // Return worktree copy for use outside the lock
    return { ...worktree }
  })

  if (!worktreeForStrategy) return

  // Git operations can happen outside the lock (no plan state modification)
  try {
    await handleTaskCompletionStrategy(planId, taskId, worktreeForStrategy)
  } catch (error) {
    console.error(`[PlanManager] Error handling task completion strategy:`, error)
    addPlanActivity(planId, 'warning', `Git operation warning for ${taskId}`, error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Ensure the feature branch exists on remote.
 * If it doesn't exist, create it based on the default base branch.
 */
async function ensureFeatureBranchExists(
  repository: Repository,
  featureBranch: string,
  defaultBase: string
): Promise<void> {
  const exists = await remoteBranchExists(repository.rootPath, featureBranch)
  if (exists) {
    return
  }

  // Create the feature branch on remote by pushing the base branch to it
  console.log(`[PlanManager] Creating feature branch ${featureBranch} from ${defaultBase}`)
  await pushBranchToRemoteBranch(
    repository.rootPath,
    `origin/${defaultBase}`,
    featureBranch
  )
}

/**
 * Determine the base branch for a task based on the plan's branch strategy
 * - feature_branch: dependent tasks base on the feature branch (to get blocker commits)
 * - raise_prs: use the blocker's branch for dependent tasks, or repository's default branch for first tasks
 */
async function getBaseBranchForTask(
  plan: Plan,
  task: BeadTask,
  repository: Repository
): Promise<string> {
  // Use repository's detected defaultBranch with fallback to 'main'
  const defaultBase = repository.defaultBranch || 'main'

  if (plan.branchStrategy === 'feature_branch') {
    // Check if this task has blockers (depends on other tasks)
    const hasBlockers = task.blockedBy && task.blockedBy.length > 0

    if (hasBlockers && plan.featureBranch) {
      // Ensure feature branch exists on remote (creates it from defaultBase if not)
      await ensureFeatureBranchExists(repository, plan.featureBranch, defaultBase)
      return plan.featureBranch
    }

    // First tasks (no blockers) start from the default base (e.g., main)
    return defaultBase
  }

  // For raise_prs strategy with blockers, stack on the blocker's branch
  if (task.blockedBy && task.blockedBy.length > 0) {
    // Find blocker worktrees that are ready_for_review (completed)
    const blockerWorktrees = (plan.worktrees || []).filter(w =>
      task.blockedBy?.includes(w.taskId) &&
      w.status === 'ready_for_review'
    )

    // If we have a completed blocker, stack on its branch
    if (blockerWorktrees.length > 0) {
      const blockerBranch = blockerWorktrees[0].branch
      const logCtx: LogContext = { planId: plan.id, taskId: task.id }
      logger.info('task', `Stacking PR on blocker branch: ${blockerBranch}`, logCtx)
      return blockerBranch
    }
  }

  // Fallback: check for manual stack-on label
  const stackOnLabel = task.labels?.find(l => l.startsWith('stack-on:'))
  if (stackOnLabel) {
    return stackOnLabel.substring('stack-on:'.length)
  }

  return defaultBase
}

/**
 * Check if parallel blocker tasks need to be merged before a dependent task can start.
 * Returns true if a merge agent was spawned (caller should wait and retry).
 *
 * A merge agent is needed when:
 * 1. The dependent task has multiple blockers
 * 2. Those blockers ran in parallel (not depending on each other)
 * 3. At least one blocker's commits haven't been merged yet
 */
async function maybeSpawnMergeAgent(plan: Plan, dependentTask: BeadTask): Promise<boolean> {
  const logCtx: LogContext = { planId: plan.id, taskId: dependentTask.id }

  if (plan.branchStrategy !== 'feature_branch') return false
  if (!plan.featureBranch) return false
  if (!dependentTask.blockedBy || dependentTask.blockedBy.length <= 1) return false

  logger.debug('plan', 'Checking if merge agent needed', logCtx, {
    featureBranch: plan.featureBranch,
    blockedBy: dependentTask.blockedBy,
  })

  // Find worktrees for blocker tasks that are ready_for_review
  const blockerWorktrees = (plan.worktrees || []).filter(w =>
    dependentTask.blockedBy?.includes(w.taskId) &&
    w.status === 'ready_for_review'
  )

  // If not all blockers are done yet, wait
  if (blockerWorktrees.length !== dependentTask.blockedBy.length) {
    logger.debug('plan', 'Not all blockers complete, waiting', logCtx, {
      readyBlockers: blockerWorktrees.length,
      totalBlockers: dependentTask.blockedBy.length,
    })
    return false
  }

  // Check for worktrees with merge agents already running (mergeTaskId set but not yet merged)
  const worktreesWithMergeInProgress = blockerWorktrees.filter(w => !w.mergedIntoFeatureBranch && w.mergeTaskId)
  if (worktreesWithMergeInProgress.length > 0) {
    logger.debug('plan', 'Merge agents still running, blocking dependent task', logCtx, {
      mergeInProgress: worktreesWithMergeInProgress.map(w => ({ taskId: w.taskId, mergeTaskId: w.mergeTaskId })),
    })
    return true // Block dependent task until merge agents complete
  }

  // Check which blocker worktrees haven't been merged into the feature branch yet
  const unmergedWorktrees = blockerWorktrees.filter(w => !w.mergedIntoFeatureBranch)

  // If all already merged, no merge agent needed
  if (unmergedWorktrees.length === 0) {
    logger.debug('plan', 'All blockers already merged', logCtx)
    return false
  }

  // If only one unmerged, the normal push should handle it
  if (unmergedWorktrees.length === 1) {
    logger.debug('plan', 'Only one unmerged blocker, no merge agent needed', logCtx)
    return false
  }

  // Multiple unmerged parallel worktrees - spawn a merge agent
  logger.info('plan', 'Spawning merge for parallel tasks', logCtx, {
    unmergedTasks: unmergedWorktrees.map(w => w.taskId),
  })
  addPlanActivity(
    plan.id,
    'info',
    `Multiple parallel tasks need merging`,
    `Tasks: ${unmergedWorktrees.map(w => w.taskId).join(', ')}`
  )

  // For now, we'll sequentially push each worktree's commits to the feature branch
  // This is simpler than spawning a merge agent and handles most cases
  const repository = await getRepositoryById(blockerWorktrees[0].repositoryId)
  if (!repository) {
    logger.error('plan', 'Repository not found for merge operation', logCtx)
    addPlanActivity(plan.id, 'error', 'Repository not found for merge operation')
    return false
  }

  // Prefer repository's detected defaultBranch over plan's potentially incorrect default
  const baseBranch = repository.defaultBranch || 'main'

  // Track if any merge agent was spawned - if so, we must block the dependent task
  let mergeAgentSpawned = false

  for (const worktree of unmergedWorktrees) {
    const worktreeLogCtx: LogContext = { planId: plan.id, taskId: worktree.taskId }

    try {
      // Use safeRebaseAndPush to handle conflicts properly
      const pushSucceeded = await safeRebaseAndPush(plan, worktree, worktreeLogCtx)

      if (!pushSucceeded) {
        // Merge agent was spawned to resolve conflicts
        // It will handle the push after resolving
        mergeAgentSpawned = true
        addPlanActivity(
          plan.id,
          'info',
          `Merge agent spawned for task ${worktree.taskId}`,
          'Will push after resolving conflicts'
        )
        // Continue to try other worktrees - they may not have conflicts
        continue
      }

      // Mark as merged
      worktree.mergedAt = new Date().toISOString()
      worktree.mergedIntoFeatureBranch = true

      // Get commits for git summary
      const commits = await getCommitsBetween(worktree.path, `origin/${baseBranch}`, 'HEAD')
      if (commits.length > 0) {
        worktree.commits = commits.map(c => c.sha)

        const githubUrl = getGitHubUrlFromRemote(repository.remoteUrl)
        const planCommits: PlanCommit[] = commits.map(c => ({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          taskId: worktree.taskId,
          timestamp: c.timestamp,
          repositoryId: repository.id,
          githubUrl: githubUrl ? `${githubUrl}/commit/${c.sha}` : undefined,
        }))

        if (!plan.gitSummary) {
          plan.gitSummary = { commits: [] }
        }
        if (!plan.gitSummary.commits) {
          plan.gitSummary.commits = []
        }
        // Deduplicate by SHA - after rebase, worktrees may contain commits from other tasks
        const existingShas = new Set(plan.gitSummary.commits.map(c => c.sha))
        const newCommits = planCommits.filter(c => !existingShas.has(c.sha))
        plan.gitSummary.commits.push(...newCommits)
      }

      addPlanActivity(
        plan.id,
        'success',
        `Merged task ${worktree.taskId} into feature branch`,
        `${commits.length} commit(s) pushed`
      )
    } catch (error) {
      addPlanActivity(
        plan.id,
        'error',
        `Failed to merge task ${worktree.taskId}`,
        error instanceof Error ? error.message : 'Unknown error'
      )
      // Continue trying other worktrees
    }
  }

  await savePlan(plan)
  emitPlanUpdate(plan)

  // Return true if a merge agent was spawned - dependent task must wait
  // Return false if all merges completed synchronously - dependent task can proceed
  return mergeAgentSpawned
}

/**
 * Handle task completion based on the plan's branch strategy
 * - feature_branch: push commits to the shared feature branch
 * - raise_prs: PR was created by the agent, record it in git summary
 */
async function handleTaskCompletionStrategy(planId: string, taskId: string, worktree: PlanWorktree): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan) return

  const repository = await getRepositoryById(worktree.repositoryId)
  if (!repository) return

  if (plan.branchStrategy === 'feature_branch') {
    await pushToFeatureBranch(plan, worktree, repository)
  } else if (plan.branchStrategy === 'raise_prs') {
    // For raise_prs, the agent should have created a PR
    // Try to extract PR info from the worktree's commits/branch
    await recordPullRequest(plan, worktree, repository)
  }
}

/**
 * Spawn a headless agent to resolve merge conflicts in a worktree.
 * Called when a rebase onto the feature branch fails due to conflicts.
 */
async function spawnMergeResolutionAgent(
  plan: Plan,
  worktree: PlanWorktree,
  conflictError: Error
): Promise<void> {
  const logCtx: LogContext = { planId: plan.id, taskId: worktree.taskId }
  logger.info('plan', 'Spawning merge resolution agent', logCtx, {
    featureBranch: plan.featureBranch,
    error: conflictError.message.substring(0, 200),
  })

  // Create merge task in beads FIRST (synchronously, before agent starts)
  // This ensures dependent tasks are blocked before the merge agent runs async
  let mergeTaskId: string
  try {
    mergeTaskId = await bdCreate(plan.id, {
      title: `Merge ${worktree.taskId} into feature branch`,
      labels: ['merge', 'bismarck-internal'],
    })
    worktree.mergeTaskId = mergeTaskId
    logger.info('plan', 'Created merge task in beads', logCtx, { mergeTaskId })

    // Find ALL tasks that depend on the original task and add merge as blocker
    const dependentTaskIds = await bdGetDependents(plan.id, worktree.taskId)
    for (const depTaskId of dependentTaskIds) {
      await bdAddDependency(plan.id, depTaskId, mergeTaskId)
      logger.info('plan', 'Added merge dependency', logCtx, {
        mergeTaskId,
        dependentTaskId: depTaskId
      })
    }

    // Save the plan with the mergeTaskId
    await savePlan(plan)
  } catch (err) {
    logger.warn('plan', 'Failed to create merge task in beads', logCtx, {
      error: err instanceof Error ? err.message : 'Unknown error'
    })
    // Fall back to the old ID format if beads task creation fails
    mergeTaskId = `${worktree.taskId}-merge`
  }

  // Build the merge resolution prompt
  const prompt = `You are resolving a merge conflict for task ${worktree.taskId}.

The rebase onto origin/${plan.featureBranch} failed with conflicts.

Your job:
1. Run: git rebase "origin/${plan.featureBranch}"
2. For each conflict:
   - Examine both versions carefully
   - Resolve the conflict appropriately (usually keeping both changes where possible)
   - Stage the resolved file: git add <file>
   - Continue: git rebase --continue
3. After rebase completes successfully, push: git push origin HEAD:refs/heads/${plan.featureBranch}
4. Close this task with: bd close ${mergeTaskId} --message "Resolved merge conflicts and pushed to feature branch"

If you cannot resolve the conflicts automatically, close the task with an error: bd close ${mergeTaskId} --message "CONFLICT: Could not auto-resolve - manual intervention required"

Original error:
${conflictError.message}
`

  addPlanActivity(
    plan.id,
    'info',
    `Spawning merge agent for ${worktree.taskId}`,
    'Resolving rebase conflicts'
  )

  // Get model from preferences for display
  const agentModel = getPreferences().agentModel || 'sonnet'

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: `headless-${mergeTaskId}`,
    taskId: mergeTaskId,
    planId: plan.id,
    status: 'starting',
    worktreePath: worktree.path,
    events: [],
    startedAt: new Date().toISOString(),
    model: agentModel, // Store model for UI display
  }
  headlessAgentInfo.set(mergeTaskId, agentInfo)
  emitHeadlessAgentUpdate(agentInfo)

  // Create and start the merge agent
  const agent = new HeadlessAgent()
  headlessAgents.set(mergeTaskId, agent)

  // Set up event listeners (similar to startHeadlessTaskAgent)
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(plan.id, mergeTaskId, event)
  })

  agent.on('complete', async (result) => {
    // Check if bd close succeeded - treat as success even if container was force-stopped (exit 143)
    const bdCloseSucceeded = tasksWithSuccessfulBdClose.has(mergeTaskId)
    const effectiveSuccess = result.success || bdCloseSucceeded

    logger.info('agent', 'Merge agent complete', logCtx, {
      success: result.success,
      exitCode: result.exitCode,
      bdCloseSucceeded,
      effectiveSuccess,
    })

    agentInfo.status = effectiveSuccess ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(mergeTaskId)

    // Clean up tracking
    tasksWithSuccessfulBdClose.delete(mergeTaskId)

    if (effectiveSuccess) {
      // Close the merge task in beads FIRST to unblock dependent tasks
      if (worktree.mergeTaskId) {
        try {
          await bdClose(plan.id, worktree.mergeTaskId)
          logger.info('plan', 'Closed merge task in beads', logCtx, {
            mergeTaskId: worktree.mergeTaskId
          })
        } catch (err) {
          logger.warn('plan', 'Failed to close merge task', logCtx, {
            error: err instanceof Error ? err.message : 'Unknown error'
          })
        }
      }

      addPlanActivity(plan.id, 'success', `Merge resolved for ${worktree.taskId}`)
      // Mark the worktree as merged
      worktree.mergedAt = new Date().toISOString()
      worktree.mergedIntoFeatureBranch = true
      savePlan(plan).catch((err) => {
        console.error('[PlanManager] Error saving plan after merge:', err)
      })
      emitPlanUpdate(plan)
    } else {
      addPlanActivity(plan.id, 'error', `Merge resolution failed for ${worktree.taskId}`, result.error)
      // Note: merge task stays open - user/dependent tasks remain blocked until manual intervention
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(mergeTaskId)
    addPlanActivity(plan.id, 'error', `Merge agent error for ${worktree.taskId}`, error.message)
  })

  // Start the agent
  const planDir = getPlanDir(plan.id)
  const selectedImage = await getSelectedDockerImage()

  await agent.start({
    prompt,
    worktreePath: worktree.path,
    planDir,
    planId: plan.id,
    taskId: mergeTaskId,
    image: selectedImage,
    claudeFlags: ['--model', agentModel],
  })
}

/**
 * Safely rebase and push a worktree's commits to the feature branch.
 * On conflict, spawns a merge resolution agent.
 *
 * @returns true if push succeeded, false if merge agent was spawned (will push after resolving)
 */
async function safeRebaseAndPush(
  plan: Plan,
  worktree: PlanWorktree,
  logCtx: LogContext
): Promise<boolean> {
  const featureBranch = plan.featureBranch!

  // 1. Explicitly fetch the feature branch with force to ensure ref is current
  try {
    await fetchBranchWithForce(worktree.path, featureBranch, 'origin', logCtx)
  } catch {
    // Branch might not exist on remote yet - that's OK
    logger.debug('plan', 'Feature branch fetch failed (may not exist yet)', logCtx)
  }

  // 2. Check if feature branch exists on remote
  const exists = await remoteBranchExists(worktree.path, featureBranch, 'origin')

  // 3. If exists, must rebase to incorporate other task's commits
  if (exists) {
    const rebaseResult = await rebaseOntoRemoteBranch(worktree.path, featureBranch, 'origin', logCtx)

    if (!rebaseResult.success) {
      // Conflict detected - spawn merge agent to resolve
      logger.warn('plan', 'Rebase conflict, spawning merge agent', logCtx)
      await spawnMergeResolutionAgent(plan, worktree, rebaseResult.conflictError!)
      return false // Merge agent will handle the push after resolving
    }
  }

  // 4. Push to feature branch
  await pushBranchToRemoteBranch(worktree.path, 'HEAD', featureBranch, 'origin', true, logCtx)
  return true
}

/**
 * Push commits from a worktree to the shared feature branch
 * Used for feature_branch strategy
 */
async function pushToFeatureBranch(plan: Plan, worktree: PlanWorktree, repository: Repository): Promise<void> {
  if (!plan.featureBranch) {
    // Create the feature branch if it doesn't exist
    plan.featureBranch = `bismarck/${plan.id.split('-')[1]}/feature`
    await savePlan(plan)
  }

  const logCtx: LogContext = { planId: plan.id, taskId: worktree.taskId }

  // Use git push lock to serialize concurrent pushes to the same feature branch
  await withGitPushLock(plan.id, async () => {
    try {
      // Get commits made in this worktree
      // Prefer repository's detected defaultBranch over plan's potentially incorrect default
      const baseBranch = repository.defaultBranch || 'main'
      const commits = await getCommitsBetween(worktree.path, `origin/${baseBranch}`, 'HEAD')

      if (commits.length === 0) {
        addPlanActivity(plan.id, 'info', `No commits to push for task ${worktree.taskId}`)
        return
      }

      // Record commits in worktree tracking
      worktree.commits = commits.map(c => c.sha)

      // Use safeRebaseAndPush to handle conflicts properly
      const pushSucceeded = await safeRebaseAndPush(plan, worktree, logCtx)

      if (!pushSucceeded) {
        // Merge agent was spawned to resolve conflicts
        // It will handle the push after resolving, so we return early
        addPlanActivity(
          plan.id,
          'info',
          `Merge agent spawned for task ${worktree.taskId}`,
          'Will push after resolving conflicts'
        )
        return
      }

      // Record commits in git summary
      const githubUrl = getGitHubUrlFromRemote(repository.remoteUrl)
      const planCommits: PlanCommit[] = commits.map(c => ({
        sha: c.sha,
        shortSha: c.shortSha,
        message: c.message,
        taskId: worktree.taskId,
        timestamp: c.timestamp,
        repositoryId: repository.id,
        githubUrl: githubUrl ? `${githubUrl}/commit/${c.sha}` : undefined,
      }))

      if (!plan.gitSummary) {
        plan.gitSummary = { commits: [] }
      }
      if (!plan.gitSummary.commits) {
        plan.gitSummary.commits = []
      }
      // Deduplicate by SHA - after rebase, worktrees may contain commits from other tasks
      const existingShas = new Set(plan.gitSummary.commits.map(c => c.sha))
      const newCommits = planCommits.filter(c => !existingShas.has(c.sha))
      plan.gitSummary.commits.push(...newCommits)

      await savePlan(plan)
      emitPlanUpdate(plan)

      // Mark worktree as merged into feature branch
      worktree.mergedAt = new Date().toISOString()
      worktree.mergedIntoFeatureBranch = true
      await savePlan(plan)

      addPlanActivity(
        plan.id,
        'success',
        `Pushed ${newCommits.length} new commit(s) for task ${worktree.taskId}`,
        `To feature branch: ${plan.featureBranch}`
      )
    } catch (error) {
      addPlanActivity(
        plan.id,
        'error',
        `Failed to push commits for task ${worktree.taskId}`,
        error instanceof Error ? error.message : 'Unknown error'
      )
      // Re-throw so calling code knows the push failed
      throw error
    }
  })
}

/**
 * Record a pull request created by a task agent
 * Used for raise_prs strategy
 */
async function recordPullRequest(plan: Plan, worktree: PlanWorktree, repository: Repository): Promise<void> {
  // The agent should have created a PR and closed the task with the PR URL
  // For now, we'll try to extract PR info from the bd task close message
  // This could be enhanced to actually query GitHub for PR info

  try {
    // Try to get PR info using gh CLI (use execWithPath for extended PATH)
    const { stdout } = await execWithPath(
      `gh pr list --head "${worktree.branch}" --json number,title,url,baseRefName,headRefName,state --limit 1`,
      { cwd: worktree.path }
    )

    const prs = JSON.parse(stdout)
    if (prs.length > 0) {
      const pr = prs[0]

      const planPR: PlanPullRequest = {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        taskId: worktree.taskId,
        baseBranch: pr.baseRefName,
        headBranch: pr.headRefName,
        status: pr.state.toLowerCase() as 'open' | 'merged' | 'closed',
        repositoryId: repository.id,
      }

      // Store PR info in worktree
      worktree.prNumber = pr.number
      worktree.prUrl = pr.url
      worktree.prBaseBranch = pr.baseRefName

      // Add to git summary
      if (!plan.gitSummary) {
        plan.gitSummary = { pullRequests: [] }
      }
      if (!plan.gitSummary.pullRequests) {
        plan.gitSummary.pullRequests = []
      }
      plan.gitSummary.pullRequests.push(planPR)

      await savePlan(plan)
      emitPlanUpdate(plan)

      addPlanActivity(
        plan.id,
        'success',
        `PR #${pr.number} created for task ${worktree.taskId}`,
        pr.url
      )
    }
  } catch (error) {
    // PR info not available - that's OK, agent might not have created one yet
    addPlanActivity(
      plan.id,
      'info',
      `No PR found for task ${worktree.taskId}`,
      'Agent may not have created a PR'
    )
  }
}

/**
 * Refresh the git summary by querying actual commits on the feature branch.
 * This corrects any duplicate commit entries caused by rebases during execution.
 * Called when transitioning to ready_for_review or when completing a plan.
 */
async function refreshGitSummary(plan: Plan): Promise<void> {
  // Only applicable for feature_branch strategy
  if (plan.branchStrategy !== 'feature_branch' || !plan.featureBranch) return

  const repos = await getAllRepositories()
  if (repos.length === 0) return

  const repo = repos[0]
  const baseBranch = repo.defaultBranch || 'main'

  // Check if feature branch exists on remote
  const exists = await remoteBranchExists(repo.rootPath, plan.featureBranch)
  if (!exists) {
    logger.debug('git', 'Feature branch does not exist on remote, skipping git summary refresh', { planId: plan.id })
    return
  }

  try {
    // Fetch latest feature branch state
    await fetchBranch(repo.rootPath, plan.featureBranch, 'origin')

    // Get commits between base and feature branch
    const commits = await getCommitsBetween(
      repo.rootPath,
      `origin/${baseBranch}`,
      `origin/${plan.featureBranch}`
    )

    // Helper to find taskId for a commit by checking worktree records
    const findTaskIdForCommit = (sha: string): string | undefined => {
      if (!plan.worktrees) return undefined
      // Check if any worktree has this commit recorded
      for (const worktree of plan.worktrees) {
        if (worktree.commits?.includes(sha)) {
          return worktree.taskId
        }
      }
      // Fallback: check existing gitSummary for this SHA
      const existingCommit = plan.gitSummary?.commits?.find(c => c.sha === sha)
      return existingCommit?.taskId
    }

    // Build commit list with metadata
    const githubUrl = getGitHubUrlFromRemote(repo.remoteUrl)
    const planCommits: PlanCommit[] = commits.map(c => ({
      sha: c.sha,
      shortSha: c.shortSha,
      message: c.message,
      taskId: findTaskIdForCommit(c.sha) || 'unknown',
      timestamp: c.timestamp,
      repositoryId: repo.id,
      githubUrl: githubUrl ? `${githubUrl}/commit/${c.sha}` : undefined,
    }))

    // Replace gitSummary.commits with the refreshed list
    if (!plan.gitSummary) {
      plan.gitSummary = { commits: [] }
    }
    plan.gitSummary.commits = planCommits

    logger.info('git', `Refreshed git summary: ${planCommits.length} commits on feature branch`, { planId: plan.id })
    addPlanActivity(plan.id, 'info', `Git summary refreshed: ${planCommits.length} commit(s) on feature branch`)

    await savePlan(plan)
    emitPlanUpdate(plan)
  } catch (error) {
    logger.warn('git', 'Failed to refresh git summary', { planId: plan.id }, { error: error instanceof Error ? error.message : String(error) })
    // Don't fail the overall operation - the existing summary is still valid
  }
}

/**
 * Cleanup all worktrees for a plan (used when user marks plan complete)
 */
export async function cleanupAllWorktrees(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return

  addPlanActivity(planId, 'info', 'Cleaning up worktrees...')

  for (const worktree of plan.worktrees) {
    if (worktree.status === 'cleaned') continue

    await cleanupTaskAgent(planId, worktree.taskId)
  }

  // Prune any stale worktree references
  const repositories = await getAllRepositories()
  for (const repo of repositories) {
    try {
      await pruneWorktrees(repo.rootPath)
    } catch {
      // Ignore prune errors
    }
  }

  addPlanActivity(planId, 'success', 'All worktrees cleaned up')
}

/**
 * Mark a plan as complete (triggers cleanup)
 */
export async function completePlan(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  // Refresh git summary before cleanup (while worktrees still exist for task correlation)
  await refreshGitSummary(plan)

  // Stop any remaining headless agents
  await stopAllHeadlessAgents(planId)

  // Clean up all worktrees
  await cleanupAllWorktrees(planId)

  // Cleanup orchestrator
  await cleanupOrchestrator(plan)

  plan.status = 'completed'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)
  emitPlanUpdate(plan)

  addPlanActivity(planId, 'success', 'Plan completed', 'All work finished and cleaned up')

  // Remove from executing set
  executingPlans.delete(planId)

  // Stop tool proxy if no more active plans
  const activePlans = loadPlans().filter(p => p.status === 'delegating' || p.status === 'in_progress')
  if (activePlans.length === 0 && isProxyRunning()) {
    await stopToolProxy()
    addPlanActivity(planId, 'info', 'Tool proxy stopped')
  }

  return plan
}

/**
 * Build the prompt for the Follow-Up Agent
 * This agent helps the user create follow-up tasks after reviewing completed work
 */
async function buildFollowUpAgentPrompt(plan: Plan, completedTasks: BeadTask[]): Promise<string> {
  const planDir = getPlanDir(plan.id)

  const completedTasksList = completedTasks.length > 0
    ? completedTasks.map(t => `- ${t.id}: ${t.title}`).join('\n')
    : '(No completed tasks yet)'

  // Get available repositories from existing worktrees
  const repositories = await getRepositoriesForPlan(plan.id)
  const repoList = repositories.length > 0
    ? repositories.map(r => `- ${r.name}`).join('\n')
    : '(No repositories available)'

  // Get worktree info from plan - find one that can be reused
  // Prefer worktrees that are ready_for_review (task finished) so we can reference their pattern
  const existingWorktrees = plan.worktrees || []
  const worktreeInfo = existingWorktrees.length > 0
    ? existingWorktrees.map(w => `- ${w.id} (repo: ${w.repositoryId}, task: ${w.taskId}, status: ${w.status})`).join('\n')
    : '(No worktrees yet)'

  // Find a default repo/worktree to suggest
  const defaultRepo = repositories[0]?.name || '<repo-name>'
  // Generate a unique worktree name for follow-up tasks
  const defaultWorktree = `followup-${Date.now()}`

  return `[BISMARCK FOLLOW-UP AGENT]
Plan: ${plan.title}
${plan.description}

=== YOUR ROLE ===
You are a Follow-Up Agent helping the user create additional tasks after reviewing completed work.
The plan was in "Ready for Review" status and the user has requested to add follow-up tasks.

=== COMPLETED TASKS ===
The following tasks have been completed:
${completedTasksList}

=== AVAILABLE REPOSITORIES ===
${repoList}

=== EXISTING WORKTREES ===
${worktreeInfo}

=== CREATING FOLLOW-UP TASKS ===
Help the user identify what additional work is needed. When they decide on tasks:

1. Create tasks using bd (beads CLI):
   \`\`\`bash
   bd --sandbox create "Task title" --description "Detailed task description"
   \`\`\`

2. Set dependencies on completed tasks if needed:
   \`\`\`bash
   bd --sandbox update <new-task-id> --blocked-by <completed-task-id>
   \`\`\`

3. **IMPORTANT**: Assign repository and worktree labels (required for task dispatch):
   \`\`\`bash
   bd --sandbox update <task-id> --add-labels "repo:${defaultRepo}" --add-labels "worktree:${defaultWorktree}"
   \`\`\`

4. Mark tasks as ready for Bismarck:
   \`\`\`bash
   bd --sandbox update <task-id> --add-labels bismarck-ready
   \`\`\`

You can combine steps 3 and 4:
\`\`\`bash
bd --sandbox update <task-id> --add-labels "repo:${defaultRepo}" --add-labels "worktree:${defaultWorktree}" --add-labels bismarck-ready
\`\`\`

=== ASKING QUESTIONS ===
When you need input from the user, use the AskUserQuestion tool.
This provides a better UI experience than typing in the terminal.
- Structure questions with 2-4 clear options when possible
- Use multiSelect: true when multiple answers make sense

=== WHEN COMPLETE ===
When the user has finished creating follow-up tasks (or decides none are needed):
1. Type /exit to signal that follow-up task creation is complete

The plan will automatically transition back to "In Progress" if new open tasks exist,
or stay in "Ready for Review" if no new tasks were created.

=== BEGIN ===
Start by asking the user what follow-up work they've identified after reviewing the completed tasks.`
}

/**
 * Check for new tasks after Follow-Up Agent exits and resume plan if needed
 */
async function checkForNewTasksAndResume(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'ready_for_review') return

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Checking for new tasks after follow-up agent exit', logCtx)

  try {
    // Get all open tasks
    const openTasks = await bdList(planId, { status: 'open' })

    if (openTasks.length > 0) {
      // New tasks exist - transition back to in_progress and restart polling
      logger.planStateChange(plan.id, plan.status, 'in_progress', `${openTasks.length} new follow-up tasks`)
      plan.status = 'in_progress'
      plan.updatedAt = new Date().toISOString()
      await savePlan(plan)
      emitPlanUpdate(plan)

      addPlanActivity(planId, 'info', `Resuming plan with ${openTasks.length} follow-up task(s)`)

      // Restart task polling
      startTaskPolling(planId)

      // Notify renderer about task changes
      emitBeadTasksUpdate(planId)
    } else {
      // No new tasks - stay in ready_for_review
      logger.info('plan', 'No new tasks created, staying in ready_for_review', logCtx)
      addPlanActivity(planId, 'info', 'No follow-up tasks created')
    }
  } catch (error) {
    logger.error('plan', 'Error checking for new tasks', logCtx, { error })
    addPlanActivity(planId, 'error', 'Failed to check for new tasks', error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Request follow-ups for a plan in ready_for_review status
 * Spawns a Follow-Up Agent terminal for creating additional tasks
 */
export async function requestFollowUps(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Requesting follow-ups for plan', logCtx)

  // Only callable from ready_for_review status
  if (plan.status !== 'ready_for_review') {
    logger.warn('plan', 'Cannot request follow-ups - plan not in ready_for_review status', logCtx, { status: plan.status })
    addPlanActivity(planId, 'warning', 'Cannot request follow-ups', `Plan is in ${plan.status} status, not ready_for_review`)
    return plan
  }

  // Get completed tasks for context
  const completedTasks = await bdList(planId, { status: 'closed' })

  // Get the plan directory
  const planDir = getPlanDir(planId)

  // Create follow-up agent workspace
  const allAgents = getWorkspaces()
  const followUpWorkspace: Workspace = {
    id: `followup-${planId}-${Date.now()}`,
    name: `Follow-Up (${plan.title})`,
    directory: planDir,
    purpose: 'Create follow-up tasks',
    theme: 'orange',
    icon: getRandomUniqueIcon(allAgents),
    isPlanAgent: true,
  }
  saveWorkspace(followUpWorkspace)

  // Find or create the plan's tab
  let tabId = plan.orchestratorTabId
  if (!tabId) {
    const newTab = createTab(`📋 ${plan.title.substring(0, 15)}`, { isPlanTab: true, planId: plan.id })
    tabId = newTab.id
    plan.orchestratorTabId = tabId
    await savePlan(plan)
  }

  // Create terminal for follow-up agent
  if (mainWindow) {
    try {
      const followUpPrompt = await buildFollowUpAgentPrompt(plan, completedTasks)
      const claudeFlags = `--add-dir "${planDir}"`

      logger.info('plan', 'Creating terminal for follow-up agent', logCtx, { workspaceId: followUpWorkspace.id })
      const terminalId = await queueTerminalCreation(followUpWorkspace.id, mainWindow, {
        initialPrompt: followUpPrompt,
        claudeFlags,
      })
      logger.info('plan', 'Created follow-up agent terminal', logCtx, { terminalId })

      addActiveWorkspace(followUpWorkspace.id)
      addWorkspaceToTab(followUpWorkspace.id, tabId)
      setActiveTab(tabId)

      // Notify renderer about the new terminal
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId,
          workspaceId: followUpWorkspace.id,
        })
        // Maximize the follow-up agent
        mainWindow.webContents.send('maximize-workspace', followUpWorkspace.id)
      }

      // Set up listener for follow-up agent exit
      const followUpEmitter = getTerminalEmitter(terminalId)
      if (followUpEmitter) {
        const exitHandler = async (data: string) => {
          // Claude shows "Goodbye!" when /exit is used
          if (data.includes('Goodbye') || data.includes('Session ended')) {
            followUpEmitter.removeListener('data', exitHandler)

            // Cleanup follow-up agent workspace
            const followUpTerminalId = getTerminalForWorkspace(followUpWorkspace.id)
            if (followUpTerminalId) {
              closeTerminal(followUpTerminalId)
            }
            removeActiveWorkspace(followUpWorkspace.id)
            removeWorkspaceFromTab(followUpWorkspace.id)
            deleteWorkspace(followUpWorkspace.id)

            // Check for new tasks and resume plan if needed
            await checkForNewTasksAndResume(planId)

            emitStateUpdate()
          }
        }
        followUpEmitter.on('data', exitHandler)
      }

      addPlanActivity(planId, 'info', 'Follow-up agent started')
      emitStateUpdate()
    } catch (error) {
      logger.error('plan', 'Failed to create follow-up agent terminal', logCtx, { error })
      addPlanActivity(planId, 'error', 'Failed to start follow-up agent', error instanceof Error ? error.message : 'Unknown error')
      // Cleanup the workspace
      deleteWorkspace(followUpWorkspace.id)
    }
  } else {
    logger.error('plan', 'Cannot create follow-up terminal - mainWindow is null', logCtx)
    addPlanActivity(planId, 'error', 'Cannot start follow-up agent - window not available')
    deleteWorkspace(followUpWorkspace.id)
  }

  return plan
}

/**
 * Get available repositories for a plan based on reference agents
 */
async function getRepositoriesForPlan(planId: string): Promise<Repository[]> {
  const plan = getPlanById(planId)
  if (!plan || !plan.referenceAgentId) return []

  // Get all non-system agents
  const agents = getWorkspaces().filter(a => !a.isOrchestrator && !a.isPlanAgent && !a.isTaskAgent)

  // Collect unique repositories
  const repoIds = new Set<string>()
  const repositories: Repository[] = []

  for (const agent of agents) {
    if (agent.repositoryId) {
      if (!repoIds.has(agent.repositoryId)) {
        const repo = await getRepositoryById(agent.repositoryId)
        if (repo) {
          repoIds.add(repo.id)
          repositories.push(repo)
        }
      }
    }
  }

  return repositories
}

/**
 * Update plan statuses based on task completion
 */
async function updatePlanStatuses(): Promise<void> {
  const plans = loadPlans()

  for (const plan of plans) {
    if (plan.status === 'delegating' || plan.status === 'in_progress') {
      const logCtx: LogContext = { planId: plan.id }

      // Get all tasks for this plan (not just children of an epic)
      // Use status: 'all' to include closed tasks for completion checks
      const allTasks = await bdList(plan.id, { status: 'all' })

      // Filter to just tasks (not epics)
      const allTaskItems = allTasks.filter(t => t.type === 'task')

      if (allTaskItems.length === 0) {
        // No tasks have been created yet, stay in current status
        continue
      }

      // Check task states
      const openTasks = allTaskItems.filter(t => t.status === 'open')
      const closedTasks = allTaskItems.filter(t => t.status === 'closed')
      const allClosed = openTasks.length === 0 && closedTasks.length > 0

      logger.debug('plan', 'Checking plan status', logCtx, {
        totalTasks: allTaskItems.length,
        openTasks: openTasks.length,
        closedTasks: closedTasks.length,
        currentStatus: plan.status,
      })

      if (allClosed) {
        // All tasks closed - mark as ready_for_review (don't auto-cleanup)
        // User must explicitly click "Mark Complete" to trigger cleanup
        logger.planStateChange(plan.id, plan.status, 'ready_for_review', 'All tasks completed')
        plan.status = 'ready_for_review'
        plan.updatedAt = new Date().toISOString()

        // Refresh git summary to get accurate commit count from feature branch
        await refreshGitSummary(plan)

        await savePlan(plan)
        emitPlanUpdate(plan)
        addPlanActivity(plan.id, 'success', 'All tasks completed', 'Click "Mark Complete" to cleanup worktrees')
      } else if (openTasks.length > 0 && plan.status === 'delegating') {
        // Has open tasks, move to in_progress
        logger.planStateChange(plan.id, plan.status, 'in_progress', `${openTasks.length} open tasks`)
        plan.status = 'in_progress'
        plan.updatedAt = new Date().toISOString()
        await savePlan(plan)
        emitPlanUpdate(plan)
        addPlanActivity(plan.id, 'info', 'Tasks are being worked on', `${openTasks.length} task(s) remaining`)
      }
    } else if (plan.status === 'ready_for_review') {
      // Check if new follow-up tasks have been created
      const logCtx: LogContext = { planId: plan.id }
      const allTasks = await bdList(plan.id, { status: 'all' })
      const openTasks = allTasks.filter(t => t.type === 'task' && t.status === 'open')

      if (openTasks.length > 0) {
        // New tasks exist - transition back to in_progress
        logger.planStateChange(plan.id, plan.status, 'in_progress', `${openTasks.length} new follow-up tasks`)
        plan.status = 'in_progress'
        plan.updatedAt = new Date().toISOString()
        await savePlan(plan)
        emitPlanUpdate(plan)
        addPlanActivity(plan.id, 'info', `Resuming with ${openTasks.length} follow-up task(s)`)

        // Notify renderer about task changes
        emitBeadTasksUpdate(plan.id)
      }
    }
  }
}

/**
 * Emit plan update event to renderer
 */
function emitPlanUpdate(plan: Plan): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('plan-update', plan)
  }
}

/**
 * Emit task assignment update event to renderer
 */
function emitTaskAssignmentUpdate(assignment: TaskAssignment): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-assignment-update', assignment)
  }
}

/**
 * Emit plan activity event to renderer
 */
function emitPlanActivity(activity: PlanActivity): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('plan-activity', activity)
  }
}

/**
 * Emit bead tasks updated event to renderer
 * This notifies the UI to re-fetch the task list for a plan
 */
function emitBeadTasksUpdate(planId: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bead-tasks-updated', planId)
  }
}

/**
 * Emit state update event to renderer (for tab changes)
 */
function emitStateUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const state = getState()
    mainWindow.webContents.send('state-update', state)
  }
}

/**
 * Cleanup all plan-related resources (called on app shutdown)
 */
export async function cleanupPlanManager(): Promise<void> {
  console.log('[PlanManager] Cleaning up...')

  // Stop task polling
  stopTaskPolling()

  // Stop all headless agents
  for (const [taskId] of headlessAgents) {
    try {
      await stopHeadlessTaskAgent(taskId)
    } catch (error) {
      console.error(`[PlanManager] Error stopping headless agent ${taskId}:`, error)
    }
  }

  // Stop all Docker containers (belt and suspenders)
  try {
    await stopAllContainers()
  } catch (error) {
    console.error('[PlanManager] Error stopping containers:', error)
  }

  // Stop tool proxy
  if (isProxyRunning()) {
    try {
      await stopToolProxy()
    } catch (error) {
      console.error('[PlanManager] Error stopping tool proxy:', error)
    }
  }

  console.log('[PlanManager] Cleanup complete')
}
