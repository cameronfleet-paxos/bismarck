import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import type { AttentionMode, GridSize } from '@/shared/types'

interface GeneralSettingsProps {
  onPreferencesChange: (preferences: {
    attentionMode?: AttentionMode
    gridSize?: GridSize
  }) => void
}

export function GeneralSettings({ onPreferencesChange }: GeneralSettingsProps) {
  const [attentionMode, setAttentionMode] = useState<AttentionMode>('focus')
  const [gridSize, setGridSize] = useState<GridSize>('2x2')
  const [showSaved, setShowSaved] = useState(false)

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        setAttentionMode(prefs.attentionMode)
        setGridSize(prefs.gridSize || '2x2')
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    loadPreferences()
  }, [])

  const handleAttentionModeChange = (mode: AttentionMode) => {
    setAttentionMode(mode)
    const update = { attentionMode: mode }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    // Show saved indicator
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handleGridSizeChange = (size: GridSize) => {
    setGridSize(size)
    const update = { gridSize: size }
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
          <h3 className="text-lg font-medium">General Settings</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Configure display and attention preferences
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3">
          <Label className="text-base font-medium">Attention Mode</Label>
          <p className="text-sm text-muted-foreground">
            How waiting agents are displayed
          </p>
          <div className="grid gap-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="attentionMode"
                value="off"
                checked={attentionMode === 'off'}
                onChange={() => handleAttentionModeChange('off')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Off</div>
                <div className="text-sm text-muted-foreground">
                  No visual indicators for waiting agents
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="attentionMode"
                value="focus"
                checked={attentionMode === 'focus'}
                onChange={() => handleAttentionModeChange('focus')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Focus</div>
                <div className="text-sm text-muted-foreground">
                  Waiting agents are highlighted but stay in their grid position
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="attentionMode"
                value="expand"
                checked={attentionMode === 'expand'}
                onChange={() => handleAttentionModeChange('expand')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Expand</div>
                <div className="text-sm text-muted-foreground">
                  Waiting agents expand to take up more screen space
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="attentionMode"
                value="queue"
                checked={attentionMode === 'queue'}
                onChange={() => handleAttentionModeChange('queue')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">Queue</div>
                <div className="text-sm text-muted-foreground">
                  Shows a horizontal toast with agent icons at the bottom
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="grid gap-3">
          <Label className="text-base font-medium">Grid Size</Label>
          <p className="text-sm text-muted-foreground">
            Number of agents displayed per tab
          </p>
          <div className="grid gap-2">
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="gridSize"
                value="1x1"
                checked={gridSize === '1x1'}
                onChange={() => handleGridSizeChange('1x1')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">1x1</div>
                <div className="text-sm text-muted-foreground">
                  Single agent per tab (1 agent)
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="gridSize"
                value="2x2"
                checked={gridSize === '2x2'}
                onChange={() => handleGridSizeChange('2x2')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">2x2</div>
                <div className="text-sm text-muted-foreground">
                  Four agents in a 2x2 grid (4 agents)
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="gridSize"
                value="2x3"
                checked={gridSize === '2x3'}
                onChange={() => handleGridSizeChange('2x3')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">2x3</div>
                <div className="text-sm text-muted-foreground">
                  Six agents in a 2x3 grid (6 agents)
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="gridSize"
                value="3x3"
                checked={gridSize === '3x3'}
                onChange={() => handleGridSizeChange('3x3')}
                className="mt-1"
              />
              <div>
                <div className="font-medium">3x3</div>
                <div className="text-sm text-muted-foreground">
                  Nine agents in a 3x3 grid (9 agents)
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
