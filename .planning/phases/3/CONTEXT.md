# Phase 3 Context: Attention Hooks for Codex

## Session-to-Socket Mapping

### Decisions
- **Mapping approach:** CWD-based mapping. When a Codex terminal is spawned, write a mapping file keyed by a hash of the agent's directory path.
- **Mapping location:** Use the same `~/.bismarck/sessions/` directory as Claude. Different key format: Claude uses sessionId (from SessionStart hook), Codex uses a hash of the directory path.
- **Mapping file format:** `~/.bismarck/sessions/codex-<hash-of-dir>.json` containing `{"workspaceId": "...", "instanceId": "..."}`.
- **Mapping creation timing:** At terminal spawn time in `createTerminal()`, when provider is `codex`. We know workspaceId, instanceId, and directory at that point.
- **Mapping content:** Same as Claude mapping: `{workspaceId, instanceId}`. The hook script uses both to construct the socket path.
- **Notify payload cwd:** Research needed — verify that Codex's notify callback JSON contains the working directory (cwd) so the hook can look up the mapping.

### Rationale
CWD-based mapping is the natural approach for Codex since there's no SessionStart hook to create a session-based mapping. The directory path uniquely identifies a Codex agent in Bismarck. Using the same sessions directory keeps all mappings in one place.

---

## Hook Lifecycle

### Decisions
- **Install timing:** At app startup, alongside `configureClaudeHook()`. Add a `configureCodexHook()` that runs at the same time.
- **Install conditions:** Only install if BOTH conditions are met: (1) codex binary is installed (detected via `findBinary('codex')` or `hasBinary('codex')`), AND (2) at least one agent has `provider === 'codex'`. Don't touch `~/.codex/config.toml` for Claude-only users.
- **Idempotency:** Check if our notify entry already exists before adding. Match the Claude pattern in `configureClaudeHook()`. Prevents duplicate entries.
- **Cleanup:** Leave hooks in place when Bismarck is uninstalled or Codex agents are removed. The hook script silently fails (socket not found) if Bismarck isn't running. No harm, no cleanup complexity.
- **Config format:** `~/.codex/config.toml` is TOML. Research needed on how to safely read/write TOML without clobbering user settings.

### Rationale
Matching the Claude hook lifecycle pattern keeps the codebase consistent. The two-condition gate (binary + agents exist) prevents touching Codex config files unnecessarily. Leaving hooks on uninstall is the simplest approach — a silently failing hook is harmless.

---

## Event Format Translation

### Decisions
- **Hook script:** Separate script — `codex-notify-hook.sh`. Different input format (argv[1] vs stdin) means a different script. Not shared with Claude hooks.
- **Socket event format:** Identical to Claude. Send `{"event":"stop","reason":"input_required","workspaceId":"..."}` to the Unix socket. The socket server needs zero changes.
- **Event mapping:** One hook for Codex's `agent-turn-complete` event, mapped to Bismarck's `stop/input_required`. Codex handles approval internally — no separate permission prompt hook needed.
- **Instance ID discovery:** Stored in the CWD-based mapping file (created at terminal spawn). The hook reads both workspaceId and instanceId from one file.

### Hook script flow
1. Receive JSON as argv[1] from Codex's notify callback
2. Extract cwd from the JSON payload (research needed for exact field name)
3. Hash the cwd to find the mapping file: `~/.bismarck/sessions/codex-<hash>.json`
4. Read workspaceId and instanceId from the mapping file
5. Construct socket path: `/tmp/bm/<instanceId:0:8>/<workspaceId:0:8>.sock`
6. Send stop event JSON to the socket via `nc -U`
7. Exit 0

### Rationale
Identical socket event format means the socket server and renderer don't need any changes — the attention system is already agent-agnostic. A separate script is cleaner than shared logic with mode detection.

---

## Research Needed
*(To be answered by the research phase)*

1. **Codex notify payload format:** What fields does the JSON in argv[1] contain? Specifically: does it include `cwd` or working directory?
2. **TOML read/write:** How to safely read/modify `~/.codex/config.toml` without clobbering user settings. Is there a Node.js TOML library in the existing deps? Should we use string manipulation instead?
3. **Codex config.toml notify structure:** What does the `notify` section look like in config.toml? How is the callback command specified?
4. **Codex notify event types:** What events can trigger notify? Is `agent-turn-complete` the only one, or are there others we should handle?

---

## Deferred Ideas
*(Captured for future phases, not acted on in Phase 3)*

- Per-provider attention modes (different behavior for Claude vs Codex attention)
- Codex permission-prompt-specific hooks (if Codex adds a separate permission event)
- Automatic cleanup of ~/.codex/config.toml on Bismarck uninstall
- Mapping file cleanup on agent deletion
