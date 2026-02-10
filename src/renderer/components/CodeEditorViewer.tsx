import { useEffect, useRef, useMemo, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { Loader2, AlertCircle, FileCode, AlertTriangle } from 'lucide-react'

interface CodeEditorViewerProps {
  content: string
  language: string
  isLoading: boolean
  isBinary: boolean
  isTooLarge: boolean
  error?: string
  onLoadAnyway?: () => void
  readOnly?: boolean
  onContentChange?: (content: string) => void
}

export function CodeEditorViewer({
  content,
  language,
  isLoading,
  isBinary,
  isTooLarge,
  error,
  onLoadAnyway,
  readOnly = true,
  onContentChange,
}: CodeEditorViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Create editor when content changes
  useEffect(() => {
    if (!containerRef.current) return
    if (isLoading || error || isBinary || isTooLarge) return

    const container = containerRef.current

    // Clean up previous instance
    if (editorViewRef.current) {
      editorViewRef.current.destroy()
      editorViewRef.current = null
    }

    // Clear container
    container.innerHTML = ''

    // Build extensions
    const extensions = [
      basicSetup,
      oneDark,
      ...(languageSupport ? [languageSupport] : []),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ...(!readOnly && onContentChange ? [
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onContentChange(update.state.doc.toString())
          }
        }),
      ] : []),
    ]

    const state = EditorState.create({
      doc: content,
      extensions,
    })

    const view = new EditorView({
      state,
      parent: container,
    })

    editorViewRef.current = view
    setIsInitialized(true)

    // Cleanup on unmount
    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.destroy()
        editorViewRef.current = null
      }
    }
  }, [content, languageSupport, isLoading, error, isBinary, isTooLarge, readOnly, onContentChange])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading file...</p>
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
          <p className="text-sm text-foreground font-semibold">Error loading file</p>
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
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
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
