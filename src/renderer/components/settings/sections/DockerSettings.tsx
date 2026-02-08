import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Save, Check, Download, Loader2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'

interface AppSettings {
  docker: {
    images: string[]
    selectedImage: string
    resourceLimits: {
      cpu: string
      memory: string
      gomaxprocs: string
    }
    proxiedTools: { id: string; name: string; hostPath: string; description?: string }[]
    sshAgent?: {
      enabled: boolean
    }
    dockerSocket?: {
      enabled: boolean
      path: string
    }
    sharedBuildCache?: {
      enabled: boolean
    }
  }
}

type ImageStatusState =
  | { status: 'checking' }
  | { status: 'exists'; imageId?: string; created?: string; size?: number }
  | { status: 'not-found' }
  | { status: 'pulling'; progress?: string }
  | { status: 'pull-success'; alreadyUpToDate: boolean }
  | { status: 'pull-error'; error: string }

interface DockerSettingsProps {
  settings: AppSettings
  onSettingsChange: () => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function DockerSettings({ settings, onSettingsChange }: DockerSettingsProps) {
  const [newImage, setNewImage] = useState('')
  const [cpuLimit, setCpuLimit] = useState(settings.docker.resourceLimits.cpu)
  const [memoryLimit, setMemoryLimit] = useState(settings.docker.resourceLimits.memory)
  const [gomaxprocsLimit, setGomaxprocsLimit] = useState(settings.docker.resourceLimits.gomaxprocs)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [imageStatuses, setImageStatuses] = useState<Record<string, ImageStatusState>>({})
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null)
  const [pullingImage, setPullingImage] = useState<string | null>(null)

  const checkImageStatuses = useCallback(async () => {
    const images = settings.docker.images
    // Initialize all as checking
    const initial: Record<string, ImageStatusState> = {}
    for (const image of images) {
      initial[image] = { status: 'checking' }
    }
    setImageStatuses(initial)

    // Check all images in parallel
    const results = await Promise.all(
      images.map(async (image) => {
        try {
          const result = await window.electronAPI.checkDockerImageStatus(image)
          setDockerAvailable(result.dockerAvailable)
          if (!result.dockerAvailable) {
            return { image, state: { status: 'not-found' as const } }
          }
          return {
            image,
            state: result.exists
              ? { status: 'exists' as const, imageId: result.imageId, created: result.created, size: result.size }
              : { status: 'not-found' as const },
          }
        } catch {
          setDockerAvailable(false)
          return { image, state: { status: 'not-found' as const } }
        }
      })
    )

    const newStatuses: Record<string, ImageStatusState> = {}
    for (const { image, state } of results) {
      newStatuses[image] = state
    }
    setImageStatuses(newStatuses)
  }, [settings.docker.images])

  useEffect(() => {
    checkImageStatuses()
  }, [checkImageStatuses])

  // Update local state when settings prop changes
  useEffect(() => {
    setCpuLimit(settings.docker.resourceLimits.cpu)
    setMemoryLimit(settings.docker.resourceLimits.memory)
    setGomaxprocsLimit(settings.docker.resourceLimits.gomaxprocs)
  }, [settings.docker.resourceLimits.cpu, settings.docker.resourceLimits.memory, settings.docker.resourceLimits.gomaxprocs])

  const handlePullImage = async (imageName: string) => {
    if (pullingImage) return // Only one pull at a time

    setPullingImage(imageName)
    setImageStatuses((prev) => ({
      ...prev,
      [imageName]: { status: 'pulling' },
    }))

    // Listen for progress
    window.electronAPI.onDockerPullProgress((message) => {
      setImageStatuses((prev) => ({
        ...prev,
        [imageName]: { status: 'pulling', progress: message },
      }))
    })

    try {
      const result = await window.electronAPI.pullDockerImage(imageName)
      window.electronAPI.removeDockerPullProgressListener()

      if (result.success) {
        setImageStatuses((prev) => ({
          ...prev,
          [imageName]: { status: 'pull-success', alreadyUpToDate: result.alreadyUpToDate },
        }))
        // Re-check status after a brief delay to show success message
        setTimeout(async () => {
          try {
            const info = await window.electronAPI.checkDockerImageStatus(imageName)
            setImageStatuses((prev) => ({
              ...prev,
              [imageName]: info.exists
                ? { status: 'exists', imageId: info.imageId, created: info.created, size: info.size }
                : { status: 'not-found' },
            }))
          } catch {
            // Keep the success state
          }
        }, 3000)
      } else {
        setImageStatuses((prev) => ({
          ...prev,
          [imageName]: { status: 'pull-error', error: result.output.substring(0, 200) },
        }))
      }
    } catch (err) {
      window.electronAPI.removeDockerPullProgressListener()
      setImageStatuses((prev) => ({
        ...prev,
        [imageName]: { status: 'pull-error', error: String(err) },
      }))
    } finally {
      setPullingImage(null)
    }
  }

  const handleAddImage = async () => {
    if (!newImage.trim()) return
    try {
      await window.electronAPI.addDockerImage(newImage.trim())
      setNewImage('')
      await onSettingsChange()
    } catch (error) {
      console.error('Failed to add image:', error)
    }
  }

  const handleRemoveImage = async (image: string) => {
    try {
      await window.electronAPI.removeDockerImage(image)
      await onSettingsChange()
    } catch (error) {
      console.error('Failed to remove image:', error)
    }
  }

  const handleSelectImage = async (image: string) => {
    try {
      await window.electronAPI.setSelectedDockerImage(image)
      await onSettingsChange()
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
        gomaxprocs: gomaxprocsLimit,
      })
      await onSettingsChange()
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
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update SSH agent settings:', error)
    }
  }

  const handleDockerSocketToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateDockerSocketSettings({ enabled })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update Docker socket settings:', error)
    }
  }

  const handleSharedBuildCacheToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateDockerSharedBuildCacheSettings({ enabled })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update shared build cache settings:', error)
    }
  }

  const renderImageStatus = (image: string) => {
    const imageStatus = imageStatuses[image]
    if (!imageStatus) return null

    switch (imageStatus.status) {
      case 'checking':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Checking...</span>
          </div>
        )
      case 'exists':
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-green-600 dark:text-green-400">Installed</span>
            {imageStatus.size != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{formatBytes(imageStatus.size)}</span>
              </>
            )}
            {imageStatus.created && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">created {formatTimeAgo(imageStatus.created)}</span>
              </>
            )}
          </div>
        )
      case 'not-found':
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <XCircle className="h-3.5 w-3.5 text-red-500" />
            <span className="text-red-600 dark:text-red-400">Not installed</span>
          </div>
        )
      case 'pulling':
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
            <span className="text-blue-600 dark:text-blue-400 truncate max-w-[300px]">
              {imageStatus.progress || 'Pulling...'}
            </span>
          </div>
        )
      case 'pull-success':
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-green-600 dark:text-green-400">
              {imageStatus.alreadyUpToDate ? 'Image is up to date' : 'Updated successfully'}
            </span>
          </div>
        )
      case 'pull-error':
        return (
          <div className="flex items-center gap-1.5 text-xs">
            <XCircle className="h-3.5 w-3.5 text-red-500" />
            <span className="text-red-600 dark:text-red-400 truncate max-w-[300px]">
              Pull failed: {imageStatus.error}
            </span>
          </div>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Docker not available warning */}
      {dockerAvailable === false && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Docker is not available
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Docker Desktop must be running to pull images and run headless agents.
            </p>
          </div>
        </div>
      )}

      {/* Container Images */}
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Container Images</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Docker images used for headless task agents. Select which image to use.
        </p>

        <div className="space-y-3">
          {settings.docker.images.map((image) => {
            const isPulling = pullingImage === image
            const imageStatus = imageStatuses[image]
            const canPull = !pullingImage && dockerAvailable !== false &&
              imageStatus?.status !== 'checking'

            return (
              <div
                key={image}
                className="p-3 bg-muted/50 rounded-md"
              >
                <div className="flex items-center justify-between">
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
                <div className="ml-7 mt-1.5 flex items-center justify-between">
                  {renderImageStatus(image)}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePullImage(image)}
                    disabled={!canPull}
                    className="h-7 text-xs px-2.5"
                  >
                    {isPulling ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                    ) : (
                      <Download className="h-3 w-3 mr-1.5" />
                    )}
                    {imageStatus?.status === 'not-found' ? 'Pull Image' : 'Pull Latest'}
                  </Button>
                </div>
              </div>
            )
          })}
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
              placeholder="e.g., 8g"
              value={memoryLimit}
              onChange={(e) => setMemoryLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Memory limit per container (e.g., 4g, 8g, 512m)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="gomaxprocs-limit">GOMAXPROCS</Label>
            <Input
              id="gomaxprocs-limit"
              placeholder="e.g., 4"
              value={gomaxprocsLimit}
              onChange={(e) => setGomaxprocsLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Limits Go parallelism inside containers. Prevents OOM from too many concurrent test suites.
            </p>
          </div>

          <Button
            onClick={handleSaveResourceLimits}
            disabled={saving || !cpuLimit || !memoryLimit || !gomaxprocsLimit}
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

      {/* Shared Build Cache */}
      <div className="bg-card border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-2">Shared Build Cache</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Share Go build and module caches across agents working on the same repository. Reduces compilation time and avoids re-downloading modules for parallel agents.
        </p>

        <div className="flex items-center justify-between mb-4">
          <div>
            <Label htmlFor="shared-build-cache-enabled">Enable Shared Build Cache</Label>
            <p className="text-xs text-muted-foreground">
              Agents on the same repo share Go build and module caches instead of each building from scratch
            </p>
          </div>
          <Switch
            id="shared-build-cache-enabled"
            checked={settings.docker.sharedBuildCache?.enabled ?? true}
            onCheckedChange={handleSharedBuildCacheToggle}
          />
        </div>

        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Caches are stored per-repo at <code className="bg-muted px-1 rounded">~/.bismarck/repos/&lt;repo&gt;/.gocache/</code> and <code className="bg-muted px-1 rounded">.gomodcache/</code>.
            Go's caches are safe for concurrent access using OS file locks.
          </p>
        </div>
      </div>
    </div>
  )
}
