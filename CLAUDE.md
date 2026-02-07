# Bismarck

Electron app for managing Claude Code workspaces.

## Installation

To build and install the app to `~/Applications`:

```bash
./scripts/install.sh
```

## Releasing New Versions

Release notes are pulled from **annotated tag messages**. The workflow:

1. **Update version** in package.json (manually or via `npm version --no-git-tag-version`)
2. **Commit** the version bump
3. **Create annotated tag** with release notes in the message
4. **Push** commit and tag - GitHub Actions builds DMG and creates release

```bash
# Example: minor release (0.3.x -> 0.4.0)
npm version minor --no-git-tag-version
git add package.json package-lock.json
git commit --no-gpg-sign -m "v0.4.0"

# Create annotated tag with release notes (these become the GitHub release body)
git tag -a v0.4.0 -m "$(cat <<'EOF'
v0.4.0

## What's New

- Feature 1 description
- Feature 2 description
- Bug fix description
EOF
)"

git push origin main
git push origin v0.4.0
```

**Important**: The tag message format matters:
- First line: version (e.g., `v0.4.0`) - this gets stripped
- Rest: release notes in markdown - this becomes the release body

GitHub Actions will automatically add install instructions and changelog link.

## Development

### Starting the dev server

```bash
npm run dev:cdp:wait   # Start all services and wait until ready (recommended)
npm run dev:cdp:clean  # Kill existing processes first, then start
npm run dev:check      # Check if all services are running
```

This starts:
- **Vite dev server** (port 5173)
- **Electron with CDP** (port 9222)
- **CDP HTTP server** (port 9333)

These commands are excluded from sandbox mode in `.claude/settings.local.json` since Electron requires macOS bootstrap permissions.

### Building

```bash
npm run build
```

This compiles both the main process TypeScript and the Vite renderer.

## Automated Testing

### Self-Testing Workflow

**When making UI changes, always self-test before asking the user for feedback.**

**On macOS (with display):**
```bash
npm run dev:cdp:wait   # Start all services and wait until ready
```

**In Docker (headless):** See [Headless Agent Testing](#headless-agent-testing-docker) below.

Once CDP is running, use curl to interact:
```bash
curl -s localhost:9333/health              # Check connection
curl -s "localhost:9333/screenshot?path=/tmp/claude/test.png"  # Screenshot
curl -s localhost:9333/state               # Get app state
```

Only ask the user/operator for input if:
- You encounter an issue you cannot diagnose from screenshots/state
- The change requires subjective feedback (design decisions, UX preferences)
- Tests pass but you need confirmation on edge cases

### Headless Agent Testing (Docker)

**If you're a headless agent running in Docker without a display**, you cannot use `npm run dev:cdp:wait` directly because Electron requires a display server. Use xvfb (X Virtual Framebuffer) instead:

#### Step 1: Build the app
```bash
npm run build
```

#### Step 2: Start Electron with xvfb
```bash
# xvfb-run creates a virtual display for Electron
xvfb-run -a ./node_modules/.bin/electron --remote-debugging-port=9222 . > /tmp/electron.log 2>&1 &

# Wait for Electron to start
sleep 5
```

#### Step 3: Start the CDP server
```bash
node scripts/test/cdp-server.js > /tmp/cdp-server.log 2>&1 &
sleep 2
```

#### Step 4: Verify connection
```bash
curl -s localhost:9333/health
# Expected: {"server":"running","cdp":"connected","port":9333}
```

#### Step 4.5: Bypass Onboarding (Recommended)

Before taking screenshots or interacting with the UI, bypass the setup wizard by creating a test agent:

```bash
# Create a test agent pointing to current working directory
curl -s -X POST localhost:9333/setup-test-env

# Or with a custom agent configuration
curl -s -X POST localhost:9333/setup-test-env -H "Content-Type: application/json" \
  -d '{"agents":[{"path":"/workspace","name":"my-agent"}]}'
```

This creates a minimal agent configuration so the app opens directly to the workspace view instead of showing the onboarding wizard. The `/state` endpoint should then return `"view":"workspace"`.

#### Step 5: Test your changes
```bash
# Take screenshot (save to /tmp/claude/ which is writable)
curl -s "localhost:9333/screenshot?path=/tmp/claude/bismarck.png"

# Read the screenshot to see the UI
# Use the Read tool on /tmp/claude/bismarck.png

# Get app state programmatically
curl -s localhost:9333/state

# Click buttons
curl -s -X POST localhost:9333/click -d '{"text":"Skip Setup"}'

# Evaluate JS to verify your changes
curl -s -X POST localhost:9333/eval -d 'document.querySelector("[data-state]")?.dataset.state'
```

#### Step 6: Clean up when done
```bash
pkill -f "electron\|cdp-server" 2>/dev/null
```

**Common issues:**
- `electron: not found` → Use `./node_modules/.bin/electron` not just `electron`
- Screenshots blank → Wait longer after starting Electron (increase sleep)
- CDP disconnected → Check `/tmp/electron.log` for errors

### Running with CDP (Chrome DevTools Protocol)

The easiest way to start with CDP is the unified command:

```bash
npm run dev:cdp:wait   # Start all services and wait until ready (recommended)
npm run dev:cdp:clean  # Start all services with cleanup (stays running)
npm run dev:check      # Verify services are running
```

This starts:
- Vite dev server (port 5173)
- Electron with CDP (port 9222)
- CDP HTTP server (port 9333)

CDP enables:
- Taking screenshots: `Page.captureScreenshot`
- Executing JS: `Runtime.evaluate`
- Simulating user input via KeyboardEvent dispatch

### CDP Connection

1. Get WebSocket URL: `curl http://localhost:9222/json`
2. Find the "Bismarck" page target
3. Connect to `webSocketDebuggerUrl`

### Test Scripts

Located in `scripts/test/`:

- `dev-with-cdp.js` - **Unified startup script** - starts Vite, Electron+CDP, and CDP server
- `wait-for-ready.js` - Polls health endpoints until all services are ready
- `cdp-server.js` - HTTP server for fast CDP interactions (started automatically by dev-with-cdp.js)
- `cdp-helper.js` - Shared CDP connection module (used by cdp-server.js)

### CDP Server

The CDP server maintains a persistent WebSocket connection, making interactions ~50ms instead of ~2s per action.

**The CDP server is started automatically by `npm run dev:cdp:clean`.** You don't need to start it manually.

**Use curl to interact:**
```bash
# Health check
curl -s localhost:9333/health

# Take screenshot
curl -s "localhost:9333/screenshot?path=/tmp/claude/bismarck-screenshot.png"

# Get app state (view detection: workspace/settings, active tab, plans panel status)
curl -s localhost:9333/state

# Evaluate JavaScript
curl -s -X POST localhost:9333/eval -d 'document.title'

# Click element
curl -s -X POST localhost:9333/click -d '{"selector":"button"}'
curl -s -X POST localhost:9333/click -d '{"text":"Submit"}'

# Type into input
curl -s -X POST localhost:9333/type -d '{"selector":"input","text":"hello"}'

# Press key with modifiers
curl -s -X POST localhost:9333/key -d '{"key":"d","meta":true,"shift":true}'

# Toggle dev console
curl -s localhost:9333/toggle-dev-console

# Start mock agent
curl -s -X POST localhost:9333/mock-agent -d '{"taskId":"test-1"}'
```

### UI Interaction Tips

- Use `/state` to quickly detect current view (`workspace`/`settings`) and active sections without screenshots.
- Use `data-testid` attributes for reliable element selection:
  - Header: `[data-testid="app-header"]`
  - Add agent button: `[data-testid="add-agent-button"]`
  - Plans button: `[data-testid="plans-button"]`
  - Settings button: `[data-testid="settings-button"]`
  - Agent cards: `[data-testid^="agent-card-"]` (prefix selector for all cards)
  - Agent card names: `[data-testid^="agent-card-name-"]`
  - Tab bar: `[data-testid="tab-bar"]`
  - Tab items: `[data-testid^="tab-item-"]`
  - Settings sections: `[data-testid="settings-section-general"]`, `[data-testid="settings-section-docker"]`, etc.
  - Back to workspace: `[data-testid="back-to-workspace-button"]`
  - Dev console: `[data-testid="dev-console"]`
  - Plan sidebar: `[data-testid="plan-sidebar"]`
  - Tutorial tooltip: `[data-testid="tutorial-tooltip"]`
- The `/click` endpoint with `{"text":"..."}` works for most buttons but fails on icon-only buttons or nested elements. Prefer using `{"selector":"[data-testid='...']"}` for reliability.

### Dev Console (Development Only)

Press `Cmd+Shift+D` to toggle the dev console for:
- Running mock headless agents
- Testing event flow without API costs
- Viewing real-time event logs

### Monitoring Debug Logs

Each plan has a debug log at `~/.bismarck/plans/<planId>/debug.log`. To monitor a running plan:

```bash
# Find the active plan ID
cat ~/.bismarck/plans.json | jq '.[] | select(.status == "in_progress") | .id'

# Tail the debug log (replace <planId> with actual ID)
tail -f ~/.bismarck/plans/<planId>/debug.log

# Filter for important events only
tail -f ~/.bismarck/plans/<planId>/debug.log | grep -E "\[INFO\]|\[WARN\]|\[ERROR\]"

# Filter for worktree/task activity
tail -f ~/.bismarck/plans/<planId>/debug.log | grep -E "(worktree|task|agent)"
```

You can also check task status directly:
```bash
cd ~/.bismarck/plans/<planId>
bd --sandbox list --json | jq '.[] | {id, status, labels}'
```

## Troubleshooting Native Modules

Native modules like `node-pty` must be compiled for Electron's Node ABI version, not the system Node.js version.

### Automatic Rebuild

After `npm install`, the `postinstall` hook automatically runs `electron-rebuild` to compile native modules for Electron. This happens automatically - no manual intervention needed.

### Manual Rebuild Commands

If you encounter `posix_spawnp failed` or similar errors when starting in dev mode:

```bash
npm run rebuild          # Rebuild native modules for Electron
npm run rebuild:force    # Force rebuild (clears cache first)
npm run check-native     # Verify native modules are correctly built
```

### Why This Happens

- `npm install` compiles native modules for your system's Node.js version
- `npm run dev:electron` runs in Electron's Node.js runtime (different ABI)
- The `postinstall` hook fixes this automatically by rebuilding for Electron

**Note:** Production builds (`npm run dist`) are not affected - `electron-builder` automatically rebuilds native modules during packaging.

### Useful CDP Patterns

```javascript
// Execute JS in renderer
await send('Runtime.evaluate', {
  expression: 'window.electronAPI.devStartMockAgent("test-1")',
  awaitPromise: true,
  returnByValue: true
});

// Simulate keyboard shortcut
await send('Runtime.evaluate', {
  expression: `window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'd', metaKey: true, shiftKey: true, bubbles: true
  }))`
});

// Take screenshot
const { data } = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('screenshot.png', Buffer.from(data, 'base64'));
```
