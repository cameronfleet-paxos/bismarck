import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { Extension } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { Loader2, AlertCircle, FileCode, AlertTriangle } from 'lucide-react'

interface CodeEditorViewerProps {
  content: string
  language: string
  isBinary: boolean
  isTooLarge: boolean
  isLoading: boolean
  error: string | null
  readOnly?: boolean
  onContentChange?: (content: string) => void
  onLoadAnyway?: () => void
  filepath?: string
}

export function CodeEditorViewer({
  content,
  language,
  isBinary,
  isTooLarge,
  isLoading,
  error,
  readOnly = true,
  onContentChange,
  onLoadAnyway,
  filepath,
}: CodeEditorViewerProps) {
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

  // Build extensions for CodeMirror
  const extensions = useMemo(() => {
    const exts: Extension[] = []
    if (languageSupport) {
      exts.push(languageSupport)
    }
    return exts
  }, [languageSupport])

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

  // Main editor view with optional header
  return (
    <div className="flex flex-col h-full w-full">
      {filepath && (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b border-border">
          <FileCode className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-mono">{filepath}</span>
          {languageDesc && (
            <span className="ml-auto px-2 py-0.5 bg-primary/10 text-primary text-xs rounded">
              {languageDesc.name}
            </span>
          )}
        </div>
      )}
      <div className="flex-1 w-full overflow-auto">
        <CodeMirror
          value={content}
          theme={oneDark}
          extensions={extensions}
          editable={!readOnly}
          readOnly={readOnly}
          onChange={onContentChange}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            history: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            rectangularSelection: true,
            crosshairCursor: true,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: true,
            historyKeymap: true,
            foldKeymap: true,
            completionKeymap: true,
            lintKeymap: true,
          }}
          style={{
            height: '100%',
            width: '100%',
          }}
        />
      </div>
    </div>
  )
}
