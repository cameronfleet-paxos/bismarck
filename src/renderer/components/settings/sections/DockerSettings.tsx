import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Save, Check, Download, Loader2, AlertTriangle, CheckCircle2, XCircle, Info, ShieldCheck, Shield, RotateCcw } from 'lucide-react'
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
    }
    proxiedTools: { id: string; name: string; hostPath: string; description?: string }[]
    sshAgent?: {
      enabled: boolean
    }
    dockerSocket?: {
      enabled: boolean
      path: string
    }
    networkIsolation?: {
      enabled: boolean
      allowedHosts: string[]
    }
    buildbuddyMcp?: {
      enabled: boolean
      hostPath: string
    }
  }
}

type ImageStatusState =
  | { status: 'checking' }
  | { status: 'exists'; imageId?: string; created?: string; size?: number; version?: string; digest?: string; verified?: boolean }
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
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [imageStatuses, setImageStatuses] = useState<Record<string, ImageStatusState>>({})
  const [dockerAvailable, setDockerAvailable] = useState<boolean | null>(null)
  const [pullingImage, setPullingImage] = useState<string | null>(null)
  const [baseImageUpdate, setBaseImageUpdate] = useState<{ newVersion: string | null; newDigest: string | null } | null>(null)
  const [networkIsolationEnabled, setNetworkIsolationEnabled] = useState(settings.docker.networkIsolation?.enabled ?? false)
  const [allowedHosts, setAllowedHosts] = useState<string[]>(settings.docker.networkIsolation?.allowedHosts ?? [])
  const [newHost, setNewHost] = useState('')
  const [mcpHostPath, setMcpHostPath] = useState(settings.docker.buildbuddyMcp?.hostPath ?? '')

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
          const version = result.labels?.['org.opencontainers.image.version']
          return {
            image,
            state: result.exists
              ? { status: 'exists' as const, imageId: result.imageId, created: result.created, size: result.size, version, digest: result.digest, verified: result.verified }
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
  }, [settings.docker.resourceLimits.cpu, settings.docker.resourceLimits.memory])

  useEffect(() => {
    setNetworkIsolationEnabled(settings.docker.networkIsolation?.enabled ?? false)
    setAllowedHosts(settings.docker.networkIsolation?.allowedHosts ?? [])
  }, [settings.docker.networkIsolation?.enabled, settings.docker.networkIsolation?.allowedHosts])

  // Listen for base image update notifications (for BYO image users)
  useEffect(() => {
    window.electronAPI.onBaseImageUpdated((data) => {
      setBaseImageUpdate(data)
    })
    return () => {
      window.electronAPI.removeBaseImageUpdatedListener()
    }
  }, [])

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
            const ver = info.labels?.['org.opencontainers.image.version']
            setImageStatuses((prev) => ({
              ...prev,
              [imageName]: info.exists
                ? { status: 'exists', imageId: info.imageId, created: info.created, size: info.size, version: ver, digest: info.digest, verified: info.verified }
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

  const handleNetworkIsolationToggle = async (enabled: boolean) => {
    try {
      setNetworkIsolationEnabled(enabled)
      await window.electronAPI.updateDockerNetworkIsolationSettings({ enabled })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update network isolation settings:', error)
      setNetworkIsolationEnabled(!enabled) // revert
    }
  }

  const handleAddHost = async () => {
    const host = newHost.trim()
    if (!host || allowedHosts.includes(host)) return
    const updated = [...allowedHosts, host]
    setAllowedHosts(updated)
    setNewHost('')
    try {
      await window.electronAPI.updateDockerNetworkIsolationSettings({ allowedHosts: updated })
      await onSettingsChange()
    } catch (error) {
      console.error('Failed to add allowed host:', error)
    }
  }

  const handleRemoveHost = async (host: string) => {
    const updated = allowedHosts.filter(h => h !== host)
    setAllowedHosts(updated)
    try {
      await window.electronAPI.updateDockerNetworkIsolationSettings({ allowedHosts: updated })
      await onSettingsChange()
    } catch (error) {
      console.error('Failed to remove allowed host:', error)
    }
  }

  const handleResetHosts = async () => {
    try {
      const defaultHosts = await window.electronAPI.resetDockerNetworkIsolationHosts()
      setAllowedHosts(defaultHosts)
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to reset allowed hosts:', error)
    }
  }

  const handleBuildBuddyMcpToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateSettings({
        docker: {
          buildbuddyMcp: {
            enabled,
            hostPath: settings.docker.buildbuddyMcp?.hostPath ?? '',
          },
        },
      })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update BuildBuddy MCP settings:', error)
    }
  }

  const handleSaveMcpHostPath = async () => {
    try {
      await window.electronAPI.updateSettings({
        docker: {
          buildbuddyMcp: {
            enabled: settings.docker.buildbuddyMcp?.enabled ?? false,
            hostPath: mcpHostPath.trim(),
          },
        },
      })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save MCP host path:', error)
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
      case 'exists': {
        return (
          <div className="flex items-center gap-1.5 text-xs flex-wrap">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <span className="text-green-600 dark:text-green-400">Installed</span>
            {imageStatus.version && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">v{imageStatus.version}</span>
              </>
            )}
            {imageStatus.verified === true && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="flex items-center gap-0.5 text-blue-600 dark:text-blue-400" title="Image digest verified against Docker Hub registry">
                  <ShieldCheck className="h-3 w-3" />
                  Verified
                </span>
              </>
            )}
            {imageStatus.digest && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground font-mono">{imageStatus.digest.substring(7, 19)}</span>
              </>
            )}
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
      }
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

        {baseImageUpdate && (
          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-start gap-3">
            <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                Base image updated{baseImageUpdate.newVersion ? ` to v${baseImageUpdate.newVersion}` : ''}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The official Bismarck agent image has been updated. You may want to rebuild your custom image.
              </p>
            </div>
            <button
              onClick={() => setBaseImageUpdate(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

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

      {/* Network Isolation */}
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Network Isolation</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Restrict container outbound network access to an allowlist of domains via a Squid proxy
        </p>

        <div className="flex items-center justify-between mb-4">
          <div>
            <Label htmlFor="network-isolation-enabled">Enable Network Isolation</Label>
            <p className="text-xs text-muted-foreground">
              Containers can only reach HTTP/HTTPS domains in the allowlist below
            </p>
          </div>
          <Switch
            id="network-isolation-enabled"
            checked={networkIsolationEnabled}
            onCheckedChange={handleNetworkIsolationToggle}
          />
        </div>

        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md mb-4">
          <p className="text-xs text-amber-600 dark:text-amber-400">
            <strong>How it works:</strong> Containers are placed on an internal Docker network with no direct internet access.
            A shared Squid proxy is the sole egress gateway, enforcing domain-level filtering. Only HTTP/HTTPS traffic
            to allowed domains is permitted. The tool proxy (<code className="bg-muted px-1 rounded">host.docker.internal</code>) is always allowed.
          </p>
        </div>

        {networkIsolationEnabled && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Allowed Domains</Label>
              <button
                onClick={handleResetHosts}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to defaults
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2 bg-muted/30">
              {allowedHosts.map((host) => (
                <div
                  key={host}
                  className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50 group"
                >
                  <span className="font-mono text-xs">{host}</span>
                  <button
                    onClick={() => handleRemoveHost(host)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {allowedHosts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No domains allowed. All outbound traffic will be blocked.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="e.g., *.example.com"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddHost()
                }}
                className="font-mono text-sm"
              />
              <Button onClick={handleAddHost} disabled={!newHost.trim()} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* BuildBuddy MCP Server */}
      <div className="bg-card border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-2">BuildBuddy MCP Server</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Mount the BuildBuddy MCP server into Docker containers for headless agents
        </p>

        <div className="flex items-center justify-between mb-4">
          <div>
            <Label htmlFor="buildbuddy-mcp-enabled">Enable BuildBuddy MCP in Containers</Label>
            <p className="text-xs text-muted-foreground">
              Mounts the MCP server directory and generates Claude Code config inside containers
            </p>
          </div>
          <Switch
            id="buildbuddy-mcp-enabled"
            checked={settings.docker.buildbuddyMcp?.enabled ?? false}
            onCheckedChange={handleBuildBuddyMcpToggle}
          />
        </div>

        {settings.docker.buildbuddyMcp?.enabled && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="mcp-host-path">MCP Server Host Path</Label>
              <div className="flex gap-2">
                <Input
                  id="mcp-host-path"
                  placeholder="/path/to/buildbuddy-mcp-server"
                  value={mcpHostPath}
                  onChange={(e) => setMcpHostPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveMcpHostPath()
                    }
                  }}
                />
                <Button
                  onClick={handleSaveMcpHostPath}
                  disabled={!mcpHostPath.trim()}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Path to the directory containing the BuildBuddy MCP server (<code className="bg-muted px-1 rounded">index.js</code>). This directory will be mounted read-only at <code className="bg-muted px-1 rounded">/mcp/buildbuddy</code> inside containers.
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
