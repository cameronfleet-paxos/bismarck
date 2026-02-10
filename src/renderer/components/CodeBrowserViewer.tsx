import { useEffect, useState, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorState, Extension } from '@codemirror/state'
import { Loader2, AlertCircle, FileCode, AlertTriangle, Copy, Check } from 'lucide-react'

interface CodeBrowserViewerProps {
  directory: string
  filepath: string | null
  currentRef?: string
}

export function CodeBrowserViewer({
  directory,
  filepath,
  currentRef,
}: CodeBrowserViewerProps) {
  const [content, setContent] = useState('')
  const [language, setLanguage] = useState('')
  const [isBinary, setIsBinary] = useState(false)
  const [isTooLarge, setIsTooLarge] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<number | undefined>(undefined)
  const [languageSupport, setLanguageSupport] = useState<Extension | null>(null)
  const [forceLoad, setForceLoad] = useState(false)
  const [copied, setCopied] = useState(false)

  // Memoize language detection
  const languageDesc = useMemo(() => {
    if (!language) return null
    return LanguageDescription.matchFilename(languages, language)
  }, [language])

  // Get language display name
  const languageDisplayName = useMemo(() => {
    if (!languageDesc) return 'Plain Text'
    return languageDesc.name
  }, [languageDesc])

  // Load language support asynchronously
  useEffect(() => {
    if (!languageDesc) {
      setLanguageSupport(null)
      return
    }

    let cancelled = false
    languageDesc
      .load()
      .then((lang) => {
        if (!cancelled) {
          setLanguageSupport(lang)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLanguageSupport(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [languageDesc])

  // Load file content
  useEffect(() => {
    if (!filepath || !directory) {
      setContent('')
      setLanguage('')
      setIsBinary(false)
      setIsTooLarge(false)
      setIsLoading(false)
      setError(null)
      setSize(undefined)
      return
    }

    setIsLoading(true)
    setError(null)

    window.electronAPI
      .getFileContent(directory, filepath, currentRef)
      .then((result) => {
        setContent(result.content)
        setLanguage(result.language)
        setIsBinary(result.isBinary)
        setIsTooLarge(result.isTooLarge && !forceLoad)
        setError(result.error || null)
        setIsLoading(false)

        // Calculate size from content (approximate)
        setSize(result.content.length)
      })
      .catch((err) => {
        setError((err as Error).message || 'Failed to load file')
        setIsLoading(false)
      })
  }, [directory, filepath, currentRef, forceLoad])

  // Generate breadcrumb from filepath
  const breadcrumb = useMemo(() => {
    if (!filepath) return []
    return filepath.split('/')
  }, [filepath])

  // Format file size
  const formatSize = (bytes: number | undefined): string => {
    if (bytes === undefined) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!content) return
    try {
      await window.electronAPI.copyToClipboard(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
    }
  }

  // Handle load anyway
  const handleLoadAnyway = () => {
    setForceLoad(true)
  }

  // Empty state (no file selected)
  if (!filepath) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FileCode className="w-12 h-12 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">
            Select a file to view its contents
          </p>
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading...</span>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
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
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((segment, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground">/</span>}
                <span className={index === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
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
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((segment, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground">/</span>}
                <span className={index === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
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
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((segment, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground">/</span>}
                <span className={index === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 max-w-md text-center">
            <AlertTriangle className="w-8 h-8 text-yellow-500" />
            <p className="text-sm text-foreground font-semibold">File too large</p>
            <p className="text-xs text-muted-foreground">
              This file is very large and may cause performance issues. Loading it anyway may make the app unresponsive.
            </p>
            <button
              onClick={handleLoadAnyway}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
            >
              Load anyway
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Empty file state
  if (content.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {breadcrumb.map((segment, index) => (
                <span key={index} className="flex items-center gap-2">
                  {index > 0 && <span className="text-muted-foreground">/</span>}
                  <span className={index === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    {segment}
                  </span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">0 B</span>
              <span className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">
                {languageDisplayName}
              </span>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <FileCode className="w-8 h-8 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Empty file</p>
          </div>
        </div>
      </div>
    )
  }

  // Success state - show CodeMirror editor
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header bar */}
      <div className="border-b border-border px-4 py-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((segment, index) => (
              <span key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground">/</span>}
                <span className={index === breadcrumb.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{formatSize(size)}</span>
            <span className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">
              {languageDisplayName}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-muted rounded transition-colors"
              title="Copy file content"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* CodeMirror viewer */}
      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={content}
          theme={oneDark}
          extensions={[
            EditorState.readOnly.of(true),
            ...(languageSupport ? [languageSupport] : []),
          ]}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: false,
            highlightSpecialChars: true,
            foldGutter: true,
            drawSelection: false,
            dropCursor: false,
            allowMultipleSelections: false,
            indentOnInput: false,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: false,
            autocompletion: false,
            rectangularSelection: false,
            crosshairCursor: false,
            highlightActiveLine: false,
            highlightSelectionMatches: false,
            closeBracketsKeymap: false,
            defaultKeymap: true,
            searchKeymap: true,
            historyKeymap: false,
            foldKeymap: true,
            completionKeymap: false,
            lintKeymap: false,
          }}
          editable={false}
          style={{
            height: '100%',
            fontSize: '13px',
          }}
        />
      </div>
    </div>
  )
}
