import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { Label } from '@/renderer/components/ui/label'
import type { AppPreferences, AttentionMode, OperatingMode, AgentModel } from '@/shared/types'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferences: AppPreferences
  onPreferencesChange: (preferences: Partial<AppPreferences>) => void
}

export function SettingsModal({
  open,
  onOpenChange,
  preferences,
  onPreferencesChange,
}: SettingsModalProps) {
  const handleAttentionModeChange = (mode: AttentionMode) => {
    onPreferencesChange({ attentionMode: mode })
  }

  const handleOperatingModeChange = (mode: OperatingMode) => {
    onPreferencesChange({ operatingMode: mode })
  }

  const handleAgentModelChange = (model: AgentModel) => {
    onPreferencesChange({ agentModel: model })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
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
                  checked={preferences.attentionMode === 'off'}
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
                  checked={preferences.attentionMode === 'focus'}
                  onChange={() => handleAttentionModeChange('focus')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Focus</div>
                  <div className="text-sm text-muted-foreground">
                    Waiting agents pulse with a yellow ring in their grid position
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="attentionMode"
                  value="expand"
                  checked={preferences.attentionMode === 'expand'}
                  onChange={() => handleAttentionModeChange('expand')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Expand</div>
                  <div className="text-sm text-muted-foreground">
                    Waiting agent expands to fullscreen. Use Next button or hotkey to cycle through queue.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="attentionMode"
                  value="queue"
                  checked={preferences.attentionMode === 'queue'}
                  onChange={() => handleAttentionModeChange('queue')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Queue</div>
                  <div className="text-sm text-muted-foreground">
                    Shows a horizontal toast with agent icons at the bottom. Click to focus.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="grid gap-3">
            <Label className="text-base font-medium">Operating Mode</Label>
            <p className="text-sm text-muted-foreground">
              How agents work together
            </p>
            <div className="grid gap-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="operatingMode"
                  value="solo"
                  checked={preferences.operatingMode === 'solo'}
                  onChange={() => handleOperatingModeChange('solo')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Solo</div>
                  <div className="text-sm text-muted-foreground">
                    Run agents independently without coordination
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="operatingMode"
                  value="team"
                  checked={preferences.operatingMode === 'team'}
                  onChange={() => handleOperatingModeChange('team')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Team</div>
                  <div className="text-sm text-muted-foreground">
                    Enable plans sidebar. Leader agents delegate tasks to workers via bd.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="grid gap-3">
            <Label className="text-base font-medium">Agent Model</Label>
            <p className="text-sm text-muted-foreground">
              Model used for headless task agents in Team mode
            </p>
            <div className="grid gap-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="agentModel"
                  value="sonnet"
                  checked={preferences.agentModel === 'sonnet'}
                  onChange={() => handleAgentModelChange('sonnet')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Sonnet</div>
                  <div className="text-sm text-muted-foreground">
                    Best balance of speed, cost, and capability
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="agentModel"
                  value="opus"
                  checked={preferences.agentModel === 'opus'}
                  onChange={() => handleAgentModelChange('opus')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Opus</div>
                  <div className="text-sm text-muted-foreground">
                    Most capable model, higher cost
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="agentModel"
                  value="haiku"
                  checked={preferences.agentModel === 'haiku'}
                  onChange={() => handleAgentModelChange('haiku')}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium">Haiku</div>
                  <div className="text-sm text-muted-foreground">
                    Fastest and most affordable, good for simpler tasks
                  </div>
                </div>
              </label>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
