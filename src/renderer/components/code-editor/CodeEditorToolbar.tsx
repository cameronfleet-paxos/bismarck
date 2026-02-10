import { GitBranch as GitBranchIcon, GitCommit as GitCommitIcon, RotateCw, X, FileText, Columns2 } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { GitBranch, GitCommit } from '@/shared/types'

// Helper to format relative time
function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

export interface CodeEditorToolbarProps {
  branches: GitBranch[]
  currentBranch: string
  currentRef: string
  onRefChange: (ref: string) => void
  commits: GitCommit[]
  onCommitSelect: (sha: string) => void
  onRefresh: () => void
  onClose: () => void
  onViewModeChange: (mode: 'browse' | 'diff') => void
  viewMode: 'browse' | 'diff'
  directory: string
}

export function CodeEditorToolbar({
  branches,
  currentBranch,
  currentRef,
  onRefChange,
  commits,
  onCommitSelect,
  onRefresh,
  onClose,
  onViewModeChange,
  viewMode,
}: CodeEditorToolbarProps) {
  // Group branches by local/remote
  const localBranches = branches.filter(b => b.isLocal)
  const remoteBranches = branches.filter(b => b.isRemote && !b.isLocal)

  // Display format for current ref
  const currentRefDisplay = currentRef.length > 40 ? currentRef.substring(0, 7) : currentRef

  return (
    <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
      {/* Left side: Title, branch selector, ref display */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-foreground">Code Editor</h2>

        {/* Branch selector */}
        <Select value={currentBranch} onValueChange={onRefChange}>
          <SelectTrigger className="w-[180px] h-8">
            <GitBranchIcon className="h-3.5 w-3.5 mr-2" />
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            {localBranches.length > 0 && (
              <SelectGroup>
                <SelectLabel>Local Branches</SelectLabel>
                {localBranches.map(branch => (
                  <SelectItem key={`local-${branch.name}`} value={branch.name}>
                    <div className="flex items-center gap-2">
                      {branch.name}
                      {branch.isHead && (
                        <span className="text-xs text-muted-foreground">✓</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {remoteBranches.length > 0 && (
              <SelectGroup>
                <SelectLabel>Remote Branches</SelectLabel>
                {remoteBranches.map(branch => (
                  <SelectItem key={`remote-${branch.name}`} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>

        {/* Current ref display */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 text-xs text-muted-foreground font-mono">
          {currentRefDisplay}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => onViewModeChange('browse')}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'browse'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            title="Browse mode"
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('diff')}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              viewMode === 'diff'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            }`}
            title="Diff mode"
          >
            <Columns2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Right side: Commit log, refresh, close */}
      <div className="flex items-center gap-2">
        {/* Commit log dropdown */}
        {commits.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 gap-1 text-xs"
                title="Recent commits"
              >
                <GitCommitIcon className="h-4 w-4" />
                <span className="text-muted-foreground">{commits.length}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-96 max-h-[400px] overflow-y-auto" align="end">
              {commits.map(commit => (
                <DropdownMenuItem
                  key={commit.sha}
                  onClick={() => onCommitSelect(commit.sha)}
                  className="flex items-start gap-2 px-2 py-1.5 cursor-pointer"
                >
                  <code className="text-xs font-mono text-muted-foreground shrink-0">
                    {commit.shortSha}
                  </code>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground line-clamp-2">
                      {commit.message}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatRelativeTime(commit.timestamp)}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Refresh button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          title="Refresh"
          className="h-8 w-8 p-0"
        >
          <RotateCw className="h-4 w-4" />
        </Button>

        {/* Close button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          title="Close"
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
