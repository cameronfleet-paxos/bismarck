import { logger, type LogContext } from '../logger'
import {
  savePlan,
  getPlanById,
  saveWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
  getWorktreePath,
  withPlanLock,
  withRepoLock,
} from '../config'
import {
  createWorktree,
  generateUniqueBranchName,
} from '../git-utils'
import type { BeadTask } from '../bd-client'
import type { Agent, Repository, PlanWorktree } from '../../shared/types'
import { DEFAULT_MAX_PARALLEL_AGENTS } from './state'
import { addPlanActivity } from './events'
import { generateWorktreeId } from './helpers'
import { getBaseBranchForTask } from './git-strategy'

/**
 * Check if we can spawn more task agents for a plan
 */
export function canSpawnMoreAgents(planId: string): boolean {
  const plan = getPlanById(planId)
  if (!plan) return false

  const maxParallel = plan.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS
  const activeCount = getActiveTaskAgentCount(planId)

  return activeCount < maxParallel
}

/**
 * Get count of active task agents for a plan
 */
export function getActiveTaskAgentCount(planId: string): number {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return 0

  return plan.worktrees.filter(w => w.status === 'active').length
}

/**
 * Create a fresh worktree and task agent for a task
 */
export async function createTaskAgentWithWorktree(
  planId: string,
  task: BeadTask,
  repository: Repository,
  worktreeName: string
): Promise<{ agent: Agent; worktree: PlanWorktree } | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId, taskId: task.id, repo: repository.name }
  logger.info('worktree', `Creating worktree for task`, logCtx, { worktreeName })

  // Serialize git operations per repo to prevent lock contention
  const gitResult = await withRepoLock(repository.rootPath, async () => {
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

    return { branchName, worktreePath, baseBranch }
  })

  if (!gitResult) return null

  const { branchName, worktreePath, baseBranch } = gitResult

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
    isHeadless: true,
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
