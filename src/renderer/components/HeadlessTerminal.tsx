/**
 * HeadlessTerminal Component
 *
 * Renders the output from a headless Claude Code agent running in a Docker container.
 * Unlike the regular Terminal component which uses xterm.js for PTY interaction,
 * this component displays parsed stream-json events in a readable format.
 *
 * Features:
 * - Tool use events shown as collapsible command blocks
 * - Text output with syntax highlighting
 * - Progress/status indicators
 * - Auto-scroll to latest output
 */

import { useEffect, useRef, useState, useMemo, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type {
  ThemeName,
  StreamEvent,
  StreamEventBase,
  StreamToolUseEvent,
  StreamToolResultEvent,
  HeadlessAgentStatus,
} from '@/shared/types'
import { themes } from '@/shared/constants'
import { extractPRUrl } from '@/shared/pr-utils'

// URL regex pattern
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

// File path regex - matches absolute paths like /path/to/file or ~/path/to/file
// Also matches line numbers like :123 or :123:45
const FILE_PATH_REGEX = /(?:\/[\w.-]+)+(?::(\d+)(?::(\d+))?)?|~\/[\w./-]+(?::(\d+)(?::(\d+))?)?/g

/**
 * Make URLs and file paths in text clickable
 */
function makeLinksClickable(text: string): ReactNode[] {
  const result: ReactNode[] = []
  let lastIndex = 0

  // Combined pattern for both URLs and file paths
  const combinedPattern = new RegExp(
    `(${URL_REGEX.source})|(${FILE_PATH_REGEX.source})`,
    'g'
  )

  let match
  while ((match = combinedPattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    const matchedText = match[0]

    if (matchedText.startsWith('http')) {
      // It's a URL
      result.push(
        <a
          key={`url-${match.index}`}
          href={matchedText}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            window.electronAPI?.openExternal?.(matchedText)
          }}
          className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
          title={`Open: ${matchedText}`}
        >
          {matchedText}
        </a>
      )
    } else {
      // It's a file path
      result.push(
        <span
          key={`file-${match.index}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            // Extract the file path without line numbers for opening
            const pathOnly = matchedText.replace(/:\d+(?::\d+)?$/, '')
            // Use shell open to reveal in finder/explorer
            window.electronAPI?.openExternal?.(`file://${pathOnly.startsWith('~') ? pathOnly.replace('~', process.env.HOME || '') : pathOnly}`)
          }}
          className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
          title={`Open: ${matchedText}`}
        >
          {matchedText}
        </span>
      )
    }

    lastIndex = match.index + matchedText.length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result.length > 0 ? result : [text]
}

interface HeadlessTerminalProps {
  events: StreamEvent[]
  theme: ThemeName
  status: HeadlessAgentStatus
  model?: 'opus' | 'sonnet' | 'haiku'  // Model name to display in header
  isVisible?: boolean
  isStandalone?: boolean           // True for standalone headless agents
  onConfirmDone?: () => void       // Called when user clicks "Confirm Done"
  onStartFollowUp?: () => void     // Called when user clicks "Start Follow-up"
  onRestart?: () => void           // Called when user clicks "Restart" (for interrupted agents)
  isConfirmingDone?: boolean       // Loading state for "Confirm Done" button
  isStartingFollowUp?: boolean     // Loading state for "Start Follow-up" button
  isRestarting?: boolean           // Loading state for "Restart" button
}

interface CollapsedState {
  [toolId: string]: boolean
}

/**
 * Generate an inline summary for a tool invocation in Claude Code style
 * Format: ⏺ Tool(key_arg)
 */
function getToolSummary(toolName?: string, input?: Record<string, unknown>): string {
  if (!toolName) return '⏺ Unknown tool'

  switch (toolName) {
    case 'Read': {
      const filePath = input?.file_path as string
      return `⏺ Read(${filePath || 'file'})`
    }
    case 'Edit': {
      const filePath = input?.file_path as string
      return `⏺ Edit(${filePath || 'file'})`
    }
    case 'Write': {
      const filePath = input?.file_path as string
      return `⏺ Write(${filePath || 'file'})`
    }
    case 'Bash': {
      const cmd = input?.command as string
      if (cmd) {
        const truncated = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd
        return `⏺ Bash(${truncated})`
      }
      return '⏺ Bash(command)'
    }
    case 'Grep': {
      const pattern = input?.pattern as string
      return `⏺ Grep(${pattern || 'pattern'})`
    }
    case 'Glob': {
      const pattern = input?.pattern as string
      return `⏺ Glob(${pattern || 'pattern'})`
    }
    case 'Task': {
      const desc = input?.description as string
      const truncated = desc && desc.length > 40 ? desc.slice(0, 40) + '...' : desc
      return `⏺ Task(${truncated || 'subtask'})`
    }
    case 'WebFetch': {
      const url = input?.url as string
      const truncated = url && url.length > 50 ? url.slice(0, 50) + '...' : url
      return `⏺ WebFetch(${truncated || 'url'})`
    }
    case 'WebSearch': {
      const query = input?.query as string
      return `⏺ WebSearch(${query || 'query'})`
    }
    default:
      return `⏺ ${toolName}`
  }
}

/**
 * Generate a preview of tool output in Claude Code style
 * Format: ⎿ Summary or first meaningful line
 */
function getOutputPreview(
  toolName?: string,
  input?: Record<string, unknown>,
  output?: string,
  isError?: boolean
): string | null {
  if (!output) return null
  if (isError) {
    // For errors, show first line
    const firstLine = output.split('\n')[0]?.trim()
    return firstLine ? `⎿ ${firstLine.slice(0, 80)}${firstLine.length > 80 ? '...' : ''}` : null
  }

  switch (toolName) {
    case 'Read': {
      // Count lines read
      const lineCount = output.split('\n').length
      return `⎿ Read ${lineCount} line${lineCount === 1 ? '' : 's'}`
    }
    case 'Edit': {
      // Look for edit summary patterns
      const addedMatch = output.match(/Added (\d+) lines?/i)
      const removedMatch = output.match(/Removed (\d+) lines?/i)
      const updatedMatch = output.match(/Updated (\d+) lines?/i)

      if (addedMatch || removedMatch || updatedMatch) {
        const parts = []
        if (addedMatch) parts.push(`Added ${addedMatch[1]} line${addedMatch[1] === '1' ? '' : 's'}`)
        if (removedMatch) parts.push(`removed ${removedMatch[1]} line${removedMatch[1] === '1' ? '' : 's'}`)
        if (updatedMatch && !addedMatch && !removedMatch) parts.push(`Updated ${updatedMatch[1]} line${updatedMatch[1] === '1' ? '' : 's'}`)
        return `⎿ ${parts.join(', ')}`
      }
      return '⎿ File updated'
    }
    case 'Write': {
      const bytes = output.length
      return `⎿ Wrote ${bytes} byte${bytes === 1 ? '' : 's'}`
    }
    case 'Bash': {
      // Show first non-empty line of output
      const lines = output.split('\n').filter(l => l.trim())
      if (lines.length === 0) return '⎿ (no output)'
      const firstLine = lines[0].trim()
      const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine
      const moreLines = lines.length > 1 ? ` (+${lines.length - 1} more)` : ''
      return `⎿ ${preview}${moreLines}`
    }
    case 'Grep': {
      // Count matches or show first result
      const lines = output.split('\n').filter(l => l.trim())
      if (lines.length === 0) return '⎿ No matches'
      if (lines.length === 1) {
        const preview = lines[0].length > 70 ? lines[0].slice(0, 70) + '...' : lines[0]
        return `⎿ ${preview}`
      }
      return `⎿ Found ${lines.length} match${lines.length === 1 ? '' : 'es'}`
    }
    case 'Glob': {
      const lines = output.split('\n').filter(l => l.trim())
      if (lines.length === 0) return '⎿ No files found'
      return `⎿ Found ${lines.length} file${lines.length === 1 ? '' : 's'}`
    }
    case 'Task': {
      // Show completion summary
      const lines = output.split('\n').filter(l => l.trim())
      if (lines.length === 0) return '⎿ Completed'
      const lastLine = lines[lines.length - 1].trim()
      const preview = lastLine.length > 80 ? lastLine.slice(0, 80) + '...' : lastLine
      return `⎿ ${preview}`
    }
    default: {
      // Generic: show first line
      const firstLine = output.split('\n').find(l => l.trim())?.trim()
      if (!firstLine) return null
      return `⎿ ${firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine}`
    }
  }
}

export function HeadlessTerminal({
  events,
  theme,
  status,
  model,
  isVisible = true,
  isStandalone = false,
  onConfirmDone,
  onStartFollowUp,
  onRestart,
  isConfirmingDone = false,
  isStartingFollowUp = false,
  isRestarting = false,
}: HeadlessTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<CollapsedState>({})
  const themeColors = themes[theme]

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (containerRef.current && isVisible) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events, isVisible])

  // Extract PR URL from events
  const prUrl = extractPRUrl(events)

  // Toggle collapse state for a tool
  const toggleCollapse = (toolId: string) => {
    setCollapsed((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }))
  }

  // Helper to extract tool_use content blocks from assistant events
  // Claude Code sends tool_use nested inside assistant messages: { type: 'assistant', message: { content: [{ type: 'tool_use', ... }] } }
  type ToolUseContentBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  const extractToolUseFromAssistant = (event: StreamEvent): ToolUseContentBlock | null => {
    if (event.type !== 'assistant') return null
    const msg = event as { message?: { content?: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }> } }
    const content = msg.message?.content
    if (!Array.isArray(content)) return null
    const toolUse = content.find(c => c.type === 'tool_use')
    if (toolUse && toolUse.id && toolUse.name) {
      return { type: 'tool_use', id: toolUse.id, name: toolUse.name, input: toolUse.input || {} }
    }
    return null
  }

  // Helper to extract tool_result content blocks from user events
  // Claude Code sends tool_result nested inside user messages: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: '...', content: '...' }] } }
  type ToolResultContentBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  const extractToolResultFromUser = (event: StreamEvent): ToolResultContentBlock | null => {
    if (event.type !== 'user') return null
    const msg = event as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string | Array<{ text?: string }>; is_error?: boolean }> } }
    const content = msg.message?.content
    if (!Array.isArray(content)) return null
    const toolResult = content.find(c => c.type === 'tool_result')
    if (toolResult && toolResult.tool_use_id) {
      // Content can be string or array of text blocks
      let outputContent = ''
      if (typeof toolResult.content === 'string') {
        outputContent = toolResult.content
      } else if (Array.isArray(toolResult.content)) {
        outputContent = toolResult.content.map(c => c.text || '').join('\n')
      }
      return { type: 'tool_result', tool_use_id: toolResult.tool_use_id, content: outputContent, is_error: toolResult.is_error }
    }
    return null
  }

  // Group events for rendering (tool_use + tool_result pairs)
  const groupedEvents = useMemo(() => {
    const groups: Array<{
      type: 'message' | 'tool' | 'result' | 'system'
      events: StreamEvent[]
      toolId?: string
      // For tool groups extracted from assistant events, store the tool info directly
      toolInfo?: { name: string; input: Record<string, unknown> }
    }> = []

    let currentMessageGroup: StreamEvent[] = []
    const toolResults: Map<string, StreamEvent> = new Map()

    // First pass: collect tool results (both top-level and embedded in user events)
    for (const event of events) {
      // Handle top-level tool_result events
      if (event.type === 'tool_result') {
        const resultEvent = event as StreamToolResultEvent & { tool_use_id?: string }
        const toolId = resultEvent.tool_id || resultEvent.tool_use_id
        if (toolId) {
          toolResults.set(toolId, event)
        }
      }
      // Handle tool_result embedded in user events
      const embeddedResult = extractToolResultFromUser(event)
      if (embeddedResult) {
        // Create a synthetic tool_result event
        const syntheticResult: StreamToolResultEvent = {
          type: 'tool_result',
          tool_id: embeddedResult.tool_use_id,
          output: embeddedResult.content,
          is_error: embeddedResult.is_error,
          timestamp: (event as StreamEventBase).timestamp,
        }
        toolResults.set(embeddedResult.tool_use_id, syntheticResult)
      }
    }

    // Second pass: group events
    for (const event of events) {
      // Check if this assistant event contains a tool_use
      const embeddedToolUse = extractToolUseFromAssistant(event)

      if (embeddedToolUse) {
        // This is a tool_use embedded in an assistant message
        // Flush any pending message group
        if (currentMessageGroup.length > 0) {
          groups.push({ type: 'message', events: [...currentMessageGroup] })
          currentMessageGroup = []
        }

        const toolId = embeddedToolUse.id
        const result = toolResults.get(toolId)

        // Create a synthetic tool_use event for rendering
        const syntheticToolUse: StreamToolUseEvent = {
          type: 'tool_use',
          tool_id: toolId,
          tool_name: embeddedToolUse.name,
          input: embeddedToolUse.input,
          timestamp: (event as StreamEventBase).timestamp,
        }

        groups.push({
          type: 'tool',
          events: result ? [syntheticToolUse, result] : [syntheticToolUse],
          toolId,
          toolInfo: { name: embeddedToolUse.name, input: embeddedToolUse.input },
        })
        continue
      }

      switch (event.type) {
        case 'message':
        case 'assistant':
        case 'content_block_delta':
          currentMessageGroup.push(event)
          break

        case 'tool_use': {
          // Flush any pending message group
          if (currentMessageGroup.length > 0) {
            groups.push({ type: 'message', events: [...currentMessageGroup] })
            currentMessageGroup = []
          }

          // Use fallback for tool_id in case events weren't normalized
          const toolEvent = event as StreamToolUseEvent & { id?: string }
          const toolId = toolEvent.tool_id || toolEvent.id
          const result = toolId ? toolResults.get(toolId) : undefined

          groups.push({
            type: 'tool',
            events: result ? [event, result] : [event],
            toolId,
          })
          break
        }

        case 'tool_result':
        case 'user':
          // tool_result: Already handled with tool_use
          // user: Contains tool_results which are already extracted in first pass
          break

        case 'result':
          // Flush any pending message group
          if (currentMessageGroup.length > 0) {
            groups.push({ type: 'message', events: [...currentMessageGroup] })
            currentMessageGroup = []
          }
          groups.push({ type: 'result', events: [event] })
          break

        case 'init':
        case 'system':
          groups.push({ type: 'system', events: [event] })
          break
      }
    }

    // Flush remaining messages
    if (currentMessageGroup.length > 0) {
      groups.push({ type: 'message', events: currentMessageGroup })
    }

    return groups
  }, [events])

  // Extract text content from message events
  const extractText = (event: StreamEvent): string => {
    if (event.type === 'message') {
      return (event as { content: string }).content || ''
    }
    if (event.type === 'assistant') {
      const msg = event as { message?: { content?: Array<{ text?: string }> } }
      const content = msg.message?.content
      if (Array.isArray(content)) {
        return content
          .map((c) => c.text || '')
          .filter(Boolean)
          .join('')
      }
    }
    if (event.type === 'content_block_delta') {
      const delta = event as { delta?: { text?: string } }
      return delta.delta?.text || ''
    }
    return ''
  }

  // Render a message group with markdown support
  const renderMessageGroup = (events: StreamEvent[], key: number) => {
    const text = events.map(extractText).filter(Boolean).join('')
    if (!text.trim()) return null

    return (
      <div key={key} className="mb-4">
        <div className="flex gap-2 font-mono text-sm leading-relaxed">
          <span className="text-white flex-shrink-0">⏺</span>
          <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2">
            <ReactMarkdown
              components={{
                // Override link rendering to use external opener
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault()
                      if (href) window.electronAPI?.openExternal?.(href)
                    }}
                    className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {text.trim()}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  // Render a tool use/result group with Claude Code style
  const renderToolGroup = (
    events: StreamEvent[],
    toolId: string,
    key: number
  ) => {
    // Use fallbacks for field names in case events weren't normalized
    const toolUse = events.find((e) => e.type === 'tool_use') as
      | (StreamToolUseEvent & { name?: string })
      | undefined
    const toolResult = events.find((e) => e.type === 'tool_result') as
      | StreamToolResultEvent
      | undefined

    const isCollapsed = collapsed[toolId] ?? true
    const hasError = toolResult?.is_error

    // Use fallback for tool_name in case events weren't normalized
    const toolName = toolUse?.tool_name || toolUse?.name
    // Generate inline summary in Claude Code format
    const summary = getToolSummary(toolName, toolUse?.input)
    const outputPreview = getOutputPreview(
      toolName,
      toolUse?.input,
      toolResult?.output,
      hasError
    )

    // Special handling for Task (subagent) tools - show output with elbow brackets
    const isTaskTool = toolName === 'Task'
    const taskOutput = isTaskTool && toolResult?.output ? toolResult.output : null

    return (
      <div key={key} className="mb-3 font-mono text-sm">
        {/* Tool summary line: ⏺ Tool(arg) - green bullet for tools */}
        <div className="flex items-start gap-2">
          <span className="text-green-500 flex-shrink-0">
            {summary.slice(0, 1)}
          </span>
          <div className="flex-1 min-w-0">
            <span className={hasError ? 'text-red-400' : 'text-white'}>
              {summary.slice(2)}
            </span>
            {!toolResult && (
              <span className="ml-2 text-yellow-400 animate-pulse">...</span>
            )}
          </div>
        </div>

        {/* For Task tools, show subagent output with elbow brackets */}
        {isTaskTool && taskOutput && (
          <div className="ml-2 mt-1 space-y-0.5">
            {taskOutput.split('\n').filter(line => line.trim()).slice(0, 10).map((line, i) => {
              const trimmedLine = line.trim()
              const displayLine = trimmedLine.length > 100 ? trimmedLine.slice(0, 100) + '...' : trimmedLine
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className={`flex-shrink-0 ${hasError ? 'text-red-400' : 'text-zinc-500'}`}>
                    ⎿
                  </span>
                  <span className={`${hasError ? 'text-red-400' : 'text-zinc-400'} break-all`}>
                    {makeLinksClickable(displayLine)}
                  </span>
                </div>
              )
            })}
            {taskOutput.split('\n').filter(line => line.trim()).length > 10 && (
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 text-zinc-500">⎿</span>
                <span className="text-zinc-500 italic">
                  (+{taskOutput.split('\n').filter(line => line.trim()).length - 10} more lines)
                </span>
              </div>
            )}
          </div>
        )}

        {/* For non-Task tools, show single preview line */}
        {!isTaskTool && outputPreview && (
          <div className="flex items-start gap-2 ml-2 mt-1">
            <span className={`flex-shrink-0 ${hasError ? 'text-red-400' : 'text-zinc-500'}`}>
              ⎿
            </span>
            <span className={`${hasError ? 'text-red-400' : 'text-zinc-400'} break-all`}>
              {makeLinksClickable(outputPreview.slice(2))}
            </span>
          </div>
        )}

        {/* Expandable details */}
        <div className="ml-4 mt-1">
          <button
            onClick={() => toggleCollapse(toolId)}
            className="flex items-center gap-1.5 text-xs hover:opacity-80 text-zinc-500"
          >
            <span className="text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
            <span>{isCollapsed ? 'show details' : 'hide details'}</span>
          </button>

          {/* Full details (collapsible) */}
          {!isCollapsed && (
            <div className="mt-2 text-xs space-y-2">
              {/* Input */}
              {toolUse?.input && (
                <div>
                  <div className="text-zinc-500 mb-1">Input:</div>
                  <pre className="bg-black/30 p-2 rounded overflow-x-auto text-zinc-300">
                    {JSON.stringify(toolUse.input, null, 2)}
                  </pre>
                </div>
              )}

              {/* Full output */}
              {toolResult?.output && (
                <div>
                  <div className="text-zinc-500 mb-1">Output:</div>
                  <pre
                    className={`p-2 rounded overflow-x-auto whitespace-pre-wrap ${
                      hasError ? 'bg-red-900/20 text-red-300' : 'bg-black/30 text-zinc-300'
                    }`}
                  >
                    {makeLinksClickable(
                      toolResult.output.length > 2000
                        ? toolResult.output.substring(0, 2000) + '\n... (truncated)'
                        : toolResult.output
                    )}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render result event
  const renderResult = (events: StreamEvent[], key: number) => {
    const resultEvent = events[0] as {
      result?: string
      cost?: { input_tokens: number; output_tokens: number; total_cost_usd?: number }
      duration_ms?: number
    }

    return (
      <div key={key} className="mt-4 pt-4 border-t border-white/10 text-sm font-mono">
        {resultEvent.result && (
          <div className="mb-2">
            <span className="text-green-400">Result: </span>
            <div className="mt-2 prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-headings:text-green-400">
              <ReactMarkdown
                components={{
                  // Override link rendering to use external opener
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      onClick={(e) => {
                        e.preventDefault()
                        if (href) window.electronAPI?.openExternal?.(href)
                      }}
                      className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {resultEvent.result}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {resultEvent.cost && (
          <div className="opacity-60 text-xs">
            Tokens: {resultEvent.cost.input_tokens} in / {resultEvent.cost.output_tokens} out
            {resultEvent.cost.total_cost_usd && (
              <span> (${resultEvent.cost.total_cost_usd.toFixed(4)})</span>
            )}
          </div>
        )}
        {resultEvent.duration_ms && (
          <div className="opacity-60 text-xs">
            Duration: {(resultEvent.duration_ms / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    )
  }

  // Render system event
  const renderSystem = (events: StreamEvent[], key: number) => {
    const event = events[0]
    const message =
      event.type === 'init'
        ? `Session: ${(event as { session_id: string }).session_id}`
        : (event as { message?: string }).message || 'System event'

    return (
      <div key={key} className="mb-2 text-xs font-mono opacity-40">
        [{event.type}] {message}
      </div>
    )
  }

  // Status indicator
  const getStatusIndicator = () => {
    const handleOpenPR = () => {
      if (prUrl) {
        window.electronAPI?.openExternal?.(prUrl)
      }
    }

    switch (status) {
      case 'starting':
        return (
          <div className="flex items-center gap-2 text-yellow-500">
            <span className="animate-spin">⟳</span> Starting...
          </div>
        )
      case 'running':
        return (
          <div className="flex items-center gap-2 text-blue-400">
            <span className="animate-pulse">●</span> Running
          </div>
        )
      case 'stopping':
        return (
          <div className="flex items-center gap-2 text-yellow-500">
            <span className="animate-spin">⟳</span> Stopping...
          </div>
        )
      case 'completed':
        return (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-green-500">
              <span>✓</span> Completed
            </div>
            <div className="flex items-center gap-2">
              {prUrl && (
                <button
                  onClick={handleOpenPR}
                  className="px-3 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-500 text-white transition-colors cursor-pointer"
                >
                  View PR
                </button>
              )}
              {isStandalone && onStartFollowUp && (
                <button
                  onClick={onStartFollowUp}
                  disabled={isStartingFollowUp || isConfirmingDone}
                  className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isStartingFollowUp ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Starting...
                    </span>
                  ) : (
                    'Start Follow-up'
                  )}
                </button>
              )}
              {isStandalone && onConfirmDone && (
                <button
                  onClick={onConfirmDone}
                  disabled={isConfirmingDone || isStartingFollowUp}
                  className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirmingDone ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Closing...
                    </span>
                  ) : (
                    'Confirm Done'
                  )}
                </button>
              )}
            </div>
          </div>
        )
      case 'failed':
        return (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-red-500">
              <span>✗</span> Failed
            </div>
            {isStandalone && onConfirmDone && (
              <div className="flex items-center gap-2">
                {onStartFollowUp && (
                  <button
                    onClick={onStartFollowUp}
                    disabled={isStartingFollowUp || isConfirmingDone}
                    className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isStartingFollowUp ? (
                      <span className="flex items-center gap-1">
                        <span className="animate-spin">⟳</span> Starting...
                      </span>
                    ) : (
                      'Retry'
                    )}
                  </button>
                )}
                <button
                  onClick={onConfirmDone}
                  disabled={isConfirmingDone || isStartingFollowUp}
                  className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirmingDone ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Closing...
                    </span>
                  ) : (
                    'Confirm Done'
                  )}
                </button>
              </div>
            )}
          </div>
        )
      case 'interrupted':
        return (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-yellow-500">
              <span>⚠</span> Interrupted (app was closed)
            </div>
            <div className="flex items-center gap-2">
              {isStandalone && onRestart && (
                <button
                  onClick={onRestart}
                  disabled={isRestarting || isConfirmingDone}
                  className="px-3 py-1 text-xs font-medium rounded bg-green-600 hover:bg-green-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRestarting ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Restarting...
                    </span>
                  ) : 'Restart'}
                </button>
              )}
              {isStandalone && onConfirmDone && (
                <button
                  onClick={onConfirmDone}
                  disabled={isConfirmingDone || isRestarting}
                  className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirmingDone ? (
                    <span className="flex items-center gap-1">
                      <span className="animate-spin">⟳</span> Closing...
                    </span>
                  ) : 'Confirm Done'}
                </button>
              )}
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div
      data-tutorial="headless"
      className="w-full h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: themeColors.bg, color: themeColors.fg }}
    >
      {/* Status bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-white/10 text-sm flex items-center">
        {getStatusIndicator()}
      </div>

      {/* Event output */}
      <div
        ref={containerRef}
        className="flex-grow overflow-auto p-4"
      >
        {events.length === 0 && status === 'starting' && (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <pre
                className="animate-claude-bounce font-mono text-xl leading-tight select-none"
                style={{ color: '#D97757' }}
              >
                {` ▐▛███▜▌\n▝▜█████▛▘\n  ▘▘ ▝▝`}
              </pre>
              <span className="animate-pulse text-sm" style={{ color: '#D97757' }}>
                starting container...
              </span>
            </div>
          </div>
        )}

        {groupedEvents.map((group, idx) => {
          switch (group.type) {
            case 'message':
              return renderMessageGroup(group.events, idx)
            case 'tool':
              return renderToolGroup(group.events, group.toolId!, idx)
            case 'result':
              return renderResult(group.events, idx)
            case 'system':
              return renderSystem(group.events, idx)
            default:
              return null
          }
        })}

        {/* Running indicator at bottom */}
        {status === 'running' && events.length > 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm font-mono">
            <span className="text-white animate-pulse">⏺</span>
            <span className="text-zinc-500 animate-pulse">Thinking...</span>
          </div>
        )}
      </div>
    </div>
  )
}
