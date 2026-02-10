import * as fs from 'fs/promises'
import * as path from 'path'
import { logger, type LogContext } from '../logger'
import { devLog } from '../dev-log'
import {
  loadPlans,
  savePlan,
  getPlanById,
  deletePlan,
  loadTaskAssignments,
  saveTaskAssignments,
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
  loadPlanActivities,
  loadHeadlessAgentInfo,
} from '../config'
import { getPlanDir } from '../bd-client'
import { getTerminalForWorkspace, closeTerminal } from '../terminal'
import { removeActiveWorkspace, deleteTab } from '../state-manager'
import type { Plan, TaskAssignment, PlanStatus, BranchStrategy } from '../../shared/types'
import { setMainWindow, getMainWindow, planActivities, executingPlans, DEFAULT_MAX_PARALLEL_AGENTS } from './state'
import { emitPlanUpdate, clearPlanActivities } from './events'
import { generatePlanId, generateDiscussionId } from './helpers'
import { BrowserWindow } from 'electron'
import { headlessAgentInfo } from '../headless/state'

/**
 * Set the main window reference for sending IPC events
 */
export function setPlanManagerWindow(window: BrowserWindow | null): void {
  setMainWindow(window)
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
      devLog(`[PlanManager] Loaded ${activities.length} activities for plan ${plan.id}`)
    }

    // Only load headless agent info for active plans (they may need monitoring)
    if (plan.status === 'delegating' || plan.status === 'in_progress' || plan.status === 'ready_for_review') {
      const agents = loadHeadlessAgentInfo(plan.id)
      for (const agent of agents) {
        if (agent.taskId) {
          headlessAgentInfo.set(agent.taskId, agent)
          devLog(`[PlanManager] Loaded headless agent info for task ${agent.taskId}`)
        }
      }
    }
  }
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
 * Get task assignments for a specific plan
 */
export function getTaskAssignments(planId: string): TaskAssignment[] {
  return loadTaskAssignments(planId)
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
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('team-plan-deleted', planId)
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
