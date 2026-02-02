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
import { isGitRepo, getRepoRoot, getRemoteUrl } from './git-utils'
import { saveWorkspace, getWorkspaces } from './config'
import { agentIcons, type AgentIconName } from '../shared/constants'
import { detectRepository } from './repository-manager'
import { loadSettings, updateSettings } from './settings-manager'

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
            discovered.push({
              path: repoRoot,
              name: path.basename(repoRoot),
              remoteUrl: remoteUrl || undefined,
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
  return discovered
}

/**
 * Bulk create agents from discovered repositories
 * Auto-generates names from folder names, random themes/icons, and empty purposes
 */
export async function bulkCreateAgents(repos: DiscoveredRepo[]): Promise<Agent[]> {
  const createdAgents: Agent[] = []
  const themes: ThemeName[] = ['brown', 'blue', 'red', 'gray', 'green', 'purple', 'teal', 'orange', 'pink']
  const icons = Object.keys(agentIcons) as AgentIconName[]

  for (const repo of repos) {
    // Detect/register the repository first
    const repository = await detectRepository(repo.path)

    // Generate random theme and icon
    const theme = themes[Math.floor(Math.random() * themes.length)]
    const icon = icons[Math.floor(Math.random() * icons.length)]

    // Create new agent
    const newAgent: Agent = {
      id: randomUUID(),
      name: repo.name,
      directory: repo.path,
      purpose: '', // Empty purpose as specified
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
