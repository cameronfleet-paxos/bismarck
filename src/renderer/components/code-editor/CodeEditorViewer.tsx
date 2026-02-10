import { useEffect, useRef, useMemo, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { Loader2, AlertCircle, FileCode, AlertTriangle, Copy, Check } from 'lucide-react'

interface CodeEditorViewerProps {
  content: string
  language: string
  filepath: string
  isBinary: boolean
  isTooLarge: boolean
  isLoading: boolean
  error: string | null
  onLoadAnyway?: () => void
}

export function CodeEditorViewer({
  content,
  language,
  filepath,
  isBinary,
  isTooLarge,
  isLoading,
  error,
  onLoadAnyway,
}: CodeEditorViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)
  const [languageSupport, setLanguageSupport] = useState<Extension | null>(null)
  const [copied, setCopied] = useState(false)

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
      EditorState.readOnly.of(true),
      ...(languageSupport ? [languageSupport] : []),
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
  }, [content, languageSupport, isLoading, error, isBinary, isTooLarge])

  // Handle copy to clipboard
  const handleCopyPath = async () => {
    try {
      // eslint-disable-next-line no-undef
      await navigator.clipboard.writeText(filepath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy path:', err)
    }
  }

  // Format file path for breadcrumb display
  const formatFilePath = (path: string) => {
    const parts = path.split('/')
    return parts.map((part, i) => (
      <span key={i} className="inline-flex items-center">
        {i > 0 && <span className="text-muted-foreground mx-1">/</span>}
        <span className={i === parts.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}>
          {part}
        </span>
      </span>
    ))
  }

  // Calculate file size for display
  const fileSize = useMemo(() => {
    // eslint-disable-next-line no-undef
    const bytes = new Blob([content]).size
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }, [content])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-center flex-1 bg-background">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading file...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-center flex-1 bg-background">
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-foreground font-semibold">Error loading file</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Binary file state
  if (isBinary) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border">
          <div className="flex items-center gap-2 text-sm overflow-hidden">
            {formatFilePath(filepath)}
          </div>
          <button
            onClick={handleCopyPath}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Copy file path"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex items-center justify-center flex-1 bg-background">
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <FileCode className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-foreground font-semibold">Binary file</p>
            <p className="text-xs text-muted-foreground">
              This file contains binary content and cannot be displayed as text.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Large file state
  if (isTooLarge) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border">
          <div className="flex items-center gap-2 text-sm overflow-hidden">
            {formatFilePath(filepath)}
          </div>
          <button
            onClick={handleCopyPath}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Copy file path"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex items-center justify-center flex-1 bg-background">
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
      </div>
    )
  }

  // Main editor view
  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-background border-b border-border">
        <div className="flex items-center gap-2 text-sm overflow-hidden">
          {formatFilePath(filepath)}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{fileSize}</span>
          <button
            onClick={handleCopyPath}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Copy file path"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div
        ref={containerRef}
        className="flex-1 w-full bg-[#282c34] overflow-auto"
        style={{
          // Prevent layout shift by reserving space
          minHeight: isInitialized ? 'auto' : '100%',
        }}
      />
    </div>
  )
}
