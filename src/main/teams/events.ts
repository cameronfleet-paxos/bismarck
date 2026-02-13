import { getState } from '../state-manager'
import { savePlanActivities } from '../config'
import type { Plan, PlanActivity, PlanActivityType, TaskAssignment } from '../../shared/types'
import { getMainWindow, planActivities, getOnPlanStatusChangeCallback, setOnPlanStatusChangeCallback } from './state'
import { generateActivityId } from './helpers'

/**
 * Add an activity to a plan's activity log
 */
export function addPlanActivity(
  planId: string,
  type: PlanActivityType,
  message: string,
  details?: string
): PlanActivity {
  const activity: PlanActivity = {
    id: generateActivityId(),
    planId,
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
  }

  // Store in memory
  if (!planActivities.has(planId)) {
    planActivities.set(planId, [])
  }
  planActivities.get(planId)!.push(activity)

  // Persist to disk
  savePlanActivities(planId, planActivities.get(planId)!)

  // Emit to renderer
  emitPlanActivity(activity)

  return activity
}

/**
 * Get all activities for a plan
 */
export function getPlanActivities(planId: string): PlanActivity[] {
  return planActivities.get(planId) || []
}

/**
 * Clear activities for a plan
 */
export function clearPlanActivities(planId: string): void {
  planActivities.delete(planId)
}

/**
 * Set up callback for plan status changes
 */
export function onPlanStatusChange(cb: (planId: string, status: string) => void): void {
  setOnPlanStatusChangeCallback(cb)
}

/**
 * Emit plan update event to renderer
 */
export function emitPlanUpdate(plan: Plan): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('team-plan-update', plan)
  }
  getOnPlanStatusChangeCallback()?.(plan.id, plan.status)
}

/**
 * Emit task assignment update event to renderer
 */
export function emitTaskAssignmentUpdate(assignment: TaskAssignment): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('team-task-assignment-update', assignment)
  }
}

/**
 * Emit plan activity event to renderer
 */
export function emitPlanActivity(activity: PlanActivity): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('team-plan-activity', activity)
  }
}

/**
 * Emit bead tasks updated event to renderer
 * This notifies the UI to re-fetch the task list for a plan
 */
export function emitBeadTasksUpdate(planId: string): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('team-bead-tasks-updated', planId)
  }
}

/**
 * Emit state update event to renderer (for tab changes)
 */
export function emitStateUpdate(): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    const state = getState()
    mainWindow.webContents.send('state-update', state)
  }
}
