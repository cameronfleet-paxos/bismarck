---
phase: 01-type-system
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/shared/types.ts
  - src/shared/constants.ts
  - src/main/settings-manager.ts
autonomous: true
must_haves:
  truths:
    - "AgentProvider type exists as strict union 'claude' | 'codex'"
    - "Agent interface has optional provider field typed as AgentProvider"
    - "AppSettings has defaultProvider field that defaults to 'claude'"
    - "Provider display name mapping exists in shared constants"
    - "A helper function resolves agent provider with 'claude' fallback"
    - "TypeScript compiles with zero new errors"
  artifacts:
    - path: "src/shared/types.ts"
      provides: "AgentProvider type and provider field on Agent"
      contains: "type AgentProvider"
    - path: "src/shared/constants.ts"
      provides: "agentProviderNames mapping"
      contains: "agentProviderNames"
    - path: "src/main/settings-manager.ts"
      provides: "defaultProvider on AppSettings interface and defaults"
      contains: "defaultProvider"
  key_links:
    - from: "src/shared/constants.ts"
      to: "src/shared/types.ts"
      via: "import AgentProvider"
      pattern: "import.*AgentProvider.*from.*types"
    - from: "src/main/settings-manager.ts"
      to: "src/shared/types.ts"
      via: "import AgentProvider"
      pattern: "import.*AgentProvider.*from.*types"
---

<objective>
Add the AgentProvider type system and defaultProvider setting to Bismarck, enabling the codebase to distinguish between Claude and Codex agents.

Purpose: This is the foundational data model change that all subsequent Codex support phases (terminal spawning, attention hooks, UI) depend on.
Output: Updated types.ts, constants.ts, and settings-manager.ts with backward-compatible provider support.
</objective>

<context>
@.planning/phases/1/CONTEXT.md
@src/shared/types.ts
@src/shared/constants.ts
@src/main/settings-manager.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add AgentProvider type and provider field to types.ts</name>
  <files>src/shared/types.ts</files>
  <action>
Make three changes to src/shared/types.ts:

1. After the `PersonaMode` type definition (line 10), add the AgentProvider type:

```typescript
// Agent provider (which coding agent CLI to use)
export type AgentProvider = 'claude' | 'codex'
```

2. On the Agent interface (line 68-90), add `provider` as an optional field. Insert it after the `directory` field (line 71), before `purpose`:

```typescript
provider?: AgentProvider  // Which CLI provider this agent uses (default: 'claude')
```

3. Update the `sessionId` comment (line 75) to note it works for both providers:

```typescript
sessionId?: string // Session ID for resuming sessions across app restarts (Claude: --resume, Codex: resume subcommand)
```

4. Add a helper function at the end of the file (after the last interface, before EOF) that resolves an agent's provider with the 'claude' fallback. This is the single canonical place for the fallback logic:

```typescript
/**
 * Resolve an agent's provider, defaulting to 'claude' for agents
 * created before provider support was added.
 */
export function getAgentProvider(agent: Pick<Agent, 'provider'>): AgentProvider {
  return agent.provider ?? 'claude'
}
```

Using `Pick<Agent, 'provider'>` keeps it flexible — works with full Agent objects and partial objects alike.

DO NOT modify:
- AgentModel type (line 128)
- ContainerConfig interface or its claudeFlags field (lines 398-406)
- AppPreferences interface (lines 155-167) — defaultProvider goes in AppSettings, not here
  </action>
  <verify>Run `npx tsc --noEmit` — must compile with zero errors. Grep for `AgentProvider` in types.ts to confirm the type exists. Grep for `getAgentProvider` to confirm the helper exists.</verify>
  <done>AgentProvider type exported, Agent.provider field exists as optional, sessionId comment updated, getAgentProvider helper function exported.</done>
</task>

<task type="auto">
  <name>Task 2: Add provider display names to constants.ts</name>
  <files>src/shared/constants.ts</files>
  <action>
Make two changes to src/shared/constants.ts:

1. Add the AgentProvider import at the top of the file. The file currently imports only from './types' on line 1:

Change line 1 from:
```typescript
import type { ThemeName, ThemeColors } from './types'
```
To:
```typescript
import type { ThemeName, ThemeColors, AgentProvider } from './types'
```

2. After the `themes` object (after line 75, at the end of the file), add the provider display name mapping:

```typescript
// Human-readable display names for agent providers
export const agentProviderNames: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
}
```

This is a Record keyed by AgentProvider so TypeScript enforces that every provider variant has a display name. If a new variant is added to the union in the future, this will produce a compile error until a name is added here.
  </action>
  <verify>Run `npx tsc --noEmit` — must compile with zero errors. Grep for `agentProviderNames` in constants.ts to confirm the mapping exists.</verify>
  <done>agentProviderNames exported from constants.ts with entries for 'claude' and 'codex'.</done>
</task>

<task type="auto">
  <name>Task 3: Add defaultProvider to AppSettings interface and defaults</name>
  <files>src/main/settings-manager.ts</files>
  <action>
Make three changes to src/main/settings-manager.ts:

1. Update the import on line 11 to include AgentProvider:

Change from:
```typescript
import type { CustomizablePromptType } from '../shared/types'
```
To:
```typescript
import type { CustomizablePromptType, AgentProvider } from '../shared/types'
```

2. Add `defaultProvider` as a top-level optional field on the AppSettings interface. Insert it after the `_internal` block (line 117), before the closing brace of AppSettings (line 118):

```typescript
  // Agent provider default (which CLI new manual agents use)
  defaultProvider?: AgentProvider
```

Making it optional (`?`) means existing settings.json files without the field load fine — the deep merge in loadSettings will fill it from defaults.

3. In `getDefaultSettings()` (the return object starting at line 147), add `defaultProvider: 'claude'` as the last field before the closing brace. Insert after the `_internal` block (line 242):

```typescript
    defaultProvider: 'claude',
```

The existing loadSettings() deep merge (line 252) uses spread: `{ ...defaults, ...loaded }`. Since `defaultProvider` is a top-level primitive (not a nested object), this spread handles it correctly — if loaded settings have it, it wins; if not, the default 'claude' applies. No additional merge logic needed.

DO NOT:
- Add any migration code — runtime default handles the missing field case
- Add per-provider settings sections — deferred per CONTEXT.md
- Modify updateSettings() — the existing top-level spread `{ ...currentSettings, ...updates }` already handles new top-level fields
  </action>
  <verify>Run `npx tsc --noEmit` — must compile with zero errors. Grep for `defaultProvider` in settings-manager.ts to confirm it appears in both the interface and defaults.</verify>
  <done>AppSettings.defaultProvider exists as optional AgentProvider field, getDefaultSettings returns 'claude' as the default value.</done>
</task>

</tasks>

<verification>
After all three tasks are complete, run these checks:

1. `npx tsc --noEmit` — zero errors (confirms no type regressions)
2. `grep -n 'AgentProvider' src/shared/types.ts` — shows type definition and usage in Agent interface
3. `grep -n 'getAgentProvider' src/shared/types.ts` — shows helper function
4. `grep -n 'agentProviderNames' src/shared/constants.ts` — shows display name mapping
5. `grep -n 'defaultProvider' src/main/settings-manager.ts` — shows field in interface and defaults
6. `npm run build` — full build succeeds (both main process and renderer)
</verification>

<success_criteria>
- AgentProvider is a strict union type: 'claude' | 'codex'
- Agent.provider is optional and typed as AgentProvider
- getAgentProvider() helper returns agent.provider ?? 'claude'
- agentProviderNames maps each provider to its display name
- AppSettings.defaultProvider defaults to 'claude'
- TypeScript compiles cleanly with zero new errors
- No existing types (AgentModel, ContainerConfig.claudeFlags) were modified
- No migration code was added — runtime defaults handle missing fields
</success_criteria>

<output>
After completion, create `.planning/phases/1/01-01-SUMMARY.md`
</output>
