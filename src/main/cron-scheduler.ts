/**
 * Cron Scheduler - Evaluates cron expressions, manages timers, executes workflows
 */
import * as crypto from 'crypto'
import { BrowserWindow } from 'electron'
import { loadAllCronJobs, loadCronJob, updateCronJob, saveCronJobRun } from './cron-job-manager'
import { startStandaloneHeadlessAgent } from './headless/standalone'
import { startRalphLoop } from './ralph-loop'
import { execWithPath } from './exec-utils'
import { devLog } from './dev-log'
import type {
  CronJob,
  CronJobRun,
  CronJobRunStatus,
  NodeExecutionResult,
  WorkflowGraph,
  WorkflowNode,
  HeadlessAgentNodeData,
  RalphLoopNodeData,
  ShellCommandNodeData,
} from '../shared/cron-types'

// Timer management
const activeTimers: Map<string, NodeJS.Timeout> = new Map()
const runningJobs: Map<string, Promise<void>> = new Map()
let mainWindow: BrowserWindow | null = null
let isShuttingDown = false

/**
 * Parse a cron expression and calculate the next run time.
 * Supports standard 5-field cron expressions: minute hour day-of-month month day-of-week
 */
function getNextRunTime(cronExpression: string): Date | null {
  try {
    const now = new Date()
    const parts = cronExpression.trim().split(/\s+/)
    if (parts.length !== 5) return null

    const [minuteSpec, hourSpec, , , ] = parts

    // Simple implementation for common patterns
    // For full cron parsing, we match minute and hour
    const minutes = parseField(minuteSpec, 0, 59)
    const hours = parseField(hourSpec, 0, 23)

    if (!minutes || !hours) return null

    // Find next matching time
    const next = new Date(now)
    next.setSeconds(0, 0)

    // Try current minute + 1 through next 48 hours
    for (let i = 1; i <= 2880; i++) {
      next.setTime(now.getTime() + i * 60000)
      next.setSeconds(0, 0)

      if (minutes.includes(next.getMinutes()) && hours.includes(next.getHours())) {
        if (matchesDayOfMonth(parts[2], next) && matchesMonth(parts[3], next) && matchesDayOfWeek(parts[4], next)) {
          return next
        }
      }
    }

    return null
  } catch {
    return null
  }
}

function parseField(field: string, min: number, max: number): number[] | null {
  try {
    const values: number[] = []

    for (const part of field.split(',')) {
      if (part === '*') {
        for (let i = min; i <= max; i++) values.push(i)
      } else if (part.includes('/')) {
        const [range, stepStr] = part.split('/')
        const step = parseInt(stepStr, 10)
        const start = range === '*' ? min : parseInt(range, 10)
        for (let i = start; i <= max; i += step) values.push(i)
      } else if (part.includes('-')) {
        const [startStr, endStr] = part.split('-')
        const start = parseInt(startStr, 10)
        const end = parseInt(endStr, 10)
        for (let i = start; i <= end; i++) values.push(i)
      } else {
        values.push(parseInt(part, 10))
      }
    }

    return values.filter(v => v >= min && v <= max)
  } catch {
    return null
  }
}

function matchesDayOfMonth(field: string, date: Date): boolean {
  if (field === '*') return true
  const values = parseField(field, 1, 31)
  return values ? values.includes(date.getDate()) : false
}

function matchesMonth(field: string, date: Date): boolean {
  if (field === '*') return true
  const values = parseField(field, 1, 12)
  return values ? values.includes(date.getMonth() + 1) : false
}

function matchesDayOfWeek(field: string, date: Date): boolean {
  if (field === '*') return true
  const values = parseField(field, 0, 7)
  if (!values) return false
  const dow = date.getDay() // 0 = Sunday
  return values.includes(dow) || (dow === 0 && values.includes(7))
}

/**
 * Calculate human-readable description from cron expression
 */
export function describeCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, dom, month, dow] = parts

  // Common patterns
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Every hour'
  if (min === '0' && hour === '*/6' && dom === '*' && month === '*' && dow === '*') return 'Every 6 hours'
  if (dom === '*' && month === '*' && dow === '*' && min !== '*' && hour !== '*') return `Daily at ${hour}:${min.padStart(2, '0')}`
  if (dom === '*' && month === '*' && dow === '1-5' && min !== '*' && hour !== '*') return `Weekdays at ${hour}:${min.padStart(2, '0')}`
  if (dom === '*' && month === '*' && dow === '1' && min !== '*' && hour !== '*') return `Weekly (Mon ${hour}:${min.padStart(2, '0')})`

  return cron
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(cron: string): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return getNextRunTime(cron) !== null
}

// --- Scheduling ---

function scheduleJob(job: CronJob): void {
  if (isShuttingDown || !job.enabled) return

  // Clear existing timer
  unscheduleJob(job.id)

  const nextRun = getNextRunTime(job.schedule)
  if (!nextRun) {
    devLog(`[CronScheduler] Invalid cron expression for job ${job.id}: ${job.schedule}`)
    return
  }

  const delay = nextRun.getTime() - Date.now()
  if (delay <= 0) return

  devLog(`[CronScheduler] Scheduling job "${job.name}" (${job.id}), next run: ${nextRun.toISOString()} (in ${Math.round(delay / 1000)}s)`)

  const timer = setTimeout(async () => {
    activeTimers.delete(job.id)

    // Execute then reschedule
    await triggerJob(job.id)

    // Reschedule for next run
    const freshJob = loadCronJob(job.id)
    if (freshJob && freshJob.enabled) {
      scheduleJob(freshJob)
    }
  }, delay)

  activeTimers.set(job.id, timer)
}

function unscheduleJob(jobId: string): void {
  const timer = activeTimers.get(jobId)
  if (timer) {
    clearTimeout(timer)
    activeTimers.delete(jobId)
  }
}

async function triggerJob(jobId: string): Promise<void> {
  // Check if already running (skip overlapping runs)
  if (runningJobs.has(jobId)) {
    devLog(`[CronScheduler] Job ${jobId} is already running, skipping`)
    return
  }

  const job = loadCronJob(jobId)
  if (!job || !job.enabled) return

  devLog(`[CronScheduler] Triggering job "${job.name}" (${jobId})`)

  const execution = executeWorkflow(job)
  runningJobs.set(jobId, execution)

  try {
    await execution
  } finally {
    runningJobs.delete(jobId)
  }
}

// --- Workflow Execution ---

/**
 * Build execution waves from a DAG (topological sort into parallel groups)
 */
function buildExecutionWaves(graph: WorkflowGraph): WorkflowNode[][] {
  if (graph.nodes.length === 0) return []

  // Build adjacency and in-degree maps
  const inDegree: Map<string, number> = new Map()
  const adjacency: Map<string, string[]> = new Map()
  const nodeMap: Map<string, WorkflowNode> = new Map()

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
    nodeMap.set(node.id, node)
  }

  for (const edge of graph.edges) {
    const targets = adjacency.get(edge.source)
    if (targets) targets.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
  }

  const waves: WorkflowNode[][] = []
  const processed = new Set<string>()

  while (processed.size < graph.nodes.length) {
    // Find all nodes with in-degree 0 that haven't been processed
    const wave: WorkflowNode[] = []
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0 && !processed.has(nodeId)) {
        wave.push(nodeMap.get(nodeId)!)
      }
    }

    if (wave.length === 0) {
      // Cycle detected or disconnected nodes - add remaining
      for (const node of graph.nodes) {
        if (!processed.has(node.id)) {
          wave.push(node)
        }
      }
      if (wave.length === 0) break
    }

    waves.push(wave)

    // Remove processed nodes and update in-degrees
    for (const node of wave) {
      processed.add(node.id)
      const targets = adjacency.get(node.id) || []
      for (const target of targets) {
        inDegree.set(target, (inDegree.get(target) || 0) - 1)
      }
    }
  }

  return waves
}

/**
 * Execute a single workflow node
 */
async function executeNode(node: WorkflowNode): Promise<NodeExecutionResult> {
  const result: NodeExecutionResult = {
    nodeId: node.id,
    status: 'running',
    startedAt: new Date().toISOString(),
  }

  try {
    switch (node.type) {
      case 'headless-agent': {
        const data = node.data as HeadlessAgentNodeData
        const response = await startStandaloneHeadlessAgent(
          data.referenceAgentId,
          data.prompt,
          data.model === 'haiku' ? 'sonnet' : data.model, // Fallback haiku to sonnet
          undefined,
          { skipPlanPhase: !data.planPhase }
        )
        result.output = `Started headless agent: ${response.headlessId}`
        result.status = 'success'
        break
      }

      case 'ralph-loop': {
        const data = node.data as RalphLoopNodeData
        const loopState = await startRalphLoop({
          prompt: data.prompt,
          completionPhrase: data.completionPhrase,
          maxIterations: data.maxIterations,
          model: data.model,
          referenceAgentId: data.referenceAgentId,
        })
        result.output = `Started Ralph Loop: ${loopState.id}`
        result.status = 'success'
        break
      }

      case 'shell-command': {
        const data = node.data as ShellCommandNodeData
        const { stdout, stderr } = await execWithPath(data.command, {
          cwd: data.workingDirectory || undefined,
          timeout: (data.timeout || 300) * 1000,
        })
        result.output = stdout || stderr
        result.status = 'success'
        break
      }

      default:
        result.status = 'failed'
        result.error = `Unknown node type: ${node.type}`
    }
  } catch (error: unknown) {
    result.status = 'failed'
    result.error = error instanceof Error ? error.message : String(error)
  }

  result.completedAt = new Date().toISOString()
  return result
}

/**
 * Execute a full workflow graph
 */
async function executeWorkflow(job: CronJob): Promise<void> {
  const runId = crypto.randomUUID()
  const run: CronJobRun = {
    id: runId,
    cronJobId: job.id,
    startedAt: new Date().toISOString(),
    status: 'running',
    nodeResults: {},
  }

  // Notify renderer
  mainWindow?.webContents.send('cron-job-started', { jobId: job.id, runId })

  const waves = buildExecutionWaves(job.workflowGraph)
  let hasFailures = false
  let hasSuccesses = false

  for (const wave of waves) {
    // If a previous wave had failures, skip remaining (fail-fast)
    if (hasFailures) {
      for (const node of wave) {
        run.nodeResults[node.id] = {
          nodeId: node.id,
          status: 'skipped',
        }
      }
      continue
    }

    // Execute all nodes in this wave in parallel
    const results = await Promise.all(
      wave.map(async (node) => {
        // Notify per-node status
        mainWindow?.webContents.send('cron-job-node-update', {
          jobId: job.id,
          runId,
          nodeId: node.id,
          status: 'running',
        })

        const result = await executeNode(node)

        mainWindow?.webContents.send('cron-job-node-update', {
          jobId: job.id,
          runId,
          nodeId: node.id,
          status: result.status,
        })

        return result
      })
    )

    for (const result of results) {
      run.nodeResults[result.nodeId] = result
      if (result.status === 'success') hasSuccesses = true
      if (result.status === 'failed') hasFailures = true
    }
  }

  // Determine overall status
  let status: CronJobRunStatus
  if (hasFailures && hasSuccesses) {
    status = 'partial'
  } else if (hasFailures) {
    status = 'failed'
  } else {
    status = 'success'
  }

  run.status = status
  run.completedAt = new Date().toISOString()

  // Save run history
  saveCronJobRun(job.id, run)

  // Update job with last run info
  updateCronJob(job.id, {
    lastRunAt: run.startedAt,
    lastRunStatus: status,
  })

  // Notify renderer
  mainWindow?.webContents.send('cron-job-completed', { jobId: job.id, runId, status })

  devLog(`[CronScheduler] Job "${job.name}" completed with status: ${status}`)
}

// --- Public API ---

export function setMainWindowForCronScheduler(window: BrowserWindow | null): void {
  mainWindow = window
}

export async function initCronScheduler(): Promise<void> {
  devLog('[CronScheduler] Initializing...')
  isShuttingDown = false

  const jobs = loadAllCronJobs()
  for (const job of jobs) {
    if (job.enabled) {
      scheduleJob(job)
    }
  }

  devLog(`[CronScheduler] Initialized with ${jobs.length} jobs (${jobs.filter(j => j.enabled).length} enabled)`)
}

export async function shutdownCronScheduler(): Promise<void> {
  devLog('[CronScheduler] Shutting down...')
  isShuttingDown = true

  // Clear all timers
  for (const [, timer] of activeTimers) {
    clearTimeout(timer)
  }
  activeTimers.clear()

  // Wait for running jobs (with timeout)
  if (runningJobs.size > 0) {
    devLog(`[CronScheduler] Waiting for ${runningJobs.size} running jobs...`)
    await Promise.race([
      Promise.allSettled(runningJobs.values()),
      new Promise(resolve => setTimeout(resolve, 10000)), // 10s timeout
    ])
  }

  devLog('[CronScheduler] Shutdown complete')
}

export function handleCronJobUpdate(jobId: string): void {
  const job = loadCronJob(jobId)
  if (!job) {
    unscheduleJob(jobId)
    return
  }

  if (job.enabled) {
    scheduleJob(job)
  } else {
    unscheduleJob(jobId)
  }
}

export function handleCronJobDelete(jobId: string): void {
  unscheduleJob(jobId)
}

export async function runCronJobNow(jobId: string): Promise<void> {
  await triggerJob(jobId)
}

/**
 * Get next run time for a cron expression (exported for UI display)
 */
export function getNextRunTimeForExpression(cronExpression: string): string | null {
  const next = getNextRunTime(cronExpression)
  return next ? next.toISOString() : null
}
