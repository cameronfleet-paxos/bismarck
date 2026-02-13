/**
 * Shared cron expression utilities (used by both main and renderer)
 */

/**
 * Calculate human-readable description from a cron expression
 */
export function describeCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron

  const [min, hour, dom, month, dow] = parts

  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'Every hour'
  if (min === '0' && hour === '*/6' && dom === '*' && month === '*' && dow === '*') return 'Every 6 hours'
  if (dom === '*' && month === '*' && dow === '*' && min !== '*' && hour !== '*') return `Daily at ${hour}:${min.padStart(2, '0')}`
  if (dom === '*' && month === '*' && dow === '1-5' && min !== '*' && hour !== '*') return `Weekdays at ${hour}:${min.padStart(2, '0')}`
  if (dom === '*' && month === '*' && dow === '1' && min !== '*' && hour !== '*') return `Weekly (Mon ${hour}:${min.padStart(2, '0')})`

  return cron
}
