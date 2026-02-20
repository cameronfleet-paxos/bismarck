# External Integrations

**Analysis Date:** 2026-02-15

## APIs & External Services

**Claude Code CLI:**
- Primary integration - Bismarck orchestrates Claude Code agents
- Interactive mode: spawned via `node-pty` in terminal sessions (`src/main/terminal.ts`)
- Headless mode: spawned inside Docker containers with `--output-format stream-json` (`src/main/headless/docker-agent.ts`)
- Plan mode: spawned with `--output-format stream-json` for plan file capture
- OAuth setup: `claude setup-token` for headless authentication (`src/main/oauth-setup.ts`)
- Description generation: `claude -p` with Haiku model for auto-generating repo descriptions (`src/main/description-generator.ts`)
- Hook integration: Bismarck installs Claude Code hooks (Stop, Notification, SessionStart, UserPromptSubmit) via `~/.claude/settings.json` (`src/main/hook-manager.ts`)

**GitHub API:**
- Auto-updater checks GitHub Releases API for new versions (`src/main/auto-updater.ts`)
  - Repository: `cameronfleet-paxos/bismarck`
  - Uses HTTPS directly (no SDK)
  - Check interval: 10 minutes
- GitHub CLI (`gh`) proxied to Docker containers for PR operations (`docker/gh-proxy-wrapper.sh`)
- Token management: GitHub token stored in `~/.bismarck/settings.json`, detected from `GITHUB_TOKEN`/`GH_TOKEN` env vars or `gh auth token`

**Docker Hub:**
- Agent container image: `bismarckapp/bismarck-agent:<version>` (`src/main/docker-sandbox.ts`)
- Registry digest verification via Docker Hub registry API (`src/main/docker-sandbox.ts`)
- Image published via GitHub Actions (`/.github/workflows/docker-image.yml`)

**Beads (bd):**
- Task management system for plans (`src/main/bd-client.ts`)
- CLI wrapper proxied to Docker containers (`docker/bd-proxy-wrapper.sh`)
- Initialized per-plan in `~/.bismarck/plans/<planId>/.beads/`
- Operations: create tasks/epics, list, update, close tasks
- Always invoked with `--sandbox` flag

**BuildBuddy (bb):**
- Optional integration for Bazel remote execution (`docker/bb-proxy-wrapper.sh`)
- SSO auth checking with periodic health checks (`src/main/tool-auth-checker.ts`)
- Proxied to Docker containers via tool proxy

## Data Storage

**Databases:**
- None - All data stored as JSON files on the local filesystem

**File Storage:**
- Config directory: `~/.bismarck/` (production) / `~/.bismarck-dev/` (development)
  - `config.json` - Agent definitions (`src/main/config.ts`)
  - `state.json` - App state, tabs, preferences (`src/main/state-manager.ts`)
  - `settings.json` - Docker, tools, prompts config (`src/main/settings-manager.ts`)
  - `repositories.json` - Git repository metadata (`src/main/repository-manager.ts`)
  - `plans.json` - Plan definitions (`src/main/config.ts`)
  - `plans/<planId>/` - Plan worktrees, beads, debug logs
  - `standalone-headless/<agentId>/` - Standalone headless agent worktrees
  - `cron-jobs/<id>.json` - Cron job definitions (`src/main/cron-job-manager.ts`)
  - `hooks/` - Shell hook scripts for Claude integration
  - `debug-YYYY-MM-DD.log` - Rolling debug logs (`src/main/logger.ts`)
  - `crash-logs/` - Crash reports (`src/main/crash-logger.ts`)
- Atomic file writes via write-to-temp-then-rename pattern (`src/main/config.ts`: `writeConfigAtomic`)

**Caching:**
- In-memory caches for settings, plans, cron jobs, debug settings
- Docker registry digest cache (cleared on pull)
- Go build/module cache shared across agents per-repo (optional Docker setting)

## Authentication & Identity

**Claude OAuth:**
- OAuth token for headless Claude Code agents
- Obtained via `claude setup-token` interactive flow (`src/main/oauth-setup.ts`)
- Stored in `~/.bismarck/config.json` (encrypted at rest by config module)
- Token format: `sk-ant-oat01-*`
- Passed to Docker containers as `ANTHROPIC_AUTH_TOKEN` environment variable

**GitHub Token:**
- Required for PR operations and headless agent git access
- Detection sources: `GITHUB_TOKEN` env, `GH_TOKEN` env, `gh auth token` CLI (`src/main/setup-wizard.ts`)
- Stored in `~/.bismarck/settings.json`
- Scope validation: checks for `repo`, `read:org` scopes (`src/main/settings-manager.ts`)
- Never enters Docker containers directly; proxied via tool proxy

## Monitoring & Observability

**Error Tracking:**
- Custom crash logger (`src/main/crash-logger.ts`)
- Crash logs written to `~/.bismarck/crash-logs/`
- Handles both `uncaughtException` and `unhandledRejection`
- Renderer crashes forwarded to main process via IPC

**Logs:**
- Structured logging with categories: plan, task, worktree, agent, git, bd, docker, proxy (`src/main/logger.ts`)
- Global debug log: `~/.bismarck/debug-YYYY-MM-DD.log` (date-based rolling, 7-day cleanup)
- Plan-specific logs: `~/.bismarck/plans/<planId>/debug.log`
- Dev-mode console logging via `devLog()` (`src/main/dev-log.ts`)
- Startup benchmark timing (`src/main/startup-benchmark.ts`)

## CI/CD & Deployment

**Hosting:**
- GitHub Releases (DMG distribution for macOS arm64)
- Docker Hub (`bismarckapp/bismarck-agent` images)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/`)
  - `ci.yml` - PR checks: typecheck + unit tests (ubuntu), CDP integration tests with xvfb (ubuntu)
  - `release.yml` - Tag-triggered: build + package DMG on `macos-14` (Apple Silicon), create GitHub Release with SHA-256 checksum
  - `docker-image.yml` - Tag-triggered: build + push Docker image to Docker Hub (multi-arch via QEMU/Buildx)

**Install:**
- `scripts/install.sh` - One-line curl installer for local dev
- Production: `curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash`

## IPC & Messaging Patterns

**Electron IPC (main <-> renderer):**
- `ipcMain.handle` / `ipcRenderer.invoke` - Request/response pattern for all operations (~150+ handlers in `src/main/main.ts`)
- `mainWindow.webContents.send` / `ipcRenderer.on` - Push events from main to renderer (terminal data, plan updates, headless agent events, state changes)
- Preload script: `src/main/preload.ts` - Exposes `window.electronAPI` via `contextBridge`
- Context isolation enabled, node integration disabled

**Unix Socket Server:**
- Per-workspace Unix domain sockets in `/tmp/bm/<instanceId>/` (`src/main/socket-server.ts`)
- Claude Code hooks communicate agent state changes (stop events, input required) back to Bismarck
- Socket paths shortened to avoid macOS 104-char limit

**Tool Proxy (HTTP):**
- Local HTTP server on port 9847-9857 (`src/main/tool-proxy.ts`)
- Proxies `gh`, `bd`, `git`, `bb` commands from Docker containers to host
- Token-authenticated (bearer token passed to containers)
- Security: tokens never enter containers; host executes commands with full credentials
- Docker containers use shell wrapper scripts (`docker/*-proxy-wrapper.sh`) that `curl` the proxy

**Claude Headless Stream:**
- NDJSON (newline-delimited JSON) stream parser (`src/main/stream-parser.ts`)
- Event types: init, message, tool_use, tool_result, result
- Used for real-time agent activity monitoring in headless mode

## Docker Integration

**Container Management:**
- `src/main/docker-sandbox.ts` - Full lifecycle: create, run, stop, cleanup containers
- Base image: `bismarckapp/bismarck-agent:<version>` (Node 20 Bookworm + Claude CLI + Go + Bazel + Playwright)
- Mock image: `bismarck-agent-mock:test` for development testing
- Resource limits configurable: CPU, memory, GOMAXPROCS
- Mounts: workspace directory, plan directory, Claude config, SSH agent socket, Docker socket (optional), shared build cache (optional)
- Environment auto-detection for Docker Desktop host networking (`host.docker.internal`)

**Container Dockerfile (`docker/Dockerfile`):**
- Based on `node:20-bookworm`
- Includes: curl, jq, git, Python 3, Go 1.22, Bazelisk, Playwright Chromium, Docker CLI
- Claude Code CLI installed globally via npm
- Proxy wrapper scripts for gh, bd, git, bb
- Runs as non-root `agent` user
- SSH configured for GitHub access via forwarded agent

## Environment Configuration

**Required env vars (runtime):**
- None strictly required for basic operation
- `ANTHROPIC_AUTH_TOKEN` - Passed to Docker containers for Claude headless mode (derived from stored OAuth token)
- `TOOL_PROXY_URL` - Set in Docker containers to `http://host.docker.internal:9847`
- `TOOL_PROXY_TOKEN` - Bearer token for tool proxy authentication
- `NODE_ENV` - `development` enables dev features (mock agents, debug console, `.bismarck-dev` config dir)

**Optional env vars:**
- `GITHUB_TOKEN` / `GH_TOKEN` - GitHub authentication (auto-detected during setup)
- `VITE_PORT` - Override Vite dev server port (default 5173)

**Secrets location:**
- Claude OAuth token: `~/.bismarck/config.json`
- GitHub token: `~/.bismarck/settings.json`
- Tool proxy bearer token: generated in-memory per session (`src/main/tool-proxy.ts`)

## Webhooks & Callbacks

**Incoming:**
- Unix socket server receives stop events from Claude Code hooks (`src/main/socket-server.ts`)
- Tool proxy HTTP server receives proxied CLI requests from Docker containers (`src/main/tool-proxy.ts`)

**Outgoing:**
- None (no outbound webhooks)

## Cron Job Automations

**Scheduler:**
- Built-in cron scheduler with 5-field cron expression support (`src/main/cron-scheduler.ts`)
- Supports workflow graphs with node types: headless-agent, ralph-loop, shell-command (`src/shared/cron-types.ts`)
- Jobs persisted to `~/.bismarck/cron-jobs/<id>.json` (`src/main/cron-job-manager.ts`)
- Runs stored per-job with node-level execution results

---

*Integration audit: 2026-02-15*
