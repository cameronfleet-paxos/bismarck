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

import { useEffect, useRef, useState, useMemo } from 'react'
import type {
  ThemeName,
  StreamEvent,
  StreamToolUseEvent,
  StreamToolResultEvent,
  HeadlessAgentStatus,
} from '@/shared/types'
import { themes } from '@/shared/constants'

interface HeadlessTerminalProps {
  events: StreamEvent[]
  theme: ThemeName
  status: HeadlessAgentStatus
  isVisible?: boolean
  isStandalone?: boolean           // True for standalone headless agents
  onConfirmDone?: () => void       // Called when user clicks "Confirm Done"
  onStartFollowUp?: () => void     // Called when user clicks "Start Follow-up"
}

interface CollapsedState {
  [toolId: string]: boolean
}

/**
 * Generate an inline summary for a tool invocation
 */
function getToolSummary(toolName?: string, input?: Record<string, unknown>): string {
  if (!toolName) return '→ Unknown tool'

  switch (toolName) {
    case 'Read':
      return `→ Read ${input?.file_path || 'file'}`
    case 'Edit':
      return `→ Edit ${input?.file_path || 'file'}`
    case 'Write':
      return `→ Write ${input?.file_path || 'file'}`
    case 'Bash': {
      const cmd = input?.command as string
      if (cmd) {
        const truncated = cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
        return `→ Run: ${truncated}`
      }
      return '→ Run command'
    }
    case 'Grep':
      return `→ Search: ${input?.pattern || 'pattern'}`
    case 'Glob':
      return `→ Find: ${input?.pattern || 'pattern'}`
    case 'Task':
      return `→ Task: ${input?.description || 'subtask'}`
    default:
      return `→ ${toolName}`
  }
}

export function HeadlessTerminal({
  events,
  theme,
  status,
  isVisible = true,
  isStandalone = false,
  onConfirmDone,
  onStartFollowUp,
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

  // Toggle collapse state for a tool
  const toggleCollapse = (toolId: string) => {
    setCollapsed((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }))
  }

  // Group events for rendering (tool_use + tool_result pairs)
  const groupedEvents = useMemo(() => {
    const groups: Array<{
      type: 'message' | 'tool' | 'result' | 'system'
      events: StreamEvent[]
      toolId?: string
    }> = []

    let currentMessageGroup: StreamEvent[] = []
    const toolResults: Map<string, StreamEvent> = new Map()

    // First pass: collect tool results
    for (const event of events) {
      if (event.type === 'tool_result') {
        const resultEvent = event as { tool_id: string }
        toolResults.set(resultEvent.tool_id, event)
      }
    }

    // Second pass: group events
    for (const event of events) {
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

          const toolEvent = event as { tool_id: string }
          const toolId = toolEvent.tool_id
          const result = toolResults.get(toolId)

          groups.push({
            type: 'tool',
            events: result ? [event, result] : [event],
            toolId,
          })
          break
        }

        case 'tool_result':
          // Already handled with tool_use
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

  // Render a message group with proper paragraph formatting
  const renderMessageGroup = (events: StreamEvent[], key: number) => {
    const text = events.map(extractText).filter(Boolean).join('')
    if (!text.trim()) return null

    // Split on double newlines OR patterns like ".Let me" or ".Now I" where
    // sentences run together (common when Claude's output lacks proper spacing)
    const paragraphs = text
      .replace(/\.(?=[A-Z][a-z])/g, '.\n\n')  // Add break after period followed by capital letter
      .split(/\n\n+/)
      .filter((p) => p.trim())

    return (
      <div key={key} className="mb-4 space-y-3">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="whitespace-pre-wrap font-mono text-sm leading-relaxed"
          >
            {para.trim()}
          </p>
        ))}
      </div>
    )
  }

  // Render a tool use/result group with inline summary
  const renderToolGroup = (
    events: StreamEvent[],
    toolId: string,
    key: number
  ) => {
    const toolUse = events.find((e) => e.type === 'tool_use') as
      | StreamToolUseEvent
      | undefined
    const toolResult = events.find((e) => e.type === 'tool_result') as
      | StreamToolResultEvent
      | undefined

    const isCollapsed = collapsed[toolId] ?? true
    const hasError = toolResult?.is_error

    // Generate inline summary
    const summary = getToolSummary(toolUse?.tool_name, toolUse?.input)

    return (
      <div key={key} className="mb-4">
        {/* Inline tool summary - always visible */}
        <div
          className={`text-sm font-mono mb-2 ${
            hasError ? 'text-red-400' : 'text-blue-400'
          }`}
        >
          {summary}
          {toolResult && !hasError && (
            <span className="ml-2 text-green-400">✓</span>
          )}
          {toolResult && hasError && <span className="ml-2 text-red-400">✗</span>}
          {!toolResult && (
            <span className="ml-2 text-yellow-400 animate-pulse">...</span>
          )}
        </div>

        {/* Collapsible details */}
        <div
          className={`border-l-2 pl-3 ${
            hasError ? 'border-red-500' : 'border-blue-500/30'
          }`}
        >
          <button
            onClick={() => toggleCollapse(toolId)}
            className="flex items-center gap-2 text-xs font-mono hover:opacity-80 w-full text-left opacity-60"
          >
            <span>{isCollapsed ? '▶' : '▼'}</span>
            <span>{toolUse?.tool_name || 'Unknown tool'}</span>
            <span className="text-xs">details</span>
          </button>

          {/* Tool details (collapsible) */}
          {!isCollapsed && (
            <div className="mt-2 ml-4 text-xs font-mono">
              {/* Input */}
              {toolUse?.input && (
                <div className="mb-2">
                  <div className="opacity-60 mb-1">Input:</div>
                  <pre className="bg-black/20 p-2 rounded overflow-x-auto">
                    {JSON.stringify(toolUse.input, null, 2)}
                  </pre>
                </div>
              )}

              {/* Output */}
              {toolResult?.output && (
                <div>
                  <div className="opacity-60 mb-1">Output:</div>
                  <pre
                    className={`p-2 rounded overflow-x-auto whitespace-pre-wrap ${
                      hasError ? 'bg-red-900/20' : 'bg-black/20'
                    }`}
                  >
                    {toolResult.output.length > 2000
                      ? toolResult.output.substring(0, 2000) + '\n... (truncated)'
                      : toolResult.output}
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
          <div className="mb-2 text-green-400">
            Result: {resultEvent.result}
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
            {isStandalone && (onConfirmDone || onStartFollowUp) && (
              <div className="flex items-center gap-2">
                {onStartFollowUp && (
                  <button
                    onClick={onStartFollowUp}
                    className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    Start Follow-up
                  </button>
                )}
                {onConfirmDone && (
                  <button
                    onClick={onConfirmDone}
                    className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors"
                  >
                    Confirm Done
                  </button>
                )}
              </div>
            )}
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
                    className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={onConfirmDone}
                  className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors"
                >
                  Confirm Done
                </button>
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      style={{ backgroundColor: themeColors.bg, color: themeColors.fg }}
    >
      {/* Status bar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-white/10 text-sm">
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
          <div className="mt-4 text-sm opacity-60 animate-pulse">
            Thinking...
          </div>
        )}
      </div>
    </div>
  )
}
