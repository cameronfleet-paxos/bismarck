# Project State

## Current Phase
Phase 2 -- Terminal Spawning for Codex (in progress, Plan 01 complete)

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

## Next Action
Execute Phase 2 Plan 02: `/gsd:execute-phase 2` (02-02-PLAN.md)

## Decisions
- AgentProvider is a strict union type ('claude' | 'codex'), not an enum
- Agent.provider is optional with runtime fallback via getAgentProvider()
- defaultProvider lives in AppSettings (configuration), not AppPreferences (runtime state)
- agentProviderNames uses Record<AgentProvider, string> for compile-time exhaustiveness
- Trust prompt auto-accept and accept-mode cycling removed entirely -- never worked reliably

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
| ----- | ---- | -------- | ----- | ----- |
| 01    | 01   | 167s     | 3     | 3     |
| 02    | 01   | 140s     | 2     | 2     |

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
- **Stopped at:** Completed 02-01-PLAN.md
- **Timestamp:** 2026-02-15T22:57:58Z
