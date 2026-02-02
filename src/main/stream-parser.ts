/**
 * Stream Parser for Claude Code Headless Output
 *
 * Parses NDJSON (newline-delimited JSON) output from Claude Code's
 * --output-format stream-json mode.
 *
 * Event types from Claude Code:
 * - init: Session initialization
 * - message: Text content from Claude
 * - tool_use: Tool being called
 * - tool_result: Result from tool execution
 * - result: Final result/completion
 * - stream_event: Various streaming events (system, assistant, etc.)
 */

import { Readable } from 'stream'
import { EventEmitter } from 'events'

// Base event structure
export interface BaseStreamEvent {
  type: string
  timestamp: string
}

// Initialization event
export interface InitEvent extends BaseStreamEvent {
  type: 'init'
  session_id: string
  model?: string
}

// Message content event
export interface MessageEvent extends BaseStreamEvent {
  type: 'message'
  content: string
  role?: 'assistant' | 'user'
}

// Tool use event
export interface ToolUseEvent extends BaseStreamEvent {
  type: 'tool_use'
  tool_name: string
  tool_id: string
  input: Record<string, unknown>
}

// Tool result event
export interface ToolResultEvent extends BaseStreamEvent {
  type: 'tool_result'
  tool_id: string
  output: string
  is_error?: boolean
}

// Final result event
export interface ResultEvent extends BaseStreamEvent {
  type: 'result'
  result?: string
  cost?: {
    input_tokens: number
    output_tokens: number
    total_cost_usd?: number
  }
  duration_ms?: number
  num_turns?: number
}

// System/assistant stream events
export interface SystemEvent extends BaseStreamEvent {
  type: 'system'
  subtype?: string
  message?: string
}

export interface AssistantEvent extends BaseStreamEvent {
  type: 'assistant'
  message?: {
    content?: Array<{ type: string; text?: string }>
  }
}

// Content block events
export interface ContentBlockStartEvent extends BaseStreamEvent {
  type: 'content_block_start'
  index: number
  content_block: {
    type: string
    text?: string
    name?: string
    id?: string
  }
}

export interface ContentBlockDeltaEvent extends BaseStreamEvent {
  type: 'content_block_delta'
  index: number
  delta: {
    type: string
    text?: string
    partial_json?: string
  }
}

export interface ContentBlockStopEvent extends BaseStreamEvent {
  type: 'content_block_stop'
  index: number
}

// Union of all event types
export type StreamEvent =
  | InitEvent
  | MessageEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent
  | SystemEvent
  | AssistantEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | (BaseStreamEvent & Record<string, unknown>) // Fallback for unknown events

/**
 * Parse a single line of NDJSON into a StreamEvent
 * Returns null if the line is empty or invalid
 */
export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)

    // Ensure minimum required fields
    if (!parsed.type) {
      // Some events might not have explicit type, add timestamp
      return {
        ...parsed,
        type: parsed.type || 'unknown',
        timestamp: parsed.timestamp || new Date().toISOString(),
      }
    }

    // Add timestamp if missing
    if (!parsed.timestamp) {
      parsed.timestamp = new Date().toISOString()
    }

    // Normalize field names for tool_use events
    // Claude Code outputs: { id, name, input }
    // Our types expect: { tool_id, tool_name, input }
    if (parsed.type === 'tool_use') {
      if (parsed.name && !parsed.tool_name) {
        parsed.tool_name = parsed.name
      }
      if (parsed.id && !parsed.tool_id) {
        parsed.tool_id = parsed.id
      }
    }

    // Normalize field names for tool_result events
    // Claude Code outputs: { tool_use_id, content/output }
    // Our types expect: { tool_id, output }
    if (parsed.type === 'tool_result') {
      if (parsed.tool_use_id && !parsed.tool_id) {
        parsed.tool_id = parsed.tool_use_id
      }
      // Handle content field (Claude Code sometimes uses 'content' instead of 'output')
      if (parsed.content && !parsed.output) {
        // content can be a string or an array of content blocks
        if (typeof parsed.content === 'string') {
          parsed.output = parsed.content
        } else if (Array.isArray(parsed.content)) {
          // Extract text from content blocks
          parsed.output = parsed.content
            .map((block: { text?: string }) => block.text || '')
            .filter(Boolean)
            .join('\n')
        }
      }
    }

    return parsed as StreamEvent
  } catch {
    // Not valid JSON - might be raw output, ignore
    return null
  }
}

/**
 * Create an async iterable that yields StreamEvents from a readable stream
 */
export async function* createEventStream(
  stdout: Readable
): AsyncIterable<StreamEvent> {
  let buffer = ''

  for await (const chunk of stdout) {
    buffer += chunk.toString()

    // Process complete lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      const event = parseStreamLine(line)
      if (event) {
        yield event
      }
    }
  }

  // Process any remaining content
  if (buffer.trim()) {
    const event = parseStreamLine(buffer)
    if (event) {
      yield event
    }
  }
}

/**
 * StreamEventParser class for event-driven parsing
 * Useful when you need to attach multiple listeners
 */
export class StreamEventParser extends EventEmitter {
  private buffer = ''

  constructor() {
    super()
  }

  /**
   * Feed raw data into the parser
   */
  write(data: string | Buffer): void {
    this.buffer += data.toString()
    this.processBuffer()
  }

  /**
   * Signal end of stream
   */
  end(): void {
    // Process any remaining content
    if (this.buffer.trim()) {
      const event = parseStreamLine(this.buffer)
      if (event) {
        this.emitEvent(event)
      }
    }
    this.buffer = ''
    this.emit('end')
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || '' // Keep incomplete line

    for (const line of lines) {
      const event = parseStreamLine(line)
      if (event) {
        this.emitEvent(event)
      }
    }
  }

  private emitEvent(event: StreamEvent): void {
    // Emit typed event
    this.emit(event.type, event)
    // Also emit generic event
    this.emit('event', event)
  }
}

/**
 * Helper to extract text content from various event types
 */
export function extractTextContent(event: StreamEvent): string | null {
  switch (event.type) {
    case 'message':
      return (event as MessageEvent).content

    case 'assistant': {
      const assistantEvent = event as AssistantEvent
      const content = assistantEvent.message?.content
      if (Array.isArray(content)) {
        return content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('')
      }
      return null
    }

    case 'content_block_delta': {
      const deltaEvent = event as ContentBlockDeltaEvent
      return deltaEvent.delta?.text || null
    }

    case 'result':
      return (event as ResultEvent).result || null

    default:
      return null
  }
}

/**
 * Helper to check if an event indicates completion
 */
export function isCompletionEvent(event: StreamEvent): boolean {
  return event.type === 'result'
}

/**
 * Helper to check if an event indicates an error
 */
export function isErrorEvent(event: StreamEvent): boolean {
  if (event.type === 'tool_result') {
    return (event as ToolResultEvent).is_error === true
  }
  if (event.type === 'system') {
    const sysEvent = event as SystemEvent
    return sysEvent.subtype === 'error'
  }
  return false
}

/**
 * Helper to format tool use event for display
 */
export function formatToolUse(event: ToolUseEvent): string {
  const inputStr = JSON.stringify(event.input, null, 2)
  return `${event.tool_name}\n${inputStr}`
}

/**
 * Helper to format tool result event for display
 */
export function formatToolResult(event: ToolResultEvent): string {
  const prefix = event.is_error ? '❌ ' : '✓ '
  return `${prefix}${event.output}`
}
