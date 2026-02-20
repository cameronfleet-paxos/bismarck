---
phase: 02-terminal-spawning
plan: 01
subsystem: terminal
tags: [cleanup, dead-code-removal, terminal]
dependency-graph:
  requires: []
  provides: [clean-terminal-module]
  affects: [terminal.ts, terminal-queue.ts]
tech-stack:
  added: []
  patterns: [pure-deletion-refactor]
key-files:
  created: []
  modified:
    - src/main/terminal.ts
    - src/main/terminal-queue.ts
decisions:
  - "Removed trust prompt auto-accept handler entirely -- never worked reliably per user"
  - "Removed accept-mode cycling handler entirely -- dead code for all providers"
  - "Shell prompt handler (4th onData) correctly preserved despite plan predicting 3 handlers"
metrics:
  duration: 140s
  completed: 2026-02-15T22:57:58Z
---

# Phase 2 Plan 1: Remove Dead Terminal Code Summary

Removed autoAcceptMode parameter, trust prompt auto-accept handler, and accept-mode cycling handler from terminal.ts and terminal-queue.ts -- pure deletion of dead code that never worked reliably.

## Tasks Completed

| Task | Name | Commit | Key Changes |
| ---- | ---- | ------ | ----------- |
| 1 | Remove dead code from terminal.ts | 08fe26b | Removed autoAcceptMode param, trust prompt handler (lines 180-210), accept-mode cycling handler (lines 212-250) |
| 2 | Remove autoAcceptMode from terminal-queue.ts | c3a963d | Removed autoAcceptMode from QueuedTerminal interface, spawnTerminal call, queueTerminalCreation params |

## Verification Results

| Check | Result |
| ----- | ------ |
| `npx tsc --noEmit` | Zero errors |
| `autoAcceptMode` in src/ | Zero matches |
| `trustPrompt` in terminal.ts | Zero matches |
| `acceptMode` in terminal.ts | Zero matches |
| createTerminal has 4 params | Confirmed (workspaceId, mainWindow, initialPrompt, claudeFlags) |
| Shell prompt detection preserved | Confirmed (promptDetected) |
| /clear detection preserved | Confirmed (no content) |
| Claude ready detection preserved | Confirmed (claudeReadyDetected) |

## What Was Removed

### From terminal.ts (73 lines deleted)
- **autoAcceptMode parameter** from `createTerminal()` function signature (5th parameter)
- **Trust prompt auto-accept handler** (lines 180-210): `trustPromptBuffer`, `trustPromptDebounce`, `trustBufferClearTimeout` variables and the `ptyProcess.onData` handler that buffered output looking for "Yes, I trust this folder" prompts in .bismarck directories
- **Accept-mode cycling handler** (lines 212-250): `acceptModeAttempts`, `MAX_ACCEPT_MODE_ATTEMPTS`, `acceptModeDebounce`, `acceptModeDone` variables and the `ptyProcess.onData` handler that sent Shift+Tab to cycle through accept modes

### From terminal-queue.ts (3 lines deleted)
- `autoAcceptMode?: boolean` from `QueuedTerminal` interface options
- `item.options?.autoAcceptMode` from `createTerminal()` call in `spawnTerminal()`
- `autoAcceptMode?: boolean` from `queueTerminalCreation()` options parameter

## What Was Preserved

All legitimate terminal functionality remains intact:
- Data forwarding handler (emitter + mainWindow IPC)
- /clear detection handler (session ID reset on "(no content)")
- Shell prompt detection handler (auto-start Claude after shell init)
- Claude ready detection handler (benchmark milestone on status line)
- PTY spawning, resize, close, exit handling
- Session persistence (resume/new session logic)
- All other exported functions unchanged

## Deviations from Plan

### Minor Discrepancy (Not a deviation)

**Plan predicted 3 `ptyProcess.onData` handlers after cleanup; actual count is 4.**
The plan listed "data forwarding, /clear detection, Claude ready detection" but forgot to count the shell prompt detection handler (`ptyProcess.onData(promptHandler)` at line 198). This handler was always present and is not dead code -- it correctly remains. No action needed.

No other deviations. Plan executed exactly as written.

## Self-Check: PASSED

- [x] src/main/terminal.ts -- FOUND
- [x] src/main/terminal-queue.ts -- FOUND
- [x] 02-01-SUMMARY.md -- FOUND
- [x] Commit 08fe26b -- FOUND
- [x] Commit c3a963d -- FOUND
