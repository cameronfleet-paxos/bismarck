import { useState, useEffect } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Button } from '@/renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/components/ui/select'
import type { AttentionMode, GridSize } from '@/shared/types'

interface GeneralSettingsProps {
  onPreferencesChange: (preferences: {
    attentionMode?: AttentionMode
    gridSize?: GridSize
    tutorialCompleted?: boolean
  }) => void
}

export function GeneralSettings({ onPreferencesChange }: GeneralSettingsProps) {
  const [attentionMode, setAttentionMode] = useState<AttentionMode>('focus')
  const [gridSize, setGridSize] = useState<GridSize>('2x2')
  const [tutorialCompleted, setTutorialCompleted] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [restarting, setRestarting] = useState(false)

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        setAttentionMode(prefs.attentionMode)
        setGridSize(prefs.gridSize || '2x2')
        setTutorialCompleted(prefs.tutorialCompleted || false)
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

  const handleRestartTutorial = async () => {
    setRestarting(true)
    try {
      const update = { tutorialCompleted: false }
      await window.electronAPI.setPreferences(update)
      setTutorialCompleted(false)
      onPreferencesChange(update)
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
      // Reload the page to restart the tutorial
      window.location.reload()
    } catch (error) {
      console.error('Failed to restart tutorial:', error)
    } finally {
      setRestarting(false)
    }
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
        {/* Attention Mode Dropdown */}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Attention Mode</Label>
            <p className="text-sm text-muted-foreground">
              How waiting agents are displayed
            </p>
          </div>
          <Select value={attentionMode} onValueChange={(v) => handleAttentionModeChange(v as AttentionMode)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="focus">Focus</SelectItem>
              <SelectItem value="expand">Expand</SelectItem>
              <SelectItem value="queue">Queue</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Grid Size Dropdown */}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Grid Size</Label>
            <p className="text-sm text-muted-foreground">
              Number of agents displayed per tab
            </p>
          </div>
          <Select value={gridSize} onValueChange={(v) => handleGridSizeChange(v as GridSize)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1x1">1×1 (1 agent)</SelectItem>
              <SelectItem value="2x2">2×2 (4 agents)</SelectItem>
              <SelectItem value="2x3">2×3 (6 agents)</SelectItem>
              <SelectItem value="3x3">3×3 (9 agents)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Restart Tutorial Button */}
        <div className="flex items-center justify-between py-2 border-t pt-4">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Tutorial</Label>
            <p className="text-sm text-muted-foreground">
              {tutorialCompleted ? 'Restart the tutorial walkthrough' : 'Tutorial not yet completed'}
            </p>
          </div>
          <Button
            onClick={handleRestartTutorial}
            disabled={restarting}
            variant="outline"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {restarting ? 'Restarting...' : 'Restart Tutorial'}
          </Button>
        </div>
      </div>
    </div>
  )
}
