import { useState, useEffect, useCallback, useRef } from 'react'
import { X, RotateCw, Columns2, FileText, ChevronUp, ChevronDown, Save, Copy, Check, GitCommitHorizontal, ChevronRight } from 'lucide-react'
import { DiffFileList } from './DiffFileList'
import { DiffViewer } from './DiffViewer'
import type { DiffFile, FileDiffContent } from '@/shared/types'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'

export interface DiffOverlayProps {
  directory: string
  onClose: () => void
  baseRef?: string        // If set, diff baseRef...HEAD instead of working tree vs HEAD
  readOnly?: boolean      // Hide revert/save buttons
  autoRefreshMs?: number  // Poll interval for refreshing file list
}

interface CommitInfo {
  sha: string
  shortSha: string
  message: string
  timestamp: string
}

type ViewMode = 'unified' | 'split'

export function DiffOverlay({ directory, onClose, baseRef, readOnly, autoRefreshMs }: DiffOverlayProps) {
  const [files, setFiles] = useState<DiffFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffCache, setDiffCache] = useState<Map<string, FileDiffContent>>(new Map())
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set())
  const [editedContent, setEditedContent] = useState<Map<string, string>>(new Map())
  const [revertConfirm, setRevertConfirm] = useState<{ type: 'file'; path: string } | { type: 'all' } | null>(null)
  const [copiedPath, setCopiedPath] = useState(false)

  // Commit list state (only used when baseRef is set)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null) // null = all changes
  const [commitsExpanded, setCommitsExpanded] = useState(true)

  // Track the currently displayed file diff to avoid re-fetching on auto-refresh
  const currentDiffFileRef = useRef<string | null>(null)

  // Load persisted view mode preference on mount
  useEffect(() => {
    window.electronAPI?.getPreferences?.().then(prefs => {
      if (prefs?.diffViewMode) {
        setViewMode(prefs.diffViewMode)
      }
    })
  }, [])

  // Load file list on mount
  useEffect(() => {
    loadFileList()
    if (baseRef) {
      loadCommits()
    }
  }, [directory, baseRef])

  // Auto-refresh when autoRefreshMs is set
  useEffect(() => {
    if (!autoRefreshMs) return
    const interval = setInterval(() => {
      loadFileList(true)
      if (baseRef) {
        loadCommits()
      }
    }, autoRefreshMs)
    return () => clearInterval(interval)
  }, [autoRefreshMs, directory, baseRef, selectedCommit])

  // Auto-select first file when list loads
  useEffect(() => {
    if (files.length > 0 && selectedFile === null) {
      setSelectedFile(files[0].path)
    }
  }, [files, selectedFile])

  // Load diff when selected file or selected commit changes
  useEffect(() => {
    if (selectedFile) {
      loadFileDiff(selectedFile)
    }
  }, [selectedFile, selectedCommit])

  // Track current diff file for auto-refresh
  useEffect(() => {
    currentDiffFileRef.current = selectedFile
  }, [selectedFile])

  function navigatePrevFile() {
    if (files.length === 0 || !selectedFile) return
    const currentIndex = files.findIndex(f => f.path === selectedFile)
    if (currentIndex === -1) return
    const newIndex = currentIndex === 0 ? files.length - 1 : currentIndex - 1
    setSelectedFile(files[newIndex].path)
  }

  function navigateNextFile() {
    if (files.length === 0 || !selectedFile) return
    const currentIndex = files.findIndex(f => f.path === selectedFile)
    if (currentIndex === -1) return
    const newIndex = currentIndex === files.length - 1 ? 0 : currentIndex + 1
    setSelectedFile(files[newIndex].path)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape: Close overlay (always works, even from inputs)
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      // Don't intercept keys when user is typing in an input field
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return
      }

      // r: Refresh diff data
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        handleRefresh()
        return
      }

      // Cmd+S: Save current file edits
      if (e.key === 's' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (readOnly) return
        e.preventDefault()
        e.stopPropagation()
        handleSave()
        return
      }

      // Cmd+Shift+S: Toggle view mode
      if (e.key === 's' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        setViewMode(prev => {
          const next = prev === 'unified' ? 'split' : 'unified'
          window.electronAPI?.setPreferences?.({ diffViewMode: next })
          return next
        })
        return
      }

      // Up/Down arrows: Navigate file list
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (files.length === 0 || !selectedFile) return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'ArrowUp') {
          navigatePrevFile()
        } else {
          navigateNextFile()
        }
        return
      }

    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [files, selectedFile, onClose, handleRefresh, handleSave, readOnly])

  async function loadFileList(isAutoRefresh = false) {
    if (!isAutoRefresh) {
      setIsLoading(true)
    }
    setError(null)
    try {
      let result
      if (selectedCommit) {
        // Show files for a specific commit
        result = await window.electronAPI.getChangedFilesForCommit(directory, selectedCommit)
      } else if (baseRef) {
        // All changes since base ref (committed + uncommitted)
        result = await window.electronAPI.getChangedFilesFromRef(directory, baseRef)
      } else {
        // Local changes: working tree diff vs HEAD (uncommitted only)
        result = await window.electronAPI.getChangedFiles(directory)
      }
      setFiles(result.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changed files')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadCommits() {
    if (!baseRef) return
    try {
      const commitList = await window.electronAPI.getCommitsBetween(directory, baseRef, 'HEAD')
      setCommits(commitList)
    } catch {
      // Silently fail - commits are supplementary info
    }
  }

  async function loadFileDiff(filepath: string) {
    // Build cache key that includes commit context
    const cacheKey = selectedCommit ? `${selectedCommit}:${filepath}` : filepath

    // Check cache first
    if (diffCache.has(cacheKey)) {
      return
    }

    setIsDiffLoading(true)
    setDiffError(null)
    try {
      let content: FileDiffContent
      if (selectedCommit) {
        content = await window.electronAPI.getFileDiffForCommit(directory, filepath, selectedCommit)
      } else if (baseRef) {
        // All changes since base ref (committed + uncommitted)
        content = await window.electronAPI.getFileDiffFromRef(directory, filepath, baseRef)
      } else {
        // Local changes: working tree diff vs HEAD
        content = await window.electronAPI.getFileDiff(directory, filepath)
      }
      setDiffCache(prev => new Map(prev).set(cacheKey, content))
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to load diff')
    } finally {
      setIsDiffLoading(false)
    }
  }

  function handleRefresh() {
    // Clear cache and reload
    setDiffCache(new Map())
    setSelectedFile(null)
    loadFileList()
    if (baseRef) {
      loadCommits()
    }
  }

  function handleSelectFile(filepath: string) {
    setSelectedFile(filepath)
    setDiffError(null) // Clear any previous diff errors
  }

  function handleSelectCommit(sha: string | null) {
    setSelectedCommit(sha)
    setDiffCache(new Map()) // Clear cache when switching commit scope
    setSelectedFile(null)
    // File list will reload via useEffect on selectedCommit change triggering loadFileList
  }

  // Reload file list when selectedCommit changes
  useEffect(() => {
    loadFileList()
  }, [selectedCommit])

  const handleContentChange = useCallback((content: string) => {
    if (!selectedFile || readOnly) return
    setEditedContent(prev => new Map(prev).set(selectedFile, content))
    setDirtyFiles(prev => new Set(prev).add(selectedFile))
  }, [selectedFile, readOnly])

  async function handleSave() {
    if (readOnly) return
    if (!selectedFile || !editedContent.has(selectedFile)) return
    const savingFile = selectedFile
    const savedContent = editedContent.get(savingFile)!
    try {
      await window.electronAPI.writeFileContent(directory, savingFile, savedContent)
      // Clear dirty state
      setDirtyFiles(prev => {
        const next = new Set(prev)
        next.delete(savingFile)
        return next
      })
      setEditedContent(prev => {
        const next = new Map(prev)
        next.delete(savingFile)
        return next
      })
      // Update the cache in-place with the new content (avoids destroying/recreating the editor)
      setDiffCache(prev => {
        const existing = prev.get(savingFile)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(savingFile, { ...existing, newContent: savedContent })
        return next
      })
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to save file')
    }
  }

  async function handleRevertFile(filepath: string) {
    try {
      await window.electronAPI.revertFile(directory, filepath)
      // Clear edited state for this file
      setDirtyFiles(prev => {
        const next = new Set(prev)
        next.delete(filepath)
        return next
      })
      setEditedContent(prev => {
        const next = new Map(prev)
        next.delete(filepath)
        return next
      })
      setDiffCache(prev => {
        const next = new Map(prev)
        next.delete(filepath)
        return next
      })
      // If this was the selected file, clear selection
      if (selectedFile === filepath) {
        setSelectedFile(null)
      }
      // Reload file list
      loadFileList()
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to revert file')
    }
    setRevertConfirm(null)
  }

  async function handleRevertAll() {
    try {
      await window.electronAPI.revertAllFiles(directory)
      setDirtyFiles(new Set())
      setEditedContent(new Map())
      setDiffCache(new Map())
      setSelectedFile(null)
      loadFileList()
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Failed to revert all files')
    }
    setRevertConfirm(null)
  }

  // Calculate summary
  const summary = {
    filesChanged: files.length,
    additions: files.reduce((sum, f) => sum + f.additions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
  }

  // Get current file info
  const currentFile = files.find(f => f.path === selectedFile)
  const cacheKey = selectedCommit && selectedFile ? `${selectedCommit}:${selectedFile}` : selectedFile
  const currentDiff = cacheKey ? diffCache.get(cacheKey) : null

  return (
    <div className="absolute inset-0 z-20 bg-background flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Changes</h2>
          {selectedCommit && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground font-mono">{selectedCommit.slice(0, 7)}</span>
            </>
          )}
          {selectedFile && (
            <>
              <span className="text-muted-foreground">·</span>
              <button
                className="text-sm text-muted-foreground truncate max-w-md hover:text-foreground transition-colors flex items-center gap-1.5 group"
                title={`Click to copy: ${selectedFile}`}
                onClick={async () => {
                  await navigator.clipboard.writeText(selectedFile)
                  setCopiedPath(true)
                  setTimeout(() => setCopiedPath(false), 1500)
                }}
              >
                <span className="truncate">{selectedFile}</span>
                {copiedPath ? (
                  <Check className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
              {currentFile && (
                <span className="text-xs text-muted-foreground">
                  (+{currentFile.additions} -{currentFile.deletions})
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && selectedFile && dirtyFiles.has(selectedFile) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSave}
              title="Save (Cmd+S)"
              className="h-8 px-2 gap-1 text-xs"
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={navigatePrevFile}
            title="Previous file (↑)"
            className="h-8 w-8 p-0"
            disabled={files.length === 0}
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={navigateNextFile}
            title="Next file (↓)"
            className="h-8 w-8 p-0"
            disabled={files.length === 0}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            title="Refresh (r)"
            className="h-8 w-8 p-0"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => {
                setViewMode('unified')
                window.electronAPI?.setPreferences?.({ diffViewMode: 'unified' })
              }}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'unified'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
              title="Unified view"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                setViewMode('split')
                window.electronAPI?.setPreferences?.({ diffViewMode: 'split' })
              }}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'split'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent'
              }`}
              title="Split view"
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            title="Close (Escape or Cmd+D)"
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {isLoading && files.length === 0 ? (
          <div className="flex items-center justify-center w-full h-full">
            <p className="text-sm text-muted-foreground">Loading changes...</p>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center w-full h-full">
            <div className="text-center">
              <p className="text-sm text-destructive font-semibold">Error</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              <Button size="sm" variant="outline" onClick={handleRefresh} className="mt-3">
                Try Again
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="w-[280px] flex flex-col border-r border-border bg-background">
              {/* Commit list (only when baseRef is set and we have commits) */}
              {baseRef && commits.length > 0 && (
                <div className="border-b border-border">
                  <button
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-accent/50 transition-colors"
                    onClick={() => setCommitsExpanded(prev => !prev)}
                  >
                    <ChevronRight className={`h-3 w-3 transition-transform ${commitsExpanded ? 'rotate-90' : ''}`} />
                    <GitCommitHorizontal className="h-3 w-3" />
                    Commits ({commits.length})
                  </button>
                  {commitsExpanded && (
                    <div className="max-h-48 overflow-y-auto pb-1">
                      {/* Local Changes entry (uncommitted working tree changes) */}
                      <button
                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                          selectedCommit === null
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        }`}
                        onClick={() => handleSelectCommit(null)}
                      >
                        <span className="font-medium">Local Changes</span>
                      </button>
                      {/* Individual commits */}
                      {commits.map(commit => (
                        <button
                          key={commit.sha}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                            selectedCommit === commit.sha
                              ? 'bg-accent text-foreground'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                          }`}
                          onClick={() => handleSelectCommit(commit.sha)}
                          title={`${commit.sha}\n${commit.message}`}
                        >
                          <span className="font-mono text-[10px] text-blue-400 mr-1.5">{commit.shortSha}</span>
                          <span className="truncate">{commit.message.length > 40 ? commit.message.slice(0, 40) + '...' : commit.message}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* File list */}
              <div className="flex-1 overflow-hidden">
                <DiffFileList
                  files={files}
                  selectedFile={selectedFile}
                  onSelectFile={handleSelectFile}
                  summary={summary}
                  onRevertFile={readOnly ? undefined : (filepath) => setRevertConfirm({ type: 'file', path: filepath })}
                  onRevertAll={readOnly ? undefined : () => setRevertConfirm({ type: 'all' })}
                />
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              {selectedFile && currentDiff ? (
                <DiffViewer
                  oldContent={currentDiff.oldContent}
                  newContent={currentDiff.newContent}
                  language={currentDiff.language}
                  viewMode={viewMode}
                  isBinary={currentDiff.isBinary}
                  isTooLarge={currentDiff.isTooLarge}
                  isLoading={isDiffLoading}
                  error={diffError}
                  onContentChange={readOnly ? undefined : handleContentChange}
                  readOnly={readOnly || currentFile?.status === 'deleted' || currentDiff.isBinary}
                  onLoadAnyway={async () => {
                    if (!selectedFile) return
                    setIsDiffLoading(true)
                    setDiffError(null)
                    try {
                      let content: FileDiffContent
                      if (selectedCommit) {
                        content = await window.electronAPI.getFileDiffForCommit(directory, selectedFile, selectedCommit, true)
                      } else if (baseRef) {
                        content = await window.electronAPI.getFileDiffFromRef(directory, selectedFile, baseRef, true)
                      } else {
                        content = await window.electronAPI.getFileDiff(directory, selectedFile, true)
                      }
                      const key = selectedCommit ? `${selectedCommit}:${selectedFile}` : selectedFile
                      setDiffCache(prev => new Map(prev).set(key, content))
                    } catch (err) {
                      setDiffError(err instanceof Error ? err.message : 'Failed to load diff')
                    } finally {
                      setIsDiffLoading(false)
                    }
                  }}
                />
              ) : isDiffLoading ? (
                <div className="flex items-center justify-center w-full h-full">
                  <p className="text-sm text-muted-foreground">Loading diff...</p>
                </div>
              ) : (
                <div className="flex items-center justify-center w-full h-full">
                  <p className="text-sm text-muted-foreground">Select a file to view changes</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Revert Confirmation Dialog */}
      {!readOnly && (
        <Dialog open={revertConfirm !== null} onOpenChange={(open) => { if (!open) setRevertConfirm(null) }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>
                {revertConfirm?.type === 'all' ? 'Revert All Files?' : 'Revert File?'}
              </DialogTitle>
              <DialogDescription>
                {revertConfirm?.type === 'all'
                  ? 'This will discard all uncommitted changes and revert every file to its last committed state. This action cannot be undone.'
                  : `This will discard all uncommitted changes to "${revertConfirm?.type === 'file' ? revertConfirm.path : ''}" and revert it to its last committed state. This action cannot be undone.`
                }
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRevertConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (revertConfirm?.type === 'all') {
                    handleRevertAll()
                  } else if (revertConfirm?.type === 'file') {
                    handleRevertFile(revertConfirm.path)
                  }
                }}
              >
                Revert
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
