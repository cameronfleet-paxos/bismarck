import { logger, type LogContext } from '../logger'
import { devLog } from '../dev-log'
import {
  getPlanById,
  loadTaskAssignments,
  saveTaskAssignment,
  deleteTaskAssignment,
  getWorkspaces,
  getClaudeOAuthToken,
} from '../config'
import {
  bdList,
  bdUpdate,
  bdDetectCycles,
  type BeadTask,
} from '../bd-client'
import {
  remoteBranchExists,
  fetchBranch,
} from '../git-utils'
import { getAllRepositories, getRepositoryById } from '../repository-manager'
import { startToolProxy, isProxyRunning } from '../tool-proxy'
import { runSetupToken } from '../oauth-setup'
import type { TaskAssignment } from '../../shared/types'
import { getPollInterval, setPollInterval, getSyncInProgress, setSyncInProgress, getLastCycleCheckTime, setLastCycleCheckTime, POLL_INTERVAL_MS, isManagerRunning, isArchitectRunning, getStagnationTracker, setStagnationTracker, clearStagnationTracker, getLastPollSummaryTime, setLastPollSummaryTime, clearLastPollSummaryTime, type StagnationTracker } from './state'
import { addPlanActivity, emitTaskAssignmentUpdate, emitBeadTasksUpdate, emitStateUpdate } from './events'
import { getOriginalTaskIdFromLabels } from './helpers'
import { canSpawnMoreAgents, getActiveTaskAgentCount, createTaskAgentWithWorktree } from './worktree-agents'
import { maybeSpawnMergeAgent } from './git-strategy'
import { updatePlanStatuses } from './completion'
import { getMainWindow } from './state'
// Import headless functions
import { startHeadlessTaskAgent, setupBdCloseListener } from '../headless/team-agents'
import { spawnManager } from './manager'
import { spawnArchitect } from './architect'

/**
 * Start polling bd for task updates for a specific plan
 * @param planId - The ID of the plan to poll for
 */
export function startTaskPolling(planId: string): void {
  if (getPollInterval()) return // Already polling

  setPollInterval(setInterval(async () => {
    await syncTasksForPlan(planId)
  }, POLL_INTERVAL_MS))

  // Do an immediate sync
  syncTasksForPlan(planId)
}

/**
 * Stop polling bd for task updates
 */
export function stopTaskPolling(planId?: string): void {
  const interval = getPollInterval()
  if (interval) {
    clearInterval(interval)
    setPollInterval(null)
  }
  if (planId) {
    clearStagnationTracker(planId)
    clearLastPollSummaryTime(planId)
  }
}

/**
 * Sync tasks from bd and dispatch to agents for a specific plan
 * Uses in-memory plan state via getPlanById instead of reading from disk
 * @param planId - The ID of the plan to sync tasks for
 */
async function syncTasksForPlan(planId: string): Promise<void> {
  // Guard against overlapping syncs - prevents race conditions when creating worktrees
  if (getSyncInProgress()) {
    return
  }
  setSyncInProgress(true)

  try {
    await doSyncTasksForPlan(planId)
  } finally {
    setSyncInProgress(false)
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
    stopTaskPolling(planId)
    return
  }

  logger.debug('plan', 'Syncing tasks from bd', logCtx)

  try {
    // Get tasks marked as ready for Bismarck (from the active plan's directory)
    const readyTasks = await bdList(activePlan.id, { labels: ['bismarck-ready'], status: 'open' })
    const closedTasks = await bdList(activePlan.id, { status: 'closed' })
    const closedTaskIds = new Set(closedTasks.map(t => t.id))

    // Filter out tasks that still have open blockers, collecting deferred task info
    const deferredTaskMap: Map<string, string[]> = new Map() // taskId -> open blocker IDs
    const dispatchableTasks = readyTasks.filter(task => {
      if (!task.blockedBy || task.blockedBy.length === 0) return true
      const openBlockers = task.blockedBy.filter(id => !closedTaskIds.has(id))
      if (openBlockers.length > 0) {
        logger.debug('plan', `Task ${task.id} has open blockers, deferring`, logCtx, { openBlockers })
        deferredTaskMap.set(task.id, openBlockers)
        return false
      }
      return true
    })

    if (dispatchableTasks.length > 0) {
      logger.info('plan', `Found ${dispatchableTasks.length} dispatchable tasks (${readyTasks.length} ready, ${readyTasks.length - dispatchableTasks.length} blocked)`, logCtx, {
        taskIds: dispatchableTasks.map(t => t.id),
      })
    }

    // Stagnation detection: track deferred tasks across poll cycles
    const now = Date.now()
    const currentDeferredIds = new Set(deferredTaskMap.keys())
    const tracker = getStagnationTracker(activePlan.id)

    if (currentDeferredIds.size > 0) {
      if (tracker) {
        // Check if the deferred set is identical to last cycle
        const same = currentDeferredIds.size === tracker.deferredTaskIds.size &&
          [...currentDeferredIds].every(id => tracker.deferredTaskIds.has(id))

        if (same) {
          const stuckDurationMs = now - tracker.unchangedSince
          const STAGNATION_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

          if (stuckDurationMs >= STAGNATION_THRESHOLD_MS && !tracker.warningEmitted) {
            // Build details for each stuck task
            const details = [...deferredTaskMap.entries()]
              .map(([taskId, blockers]) => `${taskId} blocked by [${blockers.join(', ')}]`)
              .join('; ')
            const stuckMinutes = Math.round(stuckDurationMs / 60_000)

            logger.warn('plan', `Stagnation detected: ${currentDeferredIds.size} task(s) blocked for ${stuckMinutes}m`, logCtx, {
              deferredTaskIds: [...currentDeferredIds],
              blockerDetails: Object.fromEntries(deferredTaskMap),
            })
            addPlanActivity(
              activePlan.id,
              'warning',
              `${currentDeferredIds.size} task(s) stuck for ${stuckMinutes}+ minutes`,
              details
            )
            tracker.warningEmitted = true
            setStagnationTracker(activePlan.id, tracker)
          }
        } else {
          // Deferred set changed — reset tracker
          setStagnationTracker(activePlan.id, {
            deferredTaskIds: currentDeferredIds,
            unchangedSince: now,
            warningEmitted: false,
          })
        }
      } else {
        // First observation of deferred tasks
        setStagnationTracker(activePlan.id, {
          deferredTaskIds: currentDeferredIds,
          unchangedSince: now,
          warningEmitted: false,
        })
      }
    } else if (tracker) {
      // No deferred tasks — clear tracker
      clearStagnationTracker(activePlan.id)
    }

    // Poll cycle summary log (every 30 seconds)
    const lastSummaryTime = getLastPollSummaryTime(activePlan.id)
    if (now - lastSummaryTime >= 30_000) {
      const activeAgentCount = getActiveTaskAgentCount(activePlan.id)
      logger.info('plan', 'Poll cycle summary', logCtx, {
        totalReady: readyTasks.length,
        dispatchable: dispatchableTasks.length,
        deferred: deferredTaskMap.size,
        closed: closedTasks.length,
        activeAgents: activeAgentCount,
        ...(deferredTaskMap.size > 0 ? { deferredTaskIds: [...deferredTaskMap.keys()] } : {}),
      })
      setLastPollSummaryTime(activePlan.id, now)
    }

    // Periodic cycle detection (once per 60s)
    if (!getLastCycleCheckTime() || now - getLastCycleCheckTime()! > 60_000) {
      setLastCycleCheckTime(now)
      try {
        const cycles = await bdDetectCycles(activePlan.id)
        if (cycles.length > 0) {
          logger.warn('plan', `Dependency cycles detected: ${cycles.length}`, logCtx, { cycles })
          addPlanActivity(activePlan.id, 'warning', 'Dependency cycle detected',
            `${cycles.length} cycle(s) found - tasks may be permanently blocked`)
        }
      } catch (err) {
        logger.debug('plan', 'Cycle detection failed (non-critical)', logCtx, {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    // Dispatch tasks concurrently - processReadyTask checks canSpawnMoreAgents()
    // and existing assignments internally, so concurrent dispatch is safe.
    // Note: slight over-spawning is possible if multiple tasks pass the check
    // before any worktree is created, but withPlanLock serializes worktree
    // additions and the count will be accurate on the next poll cycle.
    await Promise.allSettled(dispatchableTasks.map(task => processReadyTask(activePlan.id, task)))

    // Check for completed tasks and update assignments
    const allAssignments = loadTaskAssignments(activePlan.id)

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

    // Recover stale pending assignments (safety net for missed cleanup)
    const STALE_ASSIGNMENT_THRESHOLD_MS = 2 * 60 * 1000 // 2 minutes
    for (const assignment of allAssignments) {
      if (assignment.status === 'pending') {
        const assignedAt = new Date(assignment.assignedAt).getTime()
        if (now - assignedAt > STALE_ASSIGNMENT_THRESHOLD_MS) {
          // Check if there's actually an active agent for this task
          const hasAgent = assignment.agentId && getWorkspaces().some(a => a.id === assignment.agentId)
          if (!hasAgent) {
            logger.info('plan', `Recovered stale pending assignment for ${assignment.beadId}`, logCtx, {
              assignedAt: assignment.assignedAt,
              ageMs: now - assignedAt,
            })
            deleteTaskAssignment(activePlan.id, assignment.beadId)
          }
        }
      }
    }

    // Update plan statuses based on task completion
    await updatePlanStatuses()

    // Bottom-up mode: detect needs-triage and needs-architect tasks
    if (activePlan.teamMode === 'bottom-up') {
      try {
        const triageTasks = await bdList(activePlan.id, { labels: ['needs-triage'], status: 'open' })
        if (triageTasks.length > 0 && !isManagerRunning(activePlan.id)) {
          await spawnManager(activePlan.id, triageTasks)
        }

        const architectTasks = await bdList(activePlan.id, { labels: ['needs-architect'], status: 'open' })
        if (architectTasks.length > 0 && !isArchitectRunning(activePlan.id)) {
          await spawnArchitect(activePlan.id, architectTasks)
        }
      } catch (error) {
        logger.warn('plan', 'Error checking bottom-up tasks', logCtx, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Notify renderer about task changes so UI can refresh
    emitBeadTasksUpdate(activePlan.id)
  } catch (error) {
    logger.error('plan', 'Error syncing tasks from bd', logCtx, {
      error: error instanceof Error ? error.message : String(error),
    })
    addPlanActivity(
      activePlan.id,
      'error',
      'Failed to sync tasks',
      error instanceof Error ? error.message : 'bd command failed'
    )
  }
}

/**
 * Process a fix-up task from a critic - runs in the same worktree as the original task.
 */
async function processFixupTask(planId: string, task: BeadTask, originalTaskId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return

  const logCtx: LogContext = { planId, taskId: task.id }

  // Find the original task's worktree
  const worktree = plan.worktrees.find(w => w.taskId === originalTaskId)
  if (!worktree) {
    addPlanActivity(planId, 'warning', `Fix-up ${task.id}: original worktree not found for ${originalTaskId}`)
    return
  }

  // Find the repository
  const repository = worktree.repositoryId ? await getRepositoryById(worktree.repositoryId) : null
  if (!repository) {
    addPlanActivity(planId, 'warning', `Fix-up ${task.id}: repository not found`)
    return
  }

  // Create task assignment
  const assignment: TaskAssignment = {
    beadId: task.id,
    agentId: worktree.agentId, // Reuse the existing agent ID reference
    planId,
    status: 'pending',
    assignedAt: new Date().toISOString(),
  }
  saveTaskAssignment(planId, assignment)
  emitTaskAssignmentUpdate(assignment)

  logger.info('task', 'Processing fix-up task in existing worktree', logCtx, {
    originalTaskId,
    worktreePath: worktree.path,
  })
  addPlanActivity(planId, 'info', `Processing fix-up: ${task.id}`, `Using worktree from ${originalTaskId}`)

  // Ensure tool proxy is running
  if (!isProxyRunning()) {
    await startToolProxy()
  }
  setupBdCloseListener()

  // Start headless agent in the existing worktree
  try {
    await startHeadlessTaskAgent(planId, task, worktree, repository)

    assignment.status = 'in_progress'
    saveTaskAssignment(planId, assignment)
    emitTaskAssignmentUpdate(assignment)

    // Update bd labels
    await bdUpdate(planId, task.id, {
      removeLabels: ['bismarck-ready'],
      addLabels: ['bismarck-sent'],
    })
  } catch (error) {
    addPlanActivity(planId, 'error', `Failed to start fix-up agent: ${task.id}`,
      error instanceof Error ? error.message : 'Unknown error')
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

  // Handle critic fix-up tasks - reuse existing worktree
  if (task.labels?.includes('critic-fixup')) {
    const originalTaskId = getOriginalTaskIdFromLabels(task)
    if (originalTaskId) {
      await processFixupTask(planId, task, originalTaskId)
      return
    }
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
    deleteTaskAssignment(planId, task.id)
    logger.warn('task', 'Cleaned up stale assignment after worktree creation failure', logCtx)
    return
  }

  const { agent, worktree } = result
  logger.timeEnd(`worktree-setup-${task.id}`, 'task', 'Worktree and agent created', logCtx)
  logger.info('task', 'Task agent created', { ...logCtx, agentId: agent.id }, {
    worktreePath: worktree.path,
    branch: worktree.branch,
  })
  assignment.agentId = agent.id

  // Start agent in Docker container
  logger.info('task', 'Starting headless agent', logCtx)
  try {
      // Check for OAuth token before starting headless agent
      let token = getClaudeOAuthToken()
      if (!token) {
        const mainWindow = getMainWindow()
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
      const mainWindow = getMainWindow()
      devLog('[PlanManager] Sending headless-agent-started event', { taskId: task.id, planId, worktreePath: worktree.path })
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('headless-agent-started', {
          taskId: task.id,
          planId,
          worktreePath: worktree.path,
        })
        devLog('[PlanManager] headless-agent-started event sent successfully')
      } else {
        devLog('[PlanManager] Cannot send headless-agent-started - mainWindow:', mainWindow ? 'exists but destroyed' : 'null')
      }

      emitStateUpdate()
    } catch (error) {
      addPlanActivity(
        planId,
        'error',
        `Failed to start headless agent for ${task.id}`,
        error instanceof Error ? error.message : 'Unknown error'
      )
      deleteTaskAssignment(planId, task.id)
      logger.warn('task', 'Cleaned up stale assignment after headless agent startup failure', logCtx)
    }
}

