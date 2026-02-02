import { useState, useEffect } from 'react'
import { Check, ChevronRight, Pencil, RotateCcw } from 'lucide-react'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/renderer/components/ui/select'
import { Button } from '@/renderer/components/ui/button'
import { PromptEditor } from './PromptEditor'
import type { OperatingMode, AgentModel, PromptType } from '@/shared/types'

interface PlansSettingsProps {
  onPreferencesChange: (preferences: {
    operatingMode?: OperatingMode
    agentModel?: AgentModel
  }) => void
}

interface PromptStatus {
  orchestrator: boolean
  planner: boolean
  discussion: boolean
}

const PROMPT_LABELS: Record<PromptType, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  discussion: 'Discussion',
}

const PROMPT_DESCRIPTIONS: Record<PromptType, string> = {
  orchestrator: 'Coordinates task assignment and monitors progress',
  planner: 'Creates tasks and sets up dependencies',
  discussion: 'Facilitates design discussions before implementation',
}

export function PlansSettings({ onPreferencesChange }: PlansSettingsProps) {
  const [plansEnabled, setPlansEnabled] = useState(false)
  const [agentModel, setAgentModel] = useState<AgentModel>('sonnet')
  const [showSaved, setShowSaved] = useState(false)
  const [promptsExpanded, setPromptsExpanded] = useState(true)
  const [promptStatus, setPromptStatus] = useState<PromptStatus>({
    orchestrator: false,
    planner: false,
    discussion: false,
  })
  const [editingPrompt, setEditingPrompt] = useState<PromptType | null>(null)

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await window.electronAPI.getPreferences()
        setPlansEnabled(prefs.operatingMode === 'team')
        setAgentModel(prefs.agentModel)

        // Load custom prompt status
        const customPrompts = await window.electronAPI.getCustomPrompts()
        setPromptStatus({
          orchestrator: !!customPrompts.orchestrator,
          planner: !!customPrompts.planner,
          discussion: !!customPrompts.discussion,
        })
      } catch (error) {
        console.error('Failed to load preferences:', error)
      }
    }

    loadPreferences()
  }, [])

  const showSavedIndicator = () => {
    setShowSaved(true)
    setTimeout(() => setShowSaved(false), 2000)
  }

  const handlePlansEnabledChange = (enabled: boolean) => {
    setPlansEnabled(enabled)
    const mode: OperatingMode = enabled ? 'team' : 'solo'
    const update = { operatingMode: mode }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    showSavedIndicator()
  }

  const handleAgentModelChange = (model: AgentModel) => {
    setAgentModel(model)
    const update = { agentModel: model }
    window.electronAPI.setPreferences(update)
    onPreferencesChange(update)
    showSavedIndicator()
  }

  const handlePromptSave = async (type: PromptType, template: string | null) => {
    try {
      await window.electronAPI.setCustomPrompt(type, template)
      setPromptStatus((prev) => ({
        ...prev,
        [type]: !!template,
      }))
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save prompt:', error)
    }
  }

  const handlePromptReset = async (type: PromptType) => {
    try {
      await window.electronAPI.setCustomPrompt(type, null)
      setPromptStatus((prev) => ({
        ...prev,
        [type]: false,
      }))
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to reset prompt:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
          Configure plan execution and agent behavior
        </p>
      </div>

      {/* Main settings */}
      <div className="space-y-4">
        {/* Plans Enabled Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Plans Enabled</Label>
            <p className="text-sm text-muted-foreground">
              Enable coordinated task orchestration
            </p>
          </div>
          <Switch
            checked={plansEnabled}
            onCheckedChange={handlePlansEnabledChange}
          />
        </div>

        {/* Agent Model Dropdown */}
        <div className="flex items-center justify-between py-2">
          <div className="space-y-0.5">
            <Label className="text-base font-medium">Agent Model</Label>
            <p className="text-sm text-muted-foreground">
              Model for headless task agents
            </p>
          </div>
          <Select value={agentModel} onValueChange={(v) => handleAgentModelChange(v as AgentModel)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sonnet">Sonnet</SelectItem>
              <SelectItem value="opus">Opus</SelectItem>
              <SelectItem value="haiku">Haiku</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Prompts Section */}
      <div className="border-t pt-4">
        <button
          onClick={() => setPromptsExpanded(!promptsExpanded)}
          className="flex items-center gap-2 w-full text-left hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              promptsExpanded ? 'rotate-90' : ''
            }`}
          />
          <span className="text-base font-medium">Agent Prompts</span>
        </button>

        {promptsExpanded && (
          <div className="mt-4 space-y-3 pl-6">
            {(['orchestrator', 'planner', 'discussion'] as PromptType[]).map((type) => (
              <div
                key={type}
                className="flex items-center justify-between py-2 px-3 rounded-lg border bg-muted/20"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{PROMPT_LABELS[type]}</span>
                    {promptStatus[type] ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        Custom
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PROMPT_DESCRIPTIONS[type]}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingPrompt(type)}
                    className="h-8 w-8 p-0"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Edit</span>
                  </Button>
                  {promptStatus[type] && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePromptReset(type)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span className="sr-only">Reset</span>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prompt Editor Dialog */}
      {editingPrompt && (
        <PromptEditor
          type={editingPrompt}
          isOpen={true}
          onClose={() => setEditingPrompt(null)}
          onSave={(template) => handlePromptSave(editingPrompt, template)}
        />
      )}
    </div>
  )
}
