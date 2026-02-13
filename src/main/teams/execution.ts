import * as fs from 'fs/promises'
import * as path from 'path'
import { logger, type LogContext } from '../logger'
import { devLog } from '../dev-log'
import {
  savePlan,
  getPlanById,
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
  saveTaskAssignments,
  getPlanWorktreesPath,
} from '../config'
import {
  ensureBeadsRepo,
  bdCreate,
  getPlanDir,
} from '../bd-client'
import { getTerminalForWorkspace, closeTerminal, getTerminalEmitter } from '../terminal'
import { queueTerminalCreation } from '../terminal-queue'
import { createTab, addWorkspaceToTab, addActiveWorkspace, removeActiveWorkspace, removeWorkspaceFromTab, deleteTab } from '../state-manager'
import {
  getRepositoryById,
  getRepositoryByPath,
  getAllRepositories,
} from '../repository-manager'
import {
  removeWorktree,
  pruneWorktrees,
  deleteRemoteBranch,
  deleteLocalBranch,
} from '../git-utils'
import type { Plan, Workspace, PlanStatus, TeamMode } from '../../shared/types'
import { getMainWindow, executingPlans, clearBottomUpState } from './state'
import { addPlanActivity, clearPlanActivities, emitPlanUpdate, emitStateUpdate } from './events'
import { buildOrchestratorPrompt, buildPlanAgentPrompt, cleanupPlanAgent } from './orchestrator'
import { startTaskPolling } from './task-polling'
// Import headless functions
import { stopAllHeadlessAgents } from '../headless/team-agents'
import { headlessAgentInfo } from '../headless/state'

/**
 * Execute a plan using a reference agent's working directory
 */
export async function executePlan(planId: string, referenceAgentId: string, teamMode?: TeamMode): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Starting plan execution', logCtx, { referenceAgentId, teamMode, title: plan.title })

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

  // Create gate task for planner/orchestrator synchronization
  const gateTaskId = await bdCreate(plan.id, {
    title: 'Planning complete',
    labels: ['bismarck-gate'],
  })
  logger.info('plan', `Created gate task: ${gateTaskId}`, logCtx)

  // Update plan with reference agent, team mode, and set status to delegating
  plan.referenceAgentId = referenceAgentId
  if (teamMode) {
    plan.teamMode = teamMode
  }
  plan.status = 'delegating'
  plan.updatedAt = new Date().toISOString()

  // Create a dedicated tab for the planner/orchestrator
  const orchestratorTab = createTab(plan.title.substring(0, 20), { isPlanTab: true, planId: plan.id })
  plan.orchestratorTabId = orchestratorTab.id

  await savePlan(plan)
  emitPlanUpdate(plan)

  if (plan.teamMode === 'bottom-up') {
    // === BOTTOM-UP MODE ===
    // No orchestrator — planner assigns repos/worktrees and marks tasks bismarck-ready directly.
    // Manager and Architect agents are spawned on-demand by the polling loop.

    const mainWindow = getMainWindow()
    if (!mainWindow) {
      addPlanActivity(planId, 'error', 'Cannot start planner - window not available')
      executingPlans.delete(planId)
      plan.status = 'discussed'
      plan.updatedAt = new Date().toISOString()
      await savePlan(plan)
      emitPlanUpdate(plan)
      return plan
    }

    try {
      // Create plan agent workspace
      const planAgentWorkspace: Workspace = {
        id: `plan-agent-${planId}`,
        name: `Planner (${plan.title})`,
        directory: planDir,
        purpose: 'Initial discovery and task creation (bottom-up)',
        theme: 'blue',
        icon: getRandomUniqueIcon(allAgents),
        isPlanAgent: true,
      }
      saveWorkspace(planAgentWorkspace)
      plan.planAgentWorkspaceId = planAgentWorkspace.id
      await savePlan(plan)

      // Build planner prompt with task assignment instructions for bottom-up mode
      const planAgentClaudeFlags = `--add-dir "${planDir}" --add-dir "${referenceWorkspace.directory}" --allowedTools "Bash(bd --sandbox *),Bash(bd *)"`
      const repository = referenceWorkspace.repositoryId
        ? await getRepositoryById(referenceWorkspace.repositoryId)
        : await getRepositoryByPath(referenceWorkspace.directory)

      // Get all repositories for assignment instructions
      const allRepos = await getAllRepositories()
      const repoNames = allRepos.map(r => r.name).join(', ')
      const taskAssignmentInstructions = `
=== TASK ASSIGNMENT (Bottom-Up Mode) ===
In bottom-up mode, YOU are responsible for assigning tasks to repositories and worktrees.
There is no separate orchestrator. When creating tasks:

For well-scoped tasks you can fully specify:
1. Assign each task a repository: bd --sandbox update <task-id> --add-label "repo:<repo-name>"
2. Assign a unique worktree name: bd --sandbox update <task-id> --add-label "worktree:<name>"
3. Mark as ready: bd --sandbox update <task-id> --add-label bismarck-ready

You can combine all labels in one command:
  bd --sandbox update <task-id> --add-label "repo:<name>" --add-label "worktree:<name>" --add-label bismarck-ready

For complex tasks that need further decomposition by an Architect agent, label them needs-architect instead:
  bd --sandbox update <task-id> --add-label needs-architect
The Architect will analyze the codebase and break them into smaller implementation tasks.

Available repositories: ${repoNames}
Use descriptive worktree names (e.g., "fix-auth-bug", "add-validation").
`

      const planAgentPrompt = await buildPlanAgentPrompt(plan, allAgents, referenceWorkspace.directory, repository, gateTaskId, taskAssignmentInstructions)

      const planAgentTerminalId = await queueTerminalCreation(planAgentWorkspace.id, mainWindow, {
        initialPrompt: planAgentPrompt,
        claudeFlags: planAgentClaudeFlags,
      })
      addActiveWorkspace(planAgentWorkspace.id)
      addWorkspaceToTab(planAgentWorkspace.id, orchestratorTab.id)
      addPlanActivity(planId, 'info', 'Planner started (bottom-up mode)')

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
          if (data.includes('Goodbye') || data.includes('Session ended')) {
            planAgentEmitter.removeListener('data', exitHandler)
            cleanupPlanAgent(plan).catch((err) => {
              logger.error('agent', 'Error cleaning up plan agent', { planId }, { error: String(err) })
            })
          }
        }
        planAgentEmitter.on('data', exitHandler)
      }

      emitStateUpdate()
    } catch (error) {
      addPlanActivity(planId, 'error', 'Failed to start planner', error instanceof Error ? error.message : 'Unknown error')
      executingPlans.delete(planId)
      plan.status = 'discussed'
      plan.updatedAt = new Date().toISOString()
      await savePlan(plan)
      emitPlanUpdate(plan)
      return plan
    }
  } else {
    // === TOP-DOWN MODE (existing behavior) ===
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
    const mainWindow = getMainWindow()
    devLog(`[PlanManager] mainWindow is: ${mainWindow ? 'defined' : 'NULL'}`)
    if (mainWindow) {
      try {
        // Build the orchestrator prompt and pass it to queueTerminalCreation
        // Claude will automatically process it when it's ready
        // Pass --add-dir flag so orchestrator has permission to access plan directory without prompts
        // Pass --allowedTools to pre-approve bd commands so agent doesn't need interactive approval
        const claudeFlags = `--add-dir "${planDir}" --allowedTools "Bash(bd --sandbox *),Bash(bd *)"`
        const orchestratorPrompt = await buildOrchestratorPrompt(plan, allAgents, gateTaskId)
        devLog(`[PlanManager] Creating terminal for orchestrator ${orchestratorWorkspace.id}`)
        const orchestratorTerminalId = await queueTerminalCreation(orchestratorWorkspace.id, mainWindow, {
          initialPrompt: orchestratorPrompt,
          claudeFlags,
        })
        devLog(`[PlanManager] Created terminal: ${orchestratorTerminalId}`)
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
        // Pass --allowedTools to pre-approve bd commands so agent doesn't need interactive approval
        const planAgentClaudeFlags = `--add-dir "${planDir}" --add-dir "${referenceWorkspace.directory}" --allowedTools "Bash(bd --sandbox *),Bash(bd *)"`
        // Look up repository for feature branch guidance
        // Try repositoryId first, fallback to path-based lookup for legacy workspaces
        const repository = referenceWorkspace.repositoryId
          ? await getRepositoryById(referenceWorkspace.repositoryId)
          : await getRepositoryByPath(referenceWorkspace.directory)
        const planAgentPrompt = await buildPlanAgentPrompt(plan, allAgents, referenceWorkspace.directory, repository, gateTaskId)
        devLog(`[PlanManager] Creating terminal for plan agent ${planAgentWorkspace.id}`)
        const planAgentTerminalId = await queueTerminalCreation(planAgentWorkspace.id, mainWindow, {
          initialPrompt: planAgentPrompt,
          claudeFlags: planAgentClaudeFlags,
        })
        devLog(`[PlanManager] Created plan agent terminal: ${planAgentTerminalId}`)
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
                logger.error('agent', 'Error cleaning up plan agent', { planId }, { error: String(err) })
              })
            }
          }
          planAgentEmitter.on('data', exitHandler)
        }

        // Emit state update so renderer knows about the new tab
        emitStateUpdate()
      } catch (error) {
        logger.error('plan', 'Failed to create orchestrator terminal', { planId }, { error: error instanceof Error ? error.message : String(error) })
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
      logger.error('plan', 'Cannot create orchestrator terminal - mainWindow is null', { planId })
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
    devLog(`[PlanManager] Cannot restart plan ${planId} - status is ${plan.status}`)
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

  // Clear bottom-up state (active managers/architects)
  clearBottomUpState(plan.id)

  // Emit state update so renderer reloads workspaces (clears headless agents from sidebar)
  emitStateUpdate()

  logger.info('plan', 'All plan agents killed', logCtx)
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
      devLog(`[PlanManager] Deleted remote branch: ${branch}`)
    } catch (error) {
      // Branch may not exist on remote, or already deleted
      devLog(`[PlanManager] Could not delete remote branch ${branch}: ${error}`)
    }
  }
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
