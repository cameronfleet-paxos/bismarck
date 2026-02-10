import { useState, useEffect } from 'react'
import { Check, Sparkles, Dog, User, Pencil, Save, Trash2, BookOpen } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Textarea } from '@/renderer/components/ui/textarea'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'

type PersonaMode = 'none' | 'bismarck' | 'otto' | 'custom'

interface PersonaPreset {
  id: string
  name: string
  prompt: string
}

interface PlayboxSettingsProps {
  onSettingsChange: () => void
}

export function PlayboxSettings({ onSettingsChange }: PlayboxSettingsProps) {
  const [personaMode, setPersonaMode] = useState<PersonaMode>('none')
  const [customPersonaPrompt, setCustomPersonaPrompt] = useState<string>('')
  const [personaPresets, setPersonaPresets] = useState<PersonaPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [showSaved, setShowSaved] = useState(false)

  // Save preset dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [savePresetName, setSavePresetName] = useState('')
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const playbox = await window.electronAPI.getPlayboxSettings()
        setPersonaMode(playbox.personaMode)
        setCustomPersonaPrompt(playbox.customPersonaPrompt || '')
        setPersonaPresets(playbox.personaPresets || [])
      } catch (error) {
        console.error('Failed to load playbox settings:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSettings()
  }, [])

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handlePersonaModeChange = async (mode: PersonaMode) => {
    try {
      await window.electronAPI.updatePlayboxSettings({ personaMode: mode })
      setPersonaMode(mode)
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to update persona mode:', error)
    }
  }

  const handleCustomPromptSave = async () => {
    try {
      await window.electronAPI.updatePlayboxSettings({ customPersonaPrompt })
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save custom persona prompt:', error)
    }
  }

  const handleSavePreset = async () => {
    if (!savePresetName.trim() || !customPersonaPrompt.trim()) return
    try {
      if (editingPresetId) {
        const updated = await window.electronAPI.updatePersonaPreset(editingPresetId, {
          name: savePresetName.trim(),
          prompt: customPersonaPrompt,
        })
        if (updated) {
          setPersonaPresets(prev => prev.map(p => p.id === editingPresetId ? updated : p))
        }
      } else {
        const newPreset = await window.electronAPI.addPersonaPreset({
          name: savePresetName.trim(),
          prompt: customPersonaPrompt,
        })
        setPersonaPresets(prev => [...prev, newPreset])
      }
      onSettingsChange()
      showSavedIndicator()
      setShowSaveDialog(false)
      setSavePresetName('')
      setEditingPresetId(null)
    } catch (error) {
      console.error('Failed to save persona preset:', error)
    }
  }

  const handleLoadPreset = async (preset: PersonaPreset) => {
    setCustomPersonaPrompt(preset.prompt)
    try {
      await window.electronAPI.updatePlayboxSettings({
        personaMode: 'custom',
        customPersonaPrompt: preset.prompt,
      })
      setPersonaMode('custom')
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to load persona preset:', error)
    }
  }

  const handleEditPreset = (preset: PersonaPreset) => {
    setEditingPresetId(preset.id)
    setSavePresetName(preset.name)
    // Load the preset prompt into the editor
    setCustomPersonaPrompt(preset.prompt)
    setShowSaveDialog(true)
  }

  const handleDeletePreset = async (id: string) => {
    try {
      await window.electronAPI.deletePersonaPreset(id)
      setPersonaPresets(prev => prev.filter(p => p.id !== id))
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to delete persona preset:', error)
    }
  }

  const openSaveDialog = () => {
    setEditingPresetId(null)
    setSavePresetName('')
    setShowSaveDialog(true)
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
        {/* Persona Mode Section */}
        <div className="space-y-3">
          <Label className="text-base font-medium">Persona Mode</Label>
          <p className="text-sm text-muted-foreground">
            Add personality to your interactive Claude Code sessions. Personas are only applied to interactive agents, not headless agents.
          </p>

          {/* Radio Options */}
          <div className="space-y-2 mt-3">
            {/* None Option */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="personaMode"
                value="none"
                checked={personaMode === 'none'}
                onChange={() => handlePersonaModeChange('none')}
                className="h-4 w-4 text-primary"
              />
              <div className="flex items-center gap-2 flex-1">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="font-medium">None</div>
                  <div className="text-xs text-muted-foreground">Standard Claude behavior</div>
                </div>
              </div>
            </label>

            {/* Bismarck Option */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="personaMode"
                value="bismarck"
                checked={personaMode === 'bismarck'}
                onChange={() => handlePersonaModeChange('bismarck')}
                className="h-4 w-4 text-primary"
              />
              <div className="flex items-center gap-2 flex-1">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <div>
                  <div className="font-medium">Bismarck Mode</div>
                  <div className="text-xs text-muted-foreground">Satirical German military officer</div>
                </div>
              </div>
            </label>

            {/* Otto Option */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="personaMode"
                value="otto"
                checked={personaMode === 'otto'}
                onChange={() => handlePersonaModeChange('otto')}
                className="h-4 w-4 text-primary"
              />
              <div className="flex items-center gap-2 flex-1">
                <Dog className="h-4 w-4 text-amber-700 dark:text-amber-600" />
                <div>
                  <div className="font-medium">Otto Mode</div>
                  <div className="text-xs text-muted-foreground">Fluffy Bernedoodle dog</div>
                </div>
              </div>
            </label>

            {/* Custom Option */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="radio"
                name="personaMode"
                value="custom"
                checked={personaMode === 'custom'}
                onChange={() => handlePersonaModeChange('custom')}
                className="h-4 w-4 text-primary"
              />
              <div className="flex items-center gap-2 flex-1">
                <Pencil className="h-4 w-4 text-blue-500" />
                <div>
                  <div className="font-medium">Custom</div>
                  <div className="text-xs text-muted-foreground">Define your own persona</div>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Bismarck Info box */}
        {personaMode === 'bismarck' && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              Jawohl! Bismarck Mode aktiviert!
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Interactive agents will now channel the spirit of Otto von Bismarck, the Iron Chancellor.
              Expect phrases like "Vorwarts!", "Wunderbar!", and references to "der Feind" (bugs).
              Code quality remains Prussian-grade precise.
            </p>
          </div>
        )}

        {/* Otto Info box */}
        {personaMode === 'otto' && (
          <div className="p-3 bg-amber-700/10 border border-amber-700/20 rounded-md">
            <p className="text-sm text-amber-700 dark:text-amber-500 font-medium">
              Woof! Otto Mode aktivated! *tail wags*
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Interactive agents will now channel the spirit of Otto von Cornwall, a fluffy Bernedoodle.
              Expect phrases like "Henlo!", "squirrel!", "is treat time?", and "belly rubs plz".
              Code quality remains top notch. Otto professional. Otto just... also want belly rubs.
            </p>
          </div>
        )}

        {/* Custom Persona Editor */}
        {personaMode === 'custom' && (
          <div className="space-y-3">
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                Custom persona active
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Define your own persona prompt below. This will be injected into every interactive Claude session.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="customPrompt">Custom Persona Prompt</Label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openSaveDialog}
                  disabled={!customPersonaPrompt.trim()}
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save as Preset
                </Button>
              </div>
              <Textarea
                id="customPrompt"
                value={customPersonaPrompt}
                onChange={(e) => setCustomPersonaPrompt(e.target.value)}
                onBlur={handleCustomPromptSave}
                placeholder="Example: You are a wise wizard who speaks in riddles and refers to bugs as 'dark enchantments'..."
                className="min-h-[200px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Changes are saved automatically when you click outside the text area.
              </p>
            </div>
          </div>
        )}

        {/* Saved Persona Presets */}
        {personaPresets.length > 0 && (
          <div className="space-y-3">
            <Label className="text-base font-medium">Saved Persona Presets</Label>
            <div className="space-y-2">
              {personaPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <BookOpen className="h-4 w-4 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{preset.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {preset.prompt.slice(0, 80)}{preset.prompt.length > 80 ? '...' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleLoadPreset(preset)}
                      title="Load preset"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEditPreset(preset)}
                      title="Edit preset name"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeletePreset(preset.id)}
                      className="text-destructive hover:text-destructive"
                      title="Delete preset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save Preset Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={(open) => {
        if (!open) {
          setShowSaveDialog(false)
          setSavePresetName('')
          setEditingPresetId(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPresetId ? 'Update Preset' : 'Save Persona Preset'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="presetName">Preset Name</Label>
              <Input
                id="presetName"
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                placeholder="e.g., Wise Wizard, Pirate Captain, Friendly Tutor..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSavePreset()
                }}
                autoFocus
              />
            </div>
            <div className="p-3 bg-muted/50 rounded-md">
              <p className="text-xs text-muted-foreground font-mono whitespace-pre-wrap max-h-[100px] overflow-auto">
                {customPersonaPrompt.slice(0, 200)}{customPersonaPrompt.length > 200 ? '...' : ''}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => {
                setShowSaveDialog(false)
                setSavePresetName('')
                setEditingPresetId(null)
              }}>
                Cancel
              </Button>
              <Button onClick={handleSavePreset} disabled={!savePresetName.trim()}>
                {editingPresetId ? 'Update' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
