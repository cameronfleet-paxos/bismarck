/**
 * Dev Test Harness
 *
 * Testing tool for the headless agent flow that mocks:
 * - Plan creation (uses fake plan with preset tasks)
 * - Orchestrator (marks tasks ready, monitors completion)
 * - Task agents (emits fake stream-json events)
 *
 * What's real:
 * - Beads tasks (uses actual `bd` commands)
 * - HeadlessTerminal UI
 * - IPC events
 *
 * Usage:
 *   // From renderer dev console (Cmd+Shift+D)
 *   window.electronAPI.devRunMockFlow()
 *   window.electronAPI.devStartMockAgent('test-task-1')
 *
 *   // Environment override
 *   BISMARCK_MOCK_AGENTS=true
 */

import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { execWithPath } from './exec-utils'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { devLog } from './dev-log'
import type {
  StreamEvent,
  StreamInitEvent,
  StreamMessageEvent,
  StreamToolUseEvent,
  StreamToolResultEvent,
  StreamResultEvent,
  HeadlessAgentInfo,
  HeadlessAgentStatus,
  Plan,
} from '../shared/types'
import { createTab, addWorkspaceToTab, getState, setActiveTab } from './state-manager'
import { savePlan } from './config'
import { registerHeadlessAgentInfo, emitHeadlessAgentUpdatePublic, emitHeadlessAgentEventPublic } from './plan-manager'
import { HeadlessAgent } from './headless-agent'
import { MOCK_IMAGE, checkImageExists } from './docker-sandbox'

// Use shared exec utility with extended PATH for bd commands
const execAsync = execWithPath

// ============================================
// Mock Event Sequences
// ============================================

/**
 * Generates a realistic sequence of mock stream events
 */
function generateMockEventSequence(taskId: string): StreamEvent[] {
  const now = () => new Date().toISOString()

  return [
    // 1. System init
    {
      type: 'init',
      timestamp: now(),
      session_id: `mock-session-${taskId}`,
      model: 'claude-sonnet-4-20250514',
    } as StreamInitEvent,

    // 2. Assistant thinking
    {
      type: 'message',
      timestamp: now(),
      content: `I'll help with task ${taskId}. Let me start by reading the relevant files...`,
      role: 'assistant',
    } as StreamMessageEvent,

    // 3. Read file
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Read',
      tool_id: `tool-${Date.now()}-1`,
      input: { file_path: '/workspace/src/main.ts' },
    } as StreamToolUseEvent,

    // 4. Read result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-1`,
      output: '// Main entry point\nimport { app } from "electron"\n\napp.whenReady().then(() => {\n  devLog("App ready")\n})',
      is_error: false,
    } as StreamToolResultEvent,

    // 5. Assistant continues
    {
      type: 'message',
      timestamp: now(),
      content: 'I can see the main entry point. Now I\'ll make the necessary changes...',
      role: 'assistant',
    } as StreamMessageEvent,

    // 6. Edit file
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Edit',
      tool_id: `tool-${Date.now()}-2`,
      input: {
        file_path: '/workspace/src/main.ts',
        old_string: 'devLog("App ready")',
        new_string: 'devLog("App ready - Task complete!")',
      },
    } as StreamToolUseEvent,

    // 7. Edit result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-2`,
      output: 'Successfully edited file',
      is_error: false,
    } as StreamToolResultEvent,

    // 8. Run tests
    {
      type: 'tool_use',
      timestamp: now(),
      tool_name: 'Bash',
      tool_id: `tool-${Date.now()}-3`,
      input: { command: 'npm test' },
    } as StreamToolUseEvent,

    // 9. Test result
    {
      type: 'tool_result',
      timestamp: now(),
      tool_id: `tool-${Date.now()}-3`,
      output: 'PASS src/main.test.ts\n  ✓ app initializes correctly (15ms)\n  ✓ handles events (8ms)\n\nTest Suites: 1 passed, 1 total\nTests:       2 passed, 2 total',
      is_error: false,
    } as StreamToolResultEvent,

    // 10. Final message
    {
      type: 'message',
      timestamp: now(),
      content: 'Task completed successfully. I\'ve made the changes and all tests pass.',
      role: 'assistant',
    } as StreamMessageEvent,

    // 11. Result
    {
      type: 'result',
      timestamp: now(),
      result: 'Task completed successfully',
      cost: {
        input_tokens: 2500,
        output_tokens: 450,
        total_cost_usd: 0.0125,
      },
      duration_ms: 15000,
      num_turns: 5,
    } as StreamResultEvent,
  ]
}

// ============================================
// Mock Headless Agent
// ============================================

export interface MockHeadlessAgentOptions {
  taskId: string
  planId: string
  worktreePath: string
  eventIntervalMs?: number // Default: 1500ms between events
  onComplete?: () => Promise<void>
}

/**
 * MockHeadlessAgent emits fake stream-json events to simulate a real agent
 */
export class MockHeadlessAgent extends EventEmitter {
  private taskId: string
  private planId: string
  private worktreePath: string
  private eventIntervalMs: number
  private status: HeadlessAgentStatus = 'idle'
  private events: StreamEvent[] = []
  private eventIndex = 0
  private timer: NodeJS.Timeout | null = null
  private startedAt: string = ''
  private onCompleteCallback?: () => Promise<void>

  constructor(options: MockHeadlessAgentOptions) {
    super()
    this.taskId = options.taskId
    this.planId = options.planId
    this.worktreePath = options.worktreePath
    this.eventIntervalMs = options.eventIntervalMs ?? 1500
    this.onCompleteCallback = options.onComplete
  }

  getStatus(): HeadlessAgentStatus {
    return this.status
  }

  getInfo(): HeadlessAgentInfo {
    return {
      id: `mock-agent-${this.taskId}`,
      taskId: this.taskId,
      planId: this.planId,
      status: this.status,
      worktreePath: this.worktreePath,
      events: this.events,
      startedAt: this.startedAt,
      completedAt: this.status === 'completed' || this.status === 'failed'
        ? new Date().toISOString()
        : undefined,
      result: this.status === 'completed'
        ? {
            success: true,
            exitCode: 0,
            result: 'Task completed successfully',
            cost: { input_tokens: 2500, output_tokens: 450, total_cost_usd: 0.0125 },
            duration_ms: (Date.now() - new Date(this.startedAt).getTime()),
          }
        : undefined,
    }
  }

  async start(): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error(`Cannot start mock agent in status: ${this.status}`)
    }

    this.startedAt = new Date().toISOString()
    this.status = 'starting'
    this.emit('status', this.status)

    // Generate the event sequence
    const mockEvents = generateMockEventSequence(this.taskId)

    // Start emitting events
    this.status = 'running'
    this.emit('status', this.status)

    this.emitNextEvent(mockEvents)
  }

  private emitNextEvent(mockEvents: StreamEvent[]): void {
    if (this.eventIndex >= mockEvents.length) {
      this.handleComplete()
      return
    }

    const event = mockEvents[this.eventIndex]
    // Add fresh timestamp
    event.timestamp = new Date().toISOString()

    this.events.push(event)
    this.emit('event', event)

    // Emit typed events
    this.emit(event.type, event)

    this.eventIndex++

    // Schedule next event
    this.timer = setTimeout(() => {
      this.emitNextEvent(mockEvents)
    }, this.eventIntervalMs)
  }

  private async handleComplete(): Promise<void> {
    this.status = 'completed'
    this.emit('status', this.status)

    const result = {
      success: true,
      exitCode: 0,
      result: 'Task completed successfully',
      cost: { input_tokens: 2500, output_tokens: 450, total_cost_usd: 0.0125 },
      duration_ms: Date.now() - new Date(this.startedAt).getTime(),
    }

    this.emit('complete', result)

    // Call completion callback (e.g., close the bd task)
    if (this.onCompleteCallback) {
      await this.onCompleteCallback()
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.status = 'completed'
    this.emit('status', this.status)
  }
}

// ============================================
// Mock Orchestrator
// ============================================

export interface MockOrchestratorOptions {
  planId: string
  planDir: string
  mainWindow: BrowserWindow | null
  onTaskReady?: (taskId: string) => void
}

/**
 * MockOrchestrator simulates the orchestrator behavior:
 * - Monitors for task completion
 * - Marks next task as bismarck-ready when blocker completes
 * - Emits activity events to the renderer via IPC
 */
export class MockOrchestrator extends EventEmitter {
  private planId: string
  private planDir: string
  private mainWindow: BrowserWindow | null
  private pollInterval: NodeJS.Timeout | null = null
  private completedTasks = new Set<string>()
  private onTaskReadyCallback?: (taskId: string) => void

  constructor(options: MockOrchestratorOptions) {
    super()
    this.planId = options.planId
    this.planDir = options.planDir
    this.mainWindow = options.mainWindow
    this.onTaskReadyCallback = options.onTaskReady
  }

  /**
   * Emit an activity event to the renderer via IPC
   */
  private emitActivity(type: 'info' | 'success' | 'error', message: string): void {
    devLog(`[MockOrchestrator] Activity (${type}): ${message}`)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('plan-activity', {
        id: `orch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        planId: this.planId,
        timestamp: new Date().toISOString(),
        type,
        message,
        source: 'orchestrator',
      })
    }
  }

  async start(): Promise<void> {
    devLog('[MockOrchestrator] Starting orchestrator for plan:', this.planId)
    this.emitActivity('info', 'Orchestrator started, polling for task completion...')

    // Start polling for task status changes
    this.pollInterval = setInterval(() => this.checkTaskStatus(), 2000)
  }

  private async checkTaskStatus(): Promise<void> {
    try {
      // List all tasks (including closed ones)
      const dbPath = path.join(this.planDir, '.beads', 'beads.db')
      const { stdout } = await execAsync(`bd --sandbox --db "${dbPath}" list --all`)
      const tasks = this.parseTasks(stdout)

      // Check for newly completed tasks
      for (const task of tasks) {
        if (task.status === 'completed' && !this.completedTasks.has(task.id)) {
          this.completedTasks.add(task.id)
          devLog('[MockOrchestrator] Task completed:', task.id)
          this.emitActivity('success', `Task completed: ${task.id}`)
          this.emit('task-completed', task.id)

          // Mark tasks that were blocked by this one as ready
          await this.markDependentTasksReady(task.id, tasks)
        }
      }

      // Check if all tasks are done
      const allDone = tasks.every(t => t.status === 'completed')
      if (allDone && tasks.length > 0) {
        devLog('[MockOrchestrator] All tasks completed!')
        this.emitActivity('success', 'All tasks completed!')
        this.emit('plan-completed')
        this.stop()
      }
    } catch (error) {
      console.error('[MockOrchestrator] Error checking task status:', error)
      this.emitActivity('error', `Error checking task status: ${error}`)
    }
  }

  private parseTasks(output: string): Array<{ id: string; status: string; blockedBy: string[] }> {
    // Parser for bd list --all output
    // Format: [status_icon] [id] [priority] [type] - [subject]
    // Examples:
    //   ○ mock-plan-123-abc [● P2] [task] - Task 1: Update config
    //   ✓ mock-plan-123-def [P2] [task] - Task 2: Add feature
    const lines = output.trim().split('\n')
    const tasks: Array<{ id: string; status: string; blockedBy: string[] }> = []

    for (const line of lines) {
      // Skip empty lines
      if (!line.trim()) continue

      // Check if line starts with status icon
      const isCompleted = line.startsWith('✓')
      const isOpen = line.startsWith('○')

      if (!isCompleted && !isOpen) continue

      // Extract the task ID (second word after the status icon)
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const id = parts[1]
        tasks.push({
          id,
          status: isCompleted ? 'completed' : 'pending',
          blockedBy: [], // Would need more parsing for real blocked-by info
        })
      }
    }

    return tasks
  }

  private async markDependentTasksReady(completedTaskId: string, tasks: Array<{ id: string; status: string; blockedBy: string[] }>): Promise<void> {
    // Find tasks that were blocked by the completed task and can now be started
    const dbPath = path.join(this.planDir, '.beads', 'beads.db')

    for (const task of tasks) {
      if (task.status !== 'completed') {
        // Check if this task's blockers are all complete
        try {
          const { stdout: depOutput } = await execAsync(`bd --sandbox --db "${dbPath}" dep list "${task.id}"`)

          // Parse dependencies - look for "via blocks" entries
          // Format: "  task-id: Subject [P2] (closed) via blocks" or "(open) via blocks"
          const blockerLines = depOutput.split('\n').filter(line => line.includes('via blocks'))
          const hasOpenBlockers = blockerLines.some(line => line.includes('(open)'))

          if (!hasOpenBlockers) {
            // All blockers are closed (or no blockers), mark as ready
            await execAsync(`bd --sandbox --db "${dbPath}" label add "${task.id}" bismarck-ready`)
            devLog('[MockOrchestrator] Marked task ready:', task.id, '(blocker completed:', completedTaskId, ')')
            this.emitActivity('info', `Marked task ready: ${task.id}`)
            if (this.onTaskReadyCallback) {
              this.onTaskReadyCallback(task.id)
            }
          }
        } catch {
          // Task might already have label or be closed
        }
      }
    }
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }
}

// ============================================
// Mock Plan Setup
// ============================================

export interface MockPlan {
  planId: string
  planDir: string
  tasks: Array<{ id: string; subject: string; blockedBy?: string[] }>
}

export interface MockFlowOptions {
  /** Delay between events in mock agents (default: 1500ms) */
  eventIntervalMs?: number
  /** Delay before starting the first agent (default: 0ms) */
  startDelayMs?: number
  /** Number of tasks to create (default: 3) */
  taskCount?: number
  /** If true, tasks have no dependencies and can run in parallel (default: false) */
  parallelTasks?: boolean
  /** Use Docker mock image instead of MockHeadlessAgent (default: false) */
  useMockImage?: boolean
}

/**
 * Helper to run bd commands with the correct --db path
 */
function bdCmd(planDir: string, subcommand: string): string {
  const dbPath = path.join(planDir, '.beads', 'beads.db')
  return `bd --sandbox --db "${dbPath}" ${subcommand}`
}

/**
 * Get a task subject for the given index
 */
function getTaskSubject(index: number): string {
  const subjects = [
    'Update config files',
    'Add new feature',
    'Write tests',
    'Refactor code',
    'Update documentation',
    'Add validation',
    'Improve performance',
    'Fix edge cases',
  ]
  return subjects[index % subjects.length]
}

export interface SetupMockPlanOptions {
  taskCount?: number
  parallelTasks?: boolean
}

/**
 * Creates a test plan with beads tasks for testing
 */
export async function setupMockPlan(options?: SetupMockPlanOptions): Promise<MockPlan> {
  const taskCount = options?.taskCount ?? 3
  const parallelTasks = options?.parallelTasks ?? false

  // Create a temp directory for the plan
  const planId = `mock-plan-${Date.now()}`
  const planDir = path.join(os.tmpdir(), 'bismarck-mock-plans', planId)

  // Ensure directory exists
  await fs.promises.mkdir(planDir, { recursive: true })

  devLog('[MockPlanSetup] Creating mock plan in:', planDir, `(${taskCount} tasks, parallel: ${parallelTasks})`)

  // Initialize beads repo (must run from within the directory)
  await execAsync(`cd "${planDir}" && bd --sandbox init`)

  // Generate task definitions dynamically
  const tasks: Array<{ id: string; subject: string; blockedBy: string[] }> = Array.from(
    { length: taskCount },
    (_, i) => ({
      id: '',
      subject: `Task ${i + 1}: ${getTaskSubject(i)}`,
      blockedBy: [] as string[],
    })
  )

  // Create tasks with bd
  for (let i = 0; i < tasks.length; i++) {
    const deps = (!parallelTasks && i > 0) ? `--deps "blocks:${tasks[i - 1].id}"` : ''
    const { stdout } = await execAsync(bdCmd(planDir, `create "${tasks[i].subject}" ${deps}`))
    tasks[i].id = extractTaskId(stdout)

    if (i > 0 && !parallelTasks) {
      tasks[i].blockedBy = [tasks[i - 1].id]
    }

    devLog(`[MockPlanSetup] Created task ${i + 1}:`, tasks[i].id)
  }

  // Mark first task as bismarck-ready (simulates orchestrator marking it)
  // For parallel tasks, mark all as ready
  if (parallelTasks) {
    for (const task of tasks) {
      await execAsync(bdCmd(planDir, `label add "${task.id}" bismarck-ready`))
    }
  } else {
    await execAsync(bdCmd(planDir, `label add "${tasks[0].id}" bismarck-ready`))
  }

  devLog('[MockPlanSetup] Created tasks:', tasks.map(t => t.id))

  return { planId, planDir, tasks }
}

function extractTaskId(output: string): string {
  // bd create output format: "✓ Created issue: prefix-XXX"
  // Extract the issue ID after "Created issue: "
  const match = output.match(/Created issue:\s*(\S+)/)
  if (match?.[1]) {
    return match[1]
  }
  // Fallback: look for prefix-XXX pattern (e.g., mock-plan-abc123)
  const fallbackMatch = output.match(/([a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*)/)
  return fallbackMatch?.[1] || `task-${Date.now()}`
}

// ============================================
// Dev Test Harness Manager
// ============================================

let mainWindow: BrowserWindow | null = null
const activeAgents = new Map<string, MockHeadlessAgent>()
let activeOrchestrator: MockOrchestrator | null = null

// Default mock flow options - can be modified via setMockFlowOptions
let mockFlowOptions: MockFlowOptions = {
  eventIntervalMs: 1500,
  startDelayMs: 0,
}

/**
 * Set the default options for mock flows
 */
export function setMockFlowOptions(options: Partial<MockFlowOptions>): void {
  mockFlowOptions = { ...mockFlowOptions, ...options }
  devLog('[DevHarness] Mock flow options updated:', mockFlowOptions)
}

/**
 * Get current mock flow options
 */
export function getMockFlowOptions(): MockFlowOptions {
  return { ...mockFlowOptions }
}

export function setDevHarnessWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

/**
 * Check if mock agents should be used
 */
export function shouldUseMockAgents(): boolean {
  return process.env.BISMARCK_MOCK_AGENTS === 'true' || process.env.NODE_ENV === 'development'
}

/**
 * Start a single mock headless agent for testing
 */
export async function startMockAgent(
  taskId: string,
  planId: string = 'test-plan',
  worktreePath: string = '/tmp/mock-worktree',
  options?: { eventIntervalMs?: number }
): Promise<MockHeadlessAgent> {
  const eventIntervalMs = options?.eventIntervalMs ?? mockFlowOptions.eventIntervalMs ?? 1500
  devLog('[DevHarness] Starting mock agent:', taskId, 'planId:', planId, 'eventIntervalMs:', eventIntervalMs)

  const agent = new MockHeadlessAgent({
    taskId,
    planId,
    worktreePath,
    eventIntervalMs,
    onComplete: async () => {
      devLog('[DevHarness] Mock agent completed:', taskId)
      activeAgents.delete(taskId)
      // Close the beads task so orchestrator can detect completion
      try {
        const dbPath = path.join(worktreePath, '.beads', 'beads.db')
        await execAsync(`bd --sandbox --db "${dbPath}" close "${taskId}"`)
        devLog('[DevHarness] Closed bd task:', taskId)
      } catch (error) {
        console.error('[DevHarness] Failed to close bd task:', taskId, error)
      }
    },
  })

  // NEW: Create HeadlessAgentInfo for the main registry
  const agentInfo: HeadlessAgentInfo = {
    id: `mock-agent-${taskId}`,
    taskId,
    planId,           // Links to the Bismarck Plan
    status: 'starting',
    worktreePath,
    events: [],
    startedAt: new Date().toISOString(),
  }

  // NEW: Register in plan-manager's map so renderer can find it
  registerHeadlessAgentInfo(agentInfo)
  devLog('[DevHarness] Registered agent info:', agentInfo.id, 'planId:', planId)

  // Forward events to renderer using proper IPC
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    // Use the exported emitter function for consistency
    emitHeadlessAgentUpdatePublic(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    // Use the exported emitter functions for consistency
    emitHeadlessAgentUpdatePublic(agentInfo)
    emitHeadlessAgentEventPublic(planId, taskId, event)
  })

  // Notify renderer that agent started
  mainWindow?.webContents.send('headless-agent-started', { taskId, planId, worktreePath })
  emitHeadlessAgentUpdatePublic(agentInfo)
  devLog('[DevHarness] Emitted headless-agent-started and update for:', taskId)

  activeAgents.set(taskId, agent)
  await agent.start()

  return agent
}

/**
 * Start a mock agent using Docker with the mock image
 * This tests the full pipeline: Docker → stdout → StreamEventParser → IPC → renderer
 */
export async function startMockAgentWithDocker(
  taskId: string,
  planId: string = 'test-plan',
  worktreePath: string = '/tmp/mock-worktree',
  options?: { eventIntervalMs?: number }
): Promise<HeadlessAgent> {
  const eventIntervalMs = options?.eventIntervalMs ?? mockFlowOptions.eventIntervalMs ?? 1500
  devLog('[DevHarness] Starting Docker mock agent:', taskId, 'planId:', planId, 'eventIntervalMs:', eventIntervalMs)

  // Check if mock image exists
  const imageExists = await checkImageExists(MOCK_IMAGE)
  if (!imageExists) {
    throw new Error(`Mock image ${MOCK_IMAGE} not found. Run: cd bismarck/docker && ./build-mock.sh`)
  }

  // Create the real HeadlessAgent with mock image
  const agent = new HeadlessAgent()

  // Create HeadlessAgentInfo for the main registry
  const agentInfo: HeadlessAgentInfo = {
    id: `docker-mock-agent-${taskId}`,
    taskId,
    planId,
    status: 'starting',
    worktreePath,
    events: [],
    startedAt: new Date().toISOString(),
  }

  // Register in plan-manager's map so renderer can find it
  registerHeadlessAgentInfo(agentInfo)
  devLog('[DevHarness] Registered Docker mock agent info:', agentInfo.id, 'planId:', planId)

  // Log errors for debugging
  agent.on('error', (error) => {
    console.error('[DevHarness] Docker mock agent error:', taskId, error)
  })

  // Forward events to renderer using proper IPC
  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    devLog('[DevHarness] Docker mock agent status changed:', taskId, status)
    emitHeadlessAgentUpdatePublic(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentUpdatePublic(agentInfo)
    emitHeadlessAgentEventPublic(planId, taskId, event)
  })

  agent.on('complete', async (result) => {
    devLog('[DevHarness] Docker mock agent completed:', taskId, result)
    agentInfo.status = result.success ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdatePublic(agentInfo)

    // Send activity log to renderer for visibility
    const activityType = result.success ? 'success' : 'error'
    const activityMsg = result.success
      ? `Docker agent ${taskId} completed`
      : `Docker agent ${taskId} failed: exitCode=${result.exitCode}, error=${result.error || 'unknown'}, events=${agentInfo.events.length}`
    mainWindow?.webContents.send('plan-activity', {
      id: `docker-${Date.now()}`,
      planId,
      timestamp: new Date().toISOString(),
      type: activityType,
      message: activityMsg,
      source: 'docker-agent',
    })

    // Close the beads task so orchestrator can detect completion
    try {
      const dbPath = path.join(worktreePath, '.beads', 'beads.db')
      await execAsync(`bd --sandbox --db "${dbPath}" close "${taskId}"`)
      devLog('[DevHarness] Closed bd task:', taskId)
    } catch (error) {
      console.error('[DevHarness] Failed to close bd task:', taskId, error)
    }

    activeDockerAgents.delete(taskId)
  })

  // Notify renderer that agent started
  mainWindow?.webContents.send('headless-agent-started', { taskId, planId, worktreePath })
  emitHeadlessAgentUpdatePublic(agentInfo)
  devLog('[DevHarness] Emitted headless-agent-started and update for Docker mock:', taskId)

  activeDockerAgents.set(taskId, agent)

  // Start the agent with mock image
  // Note: planDir uses worktreePath since that's where we have the beads db
  await agent.start({
    prompt: `Mock task ${taskId}`,  // Prompt is ignored by mock image
    worktreePath,
    planDir: worktreePath,
    taskId,
    image: MOCK_IMAGE,
    useEntrypoint: true,  // Use mock image's entrypoint, not claude command
    env: {
      MOCK_EVENT_INTERVAL_MS: String(eventIntervalMs),
      BISMARCK_TASK_ID: taskId,
    },
  })

  return agent
}

// Track Docker-based agents separately
const activeDockerAgents = new Map<string, HeadlessAgent>()

/**
 * Stop a mock agent
 */
export async function stopMockAgent(taskId: string): Promise<void> {
  const agent = activeAgents.get(taskId)
  if (agent) {
    await agent.stop()
    activeAgents.delete(taskId)
  }

  const dockerAgent = activeDockerAgents.get(taskId)
  if (dockerAgent) {
    await dockerAgent.stop()
    activeDockerAgents.delete(taskId)
  }
}

/**
 * Get mock agent info
 */
export function getMockAgentInfo(taskId: string): HeadlessAgentInfo | undefined {
  const agent = activeAgents.get(taskId)
  return agent?.getInfo()
}

/**
 * Get all mock agents for a plan
 */
export function getMockAgentsForPlan(planId: string): HeadlessAgentInfo[] {
  return Array.from(activeAgents.values())
    .filter(agent => agent.getInfo().planId === planId)
    .map(agent => agent.getInfo())
}

/**
 * Run the full mock flow: plan → orchestrator → task agents
 * @param options Optional overrides for event timing and task configuration
 */
export async function runMockFlow(options?: Partial<MockFlowOptions>): Promise<MockPlan> {
  const opts = { ...mockFlowOptions, ...options }
  devLog('[DevHarness] Running full mock flow with options:', opts)

  // Stop any existing flow
  await stopMockFlow()

  // Set up mock plan with beads tasks
  const plan = await setupMockPlan({
    taskCount: opts.taskCount,
    parallelTasks: opts.parallelTasks,
  })

  // NEW: Create a Bismarck Plan object
  const bismarckPlan: Plan = {
    id: plan.planId,
    title: 'Mock Test Plan',
    description: 'Testing headless agent flow',
    status: 'in_progress', // Valid PlanStatus value
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    referenceAgentId: null,
    beadEpicId: null,
    orchestratorWorkspaceId: null,
    orchestratorTabId: null,
    planAgentWorkspaceId: null,
    maxParallelAgents: 2,
    worktrees: [],
    branchStrategy: 'feature_branch',
  }

  // NEW: Create plan tab BEFORE saving the plan
  const planTab = createTab('Mock Plan', { isPlanTab: true })
  bismarckPlan.orchestratorTabId = planTab.id
  devLog('[DevHarness] Created plan tab:', planTab.id, 'isPlanTab:', planTab.isPlanTab)

  // NEW: Save plan so renderer can find it
  savePlan(bismarckPlan)
  devLog('[DevHarness] Saved Bismarck plan:', bismarckPlan.id)

  // NEW: Switch to the plan tab
  setActiveTab(planTab.id)

  // FIXED ORDER: Emit plan-update FIRST so renderer has the plan in state
  // before we start agents (otherwise getHeadlessAgentsForTab returns [])
  mainWindow?.webContents.send('plan-update', bismarckPlan)
  devLog('[DevHarness] Emitted plan-update for:', bismarckPlan.id)

  // THEN emit state update so renderer knows about the new tab
  const state = getState()
  mainWindow?.webContents.send('state-update', state)
  devLog('[DevHarness] Emitted state-update with tabs:', state.tabs.map(t => ({ id: t.id, name: t.name, isPlanTab: t.isPlanTab })))

  // Small delay to let renderer process state updates before starting agents
  await new Promise(resolve => setTimeout(resolve, 100))

  // Apply additional start delay if specified
  if (opts.startDelayMs && opts.startDelayMs > 0) {
    devLog(`[DevHarness] Waiting ${opts.startDelayMs}ms before starting agents...`)
    await new Promise(resolve => setTimeout(resolve, opts.startDelayMs))
  }

  // Helper to start agent (either Docker mock or JS mock)
  const startAgent = async (taskId: string) => {
    if (opts.useMockImage) {
      await startMockAgentWithDocker(taskId, plan.planId, plan.planDir, { eventIntervalMs: opts.eventIntervalMs })
    } else {
      await startMockAgent(taskId, plan.planId, plan.planDir, { eventIntervalMs: opts.eventIntervalMs })
    }
  }

  // Check if Docker mock image is available when requested
  if (opts.useMockImage) {
    const imageExists = await checkImageExists(MOCK_IMAGE)
    if (!imageExists) {
      console.warn(`[DevHarness] Mock image ${MOCK_IMAGE} not found, falling back to JS mock`)
      console.warn('[DevHarness] To use Docker mock, run: cd bismarck/docker && ./build-mock.sh')
      opts.useMockImage = false
    } else {
      devLog('[DevHarness] Using Docker mock image:', MOCK_IMAGE)
    }
  }

  // Start mock orchestrator
  activeOrchestrator = new MockOrchestrator({
    planId: plan.planId,
    planDir: plan.planDir,
    mainWindow,
    onTaskReady: async (taskId: string) => {
      // Start a mock agent for the ready task
      await startAgent(taskId)
    },
  })

  activeOrchestrator.on('plan-completed', () => {
    devLog('[DevHarness] Mock flow completed!')
    bismarckPlan.status = 'completed'
    bismarckPlan.updatedAt = new Date().toISOString()
    savePlan(bismarckPlan)
    mainWindow?.webContents.send('plan-update', bismarckPlan)
  })

  await activeOrchestrator.start()

  // Start agents for tasks that are marked ready
  if (plan.tasks.length > 0) {
    if (opts.parallelTasks) {
      // For parallel tasks, start all agents at once
      devLog('[DevHarness] Starting all agents in parallel mode')
      for (const task of plan.tasks) {
        await startAgent(task.id)
      }
    } else {
      // For sequential tasks, start only the first one
      await startAgent(plan.tasks[0].id)
    }
  }

  return plan
}

/**
 * Stop all mock components
 */
export async function stopMockFlow(): Promise<void> {
  // Stop all JS mock agents
  for (const [taskId, agent] of activeAgents) {
    await agent.stop()
  }
  activeAgents.clear()

  // Stop all Docker mock agents
  for (const [taskId, agent] of activeDockerAgents) {
    await agent.stop()
  }
  activeDockerAgents.clear()

  // Stop orchestrator
  if (activeOrchestrator) {
    activeOrchestrator.stop()
    activeOrchestrator = null
  }
}

/**
 * Clean up on app exit
 */
export async function cleanupDevHarness(): Promise<void> {
  await stopMockFlow()
}
