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

  for (const event of events) {
    let text = ''

    if (event.type === 'message') {
      text = (event as { content: string }).content || ''
    } else if (event.type === 'assistant') {
      const msg = event as { message?: { content?: Array<{ text?: string }> } }
      const content = msg.message?.content
      if (Array.isArray(content)) {
        text = content.map((c) => c.text || '').join('')
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event as { delta?: { text?: string } }
      text = delta.delta?.text || ''
    }

    const prMatches = text.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?![/\w])/g)
    if (prMatches) {
      for (const url of prMatches) {
        if (!seen.has(url)) {
          seen.add(url)
          urls.push(url)
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
