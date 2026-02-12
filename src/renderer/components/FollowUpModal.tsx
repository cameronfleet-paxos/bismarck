import { useState, useEffect } from 'react'
import { ExternalLink, GitPullRequest, MessageSquare, HelpCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import { Textarea } from '@/renderer/components/ui/textarea'
import { Switch } from '@/renderer/components/ui/switch'
import { Tooltip } from '@/renderer/components/ui/tooltip'
import type { HeadlessAgentInfo, AgentModel } from '@/shared/types'
import { extractPRUrls } from '@/shared/pr-utils'

interface FollowUpModalProps {
  info: HeadlessAgentInfo | null
  defaultModel: AgentModel
  onClose: () => void
  onSubmit: (prompt: string, model: AgentModel, planPhase: boolean) => void
  isSubmitting?: boolean
}

export function FollowUpModal({ info, defaultModel, onClose, onSubmit, isSubmitting }: FollowUpModalProps) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<AgentModel>(defaultModel)
  const [planPhase, setPlanPhase] = useState(true)

  // Reset planPhase default when info changes (infer from whether original agent used a plan)
  useEffect(() => {
    if (info) {
      setPlanPhase(!!info.planText)
    }
  }, [info])

  const userPrompt = info?.userPrompt || info?.originalPrompt
  // Extract PR URLs from events first, fall back to scanning the original prompt text
  let prUrls = info ? extractPRUrls(info.events) : []
  if (prUrls.length === 0 && info?.originalPrompt) {
    const prMatches = info.originalPrompt.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?![/\w])/g)
    if (prMatches) {
      prUrls = [...new Set(prMatches)]
    }
  }

  const handleSubmit = () => {
    if (!prompt.trim()) return
    onSubmit(prompt.trim(), model, planPhase)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={!!info} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <span>Start Follow-up Agent</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Previous context section */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Previous Agent Context</h4>

            {/* Original prompt */}
            {userPrompt && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Original Task</div>
                <p className="text-sm line-clamp-3">{userPrompt}</p>
              </div>
            )}

            {/* PR URLs */}
            {prUrls.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {prUrls.length === 1 ? 'Pull Request Created' : `Pull Requests Created (${prUrls.length})`}
                </div>
                <div className="space-y-1">
                  {prUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      onClick={(e) => {
                        e.preventDefault()
                        window.electronAPI?.openExternal?.(url)
                      }}
                      className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                    >
                      <GitPullRequest className="h-4 w-4 shrink-0" />
                      <span className="underline truncate">{url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {!userPrompt && prUrls.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No previous context available</p>
            )}
          </div>

          {/* Follow-up prompt input */}
          <div className="space-y-2">
            <label htmlFor="followup-prompt" className="text-sm font-medium">
              Follow-up Task
            </label>
            <Textarea
              id="followup-prompt"
              placeholder="Describe what you want the follow-up agent to do..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[100px] resize-none"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              The follow-up agent will continue working on the same branch with access to all previous commits.
            </p>
          </div>

          {/* Model selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModel('sonnet')}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition-colors ${
                  model === 'sonnet'
                    ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                Sonnet
              </button>
              <button
                type="button"
                onClick={() => setModel('opus')}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition-colors ${
                  model === 'opus'
                    ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                Opus
              </button>
            </div>
          </div>

          {/* Plan phase toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Tooltip
                content="Agent will create a read-only plan before coding. You cannot interact with it — use discussion mode to collaborate on a plan."
                side="top"
                className="!whitespace-normal w-72"
              >
                <label
                  htmlFor="followup-plan-toggle"
                  className="text-sm font-medium cursor-pointer flex items-center gap-1"
                >Plan phase <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" /></label>
              </Tooltip>
            </div>
            <Switch
              id="followup-plan-toggle"
              checked={planPhase}
              onCheckedChange={setPlanPhase}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!prompt.trim() || isSubmitting}>
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⟳</span>
                Starting...
              </span>
            ) : (
              'Start Follow-up'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
