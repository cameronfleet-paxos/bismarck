import { useEffect, useRef, useMemo, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Extension } from '@codemirror/state'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { Loader2, AlertCircle, FileCode, AlertTriangle } from 'lucide-react'

interface DiffViewerProps {
  oldContent: string
  newContent: string
  language: string
  viewMode: 'unified' | 'split'
  isBinary: boolean
  isTooLarge: boolean
  isLoading: boolean
  error: string | null
  onLoadAnyway?: () => void
}

export function DiffViewer({
  oldContent,
  newContent,
  language,
  viewMode,
  isBinary,
  isTooLarge,
  isLoading,
  error,
  onLoadAnyway,
}: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mergeViewRef = useRef<MergeView | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [languageSupport, setLanguageSupport] = useState<Extension | null>(null)

  // Memoize language detection
  const languageDesc = useMemo(() => {
    if (!language) return null
    return LanguageDescription.matchFilename(languages, language)
  }, [language])

  // Load language support asynchronously
  useEffect(() => {
    if (!languageDesc) {
      setLanguageSupport(null)
      return
    }

    let cancelled = false
    languageDesc.load().then((lang) => {
      if (!cancelled) {
        setLanguageSupport(lang)
      }
    }).catch(() => {
      if (!cancelled) {
        setLanguageSupport(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [languageDesc])

  // Create editor when content or mode changes
  useEffect(() => {
    if (!containerRef.current) return
    if (isLoading || error || isBinary || isTooLarge) return

    const container = containerRef.current

    // Clean up previous instances
    if (mergeViewRef.current) {
      mergeViewRef.current.destroy()
      mergeViewRef.current = null
    }
    if (editorViewRef.current) {
      editorViewRef.current.destroy()
      editorViewRef.current = null
    }

    // Clear container
    container.innerHTML = ''

    const mergeConfig = {
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      gutter: true,
      syntaxHighlightDeletions: true,
    }

    // Build extensions array with loaded language support
    const extensions = [
      basicSetup,
      EditorState.readOnly.of(true),
      oneDark,
      ...(languageSupport ? [languageSupport] : []),
    ]

    if (viewMode === 'unified') {
      // Unified view mode using extension
      const state = EditorState.create({
        doc: newContent,
        extensions: [
          ...extensions,
          unifiedMergeView({
            original: oldContent,
            ...mergeConfig,
          }),
        ],
      })

      const view = new EditorView({
        state,
        parent: container,
      })

      editorViewRef.current = view
    } else {
      // Split view mode using MergeView class
      const mergeView = new MergeView({
        a: {
          doc: oldContent,
          extensions,
        },
        b: {
          doc: newContent,
          extensions,
        },
        parent: container,
        ...mergeConfig,
      })

      mergeViewRef.current = mergeView
    }

    setIsInitialized(true)

    // Cleanup on unmount
    return () => {
      if (mergeViewRef.current) {
        mergeViewRef.current.destroy()
        mergeViewRef.current = null
      }
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
    }
  }, [oldContent, newContent, viewMode, languageSupport, isLoading, error, isBinary, isTooLarge])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading diff...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-foreground font-semibold">Error loading diff</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  // Binary file state
  if (isBinary) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FileCode className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-foreground font-semibold">Binary file</p>
          <p className="text-xs text-muted-foreground">
            This file contains binary content and cannot be displayed as text.
          </p>
        </div>
      </div>
    )
  }

  // Large file state
  if (isTooLarge) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <AlertTriangle className="w-8 h-8 text-yellow-500" />
          <p className="text-sm text-foreground font-semibold">File too large</p>
          <p className="text-xs text-muted-foreground">
            This file is very large and may cause performance issues. Loading it anyway may make the app unresponsive.
          </p>
          {onLoadAnyway && (
            <button
              onClick={onLoadAnyway}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Load anyway
            </button>
          )}
        </div>
      </div>
    )
  }

  // Main editor view
  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#282c34] overflow-auto"
      style={{
        // Prevent layout shift by reserving space
        minHeight: isInitialized ? 'auto' : '100%',
      }}
    />
  )
}
