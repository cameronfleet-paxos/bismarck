import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, X, Save, Check, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import { Logo } from '@/renderer/components/Logo'
import { GeneralSettings } from '@/renderer/components/settings/sections/GeneralSettings'
import { PlansSettings } from '@/renderer/components/settings/sections/PlansSettings'
import type { Repository } from '@/shared/types'

type SettingsSection = 'general' | 'docker' | 'paths' | 'tools' | 'plans' | 'repositories'

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
    id: 'docker',
    label: 'Docker',
    description: 'Container images and resource limits',
  },
  {
    id: 'paths',
    label: 'Tool Paths',
    description: 'Configure tool executable paths',
  },
  {
    id: 'tools',
    label: 'Proxied Tools',
    description: 'Tools available in containers',
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
]

interface AppSettings {
  paths: {
    bd: string | null
    gh: string | null
    git: string | null
  }
  docker: {
    images: string[]
    resourceLimits: {
      cpu: string
      memory: string
    }
    proxiedTools: ProxiedTool[]
    sshAgent?: {
      enabled: boolean
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

  // Proxied tools local state
  const [newToolName, setNewToolName] = useState('')
  const [newToolPath, setNewToolPath] = useState('')
  const [newToolDescription, setNewToolDescription] = useState('')

  // Repositories state
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [expandedRepoId, setExpandedRepoId] = useState<string | null>(null)
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null)
  const [editPurpose, setEditPurpose] = useState('')
  const [editCompletionCriteria, setEditCompletionCriteria] = useState('')
  const [editProtectedBranches, setEditProtectedBranches] = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    setLoading(true)
    try {
      const loaded = await window.electronAPI.getSettings()
      setSettings(loaded)

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
          </div>
        )

      case 'paths':
        return (
          <div className="bg-card border rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Tool Paths</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Configure paths to command-line tools. Leave empty to use auto-detected paths.
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bd-path">bd (Beads)</Label>
                <Input
                  id="bd-path"
                  placeholder="e.g., /usr/local/bin/bd"
                  value={bdPath}
                  onChange={(e) => setBdPath(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gh-path">gh (GitHub CLI)</Label>
                <Input
                  id="gh-path"
                  placeholder="e.g., /usr/local/bin/gh"
                  value={ghPath}
                  onChange={(e) => setGhPath(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="git-path">git</Label>
                <Input
                  id="git-path"
                  placeholder="e.g., /usr/bin/git"
                  value={gitPath}
                  onChange={(e) => setGitPath(e.target.value)}
                />
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
        )

      case 'tools':
        return (
          <div className="bg-card border rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2">Proxied Tools</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Tools that will be available inside Docker containers via proxy
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

            <div className="space-y-4 pt-4 border-t">
              <h4 className="font-medium">Add Proxied Tool</h4>

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
              Git repositories that have been detected from your agent workspaces
            </p>

            {repositories.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No repositories found.</p>
                <p className="text-sm mt-2">
                  Repositories are detected when you create agents with git-initialized directories.
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
                            <div className="font-medium">{repo.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {repo.rootPath}
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {repo.defaultBranch}
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
