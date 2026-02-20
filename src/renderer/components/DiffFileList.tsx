import { useState, useEffect, useCallback } from 'react'
import { Pencil, Plus, Trash2, CheckCircle2, ArrowRightLeft, Undo2, List, FolderTree, ChevronRight, ChevronDown, Folder, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiffFile } from '@/shared/types'

interface DiffFileListProps {
  files: DiffFile[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  summary: { filesChanged: number; additions: number; deletions: number }
  onRevertFile?: (filepath: string) => void
  onRevertAll?: () => void
}

type ViewType = 'flat' | 'tree'

function CopyPathButton({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [path])

  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy path: ${path}`}
      className={cn(
        'p-0.5 rounded transition-all flex-shrink-0',
        copied
          ? 'text-green-500 opacity-100'
          : 'opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground',
        className
      )}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

const statusConfig = {
  modified: { icon: Pencil, color: 'text-yellow-500', letter: 'M', letterColor: 'text-yellow-500' },
  added: { icon: Plus, color: 'text-green-500', letter: 'A', letterColor: 'text-green-500' },
  deleted: { icon: Trash2, color: 'text-red-500', letter: 'D', letterColor: 'text-red-500' },
  renamed: { icon: ArrowRightLeft, color: 'text-blue-500', letter: 'R', letterColor: 'text-blue-500' },
  untracked: { icon: Plus, color: 'text-gray-400', letter: 'U', letterColor: 'text-gray-400' },
}

// Group files by status
function groupFilesByStatus(files: DiffFile[]) {
  return {
    modified: files.filter((f) => f.status === 'modified'),
    added: files.filter((f) => f.status === 'added'),
    deleted: files.filter((f) => f.status === 'deleted'),
    renamed: files.filter((f) => f.status === 'renamed'),
    untracked: files.filter((f) => f.status === 'untracked'),
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

// Build a tree structure from file paths
interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  file: DiffFile | null // null for directories
}

function buildFileTree(files: DiffFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), file: null }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          file: isFile ? file : null,
        })
      } else if (isFile) {
        const node = current.children.get(part)!
        node.file = file
      }

      current = current.children.get(part)!
    }
  }

  return root
}

// Collapse single-child directories into a combined path
function collapseTree(node: TreeNode): TreeNode {
  // Process children first
  const collapsedChildren = new Map<string, TreeNode>()
  for (const [, child] of node.children) {
    const collapsed = collapseTree(child)
    collapsedChildren.set(collapsed.name, collapsed)
  }
  node.children = collapsedChildren

  // Collapse: if this node is a directory with exactly one child that is also a directory
  if (node.file === null && node.children.size === 1) {
    const onlyChild = Array.from(node.children.values())[0]
    if (onlyChild.file === null) {
      // Merge: combine names
      return {
        name: node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name,
        path: onlyChild.path,
        children: onlyChild.children,
        file: null,
      }
    }
  }

  return node
}

function FileItem({
  file,
  isSelected,
  onSelect,
  onRevert,
  showIcon = true,
  indent = 0,
}: {
  file: DiffFile
  isSelected: boolean
  onSelect: () => void
  onRevert?: () => void
  showIcon?: boolean
  indent?: number
}) {
  const { icon: Icon, color } = statusConfig[file.status]
  const fileName = file.path.split('/').pop() || file.path
  const displayName = indent > 0 ? fileName : truncatePath(file.path)

  return (
    <div
      className={cn(
        'group w-full flex items-center gap-2 py-1.5 text-left text-sm transition-colors rounded-md cursor-pointer',
        'hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft: `${indent * 16 + 12}px`, paddingRight: '12px' }}
      onClick={onSelect}
      title={file.path}
    >
      {showIcon && <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />}
      {!showIcon && (
        <span className={cn('text-xs font-mono w-4 text-center flex-shrink-0', statusConfig[file.status].letterColor)}>
          {statusConfig[file.status].letter}
        </span>
      )}
      <span className="flex-1 truncate text-foreground">{displayName}</span>
      <div className="flex items-center gap-1 text-xs flex-shrink-0">
        <CopyPathButton path={file.path} />
        {file.additions > 0 && (
          <span className="text-green-500">+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className="text-red-500">-{file.deletions}</span>
        )}
        {onRevert && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRevert()
            }}
            title="Revert file"
            className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function FileGroup({
  title,
  files,
  selectedFile,
  onSelectFile,
  onRevertFile,
}: {
  title: string
  files: DiffFile[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onRevertFile?: (filepath: string) => void
}) {
  if (files.length === 0) return null

  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-2">
        {title}
      </h3>
      <div className="space-y-0.5">
        {files.map((file) => (
          <FileItem
            key={file.path}
            file={file}
            isSelected={selectedFile === file.path}
            onSelect={() => onSelectFile(file.path)}
            onRevert={onRevertFile ? () => onRevertFile(file.path) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function TreeDirectory({
  node,
  depth,
  selectedFile,
  onSelectFile,
  onRevertFile,
  expandedDirs,
  toggleDir,
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onRevertFile?: (filepath: string) => void
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
}) {
  const isExpanded = expandedDirs.has(node.path)

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    const aIsDir = a.file === null
    const bIsDir = b.file === null
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div>
      {/* Directory header (skip for root) */}
      {depth > 0 && (
        <div
          className={cn(
            'group flex items-center gap-1.5 py-1.5 text-sm cursor-pointer rounded-md',
            'hover:bg-accent/50 text-muted-foreground'
          )}
          style={{ paddingLeft: `${(depth - 1) * 16 + 12}px`, paddingRight: '12px' }}
          onClick={() => toggleDir(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
          )}
          <Folder className="w-4 h-4 flex-shrink-0 text-blue-400" />
          <span className="flex-1 truncate">{node.name}</span>
          <CopyPathButton path={node.path} />
        </div>
      )}

      {/* Children */}
      {(depth === 0 || isExpanded) && (
        <div>
          {sortedChildren.map((child) => {
            if (child.file) {
              // File leaf node
              return (
                <FileItem
                  key={child.file.path}
                  file={child.file}
                  isSelected={selectedFile === child.file.path}
                  onSelect={() => onSelectFile(child.file!.path)}
                  onRevert={onRevertFile ? () => onRevertFile(child.file!.path) : undefined}
                  showIcon={false}
                  indent={depth}
                />
              )
            } else {
              // Directory node
              return (
                <TreeDirectory
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  onRevertFile={onRevertFile}
                  expandedDirs={expandedDirs}
                  toggleDir={toggleDir}
                />
              )
            }
          })}
        </div>
      )}
    </div>
  )
}

function getAllDirPaths(node: TreeNode, paths: string[] = []): string[] {
  if (node.path && node.file === null) {
    paths.push(node.path)
  }
  for (const child of node.children.values()) {
    getAllDirPaths(child, paths)
  }
  return paths
}

export function DiffFileList({
  files,
  selectedFile,
  onSelectFile,
  summary,
  onRevertFile,
  onRevertAll,
}: DiffFileListProps) {
  const [viewType, setViewType] = useState<ViewType>('flat')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [treeInitialized, setTreeInitialized] = useState(false)

  const grouped = groupFilesByStatus(files)

  // Build and collapse the tree
  const tree = buildFileTree(files)
  const collapsedTree = collapseTree(tree)

  // Load persisted view type preference on mount
  useEffect(() => {
    window.electronAPI?.getPreferences?.().then(prefs => {
      if (prefs?.diffFileViewType) {
        setViewType(prefs.diffFileViewType)
      }
    })
  }, [])

  // Auto-initialize tree when view type is 'tree' and not yet initialized
  useEffect(() => {
    if (viewType === 'tree' && !treeInitialized && files.length > 0) {
      const allDirs = getAllDirPaths(collapsedTree)
      setExpandedDirs(new Set(allDirs))
      setTreeInitialized(true)
    }
  }, [viewType, treeInitialized, files.length, collapsedTree])

  // Initialize expanded dirs to all when first switching to tree view
  const initializeTreeExpanded = () => {
    if (!treeInitialized) {
      const allDirs = getAllDirPaths(collapsedTree)
      setExpandedDirs(new Set(allDirs))
      setTreeInitialized(true)
    }
  }

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

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
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">
            {summary.filesChanged} file{summary.filesChanged !== 1 ? 's' : ''}{' '}
            changed
          </div>
          <div className="flex items-center gap-1">
            {onRevertAll && (
              <button
                onClick={onRevertAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                title="Revert all files"
              >
                <Undo2 className="w-3 h-3" />
                Revert All
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-500">+{summary.additions}</span>
            <span className="text-red-500">-{summary.deletions}</span>
          </div>
          {/* View toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => {
                setViewType('flat')
                window.electronAPI?.setPreferences?.({ diffFileViewType: 'flat' })
              }}
              className={cn(
                'p-1 transition-colors',
                viewType === 'flat'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              )}
              title="Flat list view"
              data-testid="diff-view-flat"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setViewType('tree')
                initializeTreeExpanded()
                window.electronAPI?.setPreferences?.({ diffFileViewType: 'tree' })
              }}
              className={cn(
                'p-1 transition-colors',
                viewType === 'tree'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              )}
              title="Tree view"
              data-testid="diff-view-tree"
            >
              <FolderTree className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto py-2">
        {viewType === 'flat' ? (
          <>
            <FileGroup
              title="Modified"
              files={grouped.modified}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRevertFile={onRevertFile}
            />
            <FileGroup
              title="Added"
              files={grouped.added}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRevertFile={onRevertFile}
            />
            <FileGroup
              title="Renamed"
              files={grouped.renamed}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRevertFile={onRevertFile}
            />
            <FileGroup
              title="Deleted"
              files={grouped.deleted}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRevertFile={onRevertFile}
            />
            <FileGroup
              title="Untracked"
              files={grouped.untracked}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              onRevertFile={onRevertFile}
            />
          </>
        ) : (
          <TreeDirectory
            node={collapsedTree}
            depth={0}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            onRevertFile={onRevertFile}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
          />
        )}
      </div>
    </div>
  )
}
