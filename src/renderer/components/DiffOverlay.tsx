import { useState, useEffect, useCallback } from 'react'
import { X, RotateCw, Columns2, FileText, ChevronUp, ChevronDown, Save } from 'lucide-react'
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
}

type ViewMode = 'unified' | 'split'

export function DiffOverlay({ directory, onClose }: DiffOverlayProps) {
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
  }, [directory])

  // Auto-select first file when list loads
  useEffect(() => {
    if (files.length > 0 && selectedFile === null) {
      setSelectedFile(files[0].path)
    }
  }, [files, selectedFile])

  // Load diff when selected file changes
  useEffect(() => {
    if (selectedFile) {
      loadFileDiff(selectedFile)
    }
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
      // Escape: Close overlay
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
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

      // n/p: Jump to next/prev change within file
      // TODO: Implement once DiffViewer exposes a navigation API
      // For now, these are reserved but not functional
      if ((e.key === 'n' || e.key === 'p') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        // Future: currentDiff?.scrollToNextChange() / scrollToPrevChange()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [files, selectedFile, onClose, handleRefresh, handleSave])

  async function loadFileList() {
    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getChangedFiles(directory)
      setFiles(result.files)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load changed files')
    } finally {
      setIsLoading(false)
    }
  }

  async function loadFileDiff(filepath: string) {
    // Check cache first
    if (diffCache.has(filepath)) {
      return
    }

    setIsDiffLoading(true)
    setDiffError(null)
    try {
      const content = await window.electronAPI.getFileDiff(directory, filepath)
      setDiffCache(prev => new Map(prev).set(filepath, content))
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
  }

  function handleSelectFile(filepath: string) {
    setSelectedFile(filepath)
    setDiffError(null) // Clear any previous diff errors
  }

  const handleContentChange = useCallback((content: string) => {
    if (!selectedFile) return
    setEditedContent(prev => new Map(prev).set(selectedFile, content))
    setDirtyFiles(prev => new Set(prev).add(selectedFile))
  }, [selectedFile])

  async function handleSave() {
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
  const currentDiff = selectedFile ? diffCache.get(selectedFile) : null

  return (
    <div className="absolute inset-0 z-20 bg-background flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground">Changes</h2>
          {selectedFile && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground truncate max-w-md" title={selectedFile}>
                {selectedFile}
              </span>
              {currentFile && (
                <span className="text-xs text-muted-foreground">
                  (+{currentFile.additions} -{currentFile.deletions})
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedFile && dirtyFiles.has(selectedFile) && (
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
        {isLoading ? (
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
            <DiffFileList
              files={files}
              selectedFile={selectedFile}
              onSelectFile={handleSelectFile}
              summary={summary}
              onRevertFile={(filepath) => setRevertConfirm({ type: 'file', path: filepath })}
              onRevertAll={() => setRevertConfirm({ type: 'all' })}
            />
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
                  onContentChange={handleContentChange}
                  readOnly={currentFile?.status === 'deleted' || currentDiff.isBinary}
                  onLoadAnyway={async () => {
                    if (!selectedFile) return
                    setIsDiffLoading(true)
                    setDiffError(null)
                    try {
                      const content = await window.electronAPI.getFileDiff(directory, selectedFile, true)
                      setDiffCache(prev => new Map(prev).set(selectedFile, content))
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
    </div>
  )
}
