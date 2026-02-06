# Diff View CDP Tests

Automated visual tests for the diff view feature using Chrome DevTools Protocol.

## Test Script

- **File**: `scripts/test/diff-view-test.js`
- **Purpose**: Validates diff overlay functionality through UI automation

## Test Coverage

The test suite validates:

1. **Diff Overlay**
   - Opens via Cmd+D keyboard shortcut
   - Displays file list with changed files
   - Shows addition/deletion counts per file
   - Closes via Escape key or close button

2. **File Viewing**
   - CodeMirror renders diff with syntax highlighting
   - Switching between files updates content
   - File selection persists correctly

3. **View Modes**
   - Toggle between unified and split view
   - Cmd+Shift+S keyboard shortcut
   - View mode buttons work correctly

4. **Keyboard Shortcuts**
   - Cmd+D: Toggle diff overlay
   - Escape: Close overlay
   - Cmd+Shift+S: Toggle view mode
   - Arrow Up/Down: Navigate file list
   - R: Refresh diff data

5. **Edge Cases**
   - "No changes" state displays correctly
   - Refresh button reloads file list
   - Empty workspace handling

## Running the Tests

### Prerequisites

The app must be running with CDP enabled:

```bash
npm run dev:cdp:wait
```

Or in headless mode (Docker):

```bash
npm run build
xvfb-run -a ./node_modules/.bin/electron --remote-debugging-port=9222 . &
sleep 8
node scripts/test/cdp-server.js &
sleep 2
```

### Execute Tests

```bash
# Run tests
node scripts/test/diff-view-test.js

# Run with screenshots (saves to test-screenshots/diff-view/)
node scripts/test/diff-view-test.js --screenshots
```

## Test Results

Current status: **9/14 tests passing**

### Passing Tests
- ✅ Open diff overlay via Cmd+D
- ✅ Toggle between unified and split view modes
- ✅ Close overlay via button
- ✅ Close overlay via Escape key
- ✅ Cmd+Shift+S toggles view mode
- ✅ R key refreshes diff data
- ✅ No changes state shows correct message
- ✅ Setup and cleanup helpers

### Known Limitations
- File list interaction tests require specific test file setup
- Tests currently use /workspace directory (bismarck repo itself)
- Some tests depend on git state of the workspace

## Implementation Notes

The tests use:
- **CDP Helper** (`cdp-helper.js`): WebSocket connection to Electron
- **CDP Server** (`cdp-server.js`): HTTP endpoints for fast interactions
- **Screenshots**: Optional visual verification at key points

Test patterns follow `tutorial-test.js` structure for consistency.
