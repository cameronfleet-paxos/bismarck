/**
 * Cron Job Manager - CRUD operations for cron jobs
 * Persists jobs to ~/.bismarck/cron-jobs/<id>.json
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { getConfigDir } from './config'
import type { CronJob, CronJobRun, WorkflowGraph } from '../shared/cron-types'

// In-memory cache
const jobCache: Map<string, CronJob> = new Map()
let cacheLoaded = false

function getCronJobsDir(): string {
  return path.join(getConfigDir(), 'cron-jobs')
}

function getCronJobPath(id: string): string {
  return path.join(getCronJobsDir(), `${id}.json`)
}

function getRunsPath(id: string): string {
  return path.join(getCronJobsDir(), id, 'runs.json')
}

export function ensureCronJobsDir(): void {
  const dir = getCronJobsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function generateId(): string {
  return crypto.randomUUID()
}

export function loadCronJob(id: string): CronJob | null {
  // Check cache first
  if (jobCache.has(id)) {
    return jobCache.get(id)!
  }

  const filePath = getCronJobPath(id)
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    const job = JSON.parse(data) as CronJob
    jobCache.set(id, job)
    return job
  } catch (error) {
    console.error(`Failed to load cron job ${id}:`, error)
    return null
  }
}

export function loadAllCronJobs(): CronJob[] {
  if (cacheLoaded) {
    return Array.from(jobCache.values())
  }

  ensureCronJobsDir()
  const dir = getCronJobsDir()
  const jobs: CronJob[] = []

  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(dir, file)
        try {
          const stat = fs.statSync(filePath)
          if (stat.isFile()) {
            const data = fs.readFileSync(filePath, 'utf-8')
            const job = JSON.parse(data) as CronJob
            jobs.push(job)
            jobCache.set(job.id, job)
          }
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Directory doesn't exist yet, return empty
  }

  cacheLoaded = true
  return jobs
}

function saveCronJobToFile(job: CronJob): void {
  ensureCronJobsDir()
  const filePath = getCronJobPath(job.id)
  const tempPath = filePath + '.tmp'

  // Atomic write: write to temp file then rename
  fs.writeFileSync(tempPath, JSON.stringify(job, null, 2), 'utf-8')
  fs.renameSync(tempPath, filePath)

  // Update cache
  jobCache.set(job.id, job)
}

export function createCronJob(data: {
  name: string
  schedule: string
  enabled: boolean
  workflowGraph: WorkflowGraph
}): CronJob {
  const now = new Date().toISOString()
  const job: CronJob = {
    id: generateId(),
    name: data.name,
    schedule: data.schedule,
    enabled: data.enabled,
    workflowGraph: data.workflowGraph,
    createdAt: now,
    updatedAt: now,
  }

  saveCronJobToFile(job)
  return job
}

export function updateCronJob(
  id: string,
  updates: Partial<Pick<CronJob, 'name' | 'schedule' | 'enabled' | 'workflowGraph' | 'lastRunAt' | 'lastRunStatus'>>
): CronJob | null {
  const job = loadCronJob(id)
  if (!job) return null

  const updated: CronJob = {
    ...job,
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  saveCronJobToFile(updated)
  return updated
}

export function deleteCronJob(id: string): boolean {
  const filePath = getCronJobPath(id)
  const runsDir = path.join(getCronJobsDir(), id)

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    // Also delete runs directory
    if (fs.existsSync(runsDir)) {
      fs.rmSync(runsDir, { recursive: true, force: true })
    }
    jobCache.delete(id)
    return true
  } catch (error) {
    console.error(`Failed to delete cron job ${id}:`, error)
    return false
  }
}

export function getCronJobRuns(cronJobId: string): CronJobRun[] {
  const runsPath = getRunsPath(cronJobId)
  if (!fs.existsSync(runsPath)) {
    return []
  }

  try {
    const data = fs.readFileSync(runsPath, 'utf-8')
    return JSON.parse(data) as CronJobRun[]
  } catch {
    return []
  }
}

export function saveCronJobRun(cronJobId: string, run: CronJobRun): void {
  const runsDir = path.join(getCronJobsDir(), cronJobId)
  if (!fs.existsSync(runsDir)) {
    fs.mkdirSync(runsDir, { recursive: true })
  }

  const runsPath = getRunsPath(cronJobId)
  let runs = getCronJobRuns(cronJobId)

  // Append run, keep last 100
  runs.push(run)
  if (runs.length > 100) {
    runs = runs.slice(-100)
  }

  const tempPath = runsPath + '.tmp'
  fs.writeFileSync(tempPath, JSON.stringify(runs, null, 2), 'utf-8')
  fs.renameSync(tempPath, runsPath)
}
