/**
 * Context Exhaustion Recovery
 *
 * Handles the case where a headless task agent runs out of context window
 * before completing its task. Detects this situation and spawns a
 * continuation agent in the same worktree with a summary of what was
 * accomplished so far.
 */

import { logger, type LogContext } from '../logger'
import { getPlanById, saveTaskAssignment, loadTaskAssignments, deleteTaskAssignment } from '../config'
import { bdUpdate } from '../bd-client'
import { startHeadlessTaskAgent, setupBdCloseListener } from '../headless/team-agents'
import { startToolProxy, isProxyRunning } from '../tool-proxy'
import { addPlanActivity } from './events'
import { emitTaskAssignmentUpdate } from './events'
import type { PlanWorktree, Repository, TaskAssignment } from '../../shared/types'

/**
 * Handle context exhaustion retry for a failed task.
 *
 * When an agent runs out of context, we:
 * 1. Keep the same worktree (it may have partial work committed)
 * 2. Re-open the task for a fresh agent
 * 3. Start a new headless agent with context about what was done
 */
export async function handleContextExhaustionRetry(
  planId: string,
  taskId: string,
  worktree: PlanWorktree,
  repository: Repository,
): Promise<void> {
  const logCtx: LogContext = { planId, taskId }
  const retryCount = worktree.contextExhaustionRetries ?? 1

  logger.info('plan', `Context exhaustion retry ${retryCount} for task ${taskId}`, logCtx)

  // Re-label the task as bismarck-ready so it can be dispatched again
  try {
    await bdUpdate(planId, taskId, {
      removeLabels: ['bismarck-sent'],
      addLabels: ['bismarck-ready', `context-retry:${retryCount}`],
    })
  } catch (err) {
    logger.warn('plan', 'Failed to update task labels for retry', logCtx, {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Clean up old task assignment so the polling loop can re-dispatch
  try {
    deleteTaskAssignment(planId, taskId)
  } catch {
    // ignore
  }

  // Create a new assignment for the retry
  const assignment: TaskAssignment = {
    beadId: taskId,
    agentId: worktree.agentId,
    planId,
    status: 'pending',
    assignedAt: new Date().toISOString(),
  }
  saveTaskAssignment(planId, assignment)
  emitTaskAssignmentUpdate(assignment)

  // Ensure tool proxy is running
  if (!isProxyRunning()) {
    await startToolProxy()
  }
  setupBdCloseListener()

  // Build a modified task for the continuation agent
  // The key difference: the agent gets context about previous work
  const continuationTask = {
    id: taskId,
    title: `[Continuation ${retryCount}] ${worktree.taskId}`,
    labels: [`context-retry:${retryCount}`, 'bismarck-sent'],
    blockedBy: [],
  }

  try {
    await startHeadlessTaskAgent(planId, continuationTask as any, worktree, repository)

    assignment.status = 'in_progress'
    saveTaskAssignment(planId, assignment)
    emitTaskAssignmentUpdate(assignment)

    // Update bd labels
    await bdUpdate(planId, taskId, {
      removeLabels: ['bismarck-ready'],
      addLabels: ['bismarck-sent'],
    })

    addPlanActivity(planId, 'info',
      `Continuation agent started for ${taskId} (retry ${retryCount})`,
      'Agent will review git diff and continue from where the previous agent stopped')

  } catch (error) {
    addPlanActivity(planId, 'error',
      `Failed to start continuation agent for ${taskId}`,
      error instanceof Error ? error.message : 'Unknown error')
    deleteTaskAssignment(planId, taskId)
  }
}
