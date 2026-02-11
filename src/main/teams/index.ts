// Wire cross-module callbacks to break circular dependencies
import { setOnCriticNeeded, setOnTaskReadyForReview, setOnCriticCompleted, setOnAddPlanActivity, setOnEmitTaskAssignmentUpdate, setOnEmitPlanUpdate } from '../headless/team-agents'
import { spawnCriticAgent, handleCriticCompletion } from './critic'
import { markWorktreeReadyForReview } from './git-strategy'
import { addPlanActivity, emitTaskAssignmentUpdate, emitPlanUpdate } from './events'

setOnCriticNeeded(spawnCriticAgent)
setOnTaskReadyForReview(markWorktreeReadyForReview)
setOnCriticCompleted(handleCriticCompletion)
setOnAddPlanActivity(addPlanActivity as (planId: string, type: string, message: string, details?: string) => void)
setOnEmitTaskAssignmentUpdate(emitTaskAssignmentUpdate)
setOnEmitPlanUpdate(emitPlanUpdate)

// Re-export everything that was previously exported from plan-manager.ts
export { setPlanManagerWindow, createPlan, getPlans, getTaskAssignments, deletePlanById, deletePlansById, clonePlan, updatePlanStatus } from './crud'
export { startDiscussion, cancelDiscussion } from './discussion'
export { executePlan, cancelPlan, restartPlan } from './execution'
export { startTaskPolling, stopTaskPolling } from './task-polling'
export { cleanupAllWorktrees } from './task-cleanup'
export { completePlan, cleanupPlanManager, updatePlanStatuses } from './completion'
export { requestFollowUps } from './follow-ups'
export { spawnManager } from './manager'
export { spawnArchitect } from './architect'
export { addPlanActivity, getPlanActivities, clearPlanActivities, onPlanStatusChange, emitPlanUpdate, emitTaskAssignmentUpdate, emitPlanActivity, emitBeadTasksUpdate, emitStateUpdate } from './events'
export { isCriticTask, isFixupTask, getOriginalTaskIdFromLabels } from './helpers'
