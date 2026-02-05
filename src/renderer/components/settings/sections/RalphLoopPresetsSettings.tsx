import { useState, useEffect } from 'react'
import { Check, Plus, Pencil, Trash2, Copy, ClipboardPaste, RefreshCw } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Textarea } from '@/renderer/components/ui/textarea'
import { Label } from '@/renderer/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'

interface RalphLoopPresetData {
  id: string
  label: string
  description: string
  prompt: string
  completionPhrase: string
  maxIterations: number
  model: 'opus' | 'sonnet'
}

interface RalphLoopPresetsSettingsProps {
  onSettingsChange: () => void
}

export function RalphLoopPresetsSettings({ onSettingsChange }: RalphLoopPresetsSettingsProps) {
  const [presets, setPresets] = useState<RalphLoopPresetData[]>([])
  const [loading, setLoading] = useState(true)
  const [showSaved, setShowSaved] = useState(false)
  const [editingPreset, setEditingPreset] = useState<RalphLoopPresetData | null>(null)
  const [isNewPreset, setIsNewPreset] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Editor form state
  const [formLabel, setFormLabel] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [formCompletionPhrase, setFormCompletionPhrase] = useState('<promise>COMPLETE</promise>')
  const [formMaxIterations, setFormMaxIterations] = useState(50)
  const [formModel, setFormModel] = useState<'opus' | 'sonnet'>('sonnet')

  useEffect(() => {
    loadPresets()
  }, [])

  const loadPresets = async () => {
    setLoading(true)
    try {
      const loaded = await window.electronAPI.getRalphLoopPresets()
      setPresets(loaded)
    } catch (error) {
      console.error('Failed to load Ralph Loop presets:', error)
    } finally {
      setLoading(false)
    }
  }

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const openEditor = (preset?: RalphLoopPresetData) => {
    if (preset) {
      setEditingPreset(preset)
      setFormLabel(preset.label)
      setFormDescription(preset.description)
      setFormPrompt(preset.prompt)
      setFormCompletionPhrase(preset.completionPhrase)
      setFormMaxIterations(preset.maxIterations)
      setFormModel(preset.model)
      setIsNewPreset(false)
    } else {
      setEditingPreset(null)
      setFormLabel('')
      setFormDescription('')
      setFormPrompt('')
      setFormCompletionPhrase('<promise>COMPLETE</promise>')
      setFormMaxIterations(50)
      setFormModel('sonnet')
      setIsNewPreset(true)
    }
  }

  const closeEditor = () => {
    setEditingPreset(null)
    setIsNewPreset(false)
    setFormLabel('')
    setFormDescription('')
    setFormPrompt('')
    setFormCompletionPhrase('<promise>COMPLETE</promise>')
    setFormMaxIterations(50)
    setFormModel('sonnet')
  }

  const handleSave = async () => {
    if (!formLabel.trim() || !formPrompt.trim()) return

    try {
      if (isNewPreset) {
        await window.electronAPI.addRalphLoopPreset({
          label: formLabel.trim(),
          description: formDescription.trim(),
          prompt: formPrompt,
          completionPhrase: formCompletionPhrase.trim(),
          maxIterations: formMaxIterations,
          model: formModel,
        })
      } else if (editingPreset) {
        await window.electronAPI.updateRalphLoopPreset(editingPreset.id, {
          label: formLabel.trim(),
          description: formDescription.trim(),
          prompt: formPrompt,
          completionPhrase: formCompletionPhrase.trim(),
          maxIterations: formMaxIterations,
          model: formModel,
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
      await window.electronAPI.deleteRalphLoopPreset(id)
      await loadPresets()
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to delete preset:', error)
    }
  }

  const handleExport = async (preset: RalphLoopPresetData) => {
    const exportData = {
      label: preset.label,
      description: preset.description,
      prompt: preset.prompt,
      completionPhrase: preset.completionPhrase,
      maxIterations: preset.maxIterations,
      model: preset.model,
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2))
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleImport = async () => {
    setImportError(null)
    try {
      const text = await navigator.clipboard.readText()
      const data = JSON.parse(text)

      // Validate required fields
      if (!data.label || typeof data.label !== 'string') {
        setImportError('Missing or invalid "label" field')
        return
      }
      if (!data.prompt || typeof data.prompt !== 'string') {
        setImportError('Missing or invalid "prompt" field')
        return
      }
      if (!data.completionPhrase || typeof data.completionPhrase !== 'string') {
        setImportError('Missing or invalid "completionPhrase" field')
        return
      }
      if (typeof data.maxIterations !== 'number' || data.maxIterations < 1 || data.maxIterations > 500) {
        setImportError('Invalid "maxIterations" - must be number between 1-500')
        return
      }
      if (data.model !== 'opus' && data.model !== 'sonnet') {
        setImportError('Invalid "model" - must be "opus" or "sonnet"')
        return
      }

      await window.electronAPI.addRalphLoopPreset({
        label: data.label,
        description: data.description || '',
        prompt: data.prompt,
        completionPhrase: data.completionPhrase,
        maxIterations: data.maxIterations,
        model: data.model,
      })

      await loadPresets()
      onSettingsChange()
      showSavedIndicator()
    } catch (error) {
      if (error instanceof SyntaxError) {
        setImportError('Invalid JSON format in clipboard')
      } else {
        setImportError('Failed to import preset')
      }
      console.error('Failed to import preset:', error)
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
          <RefreshCw className="h-5 w-5 text-purple-500" />
          <h3 className="text-lg font-medium">Ralph Loop Presets</h3>
          {showSaved && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Create and manage custom presets for Ralph Loop automation
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button onClick={() => openEditor()} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New Preset
        </Button>
        <Button onClick={handleImport} size="sm" variant="outline">
          <ClipboardPaste className="h-4 w-4 mr-1" />
          Import from Clipboard
        </Button>
      </div>

      {importError && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <p className="text-sm text-red-600 dark:text-red-400">{importError}</p>
        </div>
      )}

      {/* Preset list */}
      {presets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          <p>No custom presets yet</p>
          <p className="text-sm mt-1">Create a preset to save your commonly used configurations</p>
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
                  <span className="bg-muted px-1.5 py-0.5 rounded capitalize">{preset.model}</span>
                  <span>Max {preset.maxIterations} iterations</span>
                </div>
              </div>
              <div className="flex gap-1 ml-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleExport(preset)}
                  title="Copy to clipboard"
                >
                  <Copy className="h-4 w-4" />
                </Button>
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
            <DialogTitle>{isNewPreset ? 'New Preset' : 'Edit Preset'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="preset-label">Label</Label>
              <Input
                id="preset-label"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="e.g., Complete All Beads Tasks"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preset-description">Description</Label>
              <Input
                id="preset-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g., Work through all open beads tasks sequentially"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preset-prompt">Prompt</Label>
              <Textarea
                id="preset-prompt"
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder="Enter the prompt for the Ralph Loop..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preset-completion">Completion Phrase</Label>
              <Input
                id="preset-completion"
                value={formCompletionPhrase}
                onChange={(e) => setFormCompletionPhrase(e.target.value)}
                placeholder="<promise>COMPLETE</promise>"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Loop stops when this exact text is output
              </p>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="preset-iterations">Max Iterations</Label>
                <Input
                  id="preset-iterations"
                  type="number"
                  value={formMaxIterations}
                  onChange={(e) => setFormMaxIterations(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
                  min={1}
                  max={500}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Model</Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    onClick={() => setFormModel('sonnet')}
                    variant={formModel === 'sonnet' ? 'default' : 'secondary'}
                    size="sm"
                    className="flex-1"
                  >
                    Sonnet
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setFormModel('opus')}
                    variant={formModel === 'opus' ? 'default' : 'secondary'}
                    size="sm"
                    className="flex-1"
                  >
                    Opus
                  </Button>
                </div>
              </div>
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
