import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import type { Workspace, AppConfig, AppState, AppPreferences, Plan, TaskAssignment, PlanActivity, HeadlessAgentInfo } from '../shared/types'
import { agentIcons, type AgentIconName } from '../shared/constants'

// Use .bismarck-dev in development mode to avoid affecting production data
const CONFIG_DIR_NAME = process.env.NODE_ENV === 'development' ? '.bismarck-dev' : '.bismarck'

// Mutex for serializing plan modifications to prevent race conditions
const planMutexes: Map<string, Promise<void>> = new Map()

/**
 * Execute a function with exclusive access to a plan's data.
 * Prevents concurrent read-modify-write race conditions.
 */
export async function withPlanLock<T>(planId: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any pending operation on this plan
  const pending = planMutexes.get(planId) || Promise.resolve()

  let resolve: () => void
  const newPending = new Promise<void>((r) => { resolve = r })
  planMutexes.set(planId, newPending)

  try {
    await pending
    return await fn()
  } finally {
    resolve!()
    // Clean up if no other operations queued
    if (planMutexes.get(planId) === newPending) {
      planMutexes.delete(planId)
    }
  }
}

// Mutex for serializing git push operations per plan (separate from plan state lock)
const gitPushMutexes: Map<string, Promise<void>> = new Map()

// Global mutex for plans.json file operations
// This prevents race conditions when multiple tasks modify their plans concurrently
let plansFileMutex: Promise<void> = Promise.resolve()

/**
 * Execute a function with exclusive access to the plans.json file.
 * This is a global lock that serializes all savePlan/deletePlan operations
 * to prevent concurrent read-modify-write race conditions.
 */
export async function withPlansFileLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const pending = plansFileMutex
  let resolve: () => void
  plansFileMutex = new Promise<void>((r) => { resolve = r })

  try {
    await pending
    return await fn()
  } finally {
    resolve!()
  }
}

/**
 * Execute a function with exclusive access to git push operations for a plan.
 * Prevents concurrent pushes to the same feature branch.
 */
export async function withGitPushLock<T>(planId: string, fn: () => Promise<T>): Promise<T> {
  const pending = gitPushMutexes.get(planId) || Promise.resolve()

  let resolve: () => void
  const newPending = new Promise<void>((r) => { resolve = r })
  gitPushMutexes.set(planId, newPending)

  try {
    await pending
    return await fn()
  } finally {
    resolve!()
    if (gitPushMutexes.get(planId) === newPending) {
      gitPushMutexes.delete(planId)
    }
  }
}

/**
 * Execute a function with exclusive access to git operations on a repo.
 * Prevents concurrent worktree creation on the same repository.
 */
const repoMutexes: Map<string, Promise<void>> = new Map()

export async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const pending = repoMutexes.get(repoPath) || Promise.resolve()
  let resolve: () => void
  const newPending = new Promise<void>((r) => { resolve = r })
  repoMutexes.set(repoPath, newPending)
  try {
    await pending
    return await fn()
  } finally {
    resolve!()
    if (repoMutexes.get(repoPath) === newPending) {
      repoMutexes.delete(repoPath)
    }
  }
}

export function getConfigDir(): string {
  const homeDir = app?.getPath('home') || process.env.HOME || ''
  return path.join(homeDir, CONFIG_DIR_NAME)
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

export function getStatePath(): string {
  return path.join(getConfigDir(), 'state.json')
}

export function getPlansPath(): string {
  return path.join(getConfigDir(), 'plans.json')
}

export function getTaskAssignmentsPath(planId: string): string {
  return path.join(getConfigDir(), 'plans', planId, 'task-assignments.json')
}

export function getPlanActivitiesPath(planId: string): string {
  return path.join(getConfigDir(), 'plans', planId, 'activities.json')
}

export function getHeadlessAgentInfoPath(planId: string): string {
  return path.join(getConfigDir(), 'plans', planId, 'headless-agents.json')
}

export function getPlanWorktreesPath(planId: string): string {
  return path.join(getConfigDir(), 'plans', planId, 'worktrees')
}

export function getWorktreePath(planId: string, repoName: string, branchName: string): string {
  return path.join(getPlanWorktreesPath(planId), repoName, branchName)
}

// Standalone headless agent paths
export function getStandaloneHeadlessDir(): string {
  return path.join(getConfigDir(), 'standalone-headless')
}

export function getStandaloneHeadlessAgentInfoPath(): string {
  return path.join(getStandaloneHeadlessDir(), 'headless-agents.json')
}

export function getStandaloneWorktreesPath(): string {
  return path.join(getStandaloneHeadlessDir(), 'worktrees')
}

export function getStandaloneWorktreePath(repoName: string, branchName: string): string {
  return path.join(getStandaloneWorktreesPath(), repoName, branchName)
}

export function getRepoCacheDir(repoName: string): string {
  return path.join(getConfigDir(), 'repos', repoName, '.gocache')
}

export function getRepoModCacheDir(repoName: string): string {
  return path.join(getConfigDir(), 'repos', repoName, '.gomodcache')
}

export function ensureConfigDirExists(): void {
  const configDir = getConfigDir()
  const dirs = [
    configDir,
    path.join(configDir, 'sockets'),
    path.join(configDir, 'hooks'),
    path.join(configDir, 'sessions'),
  ]

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
  }

  // Create default config.json if it doesn't exist
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) {
    const defaultConfig: AppConfig = {
      workspaces: [],
    }
    writeConfigAtomic(configPath, defaultConfig)
  }

  // Create default state.json if it doesn't exist
  const statePath = getStatePath()
  if (!fs.existsSync(statePath)) {
    const defaultState: AppState = {
      activeWorkspaceIds: [],
      tabs: [],
      activeTabId: null,
      preferences: getDefaultPreferences(),
    }
    writeConfigAtomic(statePath, defaultState)
  }
}

export function getDefaultKeyboardShortcuts() {
  return {
    commandPalette: { key: 'k', modifiers: { meta: true, shift: false, alt: false } },
    dismissAgent: { key: 'n', modifiers: { meta: true, shift: false, alt: false } },
    devConsole: { key: 'd', modifiers: { meta: true, shift: true, alt: false } },
    toggleAgentSidebar: { key: 'b', modifiers: { meta: true, shift: false, alt: false } },
    togglePlansSidebar: { key: 'p', modifiers: { meta: true, shift: true, alt: false } },
    nextTab: { key: ']', modifiers: { meta: true, shift: true, alt: false } },
    previousTab: { key: '[', modifiers: { meta: true, shift: true, alt: false } },
    newTab: { key: 't', modifiers: { meta: true, shift: false, alt: false } },
    closeTab: { key: 'w', modifiers: { meta: true, shift: false, alt: false } },
    toggleMaximizeAgent: { key: 'm', modifiers: { meta: true, shift: true, alt: false } },
    closeAgent: { key: 'w', modifiers: { meta: true, shift: true, alt: false } },
  }
}

export function getDefaultPreferences(): AppPreferences {
  return {
    attentionMode: 'focus',
    operatingMode: 'solo',
    agentModel: 'sonnet',
    gridSize: '2x2',
    keyboardShortcuts: getDefaultKeyboardShortcuts(),
    showDiffView: true,
    showAgentTimer: true,
  }
}

// Atomic write to prevent corruption
export function writeConfigAtomic(filePath: string, data: unknown | string, mode?: number): void {
  const tempPath = `${filePath}.tmp`
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  fs.writeFileSync(tempPath, content, { mode: mode ?? 0o644 })
  fs.renameSync(tempPath, filePath)
}

// Helper to get a random unique icon for new agents
export function getRandomUniqueIcon(existingWorkspaces: Workspace[]): AgentIconName {
  const usedIcons = new Set(existingWorkspaces.map((w) => w.icon).filter(Boolean))
  const availableIcons = agentIcons.filter((i) => !usedIcons.has(i))
  if (availableIcons.length === 0) {
    // All icons used, pick random from full set
    return agentIcons[Math.floor(Math.random() * agentIcons.length)]
  }
  return availableIcons[Math.floor(Math.random() * availableIcons.length)]
}

// Config operations
export function loadConfig(): AppConfig {
  const configPath = getConfigPath()
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content) as AppConfig

    // Migration: assign icons to existing agents without one
    let needsSave = false
    for (const workspace of config.workspaces) {
      if (!workspace.icon) {
        workspace.icon = getRandomUniqueIcon(config.workspaces)
        needsSave = true
      }
    }
    if (needsSave) {
      writeConfigAtomic(configPath, config)
    }

    return config
  } catch {
    return { workspaces: [] }
  }
}

export function saveConfig(config: AppConfig): void {
  writeConfigAtomic(getConfigPath(), config)
}

// Workspace operations
export function getWorkspaces(): Workspace[] {
  const config = loadConfig()
  // Sort by order field (undefined values go to end, maintaining insertion order)
  return [...config.workspaces].sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER
    return orderA - orderB
  })
}

export function saveWorkspace(workspace: Workspace): Workspace {
  const config = loadConfig()
  const existingIndex = config.workspaces.findIndex((w) => w.id === workspace.id)

  if (existingIndex >= 0) {
    config.workspaces[existingIndex] = workspace
  } else {
    config.workspaces.push(workspace)
  }

  saveConfig(config)
  return workspace
}

export function deleteWorkspace(id: string): void {
  const config = loadConfig()
  config.workspaces = config.workspaces.filter((w) => w.id !== id)
  saveConfig(config)
}

export function reorderWorkspaces(workspaceIds: string[]): void {
  const config = loadConfig()
  // Assign order values based on the provided array order
  for (let i = 0; i < workspaceIds.length; i++) {
    const workspace = config.workspaces.find((w) => w.id === workspaceIds[i])
    if (workspace) {
      workspace.order = i
    }
  }
  saveConfig(config)
}

export function getWorkspaceById(id: string): Workspace | undefined {
  const workspaces = getWorkspaces()
  return workspaces.find((w) => w.id === id)
}

// State operations
export function loadState(): AppState {
  const statePath = getStatePath()
  try {
    const content = fs.readFileSync(statePath, 'utf-8')
    const state = JSON.parse(content) as AppState
    let needsSave = false
    // Ensure preferences exist (migration for existing state files)
    if (!state.preferences) {
      state.preferences = getDefaultPreferences()
      needsSave = true
    }
    // Migration: add agentModel if missing (default to 'sonnet')
    if (!state.preferences.agentModel) {
      state.preferences.agentModel = 'sonnet'
      needsSave = true
    }
    // Migration: add gridSize if missing (default to '2x2')
    if (!state.preferences.gridSize) {
      state.preferences.gridSize = '2x2'
      needsSave = true
    }
    // Migration: add keyboardShortcuts if missing
    if (!state.preferences.keyboardShortcuts) {
      state.preferences.keyboardShortcuts = getDefaultKeyboardShortcuts()
      needsSave = true
    }
    // Migration: rename isPlanTab → isDedicatedTab on existing tabs
    for (const tab of state.tabs) {
      if ('isPlanTab' in tab) {
        (tab as any).isDedicatedTab = (tab as any).isPlanTab
        delete (tab as any).isPlanTab
        needsSave = true
      }
    }
    // Persist migrations
    if (needsSave) {
      writeConfigAtomic(statePath, state)
    }
    return state
  } catch {
    return { activeWorkspaceIds: [], tabs: [], activeTabId: null, preferences: getDefaultPreferences() }
  }
}

export function saveState(state: AppState): void {
  writeConfigAtomic(getStatePath(), state)
}

// Plans operations
export function loadPlans(): Plan[] {
  const plansPath = getPlansPath()
  try {
    const content = fs.readFileSync(plansPath, 'utf-8')
    return JSON.parse(content) as Plan[]
  } catch {
    return []
  }
}

export function savePlans(plans: Plan[]): void {
  writeConfigAtomic(getPlansPath(), plans)
}

export async function savePlan(plan: Plan): Promise<Plan> {
  return withPlansFileLock(() => {
    const plans = loadPlans()
    const existingIndex = plans.findIndex((p) => p.id === plan.id)

    if (existingIndex >= 0) {
      plans[existingIndex] = plan
    } else {
      plans.push(plan)
    }

    savePlans(plans)
    return plan
  })
}

export async function deletePlan(id: string): Promise<void> {
  return withPlansFileLock(() => {
    const plans = loadPlans()
    savePlans(plans.filter((p) => p.id !== id))
  })
}

export function getPlanById(id: string): Plan | undefined {
  const plans = loadPlans()
  return plans.find((p) => p.id === id)
}

// Task assignment operations (per-plan)
export function loadTaskAssignments(planId: string): TaskAssignment[] {
  const assignmentsPath = getTaskAssignmentsPath(planId)
  try {
    const content = fs.readFileSync(assignmentsPath, 'utf-8')
    return JSON.parse(content) as TaskAssignment[]
  } catch {
    return []
  }
}

export function saveTaskAssignments(planId: string, assignments: TaskAssignment[]): void {
  const assignmentsPath = getTaskAssignmentsPath(planId)
  // Ensure the plan directory exists
  const planDir = path.dirname(assignmentsPath)
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true })
  }
  writeConfigAtomic(assignmentsPath, assignments)
}

export function saveTaskAssignment(planId: string, assignment: TaskAssignment): TaskAssignment {
  const assignments = loadTaskAssignments(planId)
  const existingIndex = assignments.findIndex((a) => a.beadId === assignment.beadId)

  if (existingIndex >= 0) {
    assignments[existingIndex] = assignment
  } else {
    assignments.push(assignment)
  }

  saveTaskAssignments(planId, assignments)
  return assignment
}

export function deleteTaskAssignment(planId: string, beadId: string): void {
  const assignments = loadTaskAssignments(planId)
  saveTaskAssignments(planId, assignments.filter((a) => a.beadId !== beadId))
}

// OAuth token storage
const OAUTH_TOKEN_FILE = 'oauth-token.json'

interface OAuthTokenData {
  token: string
  createdAt: string
}

function getOAuthTokenPath(): string {
  return path.join(getConfigDir(), OAUTH_TOKEN_FILE)
}

/**
 * Get the Claude OAuth token from storage or environment variable
 * Environment variable takes precedence for testing/CI scenarios
 */
export function getClaudeOAuthToken(): string | null {
  // Environment variable takes precedence
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN
  }

  // Read from file storage
  const tokenPath = getOAuthTokenPath()
  try {
    const content = fs.readFileSync(tokenPath, 'utf-8')
    const data = JSON.parse(content) as OAuthTokenData
    return data.token || null
  } catch {
    return null
  }
}

/**
 * Store the Claude OAuth token
 */
export function setClaudeOAuthToken(token: string): void {
  const tokenPath = getOAuthTokenPath()
  const data: OAuthTokenData = {
    token,
    createdAt: new Date().toISOString(),
  }
  writeConfigAtomic(tokenPath, data, 0o600)
}

/**
 * Clear the stored OAuth token
 */
export function clearClaudeOAuthToken(): void {
  const tokenPath = getOAuthTokenPath()
  try {
    fs.unlinkSync(tokenPath)
  } catch {
    // File doesn't exist, that's fine
  }
}

// GitHub token storage
const GITHUB_TOKEN_FILE = 'github-token.json'

interface GitHubTokenData {
  token: string
  createdAt: string
}

function getGitHubTokenPath(): string {
  return path.join(getConfigDir(), GITHUB_TOKEN_FILE)
}

/**
 * Get the configured GitHub token from file storage
 */
export function getConfiguredGitHubToken(): string | null {
  const tokenPath = getGitHubTokenPath()
  try {
    const content = fs.readFileSync(tokenPath, 'utf-8')
    const data = JSON.parse(content) as GitHubTokenData
    return data.token || null
  } catch {
    return null
  }
}

/**
 * Store the GitHub token
 */
export function setConfiguredGitHubToken(token: string): void {
  const tokenPath = getGitHubTokenPath()
  const data: GitHubTokenData = {
    token,
    createdAt: new Date().toISOString(),
  }
  writeConfigAtomic(tokenPath, data, 0o600)
}

/**
 * Clear the stored GitHub token
 */
export function clearConfiguredGitHubToken(): void {
  const tokenPath = getGitHubTokenPath()
  try {
    fs.unlinkSync(tokenPath)
  } catch {
    // File doesn't exist, that's fine
  }
}

// Plan activities persistence (per-plan)
export function loadPlanActivities(planId: string): PlanActivity[] {
  const activitiesPath = getPlanActivitiesPath(planId)
  try {
    const content = fs.readFileSync(activitiesPath, 'utf-8')
    return JSON.parse(content) as PlanActivity[]
  } catch {
    return []
  }
}

export function savePlanActivities(planId: string, activities: PlanActivity[]): void {
  const activitiesPath = getPlanActivitiesPath(planId)
  // Ensure the plan directory exists
  const planDir = path.dirname(activitiesPath)
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true })
  }
  writeConfigAtomic(activitiesPath, activities)
}

// Headless agent info persistence (per-plan)
export function loadHeadlessAgentInfo(planId: string): HeadlessAgentInfo[] {
  const agentInfoPath = getHeadlessAgentInfoPath(planId)
  try {
    const content = fs.readFileSync(agentInfoPath, 'utf-8')
    return JSON.parse(content) as HeadlessAgentInfo[]
  } catch {
    return []
  }
}

export function saveHeadlessAgentInfo(planId: string, agents: HeadlessAgentInfo[]): void {
  const agentInfoPath = getHeadlessAgentInfoPath(planId)
  // Ensure the plan directory exists
  const planDir = path.dirname(agentInfoPath)
  if (!fs.existsSync(planDir)) {
    fs.mkdirSync(planDir, { recursive: true })
  }
  writeConfigAtomic(agentInfoPath, agents)
}
