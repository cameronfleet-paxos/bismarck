import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import { logger, type LogContext } from '../logger'
import { getPlanById, getWorkspaces } from '../config'
import { getPlanDir, type BeadTask } from '../bd-client'
import { HeadlessAgent } from '../headless'
import { getSelectedDockerImage } from '../settings-manager'
import { getPreferences } from '../state-manager'
import { getRepositoryById } from '../repository-manager'
import { buildPrompt } from '../prompt-templates'
import type { HeadlessAgentInfo, HeadlessAgentStatus, StreamEvent } from '../../shared/types'
import { addPlanActivity } from './events'
import { isManagerRunning, setManagerRunning } from './state'
import { headlessAgents, headlessAgentInfo } from '../headless/state'
import { emitHeadlessAgentUpdate, emitHeadlessAgentEvent } from '../headless/events'

/**
 * Spawn a Manager agent to triage tasks labeled `needs-triage`.
 * The Manager is ephemeral - it runs once per batch of triage tasks and exits.
 * It runs in the plan directory (not a code worktree) and only needs bd commands.
 */
export async function spawnManager(planId: string, triageTasks: BeadTask[]): Promise<void> {
  if (isManagerRunning(planId)) return

  const plan = getPlanById(planId)
  if (!plan) return

  setManagerRunning(planId, true)
  const logCtx: LogContext = { planId }

  const planDir = getPlanDir(planId)
  const memoryDir = path.join(planDir, 'manager-memories')

  // Ensure memory directory exists
  try {
    await fs.mkdir(memoryDir, { recursive: true })
  } catch { /* ignore */ }

  // Build task list string
  const taskList = triageTasks.map(t => `- ${t.id}: ${t.title}`).join('\n')

  // Resolve reference repo name for assignment labels
  const allAgents = getWorkspaces()
  const referenceAgent = plan.referenceAgentId
    ? allAgents.find(a => a.id === plan.referenceAgentId)
    : null
  let referenceRepoName = 'default'
  if (referenceAgent?.repositoryId) {
    const repo = await getRepositoryById(referenceAgent.repositoryId)
    if (repo) referenceRepoName = repo.name
  }

  const prompt = await buildPrompt('manager', {
    taskList,
    memoryPath: '/plan-output/manager-memories',
    planDescription: plan.description,
    planTitle: plan.title,
    planId: plan.id,
    referenceRepoName,
  })

  const taskId = `manager-${crypto.randomUUID().substring(0, 8)}`

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
    agentType: 'manager',
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
    logger.info('agent', 'Manager agent complete', logCtx, {
      success: result.success,
      exitCode: result.exitCode,
    })

    agentInfo.status = result.success ? 'completed' : 'failed'
    agentInfo.completedAt = new Date().toISOString()
    agentInfo.result = result
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setManagerRunning(planId, false)

    if (result.success) {
      addPlanActivity(planId, 'success', `Manager triaged ${triageTasks.length} task(s)`)
    } else {
      addPlanActivity(planId, 'warning', 'Manager agent failed', result.error)
    }
  })

  agent.on('error', (error: Error) => {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setManagerRunning(planId, false)
    addPlanActivity(planId, 'warning', 'Manager agent error', error.message)
  })

  const selectedImage = await getSelectedDockerImage()
  const agentModel = getPreferences().agentModel || 'sonnet'

  try {
    await agent.start({
      prompt,
      worktreePath: planDir,
      planDir,
      planId,
      taskId,
      image: selectedImage,
      claudeFlags: ['--model', agentModel, '--allowedTools', 'Bash(bd --sandbox *),Bash(bd *)'],
      planOutputDir: planDir,
    })

    addPlanActivity(planId, 'info', `Manager spawned to triage ${triageTasks.length} task(s)`)
    logger.info('plan', 'Manager agent started', logCtx, { taskCount: triageTasks.length })
  } catch (error) {
    agentInfo.status = 'failed'
    agentInfo.completedAt = new Date().toISOString()
    emitHeadlessAgentUpdate(agentInfo)

    headlessAgents.delete(taskId)
    setManagerRunning(planId, false)
    addPlanActivity(planId, 'warning', 'Failed to start Manager agent',
      error instanceof Error ? error.message : 'Unknown error')
  }
}
