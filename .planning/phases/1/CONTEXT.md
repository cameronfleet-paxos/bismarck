# Phase 1 Context: Type System & Data Model

## Provider Type Extensibility

### Decisions
- **Type shape:** Strict union — `type AgentProvider = 'claude' | 'codex'`
- **Unknown providers:** Fall back to `'claude'` silently (e.g., if someone edits config.json with `'gemini'`)
- **Runtime discovery:** Compile-time only — no runtime registry or provider discovery mechanism
- **Display names:** Mapping object in shared constants — `{ claude: 'Claude Code', codex: 'OpenAI Codex' }`

### Rationale
Strict union catches typos at compile time. Adding a new provider requires a code change, which is appropriate since terminal spawning, hooks, etc. all need code changes anyway.

---

## Default Provider Behavior

### Decisions
- **Manual agent creation (Add Agent):** Default from `settings.defaultProvider`
- **Programmatic agents (plans, ralph loops, headless):** Always `'claude'` — Codex headless is out of scope
- **Missing provider field on existing agents:** Treat as `'claude'` at read time — do NOT modify config.json
- **Setup Wizard:** Always creates Claude agents regardless of settings

### Rationale
Settings-driven default gives users control. Programmatic agents stay Claude-only since Codex headless isn't supported yet. Read-time defaults avoid unnecessary file writes and migration complexity.

---

## Provider-Specific Agent Fields

### Decisions
- **Field structure:** Flat optional fields on Agent (e.g., `codexSandboxMode?`, `codexApprovalPolicy?`) — matches existing pattern
- **AgentModel type:** Keep as-is (`'opus' | 'sonnet' | 'haiku'`) — only used for headless agents, not interactive terminals
- **Flags field:** Add generic `agentFlags` field — but defer to Phase 2 (don't rename existing `claudeFlags` in Phase 1)
- **sessionId field:** Make generic — works for both Claude and Codex. Phase 2 handles the different resume mechanisms (`claude --resume <id>` vs `codex resume <id>`)

### What Phase 1 Actually Adds to Agent
- `provider?: AgentProvider` — optional, defaults to `'claude'` at read time
- No other new fields in Phase 1 — provider-specific fields (sandbox, approval, agentFlags) come in Phase 2

### What Phase 1 Does NOT Change
- `AgentModel` type stays as-is
- `claudeFlags` stays as-is (renamed in Phase 2)
- `sessionId` stays as-is (comment updated to note it works for both providers)

---

## Settings Migration Strategy

### Decisions
- **Setting location:** Top-level — `settings.defaultProvider: AgentProvider`
- **Migration:** Runtime default only — if `defaultProvider` is undefined, treat as `'claude'` in code. No migration #8 needed.
- **Per-provider settings section:** Deferred entirely — no `settings.providers` structure in Phase 1
- **Existing field renames:** Deferred to Phase 2 — Phase 1 only adds new fields, doesn't rename existing ones

### Rationale
Minimal changes = minimal blast radius. The settings type gets one new optional field. No migration, no restructuring, no renames.

---

## Deferred Ideas
*(Captured for future phases, not acted on in Phase 1)*

- Per-provider settings sections (`settings.providers.codex.sandbox`)
- Renaming `claudeFlags` → `agentFlags` across all types
- Widening `AgentModel` to `string` for Codex model names
- Runtime provider registry/discovery
- Codex session resume mechanism
