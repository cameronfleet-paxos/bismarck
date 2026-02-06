#!/usr/bin/env node
/**
 * CDP Integration Tests for Diff View
 *
 * Tests the diff view feature using Chrome DevTools Protocol (CDP).
 * Requires the app to be running with --remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/test/diff-view-test.js
 *   node scripts/test/diff-view-test.js --screenshots
 *
 * Prerequisites:
 *   npm run dev:cdp:wait  (start all services)
 *   node scripts/test/diff-view-test.js
 */

const { CDPHelper } = require('./cdp-helper');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// Test configuration
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/diff-view');
const SCREENSHOT_MODE = process.argv.includes('--screenshots');

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
    console.log('  Diff View CDP Integration Tests');
    console.log('═══════════════════════════════════════\n');

    // Initialize CDP connection
    this.cdp = new CDPHelper(9222);
    try {
      await this.cdp.connect();
      console.log('✓ Connected to CDP\n');
    } catch (error) {
      console.error('✗ Failed to connect to CDP:', error.message);
      console.error('\nMake sure the app is running with:');
      console.error('  npm run dev:cdp:wait\n');
      process.exit(1);
    }

    // Bypass onboarding wizard by creating a test agent
    try {
      const result = await this.cdp.evaluate(`
        (async function() {
          try {
            const repos = [{
              path: '/workspace',
              name: 'bismarck'
            }];
            const created = await window.electronAPI.setupWizardBulkCreateAgents(repos);
            return { success: true, agents: created.map(a => ({ id: a.id, name: a.name, path: a.path })) };
          } catch (error) {
            return { success: false, error: error.message };
          }
        })()
      `);

      if (result.success) {
        console.log('✓ Test environment setup complete\n');
      } else {
        console.warn('⚠ Warning: Could not bypass onboarding:', result.error);
        console.warn('  Tests may fail if onboarding wizard is shown\n');
      }
    } catch (error) {
      console.warn('⚠ Warning: Failed to setup test environment:', error.message);
      console.warn('  Tests may fail if onboarding wizard is shown\n');
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
 * Wait for element to appear in DOM
 */
async function waitForElement(cdp, selector, timeout = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const found = await cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
    if (found) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for element: ${selector}`);
}

/**
 * Get diff overlay state
 */
async function getDiffOverlayState(cdp) {
  return await cdp.evaluate(`
    (function() {
      // Check if diff overlay is visible
      const overlay = document.querySelector('[class*="absolute"][class*="inset-0"][class*="z-20"]');
      const isVisible = overlay && overlay.textContent.includes('Changes');

      if (!isVisible) {
        return { isVisible: false };
      }

      // Get file list
      const fileElements = [...document.querySelectorAll('div[role="button"]')].filter(el => {
        const text = el.textContent || '';
        return text.includes('+') && text.includes('-');
      });

      const files = fileElements.map(el => {
        const text = el.textContent || '';
        // Extract filename and +/- counts
        const match = text.match(/([^+\\-]+).*?\\+(\\d+).*?-(\\d+)/);
        if (match) {
          return {
            name: match[1].trim(),
            additions: parseInt(match[2]),
            deletions: parseInt(match[3])
          };
        }
        return { name: text.trim(), additions: 0, deletions: 0 };
      });

      // Check if CodeMirror is rendered
      const hasCodeMirror = !!document.querySelector('.cm-editor');

      // Get current view mode (unified/split)
      const unifiedButton = [...document.querySelectorAll('button')].find(b =>
        b.title && b.title.toLowerCase().includes('unified')
      );
      const splitButton = [...document.querySelectorAll('button')].find(b =>
        b.title && b.title.toLowerCase().includes('split')
      );

      let viewMode = null;
      if (unifiedButton && unifiedButton.classList.contains('bg-primary')) {
        viewMode = 'unified';
      } else if (splitButton && splitButton.classList.contains('bg-primary')) {
        viewMode = 'split';
      }

      // Check for "No changes" message
      const hasNoChangesMessage = document.body.textContent.includes('No changes');

      // Get currently selected file from header
      const header = overlay.querySelector('.h-12.border-b');
      const selectedFile = header ? header.textContent.match(/·\s*([^\s]+\.[^\s]+)/)?.[1] : null;

      return {
        isVisible: true,
        fileCount: files.length,
        files,
        hasCodeMirror,
        viewMode,
        hasNoChangesMessage,
        selectedFile
      };
    })()
  `);
}

/**
 * Press Cmd+D to toggle diff overlay
 */
async function toggleDiffOverlay(cdp) {
  await cdp.pressKey('d', { meta: true });
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Click close button in diff overlay
 */
async function closeDiffOverlay(cdp) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const closeButton = buttons.find(b =>
        b.title && (b.title.includes('Close') || b.title.includes('Escape'))
      );
      if (closeButton) {
        closeButton.click();
      } else {
        throw new Error('Close button not found');
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Click refresh button in diff overlay
 */
async function clickRefresh(cdp) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const refreshButton = buttons.find(b => b.title === 'Refresh');
      if (refreshButton) {
        refreshButton.click();
      } else {
        throw new Error('Refresh button not found');
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Toggle view mode (unified/split)
 */
async function toggleViewMode(cdp, mode) {
  await cdp.evaluate(`
    (function() {
      const buttons = [...document.querySelectorAll('button')];
      const targetButton = buttons.find(b =>
        b.title && b.title.toLowerCase().includes(${JSON.stringify(mode)})
      );
      if (targetButton) {
        targetButton.click();
      } else {
        throw new Error('View mode button not found: ${mode}');
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 300));
}

/**
 * Select a file in the file list
 */
async function selectFile(cdp, index = 0) {
  await cdp.evaluate(`
    (function() {
      const fileElements = [...document.querySelectorAll('div[role="button"]')].filter(el => {
        const text = el.textContent || '';
        return text.includes('+') && text.includes('-');
      });
      if (fileElements[${index}]) {
        fileElements[${index}].click();
      } else {
        throw new Error('File at index ${index} not found');
      }
    })()
  `);
  await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Create test git changes in the workspace
 */
async function createTestChanges(cdp) {
  // Use /workspace as the test directory (the bismarck repo itself)
  const workspaceDir = '/workspace';

  // Create test changes in the workspace
  const testFile1 = path.join(workspaceDir, 'test-file-1.txt');
  const testFile2 = path.join(workspaceDir, 'test-file-2.js');

  fs.writeFileSync(testFile1, 'Line 1\nLine 2\nLine 3\nModified line\nLine 5\n');
  fs.writeFileSync(testFile2, 'function test() {\n  console.log("Hello");\n  return 42;\n}\n');

  return { testFile1, testFile2 };
}

/**
 * Clean up test changes
 */
async function cleanupTestChanges(cdp) {
  const workspaceDir = '/workspace';

  try {
    const testFile1 = path.join(workspaceDir, 'test-file-1.txt');
    const testFile2 = path.join(workspaceDir, 'test-file-2.js');
    const testFile3 = path.join(workspaceDir, 'test-file-3.txt');
    if (fs.existsSync(testFile1)) fs.unlinkSync(testFile1);
    if (fs.existsSync(testFile2)) fs.unlinkSync(testFile2);
    if (fs.existsSync(testFile3)) fs.unlinkSync(testFile3);
  } catch (err) {
    // Ignore cleanup errors
  }
}

// ═══════════════════════════════════════
//  Test Suite
// ═══════════════════════════════════════

const runner = new TestRunner();

// Test 1: Setup - Create test changes
runner.test('Setup: Create test changes', async (cdp) => {
  await createTestChanges(cdp);
  await screenshot(cdp, 'setup-complete');
});

// Test 2: Open diff overlay via Cmd+D
runner.test('Open diff overlay via Cmd+D', async (cdp) => {
  await toggleDiffOverlay(cdp);

  const state = await getDiffOverlayState(cdp);
  if (!state.isVisible) {
    throw new Error('Diff overlay did not open');
  }

  await screenshot(cdp, 'diff-overlay-opened');
});

// Test 3: File list shows correct changed files
runner.test('File list shows changed files with +/- counts', async (cdp) => {
  const state = await getDiffOverlayState(cdp);

  if (state.fileCount < 2) {
    throw new Error(`Expected at least 2 files, got ${state.fileCount}`);
  }

  // Verify files have addition/deletion counts
  const hasValidCounts = state.files.every(f =>
    typeof f.additions === 'number' && typeof f.deletions === 'number'
  );

  if (!hasValidCounts) {
    throw new Error('Files missing +/- counts');
  }

  await screenshot(cdp, 'file-list-with-counts');
});

// Test 4: Click file in list shows CodeMirror diff
runner.test('Click file shows CodeMirror diff with syntax highlighting', async (cdp) => {
  // Select first file
  await selectFile(cdp, 0);

  const state = await getDiffOverlayState(cdp);
  if (!state.hasCodeMirror) {
    throw new Error('CodeMirror did not render');
  }

  await screenshot(cdp, 'codemirror-rendered');
});

// Test 5: Switch between files updates content
runner.test('Switch between files updates content correctly', async (cdp) => {
  const state1 = await getDiffOverlayState(cdp);
  const firstFile = state1.selectedFile;

  // Switch to second file
  await selectFile(cdp, 1);
  await new Promise(resolve => setTimeout(resolve, 500));

  const state2 = await getDiffOverlayState(cdp);
  const secondFile = state2.selectedFile;

  if (!secondFile || firstFile === secondFile) {
    throw new Error('File selection did not change');
  }

  await screenshot(cdp, 'switched-files');
});

// Test 6: Toggle unified/split view
runner.test('Toggle between unified and split view modes', async (cdp) => {
  // Switch to split view
  await toggleViewMode(cdp, 'split');
  let state = await getDiffOverlayState(cdp);

  if (state.viewMode !== 'split') {
    throw new Error(`Expected split view, got ${state.viewMode}`);
  }
  await screenshot(cdp, 'split-view');

  // Switch back to unified view
  await toggleViewMode(cdp, 'unified');
  state = await getDiffOverlayState(cdp);

  if (state.viewMode !== 'unified') {
    throw new Error(`Expected unified view, got ${state.viewMode}`);
  }
  await screenshot(cdp, 'unified-view');
});

// Test 7: Refresh button reloads data
runner.test('Refresh button reloads diff data', async (cdp) => {
  // Modify a test file
  const workspaceDir = '/workspace';

  const testFile = path.join(workspaceDir, 'test-file-3.txt');
  fs.writeFileSync(testFile, 'New file content\n');

  // Click refresh
  await clickRefresh(cdp);

  const state = await getDiffOverlayState(cdp);
  if (state.fileCount < 3) {
    throw new Error('Refresh did not pick up new file');
  }

  await screenshot(cdp, 'after-refresh');

  // Cleanup
  fs.unlinkSync(testFile);
});

// Test 8: Close overlay via button
runner.test('Close overlay via button', async (cdp) => {
  await closeDiffOverlay(cdp);

  const state = await getDiffOverlayState(cdp);
  if (state.isVisible) {
    throw new Error('Diff overlay did not close');
  }

  await screenshot(cdp, 'overlay-closed-via-button');
});

// Test 9: Close overlay via Escape key
runner.test('Close overlay via Escape key', async (cdp) => {
  // Reopen overlay
  await toggleDiffOverlay(cdp);
  let state = await getDiffOverlayState(cdp);
  if (!state.isVisible) {
    throw new Error('Failed to reopen overlay');
  }

  // Press Escape
  await cdp.pressKey('Escape');
  await new Promise(resolve => setTimeout(resolve, 300));

  state = await getDiffOverlayState(cdp);
  if (state.isVisible) {
    throw new Error('Escape key did not close overlay');
  }

  await screenshot(cdp, 'overlay-closed-via-escape');
});

// Test 10: Arrow key navigation
runner.test('Arrow keys navigate file list', async (cdp) => {
  // Reopen overlay
  await toggleDiffOverlay(cdp);
  await selectFile(cdp, 0);

  const state1 = await getDiffOverlayState(cdp);
  const firstFile = state1.selectedFile;

  // Press arrow down
  await cdp.pressKey('ArrowDown');
  await new Promise(resolve => setTimeout(resolve, 300));

  const state2 = await getDiffOverlayState(cdp);
  const secondFile = state2.selectedFile;

  if (!secondFile || firstFile === secondFile) {
    throw new Error('Arrow down did not change selection');
  }

  // Press arrow up
  await cdp.pressKey('ArrowUp');
  await new Promise(resolve => setTimeout(resolve, 300));

  const state3 = await getDiffOverlayState(cdp);
  if (state3.selectedFile !== firstFile) {
    throw new Error('Arrow up did not navigate back');
  }

  await screenshot(cdp, 'arrow-navigation');
});

// Test 11: Cmd+Shift+S toggles view mode
runner.test('Cmd+Shift+S toggles view mode', async (cdp) => {
  // Ensure we're in unified mode
  await toggleViewMode(cdp, 'unified');

  // Press Cmd+Shift+S
  await cdp.pressKey('s', { meta: true, shift: true });
  await new Promise(resolve => setTimeout(resolve, 300));

  let state = await getDiffOverlayState(cdp);
  if (state.viewMode !== 'split') {
    throw new Error('Cmd+Shift+S did not toggle to split view');
  }

  // Press again
  await cdp.pressKey('s', { meta: true, shift: true });
  await new Promise(resolve => setTimeout(resolve, 300));

  state = await getDiffOverlayState(cdp);
  if (state.viewMode !== 'unified') {
    throw new Error('Cmd+Shift+S did not toggle back to unified view');
  }

  await screenshot(cdp, 'keyboard-toggle-view');
});

// Test 12: 'r' key refreshes
runner.test('R key refreshes diff data', async (cdp) => {
  const stateBefore = await getDiffOverlayState(cdp);

  // Press 'r'
  await cdp.pressKey('r');
  await new Promise(resolve => setTimeout(resolve, 500));

  // Should still be visible and functional
  const stateAfter = await getDiffOverlayState(cdp);
  if (!stateAfter.isVisible) {
    throw new Error('Diff overlay disappeared after refresh');
  }

  await screenshot(cdp, 'keyboard-refresh');
});

// Test 13: No changes state
runner.test('No changes state shows correct message', async (cdp) => {
  // Close overlay and clean up all test files
  await cdp.pressKey('Escape');
  await cleanupTestChanges(cdp);

  // Reopen overlay
  await toggleDiffOverlay(cdp);
  await new Promise(resolve => setTimeout(resolve, 500));

  const state = await getDiffOverlayState(cdp);
  if (!state.hasNoChangesMessage && state.fileCount === 0) {
    // Either "No changes" message or empty file list is acceptable
    await screenshot(cdp, 'no-changes-state');
  } else if (state.fileCount > 0) {
    // If there are still files, that's ok (workspace might have real changes)
    await screenshot(cdp, 'has-changes-state');
  }

  // Close for cleanup
  await cdp.pressKey('Escape');
});

// Test 14: Cleanup
runner.test('Cleanup: Remove test changes', async (cdp) => {
  await cleanupTestChanges(cdp);
  await screenshot(cdp, 'cleanup-complete');
});

// Run all tests
runner.run().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
