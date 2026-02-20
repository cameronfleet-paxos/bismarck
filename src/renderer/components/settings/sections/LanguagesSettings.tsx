import { useState, useEffect } from 'react'
import { Save, Check, Search } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import golangIcon from '@/renderer/assets/icons/golang.svg'
import typescriptIcon from '@/renderer/assets/icons/typescript.svg'

type LanguageId = 'go' | 'typescript'

interface LanguagesSettingsProps {
  settings: {
    docker: {
      resourceLimits: {
        gomaxprocs: string
      }
      sharedBuildCache?: {
        enabled: boolean
      }
      pnpmStore?: {
        enabled: boolean
        path: string | null
      }
    }
  }
  onSettingsChange: () => void
}

export function LanguagesSettings({ settings, onSettingsChange }: LanguagesSettingsProps) {
  const [selectedLanguage, setSelectedLanguage] = useState<LanguageId>('go')
  const [gomaxprocsLimit, setGomaxprocsLimit] = useState(settings.docker.resourceLimits.gomaxprocs)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  // TypeScript / pnpm state
  const [pnpmStorePath, setPnpmStorePath] = useState(settings.docker.pnpmStore?.path || '')
  const [detecting, setDetecting] = useState(false)
  const [detectedPath, setDetectedPath] = useState<string | null>(null)

  useEffect(() => {
    setGomaxprocsLimit(settings.docker.resourceLimits.gomaxprocs)
  }, [settings.docker.resourceLimits.gomaxprocs])

  useEffect(() => {
    setPnpmStorePath(settings.docker.pnpmStore?.path || '')
  }, [settings.docker.pnpmStore?.path])

  // Auto-detect pnpm store path on mount and pre-populate if no manual override
  useEffect(() => {
    if (!settings.docker.pnpmStore?.path) {
      window.electronAPI.detectPnpmStorePath().then((path) => {
        if (path) {
          setDetectedPath(path)
          setPnpmStorePath(path)
        }
      }).catch(() => {})
    }
  }, [])

  const handleSaveGomaxprocs = async () => {
    setSaving(true)
    try {
      await window.electronAPI.updateDockerResourceLimits({
        gomaxprocs: gomaxprocsLimit,
      })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save GOMAXPROCS:', error)
    } finally {
      setSaving(false)
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

  const handlePnpmStoreToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updateDockerPnpmStoreSettings({ enabled })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update pnpm store settings:', error)
    }
  }

  const handleDetectPnpmStorePath = async () => {
    setDetecting(true)
    try {
      const path = await window.electronAPI.detectPnpmStorePath()
      setDetectedPath(path)
      if (path) {
        setPnpmStorePath(path)
      }
    } catch (error) {
      console.error('Failed to detect pnpm store path:', error)
    } finally {
      setDetecting(false)
    }
  }

  const handleSavePnpmStorePath = async () => {
    setSaving(true)
    try {
      // Save null if empty (auto-detect) or the user-specified path
      const pathToSave = pnpmStorePath.trim() || null
      await window.electronAPI.updateDockerPnpmStoreSettings({ path: pathToSave })
      await onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to save pnpm store path:', error)
    } finally {
      setSaving(false)
    }
  }

  const languages = [
    { id: 'go' as LanguageId, name: 'Go', subtitle: 'golang', icon: golangIcon },
    { id: 'typescript' as LanguageId, name: 'TypeScript', subtitle: 'typescript', icon: typescriptIcon },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-1">Languages</h3>
        <p className="text-sm text-muted-foreground">
          Language-specific settings for headless agents
        </p>
      </div>

      <div className="flex border rounded-lg overflow-hidden" style={{ minHeight: '460px' }}>
        {/* Language list (left panel) */}
        <div className="w-52 flex-shrink-0 border-r bg-muted/20 overflow-y-auto">
          {languages.map((lang) => (
            <button
              key={lang.id}
              onClick={() => setSelectedLanguage(lang.id)}
              className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors ${
                selectedLanguage === lang.id
                  ? 'bg-primary/10 border-l-2 border-l-primary'
                  : 'hover:bg-muted/40 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <img src={lang.icon} alt={lang.name} className="w-5 h-5 flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">{lang.name}</div>
                  <div className="text-xs text-muted-foreground">{lang.subtitle}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Detail panel (right) */}
        <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-base">
                  {selectedLanguage === 'go' ? 'Go' : 'TypeScript'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {selectedLanguage === 'go'
                    ? 'Go language settings for headless agents'
                    : 'TypeScript / pnpm settings for headless agents'}
                </div>
              </div>
              {showSaved && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium">
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t" />

            {selectedLanguage === 'go' && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Headless Agent</h4>
                </div>

                {/* GOMAXPROCS */}
                <div className="space-y-2">
                  <Label htmlFor="gomaxprocs-limit">GOMAXPROCS</Label>
                  <div className="flex gap-2">
                    <Input
                      id="gomaxprocs-limit"
                      placeholder="e.g., 4"
                      value={gomaxprocsLimit}
                      onChange={(e) => setGomaxprocsLimit(e.target.value)}
                      className="max-w-[200px]"
                    />
                    <Button
                      onClick={handleSaveGomaxprocs}
                      disabled={saving || !gomaxprocsLimit}
                      size="sm"
                    >
                      <Save className="h-4 w-4 mr-1.5" />
                      {saving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Limits Go parallelism inside containers. Prevents OOM from too many concurrent test suites.
                  </p>
                </div>

                {/* Shared Build Cache */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="shared-build-cache-enabled">Shared Build Cache</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
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
            )}

            {selectedLanguage === 'typescript' && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Headless Agent</h4>
                </div>

                {/* Shared pnpm Store */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="pnpm-store-enabled">Shared pnpm Store</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Share your host pnpm content-addressable store with containers to avoid re-downloading packages
                      </p>
                    </div>
                    <Switch
                      id="pnpm-store-enabled"
                      checked={settings.docker.pnpmStore?.enabled ?? true}
                      onCheckedChange={handlePnpmStoreToggle}
                    />
                  </div>

                  {(settings.docker.pnpmStore?.enabled ?? true) && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="pnpm-store-path">Store Path</Label>
                        <div className="flex gap-2">
                          <Input
                            id="pnpm-store-path"
                            placeholder={detectedPath || 'Auto-detect via pnpm store path'}
                            value={pnpmStorePath}
                            onChange={(e) => setPnpmStorePath(e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            onClick={handleDetectPnpmStorePath}
                            disabled={detecting}
                            size="sm"
                            variant="outline"
                          >
                            <Search className="h-4 w-4 mr-1.5" />
                            {detecting ? 'Detecting...' : 'Detect'}
                          </Button>
                          <Button
                            onClick={handleSavePnpmStorePath}
                            disabled={saving}
                            size="sm"
                          >
                            <Save className="h-4 w-4 mr-1.5" />
                            {saving ? 'Saving...' : 'Save'}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Leave empty to auto-detect via <code className="bg-muted px-1 rounded">pnpm store path</code> at container start.
                          Override if pnpm is not in your PATH or you want a specific store.
                        </p>
                      </div>

                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          The host pnpm store is mounted into containers and set via <code className="bg-muted px-1 rounded">PNPM_STORE_DIR</code>.
                          pnpm's content-addressable store is safe for concurrent access.
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
