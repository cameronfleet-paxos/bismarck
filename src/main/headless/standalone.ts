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
import { devLog } from '../dev-log'
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
  getRepoCacheDir,
  getRepoModCacheDir,
  resolvePnpmStorePath,
} from '../config'
import { HeadlessAgent, HeadlessAgentOptions } from './docker-agent'
import { getOrCreateTabForWorkspaceWithPreference, addWorkspaceToTab, setActiveTab, removeActiveWorkspace, removeWorkspaceFromTab, addActiveWorkspace, createTab, deleteTab, getTabForWorkspace } from '../state-manager'
import { getSelectedDockerImage, loadSettings } from '../settings-manager'
import {
  getMainRepoRoot,
  getDefaultBranch,
  createWorktree,
  removeWorktree,
  deleteLocalBranch,
  getCommitsBetween,
} from '../git-utils'
import { startToolProxy, isProxyRunning } from '../tool-proxy'
import { getRepositoryById, getRepositoryByPath } from '../repository-manager'
import type { Agent, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent, StandaloneWorktreeInfo } from '../../shared/types'
import { buildPrompt, buildProxiedToolsSection, type PromptVariables } from '../prompt-templates'
import { runPlanPhase, wrapPromptWithPlan } from '../plan-phase'
import { queueTerminalCreation } from '../terminal-queue'
import { getTerminalEmitter, closeTerminal, getTerminalForWorkspace } from '../terminal'
import * as fsPromises from 'fs/promises'
import { generateBranchSlug, generateRandomPhrase } from '../naming-utils'

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
  devLog('[StandaloneHeadless] emitHeadlessAgentEvent', { headlessId, eventType: event.type, windowAvailable: !!(mainWindow && !mainWindow.isDestroyed()) })
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
    const { getState } = require('../state-manager')
    mainWindow.webContents.send('state-update', getState())
  }
}

/**
 * Build enhanced prompt for standalone headless agents with PR instructions
 *
 * Note: Persona prompts are NOT injected into headless agents - they need to stay focused on tasks.
 * Persona prompts are only injected via hooks for interactive Claude Code sessions.
 */
async function buildStandaloneHeadlessPrompt(userPrompt: string, workingDir: string, branchName: string, protectedBranch: string, completionCriteria?: string, guidance?: string): Promise<string> {
  // Format completion criteria (folded into COMPLETION REQUIREMENTS via template)
  const completionCriteriaSection = completionCriteria
    ? `
Before creating your PR, ensure these acceptance criteria pass:
${completionCriteria}
Keep iterating until all criteria are satisfied.

`
    : ''

  // Format guidance section if provided
  const guidanceSection = guidance
    ? `
=== REPOSITORY GUIDANCE ===
Follow these repo-specific guidelines:
${guidance}
`
    : ''

  // Build proxied tools section based on enabled tools
  const settings = await loadSettings()
  const proxiedToolsSection = buildProxiedToolsSection(settings.docker.proxiedTools)

  const variables: PromptVariables = {
    userPrompt,
    workingDir,
    branchName,
    protectedBranch,
    completionCriteria: completionCriteriaSection,
    guidance: guidanceSection,
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
  protectedBranch: string,
  recentCommits: Array<{ shortSha: string; message: string }>,
  completionCriteria?: string,
  guidance?: string
): Promise<string> {
  // Format commit history
  const commitHistory = recentCommits.length > 0
    ? recentCommits.map(c => `  - ${c.shortSha}: ${c.message}`).join('\n')
    : '(No prior commits on this branch)'

  // Format completion criteria (folded into COMPLETION REQUIREMENTS via template)
  const completionCriteriaSection = completionCriteria
    ? `
Before creating your PR, ensure these acceptance criteria pass:
${completionCriteria}
Keep iterating until all criteria are satisfied.

`
    : ''

  // Format guidance section if provided
  const guidanceSection = guidance
    ? `
=== REPOSITORY GUIDANCE ===
Follow these repo-specific guidelines:
${guidance}
`
    : ''

  // Build proxied tools section based on enabled tools
  const settings = await loadSettings()
  const proxiedToolsSection = buildProxiedToolsSection(settings.docker.proxiedTools)

  const variables: PromptVariables = {
    userPrompt,
    workingDir,
    branchName,
    protectedBranch,
    commitHistory,
    completionCriteria: completionCriteriaSection,
    guidance: guidanceSection,
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
  targetTabId?: string,
  startOptions?: { skipPlanPhase?: boolean }
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

  // Generate prompt-aware slug for branch name (e.g., "fix-login-session-a3f7")
  const slug = generateBranchSlug(prompt)

  // Use slug for branch and worktree
  const branchName = `bismarck-standalone/${repoName}-${slug}`
  const worktreePath = getStandaloneWorktreePath(repoName, slug)

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

  // Create temp directory for builds (Go, etc.) to avoid filling container overlay fs
  const tmpDir = path.join(worktreePath, '.tmp')
  await fsPromises.mkdir(tmpDir, { recursive: true })

  // Create shared Go build cache and module cache directories for this repo
  const sharedCacheDir = getRepoCacheDir(repoName)
  const sharedModCacheDir = getRepoModCacheDir(repoName)
  await fsPromises.mkdir(sharedCacheDir, { recursive: true })
  await fsPromises.mkdir(sharedModCacheDir, { recursive: true })

  // Resolve pnpm store path for sharing
  const currentSettings = await loadSettings()
  const pnpmStoreDir = await resolvePnpmStorePath(currentSettings)

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
    name: generateDisplayName(repoName, slug), // e.g., "bismarck: fix-login-session-a3f7"
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
    defaultBranch: baseBranch, // Store base branch for ref-based diffing
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
  // Look up repository for completion criteria and guidance
  // Try repositoryId first, fallback to path-based lookup for legacy workspaces
  const repository = referenceAgent.repositoryId
    ? await getRepositoryById(referenceAgent.repositoryId)
    : await getRepositoryByPath(referenceAgent.directory)
  const protectedBranch = repository?.protectedBranches?.[0] || baseBranch
  const enhancedPrompt = await buildStandaloneHeadlessPrompt(prompt, worktreePath, branchName, protectedBranch, repository?.completionCriteria, repository?.guidance)

  // Run plan phase before execution (skip if caller already has a plan, e.g. from discussion)
  let executionPrompt = enhancedPrompt
  if (!startOptions?.skipPlanPhase) {
    agentInfo.status = 'planning'
    emitHeadlessAgentUpdate(agentInfo)

    const planOutputDir = path.join(getStandaloneHeadlessDir(), headlessId)
    const planResult = await runPlanPhase({
      taskDescription: prompt,
      worktreePath,
      image: selectedImage,
      planDir: getStandaloneHeadlessDir(),
      planId: referenceAgent.directory,
      guidance: repository?.guidance,
      sharedCacheDir,
      sharedModCacheDir,
      pnpmStoreDir: pnpmStoreDir || undefined,
      planOutputDir,
      enabled: true,
      onEvent: (event) => {
        emitHeadlessAgentEvent(headlessId, event)
      },
    })

    devLog(`[StandaloneHeadless] Plan phase returned`, { headlessId, success: planResult.success, durationMs: planResult.durationMs, error: planResult.error })

    if (planResult.success && planResult.plan) {
      executionPrompt = wrapPromptWithPlan(enhancedPrompt, planResult.plan)
      agentInfo.planText = planResult.plan
      emitHeadlessAgentEvent(headlessId, {
        type: 'system',
        message: `Plan phase completed (${(planResult.durationMs / 1000).toFixed(1)}s)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      devLog(`[StandaloneHeadless] Plan phase succeeded (${planResult.durationMs}ms), injecting plan into prompt`)
    } else {
      emitHeadlessAgentEvent(headlessId, {
        type: 'system',
        message: `⚠️ Plan phase failed${planResult.error ? `: ${planResult.error}` : ''} — proceeding with original prompt (no plan)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      devLog(`[StandaloneHeadless] Plan phase failed, proceeding with original prompt`, { error: planResult.error })
    }
  }

  // Update stored prompt to the full resolved version (for Eye modal display)
  agentInfo.originalPrompt = executionPrompt

  const options: HeadlessAgentOptions = {
    prompt: executionPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    planId: referenceAgent.directory, // Use reference agent directory for bd proxy
    taskId: headlessId,
    image: selectedImage,
    claudeFlags: ['--model', model],
    sharedCacheDir,
    sharedModCacheDir,
    pnpmStoreDir: pnpmStoreDir || undefined,
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
 * Wait for a standalone headless agent to complete.
 * Resolves with true if successful, false if failed.
 */
export function waitForStandaloneAgentCompletion(headlessId: string): Promise<boolean> {
  const agent = standaloneHeadlessAgents.get(headlessId)
  if (!agent) {
    // Agent not found in active map — check if it already completed
    const info = standaloneHeadlessAgentInfo.get(headlessId)
    if (info && (info.status === 'completed' || info.status === 'failed')) {
      return Promise.resolve(info.status === 'completed')
    }
    return Promise.resolve(false)
  }

  return new Promise<boolean>((resolve) => {
    agent.on('complete', (result) => {
      resolve(result.success)
    })
    agent.on('error', () => {
      resolve(false)
    })
  })
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
 * Send a nudge message to a running standalone headless agent.
 * Returns true if the nudge was sent successfully.
 */
export function nudgeStandaloneHeadlessAgent(headlessId: string, message: string): boolean {
  const agent = standaloneHeadlessAgents.get(headlessId)
  if (!agent) {
    devLog('[StandaloneHeadless] nudge: agent not found:', headlessId)
    return false
  }
  return agent.nudge(message)
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
      if (agent.status === 'planning' || agent.status === 'starting' || agent.status === 'running' || agent.status === 'stopping') {
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

  // Backfill defaultBranch for agents created before this field was added
  backfillDefaultBranches()
}

/**
 * Backfill defaultBranch for agents that don't have it set.
 * Uses Repository config (from settings) first, falls back to git detection.
 */
async function backfillDefaultBranches(): Promise<void> {
  let modified = false
  for (const agent of standaloneHeadlessAgentInfo.values()) {
    if (!agent.defaultBranch && agent.worktreeInfo?.repoPath) {
      try {
        // Try repository config first (set in settings > repositories)
        const repo = await getRepositoryByPath(agent.worktreeInfo.repoPath)
        const branch = repo?.defaultBranch || await getDefaultBranch(agent.worktreeInfo.repoPath)
        agent.defaultBranch = branch
        modified = true
        devLog(`[StandaloneHeadless] Backfilled defaultBranch=${branch} for ${agent.id}`)
        // Emit update so renderer gets the corrected branch
        emitHeadlessAgentUpdate(agent)
      } catch {
        // Repo may no longer exist, skip
      }
    }
  }
  if (modified) {
    saveStandaloneHeadlessAgentInfo()
  }
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

  // Start fresh agent with same prompt (skip plan phase - prompt already contains the plan)
  return startStandaloneHeadlessAgent(referenceWorkspace.id, originalPrompt, model, undefined, { skipPlanPhase: true })
}

/**
 * Start a follow-up agent in the same worktree
 * @returns The new headless agent ID and workspace ID
 */
export async function startFollowUpAgent(
  headlessId: string,
  prompt: string,
  model?: 'opus' | 'sonnet',
  startOptions?: { skipPlanPhase?: boolean }
): Promise<{ headlessId: string; workspaceId: string; tabId: string }> {
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

  // Ensure temp directory exists for builds (Go, etc.) to avoid filling container overlay fs
  const tmpDir = path.join(worktreePath, '.tmp')
  await fsPromises.mkdir(tmpDir, { recursive: true })

  // Extract repo name and create shared Go build cache and module cache directories
  const repoName = path.basename(repoPath)
  const sharedCacheDir = getRepoCacheDir(repoName)
  const sharedModCacheDir = getRepoModCacheDir(repoName)
  await fsPromises.mkdir(sharedCacheDir, { recursive: true })
  await fsPromises.mkdir(sharedModCacheDir, { recursive: true })

  // Resolve pnpm store path for sharing
  const followUpSettings = await loadSettings()
  const pnpmStoreDir = await resolvePnpmStorePath(followUpSettings)

  // Extract slug from branch (e.g., "bismarck-standalone/bismarck-fix-login-a3f7" -> "fix-login-a3f7")
  const branchSuffix = branch.replace('bismarck-standalone/', '').replace('standalone/', '') // handle both prefixes
  const phrase = branchSuffix.replace(`${repoName}-`, '')

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

  // Keep original workspace visible so users can reference its terminal output.
  // Place follow-up in the same tab if there's room, otherwise next available slot.
  const preferredTabId = existingWorkspace
    ? getTabForWorkspace(existingWorkspace.id)?.id
    : undefined
  const tab = getOrCreateTabForWorkspaceWithPreference(workspaceId, preferredTabId)
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
    defaultBranch: existingInfo.defaultBranch, // Preserve base branch from original agent
  }
  standaloneHeadlessAgentInfo.set(newHeadlessId, agentInfo)

  // Keep old agent info so its terminal output remains accessible

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

  // Look up repository for completion criteria and guidance
  const repository = await getRepositoryByPath(repoPath)
  const protectedBranch = repository?.protectedBranches?.[0] || defaultBranch
  const enhancedPrompt = await buildFollowUpPrompt(prompt, worktreePath, branch, protectedBranch, recentCommits, repository?.completionCriteria, repository?.guidance)

  let executionPrompt = enhancedPrompt
  if (!startOptions?.skipPlanPhase) {
    // Run plan phase before execution
    agentInfo.status = 'planning'
    emitHeadlessAgentUpdate(agentInfo)

    const followUpPlanOutputDir = path.join(getStandaloneHeadlessDir(), newHeadlessId)
    const planResult = await runPlanPhase({
      taskDescription: prompt,
      worktreePath,
      image: selectedImage,
      planDir: getStandaloneHeadlessDir(),
      planId: repoPath,
      guidance: repository?.guidance,
      sharedCacheDir,
      sharedModCacheDir,
      pnpmStoreDir: pnpmStoreDir || undefined,
      planOutputDir: followUpPlanOutputDir,
      enabled: true,
      onEvent: (event) => {
        emitHeadlessAgentEvent(newHeadlessId, event)
      },
    })

    if (planResult.success && planResult.plan) {
      executionPrompt = wrapPromptWithPlan(enhancedPrompt, planResult.plan)
      agentInfo.planText = planResult.plan
      emitHeadlessAgentEvent(newHeadlessId, {
        type: 'system',
        message: `Plan phase completed (${(planResult.durationMs / 1000).toFixed(1)}s)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      devLog(`[StandaloneHeadless] Follow-up plan phase succeeded (${planResult.durationMs}ms), injecting plan`)
    } else {
      emitHeadlessAgentEvent(newHeadlessId, {
        type: 'system',
        message: `⚠️ Plan phase failed${planResult.error ? `: ${planResult.error}` : ''} — proceeding with original prompt (no plan)`,
        timestamp: new Date().toISOString(),
      } as StreamEvent)
      devLog(`[StandaloneHeadless] Follow-up plan phase failed, proceeding with original prompt`, { error: planResult.error })
    }
  }

  // Store the full resolved prompt (for Eye modal display)
  agentInfo.originalPrompt = executionPrompt

  const options: HeadlessAgentOptions = {
    prompt: executionPrompt,
    worktreePath: worktreePath,
    planDir: getStandaloneHeadlessDir(),
    planId: repoPath, // Use repo path for bd proxy (where .beads/ directory lives)
    taskId: newHeadlessId,
    image: selectedImage,
    claudeFlags: model ? ['--model', model] : undefined,
    sharedCacheDir,
    sharedModCacheDir,
    pnpmStoreDir: pnpmStoreDir || undefined,
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

  return { headlessId: newHeadlessId, workspaceId, tabId: tab.id }
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
  model: 'opus' | 'sonnet'
}

const activeHeadlessDiscussions: Map<string, HeadlessDiscussionState> = new Map()

/**
 * Get terminal IDs of active headless discussions (including Ralph loop discussions).
 * Used to exclude these terminals from cleanup when the window closes,
 * so that discussions can complete and spawn headless agents.
 */
export function getActiveDiscussionTerminalIds(): Set<string> {
  const ids = new Set<string>()
  for (const state of activeHeadlessDiscussions.values()) {
    if (state.terminalId) {
      ids.add(state.terminalId)
    }
  }
  for (const state of activeRalphLoopDiscussions.values()) {
    if (state.terminalId) {
      ids.add(state.terminalId)
    }
  }
  return ids
}

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
  initialPrompt: string,
  maxQuestions: number = 7,
  model: 'opus' | 'sonnet' = 'sonnet'
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
    initialPrompt: initialPrompt,
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
    model,
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

    // Notify renderer that discussion is completing (show spinner)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('discussion-completing', {
        discussionId,
        workspaceId: discussionState.workspaceId,
        tabId: discussionState.tabId,
        message: 'Starting headless agent...',
      })
    }

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

    // Build prompt from discussion output - kept minimal since startStandaloneHeadlessAgent
    // applies the full standalone_headless template with proxied tools, completion criteria, etc.
    const headlessPrompt = `Implement the following requirements from a planning discussion:\n\n${discussionOutput}`

    // Start the headless agent with the discussion context (skip plan phase - discussion IS the plan)
    devLog(`[HeadlessDiscussion] Starting headless agent with discussion context`)
    const result = await startStandaloneHeadlessAgent(
      discussionState.referenceAgentId,
      headlessPrompt,
      discussionState.model, // Use model selected at discussion start
      discussionState.tabId, // Reuse the same tab
      { skipPlanPhase: true }
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

/**
 * Track active Ralph Loop discussions
 */
interface RalphLoopDiscussionState {
  discussionId: string
  workspaceId: string
  referenceAgentId: string
  tabId: string
  outputPath: string
  terminalId?: string
}

const activeRalphLoopDiscussions: Map<string, RalphLoopDiscussionState> = new Map()

/**
 * Start a Ralph Loop discussion session
 *
 * This creates an interactive Claude session to help the user craft a robust
 * Ralph Loop prompt that prevents premature exits and ensures task completion.
 *
 * @param referenceAgentId - The agent whose directory will be used as the working directory
 * @param maxQuestions - Maximum number of questions to ask (default: 5)
 * @returns Discussion session info
 */
export async function startRalphLoopDiscussion(
  referenceAgentId: string,
  initialPrompt: string,
  maxQuestions: number = 5
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
  const discussionId = `ralph-loop-discussion-${Date.now()}`
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
  const discussionPrompt = await buildPrompt('ralph_loop_discussion', {
    referenceRepoName: repoName,
    codebasePath: referenceAgent.directory,
    maxQuestions: maxQuestions,
    discussionOutputPath: discussionOutputPath,
    initialPrompt: initialPrompt,
  })

  // Create discussion workspace
  const existingWorkspaces = getWorkspaces()
  const discussionWorkspace: Agent = {
    id: workspaceId,
    name: `🔄 ${repoName}: ${randomPhrase}`,
    directory: referenceAgent.directory,
    purpose: 'Crafting Ralph Loop prompt',
    theme: 'orange',
    icon: getRandomUniqueIcon(existingWorkspaces),
  }
  saveWorkspace(discussionWorkspace)

  // Create a dedicated tab for the discussion
  const discussionTab = createTab(`🔄 ${repoName.substring(0, 15)}`)

  // Store discussion state
  const discussionState: RalphLoopDiscussionState = {
    discussionId,
    workspaceId,
    referenceAgentId,
    tabId: discussionTab.id,
    outputPath: discussionOutputPath,
  }
  activeRalphLoopDiscussions.set(discussionId, discussionState)

  try {
    // Create terminal for discussion
    console.log(`[RalphLoopDiscussion] Creating terminal for discussion ${discussionId}`)
    const claudeFlags = `--add-dir "${referenceAgent.directory}"`
    const terminalId = await queueTerminalCreation(workspaceId, mainWindow, {
      initialPrompt: discussionPrompt,
      claudeFlags,
    })
    discussionState.terminalId = terminalId
    console.log(`[RalphLoopDiscussion] Created discussion terminal: ${terminalId}`)

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
        if (data.includes('discussion-output.md') && (data.includes('Wrote') || data.includes('lines to'))) {
          // Verify file exists before completing
          try {
            await fsPromises.access(discussionOutputPath)
            completionTriggered = true
            discussionEmitter.removeListener('data', dataHandler)
            console.log(`[RalphLoopDiscussion] Discussion complete, output written to ${discussionOutputPath}`)
            await completeRalphLoopDiscussion(discussionId)
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
    activeRalphLoopDiscussions.delete(discussionId)
    deleteWorkspace(workspaceId)
    throw error
  }
}

/**
 * Complete a Ralph Loop discussion and open the Ralph Loop config with pre-populated values
 */
async function completeRalphLoopDiscussion(discussionId: string): Promise<void> {
  const discussionState = activeRalphLoopDiscussions.get(discussionId)
  if (!discussionState) {
    console.error(`[RalphLoopDiscussion] Discussion not found: ${discussionId}`)
    return
  }

  try {
    // Read the discussion output
    const discussionOutput = await fsPromises.readFile(discussionState.outputPath, 'utf-8')
    console.log(`[RalphLoopDiscussion] Read discussion output (${discussionOutput.length} chars)`)

    // Parse the discussion output to extract Ralph Loop config
    const config = parseRalphLoopDiscussionOutput(discussionOutput)

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

    // Notify renderer to open Ralph Loop config with pre-populated values
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ralph-loop-discussion-complete', {
        referenceAgentId: discussionState.referenceAgentId,
        prompt: config.prompt,
        completionPhrase: config.completionPhrase,
        maxIterations: config.maxIterations,
        model: config.model,
      })
    }

    // Clean up discussion state
    activeRalphLoopDiscussions.delete(discussionId)
    // Also delete the tab since we're opening CMD-K instead
    deleteTab(discussionState.tabId)

  } catch (error) {
    console.error(`[RalphLoopDiscussion] Failed to complete discussion:`, error)
    activeRalphLoopDiscussions.delete(discussionId)
    throw error
  }
}

/**
 * Parse the Ralph Loop discussion output to extract config values
 */
function parseRalphLoopDiscussionOutput(output: string): {
  prompt: string
  completionPhrase: string
  maxIterations: number
  model: 'opus' | 'sonnet'
} {
  // Default values
  let prompt = ''
  let completionPhrase = '<promise>COMPLETE</promise>'
  let maxIterations = 50
  let model: 'opus' | 'sonnet' = 'sonnet'

  // Extract prompt section (most important)
  const promptMatch = output.match(/## Prompt\s*\n([\s\S]*?)(?=\n## |$)/)
  if (promptMatch) {
    prompt = promptMatch[1].trim()
  } else {
    // Fallback: use the goal as prompt if no Prompt section found
    const goalMatch = output.match(/## Goal\s*\n([\s\S]*?)(?=\n## |$)/)
    if (goalMatch) {
      prompt = goalMatch[1].trim()
    }
  }

  // Extract completion phrase
  const phraseMatch = output.match(/## Completion Phrase\s*\n([\s\S]*?)(?=\n## |$)/)
  if (phraseMatch) {
    const phraseText = phraseMatch[1].trim()
    // Try to find the exact phrase (often in backticks or quotes)
    const exactMatch = phraseText.match(/[`"']([^`"']+)[`"']/) || phraseText.match(/<[^>]+>[^<]*<\/[^>]+>/)
    if (exactMatch) {
      completionPhrase = exactMatch[0].replace(/[`"']/g, '')
    } else if (phraseText.length < 100) {
      completionPhrase = phraseText.split('\n')[0].trim()
    }
  }

  // Extract suggested iterations
  const iterationsMatch = output.match(/## Suggested Iterations\s*\n([\s\S]*?)(?=\n## |$)/)
  if (iterationsMatch) {
    const iterText = iterationsMatch[1].trim()
    const numMatch = iterText.match(/(\d+)/)
    if (numMatch) {
      const parsed = parseInt(numMatch[1], 10)
      if (parsed >= 1 && parsed <= 500) {
        maxIterations = parsed
      }
    }
  }

  // Extract recommended model
  const modelMatch = output.match(/## Recommended Model\s*\n([\s\S]*?)(?=\n## |$)/)
  if (modelMatch) {
    const modelText = modelMatch[1].toLowerCase()
    if (modelText.includes('opus')) {
      model = 'opus'
    } else if (modelText.includes('sonnet')) {
      model = 'sonnet'
    }
  }

  return { prompt, completionPhrase, maxIterations, model }
}

/**
 * Cancel a Ralph Loop discussion
 */
export async function cancelRalphLoopDiscussion(discussionId: string): Promise<void> {
  const discussionState = activeRalphLoopDiscussions.get(discussionId)
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
  activeRalphLoopDiscussions.delete(discussionId)

  emitStateUpdate()
}
