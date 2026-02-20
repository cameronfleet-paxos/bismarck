# Bismarck

<p align="center">
  <img src="assets/icon.svg" alt="Bismarck Logo" width="128" height="128">
</p>

<p align="center">
  A desktop app for managing multiple Claude Code agents from a single dashboard.
</p>

<p align="center">
  <a href="#quick-install">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#development">Development</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#releasing">Releasing</a>
</p>

---

## Quick Install

**One-line install (pre-built DMG):**

```bash
curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash
```

This downloads the latest release DMG, mounts it, and copies the app to `~/Applications/Bismarck.app`.

You can also pin a specific version:

```bash
BISMARCK_VERSION=v0.8.6 curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash
```

**Build from source:**

```bash
git clone https://github.com/cameronfleet-paxos/bismarck.git
cd bismarck
npm install
./scripts/install.sh
```

### Let Claude Install It

Paste this into Claude Code:

> Install Bismarck: `curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash`

### Requirements

- **Node.js** 22+
- **macOS** (Apple Silicon / arm64)

## Features

- **Unified Dashboard** — Monitor and manage all your Claude Code agents from one window
- **Workspace Management** — Organize agents by project with tabbed navigation
- **Real-time Agent Monitoring** — See agent status, output, and progress as it happens
- **Integrated Terminal** — Built-in terminal emulation via xterm.js and node-pty
- **Plans & Task Tracking** — Plan complex work and break it into agent-assignable tasks using the built-in beads (bd) issue tracker
- **System Tray** — Quick access from the macOS menu bar
- **Claude Code Hooks** — Automatic hook configuration for agent notifications
- **Docker Support** — Run headless agents in isolated containers

## Configuration

Bismarck stores its data in `~/.bismarck/`:

| Path | Description |
|------|-------------|
| `settings.json` | App settings |
| `plans.json` | Plan metadata |
| `plans/<id>/` | Per-plan data and debug logs |
| `sockets/` | Unix sockets for agent communication |
| `hooks/` | Auto-generated hook scripts |

On first launch, Bismarck configures Claude Code hooks in `~/.claude/settings.json` to receive agent notifications.

## Development

### Getting Started

```bash
npm install
```

The `postinstall` hook automatically runs `electron-rebuild` to compile native modules (like `node-pty`) for Electron's Node ABI.

### Running in Dev Mode

**Recommended — start all services with one command:**

```bash
npm run dev:cdp:wait    # Start Vite + Electron + CDP server, wait until ready
```

This starts:
- **Vite dev server** on port 5173
- **Electron** with Chrome DevTools Protocol on port 9222
- **CDP HTTP server** on port 9333

**Manual startup (two terminals):**

```bash
# Terminal 1: Vite dev server
npm run dev

# Terminal 2: Electron
npm run dev:electron
```

### Other Dev Commands

```bash
npm run dev:cdp:clean   # Kill existing processes first, then start
npm run dev:check       # Check if all services are running
npm run dev:inspector   # Launch CDP inspector
npm run dev:recorder    # Launch CDP recorder
```

### Building

```bash
npm run build           # Compile main process TypeScript + Vite renderer
npm run build:main      # Main process only
npm run build:renderer  # Renderer only
npm run typecheck       # Type-check without emitting
npm run lint            # ESLint
```

### Dev Console

Press `Cmd+Shift+D` in the app to toggle the dev console for:
- Running mock headless agents
- Testing event flow without API costs
- Viewing real-time event logs

## Architecture

Bismarck is an Electron app with a React renderer:

```
src/
├── main/       # Electron main process
├── renderer/   # React frontend (Vite)
├── shared/     # Types and utilities shared between processes
└── lib/        # Shared library code
```

**Key technologies:**
- **Electron** — Desktop shell
- **React 19** — UI framework
- **Vite** — Build tool and dev server
- **TypeScript** — Type safety across the entire codebase
- **Tailwind CSS v4** — Styling
- **xterm.js** — Terminal emulation
- **node-pty** — PTY management for terminal sessions
- **Radix UI** — Accessible UI primitives
- **CodeMirror** — Code/JSON editing

## Testing

### Unit Tests

```bash
npm test              # Run all unit tests (vitest)
npm run test:unit     # Same as above
```

### Self-Testing with CDP

When making UI changes, use the CDP server to self-test:

```bash
npm run dev:cdp:wait                                          # Start everything

curl -s localhost:9333/health                                 # Check connection
curl -s "localhost:9333/screenshot?path=/tmp/bismarck.png"    # Take screenshot
curl -s localhost:9333/state                                  # Get app state
curl -s -X POST localhost:9333/click -d '{"text":"Submit"}'   # Click elements
curl -s -X POST localhost:9333/eval -d 'document.title'       # Evaluate JS
```

### Headless Testing (Docker)

For CI or headless agents without a display:

```bash
npm run build
xvfb-run -a ./node_modules/.bin/electron --remote-debugging-port=9222 . &
sleep 5
node scripts/test/cdp-server.js &
sleep 2
curl -s localhost:9333/health
```

### Comprehensive Test Suites

```bash
npm run test:core           # Core flow tests
npm run test:tutorial       # Tutorial tests
npm run test:comprehensive  # Comprehensive tests
npm run test:visual         # Visual regression
npm run test:accessibility  # Accessibility tests
npm run test:performance    # Performance tests
npm run test:full           # All of the above
```

### Debug Logs

Each plan has a debug log at `~/.bismarck/plans/<planId>/debug.log`:

```bash
tail -f ~/.bismarck/plans/<planId>/debug.log
tail -f ~/.bismarck/plans/<planId>/debug.log | grep -E "\[INFO\]|\[WARN\]|\[ERROR\]"
```

## Troubleshooting

### Native Module Errors

If you see `posix_spawnp failed` or similar errors:

```bash
npm run rebuild         # Rebuild native modules for Electron
npm run rebuild:force   # Force rebuild (clears cache first)
npm run check-native    # Verify native modules are correct
```

This happens because `npm install` compiles native modules for your system Node.js, but Electron uses a different ABI. The `postinstall` hook handles this automatically, but a manual rebuild may be needed after switching Node or Electron versions.

## Releasing

Releases are driven by annotated git tags. GitHub Actions builds the DMG and creates the release automatically.

```bash
# 1. Bump version
npm version minor --no-git-tag-version

# 2. Commit
git add package.json package-lock.json
git commit -m "v0.9.0"

# 3. Create annotated tag with release notes
git tag -a v0.9.0 -m "$(cat <<'EOF'
v0.9.0

## What's New

- Feature description
- Bug fix description
EOF
)"

# 4. Push
git push origin main
git push origin v0.9.0
```

The tag message body (after the first line) becomes the GitHub release notes.

## License

ISC
