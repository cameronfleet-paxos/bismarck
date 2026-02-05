import { useState } from 'react'
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import type { HeadlessAgentInfo } from '@/shared/types'

interface PromptViewerModalProps {
  info: HeadlessAgentInfo | null
  onClose: () => void
}

export function PromptViewerModal({ info, onClose }: PromptViewerModalProps) {
  const [copied, setCopied] = useState(false)
  const [showFullPrompt, setShowFullPrompt] = useState(false)

  // Use userPrompt if available, otherwise fall back to originalPrompt
  const userPrompt = info?.userPrompt || info?.originalPrompt
  const fullPrompt = info?.originalPrompt
  const hasFullPrompt = fullPrompt && fullPrompt !== userPrompt

  const displayedPrompt = showFullPrompt ? fullPrompt : userPrompt

  const handleCopy = async () => {
    if (!displayedPrompt) return
    await navigator.clipboard.writeText(displayedPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={!!info} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl max-h-[80vh] flex flex-col">
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
          <pre className="text-sm font-mono whitespace-pre-wrap break-words bg-muted/50 p-4 rounded-md">
            {displayedPrompt || 'No prompt available'}
          </pre>
        </div>
        {hasFullPrompt && (
          <div className="pt-2 border-t">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowFullPrompt(!showFullPrompt)}
              className="flex items-center gap-1.5 text-muted-foreground"
            >
              {showFullPrompt ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>Show User Prompt</span>
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span>View Full Prompt</span>
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
