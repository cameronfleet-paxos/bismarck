import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/renderer/components/ui/dialog'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Textarea } from '@/renderer/components/ui/textarea'
import { GitBranch, GitPullRequest } from 'lucide-react'
import type { BranchStrategy } from '@/shared/types'

interface PlanCreatorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreatePlan: (title: string, description: string, options?: { maxParallelAgents?: number; branchStrategy?: BranchStrategy }) => void
}

export function PlanCreator({ open, onOpenChange, onCreatePlan }: PlanCreatorProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [maxParallelAgents, setMaxParallelAgents] = useState(4)
  const [branchStrategy, setBranchStrategy] = useState<BranchStrategy>('feature_branch')

  const handleSubmit = () => {
    if (title.trim()) {
      onCreatePlan(title.trim(), description.trim(), {
        maxParallelAgents,
        branchStrategy,
      })
      setTitle('')
      setDescription('')
      setMaxParallelAgents(4)
      setBranchStrategy('feature_branch')
      onOpenChange(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setTitle('')
      setDescription('')
      setMaxParallelAgents(4)
      setBranchStrategy('feature_branch')
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Plan</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="e.g., Build login page"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe what needs to be done..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="maxParallel">Max Parallel Agents</Label>
            <div className="flex items-center gap-2">
              <Input
                id="maxParallel"
                type="number"
                min={1}
                max={8}
                value={maxParallelAgents}
                onChange={(e) => setMaxParallelAgents(Math.max(1, Math.min(8, parseInt(e.target.value) || 1)))}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">
                agents can run simultaneously
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Branch Strategy</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBranchStrategy('feature_branch')}
                className={`flex items-center gap-2 p-3 border rounded-md text-left transition-colors ${
                  branchStrategy === 'feature_branch'
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/50'
                }`}
              >
                <GitBranch className={`h-4 w-4 ${branchStrategy === 'feature_branch' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <div className="text-sm font-medium">Feature Branch</div>
                  <div className="text-xs text-muted-foreground">Push all changes to a shared branch</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setBranchStrategy('raise_prs')}
                className={`flex items-center gap-2 p-3 border rounded-md text-left transition-colors ${
                  branchStrategy === 'raise_prs'
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-primary/50'
                }`}
              >
                <GitPullRequest className={`h-4 w-4 ${branchStrategy === 'raise_prs' ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <div className="text-sm font-medium">Raise PRs</div>
                  <div className="text-xs text-muted-foreground">Create a PR for each task</div>
                </div>
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            Create Plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
