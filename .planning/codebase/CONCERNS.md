# Codebase Concerns

**Analysis Date:** 2026-02-15

## Tech Debt

**Monolithic App.tsx Component (4,569 lines):**
- Issue: `src/renderer/App.tsx` is a single file containing 72 `useState` calls, 14 `useEffect` hooks, and 20 `useCallback` functions. All application state, event handling, and UI rendering lives in one component.
- Files: `src/renderer/App.tsx`
- Impact: Extremely difficult to modify any feature without risk of side effects. Slow code comprehension. High cognitive load for any developer touching UI state.
- Fix approach: Extract state into context providers or a state management library (e.g., Zustand). Split into feature-specific components: `AgentManager`, `PlanManager`, `TerminalManager`, `DragDropManager`. Move the ~40 handler functions (`handleCreatePlan`, `handleFocusAgent`, etc.) into custom hooks organized by domain.

**Inline Migrations in Load Functions:**
- Issue: Data migrations are scattered across `loadState()` and `loadSettings()` as inline conditional blocks. There are 7+ migrations in `src/main/config.ts` (lines 336-367) and 15+ migrations in `src/main/settings-manager.ts` (lines 308-427). These use `as any` casts to handle old field names.
- Files: `src/main/config.ts`, `src/main/settings-manager.ts`
- Impact: Every load path runs through accumulated migration checks. Adding new migrations means touching load functions. No versioning system to skip already-applied migrations. The `as any` casts bypass TypeScript safety.
- Fix approach: Implement a versioned migration system with a schema version number stored in each config file. Run migrations sequentially on load only when schema version is outdated.

**Large Preload Bridge (658 lines, 203 IPC calls):**
- Issue: `src/main/preload.ts` exposes 203 IPC invocations to the renderer. The corresponding `src/main/main.ts` registers 168 `ipcMain.handle` calls. Every new feature requires adding entries in both files plus `src/renderer/electron.d.ts`.
- Files: `src/main/preload.ts`, `src/main/main.ts`, `src/renderer/electron.d.ts`
- Impact: Triple-maintenance burden for every IPC channel. Easy to get type mismatches between the three files. The main process file (1,708 lines) is bloated with handler registrations.
- Fix approach: Group IPC handlers by domain module (terminal, plan, settings, etc.) and auto-generate the preload bridge from a shared schema or use a typed IPC abstraction layer.

**`as any` Type Escapes:**
- Issue: 109 occurrences of `any` across source files (81 in `.ts` files, 28 in `.tsx` files). Key locations include `src/main/ralph-loop.ts` (5 usages for event parsing), `src/main/settings-manager.ts` (7 usages for migrations), and `src/renderer/App.tsx` (11 usages).
- Files: `src/main/ralph-loop.ts:286,293`, `src/main/settings-manager.ts:413`, `src/main/config.ts:359-360`, `src/renderer/main.tsx:27,32`, `src/main/prompt-templates.ts` (8 usages), `src/main/setup-wizard.ts:302`
- Impact: Defeats TypeScript's type safety. Runtime type errors may not be caught at compile time.
- Fix approach: Replace `as any` casts with proper type guards, discriminated unions, or versioned interfaces for data migration paths.

## Known Bugs

**No TODO/FIXME/HACK Comments Found:**
- The codebase has virtually zero TODO/FIXME markers (only 2 matches for XXX in `src/main/dev-test-harness.ts`, which are regex pattern comments, not actual TODOs).
- This is either a positive sign of maintenance discipline or an indication that known issues are tracked externally.

## Security Considerations

**Docker Containers Run with `--dangerously-skip-permissions`:**
- Risk: All headless Claude agents run inside Docker with `--dangerously-skip-permissions` flag, meaning the AI has unrestricted access within the container.
- Files: `src/main/docker-sandbox.ts:418,427`
- Current mitigation: Containers are sandboxed (limited CPU/memory via resource limits), a tool proxy (`src/main/tool-proxy.ts`) keeps tokens on the host, and the container only mounts specific directories.
- Recommendations: The tool proxy architecture is sound. Ensure network access is restricted within containers. Consider adding allowlists for file system operations.

**OAuth Tokens Stored as Plain JSON on Disk:**
- Risk: OAuth tokens and GitHub tokens are stored in plain JSON files (`oauth-token.json`, `github-token.json`) in the config directory with 0o600 permissions.
- Files: `src/main/config.ts:461-528`, `src/main/config.ts:518-550`
- Current mitigation: File permissions restrict access to the owning user. Atomic writes via `writeConfigAtomic()` prevent partial writes.
- Recommendations: Consider using the OS keychain (macOS Keychain, etc.) via Electron's `safeStorage` API for sensitive credential storage instead of filesystem JSON.

**Token Passthrough via Environment Variables:**
- Risk: `src/main/tool-proxy.ts:448-452` passes `BUILDBUDDY_API_KEY` and `GITHUB_TOKEN` from the host environment directly to proxy processes. If debug logging is enabled, these could be captured in log output.
- Files: `src/main/tool-proxy.ts:448-452`, `src/main/config.ts:479-480`
- Current mitigation: A one-time log purge migration was added in v0.6.3 (`src/main/settings-manager.ts:417-427`) to clean up debug logs that may have contained leaked secrets.
- Recommendations: Ensure the logger (`src/main/logger.ts`) sanitizes environment variables and token values from all log output.

**Socket Path Collision Risk:**
- Risk: Socket paths use truncated UUIDs (first 8 chars) for both instance and workspace IDs to work around macOS 104-char Unix socket path limits.
- Files: `src/main/socket-server.ts:29-36`
- Current mitigation: None. Collision probability is low (~1 in 4 billion) but non-zero for heavy users running many instances.
- Recommendations: Add collision detection or use a different socket naming strategy.

## Performance Bottlenecks

**File Change Polling in Renderer (5-second interval):**
- Problem: `App.tsx` polls `electronAPI.getChangedFiles()` every 5 seconds for all visible agents to show diff badges. Each call spawns a `git diff --name-only` subprocess.
- Files: `src/renderer/App.tsx:368-401`
- Cause: No file system watcher; relies on polling with `setInterval(pollChangeCounts, 5000)`.
- Improvement path: Use `fs.watch()` or a file watcher library (chokidar) on the main process side to push change notifications to the renderer via IPC events instead of polling.

**Synchronous File I/O in Config Operations:**
- Problem: `readFileSync` and `writeFileSync` are used extensively in config, state, and settings operations. Found 30+ synchronous file I/O calls in `src/main/config.ts`, `src/main/hook-manager.ts`, `src/main/cron-job-manager.ts`, and others.
- Files: `src/main/config.ts`, `src/main/hook-manager.ts` (7 sync writes), `src/main/cron-job-manager.ts`, `src/main/logger.ts`
- Cause: Historical design choice; simpler code for small files.
- Improvement path: Convert to async I/O (`fs.promises`) particularly in `hook-manager.ts` which writes multiple files sequentially. The main process event loop blocks during sync I/O.

**Terminal Buffer String Concatenation:**
- Problem: `TerminalBufferManager` in `src/renderer/utils/terminal-buffer.ts` appends terminal data via string concatenation (`existing.data += data`). For active terminals producing lots of output, this creates increasing GC pressure as strings grow toward the 1MB limit.
- Files: `src/renderer/utils/terminal-buffer.ts:31`
- Cause: Simple string concatenation pattern.
- Improvement path: Use an array of chunks with a `join()` on read, or a ring buffer approach. Only matters for very active terminals.

## Fragile Areas

**IPC Type Contract (Three-File Synchronization):**
- Files: `src/main/preload.ts`, `src/main/main.ts`, `src/renderer/electron.d.ts`
- Why fragile: Adding or modifying an IPC channel requires synchronized changes across three files with no compile-time enforcement that the types match. The `electron.d.ts` type declarations are manual and can drift from the actual implementations.
- Safe modification: Always update all three files together. Search for the channel name string in all files before modifying.
- Test coverage: No automated tests verify IPC channel type consistency.

**State Persistence (Read-Modify-Write Pattern):**
- Files: `src/main/config.ts`, `src/main/state-manager.ts`
- Why fragile: State is loaded from JSON files, modified in memory, and written back. The `withPlanLock()` and `withPlansFileLock()` mutex patterns (`src/main/config.ts:17-59`) protect against concurrent modifications, but in-memory state in `src/main/state-manager.ts` can diverge from disk if writes fail silently (the `catch` blocks return defaults).
- Safe modification: Always use the lock functions for plan state mutations. Test that disk writes succeed before updating in-memory state.
- Test coverage: No tests for concurrent access patterns or write failure recovery.

**Migration Ordering:**
- Files: `src/main/settings-manager.ts:308-435`, `src/main/config.ts:336-367`
- Why fragile: Migrations execute in source code order on every load. If a migration depends on a previous one's changes but they are reordered, data corruption can occur. No migration versioning or idempotency guarantees.
- Safe modification: Only append new migrations at the end. Never reorder or remove existing migrations.
- Test coverage: None.

## Scaling Limits

**Single-Window Architecture:**
- Current capacity: One Electron BrowserWindow rendering all agents, tabs, terminals.
- Limit: As the number of concurrent agents grows, the single renderer process manages all terminal instances (xterm.js), each with its own WebGL context and 1MB buffer. At ~20+ terminals, GPU memory and renderer memory pressure become significant.
- Scaling path: Consider moving terminals to separate BrowserWindows or webviews, or implementing virtual rendering that only mounts visible terminals.

**In-Memory Agent/Plan State:**
- Current capacity: All plan state, headless agent info, and activities are held in Maps in the renderer (`src/renderer/App.tsx:198-211`).
- Limit: With many plans and agents over time, memory usage grows unboundedly. No pagination or cleanup of completed plan data from memory.
- Scaling path: Implement a data retention policy that archives completed plans to disk and only keeps active plans in memory.

## Dependencies at Risk

**node-pty (Native Module):**
- Risk: Native Node.js module that requires compilation for the specific Electron ABI version. Build failures during `npm install` are common when Node.js or Electron versions change. The `postinstall` hook runs `electron-rebuild` to address this.
- Files: `package.json:136` (dependency), `package.json:7-8` (rebuild scripts)
- Impact: Terminal functionality completely breaks if the native module is built for the wrong ABI.
- Migration plan: No drop-in replacement exists. Continue using `electron-rebuild` and consider pinning exact Electron versions in CI.

**Mac-Only Build Target:**
- Risk: The build configuration (`package.json:96-103`) only targets macOS arm64 DMG. Several shell commands in `src/main/process-cleanup.ts` use macOS-specific `ps` flags (`ps eww`).
- Files: `package.json:96-103`, `src/main/process-cleanup.ts`
- Impact: Cannot build for or run on Windows or Linux without significant changes.
- Migration plan: Not currently a priority but worth noting for future cross-platform ambitions.

## Test Coverage Gaps

**Near-Zero Unit Test Coverage:**
- What's not tested: The entire application has 1 test file (`src/main/naming-utils.test.ts`, 197 lines) covering only branch slug generation. Zero test coverage for:
  - State management (`src/main/state-manager.ts`)
  - Configuration loading/saving (`src/main/config.ts`)
  - Docker sandbox management (`src/main/docker-sandbox.ts`)
  - Terminal management (`src/main/terminal.ts`)
  - Git operations (`src/main/git-utils.ts`)
  - Plan execution (`src/main/teams/*.ts`)
  - Settings migrations (`src/main/settings-manager.ts`)
  - All renderer components (`src/renderer/`)
- Files: All files in `src/main/` and `src/renderer/` except `src/main/naming-utils.ts`
- Risk: Any refactoring or feature addition can introduce regressions undetected. The migration code in `settings-manager.ts` and `config.ts` is particularly risky to modify without tests.
- Priority: **High** - The CI pipeline (`/.github/workflows/ci.yml`) runs `npm test` but only exercises the single test file. Integration tests exist via CDP but only cover basic UI flows.

**No Renderer Component Tests:**
- What's not tested: All 40+ React components have zero unit or component tests. The 4,569-line `App.tsx` is completely untested.
- Files: All files in `src/renderer/components/`
- Risk: UI regressions go undetected. State management bugs in the monolithic App component are especially likely.
- Priority: **Medium** - CDP integration tests provide some coverage of end-to-end flows, but component-level behavior is untested.

## Code Quality Issues

**Console.log Mixed with Structured Logging:**
- Issue: 80 `console.log/error/warn` calls coexist with 603 `devLog`/`logger.*` calls across the main process. Some modules use both patterns inconsistently.
- Files: `src/main/main.ts` (16 console calls), `src/main/headless/standalone.ts` (12 console calls), `src/main/dev-test-harness.ts` (6 console calls)
- Impact: Inconsistent log output. Console calls bypass the structured logger's category filtering and plan-specific routing.
- Fix: Replace all `console.log/warn/error` in main process code with `logger.*` or `devLog` calls.

**No State Management Abstraction in Renderer:**
- Issue: The renderer uses raw `useState` for all state (72 calls in `App.tsx`) with no state management library or context providers (except `TutorialProvider`). State is passed down through 10+ levels of props.
- Files: `src/renderer/App.tsx`, `src/renderer/components/CommandSearch.tsx` (receives 15+ props)
- Impact: Prop drilling makes components tightly coupled to App.tsx. Adding new state requires modifying the monolithic component.
- Fix: Adopt a state management approach (Zustand, Jotai, or React Context with reducers) and extract domain-specific state slices.

**Duplicated Config Directory Logic:**
- Issue: The config directory name logic (`process.env.NODE_ENV === 'development' ? '.bismarck-dev' : '.bismarck'`) is duplicated in three files.
- Files: `src/main/config.ts:8`, `src/main/startup-benchmark.ts:54`, `src/main/hook-manager.ts:57`
- Impact: If the directory naming strategy changes, all three locations must be updated.
- Fix: Export a single `CONFIG_DIR_NAME` constant from `src/main/config.ts` and import it in other modules.

---

*Concerns audit: 2026-02-15*
