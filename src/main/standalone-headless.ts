/**
 * Standalone Headless Agent
 *
 * Manages headless agents that are not part of a plan.
 * These are created via CMD-K "Start: Headless Agent" command.
 */

import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  getStandaloneHeadlessDir,
  getStandaloneHeadlessAgentInfoPath,
  getStandaloneWorktreePath,
  getWorkspaceById,
  saveWorkspace,
  deleteWorkspace,
  writeConfigAtomic,
  getRandomUniqueIcon,
  getWorkspaces,
} from './config'
import { HeadlessAgent, HeadlessAgentOptions } from './headless-agent'
import { getOrCreateTabForWorkspace, addWorkspaceToTab, setActiveTab } from './state-manager'
import { getSelectedDockerImage } from './settings-manager'
import {
  getMainRepoRoot,
  getDefaultBranch,
  createWorktree,
  removeWorktree,
  deleteLocalBranch,
  deleteRemoteBranch,
  remoteBranchExists,
  getCommitsBetween,
} from './git-utils'
import type { Agent, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent, StandaloneWorktreeInfo } from '../shared/types'

// Word lists for fun random names
const ADJECTIVES = [
  'fluffy', 'happy', 'brave', 'swift', 'clever', 'gentle', 'mighty', 'calm',
  'wild', 'eager', 'jolly', 'lucky', 'plucky', 'zesty', 'snappy', 'peppy'
]

const NOUNS = [
  'bunny', 'panda', 'koala', 'otter', 'falcon', 'dolphin', 'fox', 'owl',
  'tiger', 'eagle', 'wolf', 'bear', 'hawk', 'lynx', 'raven', 'seal'
]

/**
 * Generate a fun, memorable random phrase for a standalone agent
 * Format: {adjective}-{noun} (e.g., "plucky-otter")
 */
function generateRandomPhrase(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective}-${noun}`
}

/**
 * Generate the display name for a standalone agent
 * Format: {repoName}: {phrase} (e.g., "bismarck: plucky-otter")
 */
function generateDisplayName(repoName: string, phrase: string): string {
  return `${repoName}: ${phrase}`
}

// Track standalone headless agents
const standaloneHeadlessAgents: Map<string, HeadlessAgent> = new Map()
const standaloneHeadlessAgentInfo: Map<string, HeadlessAgentInfo> = new Map()

// Reference to main window for IPC
let mainWindow: BrowserWindow | null = null

export function setMainWindowForStandaloneHeadless(window: BrowserWindow | null): void {
  mainWindow = window
}

/**
 * Ensure the standalone headless directory exists
 */
function ensureStandaloneHeadlessDir(): void {
  const dir = getStandaloneHeadlessDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load standalone headless agent info from disk
 */
export function loadStandaloneHeadlessAgentInfo(): HeadlessAgentInfo[] {
  const infoPath = getStandaloneHeadlessAgentInfoPath()
  try {
    const content = fs.readFileSync(infoPath, 'utf-8')
    return JSON.parse(content) as HeadlessAgentInfo[]
  } catch {
    return []
  }
}

/**
 * Save standalone headless agent info to disk
 */
function saveStandaloneHeadlessAgentInfo(): void {
  ensureStandaloneHeadlessDir()
  const agents = Array.from(standaloneHeadlessAgentInfo.values())
  writeConfigAtomic(getStandaloneHeadlessAgentInfoPath(), agents)
}

/**
 * Emit headless agent update to renderer
 */
function emitHeadlessAgentUpdate(info: HeadlessAgentInfo): void {
  saveStandaloneHeadlessAgentInfo()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-update', info)
  }
}

/**
 * Emit headless agent event to renderer
 */
function emitHeadlessAgentEvent(headlessId: string, event: StreamEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Use 'standalone' as planId for standalone agents
    mainWindow.webContents.send('headless-agent-event', { planId: 'standalone', taskId: headlessId, event })
  }
}

/**
 * Emit state update to renderer
 */
function emitStateUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Import here to avoid circular dependency
    const { getState } = require('./state-manager')
    mainWindow.webContents.send('state-update', getState())
  }
}

/**
 * Build enhanced prompt for standalone headless agents with PR instructions
 */
function buildStandaloneHeadlessPrompt(userPrompt: string, workingDir: string, branchName: string): string {
  return `[STANDALONE HEADLESS AGENT]

Working Directory: ${workingDir}
Branch: ${branchName}

=== YOUR TASK ===
${userPrompt}

=== COMPLETION REQUIREMENTS ===
When you complete your work:

1. Commit your changes with a clear, descriptive message
2. Push your branch to origin:
   git push -u origin ${branchName}
3. Create a PR and capture the URL:
   gh pr create --fill

   IMPORTANT: You MUST actually create the PR using 'gh pr create'.
   Do NOT just provide the GitHub "new PR" URL (github.com/.../pull/new/...).
   The PR must be created and you must report the actual PR number URL
   (e.g., github.com/.../pull/123).

4. Report the PR URL in your final message (must be a real PR number, not /pull/new/)

Type /exit when finished.`
}

/**
 * Build enhanced prompt for follow-up agents with commit history context
 */
function buildFollowUpPrompt(
  userPrompt: string,
  workingDir: string,
  branchName: string,
  recentCommits: Array<{ shortSha: string; message: string }>
): string {
  const commitHistory = recentCommits
    .map(c => `  - ${c.shortSha}: ${c.message}`)
    .join('\n')

  return `[STANDALONE HEADLESS AGENT - FOLLOW-UP]

Working Directory: ${workingDir}
Branch: ${branchName}

=== PREVIOUS WORK (review these commits for context) ===
${commitHistory || '(No prior commits on this branch)'}

=== YOUR FOLLOW-UP TASK ===
${userPrompt}

=== COMPLETION REQUIREMENTS ===
1. Review the previous commits above to understand what was done
2. Make your changes and commit with clear messages
3. Push your changes: git push origin ${branchName}
4. Update the existing PR if needed:
   - gh pr edit --title "new title" --body "new body"
5. Report the PR URL in your final message

Type /exit when finished.`
}

/**
 * Start a standalone headless agent
 *
 * @param referenceAgentId - The agent whose directory will be used as the working directory
 * @param prompt - The prompt to send to the agent
 * @param model - The model to use ('opus' or 'sonnet')
 * @returns The headless agent ID and workspace ID
 */
export async function startStandaloneHeadlessAgent(
  referenceAgentId: string,
  prompt: string,
  model: 'opus' | 'sonnet' = 'sonnet'
): Promise<{ headlessId: string; workspaceId: string }> {
  // Look up the reference agent to get its directory
  const referenceAgent = getWorkspaceById(referenceAgentId)
  if (!referenceAgent) {
    throw new Error(`Reference agent not found: ${referenceAgentId}`)
  }

  // Generate unique IDs
  const headlessId = `standalone-headless-${Date.now()}`
  const workspaceId = randomUUID()

  // Get repository info from reference agent's directory
  const repoPath = await getMainRepoRoot(referenceAgent.directory)
  if (!repoPath) {
    throw new Error(`Reference agent directory is not in a git repository: ${referenceAgent.directory}`)
  }
  const repoName = path.basename(repoPath)

  // Get default branch as base for worktree
  const baseBranch = await getDefaultBranch(repoPath)

  // Generate fun random phrase for this agent (e.g., "plucky-otter")
  const randomPhrase = generateRandomPhrase()

  // Use random phrase for branch and worktree
  const branchName = `standalone/${repoName}-${randomPhrase}`
  const worktreePath = getStandaloneWorktreePath(repoName, randomPhrase)

  // Ensure standalone headless directory exists
  ensureStandaloneHeadlessDir()

  // Create the worktree
  console.log(`[StandaloneHeadless] Creating worktree at ${worktreePath}`)
  await createWorktree(repoPath, worktreePath, branchName, baseBranch)

  // Store worktree info for cleanup
  const worktreeInfo: StandaloneWorktreeInfo = {
    path: worktreePath,
    branch: branchName,
    repoPath: repoPath,
  }

  // Create a new Agent workspace for the headless agent
  const existingWorkspaces = getWorkspaces()
  const newAgent: Agent = {
    id: workspaceId,
    name: generateDisplayName(repoName, randomPhrase), // e.g., "bismarck: plucky-otter"
    directory: worktreePath, // Use worktree path instead of reference directory
    purpose: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
    theme: referenceAgent.theme,
    icon: getRandomUniqueIcon(existingWorkspaces),
    isHeadless: true,
    isStandaloneHeadless: true,
    taskId: headlessId,
    worktreePath: worktreePath,
  }

  // Save the workspace
  saveWorkspace(newAgent)

  // Place agent in next available grid slot
  const tab = getOrCreateTabForWorkspace(workspaceId)
  addWorkspaceToTab(workspaceId, tab.id)
  setActiveTab(tab.id)

  // Emit state update so renderer picks up the new workspace and tab
  emitStateUpdate()

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: headlessId,
    taskId: headlessId,
    planId: 'standalone', // Special marker for standalone agents
    status: 'starting',
    worktreePath: worktreePath,
    events: [],
    startedAt: new Date().toISOString(),
    worktreeInfo: worktreeInfo,
  }
  standaloneHeadlessAgentInfo.set(headlessId, agentInfo)

  // Emit initial state
  emitHeadlessAgentUpdate(agentInfo)

  // Emit started event
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-started', {
      taskId: headlessId,
      planId: 'standalone',
      worktreePath: worktreePath,
    })
  }

  // Create and start headless agent
  const agent = new HeadlessAgent()
  standaloneHeadlessAgents.set(headlessId, agent)

  // Set up event listeners
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(headlessId, event)
  })

  agent.on('complete', (result) => {
    agentInfo.status = result.success ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    // Clean up agent instance (but keep info for display)
    standaloneHeadlessAgents.delete(headlessId)
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    standaloneHeadlessAgents.delete(headlessId)
    console.error(`[StandaloneHeadless] Agent ${headlessId} error:`, error)
  })

  // Start the agent
  const selectedImage = await getSelectedDockerImage()
  const enhancedPrompt = buildStandaloneHeadlessPrompt(prompt, worktreePath, branchName)
  const options: HeadlessAgentOptions = {
    prompt: enhancedPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    taskId: headlessId,
    image: selectedImage,
    claudeFlags: ['--model', model],
  }

  try {
    await agent.start(options)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    standaloneHeadlessAgents.delete(headlessId)
    standaloneHeadlessAgentInfo.delete(headlessId)

    // Clean up worktree on failure
    try {
      await removeWorktree(repoPath, worktreePath, true)
    } catch (cleanupError) {
      console.error(`[StandaloneHeadless] Failed to clean up worktree on error:`, cleanupError)
    }

    throw error
  }

  return { headlessId, workspaceId }
}

/**
 * Get all standalone headless agent info
 */
export function getStandaloneHeadlessAgents(): HeadlessAgentInfo[] {
  return Array.from(standaloneHeadlessAgentInfo.values())
}

/**
 * Get standalone headless agent info by ID
 */
export function getStandaloneHeadlessAgentInfo(headlessId: string): HeadlessAgentInfo | undefined {
  return standaloneHeadlessAgentInfo.get(headlessId)
}

/**
 * Stop a standalone headless agent
 */
export async function stopStandaloneHeadlessAgent(headlessId: string): Promise<void> {
  const agent = standaloneHeadlessAgents.get(headlessId)
  if (agent) {
    await agent.stop()
    standaloneHeadlessAgents.delete(headlessId)
  }

  // Update status
  const info = standaloneHeadlessAgentInfo.get(headlessId)
  if (info && info.status !== 'completed' && info.status !== 'failed') {
    info.status = 'completed'
    info.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(info)
  }
}

/**
 * Initialize standalone headless module - load persisted agent info
 */
export function initStandaloneHeadless(): void {
  const agents = loadStandaloneHeadlessAgentInfo()
  for (const agent of agents) {
    if (agent.taskId) {
      standaloneHeadlessAgentInfo.set(agent.taskId, agent)
    }
  }
  console.log(`[StandaloneHeadless] Loaded ${agents.length} standalone headless agent records`)
}

/**
 * Clean up a standalone agent's worktree and branch
 * Called when user clicks "Confirm Done" or when workspace is deleted
 */
export async function cleanupStandaloneWorktree(headlessId: string): Promise<void> {
  const agentInfo = standaloneHeadlessAgentInfo.get(headlessId)
  if (!agentInfo?.worktreeInfo) {
    console.log(`[StandaloneHeadless] No worktree info for agent ${headlessId}`)
    return
  }

  const { path: worktreePath, branch, repoPath } = agentInfo.worktreeInfo

  console.log(`[StandaloneHeadless] Cleaning up worktree for agent ${headlessId}`)

  // Remove the worktree
  try {
    await removeWorktree(repoPath, worktreePath, true)
    console.log(`[StandaloneHeadless] Removed worktree at ${worktreePath}`)
  } catch (error) {
    console.error(`[StandaloneHeadless] Failed to remove worktree:`, error)
  }

  // Delete the local branch
  try {
    await deleteLocalBranch(repoPath, branch)
    console.log(`[StandaloneHeadless] Deleted local branch ${branch}`)
  } catch (error) {
    // Branch may not exist if worktree removal already deleted it
    console.log(`[StandaloneHeadless] Local branch ${branch} may already be deleted:`, error)
  }

  // Delete the remote branch if it exists
  try {
    if (await remoteBranchExists(repoPath, branch)) {
      await deleteRemoteBranch(repoPath, branch)
      console.log(`[StandaloneHeadless] Deleted remote branch ${branch}`)
    }
  } catch (error) {
    console.error(`[StandaloneHeadless] Failed to delete remote branch:`, error)
  }

  // Remove agent info
  standaloneHeadlessAgentInfo.delete(headlessId)
  saveStandaloneHeadlessAgentInfo()
}

/**
 * Confirm that a standalone agent is done - cleans up worktree and removes workspace
 */
export async function confirmStandaloneAgentDone(headlessId: string): Promise<void> {
  console.log(`[StandaloneHeadless] Confirming done for agent ${headlessId}`)

  // Find the workspace associated with this headless agent
  const workspaces = getWorkspaces()
  const workspace = workspaces.find(w => w.taskId === headlessId && w.isStandaloneHeadless)

  // Clean up worktree and branch
  await cleanupStandaloneWorktree(headlessId)

  // Delete the workspace
  if (workspace) {
    deleteWorkspace(workspace.id)
    console.log(`[StandaloneHeadless] Deleted workspace ${workspace.id}`)
  }

  // Emit state update
  emitStateUpdate()
}

/**
 * Start a follow-up agent in the same worktree
 * @returns The new headless agent ID and workspace ID
 */
export async function startFollowUpAgent(
  headlessId: string,
  prompt: string
): Promise<{ headlessId: string; workspaceId: string }> {
  const existingInfo = standaloneHeadlessAgentInfo.get(headlessId)
  if (!existingInfo?.worktreeInfo) {
    throw new Error(`No worktree info for agent ${headlessId}`)
  }

  // Find the existing workspace
  const workspaces = getWorkspaces()
  const existingWorkspace = workspaces.find(w => w.taskId === headlessId && w.isStandaloneHeadless)

  const { path: worktreePath, branch, repoPath } = existingInfo.worktreeInfo

  // Extract repo name and phrase from branch (e.g., "standalone/bismarck-plucky-otter" -> "bismarck", "plucky-otter")
  const repoName = path.basename(repoPath)
  const branchSuffix = branch.replace('standalone/', '') // e.g., "bismarck-plucky-otter"
  const phrase = branchSuffix.replace(`${repoName}-`, '') // e.g., "plucky-otter"

  // Generate new headless ID
  const newHeadlessId = `standalone-headless-${Date.now()}`
  const workspaceId = randomUUID()

  // Create worktree info (same worktree, new agent)
  const worktreeInfo: StandaloneWorktreeInfo = {
    path: worktreePath,
    branch: branch,
    repoPath: repoPath,
  }

  // Create a new Agent workspace for the follow-up agent
  const newAgent: Agent = {
    id: workspaceId,
    name: `${generateDisplayName(repoName, phrase)} (follow-up)`, // e.g., "bismarck: plucky-otter (follow-up)"
    directory: worktreePath,
    purpose: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
    theme: existingWorkspace?.theme || 'blue',
    icon: getRandomUniqueIcon(workspaces),
    isHeadless: true,
    isStandaloneHeadless: true,
    taskId: newHeadlessId,
    worktreePath: worktreePath,
  }

  // Save the workspace
  saveWorkspace(newAgent)

  // Place agent in next available grid slot
  const tab = getOrCreateTabForWorkspace(workspaceId)
  addWorkspaceToTab(workspaceId, tab.id)
  setActiveTab(tab.id)

  // Emit state update
  emitStateUpdate()

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: newHeadlessId,
    taskId: newHeadlessId,
    planId: 'standalone',
    status: 'starting',
    worktreePath: worktreePath,
    events: [],
    startedAt: new Date().toISOString(),
    worktreeInfo: worktreeInfo,
  }
  standaloneHeadlessAgentInfo.set(newHeadlessId, agentInfo)

  // Remove old agent info (worktree is now owned by new agent)
  standaloneHeadlessAgentInfo.delete(headlessId)

  // Emit initial state
  emitHeadlessAgentUpdate(agentInfo)

  // Emit started event
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-started', {
      taskId: newHeadlessId,
      planId: 'standalone',
      worktreePath: worktreePath,
    })
  }

  // Create and start headless agent
  const agent = new HeadlessAgent()
  standaloneHeadlessAgents.set(newHeadlessId, agent)

  // Set up event listeners
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(newHeadlessId, event)
  })

  agent.on('complete', (result) => {
    agentInfo.status = result.success ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    // Clean up agent instance (but keep info for display)
    standaloneHeadlessAgents.delete(newHeadlessId)
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    standaloneHeadlessAgents.delete(newHeadlessId)
    console.error(`[StandaloneHeadless] Agent ${newHeadlessId} error:`, error)
  })

  // Start the agent
  const selectedImage = await getSelectedDockerImage()

  // Get recent commits for context (compare against default branch)
  const defaultBranch = await getDefaultBranch(repoPath)
  const allCommits = await getCommitsBetween(worktreePath, `origin/${defaultBranch}`, 'HEAD')
  // Take last 5 commits (most recent)
  const recentCommits = allCommits.slice(-5)
  console.log(`[StandaloneHeadless] Found ${allCommits.length} commits, using last ${recentCommits.length} for context`)

  const enhancedPrompt = buildFollowUpPrompt(prompt, worktreePath, branch, recentCommits)
  const options: HeadlessAgentOptions = {
    prompt: enhancedPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    taskId: newHeadlessId,
    image: selectedImage,
  }

  try {
    await agent.start(options)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    standaloneHeadlessAgents.delete(newHeadlessId)
    standaloneHeadlessAgentInfo.delete(newHeadlessId)

    throw error
  }

  return { headlessId: newHeadlessId, workspaceId }
}
