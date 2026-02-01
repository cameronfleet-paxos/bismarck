import { useState, useRef, useEffect } from 'react'
import { Plus, X, Trash2, Copy } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { PlanCard } from '@/renderer/components/PlanCard'
import { PlanDetailView } from '@/renderer/components/PlanDetailView'
import { ClonePlanDialog } from '@/renderer/components/ClonePlanDialog'
import type { Plan, TaskAssignment, Agent, PlanActivity } from '@/shared/types'

interface PlanSidebarProps {
  open: boolean
  onClose: () => void
  plans: Plan[]
  taskAssignments: TaskAssignment[]
  planActivities: Map<string, PlanActivity[]>
  agents: Agent[]
  activePlanId: string | null
  expandPlanId?: string | null  // Plan ID to auto-expand from parent
  onCreatePlan: () => void
  onSelectPlan: (planId: string | null) => void
  onExecutePlan: (planId: string, referenceAgentId: string) => void
  onStartDiscussion: (planId: string, referenceAgentId: string) => void
  onCancelDiscussion: (planId: string) => Promise<void>
  onCancelPlan: (planId: string) => Promise<void>
  onRestartPlan: (planId: string) => Promise<void>
  onCompletePlan: (planId: string) => Promise<void>
  onRequestFollowUps: (planId: string) => Promise<void>
  onDeletePlans: (planIds: string[]) => Promise<void>
  onClonePlan: (planId: string, options?: { includeDiscussion?: boolean }) => Promise<void>
}

export function PlanSidebar({
  open,
  onClose,
  plans,
  taskAssignments,
  planActivities,
  agents,
  activePlanId,
  expandPlanId,
  onCreatePlan,
  onSelectPlan,
  onExecutePlan,
  onStartDiscussion,
  onCancelDiscussion,
  onCancelPlan,
  onRestartPlan,
  onCompletePlan,
  onRequestFollowUps,
  onDeletePlans,
  onClonePlan,
}: PlanSidebarProps) {
  const [detailPlanId, setDetailPlanId] = useState<string | null>(null)
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set())
  const [clonePlanId, setClonePlanId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Track whether user has explicitly dismissed the detail view
  const userDismissedRef = useRef(false)
  // Track the previous discussing plan ID to detect new discussions
  const prevDiscussingIdRef = useRef<string | null>(null)

  // Reset dismissal flag when sidebar opens
  useEffect(() => {
    if (open) {
      userDismissedRef.current = false
    }
  }, [open])

  // Respond to expandPlanId prop from parent (e.g., after executing a plan)
  useEffect(() => {
    if (expandPlanId) {
      setDetailPlanId(expandPlanId)
    }
  }, [expandPlanId])

  // Auto-expand detail view for plans in 'discussing' status
  useEffect(() => {
    const discussingPlan = plans.find(p => p.status === 'discussing')
    const discussingId = discussingPlan?.id ?? null

    // If a new plan entered discussing status, reset dismissal flag
    if (discussingId && discussingId !== prevDiscussingIdRef.current) {
      userDismissedRef.current = false
    }
    prevDiscussingIdRef.current = discussingId

    // Auto-expand only if user hasn't dismissed and there's a discussing plan
    if (discussingPlan && !detailPlanId && !userDismissedRef.current) {
      setDetailPlanId(discussingPlan.id)
    }
  }, [plans, detailPlanId])

  // Clear selection when plans list changes (e.g., after deletion)
  useEffect(() => {
    const planIdSet = new Set(plans.map(p => p.id))
    setSelectedPlanIds(prev => {
      const filtered = new Set([...prev].filter(id => planIdSet.has(id)))
      return filtered.size === prev.size ? prev : filtered
    })
  }, [plans])

  if (!open) return null

  // Handle toggling selection
  const toggleSelection = (planId: string) => {
    setSelectedPlanIds(prev => {
      const next = new Set(prev)
      if (next.has(planId)) {
        next.delete(planId)
      } else {
        next.add(planId)
      }
      return next
    })
  }

  // Clear selection
  const clearSelection = () => {
    setSelectedPlanIds(new Set())
  }

  // Handle delete selected plans
  const handleDeleteSelected = async () => {
    if (selectedPlanIds.size === 0) return
    setIsDeleting(true)
    try {
      await onDeletePlans([...selectedPlanIds])
      clearSelection()
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle clone - check if plan has discussion to show dialog
  const handleCloneClick = () => {
    if (selectedPlanIds.size !== 1) return
    const planId = [...selectedPlanIds][0]
    const plan = plans.find(p => p.id === planId)
    if (!plan) return

    // If plan has completed discussion, show dialog for options
    if (plan.discussionOutputPath) {
      setClonePlanId(planId)
    } else {
      // Clone directly without dialog
      onClonePlan(planId)
      clearSelection()
    }
  }

  // Handle clone confirmation from dialog
  const handleCloneConfirm = async (includeDiscussion: boolean) => {
    if (!clonePlanId) return
    await onClonePlan(clonePlanId, { includeDiscussion })
    setClonePlanId(null)
    clearSelection()
  }

  const isSelectionMode = selectedPlanIds.size > 0

  // Find the plan being viewed in detail
  const detailPlan = detailPlanId ? plans.find((p) => p.id === detailPlanId) : null

  // If viewing a plan detail, show the detail view
  if (detailPlan) {
    return (
      <aside className="w-[360px] border-l flex flex-col bg-background">
        <PlanDetailView
          plan={detailPlan}
          activities={planActivities.get(detailPlan.id) || []}
          taskAssignments={taskAssignments}
          agents={agents}
          onBack={() => {
            userDismissedRef.current = true
            setDetailPlanId(null)
          }}
          onComplete={async () => {
            await onCompletePlan(detailPlan.id)
            setDetailPlanId(null)
          }}
          onCancel={async () => {
            await onCancelPlan(detailPlan.id)
            setDetailPlanId(null)
          }}
          onCancelDiscussion={async () => {
            await onCancelDiscussion(detailPlan.id)
            setDetailPlanId(null)
          }}
          onExecute={(referenceAgentId) => {
            onExecutePlan(detailPlan.id, referenceAgentId)
          }}
          onRequestFollowUps={async () => {
            await onRequestFollowUps(detailPlan.id)
          }}
        />
      </aside>
    )
  }

  const activePlans = plans.filter(
    (p) => p.status === 'discussing' || p.status === 'delegating' || p.status === 'in_progress' || p.status === 'ready_for_review'
  )
  const draftPlans = plans.filter((p) => p.status === 'draft' || p.status === 'discussed')
  const completedPlans = plans.filter(
    (p) => p.status === 'completed' || p.status === 'failed'
  )

  // Get the plan for clone dialog
  const clonePlan = clonePlanId ? plans.find(p => p.id === clonePlanId) : null

  return (
    <aside className="w-[360px] border-l flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        {isSelectionMode ? (
          <>
            <h2 className="font-medium text-sm">
              {selectedPlanIds.size} selected
            </h2>
            <div className="flex items-center gap-1">
              {selectedPlanIds.size === 1 && (
                <Button size="sm" variant="outline" onClick={handleCloneClick}>
                  <Copy className="h-4 w-4 mr-1" />
                  Clone
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteSelected}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-medium">Plans</h2>
            <div className="flex items-center gap-1">
              <Button size="sm" onClick={onCreatePlan}>
                <Plus className="h-4 w-4 mr-1" />
                New
              </Button>
              <Button size="sm" variant="ghost" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {plans.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p className="text-sm">No plans yet</p>
            <p className="text-xs mt-1">
              Create a plan to coordinate your agents
            </p>
          </div>
        ) : (
          <>
            {activePlans.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Active ({activePlans.length})
                </h3>
                {activePlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    agents={agents}
                    taskAssignments={taskAssignments}
                    activities={planActivities.get(plan.id) || []}
                    isActive={activePlanId === plan.id}
                    isSelected={selectedPlanIds.has(plan.id)}
                    onToggleSelect={() => toggleSelection(plan.id)}
                    onExecute={(leaderId) => onExecutePlan(plan.id, leaderId)}
                    onStartDiscussion={(leaderId) => onStartDiscussion(plan.id, leaderId)}
                    onCancelDiscussion={() => onCancelDiscussion(plan.id)}
                    onCancel={() => onCancelPlan(plan.id)}
                    onComplete={async () => onCompletePlan(plan.id)}
                    onClick={() => onSelectPlan(activePlanId === plan.id ? null : plan.id)}
                    onExpand={() => setDetailPlanId(plan.id)}
                  />
                ))}
              </div>
            )}

            {draftPlans.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Drafts ({draftPlans.length})
                </h3>
                {draftPlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    agents={agents}
                    taskAssignments={taskAssignments}
                    activities={planActivities.get(plan.id) || []}
                    isActive={activePlanId === plan.id}
                    isSelected={selectedPlanIds.has(plan.id)}
                    onToggleSelect={() => toggleSelection(plan.id)}
                    onExecute={(leaderId) => onExecutePlan(plan.id, leaderId)}
                    onStartDiscussion={(leaderId) => onStartDiscussion(plan.id, leaderId)}
                    onCancelDiscussion={() => onCancelDiscussion(plan.id)}
                    onCancel={() => onCancelPlan(plan.id)}
                    onComplete={async () => onCompletePlan(plan.id)}
                    onClick={() => onSelectPlan(activePlanId === plan.id ? null : plan.id)}
                    onExpand={() => setDetailPlanId(plan.id)}
                  />
                ))}
              </div>
            )}

            {completedPlans.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Completed ({completedPlans.length})
                </h3>
                {completedPlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    agents={agents}
                    taskAssignments={taskAssignments}
                    activities={planActivities.get(plan.id) || []}
                    isActive={activePlanId === plan.id}
                    isSelected={selectedPlanIds.has(plan.id)}
                    onToggleSelect={() => toggleSelection(plan.id)}
                    onExecute={(leaderId) => onExecutePlan(plan.id, leaderId)}
                    onStartDiscussion={(leaderId) => onStartDiscussion(plan.id, leaderId)}
                    onCancelDiscussion={() => onCancelDiscussion(plan.id)}
                    onCancel={() => onCancelPlan(plan.id)}
                    onRestart={plan.status === 'failed' ? () => onRestartPlan(plan.id) : undefined}
                    onComplete={async () => onCompletePlan(plan.id)}
                    onClick={() => onSelectPlan(activePlanId === plan.id ? null : plan.id)}
                    onExpand={() => setDetailPlanId(plan.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Clone Dialog */}
      {clonePlan && (
        <ClonePlanDialog
          plan={clonePlan}
          onConfirm={handleCloneConfirm}
          onCancel={() => setClonePlanId(null)}
        />
      )}
    </aside>
  )
}
