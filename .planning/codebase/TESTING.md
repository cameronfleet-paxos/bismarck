# Testing Patterns

**Analysis Date:** 2026-02-15

## Test Framework

**Unit Test Runner:**
- Vitest 4.x
- Config: inline in `vite.config.ts` under `test` key
- Test include pattern: `src/**/*.test.ts`

**Integration Test Framework:**
- Custom CDP (Chrome DevTools Protocol) test infrastructure
- Node.js scripts in `scripts/test/` (no framework -- plain `http` + assertions)
- CDP HTTP server (`scripts/test/cdp-server.js`) on port 9333
- CDP helper class (`scripts/test/cdp-helper.js`) wraps WebSocket protocol

**Assertion Library:**
- Unit tests: Vitest built-in `expect` API
- Integration tests: manual `throw new Error(...)` assertions (no assertion library)

**Run Commands:**
```bash
npm test                      # Run all unit tests (vitest run)
npm run test:unit             # Same as above
npm run test:unit:watch       # Vitest watch mode

# Integration tests (require running app with CDP)
npm run test:core             # Core UI flow tests
npm run test:tutorial         # Tutorial flow tests
npm run test:comprehensive    # All CDP endpoints + all UI flows
npm run test:accessibility    # data-testid coverage, ARIA, keyboard nav
npm run test:performance      # CDP endpoint benchmarks + UI perf
npm run test:visual           # Visual regression (screenshot diff)
npm run test:visual:update    # Update visual baselines
npm run test:all              # core-flows + tutorial
npm run test:full             # comprehensive + tutorial + accessibility + performance
```

## Test File Organization

**Unit Tests:**
- Co-located with source files
- Pattern: `{module-name}.test.ts` next to `{module-name}.ts`
- Currently only one unit test file: `src/main/naming-utils.test.ts`

**Integration Tests:**
- Located in `scripts/test/`
- Written in plain JavaScript (CommonJS)
- Each file is a standalone test suite runnable with `node`

**Test Scripts:**
```
scripts/test/
├── cdp-helper.js              # Shared CDP WebSocket connection helper
├── cdp-server.js              # Persistent HTTP server for CDP interactions
├── cdp-inspector.js           # Interactive REPL for exploring CDP
├── cdp-recorder.js            # Records interactions -> generates test scripts
├── dev-with-cdp.js            # Unified startup (Vite + Electron + CDP server)
├── wait-for-ready.js          # Polls until all services are healthy
├── start-with-cdp.sh          # Shell script variant
├── core-flows-test.js         # Core UI flow integration tests
├── tutorial-test.js           # Tutorial integration tests
├── comprehensive-test.js      # Full CDP endpoint + UI flow tests
├── accessibility-test.js      # Accessibility tests
├── performance-test.js        # Performance benchmark tests
├── visual-regression-test.js  # Screenshot comparison tests
├── diff-view-test.js          # Diff view specific tests
├── README.md                  # Test infrastructure documentation
└── TUTORIAL_TESTS.md          # Tutorial-specific test documentation
```

## Test Structure

**Unit Test Organization:**
```typescript
import { describe, it, expect } from 'vitest'
import { generateBranchSlug, generateRandomPhrase } from './naming-utils'

describe('generateRandomPhrase', () => {
  it('returns adjective-noun format', () => {
    const phrase = generateRandomPhrase()
    expect(phrase).toMatch(/^[a-z]+-[a-z]+$/)
  })

  it('produces different results over multiple calls', () => {
    const results = new Set(Array.from({ length: 50 }, () => generateRandomPhrase()))
    expect(results.size).toBeGreaterThan(1)
  })
})

describe('generateBranchSlug', () => {
  // Helper function scoped within describe block
  function slugWithoutHash(slug: string): string {
    return slug.replace(/-[a-z0-9]{4}$/, '')
  }

  it('always ends with a 4-char alphanumeric hash', () => {
    // Multiple input cases in a single test
    const slugs = [
      generateBranchSlug('Fix the login bug'),
      generateBranchSlug(''),
      generateBranchSlug('please make sure to do it'),
    ]
    for (const slug of slugs) {
      expect(slug).toMatch(/-[a-z0-9]{4}$/)
    }
  })

  // Nested describe for related groups
  describe('real-world prompts', () => {
    it('handles GitHub issue-style prompts', () => {
      const slug = slugWithoutHash(generateBranchSlug('Fix: user cannot log in after password reset'))
      expect(slug).toBe('fix-user-cannot-log')
    })
  })
})
```

**Integration Test Pattern:**
```javascript
// TestRunner class pattern (used in tutorial-test.js)
class TestRunner {
  constructor() {
    this.tests = []
    this.passed = 0
    this.failed = 0
  }

  test(name, fn) {
    this.tests.push({ name, fn })
  }

  async run() {
    for (const { name, fn } of this.tests) {
      try {
        const start = Date.now()
        await fn(this.cdp)
        const duration = Date.now() - start
        console.log(`✓ ${name} (${duration}ms)`)
        this.passed++
      } catch (error) {
        console.log(`✗ ${name}: ${error.message}`)
        this.failed++
      }
    }
  }
}
```

**CDP Integration Test Pattern:**
```javascript
// Common helper object pattern (used in core-flows-test.js, comprehensive-test.js)
const cdp = {
  async health() {
    return cdpRequest('GET', '/health')
  },
  async screenshot(name) {
    if (!SCREENSHOT_MODE) return
    const filePath = path.join(SCREENSHOT_DIR, `${name}.png`)
    await cdpRequest('GET', `/screenshot?path=${encodeURIComponent(filePath)}`)
    return filePath
  },
  async state() {
    return cdpRequest('GET', '/state')
  },
  async eval(expression) {
    const result = await cdpRequest('POST', '/eval', { expression })
    return result.result
  },
  async click(target) {
    if (target.startsWith('[') || target.startsWith('.') || target.startsWith('#')) {
      return cdpRequest('POST', '/click', { selector: target })
    }
    return cdpRequest('POST', '/click', { text: target })
  },
}
```

## Mocking

**Unit Test Mocking:**
- No mocking framework detected
- The single unit test file (`src/main/naming-utils.test.ts`) tests pure functions with no mocking needed
- No Vitest mocking configuration (`vi.mock`, `vi.fn`) observed in codebase

**Integration Test Mocking:**
- CDP server has a `/mock-agent` endpoint to simulate headless agents without real API costs
- `/setup-test-env` endpoint bypasses onboarding by injecting test agent configuration
- Test scripts use the running app directly -- no service mocking layer

**What to Mock (when adding unit tests):**
- Electron APIs (`ipcRenderer`, `ipcMain`, `BrowserWindow`)
- Node.js `fs` operations for config loading
- `child_process` for `exec`/`spawn` calls
- External process communication (Claude CLI, Docker, git)

**What NOT to Mock:**
- Pure utility functions (test directly with real inputs)
- Shared type definitions
- CSS/styling

## Fixtures and Factories

**Test Data:**
- No dedicated fixture files or factory functions
- Test data is inline within test files:
  ```typescript
  const slugs = [
    generateBranchSlug('Fix the login bug'),
    generateBranchSlug(''),
    generateBranchSlug('please make sure to do it'),
    generateBranchSlug('Add unit tests for auth module'),
  ]
  ```
- Integration tests use `/setup-test-env` to create test agents at runtime

**Test Data Location:**
- No `__fixtures__`, `__mocks__`, or `testdata` directories
- Inline in test files

## Coverage

**Requirements:** Not enforced (no coverage thresholds configured)

**View Coverage:**
```bash
# No coverage script configured in package.json
# Can run manually:
npx vitest run --coverage
```

**Current State:**
- Very minimal unit test coverage (one test file: `src/main/naming-utils.test.ts`)
- Integration tests cover UI flows but not individual modules

## Test Types

**Unit Tests:**
- Framework: Vitest
- Scope: Pure utility functions
- Count: 1 file, ~25 test cases
- Location: `src/main/naming-utils.test.ts`
- Tests slug generation, keyword extraction, edge cases, real-world prompts

**CDP Integration Tests:**
- Framework: Custom Node.js scripts via CDP
- Scope: Full application UI flows through Chrome DevTools Protocol
- Test suites:
  - **Core Flows** (`scripts/test/core-flows-test.js`): Workspace view, settings, plan creation, headless agents, keyboard shortcuts
  - **Tutorial** (`scripts/test/tutorial-test.js`): Tutorial start, step navigation, skip, restart, completion
  - **Comprehensive** (`scripts/test/comprehensive-test.js`): All CDP endpoints, all UI sections, error handling, edge cases
  - **Accessibility** (`scripts/test/accessibility-test.js`): data-testid coverage, keyboard navigation, ARIA attributes, focus management
  - **Performance** (`scripts/test/performance-test.js`): CDP response times, UI interaction benchmarks, memory usage
  - **Visual Regression** (`scripts/test/visual-regression-test.js`): Screenshot comparison against baselines

**E2E Tests:**
- The CDP integration tests effectively serve as E2E tests
- They interact with the fully running Electron app
- Screenshots stored in `test-screenshots/` (gitignored)
- Test reports generated in `test-reports/` (gitignored)

## CI/CD Integration

**CI Pipeline:** GitHub Actions (`.github/workflows/ci.yml`)

**Quality Job (runs on every PR to main):**
1. Checkout, setup Node.js 22, `npm ci`
2. `npm run typecheck` (TypeScript strict type checking)
3. `npm test` (Vitest unit tests)

**Integration Job (runs on every PR to main):**
1. Checkout, setup Node.js 22, install `xvfb`
2. `npm ci` + `npm run build`
3. Start Electron with xvfb virtual display: `xvfb-run -a ./node_modules/.bin/electron --remote-debugging-port=9222 --no-sandbox .`
4. Start CDP server: `node scripts/test/cdp-server.js`
5. Bypass onboarding: `curl -s -X POST localhost:9333/setup-test-env`
6. Run CDP integration tests: `npm run test:core`
7. Upload Electron logs as artifacts on failure

## Common Patterns

**Async Testing (Unit):**
```typescript
// No async unit tests currently -- all tests are synchronous
// Pure function testing with direct return value assertions
it('extracts action verb + keywords from simple prompts', () => {
  expect(slugWithoutHash(generateBranchSlug('Fix the login bug'))).toBe('fix-login-bug')
})
```

**Edge Case Testing:**
```typescript
it('falls back to random phrase for empty prompt', () => {
  const slug = slugWithoutHash(generateBranchSlug(''))
  expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
})

it('falls back for whitespace-only prompts', () => {
  const slug = slugWithoutHash(generateBranchSlug('   '))
  expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
})

it('handles very long prompts gracefully', () => {
  const longPrompt = 'Implement a comprehensive end-to-end testing...'
  const slug = generateBranchSlug(longPrompt)
  const parts = slug.split('-')
  expect(parts.length).toBeLessThanOrEqual(5) // 4 keywords + 1 hash
  expect(slug).toMatch(/^[a-z0-9-]+$/)
})
```

**Multiple Assertion Per Test:**
```typescript
it('produces filesystem-safe slugs (no spaces, slashes, or special chars)', () => {
  const prompts = [
    'Fix the login/session timeout bug',
    'Add feature: dark mode support',
    'Refactor src/components/Header.tsx',
    'Update CI/CD pipeline configuration',
  ]
  for (const prompt of prompts) {
    const slug = generateBranchSlug(prompt)
    expect(slug).toMatch(/^[a-z0-9-]+$/)
  }
})
```

**CDP Integration Test Assertions:**
```javascript
// Manual assertion via throw
const state = await cdp.state()
if (state.view !== 'workspace') {
  throw new Error(`Expected workspace view, got: ${state.view}`)
}

// DOM query assertion
const agentCount = await cdp.eval(
  'document.querySelectorAll("[data-testid^=\\"agent-card-\\"]").length'
)
if (agentCount < 1) {
  throw new Error(`Expected at least 1 agent card, got: ${agentCount}`)
}
```

## Performance Budgets

Defined in `scripts/test/performance-test.js`:
```javascript
const BUDGETS = {
  'health': 50,           // ms
  'state': 200,
  'screenshot': 2000,
  'eval-simple': 100,
  'eval-complex': 500,
  'click': 300,
  'key': 200,
  'ui-snapshot': 300,
  'agents-list': 200,
  'view-switch': 1000,
  'settings-section-switch': 500,
}
```

## Writing New Tests

**Adding a unit test:**
1. Create `{module-name}.test.ts` next to the source file in `src/`
2. Import from `vitest`: `import { describe, it, expect } from 'vitest'`
3. Use `describe`/`it` blocks with descriptive names
4. Run with `npm test`

**Adding a CDP integration test:**
1. Follow the pattern in `scripts/test/comprehensive-test.js`
2. Use the shared `cdpRequest()` helper and `cdp` convenience object
3. Assert by throwing errors on unexpected state
4. Use `cdp.state()` for view detection, `cdp.eval()` for DOM queries
5. Use `cdp.click('[data-testid="..."]')` for element interaction
6. Add screenshots on failure: `cdp.screenshot('descriptive-name')`
7. Add corresponding `npm run` script in `package.json`

---

*Testing analysis: 2026-02-15*
