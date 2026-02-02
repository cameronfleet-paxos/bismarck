/**
 * Utility functions for detecting and handling PR URLs in agent output
 */

import type { StreamEvent } from './types'

/**
 * Extract PR URL from stream events
 * Looks for github.com/.../pull/NUMBER patterns in text content
 * Returns the most recent PR URL found, or null if none found
 */
export function extractPRUrl(events: StreamEvent[]): string | null {
  // Search through all text content in events in reverse order (most recent first)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
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

    // Look for PR URLs - match github.com/owner/repo/pull/NUMBER (not /pull/new/)
    // Must have a number at the end, not "new" or other paths
    const prMatch = text.match(/https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+(?![/\w])/g)
    if (prMatch) {
      // Return the last PR URL found in this event (most recent in text)
      return prMatch[prMatch.length - 1]
    }
  }
  return null
}
