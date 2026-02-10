import * as fs from 'fs/promises'
import * as path from 'path'
import { logger, type LogContext } from '../logger'
import {
  savePlan,
  getPlanById,
  loadTaskAssignments,
  saveTaskAssignment,
} from '../config'
import {
  bdCreate,
  bdList,
  bdUpdate,
  bdClose,
  bdGetDependents,
  bdAddDependency,
  getPlanDir,
  type BeadTask,
} from '../bd-client'
import { getPreferences } from '../state-manager'
import { getRepositoryById } from '../repository-manager'
import { HeadlessAgent } from '../headless'
import { getSelectedDockerImage, loadSettings } from '../settings-manager'
import { buildPrompt } from '../prompt-templates'
import type { Plan, TaskAssignment, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent } from '../../shared/types'
import { addPlanActivity, emitPlanUpdate, emitTaskAssignmentUpdate } from './events'
import { markWorktreeReadyForReview } from './git-strategy'
// Import headless state/events
import { headlessAgents, headlessAgentInfo, tasksWithSuccessfulBdClose } from '../headless/state'
import { emitHeadlessAgentUpdate, emitHeadlessAgentEvent } from '../headless/events'

/**
 * Spawn a critic agent to review completed task work.
 * The critic runs in the same worktree as the original task agent.
 */
export async function spawnCriticAgent(planId: string, originalTaskId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return

  const worktree = plan.worktrees.find(w => w.taskId === originalTaskId)
  if (!worktree) {
    logger.warn('plan', 'Cannot spawn critic - worktree not found', { planId, taskId: originalTaskId })
    await markWorktreeReadyForReview(planId, originalTaskId)
    return
  }

  const settings = await loadSettings()
  const maxIterations = settings.critic?.maxIterations ?? 2
  const currentIteration = worktree.criticIteration ?? 0

  const logCtx: LogContext = { planId, taskId: originalTaskId }

  // Check if max iterations exceeded → auto-approve
  if (currentIteration >= maxIterations) {
    logger.info('plan', 'Max critic iterations reached, auto-approving', logCtx, { currentIteration, maxIterations })
    addPlanActivity(planId, 'info', `Max critic iterations reached for ${originalTaskId}, auto-approving`)
    worktree.criticStatus = 'approved'
    await savePlan(plan)
    emitPlanUpdate(plan)
    await markWorktreeReadyForReview(planId, originalTaskId)
    return
  }

  // Update worktree state
  worktree.criticIteration = currentIteration + 1
  worktree.criticStatus = 'reviewing'

  // Create critic beads task
  let criticTaskId: string
  try {
    criticTaskId = await bdCreate(planId, {
      title: `Review: ${originalTaskId}`,
      labels: ['bismarck-critic', 'bismarck-internal', `review-for:${originalTaskId}`],
    })
    worktree.criticTaskId = criticTaskId
    logger.info('plan', 'Created critic task in beads', logCtx, { criticTaskId })

    // Block dependent tasks: find ALL tasks that depend on the original task
    // and add the critic as a blocker so dependents don't start until review passes
    const dependentTaskIds = await bdGetDependents(planId, originalTaskId)
    for (const depTaskId of dependentTaskIds) {
      await bdAddDependency(planId, depTaskId, criticTaskId)
      logger.info('plan', 'Added critic dependency', logCtx, {
        criticTaskId,
        dependentTaskId: depTaskId,
      })
    }

    await savePlan(plan)
  } catch (err) {
    logger.warn('plan', 'Failed to create critic task in beads', logCtx, {
      error: err instanceof Error ? err.message : 'Unknown error',
    })
    // Fallback: auto-approve on error
    addPlanActivity(planId, 'warning', `Failed to create critic task for ${originalTaskId}, auto-approving`)
    worktree.criticStatus = 'approved'
    await savePlan(plan)
    emitPlanUpdate(plan)
    await markWorktreeReadyForReview(planId, originalTaskId)
    return
  }

  // Load critic criteria from discussion output
  const criticCriteria = await loadCriticCriteria(planId)

  // Find the epic ID for the plan
  const tasks = await bdList(planId)
  const epicTask = tasks.find(t => t.type === 'epic')
  const epicId = epicTask?.id || ''

  // Get repo and worktree names from labels
  const repoName = worktree.repositoryId
    ? (await getRepositoryById(worktree.repositoryId))?.name || 'unknown'
    : 'unknown'
  // Extract worktree name from path (last segment)
  const worktreeNameFromPath = path.basename(worktree.path)

  // Build last iteration warning
  const lastIterationWarning = (currentIteration + 1 >= maxIterations)
    ? `\n=== LAST ITERATION WARNING ===\nThis is your LAST review iteration. You MUST approve the work unless there are CRITICAL bugs (crashes, security vulnerabilities, data loss). Minor style issues or improvements should be noted but NOT cause rejection.\n`
    : ''

  // Build task-raising instructions for bottom-up mode
  // In bottom-up mode, critics can also raise new tasks for issues beyond fix-ups
  // TODO: Re-enable when teamMode field is added to Plan type
  const taskRaisingInstructions = '' // Temporarily disabled - plan.teamMode property doesn't exist yet

  // Build the critic prompt
  const baseBranch = worktree.baseBranch || 'main'
  const prompt = await buildPrompt('critic', {
    taskId: criticTaskId,
    originalTaskId,
    originalTaskTitle: originalTaskId, // We use the task ID here; the critic will bd show to get the title
    criticCriteria,
    criticIteration: currentIteration + 1,
    maxCriticIterations: maxIterations,
    baseBranch,
    epicId,
    repoName,
    worktreeName: worktreeNameFromPath,
    lastIterationWarning,
    // taskRaisingInstructions removed - not in PromptVariables type
  })

  addPlanActivity(planId, 'info', `Spawning critic for ${originalTaskId}`, `Iteration ${currentIteration + 1}/${maxIterations}`)

  // Get model from preferences
  const agentModel = getPreferences().agentModel || 'sonnet'

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: `headless-${criticTaskId}`,
    taskId: criticTaskId,
    planId,
    status: 'starting',
    worktreePath: worktree.path,
    events: [],
    startedAt: new Date().toISOString(),
    model: agentModel,
    originalPrompt: prompt,
    agentType: 'critic',
  }
  headlessAgentInfo.set(criticTaskId, agentInfo)
  emitHeadlessAgentUpdate(agentInfo)

  // Create and start the critic agent
  const agent = new HeadlessAgent()
  headlessAgents.set(criticTaskId, agent)

  // Set up event listeners (same pattern as merge agent)
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(planId, criticTaskId, event)
  })

  agent.on('complete', async (result) => {
    const bdCloseSucceeded = tasksWithSuccessfulBdClose.has(criticTaskId)
    const effectiveSuccess = result.success || bdCloseSucceeded

    logger.info('agent', 'Critic agent complete', logCtx, {
      success: result.success,
      exitCode: result.exitCode,
      bdCloseSucceeded,
      effectiveSuccess,
    })

    agentInfo.status = effectiveSuccess ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(criticTaskId)
    tasksWithSuccessfulBdClose.delete(criticTaskId)

    if (effectiveSuccess) {
      // Look up the bead task to check for labels/status
      const criticTask: BeadTask = {
        id: criticTaskId,
        title: `Review: ${originalTaskId}`,
        status: 'closed',
        labels: ['bismarck-critic', 'bismarck-internal', `review-for:${originalTaskId}`],
      }
      await handleCriticCompletion(planId, criticTask)
    } else {
      // Critic failed → auto-approve (don't block pipeline)
      addPlanActivity(planId, 'warning', `Critic failed for ${originalTaskId}, auto-approving`)
      worktree.criticStatus = 'approved'
      await savePlan(plan)
      emitPlanUpdate(plan)
      await markWorktreeReadyForReview(planId, originalTaskId)
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(criticTaskId)
    addPlanActivity(planId, 'warning', `Critic error for ${originalTaskId}, auto-approving`, error.message)

    // Auto-approve on error
    worktree.criticStatus = 'approved'
    savePlan(plan).catch(() => {})
    emitPlanUpdate(plan)
    markWorktreeReadyForReview(planId, originalTaskId).catch(() => {})
  })

  // Start the agent in the SAME worktree as the original task
  const planDir = getPlanDir(planId)
  const selectedImage = await getSelectedDockerImage()

  try {
    await agent.start({
      prompt,
      worktreePath: worktree.path,
      planDir,
      planId,
      taskId: criticTaskId,
      image: selectedImage,
      claudeFlags: ['--model', agentModel],
    })

    // Create task assignment for tracking
    const assignment: TaskAssignment = {
      beadId: criticTaskId,
      agentId: worktree.agentId,
      planId,
      status: 'in_progress',
      assignedAt: new Date().toISOString(),
    }
    saveTaskAssignment(planId, assignment)
    emitTaskAssignmentUpdate(assignment)

    // Mark beads task as sent
    await bdUpdate(planId, criticTaskId, {
      addLabels: ['bismarck-sent'],
    })

    addPlanActivity(planId, 'info', `Critic started for ${originalTaskId}`)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(criticTaskId)
    addPlanActivity(planId, 'warning', `Failed to start critic for ${originalTaskId}, auto-approving`,
      error instanceof Error ? error.message : 'Unknown error')

    // Auto-approve on startup failure
    worktree.criticStatus = 'approved'
    await savePlan(plan)
    emitPlanUpdate(plan)
    await markWorktreeReadyForReview(planId, originalTaskId)
  }
}

/**
 * Handle critic task completion - check if it approved or created fix-up tasks.
 */
export async function handleCriticCompletion(planId: string, criticTask: BeadTask): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || !plan.worktrees) return

  // Find which original task this critic reviewed
  const reviewForLabel = criticTask.labels?.find(l => l.startsWith('review-for:'))
  const originalTaskId = reviewForLabel?.substring('review-for:'.length)
  if (!originalTaskId) {
    logger.warn('plan', 'Critic task missing review-for label', { planId, taskId: criticTask.id })
    return
  }

  const worktree = plan.worktrees.find(w => w.taskId === originalTaskId)
  if (!worktree) return

  const logCtx: LogContext = { planId, taskId: originalTaskId }

  // Mark critic assignment as completed
  const assignments = loadTaskAssignments(planId)
  const criticAssignment = assignments.find(a => a.beadId === criticTask.id)
  if (criticAssignment && criticAssignment.status !== 'completed') {
    criticAssignment.status = 'completed'
    criticAssignment.completedAt = new Date().toISOString()
    saveTaskAssignment(planId, criticAssignment)
    emitTaskAssignmentUpdate(criticAssignment)
  }

  // Close the critic beads task to unblock dependent tasks in the dependency graph
  // (The critic agent should have already closed it via bd close, but ensure it's closed)
  try {
    await bdClose(planId, criticTask.id)
    logger.info('plan', 'Closed critic task in beads', logCtx, { criticTaskId: criticTask.id })
  } catch (err) {
    // Expected if critic already closed it via bd close
    logger.debug('plan', 'Critic task close returned error (likely already closed)', logCtx, {
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  // Check if critic created fix-up tasks
  const allTasks = await bdList(planId)
  const fixupTasks = allTasks.filter(t =>
    t.labels?.includes('critic-fixup') &&
    t.labels?.some(l => l === `fixup-for:${originalTaskId}`) &&
    t.status === 'open'
  )

  if (fixupTasks.length > 0) {
    // Track cumulative fixup count
    const previousFixups = worktree.totalFixupCount ?? 0
    worktree.totalFixupCount = previousFixups + fixupTasks.length

    // Check fixup cap
    const settings = await loadSettings()
    const maxFixups = settings.critic?.maxFixupsPerTask ?? 5
    if (worktree.totalFixupCount >= maxFixups) {
      logger.info('plan', 'Max fixups reached, auto-approving', logCtx,
        { totalFixups: worktree.totalFixupCount, maxFixups })
      addPlanActivity(planId, 'info',
        `Max fixups (${maxFixups}) reached for ${originalTaskId}, auto-approving`)
      worktree.criticStatus = 'approved'
      await savePlan(plan)
      emitPlanUpdate(plan)
      await markWorktreeReadyForReview(planId, originalTaskId)
      return
    }

    // Critic rejected - fix-ups exist
    worktree.criticStatus = 'rejected'
    addPlanActivity(planId, 'warning', `Critic rejected ${originalTaskId}`, `${fixupTasks.length} fix-up task(s) created (${worktree.totalFixupCount} total)`)

    // Add fix-up tasks as blockers for dependents (so dependents stay blocked until fix-ups complete AND next critic approves)
    const dependentTaskIds = await bdGetDependents(planId, originalTaskId)
    for (const fixup of fixupTasks) {
      for (const depTaskId of dependentTaskIds) {
        try {
          await bdAddDependency(planId, depTaskId, fixup.id)
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error'
          logger.warn('plan', `Failed to add dependency: ${fixup.id} blocks ${depTaskId}`, logCtx, { error: msg })
          addPlanActivity(planId, 'warning', `Dependency error: ${fixup.id} -> ${depTaskId}`, msg)
        }
      }
    }

    await savePlan(plan)
    emitPlanUpdate(plan)
    // Fix-up tasks already have bismarck-ready label (set by critic agent)
    // They'll be picked up by the orchestrator/processReadyTask loop
  } else {
    // Critic approved (no fix-ups found)
    worktree.criticStatus = 'approved'
    // Close the original task in beads to unblock dependents
    try {
      await bdClose(planId, originalTaskId)
      logger.info('plan', 'Closed original task after critic approval', logCtx)
    } catch (err) {
      logger.debug('plan', 'Original task close error (likely already closed)', logCtx, {
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
    addPlanActivity(planId, 'success', `Critic approved ${originalTaskId}`)
    await savePlan(plan)
    emitPlanUpdate(plan)
    await markWorktreeReadyForReview(planId, originalTaskId)
  }
}

/**
 * Load critic criteria from the discussion output file.
 */
async function loadCriticCriteria(planId: string): Promise<string> {
  const planDir = getPlanDir(planId)
  const outputPath = path.join(planDir, 'discussion-output.md')

  try {
    const content = await fs.readFile(outputPath, 'utf-8')

    // Parse out the ## Critic Criteria section
    const match = content.match(/## Critic Criteria\s*\n([\s\S]*?)(?=\n## |\n# |$)/)
    if (match && match[1].trim()) {
      return match[1].trim()
    }
  } catch {
    // File doesn't exist or can't be read
  }

  // Fallback to generic criteria
  return `- Code compiles without errors
- No obvious bugs or security issues
- Changes match the task requirements
- Code follows existing project patterns`
}
