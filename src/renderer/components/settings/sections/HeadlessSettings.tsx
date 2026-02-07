import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'

export function HeadlessSettings() {
  const [showSaved, setShowSaved] = useState(false)
  const [planPhaseEnabled, setPlanPhaseEnabled] = useState(true)
  const [planPhaseTimeout, setPlanPhaseTimeout] = useState(120)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI.getSettings()
        setPlanPhaseEnabled(settings.planPhase?.enabled ?? true)
        setPlanPhaseTimeout(Math.round((settings.planPhase?.timeoutMs ?? 120000) / 1000))
      } catch (error) {
        console.error('Failed to load headless settings:', error)
      }
    }
    loadSettings()
  }, [])

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handlePlanPhaseEnabledChange = async (enabled: boolean) => {
    setPlanPhaseEnabled(enabled)
    try {
      const settings = await window.electronAPI.getSettings()
      await window.electronAPI.setRawSettings({
        ...settings,
        planPhase: { ...settings.planPhase, enabled },
      })
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save plan phase settings:', error)
    }
  }

  const handlePlanPhaseTimeoutChange = async (value: number) => {
    if (isNaN(value) || value < 30 || value > 600) return
    setPlanPhaseTimeout(value)
    try {
      const settings = await window.electronAPI.getSettings()
      await window.electronAPI.setRawSettings({
        ...settings,
        planPhase: { ...settings.planPhase, timeoutMs: value * 1000 },
      })
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save plan phase settings:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Saved indicator */}
      {showSaved && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200 w-fit">
          <Check className="h-3.5 w-3.5" />
          Saved
        </div>
      )}

      {/* Plan Phase Section */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Plan Phase</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Run a read-only planning step before headless agent execution
        </p>

        <div className="space-y-4">
          {/* Plan Phase Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Enabled</Label>
              <p className="text-sm text-muted-foreground">
                Analyze the codebase and create an implementation plan before executing
              </p>
            </div>
            <Switch
              checked={planPhaseEnabled}
              onCheckedChange={handlePlanPhaseEnabledChange}
            />
          </div>

          {/* Plan Phase Timeout */}
          {planPhaseEnabled && (
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Timeout</Label>
                <p className="text-sm text-muted-foreground">
                  Timeout in seconds (30-600)
                </p>
              </div>
              <input
                type="number"
                min={30}
                max={600}
                value={planPhaseTimeout}
                onChange={(e) => handlePlanPhaseTimeoutChange(parseInt(e.target.value, 10))}
                className="w-[70px] text-sm border rounded px-2 py-1.5 bg-background text-center"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
