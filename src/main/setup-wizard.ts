/**
 * Setup Wizard - First-time user onboarding to discover and create agents
 *
 * This module provides functionality for the setup wizard that appears when
 * no agents exist. It helps users discover git repositories and bulk-create agents.
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import { dialog } from 'electron'
import { randomUUID } from 'crypto'
import type { DiscoveredRepo, Agent, ThemeName } from '../shared/types'
import { isGitRepo, getRepoRoot, getRemoteUrl, getLastCommitDate } from './git-utils'
import { saveWorkspace, getWorkspaces, getClaudeOAuthToken } from './config'
import { agentIcons, type AgentIconName } from '../shared/constants'
import { detectRepository, updateRepository } from './repository-manager'
import { loadSettings, updateSettings, setGitHubToken, hasConfiguredGitHubToken } from './settings-manager'
import { findBinary, detectGitHubToken, detectGitHubTokenWithReason } from './exec-utils'
import { setPreferences } from './state-manager'
import { checkImageExists, pullImage, getDefaultImage, checkDockerAvailable, getImageInfo } from './docker-sandbox'

/**
 * Status of a single dependency for plan mode
 */
export interface DependencyStatus {
  name: string
  required: boolean
  installed: boolean
  path: string | null
  version: string | null
  installCommand?: string  // e.g., "brew install docker"
}

/**
 * GitHub token status (never includes the actual token)
 */
export interface GitHubTokenStatus {
  detected: boolean       // true if a token was found via detection
  source: string | null   // e.g., "gh auth", "~/.config/gh/hosts.yml", "GITHUB_TOKEN env"
  configured: boolean     // true if a token is saved in settings
}

/**
 * Claude OAuth token status
 */
export interface ClaudeOAuthTokenStatus {
  configured: boolean     // true if a token is saved
}

/**
 * Collection of all plan mode dependencies
 */
/**
 * Docker image availability status
 */
export interface DockerImageStatus {
  available: boolean
  imageName: string
  version?: string   // from org.opencontainers.image.version label
  digest?: string    // registry digest (sha256:...)
}

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

/**
 * Show native folder picker dialog
 * Returns the selected directory path or null if cancelled
 */
export async function showFolderPicker(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Parent Directory',
    message: 'Choose a directory to scan for git repositories',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
}

/**
 * Get common repository paths that exist on the user's system
 * Returns suggested paths like ~/dev, ~/projects, ~/code, ~/src
 */
export async function getCommonRepoPaths(): Promise<string[]> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const commonPaths = [
    path.join(homeDir, 'dev'),
    path.join(homeDir, 'projects'),
    path.join(homeDir, 'code'),
    path.join(homeDir, 'src'),
  ]

  // Filter to only paths that exist
  const existingPaths: string[] = []
  for (const p of commonPaths) {
    try {
      await fs.access(p)
      existingPaths.push(p)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  return existingPaths
}

/**
 * Scan a directory for git repositories up to specified depth
 * Returns discovered repositories with their paths, names, and remote URLs
 */
export async function scanForRepositories(
  parentPath: string,
  depth: number = 2
): Promise<DiscoveredRepo[]> {
  const discovered: DiscoveredRepo[] = []
  const existingWorkspaces = getWorkspaces()
  const existingPaths = new Set(existingWorkspaces.map((w) => w.directory))

  // Recursive scan helper
  async function scan(currentPath: string, currentDepth: number): Promise<void> {
    // Stop if we've reached max depth
    if (currentDepth > depth) {
      return
    }

    try {
      // Check if this directory is a git repo
      if (await isGitRepo(currentPath)) {
        const repoRoot = await getRepoRoot(currentPath)

        if (repoRoot) {
          // Skip if this repo already has an agent configured
          if (existingPaths.has(repoRoot)) {
            return
          }

          // Add to discovered list if not already there
          if (!discovered.find((r) => r.path === repoRoot)) {
            const remoteUrl = await getRemoteUrl(repoRoot)
            const lastCommitDate = await getLastCommitDate(repoRoot)
            discovered.push({
              path: repoRoot,
              name: path.basename(repoRoot),
              remoteUrl: remoteUrl || undefined,
              lastCommitDate: lastCommitDate || undefined,
            })
          }
        }

        // Don't recurse into subdirectories of a git repo
        return
      }

      // If not a git repo, scan subdirectories
      const entries = await fs.readdir(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Skip hidden directories and common non-repo directories
          if (entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === 'vendor' ||
              entry.name === '__pycache__') {
            continue
          }

          const subPath = path.join(currentPath, entry.name)
          await scan(subPath, currentDepth + 1)
        }
      }
    } catch (error) {
      // Ignore permission errors and continue scanning
      // This handles cases where we can't read certain directories
    }
  }

  await scan(parentPath, 0)

  // Sort by lastCommitDate descending (most recent first)
  // Repos without commit dates go to the end
  discovered.sort((a, b) => {
    if (!a.lastCommitDate && !b.lastCommitDate) return 0
    if (!a.lastCommitDate) return 1
    if (!b.lastCommitDate) return -1
    return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime()
  })

  return discovered
}

/**
 * Extended DiscoveredRepo with optional fields for bulk creation
 */
interface DiscoveredRepoWithDetails extends DiscoveredRepo {
  purpose?: string
  completionCriteria?: string
  protectedBranches?: string[]
}

/**
 * Bulk create agents from discovered repositories
 * Auto-generates names from folder names, random themes/icons
 * Uses provided purpose, completionCriteria, and protectedBranches if available
 * Persists all fields to both Agent and Repository records
 */
export async function bulkCreateAgents(repos: DiscoveredRepoWithDetails[]): Promise<Agent[]> {
  const createdAgents: Agent[] = []
  const themes: ThemeName[] = ['brown', 'blue', 'red', 'gray', 'green', 'purple', 'teal', 'orange', 'pink']
  const icons = [...agentIcons]  // agentIcons is already an array of icon names

  for (const repo of repos) {
    // Detect/register the repository first
    const repository = await detectRepository(repo.path)

    // Update the repository with purpose, completionCriteria, and protectedBranches
    // BUT only update fields that are empty in the existing repository
    // This preserves existing values and only fills in missing ones
    if (repository) {
      const updates: Partial<Pick<typeof repository, 'purpose' | 'completionCriteria' | 'protectedBranches'>> = {}

      // Only update purpose if the repo doesn't have one and we have a new value
      if (!repository.purpose && repo.purpose) {
        updates.purpose = repo.purpose
      }

      // Only update completionCriteria if the repo doesn't have one and we have a new value
      if (!repository.completionCriteria && repo.completionCriteria) {
        updates.completionCriteria = repo.completionCriteria
      }

      // Only update protectedBranches if the repo doesn't have any and we have new values
      if ((!repository.protectedBranches || repository.protectedBranches.length === 0) && repo.protectedBranches && repo.protectedBranches.length > 0) {
        updates.protectedBranches = repo.protectedBranches
      }

      // Only call updateRepository if we have updates to make
      if (Object.keys(updates).length > 0) {
        await updateRepository(repository.id, updates)
      }
    }

    // Generate random theme and icon
    const theme = themes[Math.floor(Math.random() * themes.length)]
    const icon = icons[Math.floor(Math.random() * icons.length)]

    // Determine the purpose to use for the agent:
    // Prefer existing repository values, fall back to provided values
    const agentPurpose = repository?.purpose || repo.purpose || ''

    // Create new agent
    const newAgent: Agent = {
      id: randomUUID(),
      name: repo.name,
      directory: repo.path,
      purpose: agentPurpose,
      theme,
      icon,
      repositoryId: repository?.id, // Link to repository if detected
    }

    // Save the agent
    saveWorkspace(newAgent)
    createdAgents.push(newAgent)
  }

  return createdAgents
}

/**
 * Save the selected path as the default repos path in settings
 */
export async function saveDefaultReposPath(reposPath: string): Promise<void> {
  const settings = await loadSettings()
  await updateSettings({
    ...settings,
    paths: {
      ...settings.paths,
      defaultReposPath: reposPath,
    },
  })
}

/**
 * Get the saved default repos path from settings
 */
export async function getDefaultReposPath(): Promise<string | null> {
  const settings = await loadSettings()
  return (settings.paths as any).defaultReposPath || null
}

/**
 * Check if a command exists and get its version
 * Uses findBinary to locate commands in extended PATH (works in production Electron)
 */
async function checkCommand(
  command: string,
  versionArgs: string[] = ['--version']
): Promise<{ path: string | null; version: string | null }> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  // Find the command path using findBinary (searches extended PATH)
  const commandPath = findBinary(command)

  if (!commandPath) {
    return { path: null, version: null }
  }

  // Get version using the full path
  try {
    const { stdout: versionOutput } = await execFileAsync(commandPath, versionArgs)
    // Extract version - typically first line contains version info
    const version = versionOutput.split('\n')[0].trim()
    return { path: commandPath, version }
  } catch {
    // Command exists but version check failed
    return { path: commandPath, version: null }
  }
}

/**
 * Check Docker specifically (uses 'docker version' for better output)
 * Uses findBinary to locate docker in extended PATH (works in production Electron)
 */
async function checkDocker(): Promise<{ path: string | null; version: string | null }> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  // Find docker using findBinary (searches extended PATH)
  const dockerPath = findBinary('docker')

  if (!dockerPath) {
    return { path: null, version: null }
  }

  // Use 'docker version --format' for clean version output
  try {
    const { stdout } = await execFileAsync(dockerPath, ['version', '--format', '{{.Client.Version}}'])
    return { path: dockerPath, version: stdout.trim() }
  } catch {
    // Docker exists but might not be running - try just getting client version
    try {
      const { stdout } = await execFileAsync(dockerPath, ['--version'])
      // Parse "Docker version 24.0.7, build afdd53b"
      const match = stdout.match(/Docker version ([^\s,]+)/)
      return { path: dockerPath, version: match ? match[1] : null }
    } catch {
      return { path: dockerPath, version: null }
    }
  }
}

/**
 * Detect GitHub token status (for UI display - never returns actual token)
 * Uses the shared detectGitHubToken from exec-utils
 */
async function detectGitHubTokenStatus(): Promise<GitHubTokenStatus> {
  const configured = await hasConfiguredGitHubToken()

  if (configured) {
    return { detected: false, source: null, configured: true }
  }

  const result = await detectGitHubToken()
  return {
    detected: result !== null,
    source: result?.source ?? null,
    configured: false,
  }
}

/**
 * Detect and save GitHub token directly (token never crosses IPC)
 * Returns success status, source, and reason for failure
 * Uses the shared detectGitHubTokenWithReason from exec-utils
 */
export async function detectAndSaveGitHubToken(): Promise<{
  success: boolean
  source: string | null
  reason?: string  // Why detection failed - used by UI to show appropriate message
}> {
  const result = await detectGitHubTokenWithReason()
  if (result.token) {
    await setGitHubToken(result.token)
    return { success: true, source: result.source }
  }
  return {
    success: false,
    source: null,
    reason: result.reason || 'not_found',
  }
}

/**
 * Check all dependencies required for plan mode
 */
export async function checkPlanModeDependencies(): Promise<PlanModeDependencies> {
  // Check all dependencies in parallel
  const [dockerResult, bdResult, ghResult, gitResult, claudeResult, bbResult, githubTokenStatus] = await Promise.all([
    checkDocker(),
    checkCommand('bd'),
    checkCommand('gh'),
    checkCommand('git'),
    checkCommand('claude'),
    checkCommand('bb'),
    detectGitHubTokenStatus(),
  ])

  // Check Claude OAuth token status
  const claudeOAuthToken = getClaudeOAuthToken()
  const claudeOAuthTokenStatus = {
    configured: claudeOAuthToken !== null,
  }

  const docker: DependencyStatus = {
    name: 'Docker',
    required: true,
    installed: dockerResult.path !== null,
    path: dockerResult.path,
    version: dockerResult.version,
    installCommand: 'brew install --cask docker',
  }

  const bd: DependencyStatus = {
    name: 'Beads (bd)',
    required: true,
    installed: bdResult.path !== null,
    path: bdResult.path,
    version: bdResult.version,
    installCommand: 'curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash',
  }

  const gh: DependencyStatus = {
    name: 'GitHub CLI (gh)',
    required: false,
    installed: ghResult.path !== null,
    path: ghResult.path,
    version: ghResult.version,
    installCommand: 'brew install gh',
  }

  const git: DependencyStatus = {
    name: 'Git',
    required: true,
    installed: gitResult.path !== null,
    path: gitResult.path,
    version: gitResult.version,
    installCommand: 'brew install git',
  }

  const claude: DependencyStatus = {
    name: 'Claude Code',
    required: true,
    installed: claudeResult.path !== null,
    path: claudeResult.path,
    version: claudeResult.version,
    installCommand: 'npm install -g @anthropic-ai/claude-code',
  }

  const bb: DependencyStatus = {
    name: 'BuildBuddy CLI (bb)',
    required: false,
    installed: bbResult.path !== null,
    path: bbResult.path,
    version: bbResult.version,
    installCommand: 'curl -fsSL https://install.buildbuddy.io | bash',
  }

  // Check Docker image availability (only if Docker is installed)
  let dockerImageAvailable = false
  let dockerImageVersion: string | undefined
  let dockerImageDigest: string | undefined
  if (dockerResult.path !== null) {
    const imageInfo = await getImageInfo(getDefaultImage())
    dockerImageAvailable = imageInfo.exists
    dockerImageVersion = imageInfo.labels?.['org.opencontainers.image.version']
    dockerImageDigest = imageInfo.digest
  }
  const dockerImage: DockerImageStatus = {
    available: dockerImageAvailable,
    imageName: getDefaultImage(),
    version: dockerImageVersion,
    digest: dockerImageDigest,
  }

  // Check if all required dependencies are installed
  const allRequiredInstalled = [docker, bd, git, claude]
    .filter(d => d.required)
    .every(d => d.installed)

  return {
    docker,
    bd,
    gh,
    git,
    claude,
    bb,
    githubToken: githubTokenStatus,
    claudeOAuthToken: claudeOAuthTokenStatus,
    dockerImage,
    allRequiredInstalled,
  }
}

/**
 * Enable or disable plan mode in settings
 * Also updates operatingMode in preferences so the Plans button is visible immediately
 */
export async function enablePlanMode(enabled: boolean): Promise<void> {
  // Update planMode.enabled in settings.json
  await updateSettings({
    planMode: { enabled },
  })

  // Also update operatingMode in state.json preferences
  // This makes the Plans button visible immediately when headless agents are enabled
  const operatingMode = enabled ? 'team' : 'solo'
  setPreferences({ operatingMode })
}

/**
 * Generate installation prompt for missing dependencies
 * Used by the "Fix with Claude" feature in setup wizard
 */
export function generateInstallationPrompt(deps: PlanModeDependencies): string {
  const missingDeps: DependencyStatus[] = []

  // Collect missing dependencies in installation order
  // Node.js prerequisites first, then Claude, Docker, Git, bd, gh
  if (!deps.git.installed) missingDeps.push(deps.git)
  if (!deps.claude.installed) missingDeps.push(deps.claude)
  if (!deps.docker.installed) missingDeps.push(deps.docker)
  if (!deps.bd.installed) missingDeps.push(deps.bd)
  if (!deps.gh.installed) missingDeps.push(deps.gh)
  if (!deps.bb.installed) missingDeps.push(deps.bb)

  if (missingDeps.length === 0) {
    return 'All dependencies are already installed. You can close this terminal.'
  }

  const depList = missingDeps.map(dep => {
    const requiredTag = dep.required ? ' (required)' : ' (optional)'
    return `- ${dep.name}${requiredTag}: \`${dep.installCommand || 'No install command available'}\``
  }).join('\n')

  return `Help me install the following missing dependencies for Bismarck:

${depList}

Please:
1. Install each dependency one at a time
2. Verify each installation succeeds before moving to the next
3. For macOS, use Homebrew where applicable
4. For Node.js tools (claude), ensure Node.js 18+ is installed first
5. After installing each tool, verify it's working with a version check

Start with the first missing dependency and guide me through the installation process.`
}
