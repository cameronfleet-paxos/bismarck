# Codex Support: Making Bismarck Agent-Agnostic

## Context

Bismarck is currently tightly coupled to Claude Code at every layer: binary invocation, Docker image, stream protocol, event schema, session management, auth, tool proxy, and attention hooks. There is no agent abstraction layer -- no `AgentProvider` interface, no factory pattern, no runtime provider selection.

This plan outlines what it would take to support OpenAI Codex as a second agent backend, and in doing so, create the abstraction layer needed for any future provider.

---

## Current Claude Code Coupling Points

### Detailed Coupling Map (from codebase investigation)

| Layer | How It's Coupled | Files | Specific Lines |
|-------|-----------------|-------|----------------|
| **Binary** | Hardcoded `'claude'` pushed into args | `docker-sandbox.ts` (L265), `terminal.ts` (L98), `oauth-setup.ts` (L51), `repo-grouper.ts` (L137-184), `description-generator.ts` (L314-369) | 5 files, ~15 hardcoded references |
| **Docker image** | `bismarckapp/bismarck-agent` ships Claude Code inside | `docker-sandbox.ts` (L71: `IMAGE_REPO`), `Dockerfile` (L71: `npm install -g @anthropic-ai/claude-code`) | Image name + CLI install |
| **Stream protocol** | `--output-format stream-json` / `--input-format stream-json` | `docker-sandbox.ts` (L267-271), `docker-agent.ts` (L151, L171) | Input + output format flags |
| **Event schema** | `StreamEventParser` parses Claude's `init`, `message`, `tool_use`, `tool_result`, `result`, `content_block_delta` | `stream-parser.ts` (L19-122 types, L127-188 parsing, L226-274 class) | 10 event types, field normalization |
| **Session management** | `claude --resume <sessionId>`, `~/.claude/projects/` | `terminal.ts` (L36-59: `claudeSessionExists`, L93-124: command building, L167-177: clear detection) | Session storage path + format |
| **Auth** | `claude setup-token` OAuth flow, token regex `sk-ant-oat01-...AA` | `oauth-setup.ts` (L44-114), `config.ts` (token storage) | Token format assumption |
| **Tool proxy** | Generic HTTP proxy -- **already agent-agnostic** | `tool-proxy.ts`, `wrapper-generator.ts` | Only exception: L362-369 Co-authored-by trailer |
| **Flags** | `claudeFlags` array, `--dangerously-skip-permissions` | `docker-sandbox.ts` (L41), `docker-agent.ts` (L56), `standalone.ts` (L464, L921, L1065), `shared/types.ts` | Field name + flag values |
| **Nudge protocol** | `{type: "user", message: {role: "user", content: "..."}}` via stdin | `docker-agent.ts` (L185-189: initial prompt, L311-315: nudge) | Claude-specific JSON format |
| **Model names** | `'opus' \| 'sonnet' \| 'haiku'` hardcoded as `AgentModel` type | `shared/types.ts` (L126), used in 20+ files | Type system + UI dropdowns |
| **Attention hooks** | `hooks.Stop` + `hooks.Notification` in `~/.claude/settings.json` | `hook-manager.ts` (L24-36, L71-129), `socket-server.ts` | Claude Code hook system |
| **Custom prompts** | 10 prompt types stored in settings, Claude-specific instructions | `settings-manager.ts` (L77-88), `prompt-templates.ts` | Prompt format per provider |
| **~~Trust prompts~~** | ~~Auto-accepts Claude's "Yes, I trust this folder" prompts~~ | `terminal.ts` (L198-207) | **Dead code -- doesn't work, remove** |
| **~~Accept mode~~** | ~~Cycles through Claude's accept modes via Shift+Tab~~ | `terminal.ts` (L223-246) | **Dead code -- unused, remove** |

### Coupling Severity by File

| File | Coupling Level | Changes Needed |
|------|---------------|----------------|
| `docker-sandbox.ts` | **Critical** | Command building, env vars, image selection → provider |
| `headless/docker-agent.ts` | **Critical** | Options type, nudge format, stdin protocol → provider |
| `terminal.ts` | **Critical** | Binary name, session mgmt → provider. Trust prompts + accept mode are dead code (remove). |
| `stream-parser.ts` | **Critical** | Event types, field normalization → provider-specific parser |
| `headless/standalone.ts` | **High** | claudeFlags, model flags, --add-dir flag at L464, L921, L1065 |
| `shared/types.ts` | **High** | `AgentModel`, `ContainerConfig.claudeFlags`, `RalphLoopConfig.model` |
| `oauth-setup.ts` | **High** | Entire file is Claude-specific auth flow |
| `hook-manager.ts` | **High** | Claude Code hook paths + registration |
| `settings-manager.ts` | **Medium** | Provider settings, prompt storage, image management |
| `ralph-loop.ts` | **Medium** | Model names, claudeFlags at L549 |
| `description-generator.ts` | **Medium** | `runClaudePrompt()` utility function |
| `repo-grouper.ts` | **Medium** | `runClaudePrompt()` utility function |
| `tool-proxy.ts` | **Low** | Only Co-authored-by trailer (L362-369) |
| `wrapper-generator.ts` | **None** | Already agent-agnostic |

---

## Codex Has Comparable Primitives

| Bismarck Concept | Claude Code | Codex Equivalent |
|-----------------|-------------|------------------|
| Headless agent | `claude --output-format stream-json -p "prompt"` | `codex exec --json "prompt"` |
| Streaming events | NDJSON: `message`, `tool_use`, `tool_result` | JSONL: `item.started`, `item.completed`, `turn.completed` |
| Full auto mode | `--dangerously-skip-permissions` | `--full-auto` or `--sandbox workspace-write --ask-for-approval never` |
| Session resume | `claude --resume <id>` | `codex exec resume <SESSION_ID>` |
| Stdin nudges | `--input-format stream-json` + JSON on stdin | `turn/steer` via app-server (NOT stdin in exec mode) |
| Model selection | `--model sonnet\|opus` | `--model gpt-5-codex` etc. |
| MCP tools | Native MCP support | `codex mcp add/list` |
| Docker/sandbox | External Docker container | Built-in `--sandbox` (macOS seatbelt / Linux Landlock) |
| Rich integration | N/A | `codex app-server` (JSON-RPC over stdio, thread mgmt, approvals, TS schemas) |
| Hooks | `~/.claude/settings.json` hooks | TBD (hook system in PR stage) |

### Codex Event Format (--json mode)

```jsonl
{"type":"thread.started","threadId":"thr_abc"}
{"type":"turn.started","turnId":"turn_123"}
{"type":"item.started","item":{"id":"item_1","type":"agent_message"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello!"}}
{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"npm test"}}
{"type":"item.completed","item":{"id":"item_2","type":"command_execution","exitCode":0,"output":"..."}}
{"type":"item.started","item":{"id":"item_3","type":"file_changes","diffs":[...]}}
{"type":"item.completed","item":{"id":"item_3","type":"file_changes"}}
{"type":"turn.completed","usage":{"input_tokens":24763,"output_tokens":122}}
```

Item types: `agent_message`, `command_execution`, `file_changes`, `mcp_tool_call`, `web_search`, `reasoning`, `plan`

### Codex App-Server Protocol (richer alternative)

`codex app-server` provides proper JSON-RPC over stdio:
- `thread/start`, `thread/resume`, `thread/fork`, `thread/list`
- `turn/start`, `turn/steer`, `turn/interrupt`
- `item/started`, `item/completed`, `item/agentMessage/delta`
- Approval flow: `item/requestApproval` → client responds accept/decline
- Auth: `account/login/start`, supports API key, OAuth, or host-supplied tokens
- TypeScript schemas: `codex app-server generate-ts`

---

## Implementation Plan

### Phase 1: Agent Provider Abstraction

**Goal**: Create the interface layer so both Claude and Codex can plug in.

#### 1.1 Define `AgentProvider` interface

```typescript
// src/main/agents/types.ts

type AgentProviderType = 'claude' | 'codex'

interface AgentProvider {
  type: AgentProviderType
  name: string // "Claude Code", "OpenAI Codex"
  binaryName: string // 'claude', 'codex'

  // Headless agent spawning
  buildHeadlessCommand(opts: HeadlessCommandOptions): { command: string; args: string[] }
  buildHeadlessEnv(opts: HeadlessCommandOptions): Record<string, string>

  // Interactive terminal
  buildInteractiveCommand(opts: InteractiveCommandOptions): string
  detectClearSignal(output: string): boolean // e.g. Claude's "(no content)"

  // Event stream parsing
  createEventParser(): AgentEventParser

  // Stdin protocol
  formatInitialPrompt(prompt: string): string // JSON format for stdin
  formatNudge(message: string): string // JSON format for mid-turn nudge
  supportsStdinNudges(): boolean

  // Session management
  sessionExists(sessionId: string): boolean
  getResumeArgs(sessionId: string): string[]
  getSessionStoragePath(): string

  // Auth
  authenticate(): Promise<void>
  isAuthenticated(): Promise<boolean>

  // Docker
  getDefaultImage(): string // e.g. 'bismarckapp/bismarck-agent-claude'
  requiresDocker(): boolean // Codex may not need Docker

  // Hooks / Attention
  registerHooks(config: HookRegistrationConfig): Promise<void>
  supportsHooks(): boolean

  // Metadata
  getCoAuthorTrailer(): string // for git commits
  getAvailableModels(): string[] // ['opus', 'sonnet'] or ['gpt-5-codex']

  // Capabilities
  capabilities: {
    nativeSandbox: boolean
    appServerProtocol: boolean
    stdinNudges: boolean
    mcp: boolean
    hooks: boolean
  }
}

interface HeadlessCommandOptions {
  prompt: string
  model?: string
  fullAuto?: boolean
  mode?: 'plan' | 'execute' // plan mode restricts tools
  allowedTools?: string[] // for plan mode
  additionalFlags?: string[]
  env?: Record<string, string>
}

interface InteractiveCommandOptions {
  sessionId?: string
  resumeSessionId?: string
  prompt?: string
  model?: string
  flags?: string[]
}
```

#### 1.2 Define unified event types

```typescript
// src/main/agents/events.ts

type UnifiedEventType =
  | 'session_init'
  | 'agent_message'
  | 'agent_message_delta'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'file_change'
  | 'turn_completed'
  | 'system_message'
  | 'error'

interface UnifiedEvent {
  type: UnifiedEventType
  timestamp: string
  provider: AgentProviderType
  raw: unknown // original event for debugging

  // Fields populated based on type
  sessionId?: string         // session_init
  text?: string              // agent_message, agent_message_delta
  toolName?: string          // tool_call_started/completed
  toolId?: string            // tool_call_started/completed
  toolInput?: unknown        // tool_call_started
  toolOutput?: string        // tool_call_completed
  toolError?: boolean        // tool_call_completed
  exitCode?: number          // tool_call_completed (for commands)
  diffs?: unknown[]          // file_change
  cost?: UnifiedCost         // turn_completed
  error?: { message: string; code?: string } // error
}

interface UnifiedCost {
  input_tokens: number
  output_tokens: number
  total_cost_usd?: number  // optional -- Codex may not provide USD
  raw_usage?: unknown      // provider-specific metadata
}

interface AgentEventParser extends EventEmitter {
  write(data: string | Buffer): void
  end(): void
  // Emits: 'event' (UnifiedEvent)
}
```

#### 1.3 Create provider registry

```typescript
// src/main/agents/registry.ts

const providers = new Map<AgentProviderType, AgentProvider>()

function registerProvider(provider: AgentProvider): void
function getProvider(type: AgentProviderType): AgentProvider
function getDefaultProvider(): AgentProvider // from settings
function listProviders(): AgentProvider[]
```

**Files to create:**
- `src/main/agents/types.ts` -- interfaces
- `src/main/agents/events.ts` -- unified event types
- `src/main/agents/registry.ts` -- provider registry
- `src/main/agents/claude/` -- Claude implementation directory
- `src/main/agents/codex/` -- Codex implementation directory

---

### Phase 2: Extract Claude Provider

**Goal**: Move all Claude-specific logic into `ClaudeProvider` without changing behavior. Pure refactor -- zero behavior change.

#### 2.1 Extract from `docker-sandbox.ts`

Move to `ClaudeProvider.buildHeadlessCommand()`:
- L265: `args.push('claude')` → `provider.binaryName`
- L266: `--dangerously-skip-permissions` → `provider.buildHeadlessCommand({fullAuto: true})`
- L267-269: `--allowedTools`, `-p`, `--output-format stream-json`, `--verbose`, `--model sonnet`
- L274-289: execution mode with `--input-format stream-json`, `--output-format stream-json`, `--verbose`

Move to `ClaudeProvider.buildHeadlessEnv()`:
- L228: `CLAUDE_CODE_OAUTH_TOKEN` → provider-specific env vars

Keep `buildDockerArgs()` as shared infrastructure, calling provider for agent-specific parts.

#### 2.2 Extract from `terminal.ts`

Move to `ClaudeProvider`:
- L36-59 `claudeSessionExists()` → `provider.sessionExists()`
- L98 `claudeCmd = 'claude'` → `provider.binaryName`
- L100-114 `--resume`/`--session-id` → `provider.buildInteractiveCommand()`
- L142 `CLAUDE_CODE_ENTRY_POINT` → `provider.buildHeadlessEnv()`
- L169 `"(no content)"` detection → `provider.detectClearSignal()`
- L198-207 trust prompt auto-accept → **delete** (dead code, doesn't work)
- L223-246 accept mode cycling → **delete** (dead code, unused)

#### 2.3 Extract from `stream-parser.ts`

Create `src/main/agents/claude/event-parser.ts`:
- Current `StreamEventParser` becomes `ClaudeEventParser implements AgentEventParser`
- Field normalization (L152-159: `name`→`tool_name`, L164-181: `tool_use_id`→`tool_id`) stays internal
- Maps Claude events → `UnifiedEvent` format
- Existing event types (`message`, `tool_use`, `tool_result`, etc.) stay as internal implementation detail

#### 2.4 Extract from `oauth-setup.ts`

Create `src/main/agents/claude/auth.ts`:
- `claude setup-token` → `ClaudeProvider.authenticate()`
- Token regex `sk-ant-oat01-...AA` → provider-internal validation
- Token storage in `oauth-token.json` → stays Claude-specific

#### 2.5 Extract from `hook-manager.ts`

Create `src/main/agents/claude/hooks.ts`:
- `getClaudeSettingsPath()` → `ClaudeProvider.registerHooks()`
- Stop hook script generation → provider-internal
- `~/.claude/settings.json` hook registration → provider-internal

#### 2.6 Rename `claudeFlags` throughout

- `HeadlessAgentOptions.claudeFlags` → `agentFlags`
- `ContainerConfig.claudeFlags` → `agentFlags`
- Update all callers in: `standalone.ts` (L464, L921, L1065), `ralph-loop.ts` (L549), `team-agents.ts` (L455-467)

#### 2.7 Generalize `AgentModel` type

- `shared/types.ts` L126: `type AgentModel = 'opus' | 'sonnet' | 'haiku'` → `type AgentModel = string`
- Provider determines valid models via `getAvailableModels()`
- UI model dropdowns become dynamic based on provider

**Key principle**: This phase should be a pure refactor -- zero behavior change, just moving code behind the provider interface.

**Files to modify:**
- `docker-sandbox.ts` -- extract command/env building
- `terminal.ts` -- extract session/interactive logic
- `stream-parser.ts` -- extract to `ClaudeEventParser`
- `oauth-setup.ts` -- extract to `ClaudeProvider.authenticate()`
- `hook-manager.ts` -- extract hook registration
- `headless/docker-agent.ts` -- use provider for nudge format, options type
- `headless/standalone.ts` -- use provider for flags/model
- `ralph-loop.ts` -- use provider for model flags
- `headless/team-agents.ts` -- use provider for model flags
- `shared/types.ts` -- generalize `AgentModel`, rename `claudeFlags`

---

### Phase 2.5: Settings & Type Migration

**Goal**: Create provider-aware settings structure and migrate existing data. This phase is critical because it touches the type system that flows through the entire app.

#### 2.5.1 Update `AppSettings`

```typescript
// In settings-manager.ts
agent: {
  defaultProvider: AgentProviderType  // default: 'claude'
  providers: {
    claude: {
      model?: string           // 'opus', 'sonnet', 'haiku'
      dockerImage?: string     // migrated from docker.selectedImage
    }
    codex: {
      model?: string           // 'gpt-5-codex', etc.
      nativeSandbox?: boolean  // use codex sandbox vs Docker
    }
  }
}
docker: {
  // Existing fields stay
  images: string[]             // keep for backward compat
  imagesByProvider: Record<AgentProviderType, string[]>       // NEW
  selectedImageByProvider: Record<AgentProviderType, string>  // NEW
}
prompts: {
  // Currently stores 10 prompt types
  // Need per-provider prompt storage
  [provider: string]: Record<CustomizablePromptType, string | null>
}
```

#### 2.5.2 Settings migration

Add migration #8 (currently 7 migrations exist) in `loadSettings()`:
- Migrate `docker.selectedImage` → `docker.selectedImageByProvider.claude`
- Migrate flat `prompts` → `prompts.claude`
- Set `agent.defaultProvider = 'claude'` if not present
- Preserve backward compatibility with deep merge logic

#### 2.5.3 Auth storage migration

- Currently: `oauth-token.json` in config dir (Claude-specific)
- New: Provider-aware token storage per provider
- Migration: Keep existing `oauth-token.json` as Claude's token source

#### 2.5.4 Update IPC handlers

Provider-aware IPC handlers needed:
```typescript
// New handlers
'get-agent-providers'        → list available providers + auth status
'set-default-provider'       → update settings
'authenticate-provider'      → trigger auth flow for specific provider
'get-provider-models'        → list models for a provider

// Updated handlers (add provider parameter)
'start-standalone-headless-agent'  → add provider option
'start-ralph-loop'                 → add provider option
'get-settings' / 'update-settings' → include provider structure
'add-docker-image'                 → add provider tag
'set-selected-docker-image'        → provider-aware
'get-custom-prompts'               → provider-scoped
```

**Files to modify:**
- `settings-manager.ts` -- type, migrations, helper functions
- `shared/types.ts` -- `AppSettings`, `AgentModel`, `ContainerConfig`, `RalphLoopConfig`, `HeadlessAgentInfo`
- `main.ts` -- IPC handler signatures
- `preload.ts` -- exposed API signatures
- `electron.d.ts` -- renderer type declarations

---

### Phase 3: Implement Codex Provider

**Goal**: Create `CodexProvider` that can spawn and communicate with Codex agents.

#### 3.1 Headless mode via `codex exec --json`

```typescript
class CodexProvider implements AgentProvider {
  type = 'codex' as const
  name = 'OpenAI Codex'
  binaryName = 'codex'

  buildHeadlessCommand(opts) {
    return {
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--full-auto',
        ...(opts.model ? ['--model', opts.model] : []),
        ...opts.additionalFlags,
        opts.prompt
      ]
    }
  }

  formatNudge(message: string): string {
    // NOTE: codex exec --json does NOT support stdin nudges
    // Must use app-server for mid-turn steering
    throw new Error('Codex exec mode does not support nudges. Use app-server protocol.')
  }

  supportsStdinNudges(): boolean {
    return false // Only app-server supports turn/steer
  }
}
```

#### 3.2 Event parser mapping

```typescript
class CodexEventParser extends EventEmitter implements AgentEventParser {
  write(data: string | Buffer) {
    // Parse JSONL, map to UnifiedEvent
  }
}
```

Complete event mapping table:

| Codex Event | Codex Item Type | Unified Event | Notes |
|-------------|----------------|---------------|-------|
| `thread.started` | -- | `session_init` | **Missing from original plan** |
| `turn.started` | -- | *(no unified equivalent, internal tracking only)* | |
| `item.started` | `agent_message` | `agent_message` (streaming start) | |
| `item/agentMessage/delta` | -- | `agent_message_delta` | Verify actual payload format |
| `item.completed` | `agent_message` | `agent_message` | `.text` field |
| `item.started` | `command_execution` | `tool_call_started` | `.command` field |
| `item.completed` | `command_execution` | `tool_call_completed` | `.exitCode` + `.output` |
| `item.started` | `file_changes` | *(no unified started event)* | |
| `item.completed` | `file_changes` | `file_change` | `.diffs` array |
| `item.completed` | `mcp_tool_call` | `tool_call_completed` | |
| `item.completed` | `web_search` | `tool_call_completed` | toolName = 'web_search' |
| `item.completed` | `reasoning` | `agent_message` | Internal reasoning |
| `item.completed` | `plan` | `agent_message` | Plan output |
| `turn.completed` | -- | `turn_completed` | `.usage` → `UnifiedCost` (no USD) |
| `turn.failed` | -- | `error` | |
| `content_block_start` | *(Claude only)* | -- | No Codex equivalent needed |
| `content_block_stop` | *(Claude only)* | -- | Fold into agent_message lifecycle |
| `system` *(Claude only)* | -- | `system_message` or `error` | Based on subtype |

**Key differences from original plan:**
- Added `thread.started` → `session_init` mapping (was missing)
- Added `content_block_start/stop` → noting these are Claude-only
- Added `system` event mapping
- Added `reasoning` and `plan` item type mappings
- Noted Codex `usage` doesn't include USD

#### 3.3 Interactive terminal

```typescript
buildInteractiveCommand(opts) {
  if (opts.resumeSessionId) {
    return `codex exec resume ${opts.resumeSessionId}`
  }
  return `codex ${opts.flags?.join(' ') || ''} "${opts.prompt}"`
}

detectClearSignal(output: string): boolean {
  // TBD: determine Codex's equivalent of Claude's "(no content)"
  return false
}

// No auto-accept needed -- dead code removed from terminal.ts
```

#### 3.4 Auth

```typescript
async authenticate() {
  // codex login --with-api-key or codex login (OAuth)
  // Multiple auth methods -- UI should let user choose
}
async isAuthenticated() {
  // codex login status (exit code 0 = logged in)
}
```

#### 3.5 Attention / Hooks

**Critical gap identified by investigation**: Bismarck's attention system works via Claude Code hooks (`hooks.Stop`, `hooks.Notification`). Codex's hook system is still in PR stage.

Options:
- **Option A (Recommended)**: If Codex supports hooks, generate equivalent hook scripts that call the same Unix socket interface
- **Option B**: Monitor stdout for specific pause patterns
- **Option C**: Use Codex app-server's `item/requestApproval` event as attention trigger

The attention system itself is ~90% agent-agnostic (just workspace ID queue + Unix socket). Only the trigger mechanism needs adaptation.

**Files to create:**
- `src/main/agents/codex/provider.ts` -- CodexProvider implementation
- `src/main/agents/codex/event-parser.ts` -- CodexEventParser
- `src/main/agents/codex/auth.ts` -- Codex authentication
- `src/main/agents/codex/hooks.ts` -- Codex hook registration (when available)

---

### Phase 4: Docker Strategy for Codex

**Goal**: Determine how Codex agents run in containers (or if they need to).

#### Option A: Codex Native Sandbox (Recommended for v1)

Codex has built-in sandboxing (`--sandbox workspace-write`) using macOS seatbelt / Linux Landlock. For local execution, Docker may not be necessary.

- Skip Docker entirely for Codex agents running locally
- Use `--sandbox workspace-write` for filesystem isolation
- Use `--ask-for-approval never` for full automation
- Provider's `requiresDocker()` returns `false`

**Implication**: `docker-agent.ts` needs a non-Docker execution path. Consider extracting a `LocalAgentRunner` that spawns the process directly (no container).

#### Option B: Separate Docker Images (Future)

If Docker is needed (e.g., for network isolation, reproducible environments):
- `bismarckapp/bismarck-agent-claude:v{version}` -- current image
- `bismarckapp/bismarck-agent-codex:v{version}` -- new image with Codex CLI installed
- Provider determines which image to use

Docker image build:
```dockerfile
# Parameterize with build arg
ARG AGENT_CLI=claude
RUN npm install -g @anthropic-ai/${AGENT_CLI} || npm install -g ${AGENT_CLI}
```

#### Option C: Base Image + Runtime Install

Single base image, provider binary installed at container start. Slower but simpler to maintain.

**Recommendation**: Start with Option A (no Docker for Codex), add Option B if users need container isolation.

---

### Phase 5: Settings & UI

**Goal**: Let users choose their agent provider and see provider-specific UI.

#### 5.1 Authentication Settings UI

Current `AuthenticationSettings.tsx` (522 lines) needs:
- Provider selector dropdown at top
- Dynamic auth UI based on provider:
  - Claude: OAuth button (current behavior)
  - Codex: OAuth OR API key input
- Status indicators: "Claude: Configured", "Codex: Not configured"
- Provider-specific token validation

#### 5.2 Docker Settings UI

Current `DockerSettings.tsx` needs:
- Provider-specific image selection dropdown
- Conditional UI: hide Docker settings if Codex + native sandbox
- Image status checking per-provider

#### 5.3 General Settings

- Default provider selector in General or new "Agent" section
- Per-provider model selector (dynamic list from `provider.getAvailableModels()`)
- Provider badge on agent cards in workspace view

#### 5.4 Plan / Ralph Loop UI

- Provider selector in plan creation dialog (optional, future)
- Show provider badge on running plans
- Model dropdown uses provider-specific models

#### 5.5 New IPC handlers

- `get-agent-providers` → list available providers with auth status
- `set-default-provider` → update settings
- `authenticate-provider` → trigger auth flow for selected provider
- `get-provider-models` → list valid models for a provider

---

### Phase 6: Utility Agent Calls

**Goal**: Make repo-grouper, description-generator, and other utility uses provider-agnostic.

#### Current utility agent usage

| File | Function | Purpose | Claude Coupling |
|------|----------|---------|-----------------|
| `description-generator.ts` | `runClaudePrompt()` (L314-369) | Auto-generate repo descriptions in setup wizard | Spawns `claude -p --output-format json --model haiku` |
| `repo-grouper.ts` | `runClaudePrompt()` (L137-184) | Group repos into tabs during setup | Spawns `claude -p --output-format json --model haiku` |

#### Approach: Route through provider (Recommended)

Extract `runClaudePrompt()` into provider-agnostic `runUtilityPrompt()`:

```typescript
async function runUtilityPrompt(
  prompt: string,
  provider: AgentProvider,
  opts?: { model?: string; cwd?: string }
): Promise<string> {
  const { command, args } = provider.buildHeadlessCommand({
    prompt,
    model: opts?.model || provider.getAvailableModels()[0], // cheapest model
    fullAuto: true,
  })
  const child = spawn(command, args, { cwd: opts?.cwd })
  // Parse provider-specific JSON output
  return extractResult(child.stdout, provider)
}
```

**Graceful degradation**: If default provider not authenticated:
- Show fallback UI: "Repository analysis requires {provider} authentication. [Authenticate] [Skip]"
- Allow skipping analysis during setup wizard

**Files to modify:**
- `description-generator.ts` -- replace `runClaudePrompt`
- `repo-grouper.ts` -- replace `runClaudePrompt`
- Setup wizard component -- add auth check before analysis

---

## Event Flow Architecture (Current → Target)

### Current Flow
```
Container stdout → StreamEventParser → HeadlessAgent → consumers
                   (Claude-specific)   (transparent    (team-agents,
                                        event relay)    ralph-loop,
                                                        plan-phase,
                                                        renderer via IPC)
```

### Target Flow
```
Container/Process stdout → AgentEventParser → UnifiedEvent → HeadlessAgent → consumers
                           (ClaudeEventParser                (transparent    (unchanged)
                            or CodexEventParser)              event relay)
```

### Full Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Docker Container OR Local Process                           │
│   claude/codex exec → stdout NDJSON/JSONL                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│ AgentEventParser (provider.createEventParser())             │
│   ClaudeEventParser:                                        │
│     - Parse NDJSON, normalize fields                        │
│     - message/tool_use/tool_result/result → UnifiedEvent    │
│   CodexEventParser:                                         │
│     - Parse JSONL                                           │
│     - item.completed/turn.completed → UnifiedEvent          │
│   Emits: 'event' (UnifiedEvent)                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│ HeadlessAgent (docker-agent.ts)                             │
│   - Store events in this.events[]                           │
│   - Extract text (agent_message → emit 'message')           │
│   - Detect completion (turn_completed → emit 'complete')    │
│   - Re-emit 'event' to parent                               │
│   - Handle nudges via provider.formatNudge()                │
└────────────┬────────────────────┬────────────────────────────┘
             │                    │
             v                    v
┌────────────────────┐   ┌───────────────────────────────────┐
│ team-agents.ts     │   │ ralph-loop.ts                     │
│  - Persist events  │   │  - Check completion phrase        │
│  - IPC to renderer │   │  - Accumulate costs               │
└────────────┬───────┘   └───────────────┬───────────────────┘
             │                            │
             v                            v
┌─────────────────────────────────────────────────────────────┐
│ Renderer (UI)                                               │
│   - Display events in terminal-like view                    │
│   - Show costs (with UnifiedCost)                           │
│   - Provider badge on agent cards                           │
└─────────────────────────────────────────────────────────────┘
```

### Attention System Flow (Separate Path)

```
┌─────────────────────────────────────────────────────────────┐
│ Agent pauses for input                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     v
┌─────────────────────────────────────────────────────────────┐
│ Provider Hook (Claude: hooks.Stop, Codex: TBD)              │
│   stop-hook.sh → extract session_id → lookup workspace_id   │
└────────────────────┬────────────────────────────────────────┘
                     │ Unix socket: /tmp/bm/{instance}/{workspace}.sock
                     v
┌─────────────────────────────────────────────────────────────┐
│ Socket Server (agent-agnostic)                              │
│   waitingQueue: string[] → IPC → Renderer                   │
│   macOS notification → tray badge                           │
└─────────────────────────────────────────────────────────────┘
```

The attention system is **~90% agent-agnostic**. Only the hook trigger mechanism needs provider adaptation. The socket protocol, queue management, and UI are all generic.

---

## Effort Estimate (Revised)

| Phase | Effort | Risk | Notes |
|-------|--------|------|-------|
| Phase 1: Provider abstraction | 3-4 days | Low | Types/interfaces + registry. Must get right -- everything builds on this. |
| Phase 2: Extract Claude provider | 5-6 days | **High** | Refactor across 10+ files. Zero behavior change required. Most critical phase. |
| Phase 2.5: Settings & type migration | 3-4 days | Medium | 8th migration path, IPC signatures, shared types cascade. |
| Phase 3: Codex provider | 4-5 days | Medium | Event parser mapping is tricky. Nudge limitation (no stdin in exec mode). |
| Phase 4: Docker strategy | 2-3 days | Low | LocalAgentRunner extraction if skipping Docker for Codex. |
| Phase 5: Settings & UI | 4-5 days | Medium | Auth UI, Docker UI, model dropdowns, provider badges. 50+ IPC handler touches. |
| Phase 6: Utility agents | 2 days | Low | Two files + graceful degradation UI. |
| **Total** | **~4-5 weeks** | | |

**Why 2x the original estimate:**
1. Settings complexity -- custom prompts (10 types), OAuth migration, Docker image management per provider
2. Type system breadth -- `AgentModel` used in 20+ files, `ContainerConfig` passed through 5 layers
3. IPC surface area -- 50+ handlers need provider awareness
4. Attention hook adaptation -- not mentioned in original plan
5. ~~Terminal automation (trust prompts, accept mode cycling)~~ -- dead code, just delete
6. Nudge protocol gap -- Codex exec mode doesn't support stdin nudges

---

## Critical Path

```
Phase 1 (abstraction)
    ↓
Phase 2 (extract Claude) ←── CRITICAL: if this is clean, everything follows
    ↓
Phase 2.5 (settings/types) ←── parallel with Phase 3 once interfaces stable
    ↓
Phase 3 (Codex provider)
    ↓
Phase 4 (Docker) → Phase 5 (UI) → Phase 6 (utilities)
```

Phase 2 is the critical path. The quality of the Claude extraction determines whether adding Codex (or any future provider) is straightforward or painful.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Codex hook system not ready | Attention doesn't work for Codex agents | Option B: stdout monitoring as fallback |
| Codex exec mode lacks stdin nudges | Ralph loop can't nudge Codex agents mid-turn | Use app-server protocol for v2, or accept no-nudge for v1 |
| Settings migration breaks existing installations | Users lose config on upgrade | Thorough migration testing, backup before migrate |
| `AgentModel` type change cascades through 20+ files | Large refactor blast radius | Do it in Phase 2.5 as focused PR, TypeScript compiler guides changes |
| Cost tracking differs (Codex has no USD) | Inconsistent cost display | `UnifiedCost.total_cost_usd` is optional, add pricing service later |
| Prompt templates are Claude-optimized | Codex may perform poorly with Claude-style prompts | Per-provider prompt templates from Phase 2.5 |

---

## Open Questions

1. **App-server vs exec mode?** Codex's `codex app-server` JSON-RPC protocol is richer and better structured than `codex exec --json`. Should we target it for v2? It would give us proper thread management, mid-turn steering (fixing the nudge limitation), and approval flows.

2. **Per-plan provider selection?** Should users be able to choose Claude for one plan and Codex for another? This adds complexity but is powerful. Recommendation: defer to v2.

3. **Tool proxy compatibility?** The current tool proxy is already agent-agnostic (HTTP proxy for git/gh/bd). Codex with `--sandbox workspace-write` should be able to access host tools directly. Verify this.

4. **Codex hooks maturity?** Codex's hook system is still in PR stage. If Bismarck relies on hooks for attention, this is a blocker for that feature. Attention can work without hooks (degraded: no waiting notification).

5. **Cost tracking?** Claude reports `total_cost_usd` in result events. Codex reports `usage` (tokens only) per turn. Need: (a) per-turn accumulation, (b) optional pricing service for USD calculation.

6. **Codex delta format?** Plan mentions `item/agentMessage/delta` but exact payload structure needs verification against actual Codex output before implementing parser.

7. **Local execution path?** If Codex skips Docker, we need `LocalAgentRunner` alongside `DockerAgentRunner`. How much shared logic? Should `HeadlessAgent` become abstract base class?
