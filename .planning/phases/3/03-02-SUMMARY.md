---
phase: 03-attention-hooks
plan: 02
subsystem: terminal
tags: [codex, mapping, attention-hooks, terminal-spawn]
dependency-graph:
  requires: []
  provides: [codex-cwd-mapping]
  affects: [codex-notify-hook]
tech-stack:
  added: []
  patterns: [cwd-hash-mapping, defensive-mkdir, try-catch-guard]
key-files:
  modified:
    - src/main/terminal.ts
decisions:
  - SHA-256 hash of cwd, first 16 hex chars, for mapping file key
  - Mapping file created BEFORE PTY spawn to ensure hook readiness
  - try/catch guard so mapping failure cannot block terminal spawn
  - Uses getConfigDir() for path consistency with rest of app
metrics:
  duration: 113s
  completed: 2026-02-15T23:32:13Z
  tasks: 1
  files: 1
---

# Phase 3 Plan 02: CWD-Based Mapping File Creation Summary

**One-liner:** CWD-based SHA-256 mapping file written to ~/.bismarck/sessions/codex-{hash}.json at Codex terminal spawn time for hook script lookup.

## What Was Done

Added a mapping file creation block to `createTerminal()` in `src/main/terminal.ts`. When a Codex agent terminal is spawned, the code:

1. Computes a SHA-256 hash of the validated `cwd` directory path (first 16 hex chars)
2. Ensures `~/.bismarck/sessions/` directory exists via `mkdirSync({recursive: true})`
3. Writes `codex-{hash}.json` containing `{workspaceId, instanceId}` as JSON
4. The mapping file is created AFTER the agent command is built but BEFORE the PTY process is spawned
5. The entire block is wrapped in try/catch so a failure to write the mapping file does not prevent the terminal from starting

This mapping file is consumed by the `codex-notify-hook.sh` script (from Plan 01) to route Codex `agent-turn-complete` events back to the correct Bismarck workspace and socket.

## Changes

### src/main/terminal.ts

**Import change (line 8):** Added `getConfigDir` to the import from `./config`:
```typescript
import { getWorkspaceById, saveWorkspace, getConfigDir } from './config'
```

**New mapping block (lines 254-269):** After provider-specific command building, before PTY spawn:
```typescript
if (provider === 'codex') {
  try {
    const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)
    const sessionsDir = path.join(getConfigDir(), 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })
    const mappingPath = path.join(sessionsDir, `codex-${hash}.json`)
    fs.writeFileSync(mappingPath, JSON.stringify({
      workspaceId,
      instanceId: getInstanceId(),
    }))
  } catch (err) {
    devLog(`[Terminal] Failed to write Codex mapping file for workspace ${workspaceId}:`, err)
  }
}
```

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASSED (zero errors) |
| `grep "codex-" terminal.ts` | PASSED (lines 255, 261) |
| `grep "createHash.*sha256" terminal.ts` | PASSED (line 258) |
| `grep "getConfigDir" terminal.ts` | PASSED (import line 8, usage line 259) |
| `grep "getInstanceId" terminal.ts` | PASSED (line 264 in mapping content) |
| `grep "workspaceId" terminal.ts` | PASSED (line 263 in mapping JSON) |
| `provider === 'codex'` guard confirmed | PASSED (mapping at line 256) |
| `provider === 'codex'` count >= 3 | PASSED (4 occurrences: binary check, command build, mapping, session capture) |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6e86d7c | feat(03-02): add CWD-based mapping file creation for Codex agents |

## Deviations from Plan

None -- plan executed exactly as written.

## Notes

- The `hook-manager.ts` file was also included in the commit due to pre-existing staged changes from Plan 01 execution. This does not affect the correctness of this plan's changes.
- All imports used (`crypto`, `fs`, `path`, `getInstanceId`, `devLog`) were already available in the file; only `getConfigDir` was newly added to the import.
- The `sessionsDir` is created at app startup by `ensureConfigDirExists()`, but the defensive `mkdirSync({recursive: true})` call ensures correctness even if that startup initialization hasn't run yet.

## Self-Check: PASSED

- [x] File exists: src/main/terminal.ts
- [x] Commit exists: 6e86d7c
