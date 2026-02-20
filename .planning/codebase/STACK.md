# Technology Stack

**Analysis Date:** 2026-02-15

## Languages

**Primary:**
- TypeScript ^5.9.3 - All source code (main process, renderer, shared)

**Secondary:**
- JavaScript - Config files (`eslint.config.js`, `postcss.config.cjs`, `tailwind.config.cjs`), test scripts (`scripts/test/*.js`)
- Bash - Hook scripts, Docker wrapper scripts (`docker/gh-proxy-wrapper.sh`, etc.), install script (`scripts/install.sh`)
- CSS - Tailwind CSS v4 with `@theme` directive (`src/renderer/index.css`)

## Runtime

**Environment:**
- Electron ^40.1.0 - Desktop application runtime (Chromium + Node.js)
- Node.js 22 (CI/CD), Node.js 20 (Docker agent container)
- Target: macOS (arm64) - primary platform; builds DMG for Apple Silicon

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React ^19.2.4 - UI rendering (renderer process)
- Electron ^40.1.0 - Desktop app shell with main/renderer/preload architecture

**Testing:**
- Vitest ^4.0.18 - Unit tests (`npm test`, `npm run test:unit`)
- CDP-based integration tests - Custom test framework using Chrome DevTools Protocol (`scripts/test/`)

**Build/Dev:**
- Vite ^7.3.1 - Renderer bundler and dev server (port 5173)
- TypeScript Compiler (tsc) - Main process compilation via `tsconfig.main.json`
- electron-builder ^26.4.0 - Application packaging and distribution
- @electron/rebuild ^4.0.1 - Native module recompilation for Electron ABI

## Key Dependencies

**Critical:**
- `node-pty` ^1.1.0 - Terminal emulation (native module; spawns PTY processes for Claude CLI interactions)
- `@xterm/xterm` ^6.0.0 + addons (fit, search, web-links) - Terminal rendering in renderer process
- `react` ^19.2.4 / `react-dom` ^19.2.4 - UI framework

**UI Components:**
- `@radix-ui/react-dialog` ^1.1.15 - Modal dialogs
- `@radix-ui/react-dropdown-menu` ^2.1.16 - Dropdown menus
- `@radix-ui/react-select` ^2.2.6 - Select inputs
- `@radix-ui/react-switch` ^1.2.6 - Toggle switches
- `@radix-ui/react-tooltip` ^1.2.8 - Tooltips
- `@radix-ui/react-label` ^2.1.8 - Form labels
- `@radix-ui/react-slot` ^1.2.4 - Slot composition
- `lucide-react` ^0.563.0 - Icon library
- `class-variance-authority` ^0.7.1 - Component variant management (shadcn/ui pattern)
- `clsx` ^2.1.1 + `tailwind-merge` ^3.4.0 - Conditional class composition

**Code Editor / Diff Viewer:**
- `@uiw/react-codemirror` ^4.25.4 - Code editor component
- `@codemirror/merge` ^6.11.2 - Diff/merge view
- `@codemirror/lang-json` ^6.0.2 - JSON syntax highlighting
- `@codemirror/language-data` ^6.5.2 - Language detection

**Markdown:**
- `react-markdown` ^10.1.0 - Markdown rendering
- `@tailwindcss/typography` ^0.5.19 - Prose styling for markdown content

**Styling:**
- `tailwindcss` ^4.1.18 - Utility-first CSS (v4 with `@import "tailwindcss"` syntax)
- `@tailwindcss/postcss` ^4.1.18 - PostCSS integration
- `autoprefixer` ^10.4.23 - CSS vendor prefixing
- `postcss` ^8.5.6 - CSS processing pipeline

**Infrastructure:**
- `ws` ^8.19.0 - WebSocket client (dev dependency, used for CDP communication in test scripts)

## Configuration

**TypeScript:**
- `tsconfig.json` - Renderer process: ES2022 target, ESNext modules, bundler resolution, JSX react-jsx, path alias `@/*` -> `./src/*`
- `tsconfig.main.json` - Main process: ES2022 target, CommonJS modules, Node resolution, includes `src/main/**/*` and `src/shared/**/*`

**Vite:**
- `vite.config.ts` - React plugin, path alias `@` -> `./src`, dev server port 5173, build output to `dist/renderer`, test includes `src/**/*.test.ts`

**ESLint:**
- `eslint.config.js` - Flat config (ESLint v9), TypeScript parser, React + React Hooks plugins, no-unused-vars with `_` prefix pattern

**Tailwind CSS:**
- `tailwind.config.cjs` - Content scan: `src/**/*.{js,ts,jsx,tsx}` and `index.html`, typography plugin
- `postcss.config.cjs` - Uses `@tailwindcss/postcss` and `autoprefixer`

**Environment:**
- `.env` files listed in `.gitignore` (existence noted, contents not read)
- Config directory: `~/.bismarck/` (production) or `~/.bismarck-dev/` (development)
- Key config files:
  - `~/.bismarck/config.json` - Agent/workspace definitions
  - `~/.bismarck/state.json` - App state, tabs, preferences
  - `~/.bismarck/settings.json` - Settings (Docker, tools, prompts)
  - `~/.bismarck/repositories.json` - Repository metadata
  - `~/.bismarck/plans.json` - Plan definitions
  - `~/.bismarck/plans/<planId>/` - Plan-specific data (beads, worktrees, debug logs)
  - `~/.bismarck/cron-jobs/<id>.json` - Cron job definitions

**Build:**
- Main process: `tsc -p tsconfig.main.json` -> `dist/main/`
- Renderer: `vite build` -> `dist/renderer/`
- Packaging: `electron-builder` -> DMG (arm64 macOS)
- ASAR packaging with `node-pty` and `.node` files unpacked

## Platform Requirements

**Development:**
- macOS (primary target) - required for Electron with CDP testing, tray icon, power save
- Node.js 22+ (CI uses node 22)
- Docker Desktop (optional, for headless agent mode)
- Git

**Production:**
- macOS arm64 (Apple Silicon)
- Distributed as DMG via GitHub Releases
- Docker image: `bismarckapp/bismarck-agent` (published to Docker Hub for headless agents)
- External CLIs used at runtime: `claude` (Claude Code CLI), `bd` (Beads), `gh` (GitHub CLI), `git`, `bb` (BuildBuddy, optional)

---

*Stack analysis: 2026-02-15*
