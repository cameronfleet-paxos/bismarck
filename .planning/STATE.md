# Project State

## Current Phase
Phase 1 -- Type System & Data Model (Plan 01 complete)

## Milestone
Milestone 1: Interactive Codex Agents

## Completed
- [x] Codebase map created (`.planning/codebase/`)
- [x] Deep research completed (Codex CLI interactive mode, config/env, hooks/attention)
- [x] Requirements defined
- [x] Roadmap created (6 phases)
- [x] Phase 1 Plan 01: AgentProvider type system

## Next Action
Continue to Phase 2 or next plan as directed.

## Decisions
- AgentProvider is a strict union type ('claude' | 'codex'), not an enum
- Agent.provider is optional with runtime fallback via getAgentProvider()
- defaultProvider lives in AppSettings (configuration), not AppPreferences (runtime state)
- agentProviderNames uses Record<AgentProvider, string> for compile-time exhaustiveness

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
| ----- | ---- | -------- | ----- | ----- |
| 01    | 01   | 167s     | 3     | 3     |

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
- **Stopped at:** Completed 01-01-PLAN.md
- **Timestamp:** 2026-02-15T22:17:27Z
