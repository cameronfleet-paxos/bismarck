# Bismarck

Electron app for managing Claude Code workspaces.

## Installation

To build and install the app to `~/Applications`:

```bash
./scripts/install.sh
```

## Releasing New Versions

Just bump version, tag, and push - GitHub Actions handles the rest:

```bash
npm version patch    # or minor/major
git push origin main --tags
```

GitHub Actions will automatically build the DMG and create the release.

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

**When making UI changes, always self-test before asking the user for feedback.** Use the testing skills to verify your changes work correctly:

1. **Start the test environment**: `/bismarck:start-test` (runs `npm run dev:cdp:wait`)
2. **Take screenshots to verify UI state**: `/bismarck:screenshot`
3. **Run interactive tests**: `/bismarck:test <scenario>`

Only ask the user/operator for input if:
- You encounter an issue you cannot diagnose from screenshots/state
- The change requires subjective feedback (design decisions, UX preferences)
- Tests pass but you need confirmation on edge cases

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

### Testing Skills (Use These!)

These skills are the primary way to test changes:

| Skill | Purpose |
|-------|---------|
| `/bismarck:start-test` | Start app with CDP enabled for testing |
| `/bismarck:screenshot` | Capture current UI state as PNG |
| `/bismarck:test <scenario>` | Run automated interaction test |

**Recommended workflow after making changes:**
```
1. /bismarck:start-test     # Start fresh test instance
2. /bismarck:screenshot     # Verify initial state
3. <interact via CDP>      # Test your changes
4. /bismarck:screenshot     # Verify final state
```

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
- Click header buttons by index: `document.querySelectorAll("header button")[2].click()` for settings (3rd button).
- The `/click` endpoint with `{"text":"..."}` works for most buttons but fails on icon-only buttons or nested elements.
- To expand plans, find the chevron button via DOM traversal: `h4.closest("div").parentElement.querySelector("svg.lucide-chevron-right")?.closest("button").click()`.

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
