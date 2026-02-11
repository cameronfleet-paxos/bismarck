/**
 * Team (Plan-Aware) Headless Agents
 *
 * Manages headless agents that are part of a plan - lifecycle,
 * Docker availability checks, and bd close listener.
 *
 * Extracted from plan-manager.ts to break circular dependencies.
 * Uses callback registration for cross-module calls back into plan-manager.
 */

import * as fs from 'fs/promises'
import { logger, LogContext } from '../logger'
import { devLog } from '../dev-log'
import { checkDockerAvailable, checkImageExists } from '../docker-sandbox'
import { getSelectedDockerImage, loadSettings } from '../settings-manager'
import {
  getPlanById,
  savePlan,
  loadTaskAssignments,
  saveTaskAssignment,
  getRepoCacheDir,
  getRepoModCacheDir,
} from '../config'
import { proxyEvents } from '../tool-proxy'
import { removeWorktree, deleteLocalBranch } from '../git-utils'
import { getRepositoryById } from '../repository-manager'
import { buildPrompt, type PromptVariables } from '../prompt-templates'
import { runPlanPhase, wrapPromptWithPlan } from '../plan-phase'
import { removeActiveWorkspace, removeWorkspaceFromTab, getPreferences } from '../state-manager'
import { getWorkspaces, deleteWorkspace } from '../config'
import { getPlanDir, BeadTask } from '../bd-client'
import { HeadlessAgent, HeadlessAgentOptions } from './docker-agent'
import { headlessAgents, headlessAgentInfo, tasksWithSuccessfulBdClose, isBdCloseListenerSetup, setBdCloseListenerSetup } from './state'
import { addPendingCriticTask, removePendingCriticTask } from '../teams/state'
import { emitHeadlessAgentUpdate, emitHeadlessAgentEvent } from './events'
import type { HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent, PlanWorktree, Repository, TaskAssignment } from '../../shared/types'

// --- Helper functions (pure, duplicated from plan-manager to avoid circular deps) ---

function isCriticTask(task: BeadTask): boolean {
  return task.labels?.includes('bismarck-critic') ?? false
}

function isFixupTask(task: BeadTask): boolean {
  return task.labels?.includes('critic-fixup') ?? false
}

function getOriginalTaskIdFromLabels(task: BeadTask): string | undefined {
  return task.labels?.find(l => l.startsWith('fixup-for:'))?.substring('fixup-for:'.length)
}

// --- Callback registration for cross-module dependencies ---

let onCriticNeeded: ((planId: string, taskId: string) => Promise<void>) | null = null
let onTaskReadyForReview: ((planId: string, taskId: string) => Promise<void>) | null = null
let onCriticCompleted: ((planId: string, criticTask: BeadTask) => Promise<void>) | null = null
let onAddPlanActivity: ((planId: string, type: string, message: string, details?: string) => void) | null = null
let onEmitTaskAssignmentUpdate: ((assignment: TaskAssignment) => void) | null = null
let onEmitPlanUpdate: ((plan: any) => void) | null = null

export function setOnCriticNeeded(cb: (planId: string, taskId: string) => Promise<void>): void {
  onCriticNeeded = cb
}

export function setOnTaskReadyForReview(cb: (planId: string, taskId: string) => Promise<void>): void {
  onTaskReadyForReview = cb
}

export function setOnCriticCompleted(cb: (planId: string, criticTask: BeadTask) => Promise<void>): void {
  onCriticCompleted = cb
}

export function setOnAddPlanActivity(cb: (planId: string, type: string, message: string, details?: string) => void): void {
  onAddPlanActivity = cb
}

export function setOnEmitTaskAssignmentUpdate(cb: (assignment: TaskAssignment) => void): void {
  onEmitTaskAssignmentUpdate = cb
}

export function setOnEmitPlanUpdate(cb: (plan: any) => void): void {
  onEmitPlanUpdate = cb
}

// --- Exported functions ---

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
 * Start a headless task agent for a plan
 */
export async function startHeadlessTaskAgent(
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
  const taskPrompt = await buildTaskPromptForHeadless(planId, task, repository, worktree)
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
    originalPrompt: taskPrompt,
  }
  headlessAgentInfo.set(task.id, agentInfo)

  // Run plan phase for regular tasks (skip for critic and fixup tasks)
  let executionPrompt = taskPrompt
  if (!isCriticTask(task) && !isFixupTask(task)) {
    agentInfo.status = 'planning'
    emitHeadlessAgentUpdate(agentInfo)

    const planResult = await runPlanPhase({
      taskDescription: task.title,
      worktreePath: worktree.path,
      image: selectedImage,
      planDir: planDir,
      planId: planId,
      guidance: repository.guidance,
      sharedCacheDir: getRepoCacheDir(repository.name),
      sharedModCacheDir: getRepoModCacheDir(repository.name),
      enabled: true,
      onEvent: (event) => {
        emitHeadlessAgentEvent(planId, task.id, event)
      },
    })

    logger.info('agent', 'Plan phase returned', logCtx, { success: planResult.success, durationMs: planResult.durationMs, error: planResult.error })

    if (planResult.success && planResult.plan) {
      executionPrompt = wrapPromptWithPlan(taskPrompt, planResult.plan)
      agentInfo.originalPrompt = executionPrompt
      agentInfo.planText = planResult.plan
      emitHeadlessAgentEvent(planId, task.id, {
        type: 'system',
        message: `Plan phase completed (${(planResult.durationMs / 1000).toFixed(1)}s)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      onAddPlanActivity?.(planId, 'info', `Plan phase for ${task.id} completed (${planResult.durationMs}ms)`)
      logger.info('agent', 'Plan phase succeeded', logCtx, { durationMs: planResult.durationMs, planLength: planResult.plan.length })
    } else {
      emitHeadlessAgentEvent(planId, task.id, {
        type: 'system',
        message: `⚠️ Plan phase failed${planResult.error ? `: ${planResult.error}` : ''} — proceeding with original prompt (no plan)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      onAddPlanActivity?.(planId, 'warning', `Plan phase for ${task.id} failed, proceeding with original prompt`)
      logger.warn('agent', 'Plan phase failed, proceeding with original prompt', logCtx, { error: planResult.error })
    }

    agentInfo.status = 'starting'
  }

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
        onEmitTaskAssignmentUpdate?.(assignment)
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
      onAddPlanActivity?.(planId, 'info', `[${task.id}] ${text.substring(0, 100)}...`)
    }
  })

  agent.on('complete', async (result) => {
    // Check if bd close succeeded - if so, treat as success even if container was force-stopped (exit 143)
    const bdCloseSucceeded = tasksWithSuccessfulBdClose.has(task.id)
    const effectiveSuccess = result.success || bdCloseSucceeded

    const durationMs = agentInfo.startedAt
      ? Date.now() - new Date(agentInfo.startedAt).getTime()
      : undefined

    logger.info('agent', 'Agent completion summary', { planId, taskId: task.id }, {
      effectiveSuccess,
      bdCloseSucceeded,
      exitCode: result.exitCode,
      durationMs,
      eventCount: agentInfo.events.length,
    })

    agentInfo.status = effectiveSuccess ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    // Clean up tracking
    headlessAgents.delete(task.id)
    tasksWithSuccessfulBdClose.delete(task.id)

    if (effectiveSuccess) {
      onAddPlanActivity?.(planId, 'success', `Task ${task.id} completed (headless)`)

      const settings = await loadSettings()
      const criticEnabled = settings.critic?.enabled ?? true
      const maxIterations = settings.critic?.maxIterations ?? 2

      if (criticEnabled && maxIterations > 0 && !isCriticTask(task) && !isFixupTask(task)) {
        // Regular task → spawn critic (pending critic state cleared by critic.ts)
        await onCriticNeeded?.(planId, task.id)
      } else if (isFixupTask(task)) {
        // Fix-up completed → re-trigger critic on original task
        const originalTaskId = getOriginalTaskIdFromLabels(task)
        if (originalTaskId && criticEnabled && maxIterations > 0) {
          // Check if limits already reached - avoid spawning a critic that would auto-approve
          const activePlan = getPlanById(planId)
          const wt = activePlan?.worktrees?.find(w => w.taskId === originalTaskId)
          const iteration = wt?.criticIteration ?? 0
          const maxFixups = settings.critic?.maxFixupsPerTask ?? 5
          const totalFixups = wt?.totalFixupCount ?? 0

          if (iteration >= maxIterations || totalFixups >= maxFixups) {
            logger.info('plan', 'Skipping critic - limits reached', { planId, taskId: task.id },
              { iteration, maxIterations, totalFixups, maxFixups })
            onAddPlanActivity?.(planId, 'info', `Auto-approving ${originalTaskId} (limits reached)`)
            if (wt) {
              wt.criticStatus = 'approved'
              await savePlan(activePlan!)
              onEmitPlanUpdate?.(activePlan!)
            }
            removePendingCriticTask(task.id)
            await onTaskReadyForReview?.(planId, originalTaskId)
          } else {
            // Critic will be spawned — pending critic cleared by critic.ts
            await onCriticNeeded?.(planId, originalTaskId)
          }
        } else {
          removePendingCriticTask(task.id)
          await onTaskReadyForReview?.(planId, task.id)
        }
      } else {
        // Critic task completed OR critics disabled → handle critic completion
        removePendingCriticTask(task.id)
        if (isCriticTask(task)) {
          await onCriticCompleted?.(planId, task)
        } else {
          await onTaskReadyForReview?.(planId, task.id)
        }
      }
    } else {
      removePendingCriticTask(task.id)
      onAddPlanActivity?.(planId, 'error', `Task ${task.id} failed`, result.error)
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(task.id)
    onAddPlanActivity?.(planId, 'error', `Task ${task.id} container error`, error.message)
  })

  // Create shared Go build cache and module cache directories for this repo
  const repoName = repository.name
  const sharedCacheDir = getRepoCacheDir(repoName)
  const sharedModCacheDir = getRepoModCacheDir(repoName)
  await fs.mkdir(sharedCacheDir, { recursive: true })
  await fs.mkdir(sharedModCacheDir, { recursive: true })

  // Start the agent
  try {
    await agent.start({
      prompt: executionPrompt,
      worktreePath: worktree.path,
      planDir,
      planId,
      taskId: task.id,
      image: selectedImage,
      claudeFlags: ['--model', agentModel],
      sharedCacheDir,
      sharedModCacheDir,
    })

    onAddPlanActivity?.(planId, 'info', `Task ${task.id} started (headless container)`)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(task.id)
    headlessAgentInfo.delete(task.id)

    throw error
  }
}

/**
 * Check if a task successfully ran bd close
 */
export function taskHasSuccessfulBdClose(taskId: string): boolean {
  return tasksWithSuccessfulBdClose.has(taskId)
}

/**
 * Set up listener for bd-close-success events to stop containers after grace period
 */
export function setupBdCloseListener(): void {
  if (isBdCloseListenerSetup()) return
  setBdCloseListenerSetup(true)

  proxyEvents.on('bd-close-success', async ({ planId, taskId }: { planId: string; taskId: string }) => {
    const logCtx: LogContext = { planId, taskId }
    logger.info('proxy', 'Received bd-close-success, marking task as successfully closed', logCtx)

    // Mark this task as having successfully closed via bd
    tasksWithSuccessfulBdClose.add(taskId)

    // Only mark non-critic tasks as pending critic — critic tasks don't spawn further critics
    const info = headlessAgentInfo.get(taskId)
    if (info?.agentType !== 'critic') {
      addPendingCriticTask(taskId)
    }

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
      const { stopStandaloneHeadlessAgent, cleanupStandaloneWorktree } = await import('./standalone')
      const { getWorkspaces, deleteWorkspace } = await import('../config')
      // Find the workspace before cleanup
      const workspaces = getWorkspaces()
      const workspace = workspaces.find(w => w.taskId === taskId && w.isStandaloneHeadless)
      // Stop the agent if running
      await stopStandaloneHeadlessAgent(taskId)
      // Clean up worktree and branches
      await cleanupStandaloneWorktree(taskId)
      // Remove workspace from tab and active workspaces to release the layout slot
      if (workspace) {
        removeActiveWorkspace(workspace.id)
        removeWorkspaceFromTab(workspace.id)
        deleteWorkspace(workspace.id)
        logger.info('agent', 'Released standalone agent layout slot', logCtx, { workspaceId: workspace.id })
      }
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
export async function stopAllHeadlessAgents(planId: string): Promise<void> {
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
async function buildTaskPromptForHeadless(planId: string, task: BeadTask, repository?: Repository, worktree?: PlanWorktree): Promise<string> {
  const plan = getPlanById(planId)
  // Use worktree's baseBranch if available (handles PR stacking), fall back to repository default
  const baseBranch = worktree?.baseBranch || repository?.defaultBranch || 'main'
  const planDir = getPlanDir(planId)

  // Note: Persona prompts are NOT injected into headless agents - they need to stay focused on tasks.
  // Persona prompts are only injected via hooks for interactive Claude Code sessions.

  // Build completion instructions based on branch strategy
  let completionInstructions: string
  if (plan?.branchStrategy === 'raise_prs') {
    completionInstructions = `2. Commit your changes with a clear message
3. Push your branch and create a PR:
   gh pr create --base "${baseBranch}" --title "..." --body "..."
4. Close task with PR URL:
   bd close ${task.id} --message "PR: <url>"`
  } else {
    // feature_branch strategy - just commit, Bismarck handles pushing on completion
    completionInstructions = `2. Commit your changes with a clear message
3. Close the task to signal completion:
   bd close ${task.id} --message "Completed: <brief summary>"`
  }

  // Build completion criteria section - only include in PR mode where each task raises its own PR
  // In feature branch mode, completion criteria should be handled by a final "raise PR" task
  const completionCriteria = (plan?.branchStrategy === 'raise_prs' && repository?.completionCriteria)
    ? `Before marking your work complete, ensure these acceptance criteria pass:
${repository.completionCriteria}
Keep iterating until all criteria are satisfied.

`
    : ''

  // Build guidance section - always include if available (applies regardless of branch strategy)
  const guidance = repository?.guidance
    ? `
=== REPOSITORY GUIDANCE ===
Follow these repo-specific guidelines:
${repository.guidance}
`
    : ''

  // Build git commands section based on branch strategy
  const gitCommands = plan?.branchStrategy === 'raise_prs'
    ? `1. Git:
   - git status
   - git add .
   - git commit -m "Your commit message"
   - git push origin HEAD (creates remote branch)

   IMPORTANT: For git commit, always use -m "message" inline.
   Do NOT use --file or -F flags - file paths don't work across the proxy.

2. GitHub CLI (gh):
   - gh pr create --base "${baseBranch}" --title "..." --body "..."
   - gh pr view
   - All standard gh commands work`
    : `1. Git:
   - git status
   - git add .
   - git commit -m "Your commit message"

   IMPORTANT: For git commit, always use -m "message" inline.
   Do NOT use --file or -F flags - file paths don't work across the proxy.

   NOTE: Do NOT push your commits directly. Bismarck will automatically push
   your commits to the shared feature branch when you close the task.

2. GitHub CLI (gh):
   - gh pr view (view existing PRs)

   NOTE: In feature branch mode, Bismarck handles PR creation.`

  // Build task-raising instructions for bottom-up mode
  // In bottom-up mode, workers can discover and raise new tasks during execution
  const taskRaisingInstructions = plan?.teamMode === 'bottom-up'
    ? `
=== RAISING NEW TASKS (Bottom-Up Mode) ===
If you discover additional work needed while completing this task, you can raise new tasks:
  bd --sandbox create "<task title>" --description "<detailed description of what needs to change and why>" --label needs-triage

Include enough context in the description for a manager to triage effectively:
- What you discovered and where (file paths, line numbers)
- Why it matters (bug, missing feature, tech debt)
- Any relevant code references

Do NOT attempt to do the extra work yourself - raise a task and stay focused on your assigned task.
`
    : ''

  const variables: PromptVariables = {
    taskId: task.id,
    taskTitle: task.title,
    baseBranch,
    planDir,
    completionInstructions,
    gitCommands,
    completionCriteria,
    guidance,
    taskRaisingInstructions,
    // Note: bismarckPrefix/ottoPrefix are NOT included for plan task agents
    // Persona prompts are only injected via hooks for interactive Claude Code sessions
  }

  return buildPrompt('task', variables)
}
