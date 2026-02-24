/**
 * Settings Manager - Manage application settings stored in ~/.bismarck/settings.json
 *
 * This module handles the new settings file structure for paths, Docker configuration,
 * and proxied tools as defined in the settings redesign.
 */

import * as path from 'path'
import * as fs from 'fs/promises'
import { getConfigDir, writeConfigAtomic, getConfiguredGitHubToken, setConfiguredGitHubToken, clearConfiguredGitHubToken } from './config'
import type { CustomizablePromptType, AgentProvider } from '../shared/types'
import { DEFAULT_FOLLOWUP_PRESETS } from '../shared/followup-presets'

const OFFICIAL_IMAGE_REPO = 'bismarckapp/bismarck-agent'

function getVersionedImage(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const version = require('electron').app.getVersion()
    return `${OFFICIAL_IMAGE_REPO}:${version}`
  } catch {
    return `${OFFICIAL_IMAGE_REPO}:latest`
  }
}

/**
 * Tool configuration for proxying host commands into Docker containers
 */
export interface ProxiedTool {
  id: string
  name: string           // Tool name, e.g., "npm"
  hostPath: string       // Host command path, e.g., "/usr/local/bin/npm"
  description?: string
  enabled: boolean       // Whether the tool is available to agents
  promptHint?: string    // Usage hint for agent prompts (e.g., "npm install, npm test")
  builtIn?: boolean      // true for git/gh/bd - cannot be removed by user
  authCheck?: {
    command: string[]        // e.g. ['bb', 'login', '--check'] — exit 0=valid, 1=needs reauth
    reauthHint: string       // e.g. 'Run `bb login --browser` in your terminal'
    reauthCommand?: string[] // e.g. ['bb', 'login', '--browser'] — spawned fire-and-forget
  }
}

/**
 * Application settings structure
 */
export interface AppSettings {
  paths: {
    bd: string | null      // null = use auto-detected
    bb: string | null
    gh: string | null
    git: string | null
    defaultReposPath?: string  // Default path for scanning repositories in setup wizard
  }
  docker: {
    images: string[]
    selectedImage: string  // The active image to use for headless agents
    resourceLimits: {
      cpu: string          // e.g., "4"
      memory: string       // e.g., "8g"
      gomaxprocs: string   // e.g., "4" - limits Go parallelism via GOMAXPROCS env var
    }
    proxiedTools: ProxiedTool[]
    sshAgent: {
      enabled: boolean     // Enable SSH agent forwarding to containers
    }
    dockerSocket: {
      enabled: boolean     // Enable Docker socket mounting for testcontainers support
      path: string         // Socket path (default: /var/run/docker.sock)
    }
    networkIsolation: {
      enabled: boolean     // Enable network isolation via Squid proxy
      allowedHosts: string[]  // Domain allowlist (e.g., ["github.com", "*.github.com"])
    }
    sharedBuildCache: {
      enabled: boolean     // Enable shared Go build cache across agents (per-repo)
    }
    pnpmStore: {
      enabled: boolean     // Enable pnpm store sharing to containers
      path: string | null  // Override path (null = auto-detect via `pnpm store path`)
    }
    imageDigests: Record<string, string>     // { "image:tag": "sha256:abc..." } - tracks pulled digests
    upstreamTemplateDigest: string | null    // last known digest of official image template
    upstreamTemplateVersion: string | null   // last known version label (e.g. "0.7.8")
  }
  prompts: {
    orchestrator: string | null  // null = use default
    planner: string | null
    discussion: string | null
    task: string | null  // Plan task agents (run in Docker containers)
    standalone_headless: string | null  // Standalone headless agents (CMD-K one-off tasks)
    standalone_followup: string | null  // Follow-up agents on existing worktrees
    headless_discussion: string | null  // Headless discussion (Discuss: Headless Agent)
    critic: string | null              // Critic review agents
    manager: string | null             // Manager triage agents (bottom-up mode)
    architect: string | null           // Architect decomposition agents (bottom-up mode)
  }
  planMode: {
    enabled: boolean       // Whether plan mode (parallel agents) is enabled
  }
  tools: Record<string, never>
  playbox: {
    personaMode: 'none' | 'bismarck' | 'otto' | 'custom'  // Persona mode for interactive Claude sessions
    customPersonaPrompt: string | null  // User-defined prompt when personaMode === 'custom'
  }
  updates: {
    autoCheck: boolean          // Whether to automatically check for updates
  }
  ralphLoopPresets: {
    custom: RalphLoopPresetData[]  // User-created presets
  }
  followUpPresets: {
    custom: FollowUpPresetData[]  // User-created follow-up presets
  }
  debug: {
    enabled: boolean              // Toggle logging on/off
    logPath: string               // Log file path (default ~/.bismarck/debug.log)
  }
  preventSleep: {
    enabled: boolean              // Prevent macOS sleep while agents are running
  }
  critic: {
    enabled: boolean              // Enable critic review of completed tasks
    maxIterations: number         // Maximum critic review cycles per task
    maxFixupsPerTask: number      // Maximum cumulative fix-up tasks per worktree
  }
  _internal: {
    lastLogPurgeVersion: string | null  // Track one-time log purges across upgrades
  }
  // Agent provider default (which CLI new manual agents use)
  defaultProvider?: AgentProvider
}

/**
 * Ralph Loop preset data stored in settings
 */
export interface RalphLoopPresetData {
  id: string
  label: string
  description: string
  prompt: string
  completionPhrase: string
  maxIterations: number
  model: 'opus' | 'sonnet'
}

/**
 * Follow-up preset data stored in settings
 */
export interface FollowUpPresetData {
  id: string
  label: string
  description: string
  prompt: string
  requiresPrUrls?: boolean
  suggestedModel?: 'opus' | 'sonnet'
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
      bb: null,
      gh: null,
      git: null,
    },
    docker: {
      images: [getVersionedImage()],
      selectedImage: getVersionedImage(),
      resourceLimits: {
        cpu: '4',
        memory: '8g',
        gomaxprocs: '4',
      },
      proxiedTools: [
        {
          id: 'git',
          name: 'git',
          hostPath: '/usr/bin/git',
          description: 'Git version control',
          enabled: true,
          builtIn: true,
        },
        {
          id: 'gh',
          name: 'gh',
          hostPath: '/usr/local/bin/gh',
          description: 'GitHub CLI',
          enabled: true,
          builtIn: true,
        },
        {
          id: 'bd',
          name: 'bd',
          hostPath: '/usr/local/bin/bd',
          description: 'Beads task manager',
          enabled: true,
          builtIn: true,
        },
      ],
      sshAgent: {
        enabled: true,
      },
      dockerSocket: {
        enabled: true,   // Enabled by default for testcontainers support
        path: '/var/run/docker.sock',
      },
      networkIsolation: {
        enabled: false,  // Opt-in: restrict container network via Squid proxy
        allowedHosts: [
          'github.com', '*.github.com', '*.githubusercontent.com',
          'registry.npmjs.org', '*.npmjs.org',
          'pypi.org', '*.pypi.org', 'files.pythonhosted.org',
          'rubygems.org', '*.rubygems.org',
          'crates.io', '*.crates.io', 'static.crates.io',
          'proxy.golang.org', 'sum.golang.org', 'storage.googleapis.com',
          '*.maven.org', 'repo1.maven.org',
          'registry.yarnpkg.com',
          'api.anthropic.com',
          'cdn.jsdelivr.net', 'unpkg.com',
          'dl-cdn.alpinelinux.org',
          'deb.debian.org', 'security.debian.org',
          'archive.ubuntu.com', 'security.ubuntu.com',
        ],
      },
      sharedBuildCache: {
        enabled: true,   // Share Go build cache across agents per-repo
      },
      pnpmStore: {
        enabled: true,   // Share pnpm store across agents by default
        path: null,      // Auto-detect via `pnpm store path`
      },
      imageDigests: {},
      upstreamTemplateDigest: null,
      upstreamTemplateVersion: null,
    },
    prompts: {
      orchestrator: null,
      planner: null,
      discussion: null,
      task: null,
      standalone_headless: null,
      standalone_followup: null,
      headless_discussion: null,
      critic: null,
      manager: null,
      architect: null,
    },
    planMode: {
      enabled: false,  // Disabled by default, wizard can enable
    },
    tools: {},
    playbox: {
      personaMode: 'none',
      customPersonaPrompt: null,
    },
    updates: {
      autoCheck: true,
    },
    ralphLoopPresets: {
      custom: [],
    },
    followUpPresets: {
      custom: [],
    },
    debug: {
      enabled: true,  // Enabled by default for troubleshooting
      logPath: path.join(getConfigDir(), 'debug.log'),
    },
    preventSleep: {
      enabled: true,  // Prevent sleep by default while agents run
    },
    critic: {
      enabled: true,
      maxIterations: 2,
      maxFixupsPerTask: 5,
    },
    _internal: {
      lastLogPurgeVersion: null,
    },
    defaultProvider: 'claude',
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
        networkIsolation: {
          ...defaults.docker.networkIsolation,
          ...(loaded.docker?.networkIsolation || {}),
        },
        sharedBuildCache: {
          ...defaults.docker.sharedBuildCache,
          ...(loaded.docker?.sharedBuildCache || {}),
        },
        pnpmStore: {
          ...defaults.docker.pnpmStore,
          ...(loaded.docker?.pnpmStore || {}),
        },
        imageDigests: {
          ...defaults.docker.imageDigests,
          ...(loaded.docker?.imageDigests || {}),
        },
        upstreamTemplateDigest: loaded.docker?.upstreamTemplateDigest ?? defaults.docker.upstreamTemplateDigest,
        upstreamTemplateVersion: loaded.docker?.upstreamTemplateVersion ?? defaults.docker.upstreamTemplateVersion,
      },
      prompts: { ...defaults.prompts, ...(loaded.prompts || {}) },
      planMode: { ...defaults.planMode, ...(loaded.planMode || {}) },
      tools: { ...defaults.tools, ...(loaded.tools || {}) },
      playbox: { ...defaults.playbox, ...(loaded.playbox || {}) },
      updates: { ...defaults.updates, ...(loaded.updates || {}) },
      ralphLoopPresets: { ...defaults.ralphLoopPresets, ...(loaded.ralphLoopPresets || {}) },
      followUpPresets: { ...defaults.followUpPresets, ...(loaded.followUpPresets || {}) },
      debug: { ...defaults.debug, ...(loaded.debug || {}) },
      preventSleep: { ...defaults.preventSleep, ...(loaded.preventSleep || {}) },
      critic: { ...defaults.critic, ...(loaded.critic || {}) },
      _internal: { ...defaults._internal, ...(loaded._internal || {}) },
    }

    // Migration: Convert old boolean flags to new personaMode enum
    // Check for old-style playbox settings with bismarckMode/ottoMode booleans
    const oldPlaybox = loaded.playbox as { bismarckMode?: boolean; ottoMode?: boolean } | undefined
    let needsMigration = false

    // Migration: Ensure all proxied tools have the 'enabled' field
    const hasToolsWithoutEnabled = merged.docker.proxiedTools.some(t => (t as { enabled?: boolean }).enabled === undefined)
    if (hasToolsWithoutEnabled) {
      merged.docker.proxiedTools = merged.docker.proxiedTools.map(t => ({
        ...t,
        enabled: t.enabled ?? true,
      }))
      needsMigration = true
    }

    // Migration: Inject missing default tools (e.g., bb) into existing settings
    for (const defaultTool of defaults.docker.proxiedTools) {
      if (!merged.docker.proxiedTools.some(t => t.name === defaultTool.name)) {
        merged.docker.proxiedTools.push({ ...defaultTool })
        needsMigration = true
      }
    }

    // Migration: Sync authCheck fields from defaults (reauthHint, reauthCommand)
    for (const defaultTool of defaults.docker.proxiedTools) {
      if (!defaultTool.authCheck) continue
      const existing = merged.docker.proxiedTools.find(t => t.name === defaultTool.name)
      if (existing?.authCheck) {
        if (JSON.stringify(existing.authCheck.reauthCommand) !== JSON.stringify(defaultTool.authCheck.reauthCommand)) {
          existing.authCheck.reauthCommand = defaultTool.authCheck.reauthCommand
          needsMigration = true
        }
        if (existing.authCheck.reauthHint !== defaultTool.authCheck.reauthHint) {
          existing.authCheck.reauthHint = defaultTool.authCheck.reauthHint
          needsMigration = true
        }
      }
    }
    // Migration: Remove authCheck from bb (now uses BUILDBUDDY_API_KEY env var)
    const bbTool = merged.docker.proxiedTools.find(t => t.id === 'bb')
    if (bbTool?.authCheck) {
      delete bbTool.authCheck
      needsMigration = true
    }

    // Migration: Set builtIn flag on default tools
    const builtInNames = new Set(['git', 'gh', 'bd'])
    for (const tool of merged.docker.proxiedTools) {
      if (builtInNames.has(tool.name) && !tool.builtIn) {
        tool.builtIn = true
        needsMigration = true
      }
    }

    // Migration: Convert bb from builtIn to custom tool
    const bbToolMigrate = merged.docker.proxiedTools.find(t => t.name === 'bb' && t.builtIn)
    if (bbToolMigrate) {
      delete bbToolMigrate.builtIn
      needsMigration = true
    }

    if (oldPlaybox?.bismarckMode === true) {
      merged.playbox.personaMode = 'bismarck'
      merged.playbox.customPersonaPrompt = null
      needsMigration = true
    } else if (oldPlaybox?.ottoMode === true) {
      merged.playbox.personaMode = 'otto'
      merged.playbox.customPersonaPrompt = null
      needsMigration = true
    } else if (!loaded.playbox?.personaMode) {
      // No old flags and no new personaMode - use default
      merged.playbox.personaMode = 'none'
      merged.playbox.customPersonaPrompt = null
      needsMigration = true
    }

    // Migration: Rename old Docker image from local name to Docker Hub name
    const OLD_IMAGE_NAME = 'bismarck-agent:latest'
    const NEW_IMAGE_NAME = 'bismarckapp/bismarck-agent:latest'
    if (merged.docker.images.includes(OLD_IMAGE_NAME)) {
      merged.docker.images = merged.docker.images.map(img => img === OLD_IMAGE_NAME ? NEW_IMAGE_NAME : img)
      needsMigration = true
    }
    if (merged.docker.selectedImage === OLD_IMAGE_NAME) {
      merged.docker.selectedImage = NEW_IMAGE_NAME
      needsMigration = true
    }

    // Migration: Pin official images to current app version
    if (merged.docker.selectedImage?.startsWith(`${OFFICIAL_IMAGE_REPO}:`) &&
        merged.docker.selectedImage !== getVersionedImage()) {
      const oldImage = merged.docker.selectedImage
      merged.docker.images = merged.docker.images.map(img =>
        img === oldImage ? getVersionedImage() : img
      )
      merged.docker.selectedImage = getVersionedImage()
      needsMigration = true
    }

    // Migration: Move GitHub token from settings.json to dedicated github-token.json
    if (loaded.tools?.githubToken && typeof loaded.tools.githubToken === 'string') {
      if (!getConfiguredGitHubToken()) {
        setConfiguredGitHubToken(loaded.tools.githubToken)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (merged.tools as any).githubToken
      needsMigration = true
    }

    // Migration: One-time purge of debug logs that may contain leaked secrets (v0.6.3)
    // Triggers for any user upgrading from before 0.6.3, regardless of which version they land on.
    // Uses semver-style comparison: null (never purged) or any version < '0.6.3' triggers purge.
    const LOG_PURGE_VERSION = '0.6.3'
    const priorPurge = merged._internal.lastLogPurgeVersion
    if (!priorPurge || priorPurge < LOG_PURGE_VERSION) {
      merged._internal.lastLogPurgeVersion = LOG_PURGE_VERSION
      needsMigration = true
      // Fire-and-forget: purge global debug logs and per-plan debug logs
      purgeDebugLogs().catch(() => {})
    }

    // Seed default follow-up presets on first load (when no presets exist yet)
    if (!merged.followUpPresets?.custom?.length) {
      merged.followUpPresets = {
        ...merged.followUpPresets,
        custom: DEFAULT_FOLLOWUP_PRESETS.map(p => ({ ...p })),
      }
      needsMigration = true
    }

    settingsCache = merged

    // Persist migrated settings to disk so old format is cleaned up
    if (needsMigration) {
      const settingsPath = getSettingsPath()
      await writeConfigAtomic(settingsPath, JSON.stringify(merged, null, 2))
    }

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
      networkIsolation: {
        ...(currentSettings.docker.networkIsolation || defaults.docker.networkIsolation),
        ...(updates.docker?.networkIsolation || {}),
      },
      sharedBuildCache: {
        ...(currentSettings.docker.sharedBuildCache || defaults.docker.sharedBuildCache),
        ...(updates.docker?.sharedBuildCache || {}),
      },
      pnpmStore: {
        ...(currentSettings.docker.pnpmStore || defaults.docker.pnpmStore),
        ...(updates.docker?.pnpmStore || {}),
      },
      imageDigests: {
        ...(currentSettings.docker.imageDigests || defaults.docker.imageDigests),
        ...(updates.docker?.imageDigests || {}),
      },
      upstreamTemplateDigest: updates.docker?.upstreamTemplateDigest ?? currentSettings.docker.upstreamTemplateDigest ?? defaults.docker.upstreamTemplateDigest,
      upstreamTemplateVersion: updates.docker?.upstreamTemplateVersion ?? currentSettings.docker.upstreamTemplateVersion ?? defaults.docker.upstreamTemplateVersion,
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
    playbox: {
      ...(currentSettings.playbox || defaults.playbox),
      ...(updates.playbox || {}),
    },
    updates: {
      ...(currentSettings.updates || defaults.updates),
      ...(updates.updates || {}),
    },
    ralphLoopPresets: {
      ...(currentSettings.ralphLoopPresets || defaults.ralphLoopPresets),
      ...(updates.ralphLoopPresets || {}),
    },
    followUpPresets: {
      ...(currentSettings.followUpPresets || defaults.followUpPresets),
      ...(updates.followUpPresets || {}),
    },
    debug: {
      ...(currentSettings.debug || defaults.debug),
      ...(updates.debug || {}),
    },
    preventSleep: {
      ...(currentSettings.preventSleep || defaults.preventSleep),
      ...(updates.preventSleep || {}),
    },
    critic: {
      ...(currentSettings.critic || defaults.critic),
      ...(updates.critic || {}),
    },
    _internal: {
      ...(currentSettings._internal || defaults._internal),
      ...(updates._internal || {}),
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

  // Validate name uniqueness
  const existingNames = new Set(settings.docker.proxiedTools.map(t => t.name))
  if (existingNames.has(tool.name)) {
    throw new Error(`A proxied tool named '${tool.name}' already exists`)
  }

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

  // Prevent removing built-in tools
  const tool = settings.docker.proxiedTools.find((t) => t.id === id)
  if (tool?.builtIn) {
    throw new Error(`Cannot remove built-in tool '${tool.name}'`)
  }

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
  return settings.docker.selectedImage || getVersionedImage()
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
 * Update Docker shared build cache settings
 */
export async function updateDockerSharedBuildCacheSettings(cacheSettings: { enabled?: boolean }): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.docker.sharedBuildCache = {
    ...(settings.docker.sharedBuildCache || defaults.docker.sharedBuildCache),
    ...cacheSettings,
  }
  await saveSettings(settings)
}

/**
 * Update Docker network isolation settings
 */
export async function updateDockerNetworkIsolationSettings(networkSettings: { enabled?: boolean; allowedHosts?: string[] }): Promise<void> {
  const current = await loadSettings()
  const defaults = getDefaultSettings()
  current.docker.networkIsolation = {
    ...(current.docker.networkIsolation || defaults.docker.networkIsolation),
    ...networkSettings,
  }
  await saveSettings(current)
}

/**
 * Update Docker pnpm store settings
 */
export async function updateDockerPnpmStoreSettings(settings: { enabled?: boolean; path?: string | null }): Promise<void> {
  const current = await loadSettings()
  const defaults = getDefaultSettings()
  current.docker.pnpmStore = {
    ...(current.docker.pnpmStore || defaults.docker.pnpmStore),
    ...settings,
  }
  await saveSettings(current)
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
export async function getCustomPrompt(type: CustomizablePromptType): Promise<string | null> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const prompts = settings.prompts || defaults.prompts
  return prompts[type]
}

/**
 * Set custom prompt for a specific type (null to reset to default)
 */
export async function setCustomPrompt(type: CustomizablePromptType, template: string | null): Promise<void> {
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

  // Fall back to configured token in dedicated file
  return getConfiguredGitHubToken()
}

/**
 * Set the GitHub token (null to clear)
 */
export async function setGitHubToken(token: string | null): Promise<void> {
  if (token && token.length > 0) {
    setConfiguredGitHubToken(token)
  } else {
    clearConfiguredGitHubToken()
  }
}

/**
 * Check if a GitHub token is available from any source (env vars or settings)
 */
export async function hasGitHubToken(): Promise<boolean> {
  const token = await getGitHubToken()
  return token !== null && token.length > 0
}

/**
 * Check GitHub token scopes by calling the GitHub API
 * Returns the scopes the token has and flags any missing required ones
 */
export interface GitHubTokenScopeResult {
  valid: boolean
  scopes: string[]
  missingScopes: string[]
  ssoConfigured: boolean | null  // null = couldn't determine
  error?: string
}

const REQUIRED_SCOPES = ['repo']
const RECOMMENDED_SCOPES = ['read:packages']

export async function checkGitHubTokenScopes(): Promise<GitHubTokenScopeResult> {
  // Check the configured token first (what the user set in settings),
  // falling back to env var. This ensures we verify what the user just saved,
  // not an env var that may hold a different token.
  const configuredToken = getConfiguredGitHubToken()
  const token = (configuredToken && configuredToken.length > 0) ? configuredToken : await getGitHubToken()
  if (!token) {
    return {
      valid: false,
      scopes: [],
      missingScopes: [...REQUIRED_SCOPES, ...RECOMMENDED_SCOPES],
      ssoConfigured: null,
      error: 'No GitHub token configured',
    }
  }

  try {
    const response = await fetch('https://api.github.com/', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Bismarck-App',
      },
    })

    if (response.status === 401) {
      return {
        valid: false,
        scopes: [],
        missingScopes: [...REQUIRED_SCOPES, ...RECOMMENDED_SCOPES],
        ssoConfigured: null,
        error: 'Token is invalid or expired',
      }
    }

    const scopeHeader = response.headers.get('x-oauth-scopes') || ''
    const scopes = scopeHeader
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // GitHub scope hierarchy: broader scopes imply narrower ones
    const scopeImplies: Record<string, string[]> = {
      'repo': ['repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events'],
      'write:packages': ['read:packages'],
      'admin:org': ['write:org', 'read:org'],
      'admin:repo_hook': ['write:repo_hook', 'read:repo_hook'],
      'admin:org_hook': [],
      'admin:public_key': ['write:public_key', 'read:public_key'],
      'admin:gpg_key': ['write:gpg_key', 'read:gpg_key'],
    }

    // Check if a scope is satisfied by the token's scopes (including implied scopes)
    const hasScope = (required: string): boolean => {
      if (scopes.includes(required)) return true
      // Check if any granted scope implies the required one
      for (const granted of scopes) {
        const implied = scopeImplies[granted]
        if (implied && implied.includes(required)) return true
      }
      return false
    }

    const allRequired = [...REQUIRED_SCOPES, ...RECOMMENDED_SCOPES]
    const missingScopes = allRequired.filter(required => !hasScope(required))

    // Try to detect SSO authorization by checking if we can list orgs
    // A 403 with SSO message indicates token lacks SSO authorization
    let ssoConfigured: boolean | null = null
    try {
      const orgsResponse = await fetch('https://api.github.com/user/orgs', {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Bismarck-App',
        },
      })
      if (orgsResponse.ok) {
        // If we can list orgs, SSO is either not required or is configured
        ssoConfigured = true
      } else if (orgsResponse.status === 403) {
        const body = await orgsResponse.text()
        if (body.includes('SSO') || body.includes('SAML')) {
          ssoConfigured = false
        }
      }
    } catch {
      // Ignore SSO check failures
    }

    return {
      valid: response.ok,
      scopes,
      missingScopes,
      ssoConfigured,
    }
  } catch (err) {
    return {
      valid: false,
      scopes: [],
      missingScopes: [...REQUIRED_SCOPES, ...RECOMMENDED_SCOPES],
      ssoConfigured: null,
      error: `Failed to verify token: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Check if a GitHub token is saved in settings.json (ignores env vars)
 * Used by the setup wizard to determine if a detected token needs to be persisted
 */
export async function hasConfiguredGitHubToken(): Promise<boolean> {
  const token = getConfiguredGitHubToken()
  return token !== null && token.length > 0
}

/**
 * Update playbox settings
 */
export async function updatePlayboxSettings(playboxSettings: Partial<AppSettings['playbox']>): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.playbox = {
    ...(settings.playbox || defaults.playbox),
    ...playboxSettings,
  }
  await saveSettings(settings)
}

/**
 * Get playbox settings
 */
export async function getPlayboxSettings(): Promise<AppSettings['playbox']> {
  const settings = await loadSettings()
  return settings.playbox
}

/**
 * Get custom Ralph Loop presets
 */
export async function getRalphLoopPresets(): Promise<RalphLoopPresetData[]> {
  const settings = await loadSettings()
  return settings.ralphLoopPresets?.custom || []
}

/**
 * Add a custom Ralph Loop preset
 */
export async function addRalphLoopPreset(preset: Omit<RalphLoopPresetData, 'id'>): Promise<RalphLoopPresetData> {
  const settings = await loadSettings()
  const newPreset: RalphLoopPresetData = {
    id: `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...preset,
  }
  const defaults = getDefaultSettings()
  settings.ralphLoopPresets = {
    ...(settings.ralphLoopPresets || defaults.ralphLoopPresets),
    custom: [...(settings.ralphLoopPresets?.custom || []), newPreset],
  }
  await saveSettings(settings)
  return newPreset
}

/**
 * Update a custom Ralph Loop preset
 */
export async function updateRalphLoopPreset(
  id: string,
  updates: Partial<Omit<RalphLoopPresetData, 'id'>>
): Promise<RalphLoopPresetData | undefined> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const presets = settings.ralphLoopPresets?.custom || []
  const index = presets.findIndex((p) => p.id === id)

  if (index === -1) {
    return undefined
  }

  presets[index] = {
    ...presets[index],
    ...updates,
  }

  settings.ralphLoopPresets = {
    ...(settings.ralphLoopPresets || defaults.ralphLoopPresets),
    custom: presets,
  }

  await saveSettings(settings)
  return presets[index]
}

/**
 * Delete a custom Ralph Loop preset
 */
export async function deleteRalphLoopPreset(id: string): Promise<boolean> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const presets = settings.ralphLoopPresets?.custom || []
  const initialLength = presets.length
  const filtered = presets.filter((p) => p.id !== id)

  if (filtered.length === initialLength) {
    return false // Preset not found
  }

  settings.ralphLoopPresets = {
    ...(settings.ralphLoopPresets || defaults.ralphLoopPresets),
    custom: filtered,
  }

  await saveSettings(settings)
  return true
}

/**
 * Get custom follow-up presets
 */
export async function getFollowUpPresets(): Promise<FollowUpPresetData[]> {
  const settings = await loadSettings()
  return settings.followUpPresets?.custom || []
}

/**
 * Add a custom follow-up preset
 */
export async function addFollowUpPreset(preset: Omit<FollowUpPresetData, 'id'>): Promise<FollowUpPresetData> {
  const settings = await loadSettings()
  const newPreset: FollowUpPresetData = {
    id: `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ...preset,
  }
  const defaults = getDefaultSettings()
  settings.followUpPresets = {
    ...(settings.followUpPresets || defaults.followUpPresets),
    custom: [...(settings.followUpPresets?.custom || []), newPreset],
  }
  await saveSettings(settings)
  return newPreset
}

/**
 * Update a custom follow-up preset
 */
export async function updateFollowUpPreset(
  id: string,
  updates: Partial<Omit<FollowUpPresetData, 'id'>>
): Promise<FollowUpPresetData | undefined> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const presets = settings.followUpPresets?.custom || []
  const index = presets.findIndex((p) => p.id === id)

  if (index === -1) {
    return undefined
  }

  presets[index] = {
    ...presets[index],
    ...updates,
  }

  settings.followUpPresets = {
    ...(settings.followUpPresets || defaults.followUpPresets),
    custom: presets,
  }

  await saveSettings(settings)
  return presets[index]
}

/**
 * Delete a custom follow-up preset
 */
export async function deleteFollowUpPreset(id: string): Promise<boolean> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  const presets = settings.followUpPresets?.custom || []
  const initialLength = presets.length
  const filtered = presets.filter((p) => p.id !== id)

  if (filtered.length === initialLength) {
    return false // Preset not found
  }

  settings.followUpPresets = {
    ...(settings.followUpPresets || defaults.followUpPresets),
    custom: filtered,
  }

  await saveSettings(settings)
  return true
}

/**
 * Get debug settings
 */
export async function getDebugSettings(): Promise<AppSettings['debug']> {
  const settings = await loadSettings()
  return settings.debug
}

/**
 * Update debug settings
 */
export async function updateDebugSettings(debugSettings: Partial<AppSettings['debug']>): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.debug = {
    ...(settings.debug || defaults.debug),
    ...debugSettings,
  }
  await saveSettings(settings)
}

/**
 * Get prevent sleep settings
 */
export async function getPreventSleepSettings(): Promise<AppSettings['preventSleep']> {
  const settings = await loadSettings()
  return settings.preventSleep
}

/**
 * Update prevent sleep settings
 */
export async function updatePreventSleepSettings(preventSleepSettings: Partial<AppSettings['preventSleep']>): Promise<void> {
  const settings = await loadSettings()
  const defaults = getDefaultSettings()
  settings.preventSleep = {
    ...(settings.preventSleep || defaults.preventSleep),
    ...preventSleepSettings,
  }
  await saveSettings(settings)
}

/**
 * Purge all debug log files (global and per-plan).
 * Called once on upgrade to clean up logs that may have contained leaked secrets.
 */
async function purgeDebugLogs(): Promise<void> {
  const configDir = getConfigDir()

  // Purge global debug logs (debug-YYYY-MM-DD.log)
  try {
    const files = await fs.readdir(configDir)
    for (const file of files) {
      if (file.startsWith('debug') && file.endsWith('.log')) {
        await fs.unlink(path.join(configDir, file)).catch(() => {})
      }
    }
  } catch {
    // Config dir may not exist yet
  }

  // Purge per-plan debug logs
  const plansDir = path.join(configDir, 'plans')
  try {
    const planIds = await fs.readdir(plansDir)
    for (const planId of planIds) {
      const logPath = path.join(plansDir, planId, 'debug.log')
      await fs.unlink(logPath).catch(() => {})
    }
  } catch {
    // Plans dir may not exist
  }
}
