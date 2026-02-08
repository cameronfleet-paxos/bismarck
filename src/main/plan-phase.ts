/**
 * Plan Phase Module
 *
 * Runs a quick read-only planning container before the execution container.
 * The plan output is captured as text and injected into the execution prompt.
 * Plan is written to stdout only - never committed to git.
 */

import { spawnContainerAgent } from './docker-sandbox'
import { buildPrompt } from './prompt-templates'
import { loadSettings } from './settings-manager'
import { devLog } from './dev-log'
import { logger, LogContext } from './logger'

export interface PlanPhaseConfig {
  taskDescription: string
  worktreePath: string
  image: string
  planDir?: string
  planId?: string
  guidance?: string
  sharedCacheDir?: string
  sharedModCacheDir?: string
  onChunk?: (text: string) => void  // Stream plan text chunks to UI as they arrive
}

export interface PlanPhaseResult {
  success: boolean
  plan: string | null
  durationMs: number
  error?: string
}

/**
 * Run a read-only planning phase in a Docker container.
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
    const settings = await loadSettings()

    if (!settings.planPhase?.enabled) {
      logger.info('agent', 'Plan phase disabled in settings, skipping', logCtx)
      return { success: false, plan: null, durationMs: 0 }
    }

    const timeoutMs = settings.planPhase.timeoutMs || 300000

    // Build the plan-mode prompt
    const guidanceSection = config.guidance
      ? `\n=== REPOSITORY GUIDANCE ===\nFollow these repo-specific guidelines:\n${config.guidance}\n`
      : ''

    const planPrompt = await buildPrompt('plan_phase', {
      taskDescription: config.taskDescription,
      guidance: guidanceSection,
    })

    logger.info('agent', 'Starting plan phase container', logCtx, {
      timeoutMs,
      promptLength: planPrompt.length,
      hasOnChunk: !!config.onChunk,
    })

    // Spawn a plan-mode container (read-only, text output)
    const container = await spawnContainerAgent({
      image: config.image,
      workingDir: config.worktreePath,
      planDir: config.planDir,
      planId: config.planId,
      prompt: planPrompt,
      mode: 'plan',
      sharedCacheDir: config.sharedCacheDir,
      sharedModCacheDir: config.sharedModCacheDir,
    })

    logger.info('agent', 'Plan phase container spawned, waiting for stdout', logCtx)

    // Collect stdout text and stream to UI
    let planText = ''
    let chunkCount = 0
    let firstChunkTime: number | null = null
    container.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      planText += text
      chunkCount++
      if (!firstChunkTime) {
        firstChunkTime = Date.now()
        logger.info('agent', 'Plan phase first stdout chunk received', logCtx, {
          timeSinceStartMs: firstChunkTime - startTime,
          chunkLength: text.length,
          preview: text.substring(0, 200),
        })
      } else {
        logger.debug('agent', 'Plan phase stdout chunk', logCtx, {
          chunkNumber: chunkCount,
          chunkLength: text.length,
          totalLength: planText.length,
          preview: text.substring(0, 100),
        })
      }
      config.onChunk?.(text)
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
            bytesReceived: planText.length,
          })
          await container.stop()
          reject(new Error('Plan phase timed out'))
        }, timeoutMs)
      }),
    ])

    const durationMs = Date.now() - startTime

    if (exitCode !== 0) {
      logger.warn('agent', 'Plan phase container exited with non-zero code', logCtx, {
        exitCode,
        durationMs,
        chunksReceived: chunkCount,
        stdoutLength: planText.length,
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

    const trimmedPlan = planText.trim()
    if (!trimmedPlan) {
      logger.warn('agent', 'Plan phase produced empty output', logCtx, {
        durationMs,
        chunksReceived: chunkCount,
        rawLength: planText.length,
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
      planLength: trimmedPlan.length,
      chunksReceived: chunkCount,
      firstChunkDelayMs: firstChunkTime ? firstChunkTime - startTime : null,
    })

    return {
      success: true,
      plan: trimmedPlan,
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
