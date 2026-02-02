import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import type { OperatingMode, AgentModel } from '@/shared/types'

interface PlansSettingsProps {
  onPreferencesChange: (preferences: {
    operatingMode?: OperatingMode
    agentModel?: AgentModel
  }) => void
}

export function PlansSettings({ onPreferencesChange }: PlansSettingsProps) {
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('solo')
  const [agentModel, setAgentModel] = useState<AgentModel>('sonnet')
  const [showSaved, setShowSaved] = useState(false)

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        setOperatingMode(prefs.operatingMode)
        setAgentModel(prefs.agentModel)
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    loadPreferences()
  }, [])

  const handleOperatingModeChange = (mode: OperatingMode) => {
    setOperatingMode(mode)
    const update = { operatingMode: mode }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    // Show saved indicator
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handleAgentModelChange = (model: AgentModel) => {
    setAgentModel(model)
    const update = { agentModel: model }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    // Show saved indicator
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-medium">Plans Settings</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Configure how plan execution and agents work together
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3">
          <Label className="text-base font-medium">Operating Mode</Label>
          <p className="text-sm text-muted-foreground">
            How agents work together
          </p>
          <div className="grid gap-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="operatingMode"
                value="solo"
                checked={operatingMode === 'solo'}
                onChange={() => handleOperatingModeChange('solo')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Solo</div>
                <div className="text-sm text-muted-foreground">
                  Independent agent workspaces
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="operatingMode"
                value="team"
                checked={operatingMode === 'team'}
                onChange={() => handleOperatingModeChange('team')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Team</div>
                <div className="text-sm text-muted-foreground">
                  Coordinated via bd with plan sidebar
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="grid gap-3">
          <Label className="text-base font-medium">Agent Model</Label>
          <p className="text-sm text-muted-foreground">
            Model used for headless task agents in plan execution
          </p>
          <div className="grid gap-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="agentModel"
                value="sonnet"
                checked={agentModel === 'sonnet'}
                onChange={() => handleAgentModelChange('sonnet')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Sonnet</div>
                <div className="text-sm text-muted-foreground">
                  Best balance of speed, cost, and capability
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="agentModel"
                value="opus"
                checked={agentModel === 'opus'}
                onChange={() => handleAgentModelChange('opus')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Opus</div>
                <div className="text-sm text-muted-foreground">
                  Most capable model, higher cost
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="agentModel"
                value="haiku"
                checked={agentModel === 'haiku'}
                onChange={() => handleAgentModelChange('haiku')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Haiku</div>
                <div className="text-sm text-muted-foreground">
                  Fastest and most affordable, good for simpler tasks
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
