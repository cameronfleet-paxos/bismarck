import { useState, useEffect } from 'react'
import { Check, Pencil, RotateCcw } from 'lucide-react'
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
  task: boolean
  standalone_headless: boolean
  standalone_followup: boolean
  headless_discussion: boolean
  critic: boolean
  ralph_loop_discussion: boolean
  plan_phase: boolean
  manager: boolean
  architect: boolean
}

const PROMPT_LABELS: Record<PromptType, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planner',
  discussion: 'Discussion',
  task: 'Task Agent',
  standalone_headless: 'Standalone Headless',
  standalone_followup: 'Standalone Follow-up',
  headless_discussion: 'Headless Discussion',
  critic: 'Critic',
  ralph_loop_discussion: 'Ralph Loop Discussion',
  plan_phase: 'Plan Phase',
  manager: 'Manager',
  architect: 'Architect',
}

const PROMPT_DESCRIPTIONS: Record<PromptType, string> = {
  orchestrator: 'Coordinates task assignment and monitors progress',
  planner: 'Creates tasks and sets up dependencies',
  discussion: 'Facilitates design discussions before implementation',
  task: 'Executes plan tasks in Docker containers',
  standalone_headless: 'One-off headless agents started via CMD-K',
  standalone_followup: 'Follow-up agents on existing worktrees',
  headless_discussion: 'Headless discussion with agents',
  critic: 'Reviews completed task work and creates fix-up tasks',
  ralph_loop_discussion: 'Discussion phase in Ralph loop workflow',
  plan_phase: 'Read-only planning phase before execution',
  manager: 'Triages incoming tasks in bottom-up mode',
  architect: 'Decomposes large tasks into subtasks in bottom-up mode',
}

export function PlansSettings({ onPreferencesChange }: PlansSettingsProps) {
  const [plansEnabled, setPlansEnabled] = useState(false)
  const [agentModel, setAgentModel] = useState<AgentModel>('sonnet')
  const [showSaved, setShowSaved] = useState(false)
  const [promptStatus, setPromptStatus] = useState<PromptStatus>({
    orchestrator: false,
    planner: false,
    discussion: false,
    task: false,
    standalone_headless: false,
    standalone_followup: false,
    headless_discussion: false,
    critic: false,
    ralph_loop_discussion: false,
    plan_phase: false,
    manager: false,
    architect: false,
  })
  const [criticEnabled, setCriticEnabled] = useState(true)
  const [maxCriticIterations, setMaxCriticIterations] = useState(2)
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
          task: !!customPrompts.task,
          standalone_headless: !!customPrompts.standalone_headless,
          standalone_followup: !!customPrompts.standalone_followup,
          headless_discussion: false,
          critic: !!customPrompts.critic,
          ralph_loop_discussion: !!customPrompts.ralph_loop_discussion,
          plan_phase: false,
          manager: !!customPrompts.manager,
          architect: !!customPrompts.architect,
        })

        // Load critic settings
        const settings = await window.electronAPI.getSettings()
        setCriticEnabled(settings.critic?.enabled ?? true)
        setMaxCriticIterations(settings.critic?.maxIterations ?? 2)
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

  const handleCriticEnabledChange = async (enabled: boolean) => {
    setCriticEnabled(enabled)
    try {
      const settings = await window.electronAPI.getSettings()
      await window.electronAPI.setRawSettings({
        ...settings,
        critic: { ...settings.critic, enabled },
      })
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save critic settings:', error)
    }
  }

  const handleMaxIterationsChange = async (value: number) => {
    if (isNaN(value) || value < 1 || value > 5) return
    setMaxCriticIterations(value)
    try {
      const settings = await window.electronAPI.getSettings()
      await window.electronAPI.setRawSettings({
        ...settings,
        critic: { ...settings.critic, maxIterations: value },
      })
      showSavedIndicator()
    } catch (error) {
      console.error('Failed to save critic settings:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Saved indicator */}
      {showSaved && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 text-green-600 dark:text-green-400 rounded-md text-sm font-medium animate-in fade-in slide-in-from-top-1 duration-200 w-fit">
          <Check className="h-3.5 w-3.5" />
          Saved
        </div>
      )}

      {/* Plans Section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-lg font-semibold">Teams</h3>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">Experimental</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure team execution and task orchestration. This feature is experimental and under active development.
        </p>

        <div className="space-y-4">
          {/* Teams Enabled Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Teams Enabled</Label>
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

          {/* Critic Review Toggle */}
          <div className="flex items-center justify-between py-2">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Critic Review</Label>
              <p className="text-sm text-muted-foreground">
                Review task work before approval
              </p>
            </div>
            <Switch
              checked={criticEnabled}
              onCheckedChange={handleCriticEnabledChange}
            />
          </div>

          {/* Max Critic Iterations */}
          {criticEnabled && (
            <div className="flex items-center justify-between py-2">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">Max Review Iterations</Label>
                <p className="text-sm text-muted-foreground">
                  Maximum critic review cycles per task
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={5}
                value={maxCriticIterations}
                onChange={(e) => handleMaxIterationsChange(parseInt(e.target.value, 10))}
                className="w-[70px] text-sm border rounded px-2 py-1.5 bg-background text-center"
              />
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t" />

      {/* Prompts Section */}
      <div>
        <h3 className="text-lg font-semibold mb-1">Prompts</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Custom prompts for each agent type
        </p>

        <div className="space-y-3">
          {(['orchestrator', 'planner', 'discussion', 'task', 'standalone_headless', 'standalone_followup', 'critic', 'manager', 'architect'] as PromptType[]).map((type) => (
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
