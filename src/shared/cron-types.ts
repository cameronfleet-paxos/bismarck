// Cron Job Automations - Shared Type Definitions

export type WorkflowNodeType = 'headless-agent' | 'ralph-loop' | 'shell-command'

export interface HeadlessAgentNodeData {
  referenceAgentId: string
  prompt: string
  model: 'opus' | 'sonnet' | 'haiku'
  planPhase: boolean
}

export interface RalphLoopNodeData {
  referenceAgentId: string
  prompt: string
  completionPhrase: string
  maxIterations: number
  model: 'opus' | 'sonnet'
}

export interface ShellCommandNodeData {
  command: string
  workingDirectory: string
  timeout: number // seconds
}

export type WorkflowNodeData = HeadlessAgentNodeData | RalphLoopNodeData | ShellCommandNodeData

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  position: { x: number; y: number }
  data: WorkflowNodeData
  label?: string
}

export interface WorkflowEdge {
  id: string
  source: string // node id
  target: string // node id
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type CronJobRunStatus = 'success' | 'failed' | 'partial' | 'running'

export interface NodeExecutionResult {
  nodeId: string
  status: 'success' | 'failed' | 'skipped' | 'running' | 'pending'
  startedAt?: string
  completedAt?: string
  error?: string
  output?: string
}

export interface CronJobRun {
  id: string
  cronJobId: string
  startedAt: string
  completedAt?: string
  status: CronJobRunStatus
  nodeResults: Record<string, NodeExecutionResult>
}

export interface CronJob {
  id: string
  name: string
  schedule: string // cron expression
  enabled: boolean
  workflowGraph: WorkflowGraph
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastRunStatus?: CronJobRunStatus
}

export interface CronJobWithRuns extends CronJob {
  runs: CronJobRun[]
}

// Schedule presets for the UI
export interface SchedulePreset {
  label: string
  cron: string
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly (Monday 9am)', cron: '0 9 * * 1' },
]
