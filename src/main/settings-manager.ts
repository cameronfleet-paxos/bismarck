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
    },
  }
}

/**
 * Load settings from disk
 */
export async function loadSettings(): Promise<AppSettings> {
  if (settingsCache !== null) {
    return settingsCache
  }

  const settingsPath = getSettingsPath()

  try {
    const data = await fs.readFile(settingsPath, 'utf-8')
    settingsCache = JSON.parse(data)
    return settingsCache!
  } catch (error) {
    // File doesn't exist or is invalid - return defaults
    settingsCache = getDefaultSettings()
    return settingsCache
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
 * Clear the settings cache (useful for testing)
 */
export function clearSettingsCache(): void {
  settingsCache = null
}

/**
 * Generate a unique ID for a proxied tool
 */
function generateToolId(): string {
  return `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Detect tool paths on the system using 'which' command
 */
export async function detectToolPaths(): Promise<AppSettings['paths']> {
  const { execFile } = require('child_process')
  const { promisify } = require('util')
  const execFileAsync = promisify(execFile)

  const detectPath = async (toolName: string): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('which', [toolName])
      const path = stdout.trim()
      return path || null
    } catch (error) {
      return null
    }
  }

  const [bd, gh, git] = await Promise.all([
    detectPath('bd'),
    detectPath('gh'),
    detectPath('git'),
  ])

  return { bd, gh, git }
}

/**
 * Get tool paths (with auto-detected fallback)
 */
export async function getToolPaths(): Promise<AppSettings['paths']> {
  const settings = await loadSettings()
  return settings.paths
}
