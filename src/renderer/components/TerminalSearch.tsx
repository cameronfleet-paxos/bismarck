/**
 * TerminalSearch Component
 *
 * A floating search bar that provides find functionality for terminal windows.
 * Supports both xterm.js terminals (via SearchAddon) and DOM-based content
 * (via browser's Selection and Range APIs).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'

interface TerminalSearchProps {
  isOpen: boolean
  onClose: () => void
  onSearch: (query: string, options: SearchOptions) => SearchResult
  onFindNext: () => SearchResult
  onFindPrevious: () => SearchResult
}

export interface SearchOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface SearchResult {
  found: boolean
  currentMatch?: number
  totalMatches?: number
}

export function TerminalSearch({
  isOpen,
  onClose,
  onSearch,
  onFindNext,
  onFindPrevious,
}: TerminalSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [result, setResult] = useState<SearchResult>({ found: false })

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isOpen])

  // Handle search on query change
  useEffect(() => {
    if (isOpen && query) {
      const searchResult = onSearch(query, { caseSensitive })
      setResult(searchResult)
    } else {
      setResult({ found: false })
    }
  }, [query, caseSensitive, isOpen, onSearch])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) {
        const searchResult = onFindPrevious()
        setResult(searchResult)
      } else {
        const searchResult = onFindNext()
        setResult(searchResult)
      }
    }
  }, [onClose, onFindNext, onFindPrevious])

  const handleFindNext = useCallback(() => {
    const searchResult = onFindNext()
    setResult(searchResult)
  }, [onFindNext])

  const handleFindPrevious = useCallback(() => {
    const searchResult = onFindPrevious()
    setResult(searchResult)
  }, [onFindPrevious])

  if (!isOpen) return null

  return (
    <div className="absolute top-2 right-2 z-50 flex items-center gap-1 bg-zinc-800 border border-zinc-600 rounded-md shadow-lg px-2 py-1">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none w-48"
      />

      {/* Match counter */}
      {query && (
        <span className="text-xs text-zinc-400 min-w-[60px] text-center">
          {result.totalMatches !== undefined && result.totalMatches > 0
            ? `${result.currentMatch || 0}/${result.totalMatches}`
            : 'No results'}
        </span>
      )}

      {/* Case sensitivity toggle */}
      <button
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`p-1 text-xs font-mono rounded hover:bg-zinc-700 ${
          caseSensitive ? 'text-blue-400' : 'text-zinc-500'
        }`}
        title="Match case"
      >
        Aa
      </button>

      {/* Navigation buttons */}
      <button
        onClick={handleFindPrevious}
        className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-50"
        disabled={!query || !result.found}
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={handleFindNext}
        className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-50"
        disabled={!query || !result.found}
        title="Next match (Enter)"
      >
        <ChevronDown size={14} />
      </button>

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
        title="Close (Escape)"
      >
        <X size={14} />
      </button>
    </div>
  )
}
