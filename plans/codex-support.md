# Codex Support: Making Bismarck Agent-Agnostic

## Context

Bismarck is currently tightly coupled to Claude Code at every layer: binary invocation, Docker image, stream protocol, event schema, session management, auth, and tool proxy. There is no agent abstraction layer -- no `AgentProvider` interface, no factory pattern, no runtime provider selection.

This plan outlines what it would take to support OpenAI Codex as a second agent backend, and in doing so, create the abstraction layer needed for any future provider.

---

## Current Claude Code Coupling Points

| Layer | How It's Coupled | Files |
|-------|-----------------|-------|
| **Binary** | Hardcoded `'claude'` pushed into args | `docker-sandbox.ts`, `terminal.ts`, `oauth-setup.ts`, `repo-grouper.ts`, `description-generator.ts` |
| **Docker image** | `bismarckapp/bismarck-agent` ships Claude Code inside | `docker-sandbox.ts` (lines 64-77) |
| **Stream protocol** | `--output-format stream-json` / `--input-format stream-json` | `docker-sandbox.ts` (lines 267-271), `docker-agent.ts` |
| **Event schema** | `StreamEventParser` parses Claude's `init`, `message`, `tool_use`, `tool_result`, `result`, `content_block_delta` | `stream-parser.ts` (lines 19-122, 226-250+) |
| **Session management** | `claude --resume <sessionId>`, `~/.claude/projects/` | `terminal.ts` (lines 98-124) |
| **Auth** | `claude setup-token` OAuth flow | `oauth-setup.ts` (line 51) |
| **Tool proxy** | Built around Claude Code's tool invocation model | `tool-proxy.ts`, `wrapper-generator.ts` |
| **Flags** | `claudeFlags` array, `--dangerously-skip-permissions` | `docker-sandbox.ts`, `docker-agent.ts`, `shared/types.ts` |

---

## Codex Has Comparable Primitives

| Bismarck Concept | Claude Code | Codex Equivalent |
|-----------------|-------------|------------------|
| Headless agent | `claude --output-format stream-json -p "prompt"` | `codex exec --json "prompt"` |
| Streaming events | NDJSON: `message`, `tool_use`, `tool_result` | JSONL: `item.started`, `item.completed`, `turn.completed` |
| Full auto mode | `--dangerously-skip-permissions` | `--full-auto` or `--sandbox workspace-write --ask-for-approval never` |
| Session resume | `claude --resume <id>` | `codex exec resume <SESSION_ID>` |
| Stdin nudges | `--input-format stream-json` + JSON on stdin | `turn/steer` via app-server, or new prompt via stdin |
| Model selection | `--model sonnet\|opus` | `--model gpt-5-codex` etc. |
| MCP tools | Native MCP support | `codex mcp add/list` |
| Docker/sandbox | External Docker container | Built-in `--sandbox` (macOS seatbelt / Linux Landlock) |
| Rich integration | N/A | `codex app-server` (JSON-RPC over stdio, thread mgmt, approvals, TS schemas) |

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

  // Headless agent spawning
  buildHeadlessCommand(opts: HeadlessCommandOptions): { command: string; args: string[] }
  buildHeadlessEnv(opts: HeadlessCommandOptions): Record<string, string>

  // Interactive terminal
  buildInteractiveCommand(opts: InteractiveCommandOptions): string // shell command string

  // Event stream parsing
  createEventParser(): AgentEventParser

  // Session management
  getResumeArgs(sessionId: string): string[]
  getSessionStoragePath(): string

  // Auth
  authenticate(): Promise<void>
  isAuthenticated(): Promise<boolean>

  // Capabilities
  capabilities: {
    nativeSandbox: boolean      // Can sandbox without Docker?
    appServerProtocol: boolean  // Supports richer integration?
    stdinNudges: boolean        // Can receive mid-turn input?
    mcp: boolean                // MCP support?
  }
}

interface HeadlessCommandOptions {
  prompt: string
  model?: string
  fullAuto?: boolean
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
  | 'error'

interface UnifiedEvent {
  type: UnifiedEventType
  raw: unknown // original event for debugging

  // Fields populated based on type
  text?: string              // agent_message, agent_message_delta
  toolName?: string          // tool_call_started/completed
  toolInput?: unknown        // tool_call_started
  toolOutput?: string        // tool_call_completed
  exitCode?: number          // tool_call_completed (for commands)
  cost?: CostInfo            // turn_completed
  tokenUsage?: TokenUsage    // turn_completed
  error?: string             // error
}

interface AgentEventParser extends EventEmitter {
  write(data: string | Buffer): void
  // Emits: 'event' (UnifiedEvent), 'raw' (original parsed JSON)
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
- `src/main/agents/claude-provider.ts` -- Claude implementation (extract from current code)
- `src/main/agents/codex-provider.ts` -- Codex implementation

---

### Phase 2: Extract Claude Provider

**Goal**: Move all Claude-specific logic into `claude-provider.ts` without changing behavior.

#### 2.1 Extract from `docker-sandbox.ts`
- Move command construction (`'claude'`, `--dangerously-skip-permissions`, `--output-format stream-json`, etc.) into `ClaudeProvider.buildHeadlessCommand()`
- Keep `buildDockerArgs()` as shared infrastructure but have it call the provider for agent-specific parts

#### 2.2 Extract from `terminal.ts`
- Move interactive command building (`claude --session-id X`, `claude --resume X`) into `ClaudeProvider.buildInteractiveCommand()`

#### 2.3 Extract from `stream-parser.ts`
- Current `StreamEventParser` becomes `ClaudeEventParser implements AgentEventParser`
- It maps Claude events → `UnifiedEvent` format
- The existing event types (`message`, `tool_use`, `tool_result`, etc.) stay as internal implementation detail

#### 2.4 Extract from `oauth-setup.ts`
- `claude setup-token` → `ClaudeProvider.authenticate()`

#### 2.5 Rename `claudeFlags` throughout
- `HeadlessAgentOptions.claudeFlags` → `agentFlags` (or similar)
- `ContainerConfig.claudeFlags` → `agentFlags`
- Update all callers

**Key principle**: This phase should be a pure refactor -- zero behavior change, just moving code behind the provider interface.

---

### Phase 3: Implement Codex Provider

**Goal**: Create `CodexProvider` that can spawn and communicate with Codex agents.

#### 3.1 Headless mode via `codex exec --json`

```typescript
class CodexProvider implements AgentProvider {
  buildHeadlessCommand(opts) {
    return {
      command: 'codex',
      args: [
        'exec',
        '--json',
        '--full-auto',           // equivalent to --dangerously-skip-permissions
        ...(opts.model ? ['--model', opts.model] : []),
        ...opts.additionalFlags,
        opts.prompt
      ]
    }
  }
}
```

#### 3.2 Event parser mapping

```typescript
class CodexEventParser extends EventEmitter implements AgentEventParser {
  write(data: string | Buffer) {
    // Parse JSONL, map to UnifiedEvent:
    // item.completed {type: "agent_message"} → UnifiedEvent {type: "agent_message"}
    // item.completed {type: "command_execution"} → UnifiedEvent {type: "tool_call_completed"}
    // item.completed {type: "file_changes"} → UnifiedEvent {type: "file_change"}
    // turn.completed → UnifiedEvent {type: "turn_completed"}
  }
}
```

Event mapping table:

| Codex Event | Codex Item Type | Unified Event |
|-------------|----------------|---------------|
| `item.started` | `agent_message` | `agent_message` (streaming start) |
| `item/agentMessage/delta` | -- | `agent_message_delta` |
| `item.completed` | `agent_message` | `agent_message` |
| `item.started` | `command_execution` | `tool_call_started` |
| `item.completed` | `command_execution` | `tool_call_completed` |
| `item.completed` | `file_changes` | `file_change` |
| `item.completed` | `mcp_tool_call` | `tool_call_completed` |
| `turn.completed` | -- | `turn_completed` |
| `turn.failed` | -- | `error` |

#### 3.3 Interactive terminal

```typescript
buildInteractiveCommand(opts) {
  if (opts.resumeSessionId) {
    return `codex exec resume ${opts.resumeSessionId}`
  }
  return `codex ${opts.flags?.join(' ')} "${opts.prompt}"`
}
```

#### 3.4 Auth

```typescript
async authenticate() {
  // codex login --with-api-key or codex login (OAuth)
}
async isAuthenticated() {
  // codex login status (exit code 0 = logged in)
}
```

---

### Phase 4: Docker Strategy for Codex

**Goal**: Determine how Codex agents run in containers (or if they need to).

#### Option A: Codex Native Sandbox (Recommended for v1)

Codex has built-in sandboxing (`--sandbox workspace-write`) using macOS seatbelt / Linux Landlock. For local execution, Docker may not be necessary.

- Skip Docker entirely for Codex agents running locally
- Use `--sandbox workspace-write` for filesystem isolation
- Use `--ask-for-approval never` for full automation

#### Option B: Separate Docker Images (Future)

If Docker is needed (e.g., for network isolation, reproducible environments):
- `bismarckapp/bismarck-agent-claude:v{version}` -- current image
- `bismarckapp/bismarck-agent-codex:v{version}` -- new image with Codex CLI installed
- Provider determines which image to use

#### Option C: Base Image + Runtime Install

Single base image, provider binary installed at container start. Slower but simpler to maintain.

**Recommendation**: Start with Option A (no Docker for Codex), add Option B if users need container isolation.

---

### Phase 5: Settings & UI

**Goal**: Let users choose their agent provider.

#### 5.1 Settings

Add to `AppSettings`:
```typescript
agent: {
  defaultProvider: 'claude' | 'codex'  // default: 'claude'
  codex?: {
    model?: string        // default model for codex
    apiKey?: string       // stored in keychain
  }
  claude?: {
    model?: string        // existing model setting
  }
}
```

#### 5.2 UI

- Add provider selector in Settings (General or new "Agent" section)
- Per-agent or per-plan provider override (optional, future)
- Show provider badge on agent cards in workspace view

#### 5.3 IPC

New IPC handlers:
- `get-agent-providers` → list available providers with auth status
- `set-default-provider` → update settings
- `authenticate-provider` → trigger auth flow for selected provider

---

### Phase 6: Utility Agent Calls

**Goal**: Make repo-grouper, description-generator, and other utility uses provider-agnostic.

These currently spawn `claude` directly for quick LLM tasks (grouping repos, generating descriptions). Options:

1. **Route through provider**: Use the selected provider's headless mode
2. **Use a lightweight API call instead**: These are simple prompt→response tasks that don't need a full agent. Could use the OpenAI/Anthropic API directly based on provider selection.
3. **Keep Claude-only for utilities**: Simplest approach, these are internal implementation details

**Recommendation**: Option 2 (direct API calls) is cleanest long-term, but Option 3 is fine for v1.

---

## Effort Estimate

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1: Provider abstraction | 2-3 days | Low -- pure types/interfaces |
| Phase 2: Extract Claude provider | 3-4 days | Medium -- refactor across many files, must not break anything |
| Phase 3: Codex provider | 3-4 days | Medium -- event mapping is the tricky part |
| Phase 4: Docker strategy | 1-2 days | Low -- can skip Docker for Codex v1 |
| Phase 5: Settings & UI | 2-3 days | Low -- follows existing settings patterns |
| Phase 6: Utility agents | 1-2 days | Low -- can defer |
| **Total** | **~2-3 weeks** | |

---

## Open Questions

1. **App-server vs exec mode?** Codex's `codex app-server` JSON-RPC protocol is richer and better structured than `codex exec --json`. Should we target it for a v2 integration? It would give us proper thread management, mid-turn steering, and approval flows.

2. **Per-plan provider selection?** Should users be able to choose Claude for one plan and Codex for another? This adds complexity but is powerful.

3. **Tool proxy compatibility?** The current tool proxy wraps host tools (git, gh, etc.) for Claude in Docker. Codex's native sandbox may not need this. Need to verify Codex can access host tools when running with `--sandbox workspace-write`.

4. **Codex hooks maturity?** Codex's hook system is still in PR stage. If Bismarck relies on hooks for agent lifecycle management, this could be a blocker.

5. **Cost tracking?** Claude and Codex report costs differently. Need unified cost display in the UI.

---

## Suggested Implementation Order

```
Phase 1 (abstraction) → Phase 2 (extract Claude) → Phase 3 (Codex provider)
                                                          ↓
                                                   Phase 4 (Docker) → Phase 5 (UI) → Phase 6 (utilities)
```

Phase 2 is the critical path -- if the Claude extraction is clean, everything else follows naturally. Phase 3 can be developed in parallel once the interfaces are stable.
