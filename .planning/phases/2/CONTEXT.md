# Phase 2 Context: Terminal Spawning for Codex

## Binary Detection & Error Handling

### Decisions
- **Check timing:** Validate at spawn time (Phase 2). Also validate at agent creation time (Phase 4, later). Phase 2 implements the spawn-time safety net.
- **Detection method:** Use `command -v codex` (or equivalent `which`) before spawning. Same pattern as tool detection in settings-manager.
- **Error display:** If `codex` binary not found, write a styled error message directly into the terminal output (e.g., "codex not found. Install with: npm install -g @openai/codex"). Terminal stays open showing the error. Do NOT send IPC error or fall back to shell.
- **Startup check:** No app-wide startup scan for codex availability. Check per-agent at spawn time only.

### Rationale
Spawn-time check is simple and handles the case where codex is installed between sessions. Styled terminal error keeps the user in context without modal interruptions.

---

## Session Management

### Decisions
- **Session tracking:** Full session support for Codex agents in Phase 2. Codex agents track sessionId and support resume.
- **Session capture timing:** On terminal exit, scan `~/.codex/sessions/` for the most recent session file matching the agent's directory. Store the rollout ID as the agent's `sessionId`.
- **Session ID format:** Store rollout ID only (e.g., `rollout-abc123`), not the full path. The resume command uses this format: `codex resume <rollout-id> --cd <dir>`.
- **Resume behavior:** On terminal open, if agent has a sessionId, check if the session file exists. If yes, use `codex resume <id> --cd <dir>`. If no, start fresh with `codex --cd <dir>`.
- **Reopen without session:** Fresh start every time when no valid session exists. No attempt to show previous session output.
- **Agent.sessionId:** Populated for Codex agents after first session. Stores the rollout ID.

### Research needed
- Exact format of `codex resume` command (verify it takes rollout ID, not full path)
- How to find the correct session file from `~/.codex/sessions/YYYY/MM/DD/` — need to match by working directory or most-recent
- Whether `codex resume` accepts `--cd` flag or if directory is implicit from session

### Rationale
Full session support from day one avoids a disruptive UX change later. Filesystem lookup on exit is reliable and doesn't depend on parsing Codex's terminal output.

---

## Claude-Specific Behavior Cleanup

### Decisions
- **Trust prompt auto-accept (lines 184-210):** REMOVE entirely. Never worked reliably. Delete for all providers, not just Codex.
- **Accept-mode cycling (lines 214-250):** REMOVE entirely. Never worked reliably. Users can set accept-edits as their default in Claude settings. Delete for all providers.
- **`autoAcceptMode` parameter:** REMOVE from `createTerminal()` signature and all call sites. Full cleanup.
- **`/clear` detection (lines 170-178):** Make provider-aware. Only attach for Claude agents. Codex doesn't have an equivalent `/clear` command that outputs `(no content)`.
- **Ready detection (`⏵` character, lines 284-295):** Research needed for Codex. Claude uses `⏵` in its status line. Need to find Codex's equivalent ready signal, if any. For now, skip Codex-specific ready detection — terminal is "ready" when PTY spawns.
- **Initial prompt:** Codex agents support initial prompts. Pass as quoted argument: `codex --cd <dir> "<prompt>"`. Same pattern as Claude.

### What stays for both providers
- Shell prompt detection and command injection (lines 252-281) — universal, works for both
- PTY spawn with xterm-256color — universal
- Terminal data forwarding to renderer — universal
- Process exit handling — universal

### What becomes provider-specific
- Command construction (claude vs codex, different flags/syntax)
- Session management (--session-id/--resume vs resume subcommand)
- `/clear` detection (Claude only)
- Ready detection (provider-specific signals — research Codex's)

### Research needed
- What does Codex's TUI show when it's ready to accept input? Is there a status line character or pattern we can detect?

---

## Deferred Ideas
*(Captured for future phases, not acted on in Phase 2)*

- Codex approval policy flags (--full-auto, --suggest, --auto-edit) — could be Phase 4 UI setting
- Codex sandbox mode configuration — future per-provider settings
- Codex model selection (different from Claude's model names) — future
- App-startup codex availability scan with warning badge — future polish
