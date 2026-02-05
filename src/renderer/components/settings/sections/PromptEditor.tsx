import { useState, useEffect } from 'react'
import { Button } from '@/renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog'
import type { PromptType } from '@/shared/types'

interface PromptEditorProps {
  type: PromptType
  isOpen: boolean
  onClose: () => void
  onSave: (template: string | null) => void
}

const VARIABLE_DESCRIPTIONS: Record<PromptType, { name: string; description: string }[]> = {
  discussion: [
    { name: '{{planTitle}}', description: 'Title of the plan' },
    { name: '{{planDescription}}', description: 'Description of the plan' },
    { name: '{{codebasePath}}', description: 'Path to the codebase being analyzed' },
    { name: '{{planDir}}', description: 'Directory where plan files are stored' },
  ],
  orchestrator: [
    { name: '{{planId}}', description: 'Unique identifier for the plan' },
    { name: '{{planTitle}}', description: 'Title of the plan' },
    { name: '{{repoList}}', description: 'List of available repositories' },
    { name: '{{maxParallel}}', description: 'Maximum parallel agents allowed' },
  ],
  planner: [
    { name: '{{planId}}', description: 'Unique identifier for the plan' },
    { name: '{{planTitle}}', description: 'Title of the plan' },
    { name: '{{planDescription}}', description: 'Description of the plan' },
    { name: '{{planDir}}', description: 'Directory where plan files are stored' },
    { name: '{{codebasePath}}', description: 'Path to the codebase being analyzed' },
    { name: '{{discussionContext}}', description: 'Context from discussion phase (if completed)' },
    { name: '{{featureBranchGuidance}}', description: 'Feature branch mode guidance (when using feature_branch strategy)' },
  ],
  task: [
    { name: '{{taskId}}', description: 'Unique identifier for the task' },
    { name: '{{taskTitle}}', description: 'Title of the task' },
    { name: '{{baseBranch}}', description: 'Base branch for the worktree' },
    { name: '{{planDir}}', description: 'Directory where plan files are stored' },
    { name: '{{completionInstructions}}', description: 'Instructions for task completion' },
    { name: '{{gitCommands}}', description: 'Git commands section (branch-strategy dependent)' },
    { name: '{{completionCriteria}}', description: 'Repository completion criteria (PR mode only)' },
  ],
  standalone_headless: [
    { name: '{{userPrompt}}', description: 'The user\'s task description' },
    { name: '{{workingDir}}', description: 'Worktree path' },
    { name: '{{branchName}}', description: 'Git branch name' },
    { name: '{{completionCriteria}}', description: 'Repository completion criteria (optional)' },
    { name: '{{bismarckPrefix}}', description: 'Optional Bismarck Mode satirical prefix' },
    { name: '{{ottoPrefix}}', description: 'Optional Otto Mode prefix' },
  ],
  standalone_followup: [
    { name: '{{userPrompt}}', description: 'The follow-up task description' },
    { name: '{{workingDir}}', description: 'Worktree path' },
    { name: '{{branchName}}', description: 'Git branch name' },
    { name: '{{commitHistory}}', description: 'Recent commits for context' },
    { name: '{{completionCriteria}}', description: 'Repository completion criteria (optional)' },
    { name: '{{bismarckPrefix}}', description: 'Optional Bismarck Mode satirical prefix' },
    { name: '{{ottoPrefix}}', description: 'Optional Otto Mode prefix' },
  ],
}

const PROMPT_LABELS: Record<PromptType, string> = {
  discussion: 'Discussion Agent',
  orchestrator: 'Orchestrator Agent',
  planner: 'Planner',
  task: 'Task Agent',
  standalone_headless: 'Standalone Headless Agent',
  standalone_followup: 'Standalone Follow-up Agent',
}

export function PromptEditor({ type, isOpen, onClose, onSave }: PromptEditorProps) {
  const [content, setContent] = useState('')
  const [defaultContent, setDefaultContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadPromptContent()
    }
  }, [isOpen, type])

  const loadPromptContent = async () => {
    setLoading(true)
    try {
      const [customPrompts, defaultPrompt] = await Promise.all([
        window.electronAPI.getCustomPrompts(),
        window.electronAPI.getDefaultPrompt(type),
      ])

      setDefaultContent(defaultPrompt)
      const customValue = customPrompts[type]
      setContent(customValue || defaultPrompt)
      setHasChanges(!!customValue)
    } catch (error) {
      console.error('Failed to load prompt:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    // If content matches default, save as null (use default)
    const valueToSave = content.trim() === defaultContent.trim() ? null : content
    onSave(valueToSave)
    onClose()
  }

  const handleReset = () => {
    setContent(defaultContent)
    setHasChanges(false)
  }

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasChanges(newContent.trim() !== defaultContent.trim())
  }

  const variables = VARIABLE_DESCRIPTIONS[type]

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit {PROMPT_LABELS[type]} Prompt</DialogTitle>
          <DialogDescription>
            Customize the prompt template for the {PROMPT_LABELS[type].toLowerCase()}.
            Use variables below to insert dynamic values.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {/* Variables reference */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium mb-2">Available Variables</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {variables.map((v) => (
                  <div key={v.name} className="text-xs flex gap-2">
                    <code className="bg-muted px-1 rounded text-primary font-mono">{v.name}</code>
                    <span className="text-muted-foreground truncate">{v.description}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Editor */}
            <div className="flex-1 min-h-0">
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                className="w-full h-full min-h-[300px] font-mono text-sm p-3 rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Enter your custom prompt template..."
                spellCheck={false}
              />
            </div>

            {/* Status indicator */}
            {hasChanges && (
              <div className="text-xs text-muted-foreground">
                Customized (differs from default)
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="outline" onClick={handleReset} disabled={loading}>
            Reset to Default
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
