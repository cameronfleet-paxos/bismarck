import { useState, useMemo } from 'react'
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import type { HeadlessAgentInfo, StreamNudgeEvent } from '@/shared/types'

interface PromptViewerModalProps {
  info: HeadlessAgentInfo | null
  onClose: () => void
}

type ViewMode = 'user' | 'plan' | 'full' | 'nudges'

export function PromptViewerModal({ info, onClose }: PromptViewerModalProps) {
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('user')

  const userPrompt = info?.userPrompt || info?.originalPrompt
  const planText = info?.planText
  const fullPrompt = info?.originalPrompt
  const hasFullPrompt = fullPrompt && fullPrompt !== userPrompt

  // Extract nudge events from the agent's event stream
  const nudges = useMemo(() => {
    if (!info?.events) return []
    return info.events.filter((e): e is StreamNudgeEvent => e.type === 'nudge')
  }, [info?.events])

  const displayedPrompt = viewMode === 'full' ? fullPrompt
    : viewMode === 'plan' ? planText
    : viewMode === 'nudges' ? null
    : userPrompt

  const handleCopy = async () => {
    if (viewMode === 'nudges') {
      const text = nudges.map((n, i) => `[${new Date(n.timestamp).toLocaleTimeString()}] ${n.content}`).join('\n')
      if (!text) return
      await navigator.clipboard.writeText(text)
    } else {
      if (!displayedPrompt) return
      await navigator.clipboard.writeText(displayedPrompt)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={!!info} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-8">
            <span>Agent Prompt</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </>
              )}
            </Button>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0">
          {viewMode === 'nudges' ? (
            nudges.length > 0 ? (
              <div className="space-y-2 p-4 bg-muted/50 rounded-md">
                {nudges.map((nudge, i) => (
                  <div key={i} className="flex gap-2 font-mono text-sm">
                    <span className="text-muted-foreground flex-shrink-0">
                      {new Date(nudge.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-orange-400">&gt;</span>
                    <span className="text-orange-300">{nudge.content}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-md">
                No nudges sent to this agent
              </div>
            )
          ) : (
            <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-muted/50 p-4 rounded-md">
              {displayedPrompt || 'No prompt available'}
            </pre>
          )}
        </div>
        {(planText || hasFullPrompt || nudges.length > 0) && (
          <div className="pt-2 border-t flex gap-1">
            <Button
              size="sm"
              variant={viewMode === 'user' ? 'secondary' : 'ghost'}
              onClick={() => setViewMode('user')}
              className="text-muted-foreground"
            >
              User Prompt
            </Button>
            {planText && (
              <Button
                size="sm"
                variant={viewMode === 'plan' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('plan')}
                className="text-muted-foreground"
              >
                Plan
              </Button>
            )}
            {hasFullPrompt && (
              <Button
                size="sm"
                variant={viewMode === 'full' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('full')}
                className="text-muted-foreground"
              >
                Full Prompt
              </Button>
            )}
            {nudges.length > 0 && (
              <Button
                size="sm"
                variant={viewMode === 'nudges' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('nudges')}
                className="text-muted-foreground"
              >
                Nudges ({nudges.length})
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
