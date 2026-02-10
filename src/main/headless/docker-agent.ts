/**
 * Headless Agent
 *
 * High-level abstraction for running Claude Code agents in headless mode
 * inside Docker containers. Wraps the container lifecycle and stream
 * parsing into a simple interface.
 *
 * Usage:
 *   const agent = new HeadlessAgent()
 *   agent.on('event', (event) => console.log(event))
 *   agent.on('complete', (result) => console.log('Done:', result))
 *   await agent.start({ prompt: '...', worktreePath: '...' })
 */

import { EventEmitter } from 'events'
import {
  spawnContainerAgent,
  ContainerConfig,
  ContainerResult,
  DEFAULT_IMAGE,
} from '../docker-sandbox'
import { logger, LogContext } from '../logger'
import {
  StreamEventParser,
  StreamEvent,
  ResultEvent,
  isCompletionEvent,
  isErrorEvent,
  extractTextContent,
} from '../stream-parser'
import { isProxyRunning, getProxyConfig } from '../tool-proxy'
import { getGitHubToken } from '../settings-manager'
import { writeCrashLog } from '../crash-logger'
import { startTimer, endTimer, milestone } from '../startup-benchmark'

// Track first headless agent ready for benchmark milestone
let firstHeadlessReadyReported = false

export type HeadlessAgentStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'

export interface HeadlessAgentOptions {
  prompt: string
  worktreePath: string
  planDir: string
  planId?: string // Plan ID for bd proxy commands
  taskId?: string
  image?: string
  claudeFlags?: string[]
  env?: Record<string, string>
  useEntrypoint?: boolean // If true, use image's entrypoint instead of claude command (for mock images)
  sharedCacheDir?: string // Host path to shared Go build cache (per-repo)
  sharedModCacheDir?: string // Host path to shared Go module cache (per-repo)
}

export interface AgentResult {
  success: boolean
  exitCode: number
  result?: string
  cost?: {
    input_tokens: number
    output_tokens: number
    total_cost_usd?: number
  }
  duration_ms?: number
  error?: string
}

/**
 * HeadlessAgent class
 *
 * Events emitted:
 * - 'event': (event: StreamEvent) - Raw stream events
 * - 'message': (text: string) - Text content from Claude
 * - 'tool_use': (event: ToolUseEvent) - Tool being called
 * - 'tool_result': (event: ToolResultEvent) - Tool result
 * - 'complete': (result: AgentResult) - Agent completed
 * - 'error': (error: Error) - Error occurred
 * - 'status': (status: HeadlessAgentStatus) - Status changed
 */
export class HeadlessAgent extends EventEmitter {
  private status: HeadlessAgentStatus = 'idle'
  private container: ContainerResult | null = null
  private parser: StreamEventParser | null = null
  private options: HeadlessAgentOptions | null = null
  private events: StreamEvent[] = []
  private startTime: number = 0

  constructor() {
    super()
  }

  /**
   * Get current agent status
   */
  getStatus(): HeadlessAgentStatus {
    return this.status
  }

  /**
   * Get all events received so far
   */
  getEvents(): StreamEvent[] {
    return [...this.events]
  }

  /**
   * Start the agent
   */
  async start(options: HeadlessAgentOptions): Promise<void> {
    if (this.status !== 'idle') {
      throw new Error(`Cannot start agent in status: ${this.status}`)
    }

    const taskLabel = options.taskId || 'unknown'
    startTimer(`agent:headless-start:${taskLabel}`, 'agent')

    this.options = options
    this.events = []
    this.startTime = Date.now()
    this.setStatus('starting')

    // Log diagnostic information about proxy state
    const proxyRunning = isProxyRunning()
    const proxyConfig = proxyRunning ? getProxyConfig() : null
    logger.info('agent', 'Starting headless agent', this.getLogContext(), {
      worktreePath: options.worktreePath,
      image: options.image,
      proxyRunning,
      proxyPort: proxyConfig?.port,
    })

    if (!proxyRunning) {
      logger.warn('agent', 'Tool proxy is NOT running - git commands from container may fail', this.getLogContext())
    }

    try {
      // Retrieve GitHub token from settings so containers can access private registries
      const githubToken = await getGitHubToken()

      // Build container config
      const containerConfig: ContainerConfig = {
        image: options.image || DEFAULT_IMAGE,
        workingDir: options.worktreePath,
        planDir: options.planDir,
        planId: options.planId,
        prompt: options.prompt,
        claudeFlags: options.claudeFlags,
        env: {
          ...(githubToken ? { GITHUB_TOKEN: githubToken, GH_TOKEN: githubToken, GITHUB_ACCESS_TOKEN: githubToken } : {}),
          ...options.env,
          BISMARCK_TASK_ID: options.taskId || '',
        },
        useEntrypoint: options.useEntrypoint,
        sharedCacheDir: options.sharedCacheDir,
        sharedModCacheDir: options.sharedModCacheDir,
      }

      // Spawn container
      startTimer(`agent:container-spawn:${taskLabel}`, 'agent')
      this.container = await spawnContainerAgent(containerConfig)
      endTimer(`agent:container-spawn:${taskLabel}`)
      this.setStatus('running')

      // Set up stream parser
      this.parser = new StreamEventParser()
      this.setupParserListeners()

      // Track first event for benchmark
      let firstEventReceived = false
      const taskLabelForEvents = options.taskId || 'unknown'
      startTimer(`agent:first-event:${taskLabelForEvents}`, 'agent')

      // Pipe container stdout to parser
      this.container.stdout.on('data', (data) => {
        // Record first event timing
        if (!firstEventReceived) {
          firstEventReceived = true
          endTimer(`agent:first-event:${taskLabelForEvents}`)
          endTimer(`agent:headless-start:${taskLabelForEvents}`)
          // Report first headless agent ready milestone only once
          if (!firstHeadlessReadyReported) {
            firstHeadlessReadyReported = true
            milestone('first-headless-agent-ready')
          }
        }
        logger.debug('agent', `stdout received (${data.length} bytes)`, this.getLogContext(), {
          preview: data.toString().substring(0, 200),
        })
        this.parser?.write(data)
      })

      // Log stderr (for debugging)
      this.container.stderr.on('data', (data) => {
        logger.debug('agent', `stderr: ${data.toString().substring(0, 500)}`, this.getLogContext())
      })

      // Handle container exit
      this.container.wait().then((exitCode) => {
        this.parser?.end()
        this.handleContainerExit(exitCode)
      })
    } catch (error) {
      // Clean up any pending timers on error
      const taskLabelForError = options.taskId || 'unknown'
      endTimer(`agent:container-spawn:${taskLabelForError}`)
      endTimer(`agent:first-event:${taskLabelForError}`)
      endTimer(`agent:headless-start:${taskLabelForError}`)
      this.setStatus('failed')

      // Write crash log for headless agent errors
      writeCrashLog(error, 'headless-agent', {
        component: 'headless-agent',
        operation: 'spawnContainerAgent',
        planId: options.planId,
        taskId: options.taskId,
        additionalInfo: {
          worktreePath: options.worktreePath,
          prompt: options.prompt?.substring(0, 500),
        },
      })

      this.emit('error', error)
      throw error
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    const logCtx: LogContext = { planId: this.options?.planId, taskId: this.options?.taskId }

    logger.info('agent', 'HeadlessAgent.stop() called', logCtx, {
      currentStatus: this.status,
      hasContainer: !!this.container,
      worktreePath: this.options?.worktreePath,
    })

    if (this.status !== 'running' && this.status !== 'starting') {
      logger.info('agent', 'HeadlessAgent.stop() skipped - not running', logCtx, { status: this.status })
      return
    }

    this.setStatus('stopping')
    logger.debug('agent', 'HeadlessAgent status set to stopping', logCtx)

    try {
      if (this.container) {
        logger.info('agent', 'Calling container.stop()', logCtx)
        const stopStartTime = Date.now()
        await this.container.stop()
        logger.info('agent', 'Container.stop() completed', logCtx, { durationMs: Date.now() - stopStartTime })
      } else {
        logger.warn('agent', 'No container to stop', logCtx)
      }
    } catch (error) {
      logger.error('agent', 'Error stopping container', logCtx, { error: String(error) })
    }

    this.setStatus('completed')
    logger.info('agent', 'HeadlessAgent.stop() finished', logCtx, { finalStatus: this.status })
  }

  private setStatus(status: HeadlessAgentStatus): void {
    this.status = status
    this.emit('status', status)
  }

  private setupParserListeners(): void {
    if (!this.parser) return

    // Store all events
    this.parser.on('event', (event: StreamEvent) => {
      this.events.push(event)
      this.emit('event', event)
    })

    // Extract and emit text content
    this.parser.on('message', (event: StreamEvent) => {
      const text = extractTextContent(event)
      if (text) {
        this.emit('message', text)
      }
    })

    this.parser.on('assistant', (event: StreamEvent) => {
      const text = extractTextContent(event)
      if (text) {
        this.emit('message', text)
      }
    })

    this.parser.on('content_block_delta', (event: StreamEvent) => {
      const text = extractTextContent(event)
      if (text) {
        this.emit('message', text)
      }
    })

    // Emit tool events
    this.parser.on('tool_use', (event: StreamEvent) => {
      this.emit('tool_use', event)
    })

    this.parser.on('tool_result', (event: StreamEvent) => {
      this.emit('tool_result', event)
    })

    // Handle completion
    this.parser.on('result', (event: StreamEvent) => {
      const resultEvent = event as ResultEvent
      const result: AgentResult = {
        success: true,
        exitCode: 0,
        result: resultEvent.result,
        cost: resultEvent.cost,
        duration_ms: resultEvent.duration_ms || Date.now() - this.startTime,
      }
      this.emit('result_event', result)
    })
  }

  /**
   * Get log context for this agent
   */
  private getLogContext(): LogContext {
    return {
      planId: this.options?.planId,
      taskId: this.options?.taskId,
      worktreePath: this.options?.worktreePath,
    }
  }

  private handleContainerExit(exitCode: number): void {
    const duration = Date.now() - this.startTime

    logger.info('agent', `Container exited with code ${exitCode} after ${duration}ms`, this.getLogContext(), {
      eventCount: this.events.length,
    })

    // Find the result event if we received one
    const resultEvent = this.events.find(
      (e) => e.type === 'result'
    ) as ResultEvent | undefined

    const result: AgentResult = {
      success: exitCode === 0,
      exitCode,
      result: resultEvent?.result,
      cost: resultEvent?.cost,
      duration_ms: resultEvent?.duration_ms || duration,
    }

    if (exitCode !== 0 && !resultEvent) {
      result.error = `Container exited with code ${exitCode}`
    }

    this.setStatus(exitCode === 0 ? 'completed' : 'failed')
    this.emit('complete', result)
  }
}

/**
 * Factory function for creating headless agents with common configuration
 */
export function createHeadlessAgent(): HeadlessAgent {
  return new HeadlessAgent()
}

/**
 * Run a headless agent and wait for completion
 * Returns a promise that resolves with the agent result
 */
export async function runHeadlessAgent(
  options: HeadlessAgentOptions
): Promise<AgentResult> {
  const agent = new HeadlessAgent()

  return new Promise((resolve, reject) => {
    agent.on('complete', resolve)
    agent.on('error', reject)

    agent.start(options).catch(reject)
  })
}

/**
 * Run a headless agent with event streaming
 * Returns the agent instance for event subscription
 */
export async function startHeadlessAgent(
  options: HeadlessAgentOptions
): Promise<HeadlessAgent> {
  const agent = new HeadlessAgent()
  await agent.start(options)
  return agent
}
