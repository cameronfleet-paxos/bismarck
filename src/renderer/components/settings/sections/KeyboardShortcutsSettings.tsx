import { useState, useEffect, useCallback } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Button } from '@/renderer/components/ui/button'
import { Switch } from '@/renderer/components/ui/switch'
import type { KeyboardShortcut, KeyboardShortcuts, PrefixChordConfig } from '@/shared/types'

interface KeyboardShortcutsSettingsProps {
  onPreferencesChange: (preferences: { keyboardShortcuts?: KeyboardShortcuts; prefixChords?: PrefixChordConfig }) => void
}

// Default prefix chord config
function getDefaultPrefixChordConfig(): PrefixChordConfig {
  return {
    enabled: true,
    prefixKey: { key: 'b', modifiers: { meta: true, shift: false, alt: false } },
    timeoutMs: 500,
    chords: {
      nextTab: 'n',
      previousTab: 'p',
      cycleFocus: 'o',
    },
  }
}

// Format a keyboard shortcut for display
function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = []
  if (shortcut.modifiers.meta) {
    parts.push(navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl')
  }
  if (shortcut.modifiers.alt) {
    parts.push('Alt')
  }
  if (shortcut.modifiers.shift) {
    parts.push('Shift')
  }
  parts.push(shortcut.key.toUpperCase())
  return parts.join(' + ')
}

// Get default keyboard shortcuts
function getDefaultKeyboardShortcuts(): KeyboardShortcuts {
  return {
    commandPalette: { key: 'k', modifiers: { meta: true, shift: false, alt: false } },
    dismissAgent: { key: 'n', modifiers: { meta: true, shift: false, alt: false } },
    devConsole: { key: 'd', modifiers: { meta: true, shift: true, alt: false } },
    toggleAgentSidebar: { key: 'b', modifiers: { meta: true, shift: false, alt: false } },
    togglePlansSidebar: { key: 'p', modifiers: { meta: true, shift: true, alt: false } },
    nextTab: { key: ']', modifiers: { meta: true, shift: true, alt: false } },
    previousTab: { key: '[', modifiers: { meta: true, shift: true, alt: false } },
    newTab: { key: 't', modifiers: { meta: true, shift: false, alt: false } },
    closeTab: { key: 'w', modifiers: { meta: true, shift: false, alt: false } },
    toggleMaximizeAgent: { key: 'm', modifiers: { meta: true, shift: true, alt: false } },
    closeAgent: { key: 'w', modifiers: { meta: true, shift: true, alt: false } },
    startHeadlessSonnet: { key: 'j', modifiers: { meta: true, shift: false, alt: false } },
    startHeadlessOpus: { key: 'j', modifiers: { meta: true, shift: true, alt: false } },
  }
}

interface ShortcutEditorProps {
  label: string
  description: string
  shortcut: KeyboardShortcut
  onChange: (shortcut: KeyboardShortcut) => void
}

function ShortcutEditor({ label, description, shortcut, onChange }: ShortcutEditorProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [tempShortcut, setTempShortcut] = useState<KeyboardShortcut | null>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isRecording) return

    e.preventDefault()
    e.stopPropagation()

    // Ignore modifier-only keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
      return
    }

    // Ignore Escape - use it to cancel recording
    if (e.key === 'Escape') {
      setIsRecording(false)
      setTempShortcut(null)
      return
    }

    const newShortcut: KeyboardShortcut = {
      key: e.key.toLowerCase(),
      modifiers: {
        meta: e.metaKey || e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      },
    }

    setTempShortcut(newShortcut)
    setIsRecording(false)
    onChange(newShortcut)
  }, [isRecording, onChange])

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isRecording, handleKeyDown])

  const displayShortcut = tempShortcut || shortcut

  return (
    <div className="flex items-center justify-between py-3">
      <div className="space-y-0.5">
        <Label className="text-base font-medium">{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => setIsRecording(true)}
        className={`
          px-3 py-1.5 rounded-md font-mono text-sm min-w-[140px] text-center
          ${isRecording
            ? 'bg-primary text-primary-foreground animate-pulse'
            : 'bg-muted hover:bg-muted/80 border border-border'
          }
        `}
      >
        {isRecording ? 'Press keys...' : formatShortcut(displayShortcut)}
      </button>
    </div>
  )
}

export function KeyboardShortcutsSettings({ onPreferencesChange }: KeyboardShortcutsSettingsProps) {
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(getDefaultKeyboardShortcuts())
  const [prefixChords, setPrefixChords] = useState<PrefixChordConfig>(getDefaultPrefixChordConfig())
  const [showSaved, setShowSaved] = useState(false)

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        if (prefs.keyboardShortcuts) {
          setShortcuts({ ...getDefaultKeyboardShortcuts(), ...prefs.keyboardShortcuts })
        }
        if (prefs.prefixChords) {
          setPrefixChords({ ...getDefaultPrefixChordConfig(), ...prefs.prefixChords })
        }
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    loadPreferences()
  }, [])

  const handleShortcutChange = (key: keyof KeyboardShortcuts, newShortcut: KeyboardShortcut) => {
    const newShortcuts = { ...shortcuts, [key]: newShortcut }
    setShortcuts(newShortcuts)
    const update = { keyboardShortcuts: newShortcuts }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    showSavedIndicator()
  }

  const handlePrefixChordChange = (updates: Partial<PrefixChordConfig>) => {
    const newConfig = { ...prefixChords, ...updates }
    setPrefixChords(newConfig)
    const update = { prefixChords: newConfig }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    showSavedIndicator()
  }

  const handleResetAll = () => {
    const defaults = getDefaultKeyboardShortcuts()
    const defaultChords = getDefaultPrefixChordConfig()
    setShortcuts(defaults)
    setPrefixChords(defaultChords)
    const update = { keyboardShortcuts: defaults, prefixChords: defaultChords }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    showSavedIndicator()
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-medium">Keyboard Shortcuts</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Customize keyboard shortcuts. Click on a shortcut to change it.
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground pt-2">General</h4>
        <ShortcutEditor
          label="Command Palette"
          description="Open the command search dialog"
          shortcut={shortcuts.commandPalette}
          onChange={(s) => handleShortcutChange('commandPalette', s)}
        />

        <ShortcutEditor
          label="Dismiss Agent"
          description="Dismiss current waiting agent and go to next"
          shortcut={shortcuts.dismissAgent}
          onChange={(s) => handleShortcutChange('dismissAgent', s)}
        />

        {shortcuts.devConsole && (
          <ShortcutEditor
            label="Dev Console"
            description="Toggle developer console (development only)"
            shortcut={shortcuts.devConsole}
            onChange={(s) => handleShortcutChange('devConsole', s)}
          />
        )}

        <h4 className="text-sm font-medium text-muted-foreground pt-4">Sidebars</h4>
        {shortcuts.toggleAgentSidebar && (
          <ShortcutEditor
            label="Toggle Agent Sidebar"
            description="Show or hide the agent sidebar"
            shortcut={shortcuts.toggleAgentSidebar}
            onChange={(s) => handleShortcutChange('toggleAgentSidebar', s)}
          />
        )}

        {shortcuts.togglePlansSidebar && (
          <ShortcutEditor
            label="Toggle Teams Sidebar"
            description="Show or hide the teams sidebar (Team mode)"
            shortcut={shortcuts.togglePlansSidebar}
            onChange={(s) => handleShortcutChange('togglePlansSidebar', s)}
          />
        )}

        <h4 className="text-sm font-medium text-muted-foreground pt-4">Tabs</h4>
        {shortcuts.newTab && (
          <ShortcutEditor
            label="New Tab"
            description="Create a new tab"
            shortcut={shortcuts.newTab}
            onChange={(s) => handleShortcutChange('newTab', s)}
          />
        )}

        {shortcuts.closeTab && (
          <ShortcutEditor
            label="Close Tab"
            description="Close the current tab"
            shortcut={shortcuts.closeTab}
            onChange={(s) => handleShortcutChange('closeTab', s)}
          />
        )}

        {shortcuts.nextTab && (
          <ShortcutEditor
            label="Next Tab"
            description="Switch to the next tab"
            shortcut={shortcuts.nextTab}
            onChange={(s) => handleShortcutChange('nextTab', s)}
          />
        )}

        {shortcuts.previousTab && (
          <ShortcutEditor
            label="Previous Tab"
            description="Switch to the previous tab"
            shortcut={shortcuts.previousTab}
            onChange={(s) => handleShortcutChange('previousTab', s)}
          />
        )}

        <h4 className="text-sm font-medium text-muted-foreground pt-4">Agents</h4>
        {shortcuts.toggleMaximizeAgent && (
          <ShortcutEditor
            label="Toggle Maximize Agent"
            description="Maximize or restore the focused agent"
            shortcut={shortcuts.toggleMaximizeAgent}
            onChange={(s) => handleShortcutChange('toggleMaximizeAgent', s)}
          />
        )}

        {shortcuts.closeAgent && (
          <ShortcutEditor
            label="Close Agent"
            description="Stop the focused agent"
            shortcut={shortcuts.closeAgent}
            onChange={(s) => handleShortcutChange('closeAgent', s)}
          />
        )}

        <h4 className="text-sm font-medium text-muted-foreground pt-4">Headless Agents</h4>
        {shortcuts.startHeadlessSonnet && (
          <ShortcutEditor
            label="Start Headless (Sonnet)"
            description="Quick-launch a Sonnet headless agent"
            shortcut={shortcuts.startHeadlessSonnet}
            onChange={(s) => handleShortcutChange('startHeadlessSonnet', s)}
          />
        )}

        {shortcuts.startHeadlessOpus && (
          <ShortcutEditor
            label="Start Headless (Opus)"
            description="Quick-launch an Opus headless agent"
            shortcut={shortcuts.startHeadlessOpus}
            onChange={(s) => handleShortcutChange('startHeadlessOpus', s)}
          />
        )}

        <h4 className="text-sm font-medium text-muted-foreground pt-4">Prefix Chords</h4>
        <div className="flex items-center justify-between py-3">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Enable Prefix Chords</Label>
            <p className="text-sm text-muted-foreground">
              Tmux-style navigation: press prefix key, then a chord key
            </p>
          </div>
          <Switch
            checked={prefixChords.enabled}
            onCheckedChange={(checked) => handlePrefixChordChange({ enabled: checked })}
          />
        </div>

        {prefixChords.enabled && (
          <>
            <ShortcutEditor
              label="Prefix Key"
              description="Press this key to enter prefix mode"
              shortcut={prefixChords.prefixKey}
              onChange={(s) => handlePrefixChordChange({ prefixKey: s })}
            />

            <div className="flex items-center justify-between py-3">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Timeout</Label>
                <p className="text-sm text-muted-foreground">
                  Time to wait for chord key ({prefixChords.timeoutMs}ms)
                </p>
              </div>
              <div className="w-[180px]">
                <input
                  type="range"
                  value={prefixChords.timeoutMs}
                  onChange={(e) => handlePrefixChordChange({ timeoutMs: parseInt(e.target.value, 10) })}
                  min={200}
                  max={2000}
                  step={50}
                  className="w-full accent-primary"
                />
              </div>
            </div>

            <div className="space-y-2 py-3">
              <Label className="text-base font-medium">Chord Mappings</Label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                  <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border text-xs">{prefixChords.chords.nextTab}</kbd>
                  <span className="text-muted-foreground">Next Tab</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                  <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border text-xs">{prefixChords.chords.previousTab}</kbd>
                  <span className="text-muted-foreground">Previous Tab</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                  <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border text-xs">{prefixChords.chords.cycleFocus}</kbd>
                  <span className="text-muted-foreground">Cycle Focus</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                  <kbd className="font-mono bg-background px-1.5 py-0.5 rounded border text-xs">1-9</kbd>
                  <span className="text-muted-foreground">Jump to Tab #</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="pt-4 border-t">
        <Button onClick={handleResetAll} variant="outline">
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to Defaults
        </Button>
      </div>
    </div>
  )
}
