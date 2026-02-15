# Project State

## Current Phase
Phase 3 -- Attention Hooks for Codex (in progress)

## Milestone
Milestone 1: Interactive Codex Agents

## Completed
- [x] Codebase map created (`.planning/codebase/`)
- [x] Deep research completed (Codex CLI interactive mode, config/env, hooks/attention)
- [x] Requirements defined
- [x] Roadmap created (6 phases)
- [x] Phase 1 Plan 01: AgentProvider type system
- [x] Phase 1 execution verified (TypeScript compiles, all artifacts present)
- [x] Phase 2 discussed (binary detection, session management, Claude cleanup)
- [x] Phase 2 researched (Codex CLI flags, session format, TUI, binary detection)
- [x] Phase 2 planned (2 plans, 2 waves, verified by plan-checker)
- [x] Phase 2 Plan 01: Remove dead terminal code (autoAcceptMode, trust prompt, accept-mode cycling)
- [x] Phase 2 Plan 02: Provider-aware terminal spawning (Codex command building, session management, binary detection)

- [x] Phase 3 Plan 02: CWD-based mapping file creation for Codex agents in terminal.ts

## Next Action
Execute Phase 3 Plan 01 (Codex notify hook script and configureCodexHook)

## Decisions
- Codex CWD mapping uses SHA-256 hash of directory path, first 16 hex chars
- Mapping file created BEFORE PTY spawn so hook script has data when Codex fires events
- Mapping failure wrapped in try/catch -- cannot block terminal spawn
- AgentProvider is a strict union type ('claude' | 'codex'), not an enum
- Agent.provider is optional with runtime fallback via getAgentProvider()
- defaultProvider lives in AppSettings (configuration), not AppPreferences (runtime state)
- agentProviderNames uses Record<AgentProvider, string> for compile-time exhaustiveness
- Trust prompt auto-accept and accept-mode cycling removed entirely -- never worked reliably
- Codex session ID is a UUID from SessionMeta first line (not the rollout filename)
- Non-Claude providers report ready immediately after command write (no TUI indicator to detect)
- buildClaudeCommand extracted from inline code to match buildCodexCommand pattern

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
| ----- | ---- | -------- | ----- | ----- |
| 01    | 01   | 167s     | 3     | 3     |
| 02    | 01   | 140s     | 2     | 2     |
| 02    | 02   | 270s     | 3     | 1     |
| 03    | 02   | 113s     | 1     | 1     |

## Key Research Findings
- Codex binary: `codex`, installed via `npm install -g @openai/codex` (Rust native binary)
- Interactive mode: full-screen TUI, launched with `codex` or `codex "prompt"`
- Working dir: `--cd <path>` flag
- Session resume: `codex resume <SESSION_ID>` (subcommand, not flag)
- Config: `~/.codex/config.toml` (TOML format)
- Sessions: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Auth: `codex login` (OAuth or API key), stored in `~/.codex/auth.json` or OS keychain
- Attention: `notify` callback in config.toml fires on `agent-turn-complete`, receives JSON as argv[1]
- No universal hook standard across coding agents -- thin per-agent adapters needed
- Bismarck's Unix socket attention bus is already agent-agnostic

## Last Session
- **Stopped at:** Completed 03-02-PLAN.md
- **Timestamp:** 2026-02-15T23:32:13Z
