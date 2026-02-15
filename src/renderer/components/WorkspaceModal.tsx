import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/components/ui/select'
import { Tooltip } from '@/renderer/components/ui/tooltip'
import { AgentIcon } from '@/renderer/components/AgentIcon'
import type { Agent, AgentProvider, ThemeName, Repository } from '@/shared/types'
import type { AgentIconName } from '@/shared/constants'
import { themes, agentIcons, agentProviderNames } from '@/shared/constants'
import { GitBranch, X, FolderOpen } from 'lucide-react'

interface AgentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent?: Agent
  onSave: (agent: Agent) => void
}

const themeNames = Object.keys(themes) as ThemeName[]

export function AgentModal({
  open,
  onOpenChange,
  agent,
  onSave,
}: AgentModalProps) {
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')
  const [theme, setTheme] = useState<ThemeName>('gray')
  const [icon, setIcon] = useState<AgentIconName>('beethoven')
  const [provider, setProvider] = useState<AgentProvider>('claude')
  const [error, setError] = useState<string | null>(null)

  // Git repository detection state
  const [detectedRepo, setDetectedRepo] = useState<Repository | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)

  // Detect git repository when directory changes
  const detectRepository = useCallback(async (dir: string) => {
    if (!dir.trim()) {
      setDetectedRepo(null)
      return
    }

    setIsDetecting(true)
    try {
      const repo = await window.electronAPI.detectGitRepository(dir.trim())
      setDetectedRepo(repo)
    } catch (err) {
      console.error('Failed to detect repository:', err)
      setDetectedRepo(null)
    } finally {
      setIsDetecting(false)
    }
  }, [])

  // Debounce directory detection
  useEffect(() => {
    const timer = setTimeout(() => {
      detectRepository(directory)
    }, 500)
    return () => clearTimeout(timer)
  }, [directory, detectRepository])

  useEffect(() => {
    if (agent) {
      setName(agent.name)
      setDirectory(agent.directory)
      setTheme(agent.theme)
      setIcon(agent.icon || 'beethoven')
      setProvider(agent.provider || 'claude')
    } else {
      setName('')
      setDirectory('')
      setTheme('gray')
      // Random icon for new agents
      setIcon(agentIcons[Math.floor(Math.random() * agentIcons.length)])
      // Load default provider from settings
      window.electronAPI.getSettings().then(settings => {
        setProvider(settings.defaultProvider || 'claude')
      })
    }
    setError(null)
    setDetectedRepo(null)
  }, [agent, open])

  const handleBrowse = async () => {
    try {
      const selectedPath = await window.electronAPI.setupWizardShowFolderPicker()
      if (selectedPath) {
        setDirectory(selectedPath)
        // Auto-fill name from directory basename if name is empty
        if (!name.trim()) {
          const dirName = selectedPath.split('/').pop() || ''
          setName(dirName)
        }
      }
    } catch (err) {
      console.error('Failed to open folder picker:', err)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!directory.trim()) {
      setError('Directory is required')
      return
    }

    const newAgent: Agent = {
      id: agent?.id || crypto.randomUUID(),
      name: name.trim(),
      directory: directory.trim(),
      purpose: detectedRepo?.name || name.trim(),
      theme,
      icon,
      provider,
      repositoryId: detectedRepo?.id,
    }

    onSave(newAgent)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{agent ? 'Edit Agent' : 'Add Agent'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., pax-main"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="directory">Home Directory</Label>
            <div className="flex gap-2">
              <Input
                id="directory"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="/path/to/your/project"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleBrowse}
                title="Browse for directory"
                data-testid="browse-directory-button"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {/* Git repository detection status */}
            {directory.trim() && (
              <div className="text-xs flex items-center gap-1.5 mt-1">
                {isDetecting ? (
                  <span className="text-muted-foreground">Detecting repository...</span>
                ) : detectedRepo ? (
                  <div className="flex items-center gap-1.5 text-green-600">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Git repo: {detectedRepo.name}</span>
                    <span className="text-muted-foreground">({detectedRepo.defaultBranch})</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-1">
                    <X className="w-3.5 h-3.5" />
                    Not a git repository
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as AgentProvider)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(agentProviderNames) as AgentProvider[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {agentProviderNames[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="theme">Theme</Label>
            <div className="flex items-center gap-3">
              <Select
                value={theme}
                onValueChange={(value) => setTheme(value as ThemeName)}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  {themeNames.map((themeName) => (
                    <SelectItem key={themeName} value={themeName}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-sm border border-border"
                          style={{ backgroundColor: themes[themeName].bg }}
                        />
                        <span className="capitalize">{themeName}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div
                className="w-10 h-10 rounded-md border border-border flex items-center justify-center"
                style={{ backgroundColor: themes[theme].bg }}
              >
                <AgentIcon icon={icon} className="w-7 h-7" />
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Icon</Label>
            <div className="grid grid-cols-10 gap-1 max-h-32 overflow-y-auto p-1 border rounded-md">
              {agentIcons.map((iconName) => (
                <Tooltip
                  key={iconName}
                  content={iconName.charAt(0).toUpperCase() + iconName.slice(1)}
                  delayMs={100}
                >
                  <button
                    type="button"
                    onClick={() => setIcon(iconName)}
                    className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                      icon === iconName
                        ? 'bg-primary ring-2 ring-primary'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    <AgentIcon icon={iconName} className="w-5 h-5" />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Backwards compatibility export
export { AgentModal as WorkspaceModal }
