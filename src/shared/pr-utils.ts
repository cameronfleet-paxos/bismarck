/**
 * Utility functions for detecting and handling PR URLs in agent output
 */

import type { StreamEvent } from './types'

/**
 * Extract all unique PR URLs from stream events
 * Looks for github.com/.../pull/NUMBER patterns in text content
 * Returns deduplicated URLs in order of first appearance
 */
export function extractPRUrls(events: StreamEvent[]): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const prPattern = /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?![/\w])/g

  for (const event of events) {
    const texts: string[] = []

    if (event.type === 'message') {
      texts.push((event as { content: string }).content || '')
    } else if (event.type === 'assistant') {
      const msg = event as { message?: { content?: Array<{ text?: string }> } }
      const content = msg.message?.content
      if (Array.isArray(content)) {
        texts.push(content.map((c) => c.text || '').join(''))
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event as { delta?: { text?: string } }
      texts.push(delta.delta?.text || '')
    } else if (event.type === 'tool_result') {
      // PR URLs often appear in tool_result output (e.g., from gh pr create)
      const result = event as { output?: string; content?: string }
      if (result.output) texts.push(result.output)
      if (result.content) texts.push(result.content)
    } else if (event.type === 'result') {
      // Final result may contain PR URLs
      const result = event as { result?: string }
      if (result.result) texts.push(result.result)
    } else if (event.type === 'content_block_start') {
      const block = event as { content_block?: { text?: string } }
      if (block.content_block?.text) texts.push(block.content_block.text)
    }

    for (const text of texts) {
      if (!text) continue
      const prMatches = text.match(prPattern)
      if (prMatches) {
        for (const url of prMatches) {
          if (!seen.has(url)) {
            seen.add(url)
            urls.push(url)
          }
        }
      }
    }
  }

  return urls
}

/**
 * Extract PR URL from stream events (convenience wrapper)
 * Returns the most recent PR URL found, or null if none found
 */
export function extractPRUrl(events: StreamEvent[]): string | null {
  const urls = extractPRUrls(events)
  return urls.length > 0 ? urls[urls.length - 1] : null
}
