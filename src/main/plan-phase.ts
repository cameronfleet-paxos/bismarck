/**
 * Plan Phase Module
 *
 * Runs a planning container before the execution container.
 * Uses stream-json output for real-time streaming to the UI.
 * Plan text is captured via file-based handoff: Claude writes the plan to
 * /plan-output/plan.md inside the container, which is mounted from the host.
 * Falls back to accumulated stream text if the file isn't written.
 */

import * as fs from 'fs'
import * as path from 'path'
import { spawnContainerAgent } from './docker-sandbox'
import { buildPrompt } from './prompt-templates'
import { logger, LogContext } from './logger'
import { StreamEventParser, extractTextContent } from './stream-parser'
import type { StreamEvent } from '../shared/types'

export interface PlanPhaseConfig {
  taskDescription: string
  worktreePath: string
  image: string
  planDir?: string
  planId?: string
  guidance?: string
  sharedCacheDir?: string
  sharedModCacheDir?: string
  planOutputDir?: string           // Host path to store plan file (mounted as /plan-output in container)
  onChunk?: (text: string) => void // Stream plan text chunks to UI as they arrive
  onEvent?: (event: StreamEvent) => void // Forward raw stream events to UI
  enabled?: boolean                // Override the global setting (true = run, false = skip, undefined = use global setting)
}

export interface PlanPhaseResult {
  success: boolean
  plan: string | null
  durationMs: number
  error?: string
}

/**
 * Run a planning phase in a Docker container.
 * Returns the plan text on success, or null on failure.
 * Never throws - failures are gracefully handled so execution can proceed.
 */
export async function runPlanPhase(config: PlanPhaseConfig): Promise<PlanPhaseResult> {
  const startTime = Date.now()
  const logCtx: LogContext = {
    planId: config.planId,
    worktreePath: config.worktreePath,
  }

  try {
    if (!config.enabled) {
      logger.info('agent', 'Plan phase not enabled, skipping', logCtx)
      return { success: false, plan: null, durationMs: 0 }
    }

    const timeoutMs = 300000

    // Build the plan-mode prompt
    const guidanceSection = config.guidance
      ? `\n=== REPOSITORY GUIDANCE ===\nFollow these repo-specific guidelines:\n${config.guidance}\n`
      : ''

    const planPrompt = await buildPrompt('plan_phase', {
      taskDescription: config.taskDescription,
      guidance: guidanceSection,
    })

    // Ensure plan output directory exists if provided
    if (config.planOutputDir) {
      fs.mkdirSync(config.planOutputDir, { recursive: true })
    }

    logger.info('agent', 'Starting plan phase container', logCtx, {
      timeoutMs,
      promptLength: planPrompt.length,
      hasOnChunk: !!config.onChunk,
      hasOnEvent: !!config.onEvent,
      planOutputDir: config.planOutputDir,
    })

    // Spawn a plan-mode container (stream-json output)
    const container = await spawnContainerAgent({
      image: config.image,
      workingDir: config.worktreePath,
      planDir: config.planDir,
      planId: config.planId,
      prompt: planPrompt,
      mode: 'plan',
      sharedCacheDir: config.sharedCacheDir,
      sharedModCacheDir: config.sharedModCacheDir,
      planOutputDir: config.planOutputDir,
    })

    logger.info('agent', 'Plan phase container spawned, waiting for stream events', logCtx)

    // Parse stream-json output and accumulate text as fallback
    let accumulatedText = ''
    let chunkCount = 0
    let firstChunkTime: number | null = null

    const parser = new StreamEventParser()
    container.stdout.on('data', (chunk: Buffer) => {
      parser.write(chunk)
    })

    parser.on('event', (event: StreamEvent) => {
      // Extract text content for fallback accumulation
      const text = extractTextContent(event)
      if (text) {
        accumulatedText += text
        chunkCount++
        if (!firstChunkTime) {
          firstChunkTime = Date.now()
          logger.info('agent', 'Plan phase first text chunk received', logCtx, {
            timeSinceStartMs: firstChunkTime - startTime,
            chunkLength: text.length,
            preview: text.substring(0, 200),
          })
        }
        config.onChunk?.(text)
      }
      // Forward all events for UI display
      config.onEvent?.(event)
    })

    // Collect stderr for debugging
    let stderrText = ''
    container.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrText += text
      logger.debug('agent', 'Plan phase stderr chunk', logCtx, {
        length: text.length,
        preview: text.substring(0, 200),
      })
    })

    // Wait for exit with timeout
    const exitCode = await Promise.race([
      container.wait(),
      new Promise<number>((_, reject) => {
        setTimeout(async () => {
          logger.warn('agent', 'Plan phase timed out, stopping container', logCtx, {
            timeoutMs,
            chunksReceived: chunkCount,
            bytesReceived: accumulatedText.length,
          })
          await container.stop()
          reject(new Error('Plan phase timed out'))
        }, timeoutMs)
      }),
    ])

    // Flush any remaining buffered data
    parser.end()

    const durationMs = Date.now() - startTime

    if (exitCode !== 0) {
      logger.warn('agent', 'Plan phase container exited with non-zero code', logCtx, {
        exitCode,
        durationMs,
        chunksReceived: chunkCount,
        accumulatedTextLength: accumulatedText.length,
        stderrLength: stderrText.length,
        stderrPreview: stderrText.substring(0, 500),
      })
      return {
        success: false,
        plan: null,
        durationMs,
        error: `Plan phase exited with code ${exitCode}`,
      }
    }

    // Try to read plan from file (primary method)
    let planText = ''
    if (config.planOutputDir) {
      const planFilePath = path.join(config.planOutputDir, 'plan.md')
      try {
        planText = fs.readFileSync(planFilePath, 'utf-8').trim()
        logger.info('agent', 'Plan file read successfully', logCtx, {
          planFilePath,
          planLength: planText.length,
        })
      } catch {
        // File not written — fall back to accumulated text from stream events
        logger.warn('agent', 'Plan file not found, falling back to streamed text', logCtx, {
          planFilePath,
          accumulatedTextLength: accumulatedText.length,
        })
      }
    }

    // Fallback to accumulated stream text if file wasn't written or was empty
    if (!planText) {
      planText = accumulatedText.trim()
      if (planText) {
        logger.info('agent', 'Using accumulated stream text as plan fallback', logCtx, {
          planLength: planText.length,
        })
      }
    }

    if (!planText) {
      logger.warn('agent', 'Plan phase produced empty output', logCtx, {
        durationMs,
        chunksReceived: chunkCount,
        rawLength: accumulatedText.length,
        stderrLength: stderrText.length,
        stderrPreview: stderrText.substring(0, 500),
      })
      return {
        success: false,
        plan: null,
        durationMs,
        error: 'Plan phase produced empty output',
      }
    }

    logger.info('agent', 'Plan phase completed successfully', logCtx, {
      durationMs,
      planLength: planText.length,
      chunksReceived: chunkCount,
      firstChunkDelayMs: firstChunkTime ? firstChunkTime - startTime : null,
      usedFile: !!config.planOutputDir && planText !== accumulatedText.trim(),
    })

    return {
      success: true,
      plan: planText,
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('agent', 'Plan phase failed with exception', logCtx, { error: errorMessage, durationMs })
    return {
      success: false,
      plan: null,
      durationMs,
      error: errorMessage,
    }
  }
}

/**
 * Wrap an execution prompt with a pre-generated plan.
 * The plan is prepended so the execution agent follows it closely.
 */
export function wrapPromptWithPlan(originalPrompt: string, plan: string): string {
  return `=== IMPLEMENTATION PLAN ===
The following plan was created during a read-only analysis phase. Follow it closely.

${plan}

=== NOW EXECUTE ===
${originalPrompt}`
}
