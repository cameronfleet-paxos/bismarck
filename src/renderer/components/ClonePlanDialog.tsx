import { useState } from 'react'
import { Copy } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import type { Plan } from '@/shared/types'

interface ClonePlanDialogProps {
  plan: Plan
  onConfirm: (includeDiscussion: boolean) => void
  onCancel: () => void
}

export function ClonePlanDialog({ plan, onConfirm, onCancel }: ClonePlanDialogProps) {
  const [includeDiscussion, setIncludeDiscussion] = useState(false)
  const [isCloning, setIsCloning] = useState(false)

  const handleConfirm = async () => {
    setIsCloning(true)
    try {
      await onConfirm(includeDiscussion)
    } finally {
      setIsCloning(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            Clone Plan
          </DialogTitle>
          <DialogDescription>
            Create a copy of "{plan.title}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-muted-foreground">
            The cloned plan will have:
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Same title (with " (Copy)" suffix)</li>
              <li>Same description</li>
              <li>Same branch strategy and settings</li>
              <li>New ID and timestamps</li>
              <li>No assigned agent or execution history</li>
            </ul>
          </div>

          {plan.discussionOutputPath && (
            <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={includeDiscussion}
                onChange={(e) => setIncludeDiscussion(e.target.checked)}
                className="h-4 w-4 rounded border-muted-foreground/40"
              />
              <div>
                <div className="font-medium text-sm">Include discussion</div>
                <div className="text-xs text-muted-foreground">
                  Copy the discussion output file and start as "Ready to Execute"
                </div>
              </div>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isCloning}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isCloning}>
            {isCloning ? 'Cloning...' : 'Clone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
