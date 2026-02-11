import { logger, type LogContext } from '../logger'
import {
  getPlanById,
  deleteWorkspace,
  getWorkspaces,
  savePlan,
} from '../config'
import {
  removeWorktree,
  pruneWorktrees,
} from '../git-utils'
import { getTerminalForWorkspace, closeTerminal } from '../terminal'
import { removeActiveWorkspace, removeWorkspaceFromTab } from '../state-manager'
import { getRepositoryById, getAllRepositories } from '../repository-manager'
import { addPlanActivity } from './events'
// Import headless functions
import { stopHeadlessTaskAgent } from '../headless/team-agents'

/**
 * Cleanup a task agent and its worktree
 */
export async function cleanupTaskAgent(planId: string, taskId: string): Promise<void> {
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
