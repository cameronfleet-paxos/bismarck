# Requirements: Codex Interactive Agent Support

## Milestone 1 Scope

Add OpenAI Codex as a second interactive agent provider, selectable per-agent.

## Functional Requirements

### R1: Agent Provider Type
- Each agent stores a `provider` field: `'claude' | 'codex'`
- Existing agents default to `'claude'` (backward compatible)
- Provider is set at agent creation time and can be changed later

### R2: Add Agent Screen
- The "Add Agent" / workspace modal includes a provider selector (Claude or Codex)
- Provider choice is visually clear (icon + label)
- Default provider comes from settings

### R3: Settings — Default Provider
- General Settings section includes a "Default Agent Provider" dropdown
- Options: Claude Code, OpenAI Codex
- Persisted in `settings.json`

### R4: Terminal Spawning
- When provider is `codex`, spawn `codex` binary (not `claude`) in the PTY
- Codex uses `--cd <path>` for working directory (not cwd-based like Claude)
- No session resume for Codex in v1 (Codex uses `codex resume <ID>` subcommand which differs from Claude's `--resume` flag)
- Codex flags: support `--model`, `--full-auto`, `--sandbox` configurable per-agent or from settings

### R5: Agent Card Provider Badge
- Agent cards in the workspace grid show a small provider badge/indicator
- Visually distinguish Claude vs Codex agents at a glance

### R6: Attention/Hooks for Codex Agents
- Register Codex `notify` callback in `~/.codex/config.toml` pointing to a Bismarck hook script
- Hook script receives JSON as argv[1] (NOT stdin like Claude hooks)
- Map `agent-turn-complete` events to the existing Unix socket attention system
- Accept limitation: no approval-waiting detection for Codex in v1
- Fallback: PTY output idle timeout (30s no output → consider idle) as supplementary signal

### R7: Hook Manager Abstraction
- Extend hook-manager to support per-provider hook registration
- Claude: writes to `~/.claude/settings.json` (existing behavior)
- Codex: writes to `~/.codex/config.toml` (new)
- Each provider has its own hook script template

## Non-Functional Requirements

### NR1: Backward Compatibility
- All existing agents continue to work as Claude agents
- No migration required — missing `provider` field defaults to `'claude'`
- Existing settings and config files are not broken

### NR2: No Codex Auth Management
- Bismarck does not manage Codex authentication
- Assume user has run `codex login` externally
- If `codex` binary not found, show helpful error message

### NR3: Scope Boundaries (Deferred)
- No headless/Docker Codex support
- No Codex event stream parsing
- No Codex app-server integration
- No per-plan provider selection
- No Codex model management in settings (use Codex's own config)
