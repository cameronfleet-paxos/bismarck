import { useState, useEffect } from 'react'
import { Check, Plus, Pencil, Trash2, Forward } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Textarea } from '@/renderer/components/ui/textarea'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'

interface FollowUpPresetData {
  id: string
  label: string
  description: string
  prompt: string
  requiresPrUrls?: boolean
  suggestedModel?: 'opus' | 'sonnet'
}

interface FollowUpPresetsSettingsProps {
  onSettingsChange: () => void
}

export function FollowUpPresetsSettings({ onSettingsChange }: FollowUpPresetsSettingsProps) {
  const [presets, setPresets] = useState<FollowUpPresetData[]>([])
  const [loading, setLoading] = useState(true)
  const [showSaved, setShowSaved] = useState(false)
  const [editingPreset, setEditingPreset] = useState<FollowUpPresetData | null>(null)
  const [isNewPreset, setIsNewPreset] = useState(false)

  // Editor form state
  const [formLabel, setFormLabel] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formRequiresPrUrls, setFormRequiresPrUrls] = useState(false)
  const [formSuggestedModel, setFormSuggestedModel] = useState<'opus' | 'sonnet' | undefined>(undefined)

  useEffect(() => {
    loadPresets()
  }, [])

  const loadPresets = async () => {
    setLoading(true)
    try {
      const loaded = await window.electronAPI.getFollowUpPresets()
      setPresets(loaded)
    } catch (error) {
      console.error('Failed to load follow-up presets:', error)
    } finally {
      setLoading(false)
    }
  }

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const openEditor = (preset?: FollowUpPresetData) => {
    if (preset) {
      setEditingPreset(preset)
      setFormLabel(preset.label)
      setFormDescription(preset.description)
      setFormPrompt(preset.prompt)
      setFormRequiresPrUrls(preset.requiresPrUrls ?? false)
      setFormSuggestedModel(preset.suggestedModel)
      setIsNewPreset(false)
    } else {
      setEditingPreset(null)
      setFormLabel('')
      setFormDescription('')
      setFormPrompt('')
      setFormRequiresPrUrls(false)
      setFormSuggestedModel(undefined)
      setIsNewPreset(true)
    }
  }

  const closeEditor = () => {
    setEditingPreset(null)
    setIsNewPreset(false)
    setFormLabel('')
    setFormDescription('')
    setFormPrompt('')
    setFormRequiresPrUrls(false)
    setFormSuggestedModel(undefined)
  }

  const handleSave = async () => {
    if (!formLabel.trim() || !formPrompt.trim()) return

    try {
      if (isNewPreset) {
        await window.electronAPI.addFollowUpPreset({
          label: formLabel.trim(),
          description: formDescription.trim(),
          prompt: formPrompt,
          requiresPrUrls: formRequiresPrUrls || undefined,
          suggestedModel: formSuggestedModel,
        })
      } else if (editingPreset) {
        await window.electronAPI.updateFollowUpPreset(editingPreset.id, {
          label: formLabel.trim(),
          description: formDescription.trim(),
          prompt: formPrompt,
          requiresPrUrls: formRequiresPrUrls || undefined,
          suggestedModel: formSuggestedModel,
        })
      }
      await loadPresets()
      onSettingsChange()
      showSavedIndicator()
      closeEditor()
    } catch (error) {
      console.error('Failed to save preset:', error)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.electronAPI.deleteFollowUpPreset(id)
      await loadPresets()
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to delete preset:', error)
    }
  }

  if (loading) {
    return (
      <div className="text-muted-foreground">Loading presets...</div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <Forward className="h-5 w-5 text-purple-500" />
          <h3 className="text-lg font-medium">Follow-up Presets</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Create and manage presets for follow-up agent tasks. Presets appear as quick-select buttons in the follow-up modal.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button onClick={() => openEditor()} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Preset
        </Button>
      </div>

      {/* Preset list */}
      {presets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          <p>No custom presets yet</p>
          <p className="text-sm mt-1">Create a preset or save one from the follow-up modal</p>
        </div>
      ) : (
        <div className="space-y-3">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-start justify-between p-4 border rounded-lg bg-muted/30"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{preset.label}</div>
                {preset.description && (
                  <div className="text-sm text-muted-foreground mt-0.5">{preset.description}</div>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  {preset.requiresPrUrls && (
                    <span className="bg-muted px-1.5 py-0.5 rounded">Requires PR</span>
                  )}
                  {preset.suggestedModel && (
                    <span className="bg-muted px-1.5 py-0.5 rounded capitalize">{preset.suggestedModel}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 ml-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEditor(preset)}
                  title="Edit preset"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDelete(preset.id)}
                  className="text-destructive hover:text-destructive"
                  title="Delete preset"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor Dialog */}
      <Dialog open={editingPreset !== null || isNewPreset} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{isNewPreset ? 'New Follow-up Preset' : 'Edit Follow-up Preset'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="followup-preset-label">Label</Label>
              <Input
                id="followup-preset-label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="e.g., Fix lint errors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup-preset-description">Description</Label>
              <Input
                id="followup-preset-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g., Run linter and fix all reported errors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup-preset-prompt">Prompt</Label>
              <Textarea
                id="followup-preset-prompt"
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder="Enter the follow-up prompt..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="followup-preset-pr">Only show when PR exists</Label>
                <p className="text-xs text-muted-foreground">
                  Hide this preset when the previous agent didn't create a PR
                </p>
              </div>
              <Switch
                id="followup-preset-pr"
                checked={formRequiresPrUrls}
                onCheckedChange={setFormRequiresPrUrls}
              />
            </div>

            <div className="space-y-2">
              <Label>Suggested Model (optional)</Label>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  onClick={() => setFormSuggestedModel(formSuggestedModel === 'sonnet' ? undefined : 'sonnet')}
                  variant={formSuggestedModel === 'sonnet' ? 'default' : 'secondary'}
                  size="sm"
                  className="flex-1"
                >
                  Sonnet
                </Button>
                <Button
                  type="button"
                  onClick={() => setFormSuggestedModel(formSuggestedModel === 'opus' ? undefined : 'opus')}
                  variant={formSuggestedModel === 'opus' ? 'default' : 'secondary'}
                  size="sm"
                  className="flex-1"
                >
                  Opus
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Auto-selects this model when the preset is chosen
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="ghost" onClick={closeEditor}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!formLabel.trim() || !formPrompt.trim()}>
                Save Preset
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
