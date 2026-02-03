/**
 * Settings Manager - Manage application settings stored in ~/.bismarck/settings.json
 *
 * This module handles the new settings file structure for paths, Docker configuration,
 * and proxied tools as defined in the settings redesign.
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import { getConfigDir, writeConfigAtomic } from './config'

/**
 * Tool configuration for proxying host commands into Docker containers
 */
export interface ProxiedTool {
  id: string
  name: string           // Tool name, e.g., "npm"
  hostPath: string       // Host command path, e.g., "/usr/local/bin/npm"
  description?: string
}

/**
 * Application settings structure
 */
export interface AppSettings {
  paths: {
    bd: string | null      // null = use auto-detected
    gh: string | null
    git: string | null
    defaultReposPath?: string  // Default path for scanning repositories in setup wizard
  }
  docker: {
    images: string[]
    selectedImage: string  // The active image to use for headless agents
    resourceLimits: {
      cpu: string          // e.g., "2"
      memory: string       // e.g., "4g"
    }
    proxiedTools: ProxiedTool[]
    sshAgent: {
      enabled: boolean     // Enable SSH agent forwarding to containers
    }
    dockerSocket: {
      enabled: boolean     // Enable Docker socket mounting for testcontainers support
      path: string         // Socket path (default: /var/run/docker.sock)
    }
  }
  prompts: {
    orchestrator: string | null  // null = use default
    planner: string | null
    discussion: string | null
  }
  planMode: {
    enabled: boolean       // Whether plan mode (parallel agents) is enabled
  }
  tools: {
    githubToken: string | null  // GitHub token for gh CLI (needed for SAML SSO orgs)
  }
}

// In-memory cache of settings
let settingsCache: AppSettings | null = null

/**
 * Get the path to the settings file
 */
function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json')
}

/**
 * Get default settings
 */
export function getDefaultSettings(): AppSettings {
  return {
    paths: {
      bd: null,
      gh: null,
      git: null,
    },
    docker: {
      images: ['bismarck-agent:latest'],
      selectedImage: 'bismarck-agent:latest',
      resourceLimits: {
        cpu: '2',
        memory: '4g',
      },
      proxiedTools: [
        {
          id: 'git',
          name: 'git',
          hostPath: '/usr/bin/git',
          description: 'Git version control',
        },
        {
          id: 'gh',
          name: 'gh',
          hostPath: '/usr/local/bin/gh',
          description: 'GitHub CLI',
        },
        {
          id: 'bd',
          name: 'bd',
          hostPath: '/usr/local/bin/bd',
          description: 'Beads task manager',
        },
      ],
      sshAgent: {
        enabled: true,
      },
      dockerSocket: {
        enabled: true,   // Enabled by default for testcontainers support
        path: '/var/run/docker.sock',
      },
    },
    prompts: {
      orchestrator: null,
      planner: null,
      discussion: null,
    },
    planMode: {
      enabled: false,  // Disabled by default, wizard can enable
    },
    tools: {
      githubToken: null,
    },
  }
}

/**
 * Load settings from disk
 *
 * Deep merges loaded settings with defaults to ensure new settings
 * are always present even in existing installations.
 */
export async function loadSettings(): Promise<AppSettings> {
  if (settingsCache !== null) {
    return settingsCache
  }

  const settingsPath = getSettingsPath()
  const defaults = getDefaultSettings()

  try {
    const data = await fs.readFile(settingsPath, 'utf-8')
    const loaded = JSON.parse(data)

    // Deep merge loaded settings with defaults
    const merged: AppSettings = {
      ...defaults,
      ...loaded,
      paths: { ...defaults.paths, ...loaded.paths },
      docker: {
        ...defaults.docker,
        ...loaded.docker,
        resourceLimits: {
          ...defaults.docker.resourceLimits,
          ...(loaded.docker?.resourceLimits || {}),
        },
        proxiedTools: loaded.docker?.proxiedTools || defaults.docker.proxiedTools,
        sshAgent: {
          ...defaults.docker.sshAgent,
          ...(loaded.docker?.sshAgent || {}),
        },
        dockerSocket: {
          ...defaults.docker.dockerSocket,
          ...(loaded.docker?.dockerSocket || {}),
        },
      },
      prompts: { ...defaults.prompts, ...(loaded.prompts || {}) },
      planMode: { ...defaults.planMode, ...(loaded.planMode || {}) },
      tools: { ...defaults.tools, ...(loaded.tools || {}) },
    }
    settingsCache = merged
    return merged
  } catch (error) {
    // File doesn't exist or is invalid - return defaults
    settingsCache = defaults
    return defaults
  }
}

/**
 * Save settings to disk
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  settingsCache = settings
  const settingsPath = getSettingsPath()
  await writeConfigAtomic(settingsPath, JSON.stringify(settings, null, 2))
}

/**
 * Update settings (partial update)
 */
export async function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  const currentSettings = await loadSettings()
  const defaults = getDefaultSettings()
  const updatedSettings: AppSettings = {
    ...currentSettings,
    ...updates,
    // Deep merge for nested objects
    paths: { ...currentSettings.paths, ...updates.paths },
    docker: {
      ...currentSettings.docker,
      ...updates.docker,
      resourceLimits: {
        ...currentSettings.docker.resourceLimits,
        ...(updates.docker?.resourceLimits || {}),
      },
      proxiedTools: updates.docker?.proxiedTools || currentSettings.docker.proxiedTools,
      sshAgent: {
        ...currentSettings.docker.sshAgent,
        ...(updates.docker?.sshAgent || {}),
      },
      dockerSocket: {
        ...(currentSettings.docker.dockerSocket || defaults.docker.dockerSocket),
        ...(updates.docker?.dockerSocket || {}),
      },
    },
    prompts: {
      ...(currentSettings.prompts || defaults.prompts),
      ...(updates.prompts || {}),
    },
    planMode: {
      ...(currentSettings.planMode || defaults.planMode),
      ...(updates.planMode || {}),
    },
    tools: {
      ...(currentSettings.tools || defaults.tools),
      ...(updates.tools || {}),
    },
  }
  await saveSettings(updatedSettings)
  return updatedSettings
}

/**
 * Get current settings
 */
export async function getSettings(): Promise<AppSettings> {
  return loadSettings()
}

/**
 * Add a proxied tool
 */
export async function addProxiedTool(tool: Omit<ProxiedTool, 'id'>): Promise<ProxiedTool> {
  const settings = await loadSettings()
  const newTool: ProxiedTool = {
    id: generateToolId(),
    ...tool,
  }
  settings.docker.proxiedTools.push(newTool)
  await saveSettings(settings)
  return newTool
}

/**
 * Update a proxied tool
 */
export async function updateProxiedTool(
  id: string,
  updates: Partial<Omit<ProxiedTool, 'id'>>
): Promise<ProxiedTool | undefined> {
  const settings = await loadSettings()
  const index = settings.docker.proxiedTools.findIndex((t) => t.id === id)

  if (index === -1) {
    return undefined
  }

  settings.docker.proxiedTools[index] = {
    ...settings.docker.proxiedTools[index],
    ...updates,
  }

  await saveSettings(settings)
  return settings.docker.proxiedTools[index]
}

/**
 * Remove a proxied tool
 */
export async function removeProxiedTool(id: string): Promise<boolean> {
  const settings = await loadSettings()
  const initialLength = settings.docker.proxiedTools.length
  settings.docker.proxiedTools = settings.docker.proxiedTools.filter((t) => t.id !== id)

  if (settings.docker.proxiedTools.length === initialLength) {
    return false // Tool not found
  }

  await saveSettings(settings)
  return true
}

/**
 * Get all proxied tools
 */
export async function getProxiedTools(): Promise<ProxiedTool[]> {
  const settings = await loadSettings()
  return settings.docker.proxiedTools
}

/**
 * Add a Docker image
 */
export async function addDockerImage(image: string): Promise<void> {
  const settings = await loadSettings()
  if (!settings.docker.images.includes(image)) {
    settings.docker.images.push(image)
    await saveSettings(settings)
  }
}

/**
 * Remove a Docker image
 */
export async function removeDockerImage(image: string): Promise<boolean> {
  const settings = await loadSettings()
  const initialLength = settings.docker.images.length
  settings.docker.images = settings.docker.images.filter((img) => img !== image)

  if (settings.docker.images.length === initialLength) {
    return false // Image not found
  }

  // If removed image was selected, select first remaining image
  if (settings.docker.selectedImage === image && settings.docker.images.length > 0) {
    settings.docker.selectedImage = settings.docker.images[0]
  }

  await saveSettings(settings)
  return true
}

/**
 * Set the selected Docker image for headless agents
 */
export async function setSelectedDockerImage(image: string): Promise<void> {
  const settings = await loadSettings()
  // Validate image is in the list
  if (!settings.docker.images.includes(image)) {
    throw new Error(`Image '${image}' is not in the available images list`)
  }
  settings.docker.selectedImage = image
  await saveSettings(settings)
}

/**
 * Get the selected Docker image for headless agents
 */
export async function getSelectedDockerImage(): Promise<string> {
  const settings = await loadSettings()
  return settings.docker.selectedImage || 'bismarck-agent:latest'
}

/**
 * Update Docker resource limits
 */
export async function updateDockerResourceLimits(limits: Partial<AppSettings['docker']['resourceLimits']>): Promise<void> {
  const settings = await loadSettings()
  settings.docker.resourceLimits = {
    ...settings.docker.resourceLimits,
    ...limits,
  }
  await saveSettings(settings)
}

/**
 * Update tool paths
 */
export async function updateToolPaths(paths: Partial<AppSettings['paths']>): Promise<void> {
  const settings = await loadSettings()
  settings.paths = {
    ...settings.paths,
    ...paths,
  }
  await saveSettings(settings)
}

/**
 * Update Docker SSH agent settings
 */
export async function updateDockerSshSettings(sshSettings: { enabled?: boolean }): Promise<void> {
  const settings = await loadSettings()
  settings.docker.sshAgent = {
    ...settings.docker.sshAgent,
    ...sshSettings,
  }
  await saveSettings(settings)
}

/**
 * Update Docker socket settings
 */
export async function updateDockerSocketSettings(socketSettings: { enabled?: boolean; path?: string }): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.docker.dockerSocket = {
    ...(settings.docker.dockerSocket || defaults.docker.dockerSocket),
    ...socketSettings,
  }
  await saveSettings(settings)
}

/**
 * Clear the settings cache (useful for testing)
 */
export function clearSettingsCache(): void {
  settingsCache = null
}

/**
 * Get custom prompt for a specific type
 */
export async function getCustomPrompt(type: 'orchestrator' | 'planner' | 'discussion'): Promise<string | null> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const prompts = settings.prompts || defaults.prompts
  return prompts[type]
}

/**
 * Set custom prompt for a specific type (null to reset to default)
 */
export async function setCustomPrompt(type: 'orchestrator' | 'planner' | 'discussion', template: string | null): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.prompts = {
    ...(settings.prompts || defaults.prompts),
    [type]: template,
  }
  await saveSettings(settings)
}

/**
 * Get all custom prompts
 */
export async function getCustomPrompts(): Promise<AppSettings['prompts']> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  return settings.prompts || defaults.prompts
}

/**
 * Generate a unique ID for a proxied tool
 */
function generateToolId(): string {
  return `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Re-export detectToolPaths from exec-utils for backwards compatibility
export { detectToolPaths } from './exec-utils'

/**
 * Get tool paths (with auto-detected fallback)
 */
export async function getToolPaths(): Promise<AppSettings['paths']> {
  const settings = await loadSettings()
  return settings.paths
}

/**
 * Get the GitHub token to use
 * Priority:
 * 1. Environment variables (GITHUB_TOKEN, GH_TOKEN) - always takes precedence
 * 2. Configured token in settings
 *
 * Environment variables take precedence because they are typically managed
 * by external tools (direnv, shell profiles) and reflect the current session's
 * intended token. This avoids stale token issues where a saved token no longer
 * has the right permissions (e.g., SAML authorization).
 */
export async function getGitHubToken(): Promise<string | null> {
  // Check environment variables first (takes precedence)
  const envVars = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_API_TOKEN']
  for (const envVar of envVars) {
    const token = process.env[envVar]
    if (token && token.length > 0) {
      return token
    }
  }

  // Fall back to configured token in settings
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  return settings.tools?.githubToken ?? defaults.tools.githubToken
}

/**
 * Set the GitHub token (null to clear)
 */
export async function setGitHubToken(token: string | null): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.tools = {
    ...(settings.tools || defaults.tools),
    githubToken: token,
  }
  await saveSettings(settings)
}

/**
 * Check if a GitHub token is configured (without returning the actual token)
 */
export async function hasGitHubToken(): Promise<boolean> {
  const token = await getGitHubToken()
  return token !== null && token.length > 0
}
