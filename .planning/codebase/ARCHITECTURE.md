# Architecture

**Analysis Date:** 2026-02-15

## Pattern Overview

**Overall:** Electron multi-process application with IPC-based communication

**Key Characteristics:**
- Classic Electron main/renderer process split with context-isolated preload bridge
- Main process acts as a thick backend: terminal management, Docker orchestration, git operations, plan execution, cron scheduling
- Single monolithic renderer (`App.tsx` at 4569 lines) managing all UI state via React hooks
- Headless Claude Code agents run in Docker containers, managed by the main process
- File-based persistence (JSON files in `~/.bismarck/`) with in-memory caching and mutex-based concurrency control
- Event-driven communication: main process pushes updates to renderer via `webContents.send()`, renderer invokes main via `ipcRenderer.invoke()`

## Layers

**Renderer (UI Layer):**
- Purpose: Displays agent terminals, plan management, settings, and workflow UIs
- Location: `src/renderer/`
- Contains: React components, CSS, utility functions, type declarations
- Depends on: `src/shared/` types, Electron preload API (`window.electronAPI`)
- Used by: End users via the Electron window

**Preload (Bridge Layer):**
- Purpose: Exposes a safe subset of main-process functionality to the renderer via `contextBridge`
- Location: `src/main/preload.ts`
- Contains: IPC channel mappings (invoke calls), event listener registrations
- Depends on: Electron `ipcRenderer`, `src/shared/types`
- Used by: Renderer via `window.electronAPI`

**Main Process (Backend Layer):**
- Purpose: Application lifecycle, terminal management, Docker orchestration, git operations, plan execution, settings, auto-updates
- Location: `src/main/`
- Contains: IPC handlers, process management, file I/O, child process spawning, HTTP servers
- Depends on: Electron APIs, `node-pty`, `src/shared/` types, Docker CLI, git CLI, `bd` CLI
- Used by: Renderer (via IPC), system tray, headless agents (via tool proxy)

**Shared Layer:**
- Purpose: Type definitions and utility functions shared between main and renderer
- Location: `src/shared/`
- Contains: TypeScript interfaces/types (`types.ts`), constants (`constants.ts`), grid utilities (`grid-utils.ts`), PR utilities (`pr-utils.ts`), cron types (`cron-types.ts`), ralph loop presets (`ralph-loop-presets.ts`)
- Depends on: Nothing (leaf layer)
- Used by: Both main and renderer

**Teams Subsystem:**
- Purpose: Plan creation, discussion, execution, task management, git strategy, critic review, follow-ups
- Location: `src/main/teams/`
- Contains: 17 modules covering CRUD, orchestration, discussion, execution, polling, git strategy, critic agents, follow-up management
- Depends on: `src/main/headless/`, `src/main/config.ts`, `src/main/bd-client.ts`, `src/main/git-utils.ts`
- Used by: Main process IPC handlers

**Headless Agent Subsystem:**
- Purpose: Running Claude Code agents in Docker containers without interactive terminals
- Location: `src/main/headless/`
- Contains: Docker agent wrapper (`docker-agent.ts`), standalone agent management (`standalone.ts`), team-based agents (`team-agents.ts`), event system, shared state
- Depends on: `src/main/docker-sandbox.ts`, `src/main/stream-parser.ts`, `src/main/tool-proxy.ts`
- Used by: Teams subsystem, standalone headless flows, ralph loops

## Data Flow

**Interactive Agent Flow (Terminal Mode):**

1. User creates/starts an agent via renderer UI (`App.tsx` -> `window.electronAPI.saveWorkspace()`)
2. Preload forwards to main via IPC (`ipcMain.handle('save-workspace', ...)` in `src/main/main.ts`)
3. Main saves workspace config to `~/.bismarck/config.json` via `src/main/config.ts`
4. Main creates a PTY terminal (`src/main/terminal.ts`) using `node-pty`, launches `claude` CLI
5. Main sets up a Unix socket server (`src/main/socket-server.ts`) for stop/waiting events
6. Main installs Claude hooks (`src/main/hook-manager.ts`) that notify Bismarck when Claude needs input
7. Terminal output streams from PTY -> main process -> renderer via `webContents.send('terminal-data', ...)`
8. User input flows from renderer -> main via IPC -> PTY write

**Headless Agent Flow (Docker Mode):**

1. Plan execution or standalone headless request triggers agent creation
2. `src/main/docker-sandbox.ts` spawns a Docker container with the configured image
3. Container runs `claude --dangerously-skip-permissions --output-format stream-json`
4. Container uses tool proxy wrappers (`docker/gh-proxy-wrapper.sh`, etc.) for sensitive operations
5. `src/main/tool-proxy.ts` runs an HTTP server on the host, proxying `gh`, `git`, `bd` commands
6. `src/main/stream-parser.ts` parses NDJSON output from Claude into typed events
7. `src/main/headless/docker-agent.ts` wraps this into a `HeadlessAgent` class with event emitter
8. Events flow to renderer via `webContents.send('headless-agent-update', ...)`

**Plan Execution Flow (Team Mode):**

1. User creates a plan with title/description via `src/main/teams/crud.ts`
2. Optionally starts a discussion phase (`src/main/teams/discussion.ts`) for brainstorming
3. Execution begins via `src/main/teams/execution.ts` using a reference agent's repository
4. Orchestrator agent creates tasks using `bd` (beads task management tool) via `src/main/bd-client.ts`
5. Task polling (`src/main/teams/task-polling.ts`) monitors `bd list` for new/updated tasks
6. For each ready task, `src/main/teams/worktree-agents.ts` creates a git worktree and spawns a headless agent
7. Git strategy (`src/main/teams/git-strategy.ts`) manages branches, PRs, and merges
8. Critic agents (`src/main/teams/critic.ts`) review completed work
9. Completion logic (`src/main/teams/completion.ts`) handles cleanup and final merging

**State Management:**
- **Renderer state:** All in `App.tsx` via `useState` hooks. No external state library. State initialized from main process on load, then updated via IPC events (`useEffect` listeners on `window.electronAPI.on*` callbacks)
- **Main process state:** In-memory state in `src/main/state-manager.ts` (tabs, active workspaces, preferences), persisted to `~/.bismarck/state.json` on changes
- **Configuration:** Agent definitions in `~/.bismarck/config.json` via `src/main/config.ts`. Settings in `~/.bismarck/settings.json` via `src/main/settings-manager.ts`
- **Plan data:** Plans in `~/.bismarck/plans.json`, per-plan data in `~/.bismarck/plans/<planId>/` (task assignments, activities, headless agent info, worktrees)
- **Cron jobs:** Individual JSON files in `~/.bismarck/cron-jobs/<id>.json`

## Key Abstractions

**Agent (Workspace):**
- Purpose: Represents a Claude Code agent instance bound to a directory/repository
- Examples: `src/shared/types.ts` (`Agent` interface), `src/main/config.ts` (CRUD)
- Pattern: Agents can be interactive (PTY terminal), headless (Docker), standalone headless, or task agents (part of a plan)

**Plan:**
- Purpose: Represents a multi-agent work plan with tasks, discussions, and git strategy
- Examples: `src/shared/types.ts` (`Plan` interface), `src/main/teams/` (full lifecycle)
- Pattern: State machine: `draft` -> `discussing` -> `discussed` -> `delegating` -> `in_progress` -> `ready_for_review` -> `completed`

**HeadlessAgent:**
- Purpose: Wraps a Docker container running Claude Code in headless mode
- Examples: `src/main/headless/docker-agent.ts` (`HeadlessAgent` class)
- Pattern: EventEmitter with lifecycle methods (`start`, `stop`, `nudge`) and stream event parsing

**Tab (AgentTab):**
- Purpose: Groups agents into visual tabs with configurable grid layouts
- Examples: `src/shared/types.ts` (`AgentTab` interface), `src/main/state-manager.ts`
- Pattern: Tabs can be standalone (user-created), dedicated to a plan, or dedicated to a cron job

**Ralph Loop:**
- Purpose: Iterative agent loops that run until a completion phrase or max iterations
- Examples: `src/main/ralph-loop.ts`, `src/shared/types.ts` (`RalphLoopConfig`, `RalphLoopState`)
- Pattern: Each iteration runs in a fresh Docker container with a shared git worktree

**Cron Job:**
- Purpose: Scheduled workflows with DAG-based node execution (headless agents, ralph loops, shell commands)
- Examples: `src/shared/cron-types.ts`, `src/main/cron-job-manager.ts`, `src/main/cron-scheduler.ts`
- Pattern: Workflow graphs with nodes and edges, scheduled via cron expressions

## Entry Points

**Electron Main Process:**
- Location: `src/main/main.ts`
- Triggers: `electron .` (app launch)
- Responsibilities: Creates BrowserWindow, registers all IPC handlers (~100+), initializes subsystems (config, state, tray, hooks, tool proxy, auto-updater, cron scheduler, power save), manages application lifecycle

**Renderer Entry:**
- Location: `src/renderer/main.tsx`
- Triggers: BrowserWindow loads `index.html` which loads `main.tsx` via Vite
- Responsibilities: Mounts React app (`<App />`) into DOM

**Preload Script:**
- Location: `src/main/preload.ts`
- Triggers: Loaded by BrowserWindow before renderer scripts
- Responsibilities: Exposes `window.electronAPI` bridge with ~120+ methods

**HTML Entry:**
- Location: `index.html`
- Triggers: BrowserWindow.loadURL (dev) or BrowserWindow.loadFile (prod)
- Responsibilities: Splash screen animation, loads Vite-bundled renderer

## Error Handling

**Strategy:** Defensive error handling with crash logging

**Patterns:**
- Global `uncaughtException` and `unhandledRejection` handlers in `src/main/main.ts` that write crash logs and attempt cleanup
- Crash logs written to `~/.bismarck/crash-logs/` via `src/main/crash-logger.ts`
- Individual IPC handlers wrap operations in try/catch (errors propagated to renderer as rejected promises)
- Mutex-based concurrency control (`src/main/config.ts` - `withPlanLock`, `withPlansFileLock`, `withGitPushLock`, `withRepoLock`) to prevent race conditions
- Docker container lifecycle managed with stop/cleanup on failure
- Process cleanup on shutdown via `src/main/process-cleanup.ts`

## Cross-Cutting Concerns

**Logging:**
- Centralized structured logger in `src/main/logger.ts` with categories (plan, task, worktree, agent, git, bd, docker, proxy)
- Date-based rolling log files: `~/.bismarck/debug-YYYY-MM-DD.log`
- Per-plan logs: `~/.bismarck/plans/<planId>/debug.log`
- Dev-mode console logging via `src/main/dev-log.ts`
- 7-day automatic cleanup of old log files

**Validation:**
- Type-level validation via TypeScript interfaces in `src/shared/types.ts`
- Runtime checks in individual modules (e.g., workspace existence checks in `src/main/terminal.ts`)
- No schema validation library used

**Authentication:**
- Claude OAuth token stored via `src/main/config.ts` (`getClaudeOAuthToken`, `setClaudeOAuthToken`)
- GitHub token stored in settings via `src/main/settings-manager.ts`
- Tool auth checker (`src/main/tool-auth-checker.ts`) validates tool credentials periodically
- Tool proxy (`src/main/tool-proxy.ts`) keeps tokens on host, never passed into Docker containers

**Performance:**
- Startup benchmark instrumentation (`src/main/startup-benchmark.ts`)
- Terminal creation queue (`src/main/terminal-queue.ts`) to prevent overwhelming system
- Power save management (`src/main/power-save.ts`) to prevent sleep during long operations
- Terminal output buffering (`src/renderer/utils/terminal-buffer.ts`)

---

*Architecture analysis: 2026-02-15*
