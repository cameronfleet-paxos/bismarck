import { devLog } from '../dev-log'
import {
  savePlan,
  deleteWorkspace,
  getWorkspaces,
} from '../config'
import { getPlanDir } from '../bd-client'
import { getTerminalForWorkspace, closeTerminal } from '../terminal'
import { removeActiveWorkspace, removeWorkspaceFromTab, deleteTab, getPreferences } from '../state-manager'
import { buildPrompt, type PromptVariables } from '../prompt-templates'
import { getAllRepositories } from '../repository-manager'
import type { Plan, Agent, Repository } from '../../shared/types'
import { DEFAULT_MAX_PARALLEL_AGENTS } from './state'
import { emitStateUpdate, emitBeadTasksUpdate, addPlanActivity } from './events'

/**
 * Cleanup orchestrator workspace, terminal, and tab for a plan
 */
export async function cleanupOrchestrator(plan: Plan): Promise<void> {
  // Also cleanup plan agent if it's still running
  await cleanupPlanAgentSilent(plan)

  if (plan.orchestratorWorkspaceId) {
    // Close terminal
    const terminalId = getTerminalForWorkspace(plan.orchestratorWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }

    // Remove from active workspaces
    removeActiveWorkspace(plan.orchestratorWorkspaceId)

    // Delete workspace
    deleteWorkspace(plan.orchestratorWorkspaceId)
    plan.orchestratorWorkspaceId = null
  }

  // Delete the dedicated orchestrator tab
  if (plan.orchestratorTabId) {
    deleteTab(plan.orchestratorTabId)
    plan.orchestratorTabId = null

    // Emit state update so renderer knows the tab was removed
    emitStateUpdate()
  }
}

/**
 * Build the prompt to inject into the reference agent's terminal
 * Returns only instructions with trailing newline (no /clear - handled separately)
 * NOTE: This function is currently unused but kept for reference
 */
export function buildReferencePrompt(plan: Plan, agents: Agent[]): string {
  // Filter out orchestrator agents from available agents
  const availableAgents = agents.filter(a => !a.isOrchestrator)

  const agentList = availableAgents
    .map((a) => `- ${a.name} (id: ${a.id}): ${a.purpose || 'General purpose agent'}`)
    .join('\n')

  const planDir = getPlanDir(plan.id)

  const instructions = `[BISMARCK PLAN REQUEST]
Plan ID: ${plan.id}
Title: ${plan.title}
Description: ${plan.description}

Available Agents:
${agentList}

Instructions:
IMPORTANT: All bd commands must run in ${planDir} directory.

1. Create bd epic: cd ${planDir} && bd --sandbox create --type epic "${plan.title}"
2. Create tasks: cd ${planDir} && bd --sandbox create --parent <epic-id> "task title"
3. Set dependencies: cd ${planDir} && bd --sandbox dep <blocking-task-id> --blocks <blocked-task-id>
4. Assign: cd ${planDir} && bd --sandbox update <task-id> --assignee <agent-name>
5. Mark FIRST task ready: cd ${planDir} && bd --sandbox update <first-task-id> --add-label bismarck-ready

The orchestrator will automatically mark dependent tasks ready when their blockers complete.
After marking a task with 'bismarck-ready', Bismarck will automatically send it to the assigned agent.`

  return instructions
}

/**
 * Build the prompt to inject into the orchestrator agent's terminal
 * Returns only instructions with trailing newline (no /clear - handled separately)
 * Note: Orchestrator runs in the plan directory, so no 'cd' needed for bd commands
 */
export async function buildOrchestratorPrompt(plan: Plan, agents: Agent[], gateTaskId: string): Promise<string> {
  // Get repositories from agents that have them
  const repositories = await getAllRepositories()

  // Find reference agent and its repository
  const referenceAgent = agents.find(a => a.id === plan.referenceAgentId)
  const referenceRepo = referenceAgent?.repositoryId
    ? repositories.find(r => r.id === referenceAgent.repositoryId)
    : null

  // Build repository list with purposes derived from agents
  const repoInfoList: string[] = []
  for (const repo of repositories) {
    // Find agents that use this repo to get purpose info
    const repoAgents = agents.filter(a => a.repositoryId === repo.id && !a.isOrchestrator && !a.isPlanAgent && !a.isTaskAgent)
    const purposes = repoAgents.map(a => a.purpose).filter(Boolean)
    const purpose = purposes.length > 0 ? purposes[0] : 'No description'

    repoInfoList.push(`- ${repo.name}: ${repo.rootPath} (branch: ${repo.defaultBranch})
    Purpose: ${purpose}`)
  }

  const repoList = repoInfoList.length > 0
    ? repoInfoList.join('\n')
    : '(No repositories detected - agents may not be linked to git repos)'

  const maxParallel = plan.maxParallelAgents ?? DEFAULT_MAX_PARALLEL_AGENTS

  const variables: PromptVariables = {
    planId: plan.id,
    planTitle: plan.title,
    repoList,
    maxParallel,
    referenceRepoName: referenceRepo?.name || repositories[0]?.name || 'unknown',
    referenceRepoPath: referenceRepo?.rootPath || '',
    referenceAgentName: referenceAgent?.name || 'unknown',
    gateTaskId,
  }

  return buildPrompt('orchestrator', variables)
}

/**
 * Build the prompt for the planner that creates tasks
 * Note: Planner runs in the plan directory so bd commands work directly
 * It has access to the codebase via --add-dir flag for analysis
 *
 * The Planner is responsible for:
 * - Analyzing the codebase
 * - Creating epic + tasks
 * - Setting up dependencies
 *
 * The Orchestrator handles:
 * - Assigning tasks to agents
 * - Marking tasks as ready
 */
export async function buildPlanAgentPrompt(plan: Plan, _agents: Agent[], codebasePath: string, repository: Repository | undefined, gateTaskId: string, taskAssignmentInstructions?: string): Promise<string> {
  const planDir = getPlanDir(plan.id)

  // Include discussion context if a discussion was completed
  const discussionContext = plan.discussion?.status === 'approved' && plan.discussionOutputPath
    ? `
=== DISCUSSION OUTCOMES ===
A brainstorming discussion was completed before task creation.

Read the discussion outcomes at: ${plan.discussionOutputPath}

This file contains:
- Requirements agreed upon
- Architecture decisions made
- Testing strategy
- Edge cases to handle
- Proposed task breakdown with dependencies

IMPORTANT: Create tasks that match the structure in this file.
`
    : ''

  // Feature branch mode guidance - tell planner to create a final task for PR/verification
  let featureBranchGuidance = ''
  if (plan.branchStrategy === 'feature_branch') {
    const criteriaSection = repository?.completionCriteria
      ? `\n   - Verify repository completion criteria: ${repository.completionCriteria}`
      : ''
    featureBranchGuidance = `
=== FEATURE BRANCH MODE ===
This plan uses feature branch mode - all task commits go to a shared feature branch.

IMPORTANT: You MUST create a final task called "Raise PR and verify completion criteria" that:
- Depends on ALL other tasks (it should run last)
- Pushes the feature branch and creates a draft PR
- Runs any required checks or tests${criteriaSection}
- Marks the PR as ready for review when checks pass

Example dependency setup:
  # Create all implementation tasks first, then create the final task
  bd --sandbox create --parent <epic-id> "Raise PR and verify completion criteria"
  # Make it depend on all other tasks
  bd --sandbox dep <task-1-id> --blocks <final-task-id>
  bd --sandbox dep <task-2-id> --blocks <final-task-id>
  # etc.
`
  }

  const variables: PromptVariables = {
    planId: plan.id,
    planTitle: plan.title,
    planDescription: plan.description,
    planDir,
    codebasePath,
    discussionContext,
    featureBranchGuidance,
    gateTaskId,
    taskAssignmentInstructions: taskAssignmentInstructions ?? '',
  }

  return buildPrompt('planner', variables)
}

/**
 * Cleanup plan agent workspace, terminal for a plan
 */
export async function cleanupPlanAgent(plan: Plan): Promise<void> {
  if (!plan.planAgentWorkspaceId) return

  // Close terminal
  const terminalId = getTerminalForWorkspace(plan.planAgentWorkspaceId)
  if (terminalId) {
    closeTerminal(terminalId)
  }

  // Remove from active workspaces
  removeActiveWorkspace(plan.planAgentWorkspaceId)

  // Remove from tab
  removeWorkspaceFromTab(plan.planAgentWorkspaceId)

  // Delete workspace config
  deleteWorkspace(plan.planAgentWorkspaceId)
  plan.planAgentWorkspaceId = null
  await savePlan(plan)

  addPlanActivity(plan.id, 'success', 'Plan agent completed task creation')
  emitStateUpdate()

  // Notify renderer to refresh task list now that plan agent has created tasks
  emitBeadTasksUpdate(plan.id)
}

/**
 * Cleanup plan agent without logging success (used for cancellation)
 */
export async function cleanupPlanAgentSilent(plan: Plan): Promise<void> {
  if (!plan.planAgentWorkspaceId) return

  // Close terminal
  const terminalId = getTerminalForWorkspace(plan.planAgentWorkspaceId)
  if (terminalId) {
    closeTerminal(terminalId)
  }

  // Remove from active workspaces
  removeActiveWorkspace(plan.planAgentWorkspaceId)

  // Remove from tab
  removeWorkspaceFromTab(plan.planAgentWorkspaceId)

  // Delete workspace config
  deleteWorkspace(plan.planAgentWorkspaceId)
  plan.planAgentWorkspaceId = null
  await savePlan(plan)

  emitStateUpdate()
}
