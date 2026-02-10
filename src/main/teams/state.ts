import { BrowserWindow } from 'electron'
import type { PlanActivity } from '../../shared/types'

let mainWindow: BrowserWindow | null = null
let pollInterval: NodeJS.Timeout | null = null
let syncInProgress = false // Guard against overlapping syncs

export const POLL_INTERVAL_MS = 5000 // Poll bd every 5 seconds
let lastCycleCheckTime: number | null = null
export const DEFAULT_MAX_PARALLEL_AGENTS = 4

// In-memory activity storage per plan
export const planActivities: Map<string, PlanActivity[]> = new Map()

// In-memory guard to prevent duplicate plan execution (React StrictMode double-invocation)
export const executingPlans: Set<string> = new Set()

// Bottom-up mode: track running manager/architect agents per plan
const activeManagers: Set<string> = new Set()
const activeArchitects: Set<string> = new Set()

// Track tasks pending critic review — prevents dependents from being dispatched
// between bd close (task marked closed) and critic creation (critic added as blocker)
const pendingCriticTasks: Set<string> = new Set()

export function addPendingCriticTask(taskId: string): void {
  pendingCriticTasks.add(taskId)
}

export function removePendingCriticTask(taskId: string): void {
  pendingCriticTasks.delete(taskId)
}

export function isPendingCritic(taskId: string): boolean {
  return pendingCriticTasks.has(taskId)
}

// Stagnation detection: track deferred tasks across poll cycles
export interface StagnationTracker {
  deferredTaskIds: Set<string>   // Task IDs deferred last cycle
  unchangedSince: number         // When this set was first observed
  warningEmitted: boolean        // Whether we've already emitted a warning
}

const stagnationTrackers: Map<string, StagnationTracker> = new Map()
const lastPollSummaryTimes: Map<string, number> = new Map()

// Track callback for plan status changes
let onPlanStatusChangeCallback: ((planId: string, status: string) => void) | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getPollInterval(): NodeJS.Timeout | null {
  return pollInterval
}

export function setPollInterval(interval: NodeJS.Timeout | null): void {
  pollInterval = interval
}

export function getSyncInProgress(): boolean {
  return syncInProgress
}

export function setSyncInProgress(value: boolean): void {
  syncInProgress = value
}

export function getLastCycleCheckTime(): number | null {
  return lastCycleCheckTime
}

export function setLastCycleCheckTime(value: number | null): void {
  lastCycleCheckTime = value
}

export function getOnPlanStatusChangeCallback(): ((planId: string, status: string) => void) | null {
  return onPlanStatusChangeCallback
}

export function setOnPlanStatusChangeCallback(cb: (planId: string, status: string) => void): void {
  onPlanStatusChangeCallback = cb
}

export function isManagerRunning(planId: string): boolean {
  return activeManagers.has(planId)
}

export function setManagerRunning(planId: string, running: boolean): void {
  if (running) {
    activeManagers.add(planId)
  } else {
    activeManagers.delete(planId)
  }
}

export function isArchitectRunning(planId: string): boolean {
  return activeArchitects.has(planId)
}

export function setArchitectRunning(planId: string, running: boolean): void {
  if (running) {
    activeArchitects.add(planId)
  } else {
    activeArchitects.delete(planId)
  }
}

export function clearBottomUpState(planId: string): void {
  activeManagers.delete(planId)
  activeArchitects.delete(planId)
}

export function getStagnationTracker(planId: string): StagnationTracker | undefined {
  return stagnationTrackers.get(planId)
}

export function setStagnationTracker(planId: string, tracker: StagnationTracker): void {
  stagnationTrackers.set(planId, tracker)
}

export function clearStagnationTracker(planId: string): void {
  stagnationTrackers.delete(planId)
}

export function getLastPollSummaryTime(planId: string): number {
  return lastPollSummaryTimes.get(planId) ?? 0
}

export function setLastPollSummaryTime(planId: string, time: number): void {
  lastPollSummaryTimes.set(planId, time)
}

export function clearLastPollSummaryTime(planId: string): void {
  lastPollSummaryTimes.delete(planId)
}
