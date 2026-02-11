import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Play, X, Clock, CheckCircle2, AlertCircle, Loader2, Activity, Check, GitBranch, GitPullRequest, Maximize2, GitCommit, ExternalLink, MessageSquare, RotateCcw, Copy, Eye, ArrowUpCircle, Users } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import type { Plan, TaskAssignment, Agent, PlanActivity, TeamMode } from '@/shared/types'

interface PlanCardProps {
  plan: Plan
  agents: Agent[]
  taskAssignments: TaskAssignment[]
  activities: PlanActivity[]
  isActive: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
  onExecute: (referenceAgentId: string, teamMode: TeamMode) => void | Promise<void>
  onStartDiscussion: (referenceAgentId: string) => void
  onCancelDiscussion: () => Promise<void>
  onCancel: () => Promise<void>
  onRestart?: () => Promise<void>
  onComplete: () => Promise<void>
  onClick: () => void
  onExpand?: () => void
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

// Activity type icons and colors
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

export function PlanCard({
  plan,
  agents,
  taskAssignments,
  activities,
  isActive,
  isSelected,
  onToggleSelect,
  onExecute,
  onStartDiscussion,
  onCancelDiscussion,
  onCancel,
  onRestart,
  onComplete,
  onClick,
  onExpand,
}: PlanCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [selectedReference, setSelectedReference] = useState<string>('')
  const [selectedTeamMode, setSelectedTeamMode] = useState<TeamMode>('top-down')
  const [activityLogExpanded, setActivityLogExpanded] = useState(true)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [copiedActivity, setCopiedActivity] = useState(false)
  const activityLogRef = useRef<HTMLDivElement>(null)

  const handleCancel = async () => {
    setIsCancelling(true)
    await onCancel()
    // Note: Component may unmount or plan status may change, but that's fine
  }

  const handleComplete = async () => {
    setIsCompleting(true)
    await onComplete()
  }

  const handleCancelDiscussion = async () => {
    setIsCancelling(true)
    await onCancelDiscussion()
  }

  const handleCopyActivityLog = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const logText = activities
      .map((a) => {
        const time = formatActivityTime(a.timestamp)
        const typeSymbol = a.type === 'success' ? '✓' : a.type === 'warning' ? '⚠' : a.type === 'error' ? '✕' : '○'
        const details = a.details ? `\n    ${a.details}` : ''
        return `${time} ${typeSymbol} ${a.message}${details}`
      })
      .join('\n')
    await navigator.clipboard.writeText(logText)
    setCopiedActivity(true)
    setTimeout(() => setCopiedActivity(false), 2000)
  }

  // Auto-scroll to latest activity
  useEffect(() => {
    if (activityLogRef.current && activityLogExpanded) {
      activityLogRef.current.scrollTop = activityLogRef.current.scrollHeight
    }
  }, [activities, activityLogExpanded])


  const getAgentById = (id: string) => agents.find((a) => a.id === id)
  const referenceAgent = plan.referenceAgentId ? getAgentById(plan.referenceAgentId) : null

  return (
    <div
      className={`rounded-lg border p-3 transition-all cursor-pointer ${
        isSelected
          ? 'ring-2 ring-white'
          : isActive
            ? 'ring-2 ring-primary'
            : 'hover:border-primary/50'
      }`}
      onClick={(e) => {
        e.stopPropagation()
        if (e.metaKey || e.ctrlKey) {
          // CMD/Ctrl-click: Add/remove from multi-selection
          onToggleSelect?.()
        } else {
          // Regular click: Select single plan (handled by parent via onClick)
          onClick()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
            className="p-0.5 hover:bg-muted rounded"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0">
            <h4 className="font-medium text-sm truncate">{plan.title}</h4>
            {referenceAgent && (
              <p className="text-xs text-muted-foreground">
                Reference: {referenceAgent.name}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Strategy badge */}
          {plan.branchStrategy === 'feature_branch' ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-500" title="Feature Branch Strategy">
              <GitBranch className="h-2.5 w-2.5" />
            </span>
          ) : plan.branchStrategy === 'raise_prs' ? (
            <span className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded bg-purple-500/20 text-purple-500" title="Raise PRs Strategy">
              <GitPullRequest className="h-2.5 w-2.5" />
            </span>
          ) : null}
          <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${statusColors[plan.status]}`}>
            {statusIcons[plan.status]}
            {statusLabels[plan.status]}
          </span>
          {onExpand && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onExpand()
              }}
              className="p-1 hover:bg-muted rounded"
              title={plan.status === 'completed' || plan.status === 'failed' ? 'View execution history' : 'View details'}
            >
              {plan.status === 'completed' || plan.status === 'failed' ? (
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {plan.description && (
            <p className="text-xs text-muted-foreground">{plan.description}</p>
          )}

          {plan.status === 'draft' && (
            <div className="space-y-2">
              <select
                value={selectedReference}
                onChange={(e) => setSelectedReference(e.target.value)}
                onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => { e.stopPropagation(); setSelectedTeamMode('top-down') }}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors ${
                    selectedTeamMode === 'top-down' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <ArrowUpCircle className="h-3 w-3" />
                  Top-Down
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSelectedTeamMode('bottom-up') }}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors ${
                    selectedTeamMode === 'bottom-up' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <Users className="h-3 w-3" />
                  Bottom-Up
                </button>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!selectedReference}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (selectedReference) {
                      onStartDiscussion(selectedReference)
                    }
                  }}
                >
                  <MessageSquare className="h-3 w-3 mr-1" />
                  Discuss
                </Button>
                <Button
                  size="sm"
                  className="flex-1 cursor-pointer"
                  disabled={!selectedReference || isExecuting}
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (selectedReference && !isExecuting) {
                      setIsExecuting(true)
                      try {
                        await onExecute(selectedReference, selectedTeamMode)
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
            </div>
          )}

          {plan.status === 'discussing' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Discussion in progress. Use the terminal to brainstorm with the agent.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={isCancelling}
                onClick={(e) => {
                  e.stopPropagation()
                  handleCancelDiscussion()
                }}
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

          {plan.status === 'discussed' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Discussion complete. Select an agent and execute the plan.
              </p>
              <select
                value={selectedReference}
                onChange={(e) => setSelectedReference(e.target.value)}
                onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => { e.stopPropagation(); setSelectedTeamMode('top-down') }}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs border rounded transition-colors ${
                    selectedTeamMode === 'top-down' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <ArrowUpCircle className="h-3 w-3" />
                  Top-Down
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSelectedTeamMode('bottom-up') }}
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
                className="cursor-pointer w-full"
                disabled={!selectedReference || isExecuting}
                onClick={async (e) => {
                  e.stopPropagation()
                  if (selectedReference && !isExecuting) {
                    setIsExecuting(true)
                    try {
                      await onExecute(selectedReference, selectedTeamMode)
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
              onClick={(e) => {
                e.stopPropagation()
                handleCancel()
              }}
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
            <div className="space-y-2">
              {/* Worktree info */}
              {plan.worktrees && plan.worktrees.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <div className="flex items-center gap-1 mb-1">
                    <GitBranch className="h-3 w-3" />
                    <span>{plan.worktrees.filter(w => w.status !== 'cleaned').length} worktree(s) ready for review</span>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={isCompleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleComplete()
                  }}
                >
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
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isCancelling}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCancel()
                  }}
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
            </div>
          )}

          {/* Activity Log */}
          {(plan.status === 'delegating' || plan.status === 'in_progress' || plan.status === 'ready_for_review' || plan.status === 'completed' || plan.status === 'failed') && (
            <div className="border rounded-md overflow-hidden">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setActivityLogExpanded(!activityLogExpanded)
                }}
                className="w-full flex items-center justify-between px-2 py-1.5 bg-muted/50 hover:bg-muted text-xs font-medium"
              >
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3" />
                  Activity Log
                  {activities.length > 0 && (
                    <span className="text-muted-foreground">({activities.length})</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activities.length > 0 && (
                    <button
                      onClick={handleCopyActivityLog}
                      className="p-0.5 hover:bg-background rounded"
                      title="Copy activity log"
                    >
                      {copiedActivity ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  {activityLogExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </div>
              </button>
              {activityLogExpanded && (
                <div
                  ref={activityLogRef}
                  className="max-h-32 overflow-y-auto bg-background/50"
                >
                  {activities.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground text-center">
                      No activity yet
                    </div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {activities.map((activity) => (
                        <div
                          key={activity.id}
                          className="px-2 py-1 text-xs hover:bg-muted/30"
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
              )}
            </div>
          )}

          {/* Restart Failed Plan */}
          {plan.status === 'failed' && onRestart && (
            <div className="space-y-2">
              {plan.discussion?.status === 'approved' && (
                <p className="text-xs text-muted-foreground">
                  Discussion preserved - ready to re-execute
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={isRestarting}
                onClick={(e) => {
                  e.stopPropagation()
                  setIsRestarting(true)
                  onRestart()
                }}
              >
                {isRestarting ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Restarting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Restart
                  </>
                )}
              </Button>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
