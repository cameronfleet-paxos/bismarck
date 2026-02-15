# Coding Conventions

**Analysis Date:** 2026-02-15

## Naming Patterns

**Files:**
- React components: PascalCase (`WorkspaceCard.tsx`, `PlanSidebar.tsx`, `SetupWizard.tsx`)
- UI primitives (shadcn): lowercase kebab-case (`button.tsx`, `dropdown-menu.tsx`, `dialog.tsx`)
- Main process modules: kebab-case (`exec-utils.ts`, `naming-utils.ts`, `git-utils.ts`, `crash-logger.ts`)
- Shared modules: kebab-case (`grid-utils.ts`, `pr-utils.ts`, `cron-types.ts`)
- Test files: co-located with source, suffix `.test.ts` (`naming-utils.test.ts`)
- Type declaration files: `.d.ts` suffix (`electron.d.ts`, `vite-env.d.ts`)

**Functions:**
- Use camelCase: `getWorkspaces()`, `saveWorkspace()`, `generateBranchSlug()`
- Event handlers on React props: `onEdit`, `onClick`, `onMoveToTab`, `onStopHeadless`
- Boolean getters: descriptive names without `is` prefix for functions (`claudeSessionExists()`)
- Async functions: no `async` suffix, just named by what they do (`withPlanLock()`, `ensureConnected()`)

**Variables:**
- camelCase for locals and parameters: `themeColors`, `planMutexes`, `debugSettingsCache`
- UPPER_SNAKE_CASE for module-level constants: `STOP_WORDS`, `ADJECTIVES`, `MAX_CRASH_LOGS`, `CACHE_TTL_MS`
- Boolean variables: `is`/`has`/`can` prefix (`isRunning`, `isDev`, `canDrag`, `isActive`)

**Types:**
- PascalCase for interfaces and type aliases: `AgentCardProps`, `LogCategory`, `BaseStreamEvent`
- Interface names: plain nouns/descriptors, no `I` prefix (`Workspace`, `Plan`, `GridConfig`)
- Type unions for string literals: `type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'`
- Props interfaces: `{ComponentName}Props` pattern (`AgentCardProps`, `GeneralSettingsProps`, `ElapsedTimeProps`)

**React Components:**
- Named function exports (not arrow functions): `export function ElapsedTime({...}: ElapsedTimeProps) {`
- Memoized components use `memo(function Name(...) {...})`: see `src/renderer/components/WorkspaceCard.tsx`
- Component files export the component and optionally related variants/types

## Code Style

**Formatting:**
- No Prettier config (no `.prettierrc` detected) -- formatting is manual/convention-based
- Single quotes for strings in TypeScript
- No semicolons (semicolons omitted consistently across all source files)
- 2-space indentation
- Trailing commas in multi-line arrays/objects
- Template literals for string interpolation: `` `${adjective}-${noun}` ``

**Linting:**
- ESLint 9 flat config: `eslint.config.js`
- TypeScript parser: `@typescript-eslint/parser`
- Plugins: `@typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`
- Key rules:
  - `react/react-in-jsx-scope`: off (React 19 auto-import)
  - `@typescript-eslint/no-unused-vars`: error, with `argsIgnorePattern: '^_'` (prefix unused params with `_`)
- Run lint: `npm run lint` (scans `src --ext .ts,.tsx`)
- Run typecheck: `npm run typecheck` (`tsc --noEmit`)

**TypeScript:**
- Strict mode enabled in both `tsconfig.json` and `tsconfig.main.json`
- Target: ES2022
- Path alias: `@/*` maps to `./src/*`
- Renderer uses `module: ESNext` with `moduleResolution: bundler`
- Main process uses `module: CommonJS` with `moduleResolution: node`
- `skipLibCheck: true` enabled

## Import Organization

**Order:**
1. CSS imports (only in entry files): `import './index.css'`
2. React / framework imports: `import { useState, useEffect } from 'react'`
3. Third-party libraries: `import { clsx } from 'clsx'`
4. UI component library (shadcn): `import { Button } from '@/renderer/components/ui/button'`
5. Application components: `import { AgentCard } from '@/renderer/components/WorkspaceCard'`
6. Shared types/utilities: `import type { Agent } from '@/shared/types'`
7. Local utilities: `import { devLog } from './dev-log'`

**Path Aliases:**
- `@/*` resolves to `src/*` (configured in `tsconfig.json` and `vite.config.ts`)
- Renderer imports use `@/renderer/components/...`, `@/renderer/hooks/...`, `@/renderer/utils/...`
- Shared imports use `@/shared/types`, `@/shared/constants`, `@/shared/grid-utils`
- Lib imports use `@/lib/utils` (shadcn utility)
- Main process files use relative imports (`./config`, `../shared/types`)

**Type-only imports:**
- Use `import type { ... }` for type-only imports: `import type { Agent, AgentTab } from '@/shared/types'`
- This is used consistently across both renderer and main process code

## Error Handling

**Main Process Patterns:**
- Try/catch with empty catch blocks for non-critical operations:
  ```typescript
  try {
    fs.accessSync(fullPath, fs.constants.X_OK)
    return fullPath
  } catch {
    // continue to next path
  }
  ```
- Null guards for BrowserWindow before IPC sends:
  ```typescript
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('event-name', data)
  }
  ```
- Mutex/lock patterns for concurrent access to shared state:
  ```typescript
  export async function withPlanLock<T>(planId: string, fn: () => Promise<T>): Promise<T> {
    const pending = planMutexes.get(planId) || Promise.resolve()
    // ... queue and await
  }
  ```

**Renderer Patterns:**
- Optional chaining for electron API calls: `window.electronAPI?.sendBenchmarkTiming?.(label, 'renderer', ...)`
- Callback-style error handling with optional chain: `onStopHeadless?.()`

**Crash Logging:**
- Dedicated crash logger writes to `~/.bismarck/crash-logs/` (`src/main/crash-logger.ts`)
- Structured `CrashContext` interface with optional planId, taskId

## Logging

**Development Logging:**
- Two parallel `devLog` modules for each process:
  - Main process: `src/main/dev-log.ts` (uses `process.env.NODE_ENV === 'development'`)
  - Renderer: `src/renderer/utils/dev-log.ts` (uses `import.meta.env.DEV`)
- Both export: `devLog()`, `devWarn()`, `devError()`
- `devLog`/`devWarn` only output in development; `devError` always outputs
- Use `devLog(...)` instead of `console.log(...)` in production-facing code

**Structured Logging:**
- Centralized logger in `src/main/logger.ts` with categories and levels
- Categories: `plan`, `task`, `worktree`, `agent`, `git`, `git-diff`, `bd`, `docker`, `proxy`, `general`
- Levels: `DEBUG`, `INFO`, `WARN`, `ERROR`
- Logs to `~/.bismarck/debug-YYYY-MM-DD.log` (date-based rolling)
- Plan-specific logs: `~/.bismarck/plans/{planId}/debug.log`
- Log context includes `planId`, `taskId`, `agentId`, `worktreePath`, `branch`

## Comments

**When to Comment:**
- Module-level JSDoc at top of file explaining purpose (used extensively in main process):
  ```typescript
  /**
   * Stream Parser for Claude Code Headless Output
   *
   * Parses NDJSON (newline-delimited JSON) output from Claude Code's
   * --output-format stream-json mode.
   */
  ```
- Inline comments for non-obvious logic or constants:
  ```typescript
  // Common English words that don't carry meaningful intent for branch names
  const STOP_WORDS = new Set([...])
  ```
- Section separators in large files: `// Drag-and-drop props for sidebar reordering`
- Backwards compatibility notes: `// Alias for backwards compatibility`

**JSDoc/TSDoc:**
- Used on exported functions in main process modules with `@param`-free descriptions:
  ```typescript
  /**
   * Generate a branch slug from a user prompt.
   *
   * Extracts keywords from the prompt and appends a short hash for uniqueness.
   * Falls back to a random adjective-noun phrase when no meaningful keywords
   * can be extracted (empty/vague prompts).
   */
  export function generateBranchSlug(prompt: string): string {
  ```
- Not used on React component props (TypeScript interfaces serve as documentation)
- Not used on internal/private helper functions

## Function Design

**Size:**
- Utility functions are small and focused (5-30 lines typical)
- React components can be large -- `App.tsx` is ~204KB (monolithic component)
- Main process modules are moderate (200-600 lines each)

**Parameters:**
- Props interfaces for React components with explicit interface definition
- Destructuring in function signatures: `function AgentCard({ agent, isActive, ... }: AgentCardProps)`
- Generic type parameters for mutex/lock utilities: `withPlanLock<T>(planId: string, fn: () => Promise<T>): Promise<T>`

**Return Values:**
- Functions return specific types, not `any`
- Void for side-effect-only functions (event emitters, state setters)
- Async functions return `Promise<T>` with explicit types

## Module Design

**Exports:**
- Named exports (no default exports): `export function ElapsedTime(...)`, `export { Button, buttonVariants }`
- Exception: `App.tsx` uses `export default function App()` (Vite convention for entry)
- Re-export aggregation in `index.ts` barrel files (`src/main/teams/index.ts`, `src/main/headless/index.ts`, `src/renderer/components/tutorial/index.ts`)

**Barrel Files:**
- Used selectively for complex module groups (teams, headless, tutorial)
- Not used for flat directories (components, utils)
- Pattern: `export { fn1, fn2 } from './module-a'` with cross-module wiring in index

**Circular Dependency Strategy:**
- Callback injection pattern to break circular dependencies:
  ```typescript
  // In index.ts: wire cross-module callbacks
  import { setOnCriticNeeded } from '../headless/team-agents'
  import { spawnCriticAgent } from './critic'
  setOnCriticNeeded(spawnCriticAgent)
  ```

## IPC Communication Pattern

**Electron IPC:**
- Main process registers handlers with `ipcMain.handle('channel-name', handler)`
- Preload exposes typed API via `contextBridge.exposeInMainWorld('electronAPI', {...})`
- Renderer calls through `window.electronAPI.methodName(...)`
- Channel naming: kebab-case (`get-workspaces`, `save-workspace`, `create-terminal`)
- Events from main to renderer: `mainWindow.webContents.send('event-name', data)`
- Type declarations for the API in `src/renderer/electron.d.ts`

## React Patterns

**State Management:**
- Local state with `useState` hooks (no global state library)
- State loaded from main process via IPC on mount (`useEffect(() => { ... }, [])`)
- Parent-to-child via props; events via callback props

**Component Composition:**
- shadcn/ui primitives in `src/renderer/components/ui/` (Radix-based)
- Application components compose UI primitives
- `class-variance-authority` (cva) for variant styling on primitives
- `cn()` utility from `@/lib/utils` for merging Tailwind classes

**Styling:**
- Tailwind CSS v4 via `@tailwindcss/postcss` plugin
- Dark theme by default (oklch color tokens in `src/renderer/index.css`)
- CSS custom properties for theming: `--color-background`, `--color-foreground`, etc.
- Custom animations defined in `src/renderer/index.css`
- Template literal classnames for conditional styles (not classnames/clsx in components)
- `data-testid` attributes on interactive elements for test targeting

**UI Library:**
- shadcn/ui with "new-york" style, neutral base color, CSS variables enabled
- Component aliases configured in `components.json`:
  - Components: `@/renderer/components`
  - UI: `@/renderer/components/ui`
  - Lib: `@/lib`
  - Hooks: `@/hooks`
- Icon library: `lucide-react`

---

*Convention analysis: 2026-02-15*
