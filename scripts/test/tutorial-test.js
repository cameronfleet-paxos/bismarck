#!/usr/bin/env node
/**
 * CDP Integration Tests for Tutorial
 *
 * Tests the tutorial flow using Chrome DevTools Protocol (CDP).
 * Requires the app to be running with --remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/test/tutorial-test.js
 *   node scripts/test/tutorial-test.js --screenshots
 *
 * Prerequisites:
 *   npm run test:start  (in one terminal)
 *   node scripts/test/tutorial-test.js  (in another terminal)
 */

const { CDPHelper } = require('./cdp-helper');
const path = require('path');
const fs = require('fs');

// Test configuration
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/tutorial');
const SCREENSHOT_MODE = process.argv.includes('--screenshots');

// Tutorial step IDs from tutorial-steps.ts
const TUTORIAL_STEPS = [
  'welcome',
  'workspace',
  'tabs',
  'terminal',
  'attention',
  'team-mode',
  'settings'
];

/**
 * Test runner with timing and error handling
 */
class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.cdp = null;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    console.log('\n═══════════════════════════════════════');
    console.log('  Tutorial CDP Integration Tests');
    console.log('═══════════════════════════════════════\n');

    // Initialize CDP connection
    this.cdp = new CDPHelper(9222);
    try {
      await this.cdp.connect();
      console.log('✓ Connected to CDP\n');
    } catch (error) {
      console.error('✗ Failed to connect to CDP:', error.message);
      console.error('\nMake sure the app is running with:');
      console.error('  npm run test:start\n');
      process.exit(1);
    }

    // Setup screenshot directory if needed
    if (SCREENSHOT_MODE && !fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    // Run all tests
    for (const { name, fn } of this.tests) {
      try {
        const start = Date.now();
        await fn(this.cdp);
        const duration = Date.now() - start;
        console.log(`✓ ${name} (${duration}ms)`);
        this.passed++;
      } catch (error) {
        console.error(`✗ ${name}`);
        console.error(`  ${error.message}`);
        if (error.stack) {
          console.error(`  ${error.stack.split('\n').slice(1, 3).join('\n  ')}`);
        }
        this.failed++;

        // Take screenshot on failure
        if (SCREENSHOT_MODE) {
          try {
            const screenshotPath = path.join(
              SCREENSHOT_DIR,
              `failure-${name.replace(/\s+/g, '-').toLowerCase()}.png`
            );
            await this.cdp.screenshot(screenshotPath);
            console.error(`  Screenshot saved: ${screenshotPath}`);
          } catch (e) {
            console.error(`  Failed to capture screenshot: ${e.message}`);
          }
        }
      }
    }

    // Cleanup
    this.cdp.disconnect();

    // Summary
    console.log('\n───────────────────────────────────────');
    console.log(`Total: ${this.tests.length} tests`);
    console.log(`✓ Passed: ${this.passed}`);
    if (this.failed > 0) {
      console.log(`✗ Failed: ${this.failed}`);
    }
    console.log('───────────────────────────────────────\n');

    // Exit with appropriate code
    process.exit(this.failed > 0 ? 1 : 0);
  }
}

/**
 * Helper function to take test screenshot
 */
async function screenshot(cdp, name) {
  if (SCREENSHOT_MODE) {
    const screenshotPath = path.join(
      SCREENSHOT_DIR,
      `${name.replace(/\s+/g, '-').toLowerCase()}.png`
    );
    await cdp.screenshot(screenshotPath);
  }
}

/**
 * Helper to wait for tutorial to be in specific state
 */
async function waitForTutorialState(cdp, expectedState, timeout = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const state = await getTutorialState(cdp);
    if (state.isActive === expectedState.isActive) {
      if (expectedState.currentStep === undefined || state.currentStep === expectedState.currentStep) {
        return state;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for tutorial state: ${JSON.stringify(expectedState)}`);
}

/**
 * Get current tutorial state from the app
 */
async function getTutorialState(cdp) {
  return await cdp.evaluate(`
    (function() {
      // Access React state via window.__TUTORIAL_STATE__ or DOM inspection
      const overlay = document.querySelector('[class*="tutorial"]');
      const tooltip = document.querySelector('[data-testid="tutorial-tooltip"]') ||
                     document.querySelector('.tutorial-tooltip');
      const stepText = tooltip?.querySelector('h3, [class*="title"]')?.textContent;

      // Check if tutorial is active by looking for the overlay
      const isActive = !!overlay || !!tooltip;

      // Try to extract current step from DOM
      let currentStep = null;
      let currentStepIndex = -1;
      let totalSteps = 0;

      if (tooltip) {
        // Look for step indicator text like "1 of 7"
        const stepIndicator = tooltip.textContent.match(/(\\d+)\\s+of\\s+(\\d+)/);
        if (stepIndicator) {
          currentStepIndex = parseInt(stepIndicator[1]) - 1;
          totalSteps = parseInt(stepIndicator[2]);
        }

        // Try to identify step by checking highlighted element's data-tutorial attribute
        const spotlightMask = document.querySelector('mask[id*="spotlight"]');
        if (spotlightMask) {
          const allElements = document.querySelectorAll('[data-tutorial]');
          for (const el of allElements) {
            const rect = el.getBoundingClientRect();
            // Check if element is likely highlighted (simplified check)
            if (rect.width > 0 && rect.height > 0) {
              currentStep = el.getAttribute('data-tutorial');
              break;
            }
          }
        }
      }

      return {
        isActive,
        currentStep,
        currentStepIndex,
        totalSteps,
        stepTitle: stepText,
        hasOverlay: !!overlay,
        hasTooltip: !!tooltip
      };
    })()
  `);
}

/**
 * Start the tutorial
 */
async function startTutorial(cdp) {
  // Look for settings button or tutorial start button
  const started = await cdp.evaluate(`
    (function() {
      // Try various ways to start the tutorial
      // 1. Look for "Start Tutorial" button
      const buttons = [...document.querySelectorAll('button')];
      let startButton = buttons.find(b =>
        b.textContent.toLowerCase().includes('start tutorial') ||
        b.textContent.toLowerCase().includes('restart tutorial')
      );

      if (startButton) {
        startButton.click();
        return true;
      }

      // 2. Try calling via window API if exposed
      if (window.__startTutorial) {
        window.__startTutorial();
        return true;
      }

      // 3. Navigate to settings and click tutorial option
      const settingsButton = buttons.find(b =>
        b.textContent.toLowerCase().includes('settings') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('settings')
      );

      if (settingsButton) {
        settingsButton.click();
        // Will need to click tutorial button after navigation
        return 'navigate-to-settings';
      }

      return false;
    })()
  `);

  if (started === 'navigate-to-settings') {
    // Wait for settings page to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click tutorial button in settings
    await cdp.evaluate(`
      (function() {
        const buttons = [...document.querySelectorAll('button')];
        const tutorialButton = buttons.find(b =>
          b.textContent.toLowerCase().includes('tutorial') ||
          b.textContent.toLowerCase().includes('tour')
        );
        if (tutorialButton) {
          tutorialButton.click();
          return true;
        }
        return false;
      })()
    `);
  }

  // Wait for tutorial to start
  await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Navigate to next tutorial step
 */
async function nextStep(cdp) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const nextButton = buttons.find(b =>
        b.textContent.toLowerCase().includes('next') ||
        b.textContent.toLowerCase().includes('continue')
      );
      if (nextButton) {
        nextButton.click();
        return true;
      }
      throw new Error('Next button not found');
    })()
  `);

  // Wait for transition
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Navigate to previous tutorial step
 */
async function previousStep(cdp) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const prevButton = buttons.find(b =>
        b.textContent.toLowerCase().includes('back') ||
        b.textContent.toLowerCase().includes('previous')
      );
      if (prevButton) {
        prevButton.click();
        return true;
      }
      throw new Error('Previous button not found');
    })()
  `);

  // Wait for transition
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Skip the tutorial
 */
async function skipTutorial(cdp) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const skipButton = buttons.find(b =>
        b.textContent.toLowerCase().includes('skip') ||
        b.textContent.toLowerCase().includes('dismiss') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('close')
      );
      if (skipButton) {
        skipButton.click();
        return true;
      }
      throw new Error('Skip button not found');
    })()
  `);

  // Wait for tutorial to close
  await new Promise(resolve => setTimeout(resolve, 300));
}

// ═══════════════════════════════════════
//  Test Suite
// ═══════════════════════════════════════

const runner = new TestRunner();

// Test 1: Tutorial can be started
runner.test('Tutorial can be started', async (cdp) => {
  await startTutorial(cdp);

  const state = await getTutorialState(cdp);
  if (!state.isActive) {
    throw new Error('Tutorial did not start');
  }

  await screenshot(cdp, 'tutorial-started');
});

// Test 2: Tutorial shows first step (welcome)
runner.test('Tutorial shows welcome step', async (cdp) => {
  const state = await getTutorialState(cdp);

  if (state.currentStepIndex !== 0) {
    throw new Error(`Expected step index 0, got ${state.currentStepIndex}`);
  }

  if (state.totalSteps < 5) {
    throw new Error(`Expected at least 5 steps, got ${state.totalSteps}`);
  }

  await screenshot(cdp, 'welcome-step');
});

// Test 3: Can navigate to next step
runner.test('Can navigate to next step', async (cdp) => {
  const beforeState = await getTutorialState(cdp);
  const initialStep = beforeState.currentStepIndex;

  await nextStep(cdp);

  const afterState = await getTutorialState(cdp);
  if (afterState.currentStepIndex !== initialStep + 1) {
    throw new Error(`Expected step ${initialStep + 1}, got ${afterState.currentStepIndex}`);
  }

  await screenshot(cdp, 'next-step');
});

// Test 4: Can navigate to previous step
runner.test('Can navigate to previous step', async (cdp) => {
  const beforeState = await getTutorialState(cdp);
  const initialStep = beforeState.currentStepIndex;

  await previousStep(cdp);

  const afterState = await getTutorialState(cdp);
  if (afterState.currentStepIndex !== initialStep - 1) {
    throw new Error(`Expected step ${initialStep - 1}, got ${afterState.currentStepIndex}`);
  }

  await screenshot(cdp, 'previous-step');
});

// Test 5: Tutorial overlay is visible
runner.test('Tutorial overlay is visible', async (cdp) => {
  const state = await getTutorialState(cdp);

  if (!state.hasOverlay) {
    throw new Error('Tutorial overlay not found');
  }

  if (!state.hasTooltip) {
    throw new Error('Tutorial tooltip not found');
  }
});

// Test 6: Can navigate through all steps
runner.test('Can navigate through all steps', async (cdp) => {
  // Go back to first step
  const state = await getTutorialState(cdp);
  for (let i = state.currentStepIndex; i > 0; i--) {
    await previousStep(cdp);
  }

  // Navigate through all steps
  const totalSteps = state.totalSteps;
  for (let i = 0; i < totalSteps - 1; i++) {
    const currentState = await getTutorialState(cdp);
    if (currentState.currentStepIndex !== i) {
      throw new Error(`Expected step ${i}, got ${currentState.currentStepIndex}`);
    }

    await screenshot(cdp, `step-${i}`);
    await nextStep(cdp);
  }

  // Verify we're at the last step
  const finalState = await getTutorialState(cdp);
  if (finalState.currentStepIndex !== totalSteps - 1) {
    throw new Error(`Expected final step ${totalSteps - 1}, got ${finalState.currentStepIndex}`);
  }
});

// Test 7: Tutorial highlights correct elements
runner.test('Tutorial highlights correct elements', async (cdp) => {
  const hasHighlight = await cdp.evaluate(`
    (function() {
      // Check for spotlight mask
      const mask = document.querySelector('mask[id*="spotlight"]');
      if (!mask) return false;

      // Check for highlighted border
      const highlight = document.querySelector('rect[stroke*="59, 130, 246"]') ||
                       document.querySelector('rect[stroke*="rgba"]');
      if (!highlight) return false;

      // Verify there's a data-tutorial element
      const tutorialElements = document.querySelectorAll('[data-tutorial]');
      return tutorialElements.length > 0;
    })()
  `);

  if (!hasHighlight) {
    throw new Error('Tutorial does not highlight elements correctly');
  }
});

// Test 8: Can skip tutorial
runner.test('Can skip tutorial', async (cdp) => {
  await skipTutorial(cdp);

  const state = await getTutorialState(cdp);
  if (state.isActive) {
    throw new Error('Tutorial is still active after skip');
  }

  await screenshot(cdp, 'tutorial-skipped');
});

// Test 9: Can restart tutorial after skip
runner.test('Can restart tutorial after skip', async (cdp) => {
  await startTutorial(cdp);

  const state = await getTutorialState(cdp);
  if (!state.isActive) {
    throw new Error('Tutorial did not restart');
  }

  if (state.currentStepIndex !== 0) {
    throw new Error('Tutorial did not start from first step');
  }

  await screenshot(cdp, 'tutorial-restarted');
});

// Test 10: Can complete tutorial
runner.test('Can complete tutorial', async (cdp) => {
  const state = await getTutorialState(cdp);
  const totalSteps = state.totalSteps;

  // Navigate to last step
  for (let i = state.currentStepIndex; i < totalSteps - 1; i++) {
    await nextStep(cdp);
  }

  // Complete tutorial
  await nextStep(cdp);

  // Verify tutorial is no longer active
  await new Promise(resolve => setTimeout(resolve, 500));
  const finalState = await getTutorialState(cdp);
  if (finalState.isActive) {
    throw new Error('Tutorial is still active after completion');
  }

  await screenshot(cdp, 'tutorial-completed');
});

// Run all tests
runner.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
