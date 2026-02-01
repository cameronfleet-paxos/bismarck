import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Check, X, Loader2, Activity, GitBranch, GitPullRequest, Clock, CheckCircle2, AlertCircle, ExternalLink, GitCommit, MessageSquare, Play, FileText, Network, Plus } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { TaskCard } from '@/renderer/components/TaskCard'
import { DependencyProgressBar } from '@/renderer/components/DependencyProgressBar'
import { DependencyGraphModal } from '@/renderer/components/DependencyGraphModal'
import { buildDependencyGraph, calculateGraphStats } from '@/renderer/utils/build-dependency-graph'
import type { Plan, TaskAssignment, Agent, PlanActivity, DependencyGraph, GraphStats, BeadTask } from '@/shared/types'

interface PlanDetailViewProps {
  plan: Plan
  activities: PlanActivity[]
  taskAssignments: TaskAssignment[]
  agents: Agent[]
  onBack: () => void
  onComplete: () => Promise<void>
  onCancel: () => Promise<void>
  onCancelDiscussion?: () => Promise<void>
  onExecute?: (referenceAgentId: string) => void
  onRequestFollowUps?: () => Promise<void>
}

const statusIcons: Record<Plan['status'], React.ReactNode> = {
  draft: <Clock className="h-3 w-3 text-muted-foreground" />,
  discussing: <MessageSquare className="h-3 w-3 text-purple-500 animate-pulse" />,
  discussed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  delegating: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
  in_progress: <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" />,
  ready_for_review: <CheckCircle2 className="h-3 w-3 text-purple-500" />,
  completed: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  failed: <AlertCircle className="h-3 w-3 text-red-500" />,
}

const statusLabels: Record<Plan['status'], string> = {
  draft: 'Draft',
  discussing: 'Discussing',
  discussed: 'Ready to Execute',
  delegating: 'Delegating',
  in_progress: 'In Progress',
  ready_for_review: 'Ready for Review',
  completed: 'Completed',
  failed: 'Failed',
}

const statusColors: Record<Plan['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  discussing: 'bg-purple-500/20 text-purple-500',
  discussed: 'bg-green-500/20 text-green-500',
  delegating: 'bg-blue-500/20 text-blue-500',
  in_progress: 'bg-yellow-500/20 text-yellow-500',
  ready_for_review: 'bg-purple-500/20 text-purple-500',
  completed: 'bg-green-500/20 text-green-500',
  failed: 'bg-red-500/20 text-red-500',
}

const activityIcons: Record<PlanActivity['type'], React.ReactNode> = {
  info: <span className="text-muted-foreground">○</span>,
  success: <span className="text-green-500">✓</span>,
  warning: <span className="text-yellow-500">⚠</span>,
  error: <span className="text-red-500">✕</span>,
}

const activityColors: Record<PlanActivity['type'], string> = {
  info: 'text-muted-foreground',
  success: 'text-green-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
}

function formatActivityTime(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function DiscussionOutputSection({ summary, outputPath }: { summary?: string; outputPath: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadContent = async () => {
    if (content !== null) {
      setIsExpanded(!isExpanded)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.readFile(outputPath)
      if (result.success && result.content) {
        setContent(result.content)
        setIsExpanded(true)
      } else {
        setError(result.error || 'Failed to load file')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-3 border-b">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Discussion Output
      </h3>
      {summary && (
        <p className="text-xs text-muted-foreground mb-2">{summary}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={isLoading}
        onClick={loadContent}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Loading...
          </>
        ) : (
          <>
            <FileText className="h-3 w-3 mr-1" />
            {isExpanded ? 'Hide Output' : 'View Full Output'}
          </>
        )}
      </Button>
      {error && (
        <p className="text-xs text-red-500 mt-2">{error}</p>
      )}
      {isExpanded && content && (
        <div className="mt-3 p-2 bg-muted/30 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono">{content}</pre>
        </div>
      )}
    </div>
  )
}

export function PlanDetailView({
  plan,
  activities,
  taskAssignments,
  agents,
  onBack,
  onComplete,
  onCancel,
  onCancelDiscussion,
  onExecute,
  onRequestFollowUps,
}: PlanDetailViewProps) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [isRequestingFollowUps, setIsRequestingFollowUps] = useState(false)
  const [selectedReference, setSelectedReference] = useState<string>(plan.referenceAgentId || '')
  const [beadTasks, setBeadTasks] = useState<BeadTask[]>([])
  const [localAssignments, setLocalAssignments] = useState<TaskAssignment[]>([])
  const [graphModalOpen, setGraphModalOpen] = useState(false)

  // Fetch bead tasks and assignments on mount/plan change
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [tasks, assignments] = await Promise.all([
          window.electronAPI.getBeadTasks(plan.id),
          window.electronAPI.getTaskAssignments(plan.id)
        ])
        console.log('[PlanDetailView] Fetched bead tasks:', tasks.length, tasks.map(t => ({ id: t.id, blockedBy: t.blockedBy })))
        console.log('[PlanDetailView] Fetched assignments:', assignments?.length ?? 0)
        setBeadTasks(tasks)
        setLocalAssignments(assignments || [])
      } catch (err) {
        console.error('Failed to fetch plan data:', err)
      }
    }

    // Only fetch if plan is in a state that has tasks
    if (['delegating', 'in_progress', 'ready_for_review', 'completed', 'failed'].includes(plan.status)) {
      fetchData()
    }
  }, [plan.id, plan.status])

  // Listen for bead tasks updated event from main process
  useEffect(() => {
    const handleBeadTasksUpdated = async (planId: string) => {
      if (planId === plan.id) {
        console.log('[PlanDetailView] Received bead-tasks-updated event, refreshing tasks')
        try {
          const [tasks, assignments] = await Promise.all([
            window.electronAPI.getBeadTasks(plan.id),
            window.electronAPI.getTaskAssignments(plan.id)
          ])
          console.log('[PlanDetailView] Refreshed bead tasks:', tasks.length)
          setBeadTasks(tasks)
          setLocalAssignments(assignments || [])
        } catch (err) {
          console.error('Failed to refresh plan data:', err)
        }
      }
    }

    window.electronAPI?.onBeadTasksUpdated?.(handleBeadTasksUpdated)

    // Cleanup handled by preload removeAllListeners
  }, [plan.id])

  // Build dependency graph from bead tasks and local assignments
  const graph: DependencyGraph = useMemo(() => {
    if (beadTasks.length === 0) {
      return {
        nodes: new Map(),
        edges: [],
        roots: [],
        leaves: [],
        criticalPath: [],
        maxDepth: 0,
      }
    }
    return buildDependencyGraph(beadTasks, localAssignments)
  }, [beadTasks, localAssignments])

  // Calculate stats from graph
  const graphStats: GraphStats = useMemo(() => calculateGraphStats(graph), [graph])

  // Sync local assignments when prop changes (e.g., from task-assignment-update events)
  useEffect(() => {
    if (taskAssignments && taskAssignments.length > 0) {
      setLocalAssignments(taskAssignments)
    }
  }, [taskAssignments])

  const handleCancel = async () => {
    setIsCancelling(true)
    await onCancel()
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    await onComplete()
  }

  const handleCancelDiscussion = async () => {
    if (!onCancelDiscussion) return
    setIsCancelling(true)
    await onCancelDiscussion()
  }

  const getAgentById = (id: string) => agents.find((a) => a.id === id)
  const referenceAgent = plan.referenceAgentId ? getAgentById(plan.referenceAgentId) : null

  // Reverse activities for newest-first display
  const reversedActivities = [...activities].reverse()

  return (
    <div className="flex flex-col h-full">
      {/* Header with back button */}
      <div className="flex items-center gap-2 p-3 border-b shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="h-7 px-2"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-medium truncate flex-1">{plan.title}</h2>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {/* Plan info section */}
        <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${statusColors[plan.status]}`}>
            {statusIcons[plan.status]}
            {statusLabels[plan.status]}
          </span>
          {referenceAgent && (
            <span className="text-xs text-muted-foreground">
              Reference: {referenceAgent.name}
            </span>
          )}
        </div>

        {plan.description && (
          <p className="text-xs text-muted-foreground">{plan.description}</p>
        )}

        {/* Branch strategy badge */}
        <div className="flex items-center gap-2 text-xs">
          {plan.branchStrategy === 'feature_branch' ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-500">
              <GitBranch className="h-3 w-3" />
              Feature Branch
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-500">
              <GitPullRequest className="h-3 w-3" />
              Raise PRs
            </span>
          )}
        </div>

        {/* Worktree info */}
        {plan.worktrees && plan.worktrees.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            <span>{plan.worktrees.filter(w => w.status !== 'cleaned').length} worktree(s)</span>
          </div>
        )}

        {/* Action buttons */}
        {plan.status === 'discussing' && onCancelDiscussion && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Discussion in progress. Use the terminal to brainstorm with the agent.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={isCancelling}
              onClick={handleCancelDiscussion}
            >
              {isCancelling ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <X className="h-3 w-3 mr-1" />
                  Cancel Discussion
                </>
              )}
            </Button>
          </div>
        )}

        {plan.status === 'discussed' && onExecute && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Discussion complete. Review the outcomes below, then execute the plan.
            </p>
            <select
              value={selectedReference}
              onChange={(e) => setSelectedReference(e.target.value)}
              className="w-full text-xs border rounded px-2 py-1.5 bg-background"
            >
              <option value="">Select reference agent...</option>
              {agents
                .filter((a) => !a.isOrchestrator && !a.isPlanAgent)
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              disabled={!selectedReference || isExecuting}
              className="cursor-pointer"
              onClick={async () => {
                if (selectedReference && !isExecuting) {
                  setIsExecuting(true)
                  console.log('[PlanDetailView] Execute clicked, calling onExecute with:', selectedReference)
                  try {
                    await onExecute(selectedReference)
                  } catch (err) {
                    console.error('[PlanDetailView] Execute failed:', err)
                  } finally {
                    setIsExecuting(false)
                  }
                }
              }}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Execute
                </>
              )}
            </Button>
          </div>
        )}

        {(plan.status === 'delegating' || plan.status === 'in_progress') && (
          <Button
            size="sm"
            variant="destructive"
            disabled={isCancelling}
            onClick={handleCancel}
          >
            {isCancelling ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <X className="h-3 w-3 mr-1" />
                Cancel
              </>
            )}
          </Button>
        )}

        {plan.status === 'ready_for_review' && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" disabled={isCompleting} onClick={handleComplete}>
              {isCompleting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Mark Complete
                </>
              )}
            </Button>
            {onRequestFollowUps && (
              <Button
                size="sm"
                variant="outline"
                disabled={isRequestingFollowUps}
                onClick={async () => {
                  setIsRequestingFollowUps(true)
                  try {
                    await onRequestFollowUps()
                  } finally {
                    setIsRequestingFollowUps(false)
                  }
                }}
              >
                {isRequestingFollowUps ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Follow Up Required
                  </>
                )}
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={isCancelling}
              onClick={handleCancel}
            >
              {isCancelling ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Discussion Output section */}
      {plan.discussion?.status === 'approved' && plan.discussionOutputPath && (
        <DiscussionOutputSection
          summary={plan.discussion.summary}
          outputPath={plan.discussionOutputPath}
        />
      )}

      {/* Git Summary section */}
      {plan.gitSummary && (
        <div className="p-3 border-b">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Git Summary
          </h3>

          {/* Commits (feature_branch strategy) */}
          {plan.gitSummary.commits && plan.gitSummary.commits.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <GitCommit className="h-3 w-3" />
                <span>{plan.gitSummary.commits.length} commit(s)</span>
                {plan.featureBranch && (() => {
                  // Extract GitHub repo URL from the first commit's githubUrl
                  const firstCommit = plan.gitSummary.commits?.[0]
                  const repoUrl = firstCommit?.githubUrl?.replace(/\/commit\/[a-f0-9]+$/, '')
                  const branchUrl = repoUrl ? `${repoUrl}/tree/${plan.featureBranch}` : null

                  return branchUrl ? (
                    <button
                      onClick={() => window.electronAPI.openExternal(branchUrl)}
                      className="ml-1 flex items-center gap-0.5 hover:text-foreground"
                      title="View feature branch on GitHub"
                    >
                      <span>→ {plan.featureBranch}</span>
                      <ExternalLink className="h-2.5 w-2.5" />
                    </button>
                  ) : (
                    <span className="ml-1">→ {plan.featureBranch}</span>
                  )
                })()}
              </div>
              <div className="space-y-0.5 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
                {plan.gitSummary.commits.map((commit) => (
                  <div key={commit.sha} className="text-xs flex items-start gap-1.5 p-1 hover:bg-muted/30 rounded">
                    <code className="text-muted-foreground font-mono shrink-0">{commit.shortSha}</code>
                    <span className="truncate flex-1">{commit.message}</span>
                    {commit.githubUrl && (
                      <button
                        onClick={() => window.electronAPI.openExternal(commit.githubUrl!)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        title="View on GitHub"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pull Requests (raise_prs strategy) */}
          {plan.gitSummary.pullRequests && plan.gitSummary.pullRequests.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                <GitPullRequest className="h-3 w-3" />
                <span>{plan.gitSummary.pullRequests.length} PR(s)</span>
              </div>
              <div className="space-y-1">
                {plan.gitSummary.pullRequests.map((pr) => (
                  <div key={pr.number} className="text-xs flex items-center gap-2 p-1.5 border rounded hover:bg-muted/30">
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                      pr.status === 'merged' ? 'bg-purple-500/20 text-purple-500' :
                      pr.status === 'open' ? 'bg-green-500/20 text-green-500' :
                      'bg-red-500/20 text-red-500'
                    }`}>
                      {pr.status}
                    </span>
                    <span className="text-muted-foreground">#{pr.number}</span>
                    <span className="truncate flex-1">{pr.title}</span>
                    <button
                      onClick={() => window.electronAPI.openExternal(pr.url)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title="View PR on GitHub"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {(!plan.gitSummary.commits || plan.gitSummary.commits.length === 0) &&
           (!plan.gitSummary.pullRequests || plan.gitSummary.pullRequests.length === 0) && (
            <div className="text-xs text-muted-foreground text-center py-2">
              No git activity yet
            </div>
          )}
        </div>
      )}

      {/* Tasks section - shows all tasks from graph */}
      {graph.nodes.size > 0 && (
        <div className="p-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tasks ({graph.nodes.size})
            </h3>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setGraphModalOpen(true)}
            >
              <Network className="h-3 w-3 mr-1" />
              View Graph
            </Button>
          </div>

          {/* Progress bar */}
          <DependencyProgressBar stats={graphStats} className="mb-3" />

          {/* Task lists organized by status */}
          <div className="space-y-3">
            {/* In Progress tasks */}
            {(() => {
              const inProgressNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'in_progress'
              )
              if (inProgressNodes.length === 0) return null
              return (
                <div>
                  <div className="text-[10px] font-medium text-yellow-500 mb-1">
                    In Progress ({inProgressNodes.length})
                  </div>
                  <div className="space-y-1">
                    {inProgressNodes.map((node) => (
                      <TaskCard
                        key={node.id}
                        node={node}
                        assignment={node.assignment}
                        agent={node.assignment ? getAgentById(node.assignment.agentId) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Sent tasks (dispatched but not picked up) */}
            {(() => {
              const sentNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'sent' || n.status === 'pending'
              )
              if (sentNodes.length === 0) return null
              return (
                <div>
                  <div className="text-[10px] font-medium text-blue-500 mb-1">
                    Sent ({sentNodes.length})
                  </div>
                  <div className="space-y-1">
                    {sentNodes.map((node) => (
                      <TaskCard
                        key={node.id}
                        node={node}
                        assignment={node.assignment}
                        agent={node.assignment ? getAgentById(node.assignment.agentId) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Ready tasks (can start now) */}
            {(() => {
              const readyNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'ready'
              )
              if (readyNodes.length === 0) return null
              return (
                <div>
                  <div className="text-[10px] font-medium text-blue-500 mb-1">
                    Ready ({readyNodes.length})
                  </div>
                  <div className="space-y-1">
                    {readyNodes.map((node) => (
                      <TaskCard key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Blocked tasks */}
            {(() => {
              const blockedNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'blocked'
              )
              if (blockedNodes.length === 0) return null
              return (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground mb-1">
                    Blocked ({blockedNodes.length})
                  </div>
                  <div className="space-y-1">
                    {blockedNodes.map((node) => (
                      <TaskCard key={node.id} node={node} />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Failed tasks */}
            {(() => {
              const failedNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'failed'
              )
              if (failedNodes.length === 0) return null
              return (
                <div>
                  <div className="text-[10px] font-medium text-red-500 mb-1">
                    Failed ({failedNodes.length})
                  </div>
                  <div className="space-y-1">
                    {failedNodes.map((node) => (
                      <TaskCard
                        key={node.id}
                        node={node}
                        assignment={node.assignment}
                        agent={node.assignment ? getAgentById(node.assignment.agentId) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Completed tasks (collapsed by default) */}
            {(() => {
              const completedNodes = Array.from(graph.nodes.values()).filter(
                (n) => n.status === 'completed'
              )
              if (completedNodes.length === 0) return null
              return (
                <details className="group">
                  <summary className="text-[10px] font-medium text-green-500 mb-1 cursor-pointer list-none flex items-center gap-1">
                    <span className="group-open:rotate-90 transition-transform">▶</span>
                    Completed ({completedNodes.length})
                  </summary>
                  <div className="space-y-1 mt-1">
                    {completedNodes.map((node) => (
                      <TaskCard
                        key={node.id}
                        node={node}
                        assignment={node.assignment}
                        agent={node.assignment ? getAgentById(node.assignment.agentId) : undefined}
                      />
                    ))}
                  </div>
                </details>
              )
            })()}
          </div>
        </div>
      )}

      {/* Graph modal */}
      <DependencyGraphModal
        isOpen={graphModalOpen}
        onClose={() => setGraphModalOpen(false)}
        graph={graph}
        stats={graphStats}
        planTitle={plan.title}
      />

        {/* Activity log section */}
        <div className="border-b">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3" />
              <span className="text-xs font-medium">Activity Log</span>
              {activities.length > 0 && (
                <span className="text-xs text-muted-foreground">({activities.length})</span>
              )}
            </div>
          </div>
          {activities.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              No activity yet
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {reversedActivities.map((activity) => (
                <div
                  key={activity.id}
                  className="px-3 py-1.5 text-xs hover:bg-muted/30"
                  title={activity.details || undefined}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="text-muted-foreground font-mono shrink-0">
                      {formatActivityTime(activity.timestamp)}
                    </span>
                    <span className="shrink-0">{activityIcons[activity.type]}</span>
                    <span className={activityColors[activity.type]}>
                      {activity.message}
                    </span>
                  </div>
                  {activity.details && (
                    <div className="ml-16 text-muted-foreground truncate">
                      {activity.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
