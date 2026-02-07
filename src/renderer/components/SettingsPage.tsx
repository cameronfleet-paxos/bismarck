import { useState, useEffect } from 'react'
import { ArrowLeft, Save, Check } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import { Logo } from '@/renderer/components/Logo'
import { GeneralSettings } from '@/renderer/components/settings/sections/GeneralSettings'
import { PlansSettings } from '@/renderer/components/settings/sections/PlansSettings'
import { RawJsonSettings } from '@/renderer/components/settings/sections/RawJsonSettings'
import { AuthenticationSettings } from '@/renderer/components/settings/sections/AuthenticationSettings'
import { PlayboxSettings } from '@/renderer/components/settings/sections/PlayboxSettings'
import { KeyboardShortcutsSettings } from '@/renderer/components/settings/sections/KeyboardShortcutsSettings'
import { UpdatesSettings } from '@/renderer/components/settings/sections/UpdatesSettings'
import { RalphLoopPresetsSettings } from '@/renderer/components/settings/sections/RalphLoopPresetsSettings'
import { DockerSettings } from '@/renderer/components/settings/sections/DockerSettings'
import { RepositoriesSettings } from '@/renderer/components/settings/sections/RepositoriesSettings'
import { HeadlessSettings } from '@/renderer/components/settings/sections/HeadlessSettings'

type SettingsSection = 'general' | 'keyboard' | 'updates' | 'authentication' | 'docker' | 'paths' | 'tools' | 'headless' | 'plans' | 'ralph-presets' | 'repositories' | 'playbox' | 'advanced'

interface SidebarItem {
  id: SettingsSection
  label: string
  description: string
}

const sidebarItems: SidebarItem[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Display and attention preferences',
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    description: 'Customize keyboard shortcuts',
  },
  {
    id: 'updates',
    label: 'Updates',
    description: 'Automatic update settings',
  },
  {
    id: 'authentication',
    label: 'Authentication',
    description: 'Claude API credentials for agents',
  },
  {
    id: 'docker',
    label: 'Docker',
    description: 'Container images and resource limits',
  },
  {
    id: 'tools',
    label: 'Tools',
    description: 'Tool paths and proxied tools',
  },
  {
    id: 'headless',
    label: 'Headless',
    description: 'Plan phase settings',
  },
  {
    id: 'plans',
    label: 'Plans & Prompts',
    description: 'Agent model and custom prompts',
  },
  {
    id: 'ralph-presets',
    label: 'Ralph Loop Presets',
    description: 'Custom automation presets',
  },
  {
    id: 'repositories',
    label: 'Repositories',
    description: 'View and edit repository settings',
  },
  {
    id: 'playbox',
    label: 'Playbox',
    description: 'Experimental and fun features',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    description: 'Edit raw JSON settings',
  },
]

interface AppSettings {
  paths: {
    bd: string | null
    gh: string | null
    git: string | null
  }
  docker: {
    images: string[]
    selectedImage: string
    resourceLimits: {
      cpu: string
      memory: string
    }
    proxiedTools: ProxiedTool[]
    sshAgent?: {
      enabled: boolean
    }
    dockerSocket?: {
      enabled: boolean
      path: string
    }
  }
}

interface ProxiedTool {
  id: string
  name: string
  hostPath: string
  description?: string
  enabled: boolean
  authCheck?: {
    command: string[]
    reauthHint: string
    reauthCommand?: string[]
  }
}

interface ToolAuthStatus {
  toolId: string
  toolName: string
  state: 'valid' | 'needs-reauth' | 'error'
  reauthHint?: string
  message?: string
}

interface SettingsPageProps {
  onBack: () => void
  initialSection?: string
  onSectionChange?: () => void
}

export function SettingsPage({ onBack, initialSection, onSectionChange }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    (initialSection as SettingsSection) || 'general'
  )
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  // Tool paths local state
  const [bdPath, setBdPath] = useState('')
  const [bbPath, setBbPath] = useState('')
  const [ghPath, setGhPath] = useState('')
  const [gitPath, setGitPath] = useState('')
  const [autoDetectedPaths, setAutoDetectedPaths] = useState<{ bd: string | null; bb: string | null; gh: string | null; git: string | null } | null>(null)

  // Tool auth status
  const [toolAuthStatuses, setToolAuthStatuses] = useState<ToolAuthStatus[]>([])
  const [checkingAuth, setCheckingAuth] = useState(false)
  const [reauthingToolId, setReauthingToolId] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()

    // Listen for tool auth status push updates
    window.electronAPI?.onToolAuthStatus?.((statuses) => {
      setToolAuthStatuses(statuses)
    })
    return () => {
      window.electronAPI?.removeToolAuthStatusListener?.()
    }
  }, [])

  // Handle navigation from external sources (e.g., header notification)
  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection as SettingsSection)
      onSectionChange?.()
    }
  }, [initialSection, onSectionChange])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const [loaded, detectedPaths, authStatuses] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.detectToolPaths(),
        window.electronAPI.getToolAuthStatuses?.() ?? Promise.resolve([]),
      ])
      setSettings(loaded)
      setAutoDetectedPaths(detectedPaths)
      setToolAuthStatuses(authStatuses)

      // Initialize local state from loaded settings
      setBdPath(loaded.paths.bd || '')
      setBbPath(loaded.paths.bb || '')
      setGhPath(loaded.paths.gh || '')
      setGitPath(loaded.paths.git || '')

    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSavePaths = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateToolPaths({
        bd: bdPath || null,
        bb: bbPath || null,
        gh: ghPath || null,
        git: gitPath || null,
      })
      await loadSettings()
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save paths:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleCheckAuth = async () => {
    setCheckingAuth(true)
    try {
      const statuses = await window.electronAPI.checkToolAuth?.() ?? []
      setToolAuthStatuses(statuses)
    } catch (error) {
      console.error('Failed to check tool auth:', error)
    } finally {
      setCheckingAuth(false)
    }
  }

  const handleToggleProxiedTool = async (id: string, enabled: boolean) => {
    try {
      await window.electronAPI.toggleProxiedTool(id, enabled)
      await loadSettings()
    } catch (error) {
      console.error('Failed to toggle proxied tool:', error)
    }
  }

  if (loading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Failed to load settings</div>
      </div>
    )
  }

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <div className="bg-card border rounded-lg p-6">
            <GeneralSettings onPreferencesChange={() => {}} />
          </div>
        )

      case 'keyboard':
        return (
          <div className="bg-card border rounded-lg p-6">
            <KeyboardShortcutsSettings onPreferencesChange={() => {}} />
          </div>
        )

      case 'updates':
        return (
          <div className="bg-card border rounded-lg p-6">
            <UpdatesSettings onSettingsChange={loadSettings} />
          </div>
        )

      case 'authentication':
        return (
          <div className="bg-card border rounded-lg p-6">
            <AuthenticationSettings />
          </div>
        )

      case 'docker':
        return <DockerSettings settings={settings} onSettingsChange={loadSettings} />

      case 'tools':
        return (
          <div className="space-y-6">
            {/* Tool Paths Section */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Tool Paths</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Configure paths to command-line tools used by Bismarck. Auto-detected paths are shown when no custom path is set.
              </p>

              <div className="space-y-4">
                {/* bd path */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="bd-path">bd (Beads)</Label>
                    {bdPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setBdPath(''); handleSavePaths() }}
                        className="h-6 text-xs text-muted-foreground"
                      >
                        Reset to auto-detected
                      </Button>
                    )}
                  </div>
                  <Input
                    id="bd-path"
                    placeholder={autoDetectedPaths?.bd || 'Not found on system'}
                    value={bdPath}
                    onChange={(e) => setBdPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {bdPath ? (
                      <span className="text-amber-600 dark:text-amber-400">Using custom path</span>
                    ) : autoDetectedPaths?.bd ? (
                      <span className="text-green-600 dark:text-green-400">Auto-detected: {autoDetectedPaths.bd}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Not found - specify path manually</span>
                    )}
                  </p>
                </div>

                {/* bb path */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="bb-path">bb (BuildBuddy CLI)</Label>
                    {bbPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setBbPath(''); handleSavePaths() }}
                        className="h-6 text-xs text-muted-foreground"
                      >
                        Reset to auto-detected
                      </Button>
                    )}
                  </div>
                  <Input
                    id="bb-path"
                    placeholder={autoDetectedPaths?.bb || 'Not found on system'}
                    value={bbPath}
                    onChange={(e) => setBbPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {bbPath ? (
                      <span className="text-amber-600 dark:text-amber-400">Using custom path</span>
                    ) : autoDetectedPaths?.bb ? (
                      <span className="text-green-600 dark:text-green-400">Auto-detected: {autoDetectedPaths.bb}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Not found - specify path manually</span>
                    )}
                  </p>
                </div>

                {/* gh path */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="gh-path">gh (GitHub CLI)</Label>
                    {ghPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setGhPath(''); handleSavePaths() }}
                        className="h-6 text-xs text-muted-foreground"
                      >
                        Reset to auto-detected
                      </Button>
                    )}
                  </div>
                  <Input
                    id="gh-path"
                    placeholder={autoDetectedPaths?.gh || 'Not found on system'}
                    value={ghPath}
                    onChange={(e) => setGhPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ghPath ? (
                      <span className="text-amber-600 dark:text-amber-400">Using custom path</span>
                    ) : autoDetectedPaths?.gh ? (
                      <span className="text-green-600 dark:text-green-400">Auto-detected: {autoDetectedPaths.gh}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Not found - specify path manually</span>
                    )}
                  </p>
                </div>

                {/* git path */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="git-path">git</Label>
                    {gitPath && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setGitPath(''); handleSavePaths() }}
                        className="h-6 text-xs text-muted-foreground"
                      >
                        Reset to auto-detected
                      </Button>
                    )}
                  </div>
                  <Input
                    id="git-path"
                    placeholder={autoDetectedPaths?.git || 'Not found on system'}
                    value={gitPath}
                    onChange={(e) => setGitPath(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {gitPath ? (
                      <span className="text-amber-600 dark:text-amber-400">Using custom path</span>
                    ) : autoDetectedPaths?.git ? (
                      <span className="text-green-600 dark:text-green-400">Auto-detected: {autoDetectedPaths.git}</span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">Not found - specify path manually</span>
                    )}
                  </p>
                </div>

                <Button
                  onClick={handleSavePaths}
                  disabled={saving}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Tool Paths'}
                </Button>
              </div>
            </div>

            {/* Proxied Tools Explanation */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">What are Proxied Tools?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Proxied tools let containers call commands on your host machine. This is needed when:
              </p>
              <ul className="text-sm text-muted-foreground space-y-2 ml-4 list-disc">
                <li><strong>Host credentials:</strong> Tools like <code className="bg-muted px-1 rounded">gh</code> (GitHub CLI) that use your host auth tokens</li>
                <li><strong>Host environment:</strong> Package managers that need your local npm/pip config</li>
                <li><strong>Native binaries:</strong> Tools that only work on your host OS (not in Linux containers)</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                When an agent runs a proxied tool, the command is forwarded to your host and the output is returned to the container.
              </p>
            </div>

            {/* Configured Tools */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Configured Tools</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Enable or disable tools available to headless agents running in Docker containers.
                Disabled tools will not appear in agent prompts and the proxy will reject requests for them.
              </p>

              <div className="space-y-3">
              {settings.docker.proxiedTools.map((tool) => {
                const authStatus = toolAuthStatuses.find(s => s.toolId === tool.id)
                return (
                  <div
                    key={tool.id}
                    className={`p-4 bg-muted/50 rounded-md ${!tool.enabled ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{tool.name}</span>
                          {tool.authCheck && tool.enabled && authStatus && (
                            <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded-full ${
                              authStatus.state === 'valid'
                                ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                : authStatus.state === 'needs-reauth'
                                ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                                : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                            }`}>
                              {authStatus.state === 'valid' ? 'Authenticated' : authStatus.state === 'needs-reauth' ? 'Re-auth needed' : 'Auth error'}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground mt-1">
                          {tool.hostPath}
                        </div>
                        {tool.description && (
                          <div className="text-sm text-muted-foreground mt-1">
                            {tool.description}
                          </div>
                        )}
                      </div>
                      <Switch
                        checked={tool.enabled}
                        onCheckedChange={(checked) => handleToggleProxiedTool(tool.id, checked)}
                      />
                    </div>
                    {tool.authCheck && tool.enabled && authStatus?.state === 'needs-reauth' && authStatus.reauthHint && (
                      <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                        <p className="text-sm text-yellow-600 dark:text-yellow-400">
                          {authStatus.reauthHint}
                        </p>
                        <div className="flex gap-2 mt-2">
                          {tool.authCheck?.reauthCommand && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs cursor-pointer"
                              disabled={reauthingToolId === tool.id}
                              onClick={async () => {
                                setReauthingToolId(tool.id)
                                try {
                                  await window.electronAPI.runToolReauth(tool.id)
                                } finally {
                                  setTimeout(() => setReauthingToolId(null), 2000)
                                }
                              }}
                            >
                              {reauthingToolId === tool.id ? 'Opening browser...' : 'Re-auth Now'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs cursor-pointer"
                            onClick={handleCheckAuth}
                            disabled={checkingAuth}
                          >
                            {checkingAuth ? 'Checking...' : 'Check Now'}
                          </Button>
                        </div>
                      </div>
                    )}
                    {tool.id === 'bb' && tool.enabled && (
                      <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md space-y-2">
                        <p className="text-sm text-blue-600 dark:text-blue-400">
                          <strong>Setup:</strong> Export <code className="bg-muted px-1 rounded">BUILDBUDDY_API_KEY</code> in
                          your <code className="bg-muted px-1 rounded">~/.zshrc</code> for agents to use bb.
                          Find your key in <code className="bg-muted px-1 rounded">~/.bazelrc</code> or
                          run <code className="bg-muted px-1 rounded">bb login</code> in any git repo.
                        </p>
                        <p className="text-sm text-blue-600/70 dark:text-blue-400/70">
                          Don&apos;t have bb installed? Run: <code className="bg-muted px-1 rounded">curl -fsSL https://install.buildbuddy.io | bash</code>
                        </p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            </div>
          </div>
        )

      case 'headless':
        return (
          <div className="bg-card border rounded-lg p-6">
            <HeadlessSettings />
          </div>
        )

      case 'plans':
        return (
          <div className="bg-card border rounded-lg p-6">
            <PlansSettings onPreferencesChange={() => {}} />
          </div>
        )

      case 'ralph-presets':
        return (
          <div className="bg-card border rounded-lg p-6">
            <RalphLoopPresetsSettings onSettingsChange={loadSettings} />
          </div>
        )

      case 'repositories':
        return (
          <div className="bg-card border rounded-lg p-6">
            <RepositoriesSettings onSettingsChange={loadSettings} />
          </div>
        )

      case 'playbox':
        return (
          <div className="bg-card border rounded-lg p-6">
            <PlayboxSettings onSettingsChange={loadSettings} />
          </div>
        )

      case 'advanced':
        return (
          <div className="bg-card border rounded-lg p-6">
            <RawJsonSettings onSettingsChange={loadSettings} />
          </div>
        )
    }
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-lg font-medium">Settings</span>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onBack} data-testid="back-to-workspace-button">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Workspace
        </Button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r p-4">
          <nav className="space-y-1">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                data-testid={`settings-section-${item.id}`}
                onClick={() => setActiveSection(item.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  activeSection === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <div className="font-medium">{item.label}</div>
                <div className="text-xs opacity-80 mt-0.5">
                  {item.description}
                </div>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className={activeSection === 'repositories' ? 'max-w-5xl' : 'max-w-3xl'}>{renderContent()}</div>
        </main>
      </div>
    </div>
  )
}
