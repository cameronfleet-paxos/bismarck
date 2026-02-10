import { useState, useEffect, useCallback } from 'react'
import { File, Folder, ChevronRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DirectoryEntry } from '@/shared/types'

interface CodeEditorFileTreeProps {
  directory: string
  onSelectFile: (filepath: string) => void
  selectedFile: string | null
}

// Tree node structure for building the file tree
interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children: Map<string, TreeNode>
  isLoaded: boolean // Track if directory contents have been fetched
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTreeItem({
  node,
  depth,
  selectedFile,
  onSelectFile,
  expandedDirs,
  toggleDir,
  onLoadChildren,
}: {
  node: TreeNode
  depth: number
  selectedFile: string | null
  onSelectFile: (path: string) => void
  expandedDirs: Set<string>
  toggleDir: (path: string) => void
  onLoadChildren: (path: string) => Promise<void>
}) {
  const isExpanded = expandedDirs.has(node.path)
  const isSelected = selectedFile === node.path

  const handleClick = async () => {
    if (node.type === 'directory') {
      // If directory not loaded yet, load it first
      if (!node.isLoaded) {
        await onLoadChildren(node.path)
      }
      toggleDir(node.path)
    } else {
      onSelectFile(node.path)
    }
  }

  // Sort children: directories first, then files, both alphabetically
  const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div>
      {/* Item header */}
      <div
        className={cn(
          'flex items-center gap-1.5 py-1.5 text-sm cursor-pointer rounded-md transition-colors',
          'hover:bg-accent/50',
          isSelected && 'bg-accent',
          node.type === 'directory' && 'text-muted-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px`, paddingRight: '12px' }}
        onClick={handleClick}
        title={node.path}
      >
        {node.type === 'directory' && (
          <>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            <Folder className="w-4 h-4 flex-shrink-0 text-blue-400" />
          </>
        )}
        {node.type === 'file' && (
          <File className="w-4 h-4 flex-shrink-0 text-muted-foreground ml-5" />
        )}
        <span className="flex-1 truncate text-foreground">{node.name}</span>
        {node.type === 'file' && node.size !== undefined && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {formatFileSize(node.size)}
          </span>
        )}
      </div>

      {/* Children (only render if directory is expanded) */}
      {node.type === 'directory' && isExpanded && (
        <div>
          {sortedChildren.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CodeEditorFileTree({
  directory,
  onSelectFile,
  selectedFile,
}: CodeEditorFileTreeProps) {
  const [rootNode, setRootNode] = useState<TreeNode>({
    name: '',
    path: '',
    type: 'directory',
    children: new Map(),
    isLoaded: false,
  })
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(['']))
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load directory contents from backend
  const loadDirectoryContents = useCallback(async (relativePath: string = '') => {
    try {
      const listing = await window.electronAPI.listDirectoryContents(directory, relativePath)
      return listing.entries
    } catch (err) {
      console.error('Failed to load directory contents:', err)
      throw err
    }
  }, [directory])

  // Update tree node with loaded children
  const updateNodeWithChildren = useCallback((
    node: TreeNode,
    targetPath: string,
    entries: DirectoryEntry[]
  ): TreeNode => {
    if (node.path === targetPath) {
      // This is the target node - update it with children
      const children = new Map<string, TreeNode>()
      for (const entry of entries) {
        children.set(entry.name, {
          name: entry.name,
          path: entry.path,
          type: entry.type,
          size: entry.size,
          children: new Map(),
          isLoaded: false,
        })
      }
      return {
        ...node,
        children,
        isLoaded: true,
      }
    }

    // Recursively search children
    const updatedChildren = new Map<string, TreeNode>()
    for (const [key, child] of node.children) {
      if (targetPath.startsWith(child.path + '/') || targetPath === child.path) {
        updatedChildren.set(key, updateNodeWithChildren(child, targetPath, entries))
      } else {
        updatedChildren.set(key, child)
      }
    }

    return {
      ...node,
      children: updatedChildren,
    }
  }, [])

  // Load children for a specific directory path
  const onLoadChildren = useCallback(async (path: string) => {
    try {
      const entries = await loadDirectoryContents(path)
      setRootNode(prev => updateNodeWithChildren(prev, path, entries))
    } catch (err) {
      console.error('Failed to load children for path:', path, err)
      setError(`Failed to load directory: ${path}`)
    }
  }, [loadDirectoryContents, updateNodeWithChildren])

  // Load root directory on mount
  useEffect(() => {
    const loadRoot = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const entries = await loadDirectoryContents('')
        setRootNode({
          name: '',
          path: '',
          type: 'directory',
          children: new Map(entries.map(entry => [
            entry.name,
            {
              name: entry.name,
              path: entry.path,
              type: entry.type,
              size: entry.size,
              children: new Map(),
              isLoaded: false,
            }
          ])),
          isLoaded: true,
        })
      } catch (err) {
        setError('Failed to load repository files')
        console.error('Failed to load root directory:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadRoot()
  }, [directory, loadDirectoryContents])

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

  // Loading state
  if (isLoading) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading files...</p>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  // Empty state
  if (rootNode.children.size === 0) {
    return (
      <div className="w-[280px] h-full border-r border-border bg-background flex flex-col items-center justify-center text-muted-foreground">
        <Folder className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-sm">No files found</p>
      </div>
    )
  }

  return (
    <div className="w-[280px] h-full border-r border-border bg-background flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 border-b border-border">
        <div className="text-sm font-medium text-foreground">
          Files
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {Array.from(rootNode.children.values())
          .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
          .map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={0}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              onLoadChildren={onLoadChildren}
            />
          ))}
      </div>
    </div>
  )
}
