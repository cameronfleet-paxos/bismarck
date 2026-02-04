import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, X, Save, Check, ChevronDown, ChevronRight, Pencil, ExternalLink } from 'lucide-react'
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
import type { Repository } from '@/shared/types'

// Convert git remote URL to GitHub web URL
function getGitHubUrlFromRemote(remoteUrl: string): string | null {
  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/)
  if (sshMatch) return `https://github.com/${sshMatch[1]}`

  // Handle HTTPS URLs: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`

  return null
}

type SettingsSection = 'general' | 'keyboard' | 'authentication' | 'docker' | 'paths' | 'tools' | 'plans' | 'repositories' | 'playbox' | 'advanced'

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
    id: 'plans',
    label: 'Plans',
    description: 'Agent model and operating mode',
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
}

interface SettingsPageProps {
  onBack: () => void
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  // Docker settings local state
  const [newImage, setNewImage] = useState('')
  const [cpuLimit, setCpuLimit] = useState('')
  const [memoryLimit, setMemoryLimit] = useState('')

  // Tool paths local state
  const [bdPath, setBdPath] = useState('')
  const [ghPath, setGhPath] = useState('')
  const [gitPath, setGitPath] = useState('')
  const [autoDetectedPaths, setAutoDetectedPaths] = useState<{ bd: string | null; gh: string | null; git: string | null } | null>(null)

  // Proxied tools local state
  const [newToolName, setNewToolName] = useState('')
  const [newToolPath, setNewToolPath] = useState('')
  const [newToolDescription, setNewToolDescription] = useState('')

  // GitHub token local state
  const [hasToken, setHasToken] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [detectingToken, setDetectingToken] = useState(false)
  const [tokenDetectResult, setTokenDetectResult] = useState<{ success: boolean; source: string | null; reason?: string } | null>(null)

  // Repositories state
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [expandedRepoId, setExpandedRepoId] = useState<string | null>(null)
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null)
  const [editPurpose, setEditPurpose] = useState('')
  const [editCompletionCriteria, setEditCompletionCriteria] = useState('')
  const [editProtectedBranches, setEditProtectedBranches] = useState('')
  const [newRepoPath, setNewRepoPath] = useState('')
  const [addingRepo, setAddingRepo] = useState(false)
  const [addRepoError, setAddRepoError] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const [loaded, detectedPaths, tokenConfigured] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.detectToolPaths(),
        window.electronAPI.hasGitHubToken(),
      ])
      setSettings(loaded)
      setAutoDetectedPaths(detectedPaths)
      setHasToken(tokenConfigured)

      // Initialize local state from loaded settings
      setCpuLimit(loaded.docker.resourceLimits.cpu)
      setMemoryLimit(loaded.docker.resourceLimits.memory)
      setBdPath(loaded.paths.bd || '')
      setGhPath(loaded.paths.gh || '')
      setGitPath(loaded.paths.git || '')

      // Load repositories
      const repos = await window.electronAPI.getRepositories()
      setRepositories(repos)
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddImage = async () => {
    if (!newImage.trim()) return

    try {
      await window.electronAPI.addDockerImage(newImage.trim())
      setNewImage('')
      await loadSettings()
    } catch (error) {
      console.error('Failed to add image:', error)
    }
  }

  const handleRemoveImage = async (image: string) => {
    try {
      await window.electronAPI.removeDockerImage(image)
      await loadSettings()
    } catch (error) {
      console.error('Failed to remove image:', error)
    }
  }

  const handleSelectImage = async (image: string) => {
    try {
      await window.electronAPI.setSelectedDockerImage(image)
      await loadSettings()
    } catch (error) {
      console.error('Failed to select image:', error)
    }
  }

  const handleSaveResourceLimits = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateDockerResourceLimits({
        cpu: cpuLimit,
        memory: memoryLimit,
      })
      await loadSettings()
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save resource limits:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleSshAgentToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateDockerSshSettings({ enabled })
      await loadSettings()
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update SSH agent settings:', error)
    }
  }

  const handleDockerSocketToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateDockerSocketSettings({ enabled })
      await loadSettings()
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update Docker socket settings:', error)
    }
  }

  const handleSavePaths = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateToolPaths({
        bd: bdPath || null,
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

  const handleAddProxiedTool = async () => {
    if (!newToolName.trim() || !newToolPath.trim()) return

    try {
      await window.electronAPI.addProxiedTool({
        name: newToolName.trim(),
        hostPath: newToolPath.trim(),
        description: newToolDescription.trim() || undefined,
      })
      setNewToolName('')
      setNewToolPath('')
      setNewToolDescription('')
      await loadSettings()
    } catch (error) {
      console.error('Failed to add proxied tool:', error)
    }
  }

  const handleRemoveProxiedTool = async (id: string) => {
    try {
      await window.electronAPI.removeProxiedTool(id)
      await loadSettings()
    } catch (error) {
      console.error('Failed to remove proxied tool:', error)
    }
  }

  const handleSaveGitHubToken = async () => {
    if (!newToken.trim()) return

    setSavingToken(true)
    try {
      await window.electronAPI.setGitHubToken(newToken.trim())
      setNewToken('')
      setHasToken(true)
      setTokenDetectResult(null)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save GitHub token:', error)
    } finally {
      setSavingToken(false)
    }
  }

  const handleClearGitHubToken = async () => {
    try {
      await window.electronAPI.clearGitHubToken()
      setHasToken(false)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to clear GitHub token:', error)
    }
  }

  const handleAutoDetectGitHubToken = async () => {
    setDetectingToken(true)
    setTokenDetectResult(null)
    try {
      const result = await window.electronAPI.setupWizardDetectAndSaveGitHubToken()
      setTokenDetectResult(result)
      if (result.success) {
        setHasToken(true)
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 2000)
      }
    } catch (error) {
      console.error('Failed to detect GitHub token:', error)
      setTokenDetectResult({ success: false, source: null })
    } finally {
      setDetectingToken(false)
    }
  }

  const startEditingRepo = (repo: Repository) => {
    setEditingRepoId(repo.id)
    setEditPurpose(repo.purpose || '')
    setEditCompletionCriteria(repo.completionCriteria || '')
    setEditProtectedBranches(repo.protectedBranches?.join(', ') || '')
  }

  const cancelEditingRepo = () => {
    setEditingRepoId(null)
    setEditPurpose('')
    setEditCompletionCriteria('')
    setEditProtectedBranches('')
  }

  const handleSaveRepo = async (repoId: string) => {
    setSaving(true)
    try {
      const protectedBranches = editProtectedBranches
        .split(',')
        .map((b) => b.trim())
        .filter((b) => b.length > 0)

      await window.electronAPI.updateRepository(repoId, {
        purpose: editPurpose || undefined,
        completionCriteria: editCompletionCriteria || undefined,
        protectedBranches: protectedBranches.length > 0 ? protectedBranches : undefined,
      })
      await loadSettings()
      cancelEditingRepo()
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save repository:', error)
    } finally {
      setSaving(false)
    }
  }

  const handleAddRepository = async () => {
    if (!newRepoPath.trim()) return

    setAddingRepo(true)
    setAddRepoError(null)
    try {
      const repo = await window.electronAPI.addRepository(newRepoPath.trim())
      if (repo) {
        await loadSettings()
        setNewRepoPath('')
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 2000)
      } else {
        setAddRepoError('Not a valid git repository')
      }
    } catch (error) {
      setAddRepoError(`Failed to add repository: ${error}`)
    } finally {
      setAddingRepo(false)
    }
  }

  const handleRemoveRepository = async (repoId: string) => {
    try {
      await window.electronAPI.removeRepository(repoId)
      await loadSettings()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to remove repository:', error)
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

      case 'authentication':
        return (
          <div className="bg-card border rounded-lg p-6">
            <AuthenticationSettings />
          </div>
        )

      case 'docker':
        return (
          <div className="space-y-6">
            {/* Docker Images */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Container Images</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Docker images used for headless task agents. Select which image to use.
              </p>

              <div className="space-y-3">
                {settings.docker.images.map((image) => (
                  <div
                    key={image}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                  >
                    <label className="flex items-center gap-3 flex-1 cursor-pointer">
                      <input
                        type="radio"
                        name="selectedImage"
                        value={image}
                        checked={settings.docker.selectedImage === image}
                        onChange={() => handleSelectImage(image)}
                        className="h-4 w-4"
                      />
                      <span className="font-mono text-sm">{image}</span>
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveImage(image)}
                      disabled={settings.docker.images.length === 1}
                      className="h-7 w-7 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="e.g., bismarck-agent:latest"
                  value={newImage}
                  onChange={(e) => setNewImage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAddImage()
                    }
                  }}
                />
                <Button onClick={handleAddImage} disabled={!newImage.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>
            </div>

            {/* Resource Limits */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Resource Limits</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Default CPU and memory limits for Docker containers
              </p>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cpu-limit">CPU Cores</Label>
                  <Input
                    id="cpu-limit"
                    placeholder="e.g., 2"
                    value={cpuLimit}
                    onChange={(e) => setCpuLimit(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of CPU cores allocated to each container
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="memory-limit">Memory</Label>
                  <Input
                    id="memory-limit"
                    placeholder="e.g., 4g"
                    value={memoryLimit}
                    onChange={(e) => setMemoryLimit(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Memory limit per container (e.g., 4g, 8g, 512m)
                  </p>
                </div>

                <Button
                  onClick={handleSaveResourceLimits}
                  disabled={saving || !cpuLimit || !memoryLimit}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Resource Limits'}
                </Button>
              </div>
            </div>

            {/* SSH Agent Forwarding */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">SSH Agent Forwarding</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Forward your SSH agent to containers for private repository access (Bazel, Go modules, npm)
              </p>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <Label htmlFor="ssh-agent-enabled">Enable SSH Agent Forwarding</Label>
                  <p className="text-xs text-muted-foreground">
                    Allows containers to authenticate with GitHub using your SSH keys
                  </p>
                </div>
                <Switch
                  id="ssh-agent-enabled"
                  checked={settings.docker.sshAgent?.enabled ?? true}
                  onCheckedChange={handleSshAgentToggle}
                />
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <strong>Security note:</strong> When enabled, processes inside containers can use your SSH keys
                  to authenticate with remote services. Only enable this if you trust the code running in your
                  containers. Your keys remain on your host machine and are never copied into containers.
                </p>
              </div>
            </div>

            {/* Docker Socket Access */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">Docker Socket Access</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Mount the Docker socket into containers for testcontainers and integration tests
              </p>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <Label htmlFor="docker-socket-enabled">Enable Docker Socket Access</Label>
                  <p className="text-xs text-muted-foreground">
                    Allows containers to spawn sibling containers (required for testcontainers)
                  </p>
                </div>
                <Switch
                  id="docker-socket-enabled"
                  checked={settings.docker.dockerSocket?.enabled ?? false}
                  onCheckedChange={handleDockerSocketToggle}
                />
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <strong>Security note:</strong> When enabled, containers can control Docker on your host machine,
                  including spawning and managing other containers. This is required for integration tests that use
                  testcontainers-go or similar frameworks. Only enable if you need to run integration tests that
                  require Docker access.
                </p>
              </div>

              {settings.docker.dockerSocket?.enabled && (
                <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    <strong>How it works:</strong> The Docker socket (<code className="bg-muted px-1 rounded">/var/run/docker.sock</code>)
                    is mounted into containers, allowing them to communicate with your host's Docker daemon.
                    On macOS, the <code className="bg-muted px-1 rounded">TESTCONTAINERS_HOST_OVERRIDE</code> environment
                    variable is automatically set to enable proper networking with spawned containers.
                  </p>
                </div>
              )}
            </div>
          </div>
        )

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

            {/* GitHub Token Section */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">GitHub Token</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Configure a GitHub token for the <code className="bg-muted px-1 rounded">gh</code> CLI. This is needed when working with organizations that require SAML SSO authentication.
              </p>

              {/* Status indicator */}
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  {hasToken ? (
                    <>
                      <Check className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600 dark:text-green-400 font-medium">Token configured</span>
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Not configured</span>
                    </>
                  )}
                </div>
              </div>

              {/* Auto-detect button */}
              <div className="space-y-4">
                <div>
                  <Button
                    onClick={handleAutoDetectGitHubToken}
                    variant="outline"
                    disabled={detectingToken}
                  >
                    {detectingToken ? (
                      <>
                        <span className="animate-spin mr-2">...</span>
                        Detecting...
                      </>
                    ) : (
                      'Auto-detect from environment'
                    )}
                  </Button>
                  {tokenDetectResult && (
                    tokenDetectResult.success ? (
                      <p className="text-sm mt-2 text-green-600 dark:text-green-400">
                        Token detected from {tokenDetectResult.source} and saved
                      </p>
                    ) : (
                      <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                        <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                          {tokenDetectResult.reason === 'command_substitution'
                            ? 'Token set via command'
                            : tokenDetectResult.reason === 'unresolved_ref'
                            ? 'Token references unresolved variable'
                            : 'No token found'}
                        </p>
                        {tokenDetectResult.reason === 'command_substitution' ? (
                          <p className="text-xs text-muted-foreground mt-2">
                            Token appears to be set via a command (e.g., <code className="bg-muted px-1 rounded">$(op ...)</code>).
                            For security, we can't execute shell commands. Paste your token below.
                          </p>
                        ) : tokenDetectResult.reason === 'unresolved_ref' ? (
                          <>
                            <p className="text-xs text-muted-foreground mt-2">
                              Found <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> in your shell profile,
                              but it references another variable that isn't exported.
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              If it's set by a secrets manager (1Password, Doppler, etc.),
                              copy the token value and paste it below.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-xs text-muted-foreground mt-2">
                              To enable auto-detection, add to your shell profile (<code className="bg-muted px-1 rounded">~/.zshrc</code> or <code className="bg-muted px-1 rounded">~/.bashrc</code>):
                            </p>
                            <pre className="bg-zinc-800 text-zinc-100 p-2 rounded mt-2 text-xs font-mono overflow-x-auto">
                              export GITHUB_TOKEN="ghp_your_token_here"
                            </pre>
                            <p className="text-xs text-muted-foreground mt-2">
                              Then click "Auto-detect" again, or paste your token below.
                            </p>
                          </>
                        )}
                      </div>
                    )
                  )}
                </div>

                {/* Manual entry */}
                <div className="space-y-2">
                  <Label htmlFor="github-token">Manual Entry</Label>
                  <div className="flex gap-2">
                    <Input
                      id="github-token"
                      type="password"
                      placeholder={hasToken ? '••••••••' : 'ghp_xxxxxxxxxxxx'}
                      value={newToken}
                      onChange={(e) => setNewToken(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveGitHubToken()
                        }
                      }}
                    />
                    <Button
                      onClick={handleSaveGitHubToken}
                      disabled={!newToken.trim() || savingToken}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {savingToken ? 'Saving...' : 'Save'}
                    </Button>
                    {hasToken && (
                      <Button
                        onClick={handleClearGitHubToken}
                        variant="outline"
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Generate a token at{' '}
                    <button
                      onClick={() => window.electronAPI.openExternal('https://github.com/settings/tokens')}
                      className="text-blue-500 hover:underline"
                    >
                      github.com/settings/tokens
                    </button>
                    {' '}with <code className="bg-muted px-1 rounded">repo</code> scope.
                  </p>
                </div>

                {/* Info box */}
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    <strong>When to use:</strong> If you're getting SAML SSO errors when creating PRs for organization repositories, you need to configure a token here. The token is passed to <code className="bg-muted px-1 rounded">gh</code> commands via the <code className="bg-muted px-1 rounded">GITHUB_TOKEN</code> environment variable.
                  </p>
                </div>
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
                These tools are available to headless agents running in Docker containers.
              </p>

              <div className="space-y-3 mb-4">
              {settings.docker.proxiedTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-start justify-between p-4 bg-muted/50 rounded-md"
                >
                  <div className="flex-1">
                    <div className="font-medium">{tool.name}</div>
                    <div className="font-mono text-xs text-muted-foreground mt-1">
                      {tool.hostPath}
                    </div>
                    {tool.description && (
                      <div className="text-sm text-muted-foreground mt-1">
                        {tool.description}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveProxiedTool(tool.id)}
                    className="h-7 w-7 p-0 ml-2"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            </div>

            {/* Add Proxied Tool Form */}
            <div className="bg-card border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Add Proxied Tool</h3>

              <div className="space-y-2">
                <Label htmlFor="tool-name">Tool Name</Label>
                <Input
                  id="tool-name"
                  placeholder="e.g., npm"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tool-path">Host Path</Label>
                <Input
                  id="tool-path"
                  placeholder="e.g., /usr/local/bin/npm"
                  value={newToolPath}
                  onChange={(e) => setNewToolPath(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tool-description">Description (optional)</Label>
                <Input
                  id="tool-description"
                  placeholder="e.g., Node package manager"
                  value={newToolDescription}
                  onChange={(e) => setNewToolDescription(e.target.value)}
                />
              </div>

              <Button
                onClick={handleAddProxiedTool}
                disabled={!newToolName.trim() || !newToolPath.trim()}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Tool
              </Button>

              <p className="text-xs text-muted-foreground mt-4">
                <strong>Tip:</strong> Find tool paths using <code className="bg-muted px-1 rounded">which tool-name</code> in your terminal (e.g., <code className="bg-muted px-1 rounded">which npm</code>).
              </p>
            </div>
          </div>
        )

      case 'plans':
        return (
          <div className="bg-card border rounded-lg p-6">
            <PlansSettings onPreferencesChange={() => {}} />
          </div>
        )

      case 'repositories':
        return (
          <div className="bg-card border rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Repositories</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Git repositories for your agent workspaces
            </p>

            {/* Add repository form */}
            <div className="mb-6 p-4 bg-muted/30 rounded-lg">
              <Label className="text-sm font-medium mb-2 block">Add Repository</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="/path/to/your/repository"
                  value={newRepoPath}
                  onChange={(e) => {
                    setNewRepoPath(e.target.value)
                    setAddRepoError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddRepository()
                  }}
                  className="flex-1"
                />
                <Button
                  onClick={handleAddRepository}
                  disabled={!newRepoPath.trim() || addingRepo}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {addingRepo ? 'Adding...' : 'Add'}
                </Button>
              </div>
              {addRepoError && (
                <p className="text-sm text-destructive mt-2">{addRepoError}</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Enter the absolute path to a git repository
              </p>
            </div>

            {repositories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No repositories found.</p>
                <p className="text-sm mt-2">
                  Add a repository above or create agents with git-initialized directories.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {repositories.map((repo) => {
                  const isExpanded = expandedRepoId === repo.id
                  const isEditing = editingRepoId === repo.id

                  return (
                    <div
                      key={repo.id}
                      className="border rounded-lg overflow-hidden"
                    >
                      {/* Header - always visible */}
                      <button
                        onClick={() => setExpandedRepoId(isExpanded ? null : repo.id)}
                        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            {repo.remoteUrl && getGitHubUrlFromRemote(repo.remoteUrl) ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  window.electronAPI.openExternal(getGitHubUrlFromRemote(repo.remoteUrl!)!)
                                }}
                                className="font-medium text-blue-500 hover:text-blue-400 hover:underline flex items-center gap-1"
                              >
                                {repo.name}
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            ) : (
                              <div className="font-medium">{repo.name}</div>
                            )}
                            <div className="text-xs text-muted-foreground font-mono">
                              {repo.rootPath}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-muted-foreground">
                            {repo.defaultBranch}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRemoveRepository(repo.id)
                            }}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            title="Remove repository"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </button>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div className="border-t p-4 bg-muted/30">
                          {/* Read-only fields */}
                          <div className="space-y-3 mb-4">
                            <div>
                              <Label className="text-xs text-muted-foreground">Path</Label>
                              <div className="font-mono text-sm">{repo.rootPath}</div>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Default Branch</Label>
                              <div className="text-sm">{repo.defaultBranch}</div>
                            </div>
                            {repo.remoteUrl && (
                              <div>
                                <Label className="text-xs text-muted-foreground">Remote URL</Label>
                                <div className="font-mono text-sm break-all">{repo.remoteUrl}</div>
                              </div>
                            )}
                          </div>

                          {/* Editable fields */}
                          {isEditing ? (
                            <div className="space-y-4 pt-4 border-t">
                              <div className="space-y-2">
                                <Label htmlFor={`purpose-${repo.id}`}>Purpose</Label>
                                <Input
                                  id={`purpose-${repo.id}`}
                                  placeholder="What is this repository for?"
                                  value={editPurpose}
                                  onChange={(e) => setEditPurpose(e.target.value)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`completion-${repo.id}`}>Completion Criteria</Label>
                                <Input
                                  id={`completion-${repo.id}`}
                                  placeholder="What does 'done' look like?"
                                  value={editCompletionCriteria}
                                  onChange={(e) => setEditCompletionCriteria(e.target.value)}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor={`protected-${repo.id}`}>Protected Branches</Label>
                                <Input
                                  id={`protected-${repo.id}`}
                                  placeholder="main, master, production (comma-separated)"
                                  value={editProtectedBranches}
                                  onChange={(e) => setEditProtectedBranches(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Branches that agents should not modify directly
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveRepo(repo.id)}
                                  disabled={saving}
                                >
                                  <Save className="h-4 w-4 mr-2" />
                                  {saving ? 'Saving...' : 'Save'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEditingRepo}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-3 pt-4 border-t">
                              <div>
                                <Label className="text-xs text-muted-foreground">Purpose</Label>
                                <div className="text-sm">
                                  {repo.purpose || <span className="text-muted-foreground italic">Not set</span>}
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Completion Criteria</Label>
                                <div className="text-sm">
                                  {repo.completionCriteria || <span className="text-muted-foreground italic">Not set</span>}
                                </div>
                              </div>
                              <div>
                                <Label className="text-xs text-muted-foreground">Protected Branches</Label>
                                <div className="text-sm">
                                  {repo.protectedBranches && repo.protectedBranches.length > 0
                                    ? repo.protectedBranches.join(', ')
                                    : <span className="text-muted-foreground italic">None</span>}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startEditingRepo(repo)}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
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
        <Button size="sm" variant="ghost" onClick={onBack}>
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
          <div className="max-w-3xl">{renderContent()}</div>
        </main>
      </div>
    </div>
  )
}
