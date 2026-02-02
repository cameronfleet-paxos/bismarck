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
  getWorkspaceById,
  saveWorkspace,
  writeConfigAtomic,
  getRandomUniqueIcon,
  getWorkspaces,
} from './config'
import { HeadlessAgent, HeadlessAgentOptions } from './headless-agent'
import { getOrCreateTabForWorkspace, addWorkspaceToTab, setActiveTab } from './state-manager'
import { getSelectedDockerImage } from './settings-manager'
import type { Agent, HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent } from '../shared/types'

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
function buildStandaloneHeadlessPrompt(userPrompt: string, workingDir: string): string {
  return `[STANDALONE HEADLESS AGENT]

Working Directory: ${workingDir}

=== YOUR TASK ===
${userPrompt}

=== COMPLETION REQUIREMENTS ===
When you complete your work:

1. Create a new branch for your changes
2. Commit your changes with a clear, descriptive message
3. Push your branch and create a PR:
   gh pr create --fill
4. Report the PR URL in your final message

Type /exit when finished.`
}

/**
 * Start a standalone headless agent
 *
 * @param referenceAgentId - The agent whose directory will be used as the working directory
 * @param prompt - The prompt to send to the agent
 * @returns The headless agent ID and workspace ID
 */
export async function startStandaloneHeadlessAgent(
  referenceAgentId: string,
  prompt: string
): Promise<{ headlessId: string; workspaceId: string }> {
  // Look up the reference agent to get its directory
  const referenceAgent = getWorkspaceById(referenceAgentId)
  if (!referenceAgent) {
    throw new Error(`Reference agent not found: ${referenceAgentId}`)
  }

  // Generate unique IDs
  const headlessId = `standalone-headless-${Date.now()}`
  const workspaceId = randomUUID()

  // Create a new Agent workspace for the headless agent
  const existingWorkspaces = getWorkspaces()
  const newAgent: Agent = {
    id: workspaceId,
    name: `Headless (${referenceAgent.name})`,
    directory: referenceAgent.directory,
    purpose: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
    theme: referenceAgent.theme,
    icon: getRandomUniqueIcon(existingWorkspaces),
    isHeadless: true,
    isStandaloneHeadless: true,
    taskId: headlessId,
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
    worktreePath: referenceAgent.directory,
    events: [],
    startedAt: new Date().toISOString(),
  }
  standaloneHeadlessAgentInfo.set(headlessId, agentInfo)

  // Emit initial state
  emitHeadlessAgentUpdate(agentInfo)

  // Emit started event
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-started', {
      taskId: headlessId,
      planId: 'standalone',
      worktreePath: referenceAgent.directory,
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
  ensureStandaloneHeadlessDir()
  const selectedImage = await getSelectedDockerImage()
  const enhancedPrompt = buildStandaloneHeadlessPrompt(prompt, referenceAgent.directory)
  const options: HeadlessAgentOptions = {
    prompt: enhancedPrompt,
    worktreePath: referenceAgent.directory,
    planDir: getStandaloneHeadlessDir(),
    taskId: headlessId,
    image: selectedImage,
  }

  try {
    await agent.start(options)
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    standaloneHeadlessAgents.delete(headlessId)
    standaloneHeadlessAgentInfo.delete(headlessId)

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
