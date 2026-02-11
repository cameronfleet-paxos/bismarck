import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ArrowLeft, Check, X, Loader2, Activity, GitBranch, GitPullRequest, Clock, CheckCircle2, AlertCircle, ExternalLink, GitCommit, MessageSquare, Play, FileText, Network, Plus, ArrowUpCircle, Users, ChevronDown } from 'lucide-react'
import type { TeamMode } from '@/shared/types'
import { Button } from '@/renderer/components/ui/button'
import { TaskCard } from '@/renderer/components/TaskCard'
import { DependencyProgressBar } from '@/renderer/components/DependencyProgressBar'
import { DependencyGraphModal } from '@/renderer/components/DependencyGraphModal'
import { buildDependencyGraph, calculateGraphStats } from '@/renderer/utils/build-dependency-graph'
import type { Plan, TaskAssignment, Agent, PlanActivity, DependencyGraph, GraphStats, BeadTask, PlanWorktree, TaskNode } from '@/shared/types'
import { devLog } from '../utils/dev-log'

/** Max number of activities shown initially before "Show More" */
const INITIAL_ACTIVITY_COUNT = 50

/** Max number of tasks per status group before collapsing */
const COLLAPSE_THRESHOLD = 20

interface PlanDetailViewProps {
  plan: Plan
  activities: PlanActivity[]
  taskAssignments: TaskAssignment[]
  agents: Agent[]
  onBack: () => void
  onComplete: () => Promise<void>
  onCancel: () => Promise<void>
  onCancelDiscussion?: () => Promise<void>
  onExecute?: (referenceAgentId: string, teamMode: TeamMode) => void
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

function CriticBadge({ worktree }: { worktree?: PlanWorktree }) {
  if (!worktree?.criticStatus) return null

  const badges: Record<string, { label: string; className: string }> = {
    reviewing: { label: 'Reviewing...', className: 'bg-yellow-500/20 text-yellow-500' },
    approved: { label: 'Approved', className: 'bg-green-500/20 text-green-500' },
    rejected: { label: `Fix-ups (iter ${(worktree.criticIteration ?? 0) + 1})`, className: 'bg-orange-500/20 text-orange-500' },
    pending: { label: 'Critic Pending', className: 'bg-muted text-muted-foreground' },
  }

  const badge = badges[worktree.criticStatus]
  if (!badge) return null

  return (
    <span className={`text-[10px] px-1 py-0.5 rounded ${badge.className}`}>
      {badge.label}
    </span>
  )
}

/**
 * Renders a group of tasks with a header, collapsing to show only first COLLAPSE_THRESHOLD
 * when there are many tasks. Uses details/summary for completed tasks.
 */
function TaskStatusGroup({
  label,
  colorClass,
  nodes,
  getAgentById,
  getWorktreeForTask,
  defaultCollapsed = false,
}: {
  label: string
  colorClass: string
  nodes: TaskNode[]
  getAgentById: (id: string) => Agent | undefined
  getWorktreeForTask: (taskId: string) => PlanWorktree | undefined
  defaultCollapsed?: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  if (nodes.length === 0) return null

  const shouldCollapse = nodes.length > COLLAPSE_THRESHOLD && !showAll
  const visibleNodes = shouldCollapse ? nodes.slice(0, COLLAPSE_THRESHOLD) : nodes

  const content = (
    <>
      <div className="space-y-1">
        {visibleNodes.map((node) => (
          <div key={node.id} className="flex items-center gap-1">
            <div className="flex-1">
              <TaskCard
                node={node}
                assignment={node.assignment}
                agent={node.assignment ? getAgentById(node.assignment.agentId) : undefined}
              />
            </div>
            <CriticBadge worktree={getWorktreeForTask(node.id)} />
          </div>
        ))}
      </div>
      {shouldCollapse && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
        >
          <ChevronDown className="h-3 w-3" />
          Show {nodes.length - COLLAPSE_THRESHOLD} more
        </button>
      )}
    </>
  )

  if (defaultCollapsed) {
    return (
      <details className="group">
        <summary className={`text-[10px] font-medium ${colorClass} mb-1 cursor-pointer list-none flex items-center gap-1`}>
          <span className="group-open:rotate-90 transition-transform">▶</span>
          {label} ({nodes.length})
        </summary>
        <div className="mt-1">{content}</div>
      </details>
    )
  }

  return (
    <div>
      <div className={`text-[10px] font-medium ${colorClass} mb-1`}>
        {label} ({nodes.length})
      </div>
      {content}
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
  const [selectedTeamMode, setSelectedTeamMode] = useState<TeamMode>(plan.teamMode ?? 'top-down')
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
        devLog('[PlanDetailView] Fetched bead tasks:', tasks.length, tasks.map(t => ({ id: t.id, blockedBy: t.blockedBy })))
        devLog('[PlanDetailView] Fetched assignments:', assignments?.length ?? 0)
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

  // Listen for bead tasks updated event from main process (debounced)
  const pendingRefresh = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const handleBeadTasksUpdated = (planId: string) => {
      if (planId !== plan.id) return

      // Debounce: batch rapid task updates into a single refresh
      if (pendingRefresh.current) {
        clearTimeout(pendingRefresh.current)
      }
      pendingRefresh.current = setTimeout(async () => {
        pendingRefresh.current = null
        devLog('[PlanDetailView] Debounced refresh - fetching bead tasks')
        try {
          const [tasks, assignments] = await Promise.all([
            window.electronAPI.getBeadTasks(plan.id),
            window.electronAPI.getTaskAssignments(plan.id)
          ])
          devLog('[PlanDetailView] Refreshed bead tasks:', tasks.length)
          setBeadTasks(tasks)
          setLocalAssignments(assignments || [])
        } catch (err) {
          console.error('Failed to refresh plan data:', err)
        }
      }, 500) // 500ms debounce
    }

    window.electronAPI?.onBeadTasksUpdated?.(handleBeadTasksUpdated)

    return () => {
      if (pendingRefresh.current) {
        clearTimeout(pendingRefresh.current)
      }
    }
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

  const [activityLimit, setActivityLimit] = useState(INITIAL_ACTIVITY_COUNT)

  const getAgentById = useCallback((id: string) => agents.find((a) => a.id === id), [agents])
  const referenceAgent = plan.referenceAgentId ? getAgentById(plan.referenceAgentId) : null
  const getWorktreeForTask = useCallback((taskId: string) => {
    return plan.worktrees?.find(w => w.taskId === taskId)
  }, [plan.worktrees])

  // Memoized task groups by status
  const taskGroups = useMemo(() => {
    const nodes = Array.from(graph.nodes.values())
    return {
      inProgress: nodes.filter(n => n.status === 'in_progress'),
      sent: nodes.filter(n => n.status === 'sent' || n.status === 'pending'),
      ready: nodes.filter(n => n.status === 'ready'),
      blocked: nodes.filter(n => n.status === 'blocked'),
      failed: nodes.filter(n => n.status === 'failed'),
      completed: nodes.filter(n => n.status === 'completed'),
    }
  }, [graph])

  // Reverse activities for newest-first display, paginated
  const reversedActivities = useMemo(() => [...activities].reverse(), [activities])
  const visibleActivities = useMemo(() => reversedActivities.slice(0, activityLimit), [reversedActivities, activityLimit])
  const hasMoreActivities = reversedActivities.length > activityLimit

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

        {/* Branch strategy and team mode badges */}
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
          {(plan.teamMode ?? 'top-down') === 'top-down' ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-500">
              <ArrowUpCircle className="h-3 w-3" />
              Top-Down
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500">
              <Users className="h-3 w-3" />
              Bottom-Up
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
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSelectedTeamMode('top-down')}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors ${
                  selectedTeamMode === 'top-down' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50'
                }`}
              >
                <ArrowUpCircle className="h-3 w-3" />
                Top-Down
              </button>
              <button
                type="button"
                onClick={() => setSelectedTeamMode('bottom-up')}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors ${
                  selectedTeamMode === 'bottom-up' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50'
                }`}
              >
                <Users className="h-3 w-3" />
                Bottom-Up
              </button>
            </div>
            <Button
              size="sm"
              disabled={!selectedReference || isExecuting}
              className="cursor-pointer w-full"
              onClick={async () => {
                if (selectedReference && !isExecuting) {
                  setIsExecuting(true)
                  devLog('[PlanDetailView] Execute clicked, calling onExecute with:', selectedReference, selectedTeamMode)
                  try {
                    await onExecute(selectedReference, selectedTeamMode)
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
            <TaskStatusGroup label="In Progress" colorClass="text-yellow-500" nodes={taskGroups.inProgress} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} />
            <TaskStatusGroup label="Sent" colorClass="text-blue-500" nodes={taskGroups.sent} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} />
            <TaskStatusGroup label="Ready" colorClass="text-blue-500" nodes={taskGroups.ready} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} />
            <TaskStatusGroup label="Blocked" colorClass="text-muted-foreground" nodes={taskGroups.blocked} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} />
            <TaskStatusGroup label="Failed" colorClass="text-red-500" nodes={taskGroups.failed} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} />
            <TaskStatusGroup label="Completed" colorClass="text-green-500" nodes={taskGroups.completed} getAgentById={getAgentById} getWorktreeForTask={getWorktreeForTask} defaultCollapsed />
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
            <>
              <div className="divide-y divide-border/50">
                {visibleActivities.map((activity) => (
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
              {hasMoreActivities && (
                <div className="px-3 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => setActivityLimit(prev => prev + INITIAL_ACTIVITY_COUNT)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto"
                  >
                    <ChevronDown className="h-3 w-3" />
                    Show {Math.min(INITIAL_ACTIVITY_COUNT, reversedActivities.length - activityLimit)} more ({reversedActivities.length - activityLimit} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
