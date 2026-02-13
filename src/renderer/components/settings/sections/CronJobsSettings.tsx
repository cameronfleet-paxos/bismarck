import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Pencil, Trash2, CheckCircle2, XCircle, AlertTriangle, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Switch } from '@/renderer/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { WorkflowEditor } from '@/renderer/components/workflow/WorkflowEditor'
import type { CronJob, CronJobRun } from '@/shared/cron-types'
import { describeCronExpression } from '@/shared/cron-utils'

interface CronJobsSettingsProps {
  onSettingsChange?: () => void
}

export function CronJobsSettings({ onSettingsChange }: CronJobsSettingsProps) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [loading, setLoading] = useState(true)
  const [editingJobId, setEditingJobId] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [runningJobIds, setRunningJobIds] = useState<Set<string>>(new Set())
  const [nextRunTimes, setNextRunTimes] = useState<Record<string, string | null>>({})
  const [runsModalJobId, setRunsModalJobId] = useState<string | null>(null)
  const [runs, setRuns] = useState<CronJobRun[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  const loadJobs = useCallback(async () => {
    try {
      const loaded = await window.electronAPI.getCronJobs()
      setJobs(loaded)

      // Calculate next run times
      const times: Record<string, string | null> = {}
      for (const job of loaded) {
        if (job.enabled) {
          times[job.id] = await window.electronAPI.getNextCronRunTime(job.schedule)
        }
      }
      setNextRunTimes(times)
    } catch (error) {
      console.error('Failed to load cron jobs:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs()

    // Listen for cron job events
    window.electronAPI.onCronJobStarted?.((data) => {
      setRunningJobIds(prev => new Set([...prev, data.jobId]))
    })
    window.electronAPI.onCronJobCompleted?.((data) => {
      setRunningJobIds(prev => {
        const next = new Set(prev)
        next.delete(data.jobId)
        return next
      })
      loadJobs()
    })

    return () => {
      window.electronAPI.removeCronJobListeners?.()
    }
  }, [loadJobs])

  // Refresh next run times every minute
  useEffect(() => {
    const interval = setInterval(() => {
      loadJobs()
    }, 60000)
    return () => clearInterval(interval)
  }, [loadJobs])

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleCronJobEnabled(id, enabled)
      await loadJobs()
      onSettingsChange?.()
    } catch (error) {
      console.error('Failed to toggle cron job:', error)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.electronAPI.deleteCronJob(id)
      setDeleteConfirmId(null)
      await loadJobs()
      onSettingsChange?.()
    } catch (error) {
      console.error('Failed to delete cron job:', error)
    }
  }

  const handleRunNow = async (id: string) => {
    try {
      setRunningJobIds(prev => new Set([...prev, id]))
      await window.electronAPI.runCronJobNow(id)
      await loadJobs()
    } catch (error) {
      console.error('Failed to run cron job:', error)
    } finally {
      setRunningJobIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleShowRuns = async (jobId: string) => {
    setRunsModalJobId(jobId)
    setRunsLoading(true)
    try {
      const jobRuns = await window.electronAPI.getCronJobRuns(jobId)
      setRuns(jobRuns.reverse()) // Most recent first
    } catch (error) {
      console.error('Failed to load runs:', error)
    } finally {
      setRunsLoading(false)
    }
  }

  const handleEditorSave = async () => {
    setEditingJobId(null)
    setCreatingNew(false)
    await loadJobs()
    onSettingsChange?.()
  }

  const handleEditorCancel = () => {
    setEditingJobId(null)
    setCreatingNew(false)
  }

  const formatRelativeTime = (isoString: string): string => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHr = Math.floor(diffMin / 60)
    const diffDays = Math.floor(diffHr / 24)

    if (diffMs < 0) {
      // Future time
      const absDiffMin = Math.floor(-diffMs / 60000)
      const absDiffHr = Math.floor(absDiffMin / 60)
      if (absDiffMin < 1) return 'in <1 min'
      if (absDiffMin < 60) return `in ${absDiffMin} min`
      if (absDiffHr < 24) return `in ${absDiffHr}h ${absDiffMin % 60}m`
      return `in ${Math.floor(absDiffHr / 24)}d`
    }

    if (diffSec < 60) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHr < 24) return `${diffHr}h ago`
    return `${diffDays}d ago`
  }

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'partial':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  // Workflow editor view
  if (editingJobId || creatingNew) {
    return (
      <WorkflowEditor
        jobId={editingJobId ?? undefined}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading cron jobs...</div>
      </div>
    )
  }

  return (
    <div data-testid="cron-jobs-section" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Cron Job Automations</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule automated workflows to run on a cron schedule. Jobs only run while Bismarck is open.
          </p>
        </div>
        <Button
          data-testid="new-automation-button"
          onClick={() => setCreatingNew(true)}
          size="sm"
        >
          <Plus className="h-4 w-4 mr-1" />
          New Automation
        </Button>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-card border rounded-lg p-8 text-center">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No cron jobs yet. Create one to schedule automated workflows.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Use CMD+K &gt; &quot;Cron: Headless Agent&quot; for a quick single-agent schedule.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const isRunning = runningJobIds.has(job.id)
            return (
              <div
                key={job.id}
                data-testid={`cron-job-row-${job.id}`}
                className={`bg-card border rounded-lg p-4 ${!job.enabled ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-4">
                  {/* Name and schedule */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{job.name}</span>
                      {isRunning && (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Running
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {describeCronExpression(job.schedule)}
                      <span className="text-muted-foreground/50 ml-2">({job.schedule})</span>
                    </div>
                  </div>

                  {/* Last run */}
                  <div className="text-right shrink-0">
                    {job.lastRunAt ? (
                      <button
                        onClick={() => handleShowRuns(job.id)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                      >
                        {getStatusIcon(job.lastRunStatus)}
                        {formatRelativeTime(job.lastRunAt)}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never run</span>
                    )}
                    {job.enabled && nextRunTimes[job.id] && (
                      <div className="text-xs text-muted-foreground/70 mt-0.5">
                        Next: {formatRelativeTime(nextRunTimes[job.id]!)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      data-testid={`run-now-${job.id}`}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => handleRunNow(job.id)}
                      disabled={isRunning}
                      title="Run now"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setEditingJobId(job.id)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => setDeleteConfirmId(job.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Switch
                      data-testid={`cron-job-toggle-${job.id}`}
                      checked={job.enabled}
                      onCheckedChange={(checked) => handleToggle(job.id, checked)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmId !== null} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Cron Job</DialogTitle>
            <DialogDescription>
              This will permanently delete the cron job and all run history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run history modal */}
      <Dialog open={runsModalJobId !== null} onOpenChange={() => setRunsModalJobId(null)}>
        <DialogContent className="max-w-lg max-h-[60vh]">
          <DialogHeader>
            <DialogTitle>Run History</DialogTitle>
            <DialogDescription>
              {jobs.find(j => j.id === runsModalJobId)?.name ?? 'Cron Job'} - Last 100 runs
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-80 space-y-2">
            {runsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No runs yet
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="border rounded p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(run.status)}
                      <span className="capitalize">{run.status}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                  </div>
                  {run.completedAt && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s
                    </div>
                  )}
                  {Object.values(run.nodeResults).some(r => r.error) && (
                    <div className="mt-2 space-y-1">
                      {Object.values(run.nodeResults)
                        .filter(r => r.error)
                        .map(r => (
                          <div key={r.nodeId} className="text-xs text-red-400 font-mono bg-red-500/10 p-1.5 rounded">
                            {r.error}
                          </div>
                        ))
                      }
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
