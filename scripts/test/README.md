# Bismarck CDP Testing Infrastructure

Comprehensive testing tools built on Chrome DevTools Protocol (CDP) for testing the Bismarck Electron app UI.

## Prerequisites

Start the app with CDP and the test server:

```bash
npm run dev:cdp:wait
```

This starts Vite, Electron with `--remote-debugging-port=9222`, and the CDP HTTP server on port 9333.

## Test Suites

### Core Flows (`npm run test:core`)
Tests the primary happy-path UI flows: workspace view, settings page, keyboard shortcuts, headless agents, and plans panel.

### Tutorial (`npm run test:tutorial`)
Tests the interactive tutorial: start, navigate steps, skip, restart, and complete.

### Comprehensive (`npm run test:comprehensive`)
The most thorough test suite. Tests ALL CDP server endpoints and ALL major UI flows including:
- CDP endpoint validation (health, screenshot, state, eval, click, type, key, wait, ui, agents, select)
- Workspace view (agent list, tabs, terminal, selection)
- Settings page (all 13 sections navigable)
- **Cron Job Automations** (navigation, empty state, workflow editor, node types, schedule presets, save/cancel)
- Keyboard shortcuts (Cmd+K, Cmd+Shift+D, Escape)
- Command palette (open, search, cron commands)
- Plans panel, Dev console
- Error handling (invalid selectors, timeouts, bad input)
- Edge cases (rapid navigation, concurrent requests)

```bash
npm run test:comprehensive
npm run test:comprehensive:screenshots  # with screenshots
```

### Visual Regression (`npm run test:visual`)
Takes screenshots of all major UI states and compares against baselines to detect visual regressions.

```bash
npm run test:visual:update   # capture initial baselines
npm run test:visual          # compare against baselines
```

Baselines stored in `test-screenshots/baseline/`. Diffs saved to `test-screenshots/diff/`.

### Accessibility (`npm run test:accessibility`)
Verifies accessibility attributes and keyboard navigation:
- data-testid coverage on interactive elements
- Keyboard navigation (Cmd+K, Escape, Tab)
- ARIA attributes (role="dialog", aria-label, accessible names)
- Focus management (modal focus trapping, focus indicators)

### Performance (`npm run test:performance`)
Benchmarks CDP endpoints and UI interactions with performance budgets:
- CDP endpoint response times (health <50ms, state <200ms, screenshot <2s)
- UI interaction times (view switch <1s, section switch <500ms)
- Memory usage monitoring (heap growth detection)

### Full Suite (`npm run test:full`)
Runs comprehensive + tutorial + accessibility + performance tests in sequence.

## Dev Tools

### CDP Inspector (`npm run dev:inspector`)
Interactive REPL for exploring CDP endpoints in real-time.

Commands:
- `/screenshot [name]` - Take a screenshot
- `/state` - Get current app state
- `/ui` - Get structured UI snapshot
- `/agents` - List all agents
- `/eval <code>` - Evaluate JavaScript in renderer
- `/click <selector|text>` - Click an element
- `/testids` - List all data-testid elements
- `/dom <selector>` - Inspect DOM element
- `/endpoints` - List all CDP endpoints
- `/help` - Show all commands

### CDP Recorder (`npm run dev:recorder`)
Records user interactions and generates executable test scripts.

Controls:
- `r` - Start recording
- `p` - Pause recording
- `s` - Take snapshot
- `k` - Record keypress
- `l` - Record click
- `g` - Generate test code
- `q` - Quit

## Test Reports

All tests generate JSON reports in `test-reports/`:
- `comprehensive-test-report.json`
- `visual-regression-report.json`
- `accessibility-test-report.json`
- `performance-test-report.json`

## Writing New Tests

Follow the pattern in `comprehensive-test.js`:

```javascript
const runner = new TestRunner('My Suite');

runner.test('My test name', async () => {
  const state = await cdp.state();
  if (state.view !== 'workspace') {
    throw new Error(`Expected workspace, got: ${state.view}`);
  }
});

return runner.run();
```

Key patterns:
- Use `cdp.state()` for view detection (faster than DOM queries)
- Use `cdp.eval()` for complex DOM inspection
- Use `cdp.click('[data-testid="..."]')` for reliable element targeting
- Use `cdp.sleep(ms)` between UI transitions
- Take screenshots on failure with `cdp.screenshot('name')`

## Troubleshooting

**CDP server not available**: Make sure `npm run dev:cdp:wait` is running.

**Tests timing out**: Increase sleep durations or wait timeouts. The app may be slow to render.

**Screenshots blank**: The Electron window may be minimized or behind other windows.

**Flaky tests**: Add retry logic or increase wait times. Some animations take variable time.

## CDP Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Server and CDP connection status |
| GET | /screenshot?path=FILE | Capture screenshot to file |
| GET | /state | Current view, tabs, agents, settings section |
| GET | /ui | Structured UI snapshot |
| GET | /agents | List all agents with status |
| GET | /toggle-dev-console | Toggle dev console |
| POST | /eval | Execute JavaScript expression |
| POST | /click | Click by selector or text |
| POST | /type | Type text into input |
| POST | /key | Press keyboard key with modifiers |
| POST | /wait | Wait for selector or condition |
| POST | /select | Select agent by name or index |
| POST | /mock-agent | Start mock headless agent |
| POST | /setup-test-env | Bypass onboarding, create test agents |
