import type { BeadTask } from '../bd-client'

export function isCriticTask(task: BeadTask): boolean {
  return task.labels?.includes('bismarck-critic') ?? false
}

export function isFixupTask(task: BeadTask): boolean {
  return task.labels?.includes('critic-fixup') ?? false
}

export function getOriginalTaskIdFromLabels(task: BeadTask): string | undefined {
  return task.labels?.find(l => l.startsWith('fixup-for:'))?.substring('fixup-for:'.length)
}

/**
 * Generate a unique plan ID
 */
export function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a unique activity ID
 */
export function generateActivityId(): string {
  return `act-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a unique discussion ID
 */
export function generateDiscussionId(): string {
  return `disc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a unique ID for a worktree
 */
export function generateWorktreeId(): string {
  return `wt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
