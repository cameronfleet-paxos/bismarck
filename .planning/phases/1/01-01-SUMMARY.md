---
phase: 01-type-system
plan: 01
subsystem: shared-types
tags: [type-system, agent-provider, codex, data-model]
dependency-graph:
  requires: []
  provides: [AgentProvider, getAgentProvider, agentProviderNames, defaultProvider]
  affects: [types.ts, constants.ts, settings-manager.ts]
tech-stack:
  added: []
  patterns: [union-type-with-exhaustive-record, pick-based-helper, optional-field-with-runtime-default]
key-files:
  created: []
  modified:
    - src/shared/types.ts
    - src/shared/constants.ts
    - src/main/settings-manager.ts
decisions:
  - "AgentProvider is a strict union ('claude' | 'codex') not an enum, matching codebase convention"
  - "Agent.provider is optional with runtime fallback via getAgentProvider(), no migration needed"
  - "defaultProvider lives in AppSettings (not AppPreferences) since it is a configuration concern"
  - "agentProviderNames uses Record<AgentProvider, string> for exhaustive compile-time checking"
metrics:
  duration: 167s
  completed: 2026-02-15T22:17:27Z
  tasks: 3
  files: 3
---

# Phase 1 Plan 1: AgentProvider Type System Summary

AgentProvider union type ('claude' | 'codex') with optional Agent.provider field, getAgentProvider helper with 'claude' fallback, display name mapping, and defaultProvider setting defaulting to 'claude'.

## Tasks Completed

| Task | Name | Commit | Files Modified |
| ---- | ---- | ------ | -------------- |
| 1 | Add AgentProvider type and provider field to types.ts | 850e988 | src/shared/types.ts |
| 2 | Add provider display names to constants.ts | 26567f9 | src/shared/constants.ts |
| 3 | Add defaultProvider to AppSettings | aad6c01 | src/main/settings-manager.ts |

## Changes Made

### Task 1: types.ts
- Added `AgentProvider = 'claude' | 'codex'` union type after PersonaMode
- Added optional `provider?: AgentProvider` field on Agent interface (after `directory`, before `purpose`)
- Updated `sessionId` comment to document both Claude (`--resume`) and Codex (`resume` subcommand) resume patterns
- Added `getAgentProvider()` helper at end of file using `Pick<Agent, 'provider'>` for flexibility, with `?? 'claude'` fallback

### Task 2: constants.ts
- Added `AgentProvider` to the import from `./types`
- Added `agentProviderNames: Record<AgentProvider, string>` mapping: `claude -> 'Claude Code'`, `codex -> 'OpenAI Codex'`
- Using `Record<AgentProvider, string>` ensures compile-time exhaustiveness -- adding a new provider variant forces a display name entry

### Task 3: settings-manager.ts
- Added `AgentProvider` to the import from `../shared/types`
- Added `defaultProvider?: AgentProvider` as optional field on `AppSettings` interface (after `_internal`)
- Added `defaultProvider: 'claude'` to `getDefaultSettings()` return object
- No migration code needed: the existing spread merge in `loadSettings()` handles missing fields via defaults

## Verification Results

1. `npx tsc --noEmit` -- zero errors (all three tasks verified individually and in aggregate)
2. `grep AgentProvider src/shared/types.ts` -- found at lines 13, 75, 787
3. `grep getAgentProvider src/shared/types.ts` -- found at line 787
4. `grep agentProviderNames src/shared/constants.ts` -- found at line 78
5. `grep defaultProvider src/main/settings-manager.ts` -- found at lines 119 and 245
6. `npm run build` -- TypeScript compilation succeeds; Vite/rollup step fails due to missing `@rollup/rollup-linux-arm64-gnu` in Docker (platform issue, not code issue)

## Deviations from Plan

None -- plan executed exactly as written.

## Decisions Made

1. **AgentProvider as union type** -- matches existing codebase convention (ThemeName, AgentModel, etc. are all string union types, not enums)
2. **Optional provider with runtime fallback** -- avoids data migration; existing agents without `provider` field resolve to `'claude'` via `getAgentProvider()`
3. **defaultProvider in AppSettings** -- settings-manager.ts handles configuration; AppPreferences in state.json handles runtime UI state. Provider default is configuration.
4. **Record-based display names** -- compile-time exhaustiveness means adding a new provider variant to the union will cause a type error until a display name is added

## Self-Check: PASSED

- [x] src/shared/types.ts exists
- [x] src/shared/constants.ts exists
- [x] src/main/settings-manager.ts exists
- [x] 01-01-SUMMARY.md exists
- [x] Commit 850e988 exists (Task 1)
- [x] Commit 26567f9 exists (Task 2)
- [x] Commit aad6c01 exists (Task 3)
