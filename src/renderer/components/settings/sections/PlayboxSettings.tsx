import { useState, useEffect } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'

interface PlayboxSettingsProps {
  onSettingsChange: () => void
}

export function PlayboxSettings({ onSettingsChange }: PlayboxSettingsProps) {
  const [bismarckMode, setBismarckMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const playbox = await window.electronAPI.getPlayboxSettings()
        setBismarckMode(playbox.bismarckMode)
      } catch (error) {
        console.error('Failed to load playbox settings:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const handleBismarckModeToggle = async (enabled: boolean) => {
    try {
      await window.electronAPI.updatePlayboxSettings({ bismarckMode: enabled })
      setBismarckMode(enabled)
      onSettingsChange()
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update Bismarck mode:', error)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground">Loading settings...</div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Sparkles className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-medium">Playbox</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Experimental and fun features
        </p>
      </div>

      <div className="space-y-4">
        {/* Bismarck Mode Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Bismarck Mode</Label>
            <p className="text-sm text-muted-foreground">
              Makes headless agents speak like a satirical German military officer
            </p>
          </div>
          <Switch
            checked={bismarckMode}
            onCheckedChange={handleBismarckModeToggle}
          />
        </div>

        {/* Info box */}
        {bismarckMode && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              Jawohl! Bismarck Mode aktiviert!
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Headless agents will now channel the spirit of Otto von Bismarck, the Iron Chancellor.
              Expect phrases like "Vorwärts!", "Wunderbar!", and references to "der Feind" (bugs).
              Code quality remains Prussian-grade precise.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
