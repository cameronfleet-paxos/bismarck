# Roadmap: Codex Interactive Agent Support

## Milestone 1: Interactive Codex Agents

### Phase 1: Type System & Data Model
**Goal:** Add `provider` field to Agent type and settings, with backward-compatible defaults.
**Plans:** 1 plan

Plans:
- [ ] 01-01-PLAN.md -- Add AgentProvider type, provider field on Agent, display name mapping, defaultProvider setting

**Changes:**
- `src/shared/types.ts` — Add `AgentProvider` type (`'claude' | 'codex'`), add `provider` field to `Agent` interface
- `src/shared/types.ts` — Add `defaultProvider` to `AppSettings` or relevant settings type
- `src/main/settings-manager.ts` — Add `defaultProvider` setting with default `'claude'`
- `src/main/config.ts` — Ensure existing agents without `provider` default to `'claude'` on load

**Requires:** Nothing
**Validates:** TypeScript compiles, existing agents load correctly

---

### Phase 2: Terminal Spawning for Codex
**Goal:** Spawn `codex` binary in PTY when agent provider is `codex`.

**Changes:**
- `src/main/terminal.ts` — Branch on `workspace.provider` to build either `claude` or `codex` command
- Codex command: `codex --cd <directory>` (no session resume in v1)
- Handle `codex` binary not found gracefully (error message to renderer)
- Skip Claude-specific session management (sessionId, `claudeSessionExists`) for Codex agents

**Requires:** Phase 1
**Validates:** Codex terminal launches and renders in xterm.js, Claude terminals unchanged

---

### Phase 3: Attention Hooks for Codex
**Goal:** Codex agents trigger Bismarck's attention system when they finish a turn.

**Changes:**
- `src/main/hook-manager.ts` — Abstract hook registration per provider
  - Claude: existing `~/.claude/settings.json` hook writing
  - Codex: write `notify` callback to `~/.codex/config.toml`
- Create Codex-specific hook script that reads JSON from argv[1] and writes to Unix socket
- Handle TOML config format (read/write `~/.codex/config.toml`)

**Requires:** Phase 1
**Validates:** Codex agent turn-complete triggers notification badge in Bismarck

---

### Phase 4: UI — Add Agent & Settings
**Goal:** Users can select Claude or Codex when creating agents, and set a default provider in settings.

**Changes:**
- `src/renderer/components/WorkspaceModal.tsx` — Add provider selector (Claude / Codex toggle or dropdown)
- `src/renderer/components/settings/sections/GeneralSettings.tsx` — Add "Default Agent Provider" setting
- `src/main/preload.ts` — Expose any new IPC methods needed
- `src/renderer/electron.d.ts` — Update type declarations

**Requires:** Phase 1
**Validates:** Can create a Codex agent from UI, default provider persists across restart

---

### Phase 5: Agent Card Provider Badge
**Goal:** Visually distinguish Claude vs Codex agents in the workspace grid.

**Changes:**
- `src/renderer/components/WorkspaceCard.tsx` — Add small provider badge/icon
- Provider-specific styling (e.g., Anthropic orange for Claude, OpenAI green for Codex)
- Badge visible but not obtrusive

**Requires:** Phase 1, Phase 4
**Validates:** Agent cards show correct provider badge, both providers visually distinct

---

### Phase 6: Integration Testing & Polish
**Goal:** End-to-end validation, edge cases, and polish.

**Changes:**
- Test: Create Claude agent → verify terminal spawns `claude`
- Test: Create Codex agent → verify terminal spawns `codex`
- Test: Codex attention hook fires on turn complete
- Test: Settings default provider applies to new agents
- Test: Existing agents without `provider` field work as Claude
- Handle edge cases: `codex` not installed, bad config, etc.
- CDP test scripts for automated verification

**Requires:** All previous phases
**Validates:** Full flow works end-to-end
