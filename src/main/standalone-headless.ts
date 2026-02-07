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
import { devLog } from './dev-log'
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
import { getOrCreateTabForWorkspaceWithPreference, addWorkspaceToTab, setActiveTab, removeActiveWorkspace, removeWorkspaceFromTab, addActiveWorkspace, createTab } from './state-manager'
import { getSelectedDockerImage, loadSettings } from './settings-manager'
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
import { startToolProxy, isProxyRunning } from './tool-proxy'
import { getRepositoryById, getRepositoryByPath } from './repository-manager'
import type { Agent, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent, StandaloneWorktreeInfo } from '../shared/types'
import { buildPrompt, buildProxiedToolsSection, type PromptVariables } from './prompt-templates'
import { queueTerminalCreation } from './terminal-queue'
import { getTerminalEmitter, closeTerminal, getTerminalForWorkspace } from './terminal'
import * as fsPromises from 'fs/promises'

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

let onStatusChangeCallback: ((headlessId: string, status: string) => void) | null = null

export function onStandaloneAgentStatusChange(cb: (headlessId: string, status: string) => void): void {
  onStatusChangeCallback = cb
}

/**
 * Emit headless agent update to renderer
 */
function emitHeadlessAgentUpdate(info: HeadlessAgentInfo): void {
  saveStandaloneHeadlessAgentInfo()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-update', info)
  }
  onStatusChangeCallback?.(info.id, info.status)
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
 *
 * Note: Persona prompts are NOT injected into headless agents - they need to stay focused on tasks.
 * Persona prompts are only injected via hooks for interactive Claude Code sessions.
 */
async function buildStandaloneHeadlessPrompt(userPrompt: string, workingDir: string, branchName: string, completionCriteria?: string): Promise<string> {
  // Format completion criteria section if provided
  const completionCriteriaSection = completionCriteria
    ? `
=== COMPLETION CRITERIA ===
Before marking your work complete, ensure these pass:
${completionCriteria}

Keep iterating until all criteria are satisfied.
`
    : ''

  // Build proxied tools section based on enabled tools
  const settings = await loadSettings()
  const proxiedTools = settings.docker.proxiedTools
  const proxiedToolsSection = buildProxiedToolsSection({
    git: proxiedTools.find(t => t.name === 'git')?.enabled ?? true,
    gh: proxiedTools.find(t => t.name === 'gh')?.enabled ?? true,
    bd: proxiedTools.find(t => t.name === 'bd')?.enabled ?? true,
    bb: proxiedTools.find(t => t.name === 'bb')?.enabled ?? false,
  })

  const variables: PromptVariables = {
    userPrompt,
    workingDir,
    branchName,
    completionCriteria: completionCriteriaSection,
    proxiedToolsSection,
  }

  return buildPrompt('standalone_headless', variables)
}

/**
 * Build enhanced prompt for follow-up agents with commit history context
 *
 * Note: Persona prompts are NOT injected into headless agents - they need to stay focused on tasks.
 * Persona prompts are only injected via hooks for interactive Claude Code sessions.
 */
async function buildFollowUpPrompt(
  userPrompt: string,
  workingDir: string,
  branchName: string,
  recentCommits: Array<{ shortSha: string; message: string }>,
  completionCriteria?: string
): Promise<string> {
  // Format commit history
  const commitHistory = recentCommits.length > 0
    ? recentCommits.map(c => `  - ${c.shortSha}: ${c.message}`).join('\n')
    : '(No prior commits on this branch)'

  // Format completion criteria section if provided
  const completionCriteriaSection = completionCriteria
    ? `
=== COMPLETION CRITERIA ===
Before marking your work complete, ensure these pass:
${completionCriteria}

Keep iterating until all criteria are satisfied.
`
    : ''

  // Build proxied tools section based on enabled tools
  const settings = await loadSettings()
  const proxiedTools = settings.docker.proxiedTools
  const proxiedToolsSection = buildProxiedToolsSection({
    git: proxiedTools.find(t => t.name === 'git')?.enabled ?? true,
    gh: proxiedTools.find(t => t.name === 'gh')?.enabled ?? true,
    bd: proxiedTools.find(t => t.name === 'bd')?.enabled ?? true,
    bb: proxiedTools.find(t => t.name === 'bb')?.enabled ?? false,
  })

  const variables: PromptVariables = {
    userPrompt,
    workingDir,
    branchName,
    commitHistory,
    completionCriteria: completionCriteriaSection,
    proxiedToolsSection,
  }

  return buildPrompt('standalone_followup', variables)
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
  model: 'opus' | 'sonnet' = 'sonnet',
  targetTabId?: string
): Promise<{ headlessId: string; workspaceId: string; tabId: string }> {
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

  // Ensure tool proxy is running for Docker container communication
  // This is critical - without it, git commands from containers will fail
  const proxyWasRunning = isProxyRunning()
  devLog(`[StandaloneHeadless] Tool proxy status before start: running=${proxyWasRunning}`)
  if (!proxyWasRunning) {
    devLog('[StandaloneHeadless] Starting tool proxy for container communication')
    await startToolProxy()
    devLog(`[StandaloneHeadless] Tool proxy started, now running=${isProxyRunning()}`)
  }

  // Create the worktree
  devLog(`[StandaloneHeadless] Creating worktree at ${worktreePath}`)
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

  // Place agent in next available grid slot (prefer target tab if specified)
  const tab = getOrCreateTabForWorkspaceWithPreference(workspaceId, targetTabId)
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
    userPrompt: prompt, // Store raw user prompt for Eye modal default view
    model: model, // Store model for UI display
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
  // Look up repository for completion criteria
  // Try repositoryId first, fallback to path-based lookup for legacy workspaces
  const repository = referenceAgent.repositoryId
    ? await getRepositoryById(referenceAgent.repositoryId)
    : await getRepositoryByPath(referenceAgent.directory)
  const enhancedPrompt = await buildStandaloneHeadlessPrompt(prompt, worktreePath, branchName, repository?.completionCriteria)

  // Update stored prompt to the full resolved version (for Eye modal display)
  agentInfo.originalPrompt = enhancedPrompt

  const options: HeadlessAgentOptions = {
    prompt: enhancedPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    planId: referenceAgent.directory, // Use reference agent directory for bd proxy
    taskId: headlessId,
    image: selectedImage,
    claudeFlags: ['--model', model],
  }

  devLog(`[StandaloneHeadless] Starting agent with config:`, {
    headlessId,
    worktreePath,
    branchName,
    image: selectedImage,
    model,
    proxyRunning: isProxyRunning(),
  })

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

  return { headlessId, workspaceId, tabId: tab.id }
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
 * Mark any agents that were running when the app closed as interrupted
 */
export function initStandaloneHeadless(): void {
  const agents = loadStandaloneHeadlessAgentInfo()
  let modified = false

  for (const agent of agents) {
    if (agent.taskId) {
      // Mark non-terminal agents as interrupted (they were running when app closed)
      if (agent.status === 'starting' || agent.status === 'running' || agent.status === 'stopping') {
        agent.status = 'interrupted'
        modified = true
      }
      standaloneHeadlessAgentInfo.set(agent.taskId, agent)
    }
  }

  if (modified) {
    saveStandaloneHeadlessAgentInfo()
  }
  devLog(`[StandaloneHeadless] Loaded ${agents.length} standalone headless agent records`)
}

/**
 * Clean up a standalone agent's worktree and branch
 * Called when user clicks "Confirm Done" or when workspace is deleted
 */
export async function cleanupStandaloneWorktree(headlessId: string): Promise<void> {
  const agentInfo = standaloneHeadlessAgentInfo.get(headlessId)
  if (!agentInfo?.worktreeInfo) {
    devLog(`[StandaloneHeadless] No worktree info for agent ${headlessId}`)
    return
  }

  const { path: worktreePath, branch, repoPath } = agentInfo.worktreeInfo

  devLog(`[StandaloneHeadless] Cleaning up worktree for agent ${headlessId}`)

  // Remove the worktree
  try {
    await removeWorktree(repoPath, worktreePath, true)
    devLog(`[StandaloneHeadless] Removed worktree at ${worktreePath}`)
  } catch (error) {
    console.error(`[StandaloneHeadless] Failed to remove worktree:`, error)
  }

  // Delete the local branch
  try {
    await deleteLocalBranch(repoPath, branch)
    devLog(`[StandaloneHeadless] Deleted local branch ${branch}`)
  } catch (error) {
    // Branch may not exist if worktree removal already deleted it
    devLog(`[StandaloneHeadless] Local branch ${branch} may already be deleted:`, error)
  }

  // Delete the remote branch if it exists
  try {
    if (await remoteBranchExists(repoPath, branch)) {
      await deleteRemoteBranch(repoPath, branch)
      devLog(`[StandaloneHeadless] Deleted remote branch ${branch}`)
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
  devLog(`[StandaloneHeadless] Confirming done for agent ${headlessId}`)

  // Find the workspace associated with this headless agent
  const workspaces = getWorkspaces()
  const workspace = workspaces.find(w => w.taskId === headlessId && w.isStandaloneHeadless)

  // Clean up worktree and branch
  await cleanupStandaloneWorktree(headlessId)

  // Remove workspace from tab and active workspaces BEFORE deleting
  // This releases the grid slot so it can be reused by new agents
  if (workspace) {
    removeActiveWorkspace(workspace.id)
    removeWorkspaceFromTab(workspace.id)
    deleteWorkspace(workspace.id)
    devLog(`[StandaloneHeadless] Deleted workspace ${workspace.id} and released slot`)
  }

  // Emit state update
  emitStateUpdate()
}

/**
 * Restart an interrupted standalone headless agent
 * Creates a fresh agent with the same original prompt (new workspace, cleans old resources)
 */
export async function restartStandaloneHeadlessAgent(
  headlessId: string,
  model: 'opus' | 'sonnet' = 'sonnet'
): Promise<{ headlessId: string; workspaceId: string }> {
  const existingInfo = standaloneHeadlessAgentInfo.get(headlessId)
  if (!existingInfo?.originalPrompt) {
    throw new Error(`No original prompt for agent: ${headlessId}`)
  }

  const workspaces = getWorkspaces()
  const workspace = workspaces.find(w => w.taskId === headlessId && w.isStandaloneHeadless)
  if (!workspace) {
    throw new Error(`No workspace found for agent: ${headlessId}`)
  }

  const repoPath = existingInfo.worktreeInfo?.repoPath
  if (!repoPath) {
    throw new Error(`No repo path for agent: ${headlessId}`)
  }

  // Find reference workspace in same repo (a non-headless workspace)
  const referenceWorkspace = workspaces.find(w =>
    w.directory.startsWith(repoPath) && !w.isStandaloneHeadless && !w.isHeadless
  )
  if (!referenceWorkspace) {
    throw new Error(`No reference workspace for repo: ${repoPath}`)
  }

  devLog(`[StandaloneHeadless] Restarting agent ${headlessId} with original prompt`)

  // Store original prompt before cleanup
  const originalPrompt = existingInfo.originalPrompt

  // Clean up old resources
  await cleanupStandaloneWorktree(headlessId)
  removeActiveWorkspace(workspace.id)
  removeWorkspaceFromTab(workspace.id)
  deleteWorkspace(workspace.id)

  // Start fresh agent with same prompt
  return startStandaloneHeadlessAgent(referenceWorkspace.id, originalPrompt, model)
}

/**
 * Start a follow-up agent in the same worktree
 * @returns The new headless agent ID and workspace ID
 */
export async function startFollowUpAgent(
  headlessId: string,
  prompt: string,
  model?: 'opus' | 'sonnet'
): Promise<{ headlessId: string; workspaceId: string }> {
  const existingInfo = standaloneHeadlessAgentInfo.get(headlessId)
  if (!existingInfo?.worktreeInfo) {
    throw new Error(`No worktree info for agent ${headlessId}`)
  }

  // Ensure tool proxy is running for Docker container communication
  const proxyWasRunning = isProxyRunning()
  devLog(`[StandaloneHeadless] Tool proxy status before follow-up: running=${proxyWasRunning}`)
  if (!proxyWasRunning) {
    devLog('[StandaloneHeadless] Starting tool proxy for follow-up agent')
    await startToolProxy()
    devLog(`[StandaloneHeadless] Tool proxy started, now running=${isProxyRunning()}`)
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
  const tab = getOrCreateTabForWorkspaceWithPreference(workspaceId)
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
    userPrompt: prompt, // Store raw user prompt for Eye modal default view
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
  devLog(`[StandaloneHeadless] Found ${allCommits.length} commits, using last ${recentCommits.length} for context`)

  // Look up repository for completion criteria
  const repository = await getRepositoryByPath(repoPath)
  const enhancedPrompt = await buildFollowUpPrompt(prompt, worktreePath, branch, recentCommits, repository?.completionCriteria)

  // Store the full resolved prompt (for Eye modal display)
  agentInfo.originalPrompt = enhancedPrompt

  const options: HeadlessAgentOptions = {
    prompt: enhancedPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    planId: repoPath, // Use repo path for bd proxy (where .beads/ directory lives)
    taskId: newHeadlessId,
    image: selectedImage,
    claudeFlags: model ? ['--model', model] : undefined,
  }

  // Store model in agent info
  if (model) {
    agentInfo.model = model
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

/**
 * Track active headless discussions
 */
interface HeadlessDiscussionState {
  discussionId: string
  workspaceId: string
  referenceAgentId: string
  tabId: string
  outputPath: string
  terminalId?: string
}

const activeHeadlessDiscussions: Map<string, HeadlessDiscussionState> = new Map()

/**
 * Start a headless discussion session
 *
 * This creates an interactive Claude session to gather requirements from the user,
 * then automatically starts a headless agent with the gathered context.
 *
 * @param referenceAgentId - The agent whose directory will be used as the working directory
 * @param maxQuestions - Maximum number of questions to ask (default: 7)
 * @returns Discussion session info
 */
export async function startHeadlessDiscussion(
  referenceAgentId: string,
  maxQuestions: number = 7
): Promise<{ discussionId: string; workspaceId: string; tabId: string }> {
  if (!mainWindow) {
    throw new Error('Main window not available')
  }

  // Look up the reference agent to get its directory
  const referenceAgent = getWorkspaceById(referenceAgentId)
  if (!referenceAgent) {
    throw new Error(`Reference agent not found: ${referenceAgentId}`)
  }

  // Get repository info from reference agent's directory
  const repoPath = await getMainRepoRoot(referenceAgent.directory)
  if (!repoPath) {
    throw new Error(`Reference agent directory is not in a git repository: ${referenceAgent.directory}`)
  }
  const repoName = path.basename(repoPath)

  // Generate unique IDs
  const discussionId = `headless-discussion-${Date.now()}`
  const workspaceId = randomUUID()

  // Generate random phrase for this discussion
  const randomPhrase = generateRandomPhrase()

  // Ensure standalone headless directory exists
  ensureStandaloneHeadlessDir()

  // Create output path for discussion results
  const discussionDir = path.join(getStandaloneHeadlessDir(), 'discussions', discussionId)
  await fsPromises.mkdir(discussionDir, { recursive: true })
  const discussionOutputPath = path.join(discussionDir, 'discussion-output.md')

  // Build the discussion prompt
  const discussionPrompt = await buildPrompt('headless_discussion', {
    referenceRepoName: repoName,
    codebasePath: referenceAgent.directory,
    maxQuestions: maxQuestions,
    discussionOutputPath: discussionOutputPath,
  })

  // Create discussion workspace
  const existingWorkspaces = getWorkspaces()
  const discussionWorkspace: Agent = {
    id: workspaceId,
    name: `💬 ${repoName}: ${randomPhrase}`,
    directory: referenceAgent.directory,
    purpose: 'Gathering requirements for headless agent',
    theme: 'purple',
    icon: getRandomUniqueIcon(existingWorkspaces),
  }
  saveWorkspace(discussionWorkspace)

  // Create a dedicated tab for the discussion
  const discussionTab = createTab(`💬 ${repoName.substring(0, 15)}`)

  // Store discussion state
  const discussionState: HeadlessDiscussionState = {
    discussionId,
    workspaceId,
    referenceAgentId,
    tabId: discussionTab.id,
    outputPath: discussionOutputPath,
  }
  activeHeadlessDiscussions.set(discussionId, discussionState)

  try {
    // Create terminal for discussion
    devLog(`[HeadlessDiscussion] Creating terminal for discussion ${discussionId}`)
    const claudeFlags = `--add-dir "${referenceAgent.directory}"`
    const terminalId = await queueTerminalCreation(workspaceId, mainWindow, {
      initialPrompt: discussionPrompt,
      claudeFlags,
    })
    discussionState.terminalId = terminalId
    devLog(`[HeadlessDiscussion] Created discussion terminal: ${terminalId}`)

    // Set up workspace in tab
    addActiveWorkspace(workspaceId)
    addWorkspaceToTab(workspaceId, discussionTab.id)
    setActiveTab(discussionTab.id)

    // Notify renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-created', {
        terminalId,
        workspaceId,
      })
      mainWindow.webContents.send('maximize-workspace', workspaceId)
    }

    // Set up listener for discussion completion
    const discussionEmitter = getTerminalEmitter(terminalId)
    if (discussionEmitter) {
      let completionTriggered = false

      const dataHandler = async (data: string) => {
        if (completionTriggered) return

        // Check if discussion output file was written
        // Look for the Write tool output or file creation confirmation
        if (data.includes('discussion-output.md') && (data.includes('Wrote') || data.includes('lines to'))) {
          // Verify file exists before completing
          try {
            await fsPromises.access(discussionOutputPath)
            completionTriggered = true
            discussionEmitter.removeListener('data', dataHandler)
            devLog(`[HeadlessDiscussion] Discussion complete, output written to ${discussionOutputPath}`)
            await completeHeadlessDiscussion(discussionId)
          } catch {
            // File not created yet, keep waiting
          }
        }
      }
      discussionEmitter.on('data', dataHandler)
    }

    emitStateUpdate()

    return { discussionId, workspaceId, tabId: discussionTab.id }
  } catch (error) {
    // Clean up on error
    activeHeadlessDiscussions.delete(discussionId)
    deleteWorkspace(workspaceId)
    throw error
  }
}

/**
 * Complete a headless discussion and start the headless agent
 */
async function completeHeadlessDiscussion(discussionId: string): Promise<void> {
  const discussionState = activeHeadlessDiscussions.get(discussionId)
  if (!discussionState) {
    console.error(`[HeadlessDiscussion] Discussion not found: ${discussionId}`)
    return
  }

  try {
    // Read the discussion output
    const discussionOutput = await fsPromises.readFile(discussionState.outputPath, 'utf-8')
    devLog(`[HeadlessDiscussion] Read discussion output (${discussionOutput.length} chars)`)

    // Close the discussion terminal
    if (discussionState.terminalId) {
      const terminalId = getTerminalForWorkspace(discussionState.workspaceId)
      if (terminalId) {
        closeTerminal(terminalId)
      }
    }

    // Remove discussion workspace from tab and delete it
    removeActiveWorkspace(discussionState.workspaceId)
    removeWorkspaceFromTab(discussionState.workspaceId)
    deleteWorkspace(discussionState.workspaceId)

    // Build prompt from discussion output
    const headlessPrompt = `Based on the following requirements discussion, implement the requested changes:

${discussionOutput}

Please implement the above requirements, following the approach and file modifications outlined.`

    // Start the headless agent with the discussion context
    devLog(`[HeadlessDiscussion] Starting headless agent with discussion context`)
    const result = await startStandaloneHeadlessAgent(
      discussionState.referenceAgentId,
      headlessPrompt,
      'sonnet', // Default to sonnet model
      discussionState.tabId // Reuse the same tab
    )

    devLog(`[HeadlessDiscussion] Headless agent started: ${result.headlessId}`)

    // Clean up discussion state
    activeHeadlessDiscussions.delete(discussionId)

  } catch (error) {
    console.error(`[HeadlessDiscussion] Failed to complete discussion:`, error)
    activeHeadlessDiscussions.delete(discussionId)
    throw error
  }
}

/**
 * Cancel a headless discussion
 */
export async function cancelHeadlessDiscussion(discussionId: string): Promise<void> {
  const discussionState = activeHeadlessDiscussions.get(discussionId)
  if (!discussionState) {
    return
  }

  // Close the terminal
  if (discussionState.terminalId) {
    const terminalId = getTerminalForWorkspace(discussionState.workspaceId)
    if (terminalId) {
      closeTerminal(terminalId)
    }
  }

  // Clean up workspace
  removeActiveWorkspace(discussionState.workspaceId)
  removeWorkspaceFromTab(discussionState.workspaceId)
  deleteWorkspace(discussionState.workspaceId)

  // Clean up discussion state
  activeHeadlessDiscussions.delete(discussionId)

  emitStateUpdate()
}
