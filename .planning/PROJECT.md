# Bismarck — Codex Agent Support

## Vision
Add OpenAI Codex as a second interactive agent provider in Bismarck, alongside Claude Code. Users can choose between Claude and Codex when creating agents.

## Scope (Milestone 1)
- Interactive PTY terminal agents only (no headless/Docker Codex support yet)
- Per-agent provider selection (each agent is either `claude` or `codex`)
- Provider toggle in Settings (default provider) and Add Agent screen
- Assume user has pre-authenticated Codex (`codex login` done externally)
- No Codex-specific event parsing, stream handling, or headless support

## What This Is NOT
- Not a full agent abstraction layer (that's future work)
- Not headless/Docker Codex support
- Not Codex auth management
- Not plan execution with Codex agents

## Key Decisions
- **Provider scope**: Per-agent (each agent card stores its provider type)
- **Terminal mode**: PTY only — spawn `codex` binary in terminal just like `claude`
- **Auth**: Assume pre-authenticated — no Bismarck-managed Codex login
- **Git workflow**: Atomic commits per meaningful change
- **Research**: Deep research on Codex CLI interactive mode before implementation

## Codebase Context
- Electron app: main process (Node.js) + renderer (React)
- Terminal management: `src/main/terminal.ts` — creates PTY terminals via `node-pty`
- Agent type: `src/shared/types.ts` — `Agent` interface
- Add Agent UI: `src/renderer/components/WorkspaceModal.tsx`
- Settings: `src/renderer/components/settings/sections/GeneralSettings.tsx`
- Existing Codex plan (reference): `plans/codex-support.md`
