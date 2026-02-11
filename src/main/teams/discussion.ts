import * as fs from 'fs/promises'
import { devLog } from '../dev-log'
import {
  savePlan,
  getPlanById,
  saveWorkspace,
  deleteWorkspace,
  getRandomUniqueIcon,
  getWorkspaces,
} from '../config'
import { getPlanDir } from '../bd-client'
import { getTerminalForWorkspace, closeTerminal, getTerminalEmitter } from '../terminal'
import { queueTerminalCreation } from '../terminal-queue'
import { createTab, addWorkspaceToTab, addActiveWorkspace, removeActiveWorkspace, removeWorkspaceFromTab, setActiveTab, deleteTab } from '../state-manager'
import { buildPrompt, type PromptVariables } from '../prompt-templates'
import type { Plan, Workspace, PlanDiscussion } from '../../shared/types'
import { getMainWindow } from './state'
import { addPlanActivity, emitPlanUpdate, emitStateUpdate } from './events'
import { generateDiscussionId } from './helpers'

/**
 * Build the prompt for the Discussion Agent
 * This agent engages the user in structured brainstorming BEFORE task creation
 */
async function buildDiscussionAgentPrompt(plan: Plan, codebasePath: string): Promise<string> {
  const planDir = getPlanDir(plan.id)

  const variables: PromptVariables = {
    planTitle: plan.title,
    planDescription: plan.description,
    codebasePath,
    planDir,
  }

  return buildPrompt('discussion', variables)
}

/**
 * Start a discussion phase for a plan
 * This engages the user in structured brainstorming before task creation
 */
export async function startDiscussion(planId: string, referenceAgentId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan) return null

  // Only start discussion from draft status
  if (plan.status !== 'draft') {
    devLog(`[PlanManager] Cannot start discussion for plan ${planId} - status is ${plan.status}`)
    return plan
  }

  // Get reference workspace for codebase path
  const allAgents = getWorkspaces()
  const referenceWorkspace = allAgents.find(a => a.id === referenceAgentId)

  if (!referenceWorkspace) {
    addPlanActivity(planId, 'error', `Reference agent not found: ${referenceAgentId}`)
    return null
  }

  // Create discussion state
  const discussion: PlanDiscussion = {
    id: generateDiscussionId(),
    planId,
    status: 'active',
    messages: [],
    startedAt: new Date().toISOString(),
  }

  // Update plan status and set reference agent
  plan.status = 'discussing'
  plan.referenceAgentId = referenceAgentId
  plan.discussion = discussion
  plan.updatedAt = new Date().toISOString()

  // Create a dedicated tab for the discussion
  const discussionTab = createTab(`💬 ${plan.title.substring(0, 15)}`, { isPlanTab: true, planId: plan.id })
  plan.orchestratorTabId = discussionTab.id

  await savePlan(plan)
  emitPlanUpdate(plan)

  addPlanActivity(planId, 'info', 'Discussion phase started')

  // Create discussion agent workspace
  const discussionWorkspace: Workspace = {
    id: `discussion-${planId}`,
    name: `Discussion (${plan.title})`,
    directory: referenceWorkspace.directory, // Run in the codebase directory
    purpose: 'Plan discussion and refinement',
    theme: 'purple',
    icon: getRandomUniqueIcon(allAgents),
  }
  saveWorkspace(discussionWorkspace)
  plan.discussionAgentWorkspaceId = discussionWorkspace.id
  await savePlan(plan)

  // Create terminal for discussion agent
  const mainWindow = getMainWindow()
  if (mainWindow) {
    try {
      const discussionPrompt = await buildDiscussionAgentPrompt(plan, referenceWorkspace.directory)
      // Pass --allowedTools to pre-approve bd commands so agent doesn't need interactive approval
      const claudeFlags = `--add-dir "${referenceWorkspace.directory}" --allowedTools "Bash(bd --sandbox *),Bash(bd *)"`

      devLog(`[PlanManager] Creating terminal for discussion agent ${discussionWorkspace.id}`)
      const terminalId = await queueTerminalCreation(discussionWorkspace.id, mainWindow, {
        initialPrompt: discussionPrompt,
        claudeFlags,
      })
      devLog(`[PlanManager] Created discussion terminal: ${terminalId}`)

      addActiveWorkspace(discussionWorkspace.id)
      addWorkspaceToTab(discussionWorkspace.id, discussionTab.id)
      setActiveTab(discussionTab.id)

      // Notify renderer about the new terminal and maximize it
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-created', {
          terminalId,
          workspaceId: discussionWorkspace.id,
        })
        // Send maximize event to renderer so it displays full screen
        mainWindow.webContents.send('maximize-workspace', discussionWorkspace.id)
      }

      // Set up listener for discussion agent completion
      // Watch for the discussion output file being written
      const discussionOutputPath = `${getPlanDir(planId)}/discussion-output.md`
      const discussionEmitter = getTerminalEmitter(terminalId)
      let completionTriggered = false

      if (discussionEmitter) {
        const exitHandler = async (data: string) => {
          if (completionTriggered) return

          // Check if discussion output file was written
          // Look for the Write tool output or file creation confirmation
          if (data.includes('discussion-output.md') && (data.includes('Wrote') || data.includes('lines to'))) {
            // Verify file exists before completing
            try {
              await fs.access(discussionOutputPath)
              completionTriggered = true
              discussionEmitter.removeListener('data', exitHandler)
              completeDiscussion(planId)
            } catch {
              // File not created yet, keep waiting
            }
          }
        }
        discussionEmitter.on('data', exitHandler)
      }

      addPlanActivity(planId, 'success', 'Discussion agent started - waiting for input')
      emitStateUpdate()
    } catch (error) {
      console.error(`[PlanManager] Failed to create discussion terminal:`, error)
      addPlanActivity(planId, 'error', 'Failed to start discussion', error instanceof Error ? error.message : 'Unknown error')
    }
  } else {
    console.error(`[PlanManager] Cannot create discussion terminal - mainWindow is null`)
    addPlanActivity(planId, 'error', 'Cannot start discussion - window not available')
  }

  return plan
}

/**
 * Complete the discussion phase and transition to execution
 */
async function completeDiscussion(planId: string): Promise<void> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'discussing') return

  // Update discussion status
  if (plan.discussion) {
    plan.discussion.status = 'approved'
    plan.discussion.approvedAt = new Date().toISOString()
    // Generate a summary from the discussion (the agent should have done this)
    plan.discussion.summary = 'Discussion completed - see discussion-output.md for decisions made.'
  }

  // Store the path to the discussion output file
  plan.discussionOutputPath = `${getPlanDir(planId)}/discussion-output.md`

  // Cleanup discussion agent
  if (plan.discussionAgentWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.discussionAgentWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeActiveWorkspace(plan.discussionAgentWorkspaceId)
    removeWorkspaceFromTab(plan.discussionAgentWorkspaceId)
    deleteWorkspace(plan.discussionAgentWorkspaceId)
    plan.discussionAgentWorkspaceId = null
  }

  // Transition to 'discussed' status - ready for execution
  plan.status = 'discussed'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)

  addPlanActivity(planId, 'success', 'Discussion completed - ready for execution')
  emitPlanUpdate(plan)
  emitStateUpdate()
}

/**
 * Cancel a discussion and return to draft status
 */
export async function cancelDiscussion(planId: string): Promise<Plan | null> {
  const plan = getPlanById(planId)
  if (!plan || plan.status !== 'discussing') return plan || null

  // Update discussion status
  if (plan.discussion) {
    plan.discussion.status = 'cancelled'
  }

  // Cleanup discussion agent
  if (plan.discussionAgentWorkspaceId) {
    const terminalId = getTerminalForWorkspace(plan.discussionAgentWorkspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
    removeActiveWorkspace(plan.discussionAgentWorkspaceId)
    removeWorkspaceFromTab(plan.discussionAgentWorkspaceId)
    deleteWorkspace(plan.discussionAgentWorkspaceId)
    plan.discussionAgentWorkspaceId = null
  }

  // Delete the tab
  if (plan.orchestratorTabId) {
    deleteTab(plan.orchestratorTabId)
    plan.orchestratorTabId = null
  }

  // Return to draft status
  plan.status = 'draft'
  plan.updatedAt = new Date().toISOString()
  await savePlan(plan)

  addPlanActivity(planId, 'info', 'Discussion cancelled - returned to draft')
  emitPlanUpdate(plan)
  emitStateUpdate()

  return plan
}
