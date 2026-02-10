import type { AgentIconName } from './constants'

// Customizable prompt types (available in settings)
export type CustomizablePromptType = 'orchestrator' | 'planner' | 'discussion' | 'task' | 'standalone_headless' | 'standalone_followup' | 'headless_discussion' | 'critic'

// All prompt types (including internal/non-customizable prompts)
export type PromptType = CustomizablePromptType | 'ralph_loop_discussion' | 'plan_phase'

// Persona mode for interactive Claude sessions (injected via hooks)
export type PersonaMode = 'none' | 'bismarck' | 'otto' | 'custom'

// Custom prompt configuration
export interface CustomPrompt {
  type: PromptType
  template: string
  isCustom: boolean
}

// Branch strategy for plan execution
export type BranchStrategy = 'feature_branch' | 'raise_prs'

// Commit record for git summary (feature_branch strategy)
export interface PlanCommit {
  sha: string
  shortSha: string
  message: string
  taskId: string
  timestamp: string
  repositoryId: string
  githubUrl?: string
}

// Pull request record for git summary (raise_prs strategy)
export interface PlanPullRequest {
  number: number
  title: string
  url: string
  taskId: string
  baseBranch: string
  headBranch: string
  status: 'open' | 'merged' | 'closed'
  repositoryId: string
}

// Git summary for plan (commits or PRs depending on strategy)
export interface PlanGitSummary {
  commits?: PlanCommit[]      // For feature_branch strategy
  pullRequests?: PlanPullRequest[]  // For raise_prs strategy
}

// Repository configuration (stored in ~/.bismarck/repositories.json)
export interface Repository {
  id: string              // Hash of rootPath
  rootPath: string        // Absolute path to repository root
  name: string            // Directory basename
  defaultBranch: string   // Usually 'main' or 'master'
  remoteUrl?: string      // Origin remote URL
  purpose?: string        // Description of what repo is for
  completionCriteria?: string  // What "done" looks like
  protectedBranches?: string[]  // Branches that should not be modified
  guidance?: string       // Custom guidance/quirks for headless agents
}

// Agent definition (stored in ~/.bismarck/config.json)
export interface Agent {
  id: string
  name: string
  directory: string
  purpose: string
  theme: ThemeName
  icon: AgentIconName
  sessionId?: string // Claude session ID for resuming sessions across app restarts
  isOrchestrator?: boolean // Marks orchestrator workspaces (hidden from UI)
  isPlanAgent?: boolean // Marks plan agent workspaces (temporary, for task creation)

  // Repository linkage
  repositoryId?: string         // Reference to Repository.id

  // Task agent fields (for agents created by plan execution)
  isTaskAgent?: boolean         // Created for a specific plan task
  parentPlanId?: string         // Plan that created this task agent
  worktreePath?: string         // Path to worktree (for task agents)
  taskId?: string               // Associated task ID
  isHeadless?: boolean          // Running in headless Docker mode (no interactive terminal)
  isStandaloneHeadless?: boolean // Standalone headless agent (not part of a plan)
  order?: number                 // Display order in sidebar (lower = higher in list)
}

// Alias for backwards compatibility
export type Workspace = Agent

// Tab containing agents in a configurable grid layout
export interface AgentTab {
  id: string
  name: string
  workspaceIds: string[] // Order = grid position (row-major: TL, TR, ..., BL, BR, ...)
  isPlanTab?: boolean // Identifies plan orchestrator tabs
  planId?: string // Links tab to plan for restoration
}

// Attention mode determines how waiting agents are displayed
// 'off' = no visual indicators for waiting agents
export type AttentionMode = 'off' | 'focus' | 'expand' | 'queue'

// Grid size for agent display
export type GridSize = '1x1' | '2x2' | '2x3' | '3x3'

// Operating mode determines how agents work together
export type OperatingMode = 'solo' | 'team'

// Model for headless task agents
export type AgentModel = 'opus' | 'sonnet' | 'haiku'

// Keyboard shortcut configuration
export interface KeyboardShortcut {
  key: string          // The key (e.g., 'k', 'n', 'd')
  modifiers: {
    meta: boolean      // Cmd on Mac, Ctrl on Windows/Linux
    shift: boolean
    alt: boolean
  }
}

// Keyboard shortcuts configuration
export interface KeyboardShortcuts {
  commandPalette: KeyboardShortcut    // Default: Cmd/Ctrl+K
  dismissAgent: KeyboardShortcut      // Default: Cmd/Ctrl+N
  devConsole?: KeyboardShortcut       // Default: Cmd/Ctrl+Shift+D (dev only)
  toggleAgentSidebar?: KeyboardShortcut  // Default: Cmd/Ctrl+B
  togglePlansSidebar?: KeyboardShortcut  // Default: Cmd/Ctrl+Shift+P
  nextTab?: KeyboardShortcut             // Default: Cmd/Ctrl+Shift+]
  previousTab?: KeyboardShortcut         // Default: Cmd/Ctrl+Shift+[
  newTab?: KeyboardShortcut              // Default: Cmd/Ctrl+T
  closeTab?: KeyboardShortcut            // Default: Cmd/Ctrl+W
  toggleMaximizeAgent?: KeyboardShortcut // Default: Cmd/Ctrl+Shift+M
  closeAgent?: KeyboardShortcut          // Default: Cmd/Ctrl+Shift+W
}

// App preferences (stored in ~/.bismarck/state.json)
export interface AppPreferences {
  attentionMode: AttentionMode
  operatingMode: OperatingMode
  agentModel: AgentModel
  gridSize: GridSize
  tutorialCompleted?: boolean
  keyboardShortcuts?: KeyboardShortcuts
  showDiffView?: boolean
  showAgentTimer?: boolean
  diffFileViewType?: 'flat' | 'tree'
  diffViewMode?: 'unified' | 'split'
}

// ============================================
// Tutorial Types
// ============================================

// Tutorial step definitions
export type TutorialStep =
  | 'welcome'           // Introduction to Bismarck
  | 'workspace'         // Creating first agent/workspace
  | 'agent-lifecycle'   // Starting and stopping agents
  | 'terminal'          // Understanding terminal interaction
  | 'tabs'              // Working with tabs and grid layout
  | 'attention'         // Attention modes and workflow
  | 'team-mode'         // Team mode and plan execution
  | 'settings'          // Configuring Bismarck settings
  | 'complete'          // Tutorial completion

// Tutorial step metadata
export interface TutorialStepInfo {
  id: TutorialStep
  title: string
  description: string
  completionCriteria: string
  order: number
}

// Tutorial state tracking
export interface TutorialState {
  isActive: boolean
  currentStep: TutorialStep
  completedSteps: TutorialStep[]
  startedAt?: string
  completedAt?: string
  skipped?: boolean
}

// App state (stored in ~/.bismarck/state.json)
export interface AppState {
  activeWorkspaceIds: string[]
  tabs: AgentTab[]
  activeTabId: string | null
  focusedWorkspaceId?: string
  preferences: AppPreferences
  // Team mode state
  planSidebarOpen?: boolean
  activePlanId?: string | null
  // Tutorial state
  tutorialState?: TutorialState
}

// Theme presets
export type ThemeName =
  | 'brown'
  | 'blue'
  | 'red'
  | 'gray'
  | 'green'
  | 'purple'
  | 'teal'
  | 'orange'
  | 'pink'

export interface ThemeColors {
  bg: string
  fg: string
}

// Config file structure
export interface AppConfig {
  workspaces: Workspace[]
}

// Terminal session info
export interface TerminalSession {
  id: string
  workspaceId: string
  isWaiting: boolean
}

// Plan status for team mode
// 'discussing' = brainstorming phase before task creation
// 'discussed' = discussion complete, ready for execution
// 'ready_for_review' = all agents done, awaiting user review before cleanup
export type PlanStatus = 'draft' | 'discussing' | 'discussed' | 'delegating' | 'in_progress' | 'ready_for_review' | 'completed' | 'failed'

// Discussion category for structured brainstorming
export type DiscussionCategory =
  | 'requirements'
  | 'architecture'
  | 'testing'
  | 'monitoring'
  | 'edge_cases'

// Discussion message in a plan brainstorming session
export interface DiscussionMessage {
  id: string
  role: 'agent' | 'user'
  content: string
  timestamp: string
  category?: DiscussionCategory  // For agent questions
}

// Discussion state for a plan
export interface PlanDiscussion {
  id: string
  planId: string
  status: 'active' | 'approved' | 'cancelled'
  messages: DiscussionMessage[]
  summary?: string  // Generated when approved
  startedAt: string
  approvedAt?: string
}

// Worktree status for plan execution
export type PlanWorktreeStatus = 'active' | 'ready_for_review' | 'cleaned'

// Worktree created for a plan task
export interface PlanWorktree {
  id: string
  planId: string
  taskId: string
  repositoryId: string
  path: string                  // e.g., ~/.bismarck/plans/{planId}/worktrees/pax/fix-bug
  branch: string
  agentId: string               // Task agent working in this worktree
  status: PlanWorktreeStatus    // ready_for_review = agent done, awaiting user review
  createdAt: string
  // PR/commit tracking (populated based on plan's branchStrategy)
  prNumber?: number             // PR number if created (raise_prs strategy)
  prUrl?: string                // PR URL
  prBaseBranch?: string         // Branch this PR targets
  commits?: string[]            // Commit SHAs pushed (feature_branch strategy)
  // Merge tracking for feature_branch strategy
  mergedAt?: string             // When commits were merged into feature branch
  mergedIntoFeatureBranch?: boolean  // True if commits have been pushed to feature branch
  mergeTaskId?: string          // ID of the merge task in beads (if merge agent was spawned)
  // Task dependency tracking
  blockedBy?: string[]          // Task IDs this task depends on
  baseBranch?: string           // Branch this worktree was created from (for PR base)
  // Critic review tracking
  criticIteration?: number                                    // Current review iteration (0-based)
  criticStatus?: 'pending' | 'reviewing' | 'approved' | 'rejected'
  criticTaskId?: string                                       // Current critic task ID in beads
  totalFixupCount?: number                                     // Cumulative fix-up tasks across all critic iterations
}

// Plan definition for team mode coordination
export interface Plan {
  id: string
  title: string
  description: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  referenceAgentId: string | null
  beadEpicId: string | null
  orchestratorWorkspaceId: string | null // Tracks orchestrator workspace
  orchestratorTabId: string | null // Tracks orchestrator's dedicated tab
  planAgentWorkspaceId?: string | null // Tracks plan agent workspace (temporary)
  discussionAgentWorkspaceId?: string | null // Tracks discussion agent workspace

  // Discussion phase (brainstorming before task creation)
  discussion?: PlanDiscussion

  // Worktree tracking for new plan execution model
  worktrees?: PlanWorktree[]
  maxParallelAgents?: number    // Default: 4

  // Branch/PR strategy configuration
  branchStrategy: BranchStrategy   // How task agents handle git operations
  featureBranch?: string           // Shared branch name (feature_branch strategy)
  gitSummary?: PlanGitSummary      // Commits/PRs created during execution

  // Discussion output file path (written by discussion agent)
  discussionOutputPath?: string

  // Critic criteria from discussion output
  criticCriteriaPath?: string
}

// Task assignment status
export type TaskAssignmentStatus = 'pending' | 'sent' | 'in_progress' | 'completed' | 'failed'

// Task assignment linking bd tasks to agents
export interface TaskAssignment {
  beadId: string        // bd task ID
  agentId: string       // Assigned agent
  planId: string        // Plan this task belongs to
  status: TaskAssignmentStatus
  assignedAt: string
  completedAt?: string
}

// Activity log entry type for plan execution visibility
export type PlanActivityType = 'info' | 'success' | 'warning' | 'error'

// Activity log entry for plan execution
export interface PlanActivity {
  id: string
  planId: string
  timestamp: string
  type: PlanActivityType
  message: string
  details?: string  // Optional extra context
}

// ============================================
// Headless Agent & Docker Container Types
// ============================================

// Agent execution mode
export type AgentExecutionMode = 'interactive' | 'headless'

// Headless agent status
export type HeadlessAgentStatus =
  | 'idle'
  | 'planning'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed'
  | 'interrupted'  // Agent was running when app closed

// Container configuration for spawning Docker containers
export interface ContainerConfig {
  image: string           // Docker image name (e.g., "bismarck-agent:latest")
  workingDir: string      // Path to mount as /workspace
  planDir?: string        // Path to mount as /plan (for bd commands)
  proxyHost?: string      // Override proxy URL (default: auto-detect)
  env?: Record<string, string>  // Additional environment variables
  prompt: string          // The prompt to send to Claude
  claudeFlags?: string[]  // Additional claude CLI flags
}

// Result from a headless agent execution
export interface HeadlessAgentResult {
  success: boolean
  exitCode: number
  result?: string
  cost?: {
    input_tokens: number
    output_tokens: number
    total_cost_usd?: number
  }
  duration_ms?: number
  error?: string
}

// ============================================
// Stream Event Types (from Claude's stream-json output)
// ============================================

// Base event structure
export interface StreamEventBase {
  type: string
  timestamp: string
}

// Initialization event
export interface StreamInitEvent extends StreamEventBase {
  type: 'init'
  session_id: string
  model?: string
}

// Message content event
export interface StreamMessageEvent extends StreamEventBase {
  type: 'message'
  content: string
  role?: 'assistant' | 'user'
}

// Tool use event
export interface StreamToolUseEvent extends StreamEventBase {
  type: 'tool_use'
  tool_name: string
  tool_id: string
  input: Record<string, unknown>
}

// Tool result event
export interface StreamToolResultEvent extends StreamEventBase {
  type: 'tool_result'
  tool_id: string
  output: string
  is_error?: boolean
}

// Final result event
export interface StreamResultEvent extends StreamEventBase {
  type: 'result'
  result?: string
  cost?: {
    input_tokens: number
    output_tokens: number
    total_cost_usd?: number
  }
  duration_ms?: number
  num_turns?: number
}

// Union of all stream event types
export type StreamEvent =
  | StreamInitEvent
  | StreamMessageEvent
  | StreamToolUseEvent
  | StreamToolResultEvent
  | StreamResultEvent
  | (StreamEventBase & Record<string, unknown>)  // Fallback for unknown events

// ============================================
// Headless Agent Tracking
// ============================================

// Worktree info for standalone headless agents
export interface StandaloneWorktreeInfo {
  path: string           // Full worktree path
  branch: string         // Branch name
  repoPath: string       // Original repo path (for cleanup)
}

// Tracks a headless agent instance (for UI state)
export interface HeadlessAgentInfo {
  id: string
  taskId?: string
  planId: string
  status: HeadlessAgentStatus
  worktreePath: string
  events: StreamEvent[]
  startedAt: string
  completedAt?: string
  result?: HeadlessAgentResult
  worktreeInfo?: StandaloneWorktreeInfo  // For standalone headless agents
  originalPrompt?: string  // Full resolved prompt (for Eye modal display)
  userPrompt?: string  // Raw user-submitted prompt (for Eye modal default view)
  planText?: string  // Plan generated during planning phase (for Eye modal display)
  model?: AgentModel  // Model used for this agent (opus/sonnet/haiku)
  agentType?: 'task' | 'critic' | 'merge'  // Type of headless agent (default: task)
}

// Extended Agent type to support both execution modes
export interface AgentWithMode extends Agent {
  executionMode?: AgentExecutionMode
  headlessInfo?: HeadlessAgentInfo
}

// Tracks a spawning headless agent (for placeholder rendering)
export interface SpawningHeadlessInfo {
  id: string                  // Temporary ID like "spawning-1234567890"
  referenceAgentId: string    // The agent used as reference
  tabId: string               // Which tab to show the placeholder in
  prompt: string              // Prompt being executed
  model: 'opus' | 'sonnet'    // Model being used
  startedAt: number           // Timestamp for display purposes
  // Fallback metadata captured at spawn time (for resilient rendering)
  referenceName: string       // Agent name for display
  referenceIcon: AgentIconName // Agent icon
  referenceTheme: ThemeName   // Agent theme color
}

// ============================================
// Bead Task Types (from bd CLI)
// ============================================

// Bead task from bd CLI
export interface BeadTask {
  id: string
  title: string
  status: 'open' | 'closed'
  type?: 'epic' | 'task'
  parent?: string
  assignee?: string
  labels?: string[]
  blockedBy?: string[]  // Task IDs that this task depends on (blocks this task)
}

// ============================================
// Dependency Graph Types
// ============================================

// Combined status for task nodes (assignment status + planned state)
export type TaskNodeStatus = TaskAssignmentStatus | 'planned' | 'ready' | 'blocked'

// Dependency graph node representing a task with its relationships
export interface TaskNode {
  id: string
  title: string
  status: TaskNodeStatus  // 'planned' = not yet assigned, 'ready' = can start, 'blocked' = waiting
  blockedBy: string[]     // Task IDs this task depends on
  blocks: string[]        // Task IDs that depend on this task
  depth: number           // Distance from root (for layout)
  isOnCriticalPath: boolean
  assignment?: TaskAssignment  // If task has been dispatched
}

// Full dependency graph structure
export interface DependencyGraph {
  nodes: Map<string, TaskNode>
  edges: Array<{ from: string; to: string; isOnCriticalPath: boolean }>
  roots: string[]        // Tasks with no blockers
  leaves: string[]       // Tasks that don't block anything
  criticalPath: string[] // Longest chain of incomplete tasks
  maxDepth: number
}

// Graph statistics for summary display
export interface GraphStats {
  total: number
  completed: number
  inProgress: number
  sent: number
  blocked: number    // Planned with unfinished blockers
  ready: number      // Planned with all blockers done
  failed: number
}

// ============================================
// Setup Wizard Types
// ============================================

// Discovered repository during setup wizard scanning
export interface DiscoveredRepo {
  path: string          // Absolute path to repository
  name: string          // Directory basename
  remoteUrl?: string    // Origin remote URL if available
  lastCommitDate?: string // ISO 8601 timestamp of most recent commit
}

// Description generation progress status
export type DescriptionGenerationStatus = 'pending' | 'generating' | 'completed' | 'error'

// Progress event for real-time description generation feedback
export interface DescriptionProgressEvent {
  repoPath: string
  repoName: string
  status: DescriptionGenerationStatus
  result?: { purpose: string; completionCriteria: string; protectedBranches: string[] }
  error?: string
  quote?: string
}

// ============================================
// Plan Mode Dependency Types
// ============================================

// Status of a single dependency for plan mode
export interface DependencyStatus {
  name: string
  required: boolean
  installed: boolean
  path: string | null
  version: string | null
  installCommand?: string  // e.g., "brew install docker"
}

// GitHub token status (never includes actual token value)
export interface GitHubTokenStatus {
  detected: boolean       // true if a token was found via detection
  source: string | null   // e.g., "GITHUB_TOKEN environment variable", "GH_TOKEN environment variable"
  configured: boolean     // true if a token is saved in settings
}

// Claude OAuth token status
export interface ClaudeOAuthTokenStatus {
  configured: boolean     // true if a token is saved
}

// Docker image availability status
export interface DockerImageStatus {
  available: boolean
  imageName: string
}

// Collection of all plan mode dependencies
export interface PlanModeDependencies {
  docker: DependencyStatus
  bd: DependencyStatus
  gh: DependencyStatus
  git: DependencyStatus
  claude: DependencyStatus
  bb: DependencyStatus
  githubToken: GitHubTokenStatus
  claudeOAuthToken: ClaudeOAuthTokenStatus
  dockerImage: DockerImageStatus
  allRequiredInstalled: boolean  // true if all required deps are installed
}

// ============================================
// Ralph Loop Types
// ============================================

// Configuration for starting a Ralph Loop
export interface RalphLoopConfig {
  prompt: string
  completionPhrase: string    // e.g., "<promise>COMPLETE</promise>"
  maxIterations: number       // default: 50
  model: 'opus' | 'sonnet'
  referenceAgentId: string
}

// Ralph Loop execution status
export type RalphLoopStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'max_iterations'
  | 'failed'
  | 'cancelled'

// Single iteration within a Ralph Loop
export interface RalphLoopIteration {
  iterationNumber: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  workspaceId?: string        // Workspace created for this iteration
  events: StreamEvent[]
  startedAt: string
  completedAt?: string
  completionPhraseFound: boolean
  cost?: { input_tokens: number; output_tokens: number; total_cost_usd?: number }
  duration_ms?: number
}

// Git summary for Ralph Loop (commits and PRs produced by the agent)
export interface RalphLoopGitSummary {
  branch: string              // Working branch name
  commits: Array<{
    sha: string
    shortSha: string
    message: string
    timestamp: string
  }>
  pullRequests: Array<{
    number: number
    title: string
    url: string
    baseBranch: string
    status: 'open' | 'merged' | 'closed'
  }>
}

// Full Ralph Loop state
export interface RalphLoopState {
  id: string
  config: RalphLoopConfig
  status: RalphLoopStatus
  iterations: RalphLoopIteration[]
  currentIteration: number
  startedAt: string
  completedAt?: string
  totalCost?: { input_tokens: number; output_tokens: number; total_cost_usd?: number }
  worktreeInfo: StandaloneWorktreeInfo
  workspaceId: string         // Base workspace ID (first iteration)
  tabId: string               // Dedicated tab for all iterations
  phrase: string              // Random phrase for naming (e.g., "plucky-otter")
  referenceAgentDirectory: string  // Reference agent's directory (for bd proxy planId)
  gitSummary?: RalphLoopGitSummary  // Git info: branch, commits, PRs
}

// ============================================
// Git Diff Types
// ============================================

// Individual file in a diff result
export interface DiffFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  isBinary: boolean
}

// Complete diff result with files and summary
export interface DiffResult {
  files: DiffFile[]
  summary: {
    filesChanged: number
    additions: number
    deletions: number
  }
}

// Content and metadata for viewing a specific file's diff
export interface FileDiffContent {
  oldContent: string
  newContent: string
  language: string
  isBinary: boolean
  isTooLarge: boolean
  error?: string
}

// Git browser types for code editor

// File entry in git tree (from ls-tree)
export interface GitFileEntry {
  path: string
  type: 'blob' | 'tree'
}

// Commit information from git log
export interface GitCommit {
  sha: string
  shortSha: string
  message: string
  author: string
  timestamp: string
}

// Branch information
export interface GitBranch {
  name: string
  shortSha: string
  date: string
  isRemote: boolean
  isCurrent: boolean
}

// File content with metadata
export interface FileContent {
  content: string
  language: string
  isBinary: boolean
  isTooLarge: boolean
  error?: string
}
