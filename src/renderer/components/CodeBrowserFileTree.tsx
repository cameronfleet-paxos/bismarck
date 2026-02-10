import { useState, useEffect } from 'react'
import { Folder, FolderOpen, ChevronRight, ChevronDown, File } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileTreeEntry, GitBranch } from '@/shared/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CodeBrowserFileTreeProps {
  directory: string
  selectedFile: string | null
  onSelectFile: (path: string) => void
  currentRef?: string
  onRefChange?: (ref: string) => void
}

// Build a tree structure from file paths
interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  isFile: boolean
}

function buildFileTree(files: FileTreeEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false }

  for (const entry of files) {
    const parts = entry.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1 && entry.type === 'file'

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          isFile,
        })
      }

      current = current.children.get(part)!
    }
  }

  return root
}

function FileTreeNode({
  node,
  depth,
  selectedFile,
  onSelectFile,
  expandedDirs,
  toggleDir,
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onSelectFile: (path: string) => void
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
}) {
  const isExpanded = expandedDirs.has(node.path)

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    const aIsDir = !a.isFile
    const bIsDir = !b.isFile
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  if (node.isFile) {
    // File leaf node
    const isSelected = selectedFile === node.path
    return (
      <div
        className={cn(
          'group w-full flex items-center gap-2 py-1.5 text-left text-sm transition-colors rounded-md cursor-pointer',
          'hover:bg-accent/50',
          isSelected && 'bg-accent'
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px`, paddingRight: '12px' }}
        onClick={() => onSelectFile(node.path)}
        title={node.path}
      >
        <File className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-foreground">{node.name}</span>
      </div>
    )
  }

  // Directory node
  return (
    <div>
      {/* Directory header (skip for root) */}
      {depth > 0 && (
        <div
          className={cn(
            'flex items-center gap-1.5 py-1.5 text-sm cursor-pointer rounded-md',
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
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-blue-400" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0 text-blue-400" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
      )}

      {/* Children */}
      {(depth === 0 || isExpanded) && (
        <div>
          {sortedChildren.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function getAllDirPaths(node: TreeNode, paths: string[] = []): string[] {
  if (node.path && !node.isFile) {
    paths.push(node.path)
  }
  for (const child of node.children.values()) {
    getAllDirPaths(child, paths)
  }
  return paths
}

export function CodeBrowserFileTree({
  directory,
  selectedFile,
  onSelectFile,
  currentRef,
  onRefChange,
}: CodeBrowserFileTreeProps) {
  const [files, setFiles] = useState<FileTreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())

  // Load file tree
  useEffect(() => {
    setLoading(true)
    setError(null)
    window.electronAPI
      .getFileTree(directory, currentRef)
      .then((fileTree) => {
        setFiles(fileTree)
        // Auto-expand all directories on initial load
        const tree = buildFileTree(fileTree)
        const allDirs = getAllDirPaths(tree)
        setExpandedDirs(new Set(allDirs))
      })
      .catch((err) => {
        setError(err.message || 'Failed to load file tree')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [directory, currentRef])

  // Load branches
  useEffect(() => {
    window.electronAPI
      .getGitBranches(directory)
      .then(setBranches)
      .catch((err) => {
        console.error('Failed to load branches:', err)
      })
  }, [directory])

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const tree = buildFileTree(files)

  // Determine current ref display value
  const currentBranch = branches.find((b) => b.isCurrent)
  const displayRef = currentRef || currentBranch?.name || 'HEAD'

  return (
    <div className="w-[280px] h-full border-r border-border bg-background flex flex-col">
      {/* Branch selector header */}
      {onRefChange && branches.length > 0 && (
        <div className="px-3 py-3 border-b border-border">
          <Select value={displayRef} onValueChange={onRefChange}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.isCurrent && ' (current)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading...
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full text-destructive text-sm px-4 text-center">
            <p className="font-medium">Error</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No files found
          </div>
        )}
        {!loading && !error && files.length > 0 && (
          <FileTreeNode
            node={tree}
            depth={0}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
          />
        )}
      </div>
    </div>
  )
}
