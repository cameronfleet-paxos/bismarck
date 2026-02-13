import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import { logger, type LogContext } from '../logger'
import { getPlanById, getWorkspaces } from '../config'
import { getPlanDir, type BeadTask } from '../bd-client'
import { HeadlessAgent } from '../headless'
import { getSelectedDockerImage } from '../settings-manager'
import { getPreferences } from '../state-manager'
import { buildPrompt } from '../prompt-templates'
import type { HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent } from '../../shared/types'
import { addPlanActivity } from './events'
import { isArchitectRunning, setArchitectRunning } from './state'
import { headlessAgents, headlessAgentInfo } from '../headless/state'
import { emitHeadlessAgentUpdate, emitHeadlessAgentEvent } from '../headless/events'

/**
 * Spawn an Architect agent to decompose tasks labeled `needs-architect`.
 * The Architect is ephemeral - it runs once per batch of tasks and exits.
 * It gets read access to the codebase via --add-dir so it can analyze code structure.
 */
export async function spawnArchitect(planId: string, tasks: BeadTask[]): Promise<void> {
  if (isArchitectRunning(planId)) return

  const plan = getPlanById(planId)
  if (!plan) return

  setArchitectRunning(planId, true)
  const logCtx: LogContext = { planId }

  const planDir = getPlanDir(planId)
  const memoryDir = path.join(planDir, 'architect-memories')

  // Ensure memory directory exists
  try {
    await fs.mkdir(memoryDir, { recursive: true })
  } catch { /* ignore */ }

  // Find the reference agent directory for codebase access
  const allAgents = getWorkspaces()
  const referenceAgent = plan.referenceAgentId
    ? allAgents.find(a => a.id === plan.referenceAgentId)
    : null
  const codebasePath = referenceAgent?.directory

  // Build task list string
  const taskList = tasks.map(t => `- ${t.id}: ${t.title}`).join('\n')

  const prompt = await buildPrompt('architect', {
    taskList,
    memoryPath: '/plan-output/architect-memories',
    planDescription: plan.description,
    planTitle: plan.title,
    planId: plan.id,
    codebasePath: codebasePath ? '/workspace' : undefined,
  })

  const taskId = `architect-${crypto.randomUUID().substring(0, 8)}`

  // Create headless agent info for tracking
  const agentInfo: HeadlessAgentInfo = {
    id: `headless-${taskId}`,
    taskId,
    planId,
    status: 'starting',
    worktreePath: planDir,
    events: [],
    startedAt: new Date().toISOString(),
    model: getPreferences().agentModel || 'sonnet',
    originalPrompt: prompt,
    agentType: 'architect',
  }
  headlessAgentInfo.set(taskId, agentInfo)
  emitHeadlessAgentUpdate(agentInfo)

  const agent = new HeadlessAgent()
  headlessAgents.set(taskId, agent)

  agent.on('status', (status: HeadlessAgentStatus) => {
    agentInfo.status = status
    emitHeadlessAgentUpdate(agentInfo)
  })

  agent.on('event', (event: StreamEvent) => {
    agentInfo.events.push(event)
    emitHeadlessAgentEvent(planId, taskId, event)
  })

  agent.on('complete', (result) => {
    logger.info('agent', 'Architect agent complete', logCtx, {
      success: result.success,
      exitCode: result.exitCode,
    })

    agentInfo.status = result.success ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setArchitectRunning(planId, false)

    if (result.success) {
      addPlanActivity(planId, 'success', `Architect decomposed ${tasks.length} task(s)`)
    } else {
      addPlanActivity(planId, 'warning', 'Architect agent failed', result.error)
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setArchitectRunning(planId, false)
    addPlanActivity(planId, 'warning', 'Architect agent error', error.message)
  })

  const selectedImage = await getSelectedDockerImage()
  const agentModel = getPreferences().agentModel || 'sonnet'

  // Build claude flags - architect gets code access via --add-dir
  const claudeFlags = ['--model', agentModel, '--allowedTools', 'Bash(bd --sandbox *),Bash(bd *)']
  if (codebasePath) {
    claudeFlags.push('--add-dir', '/workspace')
  }

  try {
    await agent.start({
      prompt,
      worktreePath: codebasePath || planDir,
      planDir,
      planId,
      taskId,
      image: selectedImage,
      claudeFlags,
      planOutputDir: planDir,
    })

    addPlanActivity(planId, 'info', `Architect spawned to decompose ${tasks.length} task(s)`)
    logger.info('plan', 'Architect agent started', logCtx, { taskCount: tasks.length })
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setArchitectRunning(planId, false)
    addPlanActivity(planId, 'warning', 'Failed to start Architect agent',
      error instanceof Error ? error.message : 'Unknown error')
  }
}
