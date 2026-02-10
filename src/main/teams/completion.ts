import { logger, type LogContext } from '../logger'
import { devLog } from '../dev-log'
import {
  loadPlans,
  savePlan,
  getPlanById,
} from '../config'
import { bdList } from '../bd-client'
import { stopAllContainers } from '../docker-sandbox'
import { stopToolProxy, isProxyRunning } from '../tool-proxy'
import type { Plan } from '../../shared/types'
import { executingPlans } from './state'
import { addPlanActivity, emitPlanUpdate, emitBeadTasksUpdate } from './events'
import { cleanupOrchestrator } from './orchestrator'
import { cleanupAllWorktrees } from './task-cleanup'
import { stopTaskPolling } from './task-polling'
import { refreshGitSummary } from './git-strategy'
// Import headless functions
import { stopAllHeadlessAgents, stopHeadlessTaskAgent } from '../headless/team-agents'
import { headlessAgents } from '../headless/state'

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
 * Cleanup all plan-related resources (called on app shutdown)
 */
export async function cleanupPlanManager(): Promise<void> {
  devLog('[PlanManager] Cleaning up...')

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
      const { stopToolProxy } = require('../tool-proxy')
      await stopToolProxy()
    } catch (error) {
      console.error('[PlanManager] Error stopping tool proxy:', error)
    }
  }

  devLog('[PlanManager] Cleanup complete')
}

/**
 * Update plan statuses based on task completion
 */
export async function updatePlanStatuses(): Promise<void> {
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
