---
phase: 03-attention-hooks
plan: 01
subsystem: hook-manager
tags: [codex, hooks, toml, attention, notify]
dependency_graph:
  requires: [01-01, 02-02]
  provides: [configureCodexHook, createCodexNotifyHookScript, codex-notify-hook.sh]
  affects: [main-startup, hook-manager]
tech_stack:
  added: [smol-toml]
  patterns: [toml-round-trip, precondition-gating, idempotent-config-write]
key_files:
  created: []
  modified:
    - src/main/hook-manager.ts
    - src/main/main.ts
    - package.json
    - package-lock.json
decisions:
  - "Used smol-toml for TOML parsing (most popular, actively maintained, TOML 1.1.0 compliant)"
  - "Precondition gate: hasBinary('codex') AND at least one agent has provider=codex"
  - "Skip (not overwrite) if user has existing notify command in config.toml"
  - "SHA-256 first 16 hex chars for cwd-based mapping file lookup"
metrics:
  duration: 221s
  completed: 2026-02-15T23:33:51Z
  tasks: 3
  files: 4
---

# Phase 3 Plan 01: Codex Attention Hook Registration Summary

smol-toml installed, codex-notify-hook.sh template and configureCodexHook() added to hook-manager.ts, wired into app startup alongside configureClaudeHook().

## What Was Built

### 1. smol-toml Dependency (Task 1)
Installed `smol-toml ^1.6.0` as a production dependency. This library provides `parse()` and `stringify()` for safe round-trip reading/writing of `~/.codex/config.toml`.

### 2. Codex Notify Hook Script (Task 2)
Added `createCodexNotifyHookScript()` to `hook-manager.ts`. This function writes `codex-notify-hook.sh` to `~/.bismarck/hooks/` (or `~/.bismarck-dev/hooks/` in dev mode). The script:
- Receives JSON as `argv[1]` from Codex's notify callback
- Extracts `cwd` from the JSON payload using grep/cut (no jq dependency)
- Hashes the cwd with SHA-256 (first 16 hex chars) to find the mapping file
- Reads `workspaceId` and `instanceId` from `~/.bismarck/sessions/codex-{hash}.json`
- Sends `{"event":"stop","reason":"input_required","workspaceId":"..."}` to the Bismarck Unix socket
- Exits silently (exit 0) at every failure point to avoid disrupting Codex

### 3. configureCodexHook() (Task 2)
Added `configureCodexHook()` to `hook-manager.ts`. This function:
- **Precondition check:** Only runs if `codex` binary exists (via `hasBinary()`) AND at least one workspace has `provider === 'codex'`
- **Creates the hook script** via `createCodexNotifyHookScript()`
- **Reads** `~/.codex/config.toml` using smol-toml `parse()`
- **Idempotent:** If our script is already the notify value, skips
- **Respects user config:** If user has a different notify command, logs a warning and does NOT overwrite
- **Creates** `~/.codex/` directory if it doesn't exist
- **Writes** updated TOML config using smol-toml `stringify()`

### 4. Startup Wiring (Task 3)
Updated `main.ts` to import `configureCodexHook` and call it at startup via `timeSync('main:configureCodexHook', ...)` immediately after `configureClaudeHook()`.

## Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Install smol-toml dependency | a6ac92c | package.json, package-lock.json |
| 2 | Add Codex hook script and configureCodexHook | 6e86d7c | src/main/hook-manager.ts |
| 3 | Wire configureCodexHook into startup | 471f003 | src/main/main.ts |

## Deviations from Plan

None -- plan executed exactly as written.

**Note:** Task 2's hook-manager.ts changes were committed alongside Plan 03-02's terminal.ts changes in commit `6e86d7c` due to concurrent execution by a parallel agent. The hook-manager.ts modifications are exactly as specified in the plan.

## Decisions Made

1. **smol-toml as TOML library** -- Most popular on npm, actively maintained, supports parse+stringify, TOML 1.1.0 compliant. No alternatives seriously considered given research findings.
2. **Precondition gating** -- Two conditions must both be true: codex binary installed AND at least one codex agent configured. Prevents touching `~/.codex/config.toml` for Claude-only users.
3. **Skip over overwrite** -- If user has an existing notify command that isn't ours, we log and skip rather than overwrite. This respects user configuration at the cost of not installing our hook in that case.
4. **SHA-256 with 16 hex chars** -- Provides 64-bit collision space, more than sufficient for practical directory path uniqueness. Matches the approach in the companion mapping file creation (Plan 03-02).

## Verification Results

- [x] `npx tsc --noEmit` passes with zero errors
- [x] `smol-toml` in package.json dependencies (line 140)
- [x] `configureCodexHook` exported in hook-manager.ts (line 265)
- [x] `createCodexNotifyHookScript` exported in hook-manager.ts (line 231)
- [x] `configureCodexHook` imported and called in main.ts (lines 62, 1645)
- [x] `codex-notify-hook` script name in hook-manager.ts (line 14)
- [x] `shasum` hash command in hook script template (line 245)
- [x] `hasBinary('codex')` precondition check (line 267)
- [x] `provider === 'codex'` agent filter (line 272)
- [x] `parse`/`stringify` TOML operations (lines 4, 289, 318)

## Self-Check: PASSED

All created files exist and all commit hashes verified in git history.
