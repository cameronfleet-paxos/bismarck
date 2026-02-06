import { useState, useEffect } from 'react'
import { X, RotateCw, Columns2, FileText } from 'lucide-react'
import { DiffFileList } from './DiffFileList'
import { DiffViewer } from './DiffViewer'
import type { DiffFile, FileDiffContent } from '@/shared/types'
import { Button } from './ui/button'

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

      // Cmd+Shift+S: Toggle view mode
      if (e.key === 's' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        setViewMode(prev => prev === 'unified' ? 'split' : 'unified')
        return
      }

      // Up/Down arrows: Navigate file list
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (files.length === 0 || !selectedFile) return

        e.preventDefault()
        e.stopPropagation()

        const currentIndex = files.findIndex(f => f.path === selectedFile)
        if (currentIndex === -1) return

        let newIndex: number
        if (e.key === 'ArrowUp') {
          // Move up, wrap to bottom if at top
          newIndex = currentIndex === 0 ? files.length - 1 : currentIndex - 1
        } else {
          // Move down, wrap to top if at bottom
          newIndex = currentIndex === files.length - 1 ? 0 : currentIndex + 1
        }

        setSelectedFile(files[newIndex].path)
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
  }, [files, selectedFile, onClose, handleRefresh])

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
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            title="Refresh"
            className="h-8 w-8 p-0"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode('unified')}
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
              onClick={() => setViewMode('split')}
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
    </div>
  )
}
