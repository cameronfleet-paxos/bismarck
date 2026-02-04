import { loadState, saveState, getDefaultPreferences } from './config'
import type { AppState, AgentTab, AppPreferences } from '../shared/types'
import { getGridConfig } from '../shared/grid-utils'

function getMaxAgentsPerTab(): number {
  return getGridConfig(currentState.preferences.gridSize).maxAgents
}

let currentState: AppState = {
  activeWorkspaceIds: [],
  tabs: [],
  activeTabId: null,
  preferences: getDefaultPreferences(),
  planSidebarOpen: false,
  activePlanId: null,
}

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

function getNextTabName(): string {
  const existingNumbers = currentState.tabs
    .map((t) => {
      const match = t.name.match(/^Tab (\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)

  let nextNum = 1
  while (existingNumbers.includes(nextNum)) {
    nextNum++
  }
  return `Tab ${nextNum}`
}

export function initializeState(): AppState {
  currentState = loadState()

  // Migration: convert old state without tabs to new format
  if (!currentState.tabs || currentState.tabs.length === 0) {
    const defaultTab: AgentTab = {
      id: generateTabId(),
      name: 'Tab 1',
      workspaceIds: currentState.activeWorkspaceIds.slice(0, getMaxAgentsPerTab()),
    }
    currentState.tabs = [defaultTab]
    currentState.activeTabId = defaultTab.id

    // Handle overflow if more than 4 active workspaces
    const remaining = currentState.activeWorkspaceIds.slice(getMaxAgentsPerTab())
    while (remaining.length > 0) {
      const overflowTab: AgentTab = {
        id: generateTabId(),
        name: getNextTabName(),
        workspaceIds: remaining.splice(0, getMaxAgentsPerTab()),
      }
      currentState.tabs.push(overflowTab)
    }

    persistState()
  }

  // Ensure there's always at least one tab
  if (currentState.tabs.length === 0) {
    const defaultTab: AgentTab = {
      id: generateTabId(),
      name: 'Tab 1',
      workspaceIds: [],
    }
    currentState.tabs = [defaultTab]
    currentState.activeTabId = defaultTab.id
    persistState()
  }

  // Ensure activeTabId is valid
  if (
    !currentState.activeTabId ||
    !currentState.tabs.find((t) => t.id === currentState.activeTabId)
  ) {
    currentState.activeTabId = currentState.tabs[0].id
    persistState()
  }

  return currentState
}

export function getState(): AppState {
  return { ...currentState, tabs: currentState.tabs.map((t) => ({ ...t })) }
}

export function setActiveWorkspaces(workspaceIds: string[]): void {
  currentState.activeWorkspaceIds = workspaceIds
  persistState()
}

export function addActiveWorkspace(workspaceId: string): void {
  if (!currentState.activeWorkspaceIds.includes(workspaceId)) {
    currentState.activeWorkspaceIds.push(workspaceId)
    persistState()
  }
}

export function removeActiveWorkspace(workspaceId: string): void {
  currentState.activeWorkspaceIds = currentState.activeWorkspaceIds.filter(
    (id) => id !== workspaceId
  )
  if (currentState.focusedWorkspaceId === workspaceId) {
    currentState.focusedWorkspaceId = currentState.activeWorkspaceIds[0]
  }
  persistState()
}

export function setFocusedWorkspace(workspaceId: string | undefined): void {
  currentState.focusedWorkspaceId = workspaceId
  persistState()
}

// Tab management functions

export function createTab(name?: string, options?: { isPlanTab?: boolean; planId?: string }): AgentTab {
  const tab: AgentTab = {
    id: generateTabId(),
    name: name || getNextTabName(),
    workspaceIds: [],
    isPlanTab: options?.isPlanTab,
    planId: options?.planId,
  }
  currentState.tabs.push(tab)
  persistState()
  return tab
}

export function renameTab(tabId: string, name: string): void {
  const tab = currentState.tabs.find((t) => t.id === tabId)
  if (tab) {
    tab.name = name
    persistState()
  }
}

export function reorderTabs(tabIds: string[]): boolean {
  // Build new tabs array in specified order
  const newTabs: AgentTab[] = []
  for (const tabId of tabIds) {
    const tab = currentState.tabs.find((t) => t.id === tabId)
    if (tab) {
      newTabs.push(tab)
    }
  }

  // Verify all tabs are accounted for
  if (newTabs.length !== currentState.tabs.length) {
    return false
  }

  currentState.tabs = newTabs
  persistState()
  return true
}

export function deleteTab(tabId: string): boolean {
  // Cannot delete the last tab
  if (currentState.tabs.length <= 1) {
    return false
  }

  const tabIndex = currentState.tabs.findIndex((t) => t.id === tabId)
  if (tabIndex === -1) {
    return false
  }

  const tab = currentState.tabs[tabIndex]

  // Remove workspaces from activeWorkspaceIds (they will be stopped)
  currentState.activeWorkspaceIds = currentState.activeWorkspaceIds.filter(
    (id) => !tab.workspaceIds.includes(id)
  )

  // Remove the tab
  currentState.tabs.splice(tabIndex, 1)

  // Update activeTabId if needed
  if (currentState.activeTabId === tabId) {
    currentState.activeTabId = currentState.tabs[0].id
  }

  persistState()
  return true
}

export function setActiveTab(tabId: string): void {
  if (currentState.tabs.find((t) => t.id === tabId)) {
    currentState.activeTabId = tabId
    persistState()
  }
}

export function addWorkspaceToTab(
  workspaceId: string,
  tabId: string
): boolean {
  const tab = currentState.tabs.find((t) => t.id === tabId)
  if (!tab) {
    return false
  }

  // Check if already in this tab
  if (tab.workspaceIds.includes(workspaceId)) {
    return true
  }

  // Plan tabs have no limit - just append
  if (tab.isPlanTab) {
    tab.workspaceIds.push(workspaceId)
    persistState()
    return true
  }

  // Regular tabs: find first empty slot (position 0-3)
  // workspaceIds may be sparse or shorter than 4
  let insertPosition = -1
  for (let i = 0; i < getMaxAgentsPerTab(); i++) {
    if (!tab.workspaceIds[i]) {
      insertPosition = i
      break
    }
  }

  if (insertPosition === -1) {
    // Tab is full
    return false
  }

  // Insert at the empty position
  tab.workspaceIds[insertPosition] = workspaceId
  persistState()
  return true
}

export function removeWorkspaceFromTab(workspaceId: string): void {
  for (const tab of currentState.tabs) {
    const index = tab.workspaceIds.indexOf(workspaceId)
    if (index !== -1) {
      // Set to undefined to keep position indices stable (sparse array)
      // Then compact to remove trailing undefined values
      tab.workspaceIds[index] = undefined as unknown as string
      // Compact: remove trailing undefined values
      while (
        tab.workspaceIds.length > 0 &&
        !tab.workspaceIds[tab.workspaceIds.length - 1]
      ) {
        tab.workspaceIds.pop()
      }
      break
    }
  }
  persistState()
}

export function reorderWorkspaceInTab(
  tabId: string,
  workspaceId: string,
  newPosition: number
): boolean {
  const tab = currentState.tabs.find((t) => t.id === tabId)
  if (!tab || newPosition < 0 || newPosition >= getMaxAgentsPerTab()) {
    return false
  }

  const currentIndex = tab.workspaceIds.findIndex((id) => id === workspaceId)
  if (currentIndex === -1) {
    return false
  }

  // Get the workspace at the target position (may be undefined)
  const targetWorkspaceId = tab.workspaceIds[newPosition]

  // Swap positions
  tab.workspaceIds[currentIndex] = targetWorkspaceId
  tab.workspaceIds[newPosition] = workspaceId

  // Clean up undefined values - compact trailing only
  while (
    tab.workspaceIds.length > 0 &&
    !tab.workspaceIds[tab.workspaceIds.length - 1]
  ) {
    tab.workspaceIds.pop()
  }

  persistState()
  return true
}

export function moveWorkspaceToTab(
  workspaceId: string,
  targetTabId: string,
  position?: number
): boolean {
  const targetTab = currentState.tabs.find((t) => t.id === targetTabId)
  if (!targetTab) {
    return false
  }

  // Check if workspace is already in target tab
  if (targetTab.workspaceIds.includes(workspaceId)) {
    // If position specified, just reorder within the tab
    if (position !== undefined) {
      return reorderWorkspaceInTab(targetTabId, workspaceId, position)
    }
    return true
  }

  // Find the target position
  let targetPosition = position
  if (targetPosition === undefined) {
    // Find first empty slot
    for (let i = 0; i < getMaxAgentsPerTab(); i++) {
      if (!targetTab.workspaceIds[i]) {
        targetPosition = i
        break
      }
    }
    if (targetPosition === undefined) {
      // Tab is full
      return false
    }
  } else if (targetTab.workspaceIds[targetPosition]) {
    // Target position is occupied and no swap needed (cross-tab)
    // Find first empty slot instead
    for (let i = 0; i < getMaxAgentsPerTab(); i++) {
      if (!targetTab.workspaceIds[i]) {
        targetPosition = i
        break
      }
    }
    if (
      targetPosition === position ||
      targetTab.workspaceIds[targetPosition!]
    ) {
      // Tab is full
      return false
    }
  }

  // Remove from current tab
  removeWorkspaceFromTab(workspaceId)

  // Add to target tab at specified position
  targetTab.workspaceIds[targetPosition!] = workspaceId

  persistState()
  return true
}

export function getOrCreateTabForWorkspace(workspaceId: string): AgentTab {
  // Check if workspace is already in a tab
  for (const tab of currentState.tabs) {
    if (tab.workspaceIds.includes(workspaceId)) {
      return tab
    }
  }

  // Find first tab with space (account for sparse arrays)
  for (const tab of currentState.tabs) {
    // Count actual workspaces (filter out undefined/null from sparse array)
    const actualCount = tab.workspaceIds.filter(Boolean).length
    if (actualCount < getMaxAgentsPerTab()) {
      return tab
    }
  }

  // All tabs full, create a new one
  return createTab()
}

export function getOrCreateTabForWorkspaceWithPreference(
  workspaceId: string,
  preferredTabId?: string
): AgentTab {
  // Check if workspace is already in a tab
  for (const tab of currentState.tabs) {
    if (tab.workspaceIds.includes(workspaceId)) {
      return tab
    }
  }

  // If preferred tab specified and has space, use it
  if (preferredTabId) {
    const preferredTab = currentState.tabs.find(t => t.id === preferredTabId)
    if (preferredTab) {
      const actualCount = preferredTab.workspaceIds.filter(Boolean).length
      if (actualCount < getMaxAgentsPerTab()) {
        return preferredTab
      }
    }
  }

  // Fall back to first tab with space
  for (const tab of currentState.tabs) {
    const actualCount = tab.workspaceIds.filter(Boolean).length
    if (actualCount < getMaxAgentsPerTab()) {
      return tab
    }
  }

  // All tabs full, create a new one
  return createTab()
}

export function getTabForWorkspace(workspaceId: string): AgentTab | undefined {
  return currentState.tabs.find((t) => t.workspaceIds.includes(workspaceId))
}

function persistState(): void {
  saveState(currentState)
}

export function getActiveWorkspaceIds(): string[] {
  return [...currentState.activeWorkspaceIds]
}

export function getTabs(): AgentTab[] {
  return currentState.tabs.map((t) => ({ ...t }))
}

export function getActiveTabId(): string | null {
  return currentState.activeTabId
}

// Preferences management
export function getPreferences(): AppPreferences {
  return { ...currentState.preferences }
}

export function setPreferences(preferences: Partial<AppPreferences>): AppPreferences {
  currentState.preferences = { ...currentState.preferences, ...preferences }
  persistState()
  return currentState.preferences
}

// Plan sidebar state management
export function getPlanSidebarOpen(): boolean {
  return currentState.planSidebarOpen || false
}

export function setPlanSidebarOpen(open: boolean): void {
  currentState.planSidebarOpen = open
  persistState()
}

export function getActivePlanId(): string | null {
  return currentState.activePlanId || null
}

export function setActivePlanId(planId: string | null): void {
  currentState.activePlanId = planId
  persistState()
}
