/**
 * Power Save Blocker
 *
 * Prevents macOS from sleeping while headless agents are active.
 * Uses reference counting — blocker is active when any agent is running.
 * Uses 'prevent-app-suspension' mode (doesn't prevent display dimming).
 */

import { powerSaveBlocker } from 'electron'

let enabled = true
let blockerId: number | null = null
const activeReasons = new Set<string>()

/**
 * Initialize power save module with current setting
 */
export function initPowerSave(settingEnabled: boolean): void {
  enabled = settingEnabled
  console.log(`[PowerSave] Initialized (enabled: ${enabled})`)
}

/**
 * Acquire a power save hold for the given reason.
 * Starts the blocker when the first reason is acquired.
 */
export function acquirePowerSave(reason: string): void {
  activeReasons.add(reason)
  console.log(`[PowerSave] Acquired: ${reason} (${activeReasons.size} active)`)
  startBlockerIfNeeded()
}

/**
 * Release a power save hold for the given reason.
 * Stops the blocker when the last reason is released.
 */
export function releasePowerSave(reason: string): void {
  activeReasons.delete(reason)
  console.log(`[PowerSave] Released: ${reason} (${activeReasons.size} active)`)
  stopBlockerIfNeeded()
}

/**
 * Update the enabled setting. Starts/stops the blocker as needed.
 */
export function setPreventSleepEnabled(newEnabled: boolean): void {
  enabled = newEnabled
  console.log(`[PowerSave] Setting changed (enabled: ${enabled})`)
  if (enabled) {
    startBlockerIfNeeded()
  } else {
    stopBlocker()
  }
}

/**
 * Get current power save state for UI display
 */
export function getPowerSaveState(): { enabled: boolean; active: boolean; reasons: string[] } {
  return {
    enabled,
    active: blockerId !== null,
    reasons: Array.from(activeReasons),
  }
}

/**
 * Clean up on app quit — stop any active blocker
 */
export function cleanupPowerSave(): void {
  stopBlocker()
  activeReasons.clear()
}

function startBlockerIfNeeded(): void {
  if (!enabled || activeReasons.size === 0 || blockerId !== null) return
  blockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[PowerSave] Blocker started (id: ${blockerId})`)
}

function stopBlockerIfNeeded(): void {
  if (activeReasons.size > 0 || blockerId === null) return
  stopBlocker()
}

function stopBlocker(): void {
  if (blockerId === null) return
  if (powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
  }
  console.log(`[PowerSave] Blocker stopped (id: ${blockerId})`)
  blockerId = null
}
