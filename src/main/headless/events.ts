import { devLog } from '../dev-log'
import { saveHeadlessAgentInfo } from '../config'
import type { HeadlessAgentInfo, StreamEvent } from '../../shared/types'
import { headlessAgentInfo, eventPersistTimers, EVENT_PERSIST_DEBOUNCE_MS, getMainWindow } from './state'

/**
 * Register a headless agent info entry (for mock/test agents)
 */
export function registerHeadlessAgentInfo(info: HeadlessAgentInfo): void {
  headlessAgentInfo.set(info.taskId!, info)
}

/**
 * Persist all headless agent info for a plan to disk
 */
function persistHeadlessAgentInfo(planId: string): void {
  const agents = Array.from(headlessAgentInfo.values()).filter(info => info.planId === planId)
  saveHeadlessAgentInfo(planId, agents)
}

/**
 * Emit headless agent update to renderer
 */
export function emitHeadlessAgentUpdate(info: HeadlessAgentInfo): void {
  devLog('[PlanManager] Emitting headless-agent-update', { taskId: info.taskId, status: info.status })
  persistHeadlessAgentInfo(info.planId)
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-update', info)
  } else {
    devLog('[PlanManager] Cannot emit headless-agent-update - mainWindow:', mainWindow ? 'exists but destroyed' : 'null')
  }
}

/**
 * Emit headless agent update to renderer (exported for mock agents)
 */
export function emitHeadlessAgentUpdatePublic(info: HeadlessAgentInfo): void {
  emitHeadlessAgentUpdate(info)
}

/**
 * Emit headless agent event to renderer
 */
export function emitHeadlessAgentEvent(planId: string, taskId: string, event: StreamEvent): void {
  devLog('[PlanManager] emitHeadlessAgentEvent', { planId, taskId, eventType: event.type, windowAvailable: !!(getMainWindow() && !getMainWindow()!.isDestroyed()) })
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('headless-agent-event', { planId, taskId, event })
  }
  // Debounced persistence for events
  const timerKey = `${planId}:${taskId}`
  const existingTimer = eventPersistTimers.get(timerKey)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }
  eventPersistTimers.set(timerKey, setTimeout(() => {
    persistHeadlessAgentInfo(planId)
    eventPersistTimers.delete(timerKey)
  }, EVENT_PERSIST_DEBOUNCE_MS))
}

/**
 * Emit headless agent event to renderer (exported for mock agents)
 */
export function emitHeadlessAgentEventPublic(planId: string, taskId: string, event: StreamEvent): void {
  emitHeadlessAgentEvent(planId, taskId, event)
}
