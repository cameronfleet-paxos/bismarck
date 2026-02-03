# Tutorial CDP Integration Tests

This document describes the CDP (Chrome DevTools Protocol) integration tests for Bismarck's tutorial feature.

## Overview

The tutorial integration tests verify that:
- The tutorial can be started and restarted
- Users can navigate forward and backward through tutorial steps
- The tutorial overlay and tooltips are displayed correctly
- Tutorial highlights the correct UI elements
- Users can skip the tutorial
- Users can complete the tutorial

## Prerequisites

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the application:**
   ```bash
   npm run build
   ```

## Running the Tests

### Option 1: Manual Two-Step Process

1. **Start the app with CDP enabled** (in one terminal):
   ```bash
   npm run test:start
   ```

2. **Run the tutorial tests** (in another terminal):
   ```bash
   npm run test:tutorial
   ```

3. **Run with screenshots** (saves screenshots for each test step):
   ```bash
   npm run test:tutorial:screenshots
   ```

### Option 2: Using the CDP Server

For faster test execution, use the CDP server:

1. **Start app and CDP server** (in one terminal):
   ```bash
   npm run dev:cdp:clean
   ```

2. **Run the tests** (in another terminal):
   ```bash
   npm run test:tutorial
   ```

## Test Suite

The test suite includes 10 tests:

1. **Tutorial can be started** - Verifies the tutorial can be initiated
2. **Tutorial shows welcome step** - Checks the first step is displayed correctly
3. **Can navigate to next step** - Tests forward navigation
4. **Can navigate to previous step** - Tests backward navigation
5. **Tutorial overlay is visible** - Verifies UI elements are rendered
6. **Can navigate through all steps** - Tests complete step progression
7. **Tutorial highlights correct elements** - Verifies spotlight highlighting
8. **Can skip tutorial** - Tests the skip functionality
9. **Can restart tutorial after skip** - Verifies tutorial can be restarted
10. **Can complete tutorial** - Tests tutorial completion flow

## Test Output

### Success
```
═══════════════════════════════════════
  Tutorial CDP Integration Tests
═══════════════════════════════════════

✓ Connected to CDP

✓ Tutorial can be started (245ms)
✓ Tutorial shows welcome step (89ms)
✓ Can navigate to next step (156ms)
✓ Can navigate to previous step (134ms)
✓ Tutorial overlay is visible (67ms)
✓ Can navigate through all steps (892ms)
✓ Tutorial highlights correct elements (78ms)
✓ Can skip tutorial (123ms)
✓ Can restart tutorial after skip (234ms)
✓ Can complete tutorial (687ms)

───────────────────────────────────────
Total: 10 tests
✓ Passed: 10
───────────────────────────────────────
```

### Failure
When a test fails, the output includes:
- Error message
- Stack trace (first 2 lines)
- Screenshot (if `--screenshots` flag is used)

Example:
```
✗ Can navigate to next step
  Next button not found
  at nextStep (tutorial-test.js:234)
  Screenshot saved: test-screenshots/tutorial/failure-can-navigate-to-next-step.png
```

## Screenshots

When running with `--screenshots` flag, screenshots are saved to:
```
bismarck/test-screenshots/tutorial/
```

Screenshots are captured for:
- Each major test step
- Each tutorial step (when navigating through all steps)
- Test failures (automatically)

## Implementation Details

### CDP Helper Functions

The test suite uses several helper functions:

- **`getTutorialState(cdp)`** - Retrieves current tutorial state from the DOM
- **`startTutorial(cdp)`** - Initiates the tutorial
- **`nextStep(cdp)`** - Navigates to the next step
- **`previousStep(cdp)`** - Navigates to the previous step
- **`skipTutorial(cdp)`** - Skips/dismisses the tutorial
- **`waitForTutorialState(cdp, expectedState, timeout)`** - Waits for tutorial state

### State Detection

The tests detect tutorial state by inspecting the DOM for:
- Tutorial overlay element
- Tutorial tooltip element
- Step indicator text (e.g., "1 of 7")
- Highlighted elements with `data-tutorial` attributes
- SVG spotlight mask

### Tutorial Steps

The tests verify the following tutorial steps (from `tutorial-steps.ts`):
1. `welcome` - Welcome message
2. `workspace` - Agents overview
3. `tabs` - Tabs & grid layout
4. `terminal` - Command palette
5. `attention` - Attention queue
6. `team-mode` - Plan mode (conditional on operating mode)
7. `settings` - Settings

## Troubleshooting

### CDP Connection Failed

**Error:**
```
✗ Failed to connect to CDP: CDP not available at localhost:9222
```

**Solution:**
Make sure the app is running with CDP enabled:
```bash
npm run test:start
```

### Tutorial Not Starting

**Error:**
```
✗ Tutorial can be started
  Tutorial did not start
```

**Possible causes:**
1. Tutorial has already been completed (check app state)
2. Tutorial button not found (may need to navigate to settings)
3. DOM structure changed (update test selectors)

### Element Not Found

**Error:**
```
✗ Tutorial highlights correct elements
  Tutorial does not highlight elements correctly
```

**Solution:**
1. Check that tutorial target elements have `data-tutorial` attributes
2. Verify tutorial-steps.ts matches actual DOM elements
3. Run with `--screenshots` to see current state

### Timeout Errors

**Error:**
```
Timeout waiting for tutorial state: {"isActive":true}
```

**Solution:**
1. Increase timeout value in `waitForTutorialState`
2. Check if tutorial animations are too slow
3. Verify app is responding (not frozen)

## Extending the Tests

To add new tests:

1. **Add a new test case:**
   ```javascript
   runner.test('My new test', async (cdp) => {
     // Test implementation
     const state = await getTutorialState(cdp);
     if (!state.expectedCondition) {
       throw new Error('Test failed');
     }
   });
   ```

2. **Add helper functions as needed:**
   ```javascript
   async function myHelper(cdp) {
     return await cdp.evaluate(`
       // JavaScript code to run in the app
     `);
   }
   ```

3. **Update this documentation** with the new test details.

## Related Files

- `scripts/test/tutorial-test.js` - Main test file
- `scripts/test/cdp-helper.js` - CDP helper library
- `scripts/test/cdp-server.js` - CDP HTTP server for faster testing
- `src/renderer/components/tutorial/` - Tutorial implementation
  - `TutorialProvider.tsx` - Tutorial state management
  - `TutorialOverlay.tsx` - Overlay and spotlight rendering
  - `tutorial-steps.ts` - Tutorial step definitions

## CI/CD Integration

To run these tests in CI/CD:

```bash
# Start app in background with CDP
npm run test:start &
APP_PID=$!

# Wait for app to be ready
sleep 5

# Run tests
npm run test:tutorial

# Cleanup
kill $APP_PID
```

Or use the wait script:
```bash
npm run dev:cdp:wait && npm run test:tutorial
```
