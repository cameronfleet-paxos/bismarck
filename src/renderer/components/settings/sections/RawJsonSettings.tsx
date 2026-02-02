import { useState, useEffect, useCallback } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { Check, AlertCircle, RotateCcw, Save, Code } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'

interface RawJsonSettingsProps {
  onSettingsChange?: () => void
}

export function RawJsonSettings({ onSettingsChange }: RawJsonSettingsProps) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await window.electronAPI.getSettings()
      const jsonStr = JSON.stringify(settings, null, 2)
      setContent(jsonStr)
      setOriginalContent(jsonStr)
      setError(null)
    } catch (e) {
      setError(`Failed to load settings: ${(e as Error).message}`)
    }
  }

  const validateJson = useCallback((value: string): boolean => {
    try {
      JSON.parse(value)
      setError(null)
      return true
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`)
      return false
    }
  }, [])

  const handleChange = useCallback((value: string) => {
    setContent(value)
    // Validate on change but don't block editing
    try {
      JSON.parse(value)
      setError(null)
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`)
    }
  }, [])

  const handleSave = async () => {
    if (!validateJson(content)) return

    setSaving(true)
    try {
      const parsed = JSON.parse(content)
      await window.electronAPI.setRawSettings(parsed)
      setOriginalContent(content)
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2000)
      onSettingsChange?.()
    } catch (e) {
      setError(`Failed to save: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setContent(originalContent)
    setError(null)
  }

  const hasChanges = content !== originalContent

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Code className="h-5 w-5" />
            Raw JSON Settings
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Directly view and edit the settings file. Changes take effect immediately after saving.
          </p>
        </div>
        {showSaved && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium">
            <Check className="h-3.5 w-3.5" />
            Saved
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <CodeMirror
          value={content}
          height="500px"
          extensions={[json()]}
          theme="dark"
          onChange={handleChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: true,
            historyKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !hasChanges || !!error}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={!hasChanges}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Discard Changes
        </Button>
        <Button variant="ghost" onClick={loadSettings}>
          Reload
        </Button>
      </div>

      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
        <p className="text-xs text-amber-600 dark:text-amber-400">
          <strong>Warning:</strong> Editing the raw JSON directly can break the application if the structure is invalid.
          Make sure to validate your changes before saving. Required fields include <code className="bg-amber-500/20 px-1 rounded">paths</code>, <code className="bg-amber-500/20 px-1 rounded">docker</code>, and <code className="bg-amber-500/20 px-1 rounded">prompts</code>.
        </p>
      </div>
    </div>
  )
}
