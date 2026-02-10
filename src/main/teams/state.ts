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
