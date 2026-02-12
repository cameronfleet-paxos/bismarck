import { BrowserWindow } from 'electron'
import { HeadlessAgent } from './docker-agent'
import type { HeadlessAgentInfo } from '../../shared/types'

// Track headless agents for cleanup and status
export const headlessAgents: Map<string, HeadlessAgent> = new Map()

// Track headless agent info for UI
export const headlessAgentInfo: Map<string, HeadlessAgentInfo> = new Map()

// Debounce timers for headless agent event persistence
export const eventPersistTimers: Map<string, NodeJS.Timeout> = new Map()
export const EVENT_PERSIST_DEBOUNCE_MS = 2000

// Track tasks that have successfully run bd close
export const tasksWithSuccessfulBdClose: Set<string> = new Set()

// bd close listener setup flag
let _bdCloseListenerSetup = false
export function isBdCloseListenerSetup(): boolean { return _bdCloseListenerSetup }
export function setBdCloseListenerSetup(value: boolean): void { _bdCloseListenerSetup = value }

// Main window reference for headless IPC
let _mainWindow: BrowserWindow | null = null
export function getMainWindow(): BrowserWindow | null { return _mainWindow }
export function setMainWindow(window: BrowserWindow | null): void { _mainWindow = window }
