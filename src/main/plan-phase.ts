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

  try {
    const settings = await loadSettings()

    if (!settings.planPhase?.enabled) {
      devLog('[PlanPhase] Plan phase disabled in settings, skipping')
      return { success: false, plan: null, durationMs: 0 }
    }

    const timeoutMs = settings.planPhase.timeoutMs || 120000

    // Build the plan-mode prompt
    const guidanceSection = config.guidance
      ? `\n=== REPOSITORY GUIDANCE ===\nFollow these repo-specific guidelines:\n${config.guidance}\n`
      : ''

    const planPrompt = await buildPrompt('plan_phase', {
      taskDescription: config.taskDescription,
      guidance: guidanceSection,
    })

    devLog('[PlanPhase] Starting plan phase container', {
      worktreePath: config.worktreePath,
      timeoutMs,
      promptLength: planPrompt.length,
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

    // Collect stdout text and stream to UI
    let planText = ''
    container.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      planText += text
      config.onChunk?.(text)
    })

    // Collect stderr for debugging
    let stderrText = ''
    container.stderr.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString()
    })

    // Wait for exit with timeout
    const exitCode = await Promise.race([
      container.wait(),
      new Promise<number>((_, reject) => {
        setTimeout(async () => {
          devLog('[PlanPhase] Plan phase timed out, stopping container')
          await container.stop()
          reject(new Error('Plan phase timed out'))
        }, timeoutMs)
      }),
    ])

    const durationMs = Date.now() - startTime

    if (exitCode !== 0) {
      devLog('[PlanPhase] Plan phase container exited with non-zero code', {
        exitCode,
        durationMs,
        stderrLength: stderrText.length,
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
      devLog('[PlanPhase] Plan phase produced empty output')
      return {
        success: false,
        plan: null,
        durationMs,
        error: 'Plan phase produced empty output',
      }
    }

    devLog('[PlanPhase] Plan phase completed successfully', {
      durationMs,
      planLength: trimmedPlan.length,
    })

    return {
      success: true,
      plan: trimmedPlan,
      durationMs,
    }
  } catch (error) {
    const durationMs = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)
    devLog('[PlanPhase] Plan phase failed', { error: errorMessage, durationMs })
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
