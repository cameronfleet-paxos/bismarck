# Phase 3 UAT: Attention Hooks for Codex

**Phase Goal:** Codex agents trigger Bismarck's attention system when they finish a turn.
**Date:** 2026-02-15
**Status:** PASS

## Test Results

### T1: smol-toml production dependency
**Result:** PASS
- `smol-toml: "^1.6.0"` listed in `package.json` dependencies (line 140)
- Not a devDependency — available at runtime in main process

### T2: codex-notify-hook.sh script creation
**Result:** PASS
- `createCodexNotifyHookScript()` at `hook-manager.ts:231-263`
- Receives JSON as `$1` (argv[1]), extracts `cwd` via grep/cut
- Hashes cwd with `shasum -a 256 | cut -c1-16`
- Reads mapping file from `~/.bismarck/sessions/codex-{hash}.json`
- Sends `{"event":"stop","reason":"input_required","workspaceId":"..."}` to Unix socket
- Uses `getConfigDirName()` for dev/prod-aware path
- Chmod 755

### T3: configureCodexHook() preconditions & idempotency
**Result:** PASS
- Gates on `hasBinary('codex')` — skips if codex not installed
- Gates on `workspaces.some(w => w.provider === 'codex')` — skips if no codex agents
- Idempotent: checks if `currentNotify[0] === hookScriptPath` before adding
- Does NOT overwrite user's existing notify setting (logs warning and skips)
- Creates `~/.codex/` directory if needed
- Parses TOML with `smol-toml.parse()`, writes with `smol-toml.stringify()`

### T4: configureCodexHook wired at startup
**Result:** PASS
- `main.ts:1645`: `timeSync('main:configureCodexHook', 'main', () => configureCodexHook())`
- Immediately after `configureClaudeHook()` (line 1644)
- Import includes `configureCodexHook` from `./hook-manager`

### T5: CWD-based mapping file creation in terminal.ts
**Result:** PASS
- `terminal.ts:254-269`: Inside `provider === 'codex'` guard
- SHA-256 hash of `cwd`, first 16 hex chars
- Writes `codex-{hash}.json` to `getConfigDir()/sessions/`
- Content: `{workspaceId, instanceId: getInstanceId()}`
- Wrapped in try/catch — failure cannot block terminal spawn
- Positioned BEFORE `pty.spawn()` (line 275)
- Claude agents completely unaffected

### T6: TypeScript compilation
**Result:** PASS
- `npx tsc --noEmit` passes with zero errors

### T7: Hash consistency between Node.js and bash
**Result:** PASS
- Node: `crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)`
- Bash: `printf '%s' "$CWD" | shasum -a 256 | cut -c1-16`
- Both produce identical hex-encoded SHA-256 first 16 chars
- `printf '%s'` avoids trailing newline, matching Node.js behavior

## Summary

All 7 tests passed. Phase 3 delivers:
1. **Hook registration** — `configureCodexHook()` installs notify callback in `~/.codex/config.toml`
2. **Hook script** — `codex-notify-hook.sh` translates Codex events to Bismarck socket events
3. **Mapping bridge** — `terminal.ts` creates CWD-based mapping files so the hook can find the right workspace
4. **Startup wiring** — Everything runs at app startup alongside Claude hook configuration

The attention pipeline is complete: Codex turn-complete → notify callback → hook script → mapping lookup → socket event → Bismarck attention badge.
