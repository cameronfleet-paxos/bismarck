import { useState, useEffect } from 'react'
import { Check, RotateCcw, AlertTriangle, FolderOpen } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Button } from '@/renderer/components/ui/button'
import { Switch } from '@/renderer/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/components/ui/select'
import { getGridConfig } from '@/shared/grid-utils'
import type { AttentionMode, GridSize, AgentTab } from '@/shared/types'

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

  // Debug logging state
  const [debugEnabled, setDebugEnabled] = useState(true)
  const [debugLogPath, setDebugLogPath] = useState('')

  // Prevent sleep state
  const [preventSleepEnabled, setPreventSleepEnabled] = useState(true)

  // Diff view state
  const [showDiffView, setShowDiffView] = useState(true)

  // Grid size reduction confirmation state
  const [gridSizeConfirm, setGridSizeConfirm] = useState<{
    pendingSize: GridSize
    affectedAgents: number
    affectedTabs: number
  } | null>(null)

  // Load preferences and debug settings on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        setAttentionMode(prefs.attentionMode)
        setGridSize(prefs.gridSize || '2x2')
        setTutorialCompleted(prefs.tutorialCompleted || false)
        setShowDiffView(prefs.showDiffView !== false)
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    const loadDebugSettings = async () => {
      try {
        const settings = await window.electronAPI.getDebugSettings()
        setDebugEnabled(settings.enabled)
        setDebugLogPath(settings.logPath)
      } catch (error) {
        console.error('Failed to load debug settings:', error)
      }
    }

    const loadPreventSleepSettings = async () => {
      try {
        const settings = await window.electronAPI.getPreventSleepSettings()
        setPreventSleepEnabled(settings.enabled)
      } catch (error) {
        console.error('Failed to load prevent sleep settings:', error)
      }
    }

    loadPreferences()
    loadDebugSettings()
    loadPreventSleepSettings()
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

  const handleGridSizeChange = async (size: GridSize) => {
    const currentMax = getGridConfig(gridSize).maxAgents
    const newMax = getGridConfig(size).maxAgents

    // If reducing grid size, check for affected agents
    if (newMax < currentMax) {
      try {
        const tabs = await window.electronAPI.getTabs()
        // Only count non-plan tabs (plan tabs can have unlimited agents)
        const nonPlanTabs = tabs.filter((tab: AgentTab) => !tab.isPlanTab)
        let affectedAgents = 0
        let affectedTabs = 0

        for (const tab of nonPlanTabs) {
          const excess = tab.workspaceIds.length - newMax
          if (excess > 0) {
            affectedAgents += excess
            affectedTabs++
          }
        }

        if (affectedAgents > 0) {
          // Show confirmation dialog
          setGridSizeConfirm({
            pendingSize: size,
            affectedAgents,
            affectedTabs,
          })
          return
        }
      } catch (error) {
        console.error('Failed to check affected agents:', error)
      }
    }

    // No confirmation needed, apply directly
    applyGridSize(size)
  }

  const applyGridSize = (size: GridSize) => {
    setGridSize(size)
    const update = { gridSize: size }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    // Show saved indicator
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const confirmGridSizeChange = () => {
    if (gridSizeConfirm) {
      applyGridSize(gridSizeConfirm.pendingSize)
      setGridSizeConfirm(null)
    }
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

  const handleShowDiffViewChange = async (enabled: boolean) => {
    setShowDiffView(enabled)
    try {
      await window.electronAPI.setPreferences({ showDiffView: enabled })
      onPreferencesChange({})
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update diff view setting:', error)
    }
  }

  const handlePreventSleepChange = async (enabled: boolean) => {
    setPreventSleepEnabled(enabled)
    try {
      await window.electronAPI.updatePreventSleepSettings({ enabled })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update prevent sleep settings:', error)
      setPreventSleepEnabled(!enabled)
    }
  }

  const handleDebugEnabledChange = async (enabled: boolean) => {
    setDebugEnabled(enabled)
    try {
      await window.electronAPI.updateDebugSettings({ enabled })
      // Show saved indicator
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
    } catch (error) {
      console.error('Failed to update debug settings:', error)
      // Revert on error
      setDebugEnabled(!enabled)
    }
  }

  const handleOpenLogFolder = () => {
    // Get the directory containing the log file
    const logDir = debugLogPath.substring(0, debugLogPath.lastIndexOf('/'))
    window.electronAPI.openExternal(`file://${logDir}`)
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

        {/* Prevent Sleep Toggle */}
        <div className="flex items-center justify-between py-2 border-t pt-4">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Prevent Sleep</Label>
            <p className="text-sm text-muted-foreground">
              Keep your Mac awake while agents are running
            </p>
          </div>
          <Switch
            checked={preventSleepEnabled}
            onCheckedChange={handlePreventSleepChange}
          />
        </div>

        {/* Diff View Toggle */}
        <div className="flex items-center justify-between py-2 border-t pt-4">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Diff View</Label>
            <p className="text-sm text-muted-foreground">
              Show diff buttons and file change badges on agent headers
            </p>
          </div>
          <Switch
            checked={showDiffView}
            onCheckedChange={handleShowDiffViewChange}
          />
        </div>

        {/* Debug Logging Toggle */}
        <div className="flex items-center justify-between py-2 border-t pt-4">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Debug Logging</Label>
            <p className="text-sm text-muted-foreground">
              Write debug information to log files for troubleshooting
            </p>
          </div>
          <Switch
            checked={debugEnabled}
            onCheckedChange={handleDebugEnabledChange}
          />
        </div>

        {/* Log File Location */}
        {debugEnabled && debugLogPath && (
          <div className="flex items-center justify-between py-2 pl-4">
            <div className="space-y-0.5">
              <Label className="text-sm text-muted-foreground">Log file location</Label>
              <p className="text-xs font-mono text-muted-foreground/70 break-all">
                {debugLogPath}
              </p>
            </div>
            <Button
              onClick={handleOpenLogFolder}
              variant="ghost"
              size="sm"
              title="Open log folder"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Grid Size Reduction Confirmation Dialog */}
      <Dialog
        open={gridSizeConfirm !== null}
        onOpenChange={(open) => !open && setGridSizeConfirm(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Reduce Grid Size?
            </DialogTitle>
            <DialogDescription className="text-left">
              {gridSizeConfirm && (
                <>
                  Changing from {gridSize} to {gridSizeConfirm.pendingSize} will affect{' '}
                  <strong>{gridSizeConfirm.affectedAgents} agent{gridSizeConfirm.affectedAgents !== 1 ? 's' : ''}</strong>{' '}
                  across{' '}
                  <strong>{gridSizeConfirm.affectedTabs} tab{gridSizeConfirm.affectedTabs !== 1 ? 's' : ''}</strong>.
                  <br /><br />
                  Only the first {getGridConfig(gridSizeConfirm.pendingSize).maxAgents} agent{getGridConfig(gridSizeConfirm.pendingSize).maxAgents !== 1 ? 's' : ''} per tab will be kept visible.
                  Excess agents will be stopped.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGridSizeConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmGridSizeChange}>
              Confirm & Stop Agents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
