# Phase 2: Terminal Spawning for Codex - Research

**Researched:** 2026-02-15
**Domain:** OpenAI Codex CLI integration, terminal spawning, session management
**Confidence:** HIGH

## Summary

Codex CLI (`codex`) is a Rust-based TUI agent from OpenAI, installed via `npm install -g @openai/codex` or `brew install --cask codex`. It shares the same terminal-spawning pattern as Claude Code: spawn a shell via node-pty, detect the shell prompt, then write the CLI command into the PTY. The key differences from Claude are: (1) session IDs are UUIDs stored in `~/.codex/sessions/` as JSONL rollout files with a `SessionMeta` first line containing the `cwd`, (2) resume is a subcommand (`codex resume <SESSION_ID>`) not a flag (`--resume`), (3) the TUI is built with Ratatui (full-screen) with a configurable status line footer rather than Claude's inline `⏵` indicator, and (4) there is no `/clear` equivalent -- `/new` starts a fresh conversation instead.

The existing `findBinary()` in `exec-utils.ts` already searches all standard installation paths (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, etc.) and will locate the `codex` binary. The `--cd` flag is a global flag (also `-C`) that works with all subcommands including `resume`. Session discovery by working directory is built into Codex's `--last` flag, and the `SessionMeta` first line in each rollout file contains the original `cwd`.

**Primary recommendation:** Build a provider-aware command builder that constructs the appropriate CLI invocation string based on `getAgentProvider(agent)`, reusing the existing PTY spawn, shell prompt detection, and data forwarding infrastructure unchanged.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Check timing:** Validate at spawn time (Phase 2). Also validate at agent creation time (Phase 4, later). Phase 2 implements the spawn-time safety net.
- **Detection method:** Use `command -v codex` (or equivalent `which`) before spawning. Same pattern as tool detection in settings-manager.
- **Error display:** If `codex` binary not found, write a styled error message directly into the terminal output (e.g., "codex not found. Install with: npm install -g @openai/codex"). Terminal stays open showing the error. Do NOT send IPC error or fall back to shell.
- **Startup check:** No app-wide startup scan for codex availability. Check per-agent at spawn time only.
- **Session tracking:** Full session support for Codex agents in Phase 2. Codex agents track sessionId and support resume.
- **Session capture timing:** On terminal exit, scan `~/.codex/sessions/` for the most recent session file matching the agent's directory. Store the rollout ID as the agent's `sessionId`.
- **Session ID format:** Store rollout ID only (e.g., `rollout-abc123`), not the full path. The resume command uses this format: `codex resume <rollout-id> --cd <dir>`.
- **Resume behavior:** On terminal open, if agent has a sessionId, check if the session file exists. If yes, use `codex resume <id> --cd <dir>`. If no, start fresh with `codex --cd <dir>`.
- **Reopen without session:** Fresh start every time when no valid session exists. No attempt to show previous session output.
- **Agent.sessionId:** Populated for Codex agents after first session. Stores the rollout ID.
- **Trust prompt auto-accept (lines 184-210):** REMOVE entirely. Never worked reliably. Delete for all providers, not just Codex.
- **Accept-mode cycling (lines 214-250):** REMOVE entirely. Never worked reliably. Users can set accept-edits as their default in Claude settings. Delete for all providers.
- **`autoAcceptMode` parameter:** REMOVE from `createTerminal()` signature and all call sites. Full cleanup.
- **`/clear` detection (lines 170-178):** Make provider-aware. Only attach for Claude agents. Codex doesn't have an equivalent `/clear` command that outputs `(no content)`.
- **Ready detection (`⏵` character, lines 284-295):** Research needed for Codex. Claude uses `⏵` in its status line. Need to find Codex's equivalent ready signal, if any. For now, skip Codex-specific ready detection -- terminal is "ready" when PTY spawns.
- **Initial prompt:** Codex agents support initial prompts. Pass as quoted argument: `codex --cd <dir> "<prompt>"`. Same pattern as Claude.

### Claude's Discretion
- Provider-specific command construction details
- How to structure the provider-aware code (strategy pattern, switch, etc.)

### Deferred Ideas (OUT OF SCOPE)
- Codex approval policy flags (--full-auto, --suggest, --auto-edit) -- could be Phase 4 UI setting
- Codex sandbox mode configuration -- future per-provider settings
- Codex model selection (different from Claude's model names) -- future
- App-startup codex availability scan with warning badge -- future polish

</user_constraints>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-pty | current | PTY spawning for terminal emulation | Already used for Claude terminals, works identically for Codex |
| electron | current | IPC, BrowserWindow for terminal data forwarding | Existing infrastructure |

### External CLIs
| Binary | Install | Purpose | Detection |
|--------|---------|---------|-----------|
| codex | `npm install -g @openai/codex` or `brew install --cask codex` | OpenAI's coding agent CLI | `findBinary('codex')` from `exec-utils.ts` |

### No New Dependencies
Phase 2 requires zero new npm packages. Everything is built on the existing `node-pty` + Electron IPC infrastructure with provider-aware branching logic.

## Architecture Patterns

### Provider-Aware Command Builder

The central pattern is a function that takes an `Agent` and returns the CLI command string to write into the PTY after shell prompt detection.

```typescript
// Pattern: Provider command builder
function buildAgentCommand(agent: Agent, options?: { initialPrompt?: string, claudeFlags?: string }): string {
  const provider = getAgentProvider(agent)

  switch (provider) {
    case 'claude':
      return buildClaudeCommand(agent, options)
    case 'codex':
      return buildCodexCommand(agent, options)
  }
}
```

### Provider-Specific Session Functions

Each provider has different session semantics:

```typescript
// Claude: sessions in ~/.claude/projects/<hash>/<sessionId>.jsonl
// Session IDs are UUIDs generated by Bismarck, passed via --session-id / --resume flags
function claudeSessionExists(sessionId: string): boolean { ... }

// Codex: sessions in ~/.codex/sessions/[<provider_id>/]<YYYY-MM-DD>/<uuid>.jsonl
// Session IDs are UUIDs generated by Codex, discovered from SessionMeta.cwd matching
function codexSessionExists(sessionId: string): boolean { ... }
function findCodexSessionForDirectory(directory: string): string | null { ... }
```

### Provider-Specific Hooks (Attach Conditionally)

```typescript
// /clear detection: Claude only
if (provider === 'claude') {
  ptyProcess.onData(clearDetectionHandler)
}

// Ready detection: Claude uses ⏵, Codex has no equivalent
if (provider === 'claude') {
  ptyProcess.onData(claudeReadyHandler)
}
// For Codex: "ready" = PTY spawned + command written (no TUI signal detection)
```

### What Stays Universal (No Provider Branching)
- Shell spawn via `pty.spawn(shell, ['-l'], { ... })`
- Shell prompt detection (`/$%>]\s*$/`)
- Terminal data forwarding to renderer
- Terminal resize/write/close operations
- Process exit handling
- `injectTextToTerminal` / `injectPromptToTerminal` (prompt injection)

### Recommended Refactoring Structure

```
src/main/terminal.ts              # Main file, now provider-aware
  - createTerminal()              # Branches on provider for command building
  - buildClaudeCommand()          # Claude-specific command construction
  - buildCodexCommand()           # Codex-specific command construction
  - claudeSessionExists()         # Existing function (unchanged)
  - codexSessionExists()          # New: check session file by ID
  - findCodexSessionForDir()      # New: scan sessions dir for cwd match
```

Keep everything in `terminal.ts` for now. No need for separate files per provider -- the branching is localized to command construction and session management.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Binary detection | Custom PATH search | `findBinary('codex')` from `exec-utils.ts` | Already handles GUI app PATH issues, searches all standard locations |
| Session ID generation (Codex) | UUID generation like Claude | Codex generates its own session IDs | Codex manages its own session lifecycle; Bismarck discovers the ID post-exit |
| TUI ready detection (Codex) | ANSI parsing for Ratatui status line | Skip it -- treat PTY spawn as "ready" | Ratatui's full-screen TUI uses complex ANSI sequences; detecting "ready" would be fragile and the CONTEXT.md decision says to skip it |
| Session file parsing | Full JSONL parser | Read first line only, parse as JSON, extract `cwd` field | SessionMeta is always the first line; no need to parse entire rollout file |

**Key insight:** Codex manages its own session lifecycle (ID generation, file creation, resume). Bismarck's role is to *discover* the session ID after exit, not to *create* it. This is the opposite of Claude, where Bismarck generates the UUID and passes it via `--session-id`.

## Common Pitfalls

### Pitfall 1: Session ID Format Confusion
**What goes wrong:** CONTEXT.md mentions "rollout-abc123" format for session IDs, but actual Codex session IDs are UUIDs (e.g., `7f9f9a2e-1b3c-4c7a-9b0e-...`). The files are *named* `rollout-*.jsonl` but the session ID inside is a UUID.
**Why it happens:** The filename pattern `rollout-*.jsonl` looks like the session ID, but it's just a file naming convention. The actual ID is in the `SessionMeta` first line.
**How to avoid:** Store the UUID from `SessionMeta.id`, not the filename. Use `codex resume <UUID>` for resume.
**Warning signs:** `codex resume rollout-xxx` failing because it's a filename, not an ID.
**Confidence:** HIGH -- verified via DeepWiki source analysis and official resume docs showing UUID format.

**UPDATE on CONTEXT.md decision:** The CONTEXT.md says "Store rollout ID only (e.g., `rollout-abc123`)". Research shows the actual session identifier is a UUID (e.g., `7f9f9a2e-1b3c-4c7a-9b0e-...`), not a filename prefix. The planner should note this discrepancy and use UUIDs. The `codex resume` command accepts UUIDs.

### Pitfall 2: Session Directory Structure Varies
**What goes wrong:** The session directory may include a provider_id subdirectory: `~/.codex/sessions/<provider_id>/<YYYY-MM-DD>/` vs just `~/.codex/sessions/<YYYY-MM-DD>/`.
**Why it happens:** Different versions of Codex and different provider configurations may use different directory structures.
**How to avoid:** When scanning for session files, search recursively under `~/.codex/sessions/` rather than assuming a fixed depth. Look for `*.jsonl` files and parse the first line for `SessionMeta`.
**Warning signs:** Session scan finding zero files despite sessions existing.
**Confidence:** MEDIUM -- DeepWiki mentions provider_id subdirectory, official docs say `YYYY/MM/DD`. Need to handle both.

### Pitfall 3: CWD Mismatch on Resume
**What goes wrong:** `codex resume` can adopt the caller's CWD instead of the session's original CWD. This was a known bug (GitHub issue #4791) that was partially fixed.
**Why it happens:** Config loading defaults to `std::env::current_dir()` when no `--cd` flag is provided.
**How to avoid:** Always pass `--cd <dir>` when resuming: `codex resume <SESSION_ID> --cd <dir>`. This ensures the agent works in the correct directory regardless of shell CWD.
**Warning signs:** Codex agent working in wrong directory after resume.
**Confidence:** HIGH -- verified via GitHub issue #4791 and official docs confirming `--cd` is a global flag for all subcommands.

### Pitfall 4: Removing autoAcceptMode Breaks Callers
**What goes wrong:** Removing `autoAcceptMode` from `createTerminal()` signature without updating all call sites causes TypeScript compilation errors.
**Why it happens:** The parameter is used at multiple call sites.
**How to avoid:** Search all callers of `createTerminal()` before removing the parameter. Use TypeScript compiler errors as a guide.
**Warning signs:** `tsc --noEmit` failures after removal.
**Confidence:** HIGH -- straightforward TypeScript refactoring.

### Pitfall 5: Trust Prompt Auto-Accept Removal Affects Claude
**What goes wrong:** The trust prompt handler (lines 184-210) is being removed for ALL providers per CONTEXT.md. Ensure this doesn't regress Claude's UX for `.bismarck` directory trust prompts.
**Why it happens:** The CONTEXT.md says it "never worked reliably" -- but partial functionality may have been relied upon.
**How to avoid:** Verify with user that full removal is intended. The CONTEXT.md decision is clear: "REMOVE entirely."
**Warning signs:** Users seeing trust prompts they previously didn't see.
**Confidence:** HIGH -- decision is locked in CONTEXT.md.

## Code Examples

### Codex Command Construction (New Session)

```typescript
// Source: Official CLI reference (developers.openai.com/codex/cli/reference/)
// codex --cd <dir> [PROMPT]
function buildCodexCommand(agent: Agent, options?: { initialPrompt?: string }): string {
  let cmd = 'codex'
  cmd += ` --cd ${agent.directory}`

  if (options?.initialPrompt) {
    const escaped = options.initialPrompt.replace(/'/g, "'\\''")
    cmd += ` '${escaped}'`
  }

  return cmd + '\n'
}
```

### Codex Command Construction (Resume Session)

```typescript
// Source: Official CLI reference -- resume accepts global flags including --cd
// codex resume <SESSION_ID> --cd <dir>
function buildCodexResumeCommand(agent: Agent): string {
  let cmd = `codex resume ${agent.sessionId}`
  cmd += ` --cd ${agent.directory}`
  return cmd + '\n'
}
```

### Codex Session Discovery (On Terminal Exit)

```typescript
// Source: DeepWiki session resumption docs + official session storage docs
// Sessions stored in ~/.codex/sessions/[provider_id/]YYYY-MM-DD/<uuid>.jsonl
// First line is SessionMeta JSON with { id, cwd, ... }
function findCodexSessionForDirectory(directory: string): string | null {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) return null

  // Recursively find all .jsonl files, sorted by mtime (newest first)
  const jsonlFiles = findJsonlFiles(sessionsDir)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

  for (const file of jsonlFiles) {
    try {
      // Read only the first line (SessionMeta)
      const firstLine = readFirstLine(file)
      const meta = JSON.parse(firstLine)

      // Match by cwd (may need to handle RolloutLine envelope format too)
      const cwd = meta.cwd || meta.payload?.cwd
      if (cwd === directory) {
        return meta.id || meta.payload?.id
      }
    } catch {
      continue
    }
  }

  return null
}
```

### Codex Session Existence Check

```typescript
// Check if a specific Codex session ID still exists on disk
function codexSessionExists(sessionId: string): boolean {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) return false

  // Search recursively for a file whose SessionMeta.id matches
  const jsonlFiles = findJsonlFiles(sessionsDir)
  for (const file of jsonlFiles) {
    try {
      const firstLine = readFirstLine(file)
      const meta = JSON.parse(firstLine)
      const id = meta.id || meta.payload?.id
      if (id === sessionId) return true
    } catch {
      continue
    }
  }
  return false
}
```

### Binary Detection at Spawn Time

```typescript
// Source: Existing pattern in exec-utils.ts
import { findBinary } from './exec-utils'

// In createTerminal(), before building command:
const provider = getAgentProvider(workspace)
if (provider === 'codex') {
  const codexPath = findBinary('codex')
  if (!codexPath) {
    // Write styled error to terminal, don't throw
    const errorMsg = '\r\n\x1b[31m  codex not found\x1b[0m\r\n\r\n'
      + '  Install with: \x1b[36mnpm install -g @openai/codex\x1b[0m\r\n'
      + '  Or:           \x1b[36mbrew install --cask codex\x1b[0m\r\n\r\n'
    // Send error message to renderer via terminal-data channel
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', terminalId, errorMsg)
    }
    return terminalId // Terminal stays open showing error
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Session files in flat `YYYY/MM/DD/` | May include `<provider_id>/` subdirectory | Late 2025 | Session scanning must be recursive |
| Bare SessionMeta JSON first line | RolloutLine envelope `{ type, payload }` format | PR #3380 (2025) | Parser must handle both bare and enveloped formats |
| `codex resume` ignores CWD | `codex resume` filters by CWD (with `--last`) | Jan 2026 | `--cd` flag still recommended for explicit control |
| No `--version` flag | `--version` flag added (PR #492) | 2025 | Can use for detection: `codex --version` |

**Deprecated/outdated:**
- The `--resume` / `--continue` flags mentioned in some early docs were replaced by the `resume` subcommand
- Session files may use old bare JSON format or new RolloutLine envelope format -- handle both

## Detailed Research Findings

### Q1: Codex Session Resume Command Format

**Exact syntax:** `codex resume <SESSION_ID>` where SESSION_ID is a UUID (not a rollout filename).

**`--cd` flag:** YES, `--cd` (alias `-C`) is a global flag that works with all subcommands including `resume`. Syntax: `codex resume <SESSION_ID> --cd <dir>`.

**Session storage:** `~/.codex/sessions/[<provider_id>/]<YYYY-MM-DD>/<uuid>.jsonl` (may or may not have provider_id subdirectory).

**Finding session for directory:** The SessionMeta (first line of JSONL file) contains a `cwd` field. To find the correct session: scan `~/.codex/sessions/` recursively for `.jsonl` files, read the first line, parse JSON, match `cwd` to the agent's directory.

**Confidence:** HIGH for resume syntax (official docs). MEDIUM for exact SessionMeta field names (from DeepWiki/GitHub analysis, not official schema docs).

### Q2: Codex TUI Ready Signal

**TUI type:** Full-screen TUI built with Ratatui (Rust TUI framework). NOT an inline prompt like a shell.

**Status line:** Configurable footer bar showing model, approval policy, git branch, session ID, etc. Items joined with " . " separators.

**Ready indicator:** There is NO simple character-based ready indicator like Claude's `⏵`. The TUI shows:
- Dynamic hints in the footer: "Enter submit, ? shortcuts" when idle/waiting for input
- A "working" shimmer/indicator during processing
- Mode badges: `[ Plan ]`, `[ Code ]`, `[ Agent ]`

**Recommendation:** Per CONTEXT.md decision: skip Codex-specific ready detection. Terminal is "ready" when PTY spawns and command is written. This is the correct approach -- detecting Ratatui's complex ANSI output would be extremely fragile.

**Confidence:** HIGH for TUI type and status line. HIGH for recommendation to skip ready detection.

### Q3: Codex CLI Flags for Terminal Spawning

| Flag | Syntax | Verified |
|------|--------|----------|
| Working directory | `--cd <path>` or `-C <path>` | YES -- official CLI reference |
| Initial prompt | `codex "prompt text"` (positional arg) | YES -- official CLI reference |
| Interactive mode (no flags) | Just `codex` | YES -- official docs |
| Version | `--version` | YES -- PR #492, added in 2025 |
| Full-auto mode | `--full-auto` | YES -- shortcut for `--ask-for-approval on-request --sandbox workspace-write` |
| JSON output | `--json` | YES -- for non-interactive/exec mode |

**Confidence:** HIGH -- all verified from official CLI reference page.

### Q4: Codex Binary Detection

**Binary name:** `codex`

**Install methods:**
1. `npm install -g @openai/codex` -- installs to npm global bin directory
2. `brew install --cask codex` -- installs to `/opt/homebrew/bin/codex` (macOS) or `/usr/local/bin/codex`
3. Direct binary download from GitHub releases

**Detection:** `findBinary('codex')` from existing `exec-utils.ts` will work. It searches:
- `~/.local/bin` (manual installs)
- `~/.cargo/bin` (if installed via cargo somehow)
- `~/.nvm/current/bin` (npm global via nvm)
- `/opt/homebrew/bin` (brew on Apple Silicon)
- `/usr/local/bin` (brew on Intel, or npm global)
- `/usr/bin`, `/bin` (system installs)

**Note:** The `findBinary` function does NOT search `$(npm bin -g)` directly, but the paths it does search cover the vast majority of npm global installations. If a user has a custom npm prefix (e.g., `~/.npm-global/bin`), it won't be found. This is an existing limitation for all tool detection in Bismarck, not Codex-specific.

**Confidence:** HIGH.

## Open Questions

1. **SessionMeta exact field names**
   - What we know: First line of rollout JSONL contains session metadata including UUID id and cwd
   - What's unclear: Exact field names (`cwd` vs `working_directory` vs `workdir`), whether wrapped in RolloutLine envelope
   - Recommendation: Parse first line, try both `meta.cwd` and `meta.payload?.cwd`. Log warnings if neither found. This is defensive and handles both old and new formats.

2. **Provider-specific session subdirectory**
   - What we know: Official docs say `~/.codex/sessions/YYYY/MM/DD/`, DeepWiki says `~/.codex/sessions/<provider_id>/YYYY-MM-DD/`
   - What's unclear: Whether provider_id subdirectory is always present or only in multi-provider configs
   - Recommendation: Scan recursively under `~/.codex/sessions/` to handle both cases.

3. **Session file naming: rollout-*.jsonl vs <uuid>.jsonl**
   - What we know: Official docs say `rollout-*.jsonl`, DeepWiki says `<uuid>.jsonl`
   - What's unclear: Whether naming convention changed between versions
   - Recommendation: Match any `*.jsonl` file when scanning. Don't filter by filename pattern.

## Sources

### Primary (HIGH confidence)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/) -- Complete flag reference, subcommand syntax
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/) -- TUI description, session management, resume patterns
- [Codex Slash Commands](https://developers.openai.com/codex/cli/slash-commands/) -- 21 slash commands, confirmed no /clear equivalent
- [Codex Quickstart](https://developers.openai.com/codex/quickstart/) -- Installation commands, authentication
- [Codex Changelog](https://developers.openai.com/codex/changelog/) -- Recent changes to session handling, status line
- [GitHub openai/codex](https://github.com/openai/codex) -- Installation methods, binary name
- [GitHub openai/codex releases](https://github.com/openai/codex/releases) -- Latest version 0.101.0, binary naming

### Secondary (MEDIUM confidence)
- [DeepWiki: Session Resumption](https://deepwiki.com/openai/codex/4.4-session-resumption) -- SessionMeta structure, UUID format, cwd field, directory filtering
- [DeepWiki: Status Line Rendering](https://deepwiki.com/openai/codex/4.1.4-status-line-and-footer-rendering) -- Ratatui framework, status line items, mode indicators
- [GitHub Issue #4791](https://github.com/openai/codex/issues/4791) -- CWD mismatch on resume, confirmed cwd in session_meta
- [GitHub PR #3380](https://github.com/openai/codex/pull/3380) -- RolloutLine envelope format introduction
- [GitHub PR #492](https://github.com/openai/codex/pull/492) -- --version flag addition

### Tertiary (LOW confidence)
- [GitHub Discussion #1076](https://github.com/openai/codex/discussions/1076) -- Early session resume discussion (may be outdated)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies needed, existing infrastructure sufficient
- Architecture: HIGH -- clear provider-branching pattern, minimal touching of universal code
- Codex CLI flags: HIGH -- verified from official reference documentation
- Session management: MEDIUM -- SessionMeta exact schema not in official docs, reconstructed from multiple sources
- TUI ready detection: HIGH -- confirmed no simple signal exists, skip decision is correct

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (Codex CLI is actively developed; session format may evolve)
