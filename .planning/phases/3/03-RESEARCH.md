# Phase 3: Attention Hooks for Codex - Research

**Researched:** 2026-02-15
**Domain:** Codex CLI notification hooks, TOML config management, shell scripting
**Confidence:** HIGH

## Summary

Codex CLI provides a `notify` callback mechanism via `~/.codex/config.toml` that fires an external command when the agent completes a turn. The notify command receives a JSON payload as `argv[1]` containing event metadata including the working directory (`cwd`). This `cwd` field was added in PR #5415 (merged October 2025) and is now documented in official Codex docs. The CWD-based mapping strategy decided in CONTEXT.md is fully viable.

For TOML read/write, `smol-toml` is the recommended library -- it supports both `parse()` and `stringify()`, is the most popular TOML package on npm, is actively maintained, and handles TOML 1.1.0 spec compliance. The project currently has no TOML dependency.

The implementation pattern closely mirrors the existing `configureClaudeHook()` in `hook-manager.ts`, but targets `~/.codex/config.toml` (TOML format) instead of `~/.claude/settings.json` (JSON format), and uses a separate shell script that reads JSON from `argv[1]` instead of `stdin`.

**Primary recommendation:** Use `smol-toml` for TOML parsing/stringifying. Create `codex-notify-hook.sh` that extracts `cwd` from the argv[1] JSON, hashes it to find the CWD-based mapping file, and sends a stop event to the Bismarck socket.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Mapping approach:** CWD-based mapping. When a Codex terminal is spawned, write a mapping file keyed by a hash of the agent's directory path.
- **Mapping location:** Use the same `~/.bismarck/sessions/` directory as Claude. Different key format: Claude uses sessionId (from SessionStart hook), Codex uses a hash of the directory path.
- **Mapping file format:** `~/.bismarck/sessions/codex-<hash-of-dir>.json` containing `{"workspaceId": "...", "instanceId": "..."}`.
- **Mapping creation timing:** At terminal spawn time in `createTerminal()`, when provider is `codex`. We know workspaceId, instanceId, and directory at that point.
- **Mapping content:** Same as Claude mapping: `{workspaceId, instanceId}`. The hook script uses both to construct the socket path.
- **Install timing:** At app startup, alongside `configureClaudeHook()`. Add a `configureCodexHook()` that runs at the same time.
- **Install conditions:** Only install if BOTH conditions are met: (1) codex binary is installed (detected via `findBinary('codex')` or `hasBinary('codex')`), AND (2) at least one agent has `provider === 'codex'`. Don't touch `~/.codex/config.toml` for Claude-only users.
- **Idempotency:** Check if our notify entry already exists before adding. Match the Claude pattern in `configureClaudeHook()`. Prevents duplicate entries.
- **Cleanup:** Leave hooks in place when Bismarck is uninstalled or Codex agents are removed.
- **Hook script:** Separate script -- `codex-notify-hook.sh`. Different input format (argv[1] vs stdin) means a different script. Not shared with Claude hooks.
- **Socket event format:** Identical to Claude. Send `{"event":"stop","reason":"input_required","workspaceId":"..."}` to the Unix socket. The socket server needs zero changes.
- **Event mapping:** One hook for Codex's `agent-turn-complete` event, mapped to Bismarck's `stop/input_required`. Codex handles approval internally.

### Claude's Discretion
- TOML library choice (research needed, recommendation provided below)
- Hashing algorithm for directory-to-filename mapping
- Error handling strategy in the shell hook script

### Deferred Ideas (OUT OF SCOPE)
- Per-provider attention modes (different behavior for Claude vs Codex attention)
- Codex permission-prompt-specific hooks (if Codex adds a separate permission event)
- Automatic cleanup of ~/.codex/config.toml on Bismarck uninstall
- Mapping file cleanup on agent deletion
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| smol-toml | ^1.6.0 | Parse and stringify TOML config files | Most popular TOML package on npm, actively maintained, supports parse+stringify, TOML 1.1.0 compliant, ~71k ops/sec parsing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (built-in) | Node.js built-in | Hash directory paths for mapping filenames | Already used in `terminal.ts` for `crypto.randomUUID()` |
| fs (built-in) | Node.js built-in | Read/write config.toml and mapping files | Already used throughout codebase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| smol-toml | @iarna/toml | @iarna/toml has more weekly downloads but is unmaintained (no releases in 12+ months), slower (1.86x slower parse, 4x slower stringify), only supports TOML 1.0.0-rc.1 |
| smol-toml | String manipulation (regex) | Simpler for trivial cases but fragile -- TOML has complex syntax (multi-line strings, inline tables, etc.) that regex can't safely handle. Real parser needed for reliable round-trip. |

**Installation:**
```bash
npm install smol-toml
```

## Architecture Patterns

### Recommended Project Structure
Changes stay within the existing `src/main/` structure:
```
src/main/
  hook-manager.ts          # Add configureCodexHook(), createCodexNotifyHookScript()
  terminal.ts              # Add CWD-based mapping file creation in createTerminal()
  main.ts                  # Add configureCodexHook() call at startup
~/.bismarck/hooks/
  codex-notify-hook.sh     # New script (created by hook-manager.ts)
~/.bismarck/sessions/
  codex-<hash>.json        # New mapping files (created by terminal.ts)
```

### Pattern 1: Codex Notify Hook Script
**What:** A bash script that receives Codex's JSON payload as argv[1], extracts the `cwd` field, hashes it to find the mapping file, and sends a stop event to the Bismarck socket.
**When to use:** Every time Codex's `agent-turn-complete` event fires.
**Example:**
```bash
#!/bin/bash
# Bismarck Codex notify hook - signals when Codex agent needs input
# Receives JSON as argv[1] from Codex's notify callback

JSON="$1"
[ -z "$JSON" ] && exit 0

# Extract cwd from JSON payload
CWD=$(printf '%s' "$JSON" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$CWD" ] && exit 0

# Hash the cwd to find the mapping file
HASH=$(printf '%s' "$CWD" | shasum -a 256 | cut -c1-16)
MAPPING="$HOME/.bismarck/sessions/codex-${HASH}.json"
[ ! -f "$MAPPING" ] && exit 0

# Read workspaceId and instanceId from mapping
WORKSPACE_ID=$(grep -o '"workspaceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
INSTANCE_ID=$(grep -o '"instanceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
[ -z "$WORKSPACE_ID" ] || [ -z "$INSTANCE_ID" ] && exit 0

# Shortened IDs for macOS socket path limit
SOCKET_PATH="/tmp/bm/${INSTANCE_ID:0:8}/${WORKSPACE_ID:0:8}.sock"

[ -S "$SOCKET_PATH" ] && printf '{"event":"stop","reason":"input_required","workspaceId":"%s"}\n' "$WORKSPACE_ID" | nc -U "$SOCKET_PATH" 2>/dev/null
exit 0
```
**Source:** Derived from existing stop-hook.sh pattern in hook-manager.ts

### Pattern 2: TOML Config Modification (configureCodexHook)
**What:** Read `~/.codex/config.toml`, check if notify is already configured with our script, add it if not, write back.
**When to use:** At app startup, when both conditions are met (codex binary exists + codex agents exist).
**Example:**
```typescript
import { parse, stringify } from 'smol-toml'

function configureCodexHook(): void {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml')
  const hookScriptPath = getCodexNotifyHookScriptPath()

  // Read existing config or start with empty
  let config: Record<string, unknown> = {}
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8')
      config = parse(content)
    } catch (e) {
      console.error('Failed to read Codex config:', e)
      return // Don't clobber a config we can't parse
    }
  }

  // Check if notify is already set to our hook
  const currentNotify = config.notify as string[] | undefined
  if (currentNotify && Array.isArray(currentNotify) && currentNotify[0] === hookScriptPath) {
    return // Already configured
  }

  // Set notify to our hook script
  // NOTE: Codex only supports ONE notify command (not an array of commands)
  config.notify = [hookScriptPath]

  // Write back
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, stringify(config))
}
```
**Source:** Modeled on existing configureClaudeHook() pattern in hook-manager.ts

### Pattern 3: CWD-Based Mapping File Creation
**What:** At terminal spawn time, write a mapping file keyed by directory hash.
**When to use:** In `createTerminal()` when `provider === 'codex'`.
**Example:**
```typescript
// In createTerminal(), after building the codex command:
if (provider === 'codex') {
  const hash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16)
  const mappingDir = path.join(getConfigDir(), 'sessions')
  fs.mkdirSync(mappingDir, { recursive: true })
  const mappingPath = path.join(mappingDir, `codex-${hash}.json`)
  fs.writeFileSync(mappingPath, JSON.stringify({
    workspaceId,
    instanceId: getInstanceId()
  }))
}
```
**Source:** Modeled on existing Claude session mapping in session-start-hook.sh

### Anti-Patterns to Avoid
- **Sharing a single hook script between Claude and Codex:** Different input formats (stdin vs argv[1]) make shared logic fragile. Keep them separate.
- **Using regex to modify TOML:** TOML has complex syntax. Use a proper parser (smol-toml) for reliable round-trip.
- **Overwriting existing notify config without checking:** User may have their own notify command. The implementation must handle this gracefully (see Pitfalls section).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TOML parsing | Regex-based parser | smol-toml | TOML has multi-line strings, inline tables, dotted keys, date/time types -- regex will break |
| Directory hashing | Custom hash function | Node.js crypto.createHash('sha256') | Battle-tested, already used in the project |
| JSON extraction in bash | Complex jq pipelines | grep + cut pattern | Matches existing hook scripts, avoids jq dependency requirement |

**Key insight:** The existing Claude hook scripts already avoid jq dependency by using grep/cut for JSON extraction. The Codex hook should follow this same pattern for consistency and to avoid adding a runtime dependency.

## Common Pitfalls

### Pitfall 1: Codex notify Supports Only ONE Command
**What goes wrong:** Unlike Claude's hooks (which support arrays of hook configs), Codex's `notify` is a single command array. Setting it overwrites any existing user notification setup.
**Why it happens:** Codex config.toml has `notify = ["command", "args"]` -- one command, not a list of commands.
**How to avoid:** If the user already has a `notify` configured and it's NOT our script, we have two options: (a) wrap both in a dispatcher script, or (b) warn and skip. Recommendation: create a wrapper script that calls both the user's original command and our hook.
**Warning signs:** User reports their desktop notifications stopped working after installing Bismarck.

### Pitfall 2: smol-toml Stringify Doesn't Preserve Comments
**What goes wrong:** Parsing and re-stringifying a config.toml strips all user comments.
**Why it happens:** smol-toml (like all TOML parsers) discards comments during parsing.
**How to avoid:** Only write the config if we actually need to change it (idempotency check first). When we must write, the comment loss is an acceptable tradeoff. Alternatively, use string manipulation for the specific notify line only, but this is more fragile.
**Warning signs:** User complains their config.toml lost its comments.

### Pitfall 3: Hash Collision Between Dev and Prod Bismarck
**What goes wrong:** `~/.bismarck/sessions/` vs `~/.bismarck-dev/sessions/` -- the configDirName changes between dev and prod, but the hook script is a static file that needs to know which directory to look in.
**Why it happens:** The existing Claude hooks use `getConfigDirName()` which returns `.bismarck` or `.bismarck-dev` based on `NODE_ENV`. The hook script embeds this at creation time.
**How to avoid:** Follow the exact same pattern as existing hooks -- embed the config dir name in the script at creation time via template literal.
**Warning signs:** Attention hooks work in dev but not in prod, or vice versa.

### Pitfall 4: cwd Field May Contain Spaces or Special Characters
**What goes wrong:** The grep/cut JSON extraction in the hook script breaks on directory paths with spaces or quotes.
**Why it happens:** grep pattern `'"cwd":"[^"]*"'` will work for most paths but the cwd could contain escaped characters in JSON.
**How to avoid:** The grep pattern `[^"]*` handles most cases since JSON escapes special chars. For paths with actual double quotes (very rare in directory names), this is an acceptable limitation. Test with paths containing spaces.
**Warning signs:** Codex agents in directories with unusual characters don't trigger attention.

### Pitfall 5: Codex Config Directory May Not Exist
**What goes wrong:** `~/.codex/` doesn't exist if Codex has never been configured beyond defaults.
**Why it happens:** Codex may use defaults without creating config.toml until the user explicitly configures something.
**How to avoid:** Create `~/.codex/` directory with `fs.mkdirSync(recursive: true)` before writing config.toml.
**Warning signs:** ENOENT error when trying to write config.toml.

## Code Examples

Verified patterns from official sources:

### Codex Notify Payload (agent-turn-complete)
```json
// Source: https://developers.openai.com/codex/config-advanced/
// Fields confirmed via official docs and PR #5415
{
  "type": "agent-turn-complete",
  "thread-id": "thread_abc123",
  "turn-id": "turn_456",
  "cwd": "/Users/user/projects/my-app",
  "input-messages": ["Fix the login bug"],
  "last-assistant-message": "I've fixed the login validation..."
}
```

### Codex config.toml Notify Syntax
```toml
# Source: https://developers.openai.com/codex/config-sample/
# notify is a TOP-LEVEL key (not nested under any section)
# Value is an argv array; Codex appends JSON as one extra argument
notify = ["/path/to/script.sh"]
```

### smol-toml Parse and Stringify
```typescript
// Source: https://github.com/squirrelchat/smol-toml
import { parse, stringify } from 'smol-toml'

// Parse
const config = parse(fs.readFileSync('config.toml', 'utf-8'))
// config.notify => ["notify-send", "Codex"]

// Modify
config.notify = ["/path/to/our/hook.sh"]

// Stringify back
fs.writeFileSync('config.toml', stringify(config))
```

### Directory Hash (Matching Pattern for Hook Script)
```typescript
// Node.js side (creating the mapping file)
import crypto from 'crypto'
const hash = crypto.createHash('sha256').update(directory).digest('hex').slice(0, 16)
const mappingFile = `codex-${hash}.json`
```

```bash
# Bash side (in the hook script, finding the mapping file)
# shasum -a 256 is available on macOS and Linux
HASH=$(printf '%s' "$CWD" | shasum -a 256 | cut -c1-16)
MAPPING="$HOME/.bismarck/sessions/codex-${HASH}.json"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No cwd in notify payload | cwd included in payload | PR #5415, Oct 2025 | Enables CWD-based mapping strategy |
| notify not documented | notify fully documented with examples | Codex advanced config docs, 2025 | Reduces implementation risk |

**Important version note:** The `cwd` field in the notify payload requires a Codex version from after October 2025 (PR #5415). Users with very old Codex versions may not have this field. The hook script handles this gracefully by checking `[ -z "$CWD" ] && exit 0`.

## Open Questions

1. **Existing notify command conflict**
   - What we know: Codex supports only ONE notify command. If the user already has one configured, we'd overwrite it.
   - What's unclear: How common is it for users to have a custom notify command already?
   - Recommendation: Check if notify is already set. If it is and it's not our script, create a wrapper script that calls both. If this is deemed too complex for Phase 3, simply skip configuration and log a warning. The wrapper approach is more robust.

2. **Hash consistency between Node.js crypto and shasum**
   - What we know: Node.js `crypto.createHash('sha256')` and bash `shasum -a 256` both implement SHA-256.
   - What's unclear: Edge cases with Unicode directory paths and encoding differences.
   - Recommendation: Use UTF-8 encoding explicitly on both sides. Test with ASCII and Unicode paths. The first 16 hex chars of SHA-256 provide enough uniqueness for practical purposes (64-bit collision space).

3. **smol-toml round-trip fidelity**
   - What we know: smol-toml can parse and stringify, but `stringify(parse('a = 1.0'))` may produce `'a = 1'` (float/int coercion). Comments are lost.
   - What's unclear: Whether any Codex config.toml values are affected by this coercion.
   - Recommendation: Acceptable tradeoff. The notify key is a string array, so no numeric coercion applies. Comment loss is the main concern, but idempotency checks minimize how often we rewrite.

## Sources

### Primary (HIGH confidence)
- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced/) - Notify payload fields documented: type, thread-id, turn-id, cwd, input-messages, last-assistant-message
- [Codex Sample Configuration](https://developers.openai.com/codex/config-sample/) - TOML syntax: `notify = ["command", "args"]` (top-level key, argv array)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/) - notify is top-level, type `array<string>`, optional
- [PR #5415: Include cwd in notify payload](https://github.com/openai/codex/pull/5415) - Merged Oct 20, 2025. Confirms cwd field exists in payload.
- [Issue #4005: cwd in notify payload](https://github.com/openai/codex/issues/4005) - OpenAI collaborator confirmed cwd was added (Nov 3, 2025 comment)

### Secondary (MEDIUM confidence)
- [smol-toml GitHub](https://github.com/squirrelchat/smol-toml) - Parse + stringify support, TOML 1.1.0 compliant, actively maintained
- [smol-toml npm](https://www.npmjs.com/package/smol-toml) - Most downloaded TOML parser on npm, ~71k ops/sec parsing
- [codex-notify-chime](https://github.com/Stovoy/codex-notify-chime) - Third-party notify script confirming payload structure: `json.loads(sys.argv[1])`, `type` field check

### Tertiary (LOW confidence)
- [Issue #4005 full payload suggestion](https://github.com/openai/codex/issues/4005) - Suggested additional fields (approval_policy, sandbox_mode, network_access, shell) -- NOT confirmed as implemented. Only cwd was confirmed added.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - smol-toml is well-established, actively maintained, and the clear leader
- Architecture: HIGH - Closely mirrors proven Claude hook pattern already in codebase
- Codex notify payload: HIGH - Confirmed by official docs, PR, and OpenAI collaborator
- Codex config.toml format: HIGH - Confirmed by official sample config and config reference
- Pitfalls: MEDIUM - Based on analysis of code patterns and TOML library behavior, not battle-tested

**Research date:** 2026-02-15
**Valid until:** 2026-03-15 (Codex CLI is actively developed; check for notify changes)
