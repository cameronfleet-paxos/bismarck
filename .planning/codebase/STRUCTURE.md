# Codebase Structure

**Analysis Date:** 2026-02-15

## Directory Layout

```
bismarck/
├── src/                          # All application source code
│   ├── main/                     # Electron main process (Node.js backend)
│   │   ├── headless/             # Headless Docker agent subsystem
│   │   └── teams/                # Plan/team execution subsystem
│   ├── renderer/                 # Electron renderer process (React frontend)
│   │   ├── assets/               # Static assets (icons, images)
│   │   │   └── icons/            # Agent icon SVGs
│   │   ├── components/           # React components
│   │   │   ├── settings/         # Settings page wrapper
│   │   │   │   └── sections/     # Individual settings sections
│   │   │   ├── tutorial/         # Onboarding tutorial system
│   │   │   ├── ui/               # Reusable UI primitives (shadcn/ui)
│   │   │   └── workflow/         # Cron workflow editor/viewer
│   │   ├── hooks/                # Custom React hooks
│   │   └── utils/                # Renderer-side utilities
│   ├── shared/                   # Shared types and utilities (main + renderer)
│   └── lib/                      # Generic library utilities
├── assets/                       # Application assets (icons, images for packaging)
├── docker/                       # Docker configuration for headless agents
├── scripts/                      # Build and utility scripts
│   └── test/                     # CDP-based test infrastructure
├── plans/                        # Plan template files
├── dist/                         # Build output (compiled main + renderer)
│   ├── main/                     # Compiled main process JS
│   └── renderer/                 # Vite-bundled renderer
├── .claude/                      # Claude Code configuration
│   └── commands/                 # Custom slash commands
│       └── bismarck/             # Project-specific commands
├── .github/                      # GitHub Actions workflows
│   └── workflows/                # CI/CD pipeline definitions
├── .beads/                       # Beads task management data
├── index.html                    # Electron renderer HTML entry (with splash screen)
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript config (renderer/shared)
├── tsconfig.main.json            # TypeScript config (main process)
├── vite.config.ts                # Vite bundler config (renderer)
├── tailwind.config.cjs           # Tailwind CSS config
├── postcss.config.cjs            # PostCSS config
├── eslint.config.js              # ESLint config
├── components.json               # shadcn/ui component config
├── install.sh                    # Build + install script
├── CLAUDE.md                     # Claude Code project instructions
└── AGENTS.md                     # Agent configuration documentation
```

## Directory Purposes

**`src/main/`:**
- Purpose: Electron main process - the application backend
- Contains: 40+ TypeScript modules for terminal management, Docker orchestration, git operations, plan execution, configuration, settings, logging, auto-updates, cron scheduling
- Key files:
  - `main.ts`: Application entry point, window creation, all IPC handler registrations (~56k, ~1200 lines)
  - `preload.ts`: Context bridge API (~36k, exposes ~120 methods to renderer)
  - `config.ts`: File-based persistence for workspaces, state, plans (~18k)
  - `state-manager.ts`: In-memory app state (tabs, workspaces, preferences)
  - `settings-manager.ts`: Application settings CRUD (~36k)
  - `terminal.ts`: PTY terminal creation and management via `node-pty`
  - `docker-sandbox.ts`: Docker container lifecycle management (~37k)
  - `tool-proxy.ts`: HTTP proxy server for sensitive tool operations (~21k)
  - `git-utils.ts`: Git CLI wrapper (worktrees, branches, PRs) (~27k)
  - `ralph-loop.ts`: Iterative agent loop management (~24k)
  - `prompt-templates.ts`: Default prompts for all agent types (~35k)
  - `logger.ts`: Structured logging with categories and plan-specific logs
  - `hook-manager.ts`: Claude Code hooks installation (stop, notification, persona)
  - `auto-updater.ts`: GitHub Releases-based update checking
  - `cron-scheduler.ts`: Cron expression evaluation and workflow execution
  - `cron-job-manager.ts`: Cron job CRUD and persistence
  - `bd-client.ts`: Beads task management CLI wrapper
  - `stream-parser.ts`: NDJSON parser for Claude Code headless output
  - `exec-utils.ts`: Shell command execution with extended PATH

**`src/main/headless/`:**
- Purpose: Headless Docker agent subsystem
- Contains: Agent lifecycle, event system, standalone and team-based agent management
- Key files:
  - `docker-agent.ts`: `HeadlessAgent` class wrapping Docker container + stream parser
  - `standalone.ts`: Standalone headless agent management (create, stop, nudge, follow-up, discussion) (~52k)
  - `team-agents.ts`: Plan-aware headless agents with bd integration (~25k)
  - `events.ts`: Event emission utilities for headless agents
  - `state.ts`: Shared in-memory state (Maps of active agents)
  - `index.ts`: Re-exports from all submodules

**`src/main/teams/`:**
- Purpose: Plan execution subsystem (multi-agent orchestration)
- Contains: Full plan lifecycle from creation through completion
- Key files:
  - `index.ts`: Wires cross-module callbacks, re-exports everything
  - `crud.ts`: Plan CRUD, initialization, state loading
  - `discussion.ts`: Pre-execution brainstorming with discussion agent
  - `execution.ts`: Plan execution orchestration
  - `orchestrator.ts`: Orchestrator agent prompt building
  - `task-polling.ts`: Polls `bd list` for task updates, spawns agents
  - `worktree-agents.ts`: Creates git worktrees and task agents
  - `git-strategy.ts`: Branch management, PR creation, merging (~31k)
  - `critic.ts`: Code review agents that review completed tasks
  - `completion.ts`: Plan completion and cleanup logic
  - `follow-ups.ts`: Follow-up task management
  - `manager.ts`: Manager agent spawning
  - `architect.ts`: Architect agent spawning
  - `events.ts`: Plan event emission
  - `state.ts`: Shared state (executing plans, poll intervals)
  - `helpers.ts`: Utility functions (ID generation, label parsing)
  - `task-cleanup.ts`: Worktree and agent cleanup

**`src/renderer/`:**
- Purpose: React-based UI for the Electron window
- Contains: Single-page application with all views
- Key files:
  - `App.tsx`: Monolithic component (~4569 lines) containing all application state and views
  - `main.tsx`: React DOM mount point with benchmark timing
  - `index.css`: Global styles (Tailwind directives, custom CSS)
  - `electron.d.ts`: TypeScript declarations for `window.electronAPI`

**`src/renderer/components/`:**
- Purpose: React UI components
- Contains: ~40 component files covering all features
- Key files:
  - `SetupWizard.tsx`: First-run onboarding wizard (~100k)
  - `CommandSearch.tsx`: Command palette (Cmd+K) (~46k)
  - `HeadlessTerminal.tsx`: Headless agent terminal view (~48k)
  - `PlanDetailView.tsx`: Plan details and task visualization (~34k)
  - `SettingsPage.tsx`: Main settings view (~31k)
  - `DependencyGraphModal.tsx`: Task dependency visualization (~29k)
  - `PlanCard.tsx`: Plan summary card (~23k)
  - `DevConsole.tsx`: Developer testing console (~19k)
  - `DiffOverlay.tsx`: Git diff overlay view (~18k)
  - `DiffFileList.tsx`: File list for diff view (~16k)
  - `PlanSidebar.tsx`: Plan sidebar panel (~14k)
  - `Terminal.tsx`: xterm.js terminal wrapper (~9k)
  - `WorkspaceCard.tsx`: Agent card in grid (~7k)
  - `WorkspaceModal.tsx`: Agent create/edit modal (~9k)
  - `TabBar.tsx`: Tab bar with drag-and-drop (~9k)
  - `AgentIcon.tsx`: Dynamic agent icon component (~5k)

**`src/renderer/components/settings/sections/`:**
- Purpose: Individual settings page sections
- Contains: 13 settings section components
- Key files:
  - `DockerSettings.tsx`: Docker image and resource configuration
  - `AuthenticationSettings.tsx`: OAuth and token management
  - `GeneralSettings.tsx`: General app preferences
  - `RepositoriesSettings.tsx`: Repository management
  - `PlansSettings.tsx`: Plan configuration and prompt customization
  - `CronJobsSettings.tsx`: Cron job management
  - `KeyboardShortcutsSettings.tsx`: Keyboard shortcut configuration
  - `PromptEditor.tsx`: Prompt template editor
  - `PlayboxSettings.tsx`: Experimental feature settings
  - `RalphLoopPresetsSettings.tsx`: Ralph loop preset management
  - `UpdatesSettings.tsx`: Auto-update settings
  - `LanguagesSettings.tsx`: Language/runtime settings
  - `RawJsonSettings.tsx`: Raw config file editor

**`src/renderer/components/ui/`:**
- Purpose: Reusable UI primitives (shadcn/ui style)
- Contains: 9 UI components wrapping Radix UI primitives
- Key files: `button.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `switch.tsx`, `textarea.tsx`, `tooltip.tsx`

**`src/renderer/components/workflow/`:**
- Purpose: Cron workflow visual editor and status viewer
- Contains: Node-based workflow graph UI
- Key files: `WorkflowEditor.tsx`, `WorkflowNode.tsx`, `NodeConfigPanel.tsx`, `WorkflowStatusViewer.tsx`

**`src/renderer/components/tutorial/`:**
- Purpose: Guided onboarding tutorial system
- Contains: Tutorial state management and UI
- Key files: `TutorialProvider.tsx`, `TutorialOverlay.tsx`, `TutorialTooltip.tsx`, `tutorial-steps.ts`, `index.ts`

**`src/renderer/hooks/`:**
- Purpose: Custom React hooks
- Contains: 1 hook file
- Key files: `useElapsedTime.ts` (elapsed timer for agent durations)

**`src/renderer/utils/`:**
- Purpose: Renderer-side utility functions
- Contains: 4 utility modules
- Key files:
  - `build-dependency-graph.ts`: Converts task assignments to dependency graph
  - `terminal-buffer.ts`: Buffers terminal output for batch rendering
  - `terminal-keys.ts`: Terminal keyboard input handling
  - `dev-log.ts`: Development-only logging

**`src/shared/`:**
- Purpose: Code shared between main and renderer processes
- Contains: Type definitions, constants, utilities
- Key files:
  - `types.ts`: All TypeScript interfaces (~25k, ~650 lines) - Agent, Plan, AppState, etc.
  - `constants.ts`: Agent icon names, theme colors
  - `cron-types.ts`: Cron job and workflow type definitions
  - `grid-utils.ts`: Grid layout calculations
  - `pr-utils.ts`: PR URL extraction utilities
  - `ralph-loop-presets.ts`: Default ralph loop configurations
  - `cron-utils.ts`: Cron expression utilities

**`src/lib/`:**
- Purpose: Generic library code
- Contains: 1 utility file
- Key files: `utils.ts` (166 bytes - `cn()` helper for class name merging with `clsx` + `tailwind-merge`)

**`docker/`:**
- Purpose: Docker infrastructure for headless agents
- Contains: Dockerfiles, build scripts, tool proxy wrapper scripts
- Key files:
  - `Dockerfile`: Production agent container image
  - `Dockerfile.mock`: Mock agent for testing
  - `gh-proxy-wrapper.sh`: GitHub CLI proxy wrapper (~4k)
  - `git-proxy-wrapper.sh`: Git CLI proxy wrapper (~5k)
  - `bd-proxy-wrapper.sh`: Beads CLI proxy wrapper
  - `bb-proxy-wrapper.sh`: BB CLI proxy wrapper
  - `build.sh`: Docker image build script
  - `build-mock.sh`: Mock image build script
  - `mock-claude.js`: Mock Claude agent for testing
  - `bd`: Beads CLI stub script

**`scripts/test/`:**
- Purpose: CDP-based testing infrastructure
- Contains: Test scripts that interact with the running app via Chrome DevTools Protocol
- Key files:
  - `cdp-server.js`: HTTP server wrapping CDP connection for fast test interactions
  - `cdp-helper.js`: Shared CDP connection module
  - `dev-with-cdp.js`: Unified dev startup with CDP support
  - `wait-for-ready.js`: Polls health endpoints until all services ready
  - `comprehensive-test.js`: Full app test suite
  - `core-flows-test.js`: Core workflow tests
  - `tutorial-test.js`: Tutorial flow tests
  - `accessibility-test.js`: Accessibility checks
  - `performance-test.js`: Performance benchmarks
  - `visual-regression-test.js`: Visual regression tests
  - `cdp-inspector.js`: Interactive CDP inspector
  - `cdp-recorder.js`: CDP interaction recorder
  - `diff-view-test.js`: Diff view tests

## Key File Locations

**Entry Points:**
- `src/main/main.ts`: Electron main process entry (specified in `package.json` as `dist/main/main/main.js`)
- `src/renderer/main.tsx`: React renderer entry (loaded by Vite from `index.html`)
- `src/main/preload.ts`: Preload bridge script (loaded by BrowserWindow config)
- `index.html`: HTML shell with splash screen

**Configuration:**
- `package.json`: Dependencies, scripts, electron-builder config
- `tsconfig.json`: TypeScript config for renderer/shared (ES2022, bundler module resolution, `@/*` path alias)
- `tsconfig.main.json`: TypeScript config for main process
- `vite.config.ts`: Vite bundler config (React plugin, `@` alias, port 5173)
- `tailwind.config.cjs`: Tailwind CSS configuration
- `eslint.config.js`: ESLint configuration
- `components.json`: shadcn/ui component paths configuration

**Core Logic:**
- `src/main/config.ts`: All file-based persistence (config, state, plans, mutex locks)
- `src/main/state-manager.ts`: In-memory app state management
- `src/main/settings-manager.ts`: Application settings with Docker, tools, prompts
- `src/main/terminal.ts`: PTY terminal lifecycle management
- `src/main/docker-sandbox.ts`: Docker container orchestration
- `src/main/teams/`: Full plan execution pipeline (17 modules)
- `src/main/headless/`: Headless agent management (6 modules)

**Testing:**
- `src/main/naming-utils.test.ts`: Unit test (vitest) for naming utilities
- `scripts/test/*.js`: CDP-based integration/E2E tests (not vitest)

## Naming Conventions

**Files:**
- `kebab-case.ts` / `kebab-case.tsx`: All source files use kebab-case (e.g., `docker-sandbox.ts`, `terminal-buffer.ts`)
- `PascalCase.tsx`: React components use PascalCase (e.g., `SetupWizard.tsx`, `CommandSearch.tsx`, `HeadlessTerminal.tsx`)
- Exception: `App.tsx` and `Logo.tsx` are single-word PascalCase
- UI primitives: `kebab-case.tsx` (e.g., `button.tsx`, `dropdown-menu.tsx`)
- Test files: `*.test.ts` suffix (e.g., `naming-utils.test.ts`)

**Directories:**
- `kebab-case`: All directories use lowercase kebab-case (e.g., `teams`, `headless`, `settings`)

**Exports:**
- Functions: `camelCase` (e.g., `createTerminal`, `getWorkspaces`, `buildPrompt`)
- Types/Interfaces: `PascalCase` (e.g., `Agent`, `Plan`, `HeadlessAgentInfo`)
- Constants: `UPPER_SNAKE_CASE` for true constants (e.g., `POLL_INTERVAL_MS`, `DEFAULT_MAX_PARALLEL_AGENTS`), `camelCase` for configuration objects (e.g., `agentIcons`, `themes`)

## Where to Add New Code

**New Main Process Feature:**
- Primary code: `src/main/<feature-name>.ts`
- Wire IPC handlers in: `src/main/main.ts` (in `registerIpcHandlers()`)
- Expose to renderer in: `src/main/preload.ts` (add to `contextBridge.exposeInMainWorld`)
- Add type declarations: `src/renderer/electron.d.ts`
- Add shared types: `src/shared/types.ts`

**New Complex Subsystem (like teams/headless):**
- Create directory: `src/main/<subsystem>/`
- Create barrel export: `src/main/<subsystem>/index.ts`
- Wire callbacks in index.ts to break circular deps (see `src/main/teams/index.ts` pattern)

**New React Component:**
- Feature component: `src/renderer/components/<ComponentName>.tsx`
- Settings section: `src/renderer/components/settings/sections/<SectionName>Settings.tsx`
- Reusable UI primitive: `src/renderer/components/ui/<component-name>.tsx`
- Import and use in: `src/renderer/App.tsx`

**New Custom React Hook:**
- Location: `src/renderer/hooks/use<HookName>.ts`

**New Shared Type:**
- Add interface/type to: `src/shared/types.ts`
- Import with `import type { ... } from '../shared/types'` (main) or `import type { ... } from '@/shared/types'` (renderer)

**New Utility Function:**
- Main process: `src/main/<purpose>.ts` or add to existing utility module
- Renderer: `src/renderer/utils/<purpose>.ts`
- Shared: `src/shared/<purpose>.ts`
- Generic: `src/lib/utils.ts`

**New Docker Wrapper:**
- Script: `docker/<tool-name>-proxy-wrapper.sh`
- Registration: Add to `src/main/wrapper-generator.ts`
- Tool proxy: Add handler in `src/main/tool-proxy.ts`

**New Test:**
- Unit test: `src/main/<module>.test.ts` (vitest, co-located)
- CDP integration test: `scripts/test/<test-name>-test.js`

## Special Directories

**`dist/`:**
- Purpose: Compiled build output
- Generated: Yes (by `npm run build`)
- Committed: Partially committed (appears in git)
- Structure: `dist/main/` (tsc output) + `dist/renderer/` (Vite output)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No

**`.beads/`:**
- Purpose: Beads task management data for the project itself
- Generated: Yes (by `bd init`)
- Committed: Yes

**`~/.bismarck/` (runtime, not in repo):**
- Purpose: All application data at runtime
- Contains: `config.json`, `state.json`, `settings.json`, `plans.json`, `plans/`, `standalone-headless/`, `hooks/`, `sessions/`, `sockets/`, `cron-jobs/`, `crash-logs/`, `repos/`, `debug-*.log`
- Generated: Yes (at runtime)
- Committed: No (lives in user's home directory)
- Dev variant: `~/.bismarck-dev/` used when `NODE_ENV=development`

**`plans/`:**
- Purpose: Plan template files
- Generated: No (manually authored)
- Committed: Yes

---

*Structure analysis: 2026-02-15*
