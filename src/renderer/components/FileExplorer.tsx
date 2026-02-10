import { useState, useEffect, useMemo } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  FileCode,
  FileText,
  FileJson,
  Image,
  Search,
  X,
  List,
  FolderTree
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiffFile } from '@/shared/types'

interface FileExplorerProps {
  directory: string
  selectedFile: string | null
  onSelectFile: (path: string) => void
  changedFiles?: DiffFile[]
  showChangedOnly?: boolean
  onToggleChangedOnly?: (value: boolean) => void
}

type ViewType = 'flat' | 'tree'

// Tree node structure for building the file tree
interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  isFile: boolean
  size?: number
  isChanged?: boolean
  isUntracked?: boolean
}

// File icons based on extension
function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()

  if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'rb'].includes(ext || '')) {
    return FileCode
  }
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext || '')) {
    return FileJson
  }
  if (['md', 'txt', 'log'].includes(ext || '')) {
    return FileText
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext || '')) {
    return Image
  }

  return File
}

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// Build a tree structure from file paths
function buildFileTree(files: string[], changedFilesSet?: Set<string>): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false }

  for (const filepath of files) {
    const parts = filepath.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path,
          children: new Map(),
          isFile,
          isChanged: changedFilesSet?.has(path),
          isUntracked: false // Will be set later if needed
        })
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
  if (!node.isFile && node.children.size === 1) {
    const onlyChild = Array.from(node.children.values())[0]
    if (!onlyChild.isFile) {
      // Merge: combine names
      return {
        name: node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name,
        path: onlyChild.path,
        children: onlyChild.children,
        isFile: false,
        isChanged: node.isChanged || onlyChild.isChanged,
        isUntracked: node.isUntracked || onlyChild.isUntracked
      }
    }
  }

  return node
}

// Get all directory paths from a tree (for expand all functionality)
function getAllDirPaths(node: TreeNode, paths: string[] = []): string[] {
  if (node.path && !node.isFile) {
    paths.push(node.path)
  }
  for (const child of node.children.values()) {
    getAllDirPaths(child, paths)
  }
  return paths
}

// Filter tree based on search query
function filterTree(node: TreeNode, query: string): TreeNode | null {
  if (!query) return node

  const lowerQuery = query.toLowerCase()

  // If this is a file and matches, include it
  if (node.isFile) {
    if (node.name.toLowerCase().includes(lowerQuery)) {
      return node
    }
    return null
  }

  // For directories, recursively filter children
  const filteredChildren = new Map<string, TreeNode>()
  for (const [key, child] of node.children) {
    const filtered = filterTree(child, query)
    if (filtered) {
      filteredChildren.set(key, filtered)
    }
  }

  // Include directory if it has matching children or if the directory name itself matches
  if (filteredChildren.size > 0 || node.name.toLowerCase().includes(lowerQuery)) {
    return {
      ...node,
      children: filteredChildren
    }
  }

  return null
}

function FileItem({
  node,
  isSelected,
  onSelect,
  indent = 0
}: {
  node: TreeNode
  isSelected: boolean
  onSelect: () => void
  indent?: number
}) {
  const Icon = getFileIcon(node.name)

  return (
    <div
      className={cn(
        'group w-full flex items-center gap-2 py-1.5 text-left text-sm transition-colors rounded-md cursor-pointer',
        'hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft: `${indent * 16 + 12}px`, paddingRight: '12px' }}
      onClick={onSelect}
      title={node.path}
    >
      <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      <span className={cn(
        'flex-1 truncate',
        node.isChanged && 'text-yellow-500',
        node.isUntracked && 'text-green-500',
        !node.isChanged && !node.isUntracked && 'text-foreground'
      )}>
        {node.name}
      </span>
      {node.size && (
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {formatSize(node.size)}
        </span>
      )}
      {node.isChanged && (
        <span className="text-xs text-yellow-500 font-mono flex-shrink-0">M</span>
      )}
      {node.isUntracked && (
        <span className="text-xs text-green-500 font-mono flex-shrink-0">U</span>
      )}
    </div>
  )
}

function TreeDirectory({
  node,
  depth,
  selectedFile,
  onSelectFile,
  expandedDirs,
  toggleDir,
  searchQuery
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onSelectFile: (path: string) => void
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
  searchQuery: string
}) {
  const isExpanded = searchQuery ? true : expandedDirs.has(node.path)

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    const aIsDir = !a.isFile
    const bIsDir = !b.isFile
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })

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
          <Folder className="w-4 h-4 flex-shrink-0 text-blue-400" />
          <span className="truncate">{node.name}</span>
        </div>
      )}

      {/* Children */}
      {(depth === 0 || isExpanded) && (
        <div>
          {sortedChildren.map((child) => {
            if (child.isFile) {
              // File leaf node
              return (
                <FileItem
                  key={child.path}
                  node={child}
                  isSelected={selectedFile === child.path}
                  onSelect={() => onSelectFile(child.path)}
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
                  expandedDirs={expandedDirs}
                  toggleDir={toggleDir}
                  searchQuery={searchQuery}
                />
              )
            }
          })}
        </div>
      )}
    </div>
  )
}

export function FileExplorer({
  directory,
  selectedFile,
  onSelectFile,
  changedFiles = [],
  showChangedOnly = false,
  onToggleChangedOnly
}: FileExplorerProps) {
  const [viewType, setViewType] = useState<ViewType>('tree')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  const [treeInitialized, setTreeInitialized] = useState(false)
  const [allFiles, setAllFiles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Create a set of changed file paths for quick lookup
  const changedFilesSet = useMemo(() => {
    return new Set(changedFiles.map(f => f.path))
  }, [changedFiles])

  // Load file tree from backend
  useEffect(() => {
    let mounted = true

    async function loadFileTree() {
      if (!directory) return

      setLoading(true)
      setError(null)

      try {
        const files = await window.electronAPI.getFileTree(directory)
        if (mounted) {
          setAllFiles(files)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load file tree')
          setLoading(false)
        }
      }
    }

    loadFileTree()

    return () => {
      mounted = false
    }
  }, [directory])

  // Determine which files to display
  const displayFiles = useMemo(() => {
    if (showChangedOnly) {
      return changedFiles.map(f => f.path)
    }
    return allFiles
  }, [showChangedOnly, allFiles, changedFiles])

  // Build and collapse the tree
  const tree = useMemo(() => {
    const built = buildFileTree(displayFiles, changedFilesSet)
    return collapseTree(built)
  }, [displayFiles, changedFilesSet])

  // Apply search filter
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree
    return filterTree(tree, searchQuery) || tree
  }, [tree, searchQuery])

  // Auto-initialize tree when first loaded
  useEffect(() => {
    if (viewType === 'tree' && !treeInitialized && displayFiles.length > 0) {
      const allDirs = getAllDirPaths(tree)
      setExpandedDirs(new Set(allDirs))
      setTreeInitialized(true)
    }
  }, [viewType, treeInitialized, displayFiles.length, tree])

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

  const handleClearSearch = () => {
    setSearchQuery('')
  }

  // Loading state
  if (loading) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading files...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground p-4">
        <p className="text-sm text-red-500 text-center">{error}</p>
      </div>
    )
  }

  // Empty state
  if (displayFiles.length === 0) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <Folder className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">
          {showChangedOnly ? 'No changed files' : 'No files found'}
        </p>
      </div>
    )
  }

  return (
    <div className="w-[280px] h-full border-r border-border bg-background flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-foreground">
            Files ({displayFiles.length})
          </div>
          {onToggleChangedOnly && (
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={() => onToggleChangedOnly(false)}
                className={cn(
                  'px-2 py-1 text-xs transition-colors',
                  !showChangedOnly
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent'
                )}
                title="Show all files"
              >
                All
              </button>
              <button
                onClick={() => onToggleChangedOnly(true)}
                className={cn(
                  'px-2 py-1 text-xs transition-colors',
                  showChangedOnly
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent'
                )}
                title="Show changed files only"
              >
                Changed
              </button>
            </div>
          )}
        </div>

        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-8 pr-7 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        <TreeDirectory
          node={filteredTree}
          depth={0}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          expandedDirs={expandedDirs}
          toggleDir={toggleDir}
          searchQuery={searchQuery}
        />
      </div>
    </div>
  )
}
