---
phase: 02-terminal-spawning
plan: 02
subsystem: terminal
tags: [codex, terminal, provider-aware, session-management]
dependency_graph:
  requires: ["01-01 (AgentProvider type system)", "02-01 (dead code cleanup)"]
  provides: ["Provider-aware createTerminal", "Codex session discovery", "Codex command building"]
  affects: ["src/main/terminal.ts"]
tech_stack:
  added: []
  patterns: ["provider branching", "filesystem session scanning", "command builder extraction"]
key_files:
  created: []
  modified: ["src/main/terminal.ts"]
decisions:
  - "Codex session ID is a UUID from SessionMeta first line, not the rollout filename"
  - "Session discovery scans ~/.codex/sessions/ recursively, sorted by mtime (newest first)"
  - "Non-Claude providers report ready immediately after command write (no TUI indicator to detect)"
  - "buildClaudeCommand extracted from inline code to match buildCodexCommand pattern"
metrics:
  duration: 270s
  completed: 2026-02-15
---

# Phase 2 Plan 02: Provider-Aware Terminal Spawning Summary

Provider-aware createTerminal with Codex command building, session management via filesystem scanning, binary detection with styled terminal error, and Claude-only hooks for /clear and ready detection.

## What Was Done

### Task 1: Add helper functions and command builders
Added new imports (`getAgentProvider`, `AgentProvider`, `findBinary`) and five new functions to terminal.ts without modifying any existing code:
- `findJsonlFilesRecursive(dir)` -- recursively find .jsonl files under a directory
- `codexSessionExists(sessionId)` -- check if a Codex session exists by UUID in ~/.codex/sessions/
- `findCodexSessionForDirectory(directory)` -- find most recent Codex session matching a working directory
- `buildClaudeCommand(options)` -- extracted Claude CLI command construction
- `buildCodexCommand(options)` -- new Codex CLI command construction (new session and resume)

**Commit:** `e27d1b6`

### Task 2: Refactor createTerminal to use provider branching
Replaced the inline Claude command construction block with provider-aware logic:
- Added `getAgentProvider(workspace)` call after directory validation
- Added `findBinary('codex')` check with `skipCommand` flag
- Replaced `claudeCmd` variable entirely with `agentCmd`
- Claude branch: unchanged session management (randomUUID, claudeSessionExists, --resume/--session-id)
- Codex branch: session management via codexSessionExists, buildCodexCommand with --cd flag
- Both prompt handler and fallback timeout now branch on `skipCommand` for styled error vs agentCmd

**Commit:** `c0d540c`

### Task 3: Provider-aware hooks and Codex session capture on exit
Made provider-specific behaviors conditional and added exit-time session discovery:
- Wrapped /clear detection (`(no content)`) in `provider === 'claude'` guard
- Wrapped Claude ready detection (unicode triangle) in `provider === 'claude'` guard
- Added immediate ready reporting for non-Claude providers after command write
- Added Codex session capture in `onExit` handler: scans `~/.codex/sessions/` for matching directory, saves UUID to workspace

**Commit:** `6c414b1`

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

All 11 verification checks passed:

1. `npx tsc --noEmit` -- zero errors
2. Both `buildClaudeCommand` and `buildCodexCommand` present
3. `findBinary('codex')` for binary detection present
4. All three session helpers (`codexSessionExists`, `findCodexSessionForDirectory`, `findJsonlFilesRecursive`) present
5. `getAgentProvider` usage in createTerminal confirmed
6. No `claudeCmd` references in createTerminal (only in unrelated `createSetupTerminal`)
7. `/clear` (`(no content)`) detection is inside `provider === 'claude'` guard
8. Ready detection (unicode triangle) is inside `provider === 'claude'` guard
9. Codex session capture on exit with `findCodexSessionForDirectory` confirmed
10. Styled error message for missing codex binary confirmed
11. Directory paths single-quoted in `buildCodexCommand` confirmed

Claude behavior verified unchanged:
- Session resolution still uses `crypto.randomUUID()`, `--session-id`, `--resume`
- `/clear` detection still clears sessionId
- Ready detection still uses the unicode triangle character

## Self-Check: PASSED

- FOUND: src/main/terminal.ts (modified)
- FOUND: e27d1b6 (Task 1 commit)
- FOUND: c0d540c (Task 2 commit)
- FOUND: 6c414b1 (Task 3 commit)
