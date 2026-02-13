import * as fs from 'fs'
import * as path from 'path'
import { logger, type LogContext } from '../logger'
import { devLog } from '../dev-log'
import {
  savePlan,
  getPlanById,
  deleteWorkspace,
  getWorkspaces,
  getRepoCacheDir,
  getRepoModCacheDir,
  withGitPushLock,
  withPlanLock,
} from '../config'
import {
  bdCreate,
  bdClose,
  bdGetDependents,
  bdAddDependency,
  getPlanDir,
} from '../bd-client'
import {
  pushBranchToRemoteBranch,
  getCommitsBetween,
  getGitHubUrlFromRemote,
  fetchBranch,
  fetchBranchWithForce,
  rebaseOntoRemoteBranch,
  remoteBranchExists,
} from '../git-utils'
import { getTerminalForWorkspace, closeTerminal } from '../terminal'
import { removeActiveWorkspace, removeWorkspaceFromTab, getPreferences } from '../state-manager'
import { getRepositoryById, getAllRepositories } from '../repository-manager'
import { HeadlessAgent } from '../headless'
import { getSelectedDockerImage } from '../settings-manager'
import { execWithPath } from '../exec-utils'
import type { Plan, PlanWorktree, PlanCommit, PlanPullRequest, Repository, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent } from '../../shared/types'
import type { BeadTask } from '../bd-client'
import { getMainWindow } from './state'
import { addPlanActivity, emitPlanUpdate, emitStateUpdate } from './events'
// Import headless state/events for merge resolution agents
import { headlessAgents, headlessAgentInfo, tasksWithSuccessfulBdClose } from '../headless/state'
import { emitHeadlessAgentUpdate, emitHeadlessAgentEvent } from '../headless/events'

/**
 * Mark a worktree as ready for review (task agent completed)
 */
export async function markWorktreeReadyForReview(planId: string, taskId: string): Promise<void> {
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

    // Close the beads task to unblock dependents
    // (The agent should have already closed it via bd close, but ensure it's closed)
    try {
      await bdClose(planId, taskId)
      logger.info('task', 'Closed beads task', logCtx)
    } catch (err) {
      // Expected if agent already closed it
      logger.debug('task', 'Beads task close returned error (likely already closed)', logCtx, {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }

    // Return worktree copy for use outside the lock
    return { ...worktree }
  })

  if (!worktreeForStrategy) return

  // Git operations can happen outside the lock (no plan state modification)
  try {
    await handleTaskCompletionStrategy(planId, taskId, worktreeForStrategy)
  } catch (error) {
    logger.error('git', 'Error handling task completion strategy', { planId, taskId }, { error: error instanceof Error ? error.message : String(error) })
    addPlanActivity(planId, 'warning', `Git operation warning for ${taskId}`, error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Determine the base branch for a task based on the plan's branch strategy
 * - feature_branch: dependent tasks base on the feature branch (to get blocker commits)
 * - raise_prs: use the blocker's branch for dependent tasks, or repository's default branch for first tasks
 */
export async function getBaseBranchForTask(
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
  devLog(`[PlanManager] Creating feature branch ${featureBranch} from ${defaultBase}`)
  await pushBranchToRemoteBranch(
    repository.rootPath,
    `origin/${defaultBase}`,
    featureBranch
  )
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
    // Clean working tree before rebase — agents may leave modified/untracked files
    // that cause "local changes would be overwritten by merge" errors
    try {
      await execWithPath('git checkout -- .', { cwd: worktree.path })
      await execWithPath('git clean -fd', { cwd: worktree.path })
      logger.debug('plan', 'Cleaned working tree before rebase', logCtx)
    } catch (cleanErr) {
      logger.warn('plan', 'Failed to clean working tree before rebase', logCtx, {
        error: cleanErr instanceof Error ? cleanErr.message : 'Unknown error',
      })
    }

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
 * Record a pull request created by a task agent
 * Used for raise_prs strategy
 */
async function recordPullRequest(plan: Plan, worktree: PlanWorktree, repository: Repository): Promise<void> {
  // The agent should have created a PR and closed the task with the PR URL
  // For now, we'll try to extract PR info using gh CLI

  try {
    // Try to get PR info using gh CLI (use execWithPath for extended PATH)
    // Use repository.rootPath as cwd instead of worktree.path to avoid TLS issues
    // that can occur when running gh from a git worktree directory
    const { stdout } = await execWithPath(
      `gh pr list --head "${worktree.branch}" --json number,title,url,baseRefName,headRefName,state --limit 1`,
      { cwd: repository.rootPath }
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
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.warn('git', `Failed to detect PR for task ${worktree.taskId}: ${errorMsg}`, { planId: plan.id })
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
export async function refreshGitSummary(plan: Plan): Promise<void> {
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
 * Check if parallel blocker tasks need to be merged before a dependent task can start.
 * Returns true if a merge agent was spawned (caller should wait and retry).
 *
 * A merge agent is needed when:
 * 1. The dependent task has multiple blockers
 * 2. Those blockers ran in parallel (not depending on each other)
 * 3. At least one blocker's commits haven't been merged yet
 */
export async function maybeSpawnMergeAgent(plan: Plan, dependentTask: BeadTask): Promise<boolean> {
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
