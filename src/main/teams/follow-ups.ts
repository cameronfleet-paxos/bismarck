import { logger, type LogContext } from '../logger'
import {
  savePlan,
  getPlanById,
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
} from '../config'
import {
  bdList,
  getPlanDir,
} from '../bd-client'
import { getTerminalForWorkspace, closeTerminal, getTerminalEmitter } from '../terminal'
import { queueTerminalCreation } from '../terminal-queue'
import { createTab, addWorkspaceToTab, addActiveWorkspace, removeActiveWorkspace, removeWorkspaceFromTab, setActiveTab } from '../state-manager'
import { getRepositoryById } from '../repository-manager'
import type { Plan, Workspace, Repository, BeadTask } from '../../shared/types'
import { getMainWindow } from './state'
import { addPlanActivity, emitPlanUpdate, emitStateUpdate, emitBeadTasksUpdate } from './events'
import { startTaskPolling } from './task-polling'

/**
 * Build the prompt for the Follow-Up Agent
 * This agent helps the user create follow-up tasks after reviewing completed work
 */
async function buildFollowUpAgentPrompt(plan: Plan, completedTasks: BeadTask[]): Promise<string> {
  const planDir = getPlanDir(plan.id)

  const completedTasksList = completedTasks.length > 0
    ? completedTasks.map(t => `- ${t.id}: ${t.title}`).join('\n')
    : '(No completed tasks yet)'

  // Get available repositories from existing worktrees
  const repositories = await getRepositoriesForPlan(plan.id)
  const repoList = repositories.length > 0
    ? repositories.map(r => `- ${r.name}`).join('\n')
    : '(No repositories available)'

  // Get worktree info from plan - find one that can be reused
  // Prefer worktrees that are ready_for_review (task finished) so we can reference their pattern
  const existingWorktrees = plan.worktrees || []
  const worktreeInfo = existingWorktrees.length > 0
    ? existingWorktrees.map(w => `- ${w.id} (repo: ${w.repositoryId}, task: ${w.taskId}, status: ${w.status})`).join('\n')
    : '(No worktrees yet)'

  // Find a default repo/worktree to suggest
  const defaultRepo = repositories[0]?.name || '<repo-name>'
  // Generate a unique worktree name for follow-up tasks
  const defaultWorktree = `followup-${Date.now()}`

  return `[BISMARCK FOLLOW-UP AGENT]
Plan: ${plan.title}
${plan.description}

=== YOUR ROLE ===
You are a Follow-Up Agent helping the user create additional tasks after reviewing completed work.
The plan was in "Ready for Review" status and the user has requested to add follow-up tasks.

=== COMPLETED TASKS ===
The following tasks have been completed:
${completedTasksList}

=== AVAILABLE REPOSITORIES ===
${repoList}

=== EXISTING WORKTREES ===
${worktreeInfo}

=== CREATING FOLLOW-UP TASKS ===
Help the user identify what additional work is needed. When they decide on tasks:

1. Create tasks using bd (beads CLI):
   \`\`\`bash
   bd --sandbox create "Task title" --description "Detailed task description"
   \`\`\`

2. Set dependencies on completed tasks if needed:
   \`\`\`bash
   bd --sandbox update <new-task-id> --blocked-by <completed-task-id>
   \`\`\`

3. **IMPORTANT**: Assign repository and worktree labels (required for task dispatch):
   \`\`\`bash
   bd --sandbox update <task-id> --add-labels "repo:${defaultRepo}" --add-labels "worktree:${defaultWorktree}"
   \`\`\`

4. Mark tasks as ready for Bismarck:
   \`\`\`bash
   bd --sandbox update <task-id> --add-labels bismarck-ready
   \`\`\`

You can combine steps 3 and 4:
\`\`\`bash
bd --sandbox update <task-id> --add-labels "repo:${defaultRepo}" --add-labels "worktree:${defaultWorktree}" --add-labels bismarck-ready
\`\`\`

=== ASKING QUESTIONS ===
When you need input from the user, use the AskUserQuestion tool.
This provides a better UI experience than typing in the terminal.
- Structure questions with 2-4 clear options when possible
- Use multiSelect: true when multiple answers make sense

=== WHEN COMPLETE ===
When the user has finished creating follow-up tasks (or decides none are needed):
1. Type /exit to signal that follow-up task creation is complete

The plan will automatically transition back to "In Progress" if new open tasks exist,
or stay in "Ready for Review" if no new tasks were created.

=== BEGIN ===
Start by asking the user what follow-up work they've identified after reviewing the completed tasks.`
}

/**
 * Check for new tasks after Follow-Up Agent exits and resume plan if needed
 */
async function checkForNewTasksAndResume(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'ready_for_review') return

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Checking for new tasks after follow-up agent exit', logCtx)

  try {
    // Get all open tasks
    const openTasks = await bdList(planId, { status: 'open' })

    if (openTasks.length > 0) {
      // New tasks exist - transition back to in_progress and restart polling
      logger.planStateChange(plan.id, plan.status, 'in_progress', `${openTasks.length} new follow-up tasks`)
      plan.status = 'in_progress'
      plan.updatedAt = new Date().toISOString()
      await savePlan(plan)
      emitPlanUpdate(plan)

      addPlanActivity(planId, 'info', `Resuming plan with ${openTasks.length} follow-up task(s)`)

      // Restart task polling
      startTaskPolling(planId)

      // Notify renderer about task changes
      emitBeadTasksUpdate(planId)
    } else {
      // No new tasks - stay in ready_for_review
      logger.info('plan', 'No new tasks created, staying in ready_for_review', logCtx)
      addPlanActivity(planId, 'info', 'No follow-up tasks created')
    }
  } catch (error) {
    logger.error('plan', 'Error checking for new tasks', logCtx, { error })
    addPlanActivity(planId, 'error', 'Failed to check for new tasks', error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Get available repositories for a plan based on reference agents
 */
async function getRepositoriesForPlan(planId: string): Promise<Repository[]> {
  const plan = getPlanById(planId)
  if (!plan || !plan.referenceAgentId) return []

  // Get all non-system agents
  const agents = getWorkspaces().filter(a => !a.isOrchestrator && !a.isPlanAgent && !a.isTaskAgent)

  // Collect unique repositories
  const repoIds = new Set<string>()
  const repositories: Repository[] = []

  for (const agent of agents) {
    if (agent.repositoryId) {
      if (!repoIds.has(agent.repositoryId)) {
        const repo = await getRepositoryById(agent.repositoryId)
        if (repo) {
          repoIds.add(repo.id)
          repositories.push(repo)
        }
      }
    }
  }

  return repositories
}

/**
 * Request follow-ups for a plan in ready_for_review status
 * Spawns a Follow-Up Agent terminal for creating additional tasks
 */
export async function requestFollowUps(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  const logCtx: LogContext = { planId }
  logger.info('plan', 'Requesting follow-ups for plan', logCtx)

  // Only callable from ready_for_review status
  if (plan.status !== 'ready_for_review') {
    logger.warn('plan', 'Cannot request follow-ups - plan not in ready_for_review status', logCtx, { status: plan.status })
    addPlanActivity(planId, 'warning', 'Cannot request follow-ups', `Plan is in ${plan.status} status, not ready_for_review`)
    return plan
  }

  // Get completed tasks for context
  const completedTasks = await bdList(planId, { status: 'closed' })

  // Get the plan directory
  const planDir = getPlanDir(planId)

  // Create follow-up agent workspace
  const allAgents = getWorkspaces()
  const followUpWorkspace: Workspace = {
    id: `followup-${planId}-${Date.now()}`,
    name: `Follow-Up (${plan.title})`,
    directory: planDir,
    purpose: 'Create follow-up tasks',
    theme: 'orange',
    icon: getRandomUniqueIcon(allAgents),
    isPlanAgent: true,
  }
  saveWorkspace(followUpWorkspace)

  // Find or create the plan's tab
  let tabId = plan.orchestratorTabId
  if (!tabId) {
    const newTab = createTab(`📋 ${plan.title.substring(0, 15)}`, { isPlanTab: true, planId: plan.id })
    tabId = newTab.id
    plan.orchestratorTabId = tabId
    await savePlan(plan)
  }

  // Create terminal for follow-up agent
  const mainWindow = getMainWindow()
  if (mainWindow) {
    try {
      const followUpPrompt = await buildFollowUpAgentPrompt(plan, completedTasks)
      // Pass --allowedTools to pre-approve bd commands so agent doesn't need interactive approval
      const claudeFlags = `--add-dir "${planDir}" --allowedTools "Bash(bd --sandbox *),Bash(bd *)"`

      logger.info('plan', 'Creating terminal for follow-up agent', logCtx, { workspaceId: followUpWorkspace.id })
      const terminalId = await queueTerminalCreation(followUpWorkspace.id, mainWindow, {
        initialPrompt: followUpPrompt,
        claudeFlags,
      })
      logger.info('plan', 'Created follow-up agent terminal', logCtx, { terminalId })

      addActiveWorkspace(followUpWorkspace.id)
      addWorkspaceToTab(followUpWorkspace.id, tabId)
      setActiveTab(tabId)

      // Notify renderer about the new terminal
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId,
          workspaceId: followUpWorkspace.id,
        })
        // Maximize the follow-up agent
        mainWindow.webContents.send('maximize-workspace', followUpWorkspace.id)
      }

      // Set up listener for follow-up agent exit
      const followUpEmitter = getTerminalEmitter(terminalId)
      if (followUpEmitter) {
        const exitHandler = async (data: string) => {
          // Claude shows "Goodbye!" when /exit is used
          if (data.includes('Goodbye') || data.includes('Session ended')) {
            followUpEmitter.removeListener('data', exitHandler)

            // Cleanup follow-up agent workspace
            const followUpTerminalId = getTerminalForWorkspace(followUpWorkspace.id)
            if (followUpTerminalId) {
              closeTerminal(followUpTerminalId)
            }
            removeActiveWorkspace(followUpWorkspace.id)
            removeWorkspaceFromTab(followUpWorkspace.id)
            deleteWorkspace(followUpWorkspace.id)

            // Check for new tasks and resume plan if needed
            await checkForNewTasksAndResume(planId)

            emitStateUpdate()
          }
        }
        followUpEmitter.on('data', exitHandler)
      }

      addPlanActivity(planId, 'info', 'Follow-up agent started')
      emitStateUpdate()
    } catch (error) {
      logger.error('plan', 'Failed to create follow-up agent terminal', logCtx, { error })
      addPlanActivity(planId, 'error', 'Failed to start follow-up agent', error instanceof Error ? error.message : 'Unknown error')
      // Cleanup the workspace
      deleteWorkspace(followUpWorkspace.id)
    }
  } else {
    logger.error('plan', 'Cannot create follow-up terminal - mainWindow is null', logCtx)
    addPlanActivity(planId, 'error', 'Cannot start follow-up agent - window not available')
    deleteWorkspace(followUpWorkspace.id)
  }

  return plan
}
