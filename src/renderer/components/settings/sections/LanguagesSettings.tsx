import { useState, useEffect } from 'react'
import { Save, Check } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import golangIcon from '@/renderer/assets/icons/golang.svg'
interface LanguagesSettingsProps {
  settings: {
    docker: {
      resourceLimits: {
        gomaxprocs: string
      }
      sharedBuildCache?: {
        enabled: boolean
      }
    }
  }
  onSettingsChange: () => void
}

export function LanguagesSettings({ settings, onSettingsChange }: LanguagesSettingsProps) {
  const [gomaxprocsLimit, setGomaxprocsLimit] = useState(settings.docker.resourceLimits.gomaxprocs)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    setGomaxprocsLimit(settings.docker.resourceLimits.gomaxprocs)
  }, [settings.docker.resourceLimits.gomaxprocs])

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
          <button
            className="w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors bg-primary/10 border-l-2 border-l-primary"
          >
            <div className="flex items-center gap-2">
              <img src={golangIcon} alt="Go" className="w-5 h-5 flex-shrink-0" />
              <div>
                <div className="font-medium text-sm">Go</div>
                <div className="text-xs text-muted-foreground">golang</div>
              </div>
            </div>
          </button>
        </div>

        {/* Detail panel (right) */}
        <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: 'none' }}>
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-base">Go</div>
                <div className="text-xs text-muted-foreground mt-0.5">Go language settings for headless agents</div>
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

            {/* Headless Agent section */}
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
          </div>
        </div>
      </div>
    </div>
  )
}
