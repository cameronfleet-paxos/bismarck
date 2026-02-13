/**
 * Ralph Loop
 *
 * Manages iterative Claude agent loops that run until a completion phrase
 * is detected or max iterations reached. Each iteration runs in a fresh
 * Docker container with a shared worktree, and all iterations are displayed
 * in a dedicated tab.
 *
 * Based on best practices from:
 * - https://awesomeclaude.ai/ralph-wiggum
 * - https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md
 * - https://ghuntley.com/loop
 */

import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { devLog } from './dev-log'
import {
  getStandaloneHeadlessDir,
  getStandaloneWorktreePath,
  getWorkspaceById,
  saveWorkspace,
  deleteWorkspace,
  writeConfigAtomic,
  getRandomUniqueIcon,
  getWorkspaces,
  getRepoCacheDir,
  getRepoModCacheDir,
} from './config'
import { HeadlessAgent, HeadlessAgentOptions } from './headless'
import { createTab, addWorkspaceToTab, setActiveTab, getState } from './state-manager'
import { getSelectedDockerImage, loadSettings } from './settings-manager'
import { buildProxiedToolsSection } from './prompt-templates'
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
import type {
  Agent,
  RalphLoopConfig,
  RalphLoopState,
  RalphLoopStatus,
  RalphLoopIteration,
  StreamEvent,
  StandaloneWorktreeInfo,
  HeadlessAgentStatus,
  RalphLoopGitSummary,
} from '../shared/types'
import { execWithPath } from './exec-utils'
import * as fsPromises from 'fs/promises'

// Word lists for fun random names (same as standalone-headless)
const ADJECTIVES = [
  'fluffy', 'happy', 'brave', 'swift', 'clever', 'gentle', 'mighty', 'calm',
  'wild', 'eager', 'jolly', 'lucky', 'plucky', 'zesty', 'snappy', 'peppy'
]

const NOUNS = [
  'bunny', 'panda', 'koala', 'otter', 'falcon', 'dolphin', 'fox', 'owl',
  'tiger', 'eagle', 'wolf', 'bear', 'hawk', 'lynx', 'raven', 'seal'
]

/**
 * Generate a fun, memorable random phrase
 * Format: {adjective}-{noun} (e.g., "plucky-otter")
 */
function generateRandomPhrase(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adjective}-${noun}`
}

// Track active Ralph Loops
const ralphLoops: Map<string, RalphLoopState> = new Map()
const ralphLoopAgents: Map<string, HeadlessAgent> = new Map() // loopId -> current agent
const completionWaiters: Map<string, Array<(status: RalphLoopStatus) => void>> = new Map()

// Reference to main window for IPC
let mainWindow: BrowserWindow | null = null

export function setMainWindowForRalphLoop(window: BrowserWindow | null): void {
  mainWindow = window
}

/**
 * Get the Ralph Loop storage directory
 */
function getRalphLoopDir(): string {
  return path.join(getStandaloneHeadlessDir(), 'ralph-loops')
}

/**
 * Get path to Ralph Loop state file
 */
function getRalphLoopStatePath(): string {
  return path.join(getRalphLoopDir(), 'ralph-loops.json')
}

/**
 * Ensure Ralph Loop directory exists
 */
function ensureRalphLoopDir(): void {
  const dir = getRalphLoopDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Load Ralph Loop states from disk
 */
export function loadRalphLoopStates(): RalphLoopState[] {
  const statePath = getRalphLoopStatePath()
  try {
    const content = fs.readFileSync(statePath, 'utf-8')
    return JSON.parse(content) as RalphLoopState[]
  } catch {
    return []
  }
}

/**
 * Save Ralph Loop states to disk
 */
function saveRalphLoopStates(): void {
  ensureRalphLoopDir()
  const states = Array.from(ralphLoops.values())
  writeConfigAtomic(getRalphLoopStatePath(), states)
}

let onStatusChangeCallback: ((loopId: string, status: string) => void) | null = null

export function onRalphLoopStatusChange(cb: (loopId: string, status: string) => void): void {
  onStatusChangeCallback = cb
}

/**
 * Emit Ralph Loop update to renderer
 */
function emitRalphLoopUpdate(state: RalphLoopState): void {
  saveRalphLoopStates()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ralph-loop-update', state)
  }
  onStatusChangeCallback?.(state.id, state.status)

  // Resolve any completion waiters if the loop reached a terminal status
  const terminalStatuses: RalphLoopStatus[] = ['completed', 'failed', 'cancelled', 'max_iterations']
  if (terminalStatuses.includes(state.status)) {
    const waiters = completionWaiters.get(state.id)
    if (waiters) {
      for (const resolve of waiters) {
        resolve(state.status)
      }
      completionWaiters.delete(state.id)
    }
  }
}

/**
 * Emit Ralph Loop event to renderer
 */
function emitRalphLoopEvent(loopId: string, iterationNumber: number, event: StreamEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ralph-loop-event', { loopId, iterationNumber, event })
  }
}

/**
 * Emit state update to renderer
 */
function emitStateUpdate(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const { getState } = require('./state-manager')
    mainWindow.webContents.send('state-update', getState())
  }
}

/**
 * Update git summary for a Ralph Loop
 * Fetches commits since main/master and any PRs created from the worktree branch
 */
async function updateGitSummary(state: RalphLoopState): Promise<void> {
  try {
    const { worktreeInfo } = state
    if (!worktreeInfo?.path || !worktreeInfo?.branch) {
      return
    }

    // Get commits since the default branch
    const defaultBranch = await getDefaultBranch(worktreeInfo.repoPath)
    const commits = await getCommitsBetween(
      worktreeInfo.path,
      `origin/${defaultBranch}`,
      'HEAD'
    )

    // Get PRs for this branch using gh CLI
    const pullRequests: RalphLoopGitSummary['pullRequests'] = []
    try {
      const { stdout } = await execWithPath(
        `gh pr list --head "${worktreeInfo.branch}" --json number,title,url,baseRefName,state --limit 10`,
        { cwd: worktreeInfo.repoPath }
      )
      const prs = JSON.parse(stdout)
      for (const pr of prs) {
        pullRequests.push({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          baseBranch: pr.baseRefName,
          status: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
        })
      }
    } catch {
      // gh CLI may not be available or auth issues - ignore
    }

    state.gitSummary = {
      branch: worktreeInfo.branch,
      commits,
      pullRequests,
    }

    console.log(`[RalphLoop] Git summary updated: ${commits.length} commits, ${pullRequests.length} PRs`)
  } catch (error) {
    console.error('[RalphLoop] Failed to update git summary:', error)
  }
}

/**
 * Build the prompt for a Ralph Loop iteration
 */
function buildRalphLoopPrompt(
  userPrompt: string,
  workingDir: string,
  branchName: string,
  iterationNumber: number,
  maxIterations: number,
  completionPhrase: string,
  enabledTools: { git: boolean; gh: boolean; bd: boolean; bb?: boolean }
): string {
  const proxiedToolsSection = buildProxiedToolsSection(enabledTools)

  return `[RALPH LOOP - ITERATION ${iterationNumber}/${maxIterations}]

Working Directory: ${workingDir}
Branch: ${branchName}

=== ENVIRONMENT ===
You are running in a Docker container with:
- Working directory: /workspace (your git worktree for this task)
- Tool proxy: commands are transparently proxied to the host

${proxiedToolsSection}

=== YOUR TASK ===
${userPrompt}

=== ITERATION CONTEXT ===
This is iteration ${iterationNumber} of a maximum ${maxIterations} iterations.
${iterationNumber > 1 ? `
IMPORTANT: Previous iterations have already worked on this task.
Run 'git log --oneline -10' to see what commits have been made.
Review the commit history to understand what has been done and what still needs to be completed.
` : ''}

=== COMPLETION PROTOCOL ===
When the task is FULLY COMPLETE and verified:
1. Output exactly: ${completionPhrase}
2. This EXACT phrase signals that the loop should stop

IMPORTANT:
- Only output the completion phrase when ALL work is done
- If there's more work to do, explain what remains and the next iteration will continue
- Make commits after completing meaningful chunks of work
- Each commit provides context for subsequent iterations

=== GIT WORKFLOW ===
1. Commit your changes:
   git add <files>
   git commit -m "Brief description of change"

2. Push your branch periodically:
   git push -u origin ${branchName}

Type /exit when you have completed your work for this iteration.`
}

/**
 * Check if the completion phrase is present in the events
 */
function checkForCompletionPhrase(events: StreamEvent[], completionPhrase: string): boolean {
  for (const event of events) {
    // Check message events
    if (event.type === 'message' || event.type === 'assistant') {
      const content = (event as any).content
      if (typeof content === 'string' && content.includes(completionPhrase)) {
        return true
      }
    }
    // Check result events
    if (event.type === 'result') {
      const result = (event as any).result
      if (typeof result === 'string' && result.includes(completionPhrase)) {
        return true
      }
    }
  }
  return false
}

/**
 * Start a new Ralph Loop
 */
export async function startRalphLoop(config: RalphLoopConfig): Promise<RalphLoopState> {
  // Look up the reference agent to get its directory
  const referenceAgent = getWorkspaceById(config.referenceAgentId)
  if (!referenceAgent) {
    throw new Error(`Reference agent not found: ${config.referenceAgentId}`)
  }

  // Generate unique IDs
  const loopId = `ralph-loop-${Date.now()}`
  const phrase = generateRandomPhrase()

  // Get repository info
  const repoPath = await getMainRepoRoot(referenceAgent.directory)
  if (!repoPath) {
    throw new Error(`Reference agent directory is not in a git repository: ${referenceAgent.directory}`)
  }
  const repoName = path.basename(repoPath)

  // Get default branch as base for worktree
  const baseBranch = await getDefaultBranch(repoPath)

  // Generate branch and worktree paths
  const branchName = `ralph/${repoName}-${phrase}`
  const worktreePath = getStandaloneWorktreePath(repoName, `ralph-${phrase}`)

  // Ensure directory exists
  ensureRalphLoopDir()

  // Ensure tool proxy is running
  if (!isProxyRunning()) {
    devLog('[RalphLoop] Starting tool proxy for container communication')
    await startToolProxy()
  }

  // Create the worktree (shared by ALL iterations)
  devLog(`[RalphLoop] Creating worktree at ${worktreePath}`)
  await createWorktree(repoPath, worktreePath, branchName, baseBranch)

  // Create shared Go build cache and module cache directories for this repo
  const sharedCacheDir = getRepoCacheDir(repoName)
  const sharedModCacheDir = getRepoModCacheDir(repoName)
  await fsPromises.mkdir(sharedCacheDir, { recursive: true })
  await fsPromises.mkdir(sharedModCacheDir, { recursive: true })

  // Store worktree info
  const worktreeInfo: StandaloneWorktreeInfo = {
    path: worktreePath,
    branch: branchName,
    repoPath: repoPath,
  }

  // Use existing tab if provided (e.g., from cron automation), otherwise create a new one
  const tab = config.tabId
    ? (getState().tabs.find(t => t.id === config.tabId) || createTab(`Ralph: ${phrase}`))
    : createTab(`Ralph: ${phrase}`)
  if (!config.tabId) {
    tab.isPlanTab = true // Treat like a plan tab for styling
  }

  // Create the initial state
  const state: RalphLoopState = {
    id: loopId,
    config,
    status: 'pending',
    iterations: [],
    currentIteration: 0,
    startedAt: new Date().toISOString(),
    worktreeInfo,
    workspaceId: '', // Will be set when first iteration starts
    tabId: tab.id,
    phrase,
    referenceAgentDirectory: referenceAgent.directory, // For bd proxy planId
  }

  // Store state
  ralphLoops.set(loopId, state)
  saveRalphLoopStates()

  // Emit initial state
  emitRalphLoopUpdate(state)
  emitStateUpdate()

  // Start the loop
  executeLoop(state)

  return state
}

/**
 * Main loop execution - runs iterations until completion
 */
async function executeLoop(state: RalphLoopState): Promise<void> {
  state.status = 'running'
  emitRalphLoopUpdate(state)

  while (
    state.status === 'running' &&
    state.currentIteration < state.config.maxIterations
  ) {
    // Run next iteration
    state.currentIteration++
    devLog(`[RalphLoop] Starting iteration ${state.currentIteration}/${state.config.maxIterations}`)

    const iteration = await runIteration(state, state.currentIteration)
    // Note: iteration is already added to state.iterations inside runIteration

    // Accumulate costs
    if (iteration.cost) {
      if (!state.totalCost) {
        state.totalCost = { input_tokens: 0, output_tokens: 0, total_cost_usd: 0 }
      }
      state.totalCost.input_tokens += iteration.cost.input_tokens
      state.totalCost.output_tokens += iteration.cost.output_tokens
      if (iteration.cost.total_cost_usd && state.totalCost.total_cost_usd !== undefined) {
        state.totalCost.total_cost_usd += iteration.cost.total_cost_usd
      }
    }

    // Update git summary after each iteration
    await updateGitSummary(state)

    emitRalphLoopUpdate(state)

    // Check if completion phrase was found
    if (iteration.completionPhraseFound) {
      devLog(`[RalphLoop] Completion phrase found in iteration ${state.currentIteration}`)
      state.status = 'completed'
      state.completedAt = new Date().toISOString()
      emitRalphLoopUpdate(state)
      return
    }

    // Check if iteration failed
    if (iteration.status === 'failed') {
      devLog(`[RalphLoop] Iteration ${state.currentIteration} failed`)
      state.status = 'failed'
      state.completedAt = new Date().toISOString()
      emitRalphLoopUpdate(state)
      return
    }
  }

  // Max iterations reached
  if (state.status === 'running') {
    devLog(`[RalphLoop] Max iterations (${state.config.maxIterations}) reached`)
    state.status = 'max_iterations'
    state.completedAt = new Date().toISOString()
    emitRalphLoopUpdate(state)
  }
}

/**
 * Run a single iteration
 */
async function runIteration(state: RalphLoopState, iterationNumber: number): Promise<RalphLoopIteration> {
  const iteration: RalphLoopIteration = {
    iterationNumber,
    status: 'pending',
    events: [],
    startedAt: new Date().toISOString(),
    completionPhraseFound: false,
  }

  try {
    // Create a workspace for this iteration
    const workspaceId = randomUUID()
    const existingWorkspaces = getWorkspaces()
    const repoName = path.basename(state.worktreeInfo.repoPath)

    const workspace: Agent = {
      id: workspaceId,
      name: `Ralph: ${state.phrase} (iter ${iterationNumber})`,
      directory: state.worktreeInfo.path,
      purpose: state.config.prompt.substring(0, 100) + (state.config.prompt.length > 100 ? '...' : ''),
      theme: 'purple', // Use purple theme for Ralph loops
      icon: getRandomUniqueIcon(existingWorkspaces),
      isHeadless: true,
      isStandaloneHeadless: true,
      taskId: `${state.id}-iter-${iterationNumber}`,
      worktreePath: state.worktreeInfo.path,
    }

    saveWorkspace(workspace)
    iteration.workspaceId = workspaceId

    // Set the base workspace ID from first iteration
    if (iterationNumber === 1) {
      state.workspaceId = workspaceId
    }

    // Add workspace to the Ralph Loop's dedicated tab
    addWorkspaceToTab(workspaceId, state.tabId)
    setActiveTab(state.tabId)
    emitStateUpdate()

    // Add iteration to state BEFORE starting so renderer can see it
    state.iterations.push(iteration)

    // Update iteration status
    iteration.status = 'running'
    emitRalphLoopUpdate(state)

    // Create and start headless agent
    const agent = new HeadlessAgent()
    ralphLoopAgents.set(state.id, agent)

    // Set up event listeners
    agent.on('event', (event: StreamEvent) => {
      iteration.events.push(event)
      emitRalphLoopEvent(state.id, iterationNumber, event)

      // Check for completion phrase in real-time
      if (!iteration.completionPhraseFound) {
        iteration.completionPhraseFound = checkForCompletionPhrase([event], state.config.completionPhrase)
      }
    })

    // Build the prompt with enabled tools
    const selectedImage = await getSelectedDockerImage()
    const settings = await loadSettings()
    const proxiedTools = settings.docker.proxiedTools
    const enabledTools = {
      git: proxiedTools.find(t => t.name === 'git')?.enabled ?? true,
      gh: proxiedTools.find(t => t.name === 'gh')?.enabled ?? true,
      bd: proxiedTools.find(t => t.name === 'bd')?.enabled ?? true,
      bb: proxiedTools.find(t => t.name === 'bb')?.enabled ?? false,
    }
    const enhancedPrompt = buildRalphLoopPrompt(
      state.config.prompt,
      state.worktreeInfo.path,
      state.worktreeInfo.branch,
      iterationNumber,
      state.config.maxIterations,
      state.config.completionPhrase,
      enabledTools
    )

    // Derive shared cache dirs from repo path
    const iterRepoName = path.basename(state.worktreeInfo.repoPath)
    const sharedCacheDir = getRepoCacheDir(iterRepoName)
    const sharedModCacheDir = getRepoModCacheDir(iterRepoName)

    const options: HeadlessAgentOptions = {
      prompt: enhancedPrompt,
      worktreePath: state.worktreeInfo.path,
      planDir: getRalphLoopDir(),
      planId: state.referenceAgentDirectory, // Use reference agent directory for bd proxy
      taskId: `${state.id}-iter-${iterationNumber}`,
      image: selectedImage,
      claudeFlags: ['--model', state.config.model],
      sharedCacheDir,
      sharedModCacheDir,
    }

    devLog(`[RalphLoop] Starting iteration ${iterationNumber} agent`)

    // Wait for agent to complete
    await new Promise<void>((resolve, reject) => {
      agent.on('complete', (result) => {
        iteration.status = result.success ? 'completed' : 'failed'
        iteration.completedAt = new Date().toISOString()
        iteration.cost = result.cost
        iteration.duration_ms = result.duration_ms

        // Final check for completion phrase
        if (!iteration.completionPhraseFound) {
          iteration.completionPhraseFound = checkForCompletionPhrase(
            iteration.events,
            state.config.completionPhrase
          )
        }

        ralphLoopAgents.delete(state.id)
        resolve()
      })

      agent.on('error', (error: Error) => {
        iteration.status = 'failed'
        iteration.completedAt = new Date().toISOString()
        ralphLoopAgents.delete(state.id)
        reject(error)
      })

      agent.start(options).catch(reject)
    })

  } catch (error) {
    console.error(`[RalphLoop] Iteration ${iterationNumber} error:`, error)
    iteration.status = 'failed'
    iteration.completedAt = new Date().toISOString()
  }

  return iteration
}

/**
 * Cancel a running Ralph Loop
 */
export async function cancelRalphLoop(loopId: string): Promise<void> {
  const state = ralphLoops.get(loopId)
  if (!state) {
    throw new Error(`Ralph Loop not found: ${loopId}`)
  }

  devLog(`[RalphLoop] Cancelling loop ${loopId}`)

  // Stop current agent if running
  const agent = ralphLoopAgents.get(loopId)
  if (agent) {
    await agent.stop()
    ralphLoopAgents.delete(loopId)
  }

  // Update state
  state.status = 'cancelled'
  state.completedAt = new Date().toISOString()
  emitRalphLoopUpdate(state)
}

/**
 * Pause a running Ralph Loop (stops after current iteration completes)
 */
export function pauseRalphLoop(loopId: string): void {
  const state = ralphLoops.get(loopId)
  if (!state) {
    throw new Error(`Ralph Loop not found: ${loopId}`)
  }

  if (state.status !== 'running') {
    throw new Error(`Cannot pause loop in status: ${state.status}`)
  }

  devLog(`[RalphLoop] Pausing loop ${loopId}`)
  state.status = 'paused'
  emitRalphLoopUpdate(state)
}

/**
 * Resume a paused Ralph Loop
 */
export function resumeRalphLoop(loopId: string): void {
  const state = ralphLoops.get(loopId)
  if (!state) {
    throw new Error(`Ralph Loop not found: ${loopId}`)
  }

  if (state.status !== 'paused') {
    throw new Error(`Cannot resume loop in status: ${state.status}`)
  }

  devLog(`[RalphLoop] Resuming loop ${loopId}`)
  state.status = 'running'
  emitRalphLoopUpdate(state)

  // Continue execution
  executeLoop(state)
}

/**
 * Retry a failed Ralph Loop - continues from where it left off on the same worktree
 */
export async function retryRalphLoop(loopId: string): Promise<void> {
  const state = ralphLoops.get(loopId)
  if (!state) {
    throw new Error(`Ralph Loop not found: ${loopId}`)
  }

  if (state.status !== 'failed') {
    throw new Error(`Cannot retry loop in status: ${state.status}`)
  }

  // Ensure tool proxy is running (may have stopped since the loop failed)
  if (!isProxyRunning()) {
    devLog('[RalphLoop] Starting tool proxy for retry')
    await startToolProxy()
  }

  devLog(`[RalphLoop] Retrying failed loop ${loopId} from iteration ${state.currentIteration}`)
  state.completedAt = undefined
  emitRalphLoopUpdate(state)

  // Continue execution (executeLoop sets status to 'running' and increments currentIteration)
  executeLoop(state)
}

/**
 * Wait for a Ralph Loop to reach a terminal status.
 * Resolves with true if completed successfully, false otherwise.
 */
export function waitForRalphLoopCompletion(loopId: string): Promise<boolean> {
  const state = ralphLoops.get(loopId)
  if (!state) return Promise.resolve(false)

  // Already in a terminal state
  const terminalStatuses: RalphLoopStatus[] = ['completed', 'failed', 'cancelled', 'max_iterations']
  if (terminalStatuses.includes(state.status)) {
    return Promise.resolve(state.status === 'completed')
  }

  return new Promise<boolean>((resolve) => {
    const waiters = completionWaiters.get(loopId) || []
    waiters.push((status) => resolve(status === 'completed'))
    completionWaiters.set(loopId, waiters)
  })
}

/**
 * Get Ralph Loop state by ID
 */
export function getRalphLoopState(loopId: string): RalphLoopState | undefined {
  return ralphLoops.get(loopId)
}

/**
 * Get all Ralph Loop states
 */
export function getAllRalphLoops(): RalphLoopState[] {
  return Array.from(ralphLoops.values())
}

/**
 * Get Ralph Loop state by tab ID
 */
export function getRalphLoopByTabId(tabId: string): RalphLoopState | undefined {
  for (const state of ralphLoops.values()) {
    if (state.tabId === tabId) {
      return state
    }
  }
  return undefined
}

/**
 * Clean up a Ralph Loop's worktree, branches, and workspaces
 */
export async function cleanupRalphLoop(loopId: string): Promise<void> {
  const state = ralphLoops.get(loopId)
  if (!state) {
    throw new Error(`Ralph Loop not found: ${loopId}`)
  }

  devLog(`[RalphLoop] Cleaning up loop ${loopId}`)

  const { path: worktreePath, branch, repoPath } = state.worktreeInfo

  // Stop any running agent
  const agent = ralphLoopAgents.get(loopId)
  if (agent) {
    await agent.stop()
    ralphLoopAgents.delete(loopId)
  }

  // Delete all iteration workspaces
  for (const iteration of state.iterations) {
    if (iteration.workspaceId) {
      deleteWorkspace(iteration.workspaceId)
    }
  }

  // Remove the worktree
  try {
    await removeWorktree(repoPath, worktreePath, true)
    devLog(`[RalphLoop] Removed worktree at ${worktreePath}`)
  } catch (error) {
    console.error(`[RalphLoop] Failed to remove worktree:`, error)
  }

  // Delete the local branch
  try {
    await deleteLocalBranch(repoPath, branch)
    devLog(`[RalphLoop] Deleted local branch ${branch}`)
  } catch (error) {
    devLog(`[RalphLoop] Local branch ${branch} may already be deleted:`, error)
  }

  // Delete the remote branch if it exists
  try {
    if (await remoteBranchExists(repoPath, branch)) {
      await deleteRemoteBranch(repoPath, branch)
      devLog(`[RalphLoop] Deleted remote branch ${branch}`)
    }
  } catch (error) {
    console.error(`[RalphLoop] Failed to delete remote branch:`, error)
  }

  // Remove state
  ralphLoops.delete(loopId)
  saveRalphLoopStates()

  emitStateUpdate()
}

/**
 * Initialize Ralph Loop module - load persisted states
 */
export function initRalphLoop(): void {
  const states = loadRalphLoopStates()
  const currentState = getState()

  for (const state of states) {
    ralphLoops.set(state.id, state)

    // Restore workspace-to-tab relationships for Ralph Loop iterations
    // The tab should still exist from state.json, but workspaces may not be associated
    const tabExists = currentState.tabs.some((t) => t.id === state.tabId)
    if (tabExists) {
      for (const iteration of state.iterations) {
        if (iteration.workspaceId) {
          // addWorkspaceToTab is idempotent - it checks if already present
          addWorkspaceToTab(iteration.workspaceId, state.tabId)
        }
      }
    }
    // Note: Running loops are not resumed on restart - they stay in their current state
    // User can manually resume paused loops or clean up completed/failed ones
  }
  devLog(`[RalphLoop] Loaded ${states.length} Ralph Loop records`)
}
