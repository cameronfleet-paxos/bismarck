import { Pencil, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiffFile } from '@/shared/types'

interface DiffFileListProps {
  files: DiffFile[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  summary: { filesChanged: number; additions: number; deletions: number }
}

// Group files by status
function groupFilesByStatus(files: DiffFile[]) {
  return {
    modified: files.filter((f) => f.status === 'modified'),
    added: files.filter((f) => f.status === 'added'),
    deleted: files.filter((f) => f.status === 'deleted'),
  }
}

// Truncate long paths with ellipsis in the middle
function truncatePath(path: string, maxLength = 35): string {
  if (path.length <= maxLength) return path
  const parts = path.split('/')
  if (parts.length === 1) {
    // Single file name - truncate with ellipsis at end
    return path.slice(0, maxLength - 3) + '...'
  }
  // Multi-part path - show start and end
  const fileName = parts[parts.length - 1]
  const dirPath = parts.slice(0, -1).join('/')
  if (fileName.length + 10 >= maxLength) {
    // File name itself is long
    return '.../' + fileName.slice(0, maxLength - 7) + '...'
  }
  const remainingLength = maxLength - fileName.length - 4 // 4 for '.../'
  return dirPath.slice(0, remainingLength) + '.../' + fileName
}

function FileItem({
  file,
  isSelected,
  onSelect,
}: {
  file: DiffFile
  isSelected: boolean
  onSelect: () => void
}) {
  const statusConfig = {
    modified: { icon: Pencil, color: 'text-yellow-500' },
    added: { icon: Plus, color: 'text-green-500' },
    deleted: { icon: Trash2, color: 'text-red-500' },
  }

  const { icon: Icon, color } = statusConfig[file.status]
  const truncated = truncatePath(file.path)

  return (
    <button
      onClick={onSelect}
      title={file.path}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors rounded-md',
        'hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
      <span className="flex-1 truncate text-foreground">{truncated}</span>
      <div className="flex items-center gap-1 text-xs flex-shrink-0">
        {file.additions > 0 && (
          <span className="text-green-500">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-red-500">-{file.deletions}</span>
        )}
      </div>
    </button>
  )
}

function FileGroup({
  title,
  files,
  selectedFile,
  onSelectFile,
}: {
  title: string
  files: DiffFile[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
}) {
  if (files.length === 0) return null

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
        {title}
      </h3>
      <div className="space-y-1">
        {files.map((file) => (
          <FileItem
            key={file.path}
            file={file}
            isSelected={selectedFile === file.path}
            onSelect={() => onSelectFile(file.path)}
          />
        ))}
      </div>
    </div>
  )
}

export function DiffFileList({
  files,
  selectedFile,
  onSelectFile,
  summary,
}: DiffFileListProps) {
  const grouped = groupFilesByStatus(files)

  // Empty state
  if (files.length === 0) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <CheckCircle2 className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">No changes</p>
      </div>
    )
  }

  return (
    <div className="w-[280px] h-full border-r border-border bg-background flex flex-col">
      {/* Summary Header */}
      <div className="px-3 py-3 border-b border-border">
        <div className="text-sm font-medium text-foreground">
          {summary.filesChanged} file{summary.filesChanged !== 1 ? 's' : ''}{' '}
          changed
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs">
          <span className="text-green-500">+{summary.additions}</span>
          <span className="text-red-500">-{summary.deletions}</span>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto py-3">
        <FileGroup
          title="Modified"
          files={grouped.modified}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
        <FileGroup
          title="Added"
          files={grouped.added}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
        <FileGroup
          title="Deleted"
          files={grouped.deleted}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
        />
      </div>
    </div>
  )
}
