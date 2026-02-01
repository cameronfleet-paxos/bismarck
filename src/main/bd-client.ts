import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ExecOptions } from 'child_process'
import { logger } from './logger'
import { execWithPath } from './exec-utils'
import type { BeadTask } from '../shared/types'

// Re-export BeadTask for convenience
export type { BeadTask }

// Use shared exec utility with extended PATH
const execAsync = (command: string, options?: ExecOptions) => execWithPath(command, options)

/**
 * Get the plan-specific directory path
 */
export function getPlanDir(planId: string): string {
  return path.join(os.homedir(), '.bismarck', 'plans', planId)
}

/**
 * Ensure the beads repository exists for a specific plan
 * Auto-initializes on first use
 * Returns the plan directory path
 */
export async function ensureBeadsRepo(planId: string): Promise<string> {
  const planDir = getPlanDir(planId)
  const beadsDir = path.join(planDir, '.beads')

  // Check for .beads directory specifically, not just plan directory
  // (plan directory may be created by other code like savePlanActivities)
  if (!fs.existsSync(beadsDir)) {
    logger.info('bd', 'Initializing beads repository', { planId })

    // Ensure plan directory exists
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true })
    }

    // Initialize git repo if not already
    const gitDir = path.join(planDir, '.git')
    if (!fs.existsSync(gitDir)) {
      await execAsync('git init', { cwd: planDir })
      logger.debug('bd', 'Initialized git repo for plan', { planId })
    }

    // Initialize beads with bismarck prefix
    const { stdout, stderr } = await execAsync('bd --sandbox init --prefix bismarck', { cwd: planDir })
    logger.info('bd', 'Beads repository initialized', { planId }, { stdout: stdout.substring(0, 100) })

    // Create .claude directory and settings.json to pre-allow bd commands
    const claudeDir = path.join(planDir, '.claude')
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true })
    }

    const settingsPath = path.join(claudeDir, 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      const settings = {
        permissions: {
          allow: [
            'Bash(bd *)',
            'Bash(bd --sandbox *)',
            `Read(${planDir}/**)`,
            `Edit(${planDir}/**)`
          ]
        }
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    }
  }
  return planDir
}

/**
 * Create a new bd task or epic
 */
export async function bdCreate(planId: string, opts: {
  title: string
  type?: 'epic' | 'task'
  parent?: string
  assignee?: string
  labels?: string[]
}): Promise<string> {
  const planDir = await ensureBeadsRepo(planId)

  let cmd = `bd --sandbox create`

  if (opts.type === 'epic') {
    cmd += ' --type epic'
  }

  if (opts.parent) {
    cmd += ` --parent ${opts.parent}`
  }

  cmd += ` "${opts.title.replace(/"/g, '\\"')}"`

  logger.debug('bd', `Executing: ${cmd}`, { planId })
  const { stdout, stderr } = await execAsync(cmd, { cwd: planDir })

  // Parse task ID from output (typically format: "Created task: <id>")
  const match = stdout.match(/([a-zA-Z0-9-]+)\s*$/m)
  const taskId = match ? match[1].trim() : stdout.trim()

  logger.info('bd', `Created ${opts.type || 'task'}: ${taskId}`, { planId, taskId }, { title: opts.title })

  // Apply assignee and labels if provided
  if (opts.assignee || (opts.labels && opts.labels.length > 0)) {
    await bdUpdate(planId, taskId, { assignee: opts.assignee, addLabels: opts.labels })
  }

  return taskId
}

/**
 * List bd tasks with optional filters
 */
export async function bdList(planId: string, opts?: {
  parent?: string
  status?: 'open' | 'closed' | 'all'
  labels?: string[]
  recursive?: boolean  // If true, fetches all tasks including children
}): Promise<BeadTask[]> {
  const planDir = await ensureBeadsRepo(planId)

  let cmd = 'bd --sandbox list --json --limit 0'  // No limit to get all results

  if (opts?.parent) {
    cmd += ` --parent ${opts.parent}`
  }

  // Add --all flag when status is 'all' or undefined (for status checks that need all tasks)
  if (opts?.status === 'all' || opts?.status === undefined) {
    cmd += ' --all'
  } else if (opts?.status === 'closed') {
    cmd += ' --status closed'
  } else if (opts?.status === 'open') {
    cmd += ' --status open'
  }

  if (opts?.labels && opts.labels.length > 0) {
    for (const label of opts.labels) {
      cmd += ` --label ${label}`
    }
  }

  logger.debug('bd', `Executing: ${cmd}`, { planId })

  try {
    const { stdout, stderr } = await execAsync(cmd, { cwd: planDir })

    if (!stdout.trim()) {
      logger.debug('bd', 'List returned empty', { planId })
      return []
    }

    // Parse JSON output from bd and map fields to our interface
    const rawTasks = JSON.parse(stdout)
    if (!Array.isArray(rawTasks)) {
      logger.warn('bd', 'List returned non-array', { planId }, { stdout: stdout.substring(0, 100) })
      return []
    }

    logger.debug('bd', `List returned ${rawTasks.length} tasks`, { planId }, { labels: opts?.labels, status: opts?.status })

    // Map bd's field names to our interface
    return rawTasks.map((task: Record<string, unknown>) => {
      // Extract blockedBy from dependencies array
      // Dependencies with type "blocks" mean this task is blocked by depends_on_id
      let blockedBy: string[] | undefined
      const dependencies = task.dependencies as Array<{ type: string; depends_on_id: string }> | undefined
      if (dependencies && Array.isArray(dependencies)) {
        const blockers = dependencies
          .filter(dep => dep.type === 'blocks')
          .map(dep => dep.depends_on_id)
        if (blockers.length > 0) {
          blockedBy = blockers
        }
      }

      return {
        id: task.id as string,
        title: task.title as string,
        status: task.status as 'open' | 'closed',
        type: task.issue_type as 'epic' | 'task' | undefined,  // bd uses issue_type
        parent: task.parent as string | undefined,
        assignee: task.owner as string | undefined,  // bd uses owner
        labels: task.labels as string[] | undefined,
        blockedBy,
      }
    })
  } catch (error) {
    // If bd list fails (e.g., no tasks), return empty array
    logger.error('bd', 'List failed', { planId }, { error: error instanceof Error ? error.message : 'Unknown error' })
    return []
  }
}

/**
 * Update a bd task
 */
export async function bdUpdate(planId: string, id: string, opts: {
  assignee?: string
  addLabels?: string[]
  removeLabels?: string[]
  title?: string
}): Promise<void> {
  const planDir = await ensureBeadsRepo(planId)

  let cmd = `bd --sandbox update ${id}`

  if (opts.assignee) {
    cmd += ` --assignee "${opts.assignee.replace(/"/g, '\\"')}"`
  }

  if (opts.addLabels && opts.addLabels.length > 0) {
    for (const label of opts.addLabels) {
      cmd += ` --add-label ${label}`
    }
  }

  if (opts.removeLabels && opts.removeLabels.length > 0) {
    for (const label of opts.removeLabels) {
      cmd += ` --remove-label ${label}`
    }
  }

  if (opts.title) {
    cmd += ` --title "${opts.title.replace(/"/g, '\\"')}"`
  }

  logger.debug('bd', `Executing: ${cmd}`, { planId, taskId: id })
  const { stdout, stderr } = await execAsync(cmd, { cwd: planDir })
  logger.info('bd', `Updated task ${id}`, { planId, taskId: id }, { addLabels: opts.addLabels, removeLabels: opts.removeLabels })
}

/**
 * Close a bd task
 */
export async function bdClose(planId: string, id: string): Promise<void> {
  const planDir = await ensureBeadsRepo(planId)
  logger.debug('bd', `Closing task ${id}`, { planId, taskId: id })
  await execAsync(`bd --sandbox close ${id}`, { cwd: planDir })
  logger.info('bd', `Closed task ${id}`, { planId, taskId: id })
}

/**
 * Get a single task by ID
 */
export async function bdGet(planId: string, id: string): Promise<BeadTask | null> {
  const planDir = await ensureBeadsRepo(planId)

  try {
    const { stdout } = await execAsync(`bd --sandbox show ${id} --json`, { cwd: planDir })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

/**
 * Add a dependency: taskId is blocked by blockedBy
 */
export async function bdAddDependency(planId: string, taskId: string, blockedBy: string): Promise<void> {
  const planDir = await ensureBeadsRepo(planId)
  logger.debug('bd', `Adding dependency: ${taskId} blocked by ${blockedBy}`, { planId, taskId })
  await execAsync(`bd --sandbox dep ${blockedBy} --blocks ${taskId}`, { cwd: planDir })
  logger.info('bd', `Added dependency: ${taskId} <- ${blockedBy}`, { planId, taskId })
}

/**
 * Get dependents of a task (tasks that depend on this one / are blocked by it)
 */
export async function bdGetDependents(planId: string, taskId: string): Promise<string[]> {
  const planDir = await ensureBeadsRepo(planId)

  try {
    logger.debug('bd', `Getting dependents for task ${taskId}`, { planId, taskId })
    const { stdout } = await execAsync(`bd --sandbox dep list ${taskId} --direction=up --json`, { cwd: planDir })

    if (!stdout.trim()) {
      logger.debug('bd', `No dependents found for ${taskId}`, { planId, taskId })
      return []
    }

    // Parse JSON output - expects array of task objects or IDs
    const result = JSON.parse(stdout)
    if (Array.isArray(result)) {
      // If it's an array of objects with id field, extract IDs
      const dependents = result.map((item: { id?: string } | string) =>
        typeof item === 'string' ? item : item.id || ''
      ).filter(Boolean)
      logger.debug('bd', `Found ${dependents.length} dependents for ${taskId}`, { planId, taskId }, { dependents })
      return dependents
    }
    return []
  } catch (error) {
    // If command fails (no dependencies), return empty array
    logger.debug('bd', `No dependents for ${taskId} (command failed)`, { planId, taskId })
    return []
  }
}
