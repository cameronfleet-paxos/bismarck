import { useState, useEffect, useMemo } from 'react'
import { ChevronRight, ChevronDown, Folder, FileCode, FileText, File, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/renderer/components/ui/input'

interface CodeEditorFileTreeProps {
  files: string[]
  selectedFile: string | null
  onSelectFile: (path: string) => void
  isLoading: boolean
}

// Build a tree structure from flat file paths
interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  isFile: boolean
}

function buildFileTree(files: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false }

  for (const filePath of files) {
    const parts = filePath.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1

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
      }
    }
  }

  return node
}

// Get file extension
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  return lastDot === -1 ? '' : filename.slice(lastDot)
}

// Get icon and color for file based on extension
function getFileIcon(filename: string): { Icon: typeof FileCode; color: string } {
  const ext = getFileExtension(filename)

  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
      return { Icon: FileCode, color: 'text-blue-400' }
    case '.json':
    case '.yaml':
    case '.yml':
      return { Icon: FileCode, color: 'text-yellow-400' }
    case '.md':
    case '.txt':
      return { Icon: FileText, color: 'text-muted-foreground' }
    case '.css':
    case '.scss':
    case '.sass':
      return { Icon: FileCode, color: 'text-purple-400' }
    default:
      return { Icon: File, color: 'text-muted-foreground' }
  }
}

function FileItem({
  path,
  name,
  isSelected,
  onSelect,
  indent,
}: {
  path: string
  name: string
  isSelected: boolean
  onSelect: () => void
  indent: number
}) {
  const { Icon, color } = getFileIcon(name)

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-1.5 text-left text-sm transition-colors rounded-md cursor-pointer',
        'hover:bg-accent/50',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft: `${indent * 16 + 12}px`, paddingRight: '12px' }}
      onClick={onSelect}
      title={path}
    >
      <Icon className={cn('w-4 h-4 flex-shrink-0', color)} />
      <span className="flex-1 truncate text-foreground">{name}</span>
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
  searchQuery,
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onSelectFile: (path: string) => void
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
  searchQuery: string
}) {
  const isExpanded = expandedDirs.has(node.path)

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  // Filter children based on search query
  const filteredChildren = searchQuery
    ? sortedChildren.filter((child) => {
        if (child.isFile) {
          // For files, match by name
          return child.name.toLowerCase().includes(searchQuery.toLowerCase())
        } else {
          // For directories, include if any descendant matches
          return hasMatchingDescendant(child, searchQuery)
        }
      })
    : sortedChildren

  // If searching and no matches in this subtree, don't render
  if (searchQuery && filteredChildren.length === 0 && depth > 0) {
    return null
  }

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
          {filteredChildren.length === 0 && depth > 0 && !searchQuery ? (
            <div
              className="text-xs text-muted-foreground italic py-1.5"
              style={{ paddingLeft: `${depth * 16 + 12}px`, paddingRight: '12px' }}
            >
              (empty)
            </div>
          ) : (
            filteredChildren.map((child) => {
              if (child.isFile) {
                // File leaf node
                return (
                  <FileItem
                    key={child.path}
                    path={child.path}
                    name={child.name}
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
            })
          )}
        </div>
      )}
    </div>
  )
}

// Check if a tree node has any descendant matching the search query
function hasMatchingDescendant(node: TreeNode, query: string): boolean {
  const lowerQuery = query.toLowerCase()

  for (const child of node.children.values()) {
    if (child.isFile) {
      if (child.name.toLowerCase().includes(lowerQuery)) {
        return true
      }
    } else {
      if (hasMatchingDescendant(child, query)) {
        return true
      }
    }
  }

  return false
}

// Get all directory paths from tree
function getAllDirPaths(node: TreeNode, paths: string[] = []): string[] {
  if (node.path && !node.isFile) {
    paths.push(node.path)
  }
  for (const child of node.children.values()) {
    getAllDirPaths(child, paths)
  }
  return paths
}

// Get all directory paths that contain matching files
function getMatchingDirPaths(node: TreeNode, query: string, paths: string[] = []): string[] {
  if (node.path && !node.isFile && hasMatchingDescendant(node, query)) {
    paths.push(node.path)
  }
  for (const child of node.children.values()) {
    if (!child.isFile) {
      getMatchingDirPaths(child, query, paths)
    }
  }
  return paths
}

export function CodeEditorFileTree({
  files,
  selectedFile,
  onSelectFile,
  isLoading,
}: CodeEditorFileTreeProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())

  // Build and collapse the tree
  const tree = useMemo(() => {
    const built = buildFileTree(files)
    return collapseTree(built)
  }, [files])

  // Auto-expand all directories on initial load
  useEffect(() => {
    if (files.length > 0 && expandedDirs.size === 0) {
      const allDirs = getAllDirPaths(tree)
      setExpandedDirs(new Set(allDirs))
    }
  }, [files.length, tree, expandedDirs.size])

  // Auto-expand directories containing matches when searching
  useEffect(() => {
    if (searchQuery) {
      const matchingDirs = getMatchingDirPaths(tree, searchQuery)
      setExpandedDirs(new Set(matchingDirs))
    } else {
      // Reset to all expanded when clearing search
      const allDirs = getAllDirPaths(tree)
      setExpandedDirs(new Set(allDirs))
    }
  }, [searchQuery, tree])

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

  const clearSearch = () => {
    setSearchQuery('')
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading files...</p>
      </div>
    )
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">No files found</p>
      </div>
    )
  }

  return (
    <div className="w-[280px] h-full border-r border-border bg-background flex flex-col">
      {/* Search Header */}
      <div className="px-3 py-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        <TreeDirectory
          node={tree}
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
