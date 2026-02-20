# OpenAI Codex CLI: Configuration & Environment Research

**Researched:** 2026-02-15
**Overall confidence:** HIGH (multiple official sources cross-referenced)

---

## 1. Configuration Files

**Confidence: HIGH** -- verified across official docs, GitHub issues, and config reference.

### Location Hierarchy

Codex uses a layered configuration system stored in TOML format:

| Scope | Path | Purpose |
|-------|------|---------|
| **User-level** | `~/.codex/config.toml` | Personal defaults, applied everywhere |
| **Project-level** | `.codex/config.toml` (in project root) | Project-specific overrides (requires trust) |
| **CLI override** | `-c key=value` or `--config key=value` | Per-invocation overrides, highest precedence |

The `CODEX_HOME` environment variable controls the user-level config directory. It defaults to `~/.codex`.

### Precedence Order (lowest to highest)

1. Built-in defaults
2. `~/.codex/config.toml` (user-level)
3. `.codex/config.toml` (project-level, only if project is trusted)
4. `-c key=value` CLI flags (per-invocation)

### Project Trust

Project-scoped config files (`.codex/config.toml`) are only loaded when you trust the project. You can pre-trust projects via:

```toml
# In ~/.codex/config.toml
[projects."/absolute/path/to/repo"]
trust_level = "trusted"
```

### Instructions Files (Equivalent of CLAUDE.md)

Codex reads `AGENTS.md` files (equivalent to Claude's `CLAUDE.md`):

| Scope | File | Notes |
|-------|------|-------|
| **Global** | `~/.codex/AGENTS.md` | Applied to all sessions |
| **Global override** | `~/.codex/AGENTS.override.md` | Takes precedence over AGENTS.md |
| **Project** | `AGENTS.md` in project root | Per-project instructions |
| **Directory** | `AGENTS.md` in any directory | Codex walks from project root to CWD, collecting all |

Discovery order per directory: `AGENTS.override.md` > `AGENTS.md` > fallback names from `project_doc_fallback_filenames`.

Combined size limit: `project_doc_max_bytes` (default 32 KiB).

Custom fallback filenames can be configured:
```toml
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]
```

### Key Config Keys (from config.toml)

Root-level keys:

```toml
# Model configuration
model = "gpt-5.3-codex"                  # Default model
model_provider = "openai"                 # Provider ID (default: openai)
model_context_window = 200000             # Context window size
model_max_output_tokens = 16384           # Max output tokens
model_reasoning_effort = "medium"         # Reasoning effort level
model_reasoning_summary = "auto"          # Reasoning summary mode
model_verbosity = "medium"                # Response verbosity: "low", "medium", "high"

# Security
sandbox_mode = "workspace-write"          # "read-only" | "workspace-write" | "danger-full-access"
approval_policy = "on-request"            # "untrusted" | "on-failure" | "on-request" | "never"

# Auth
preferred_auth_method = "chatgpt"         # "apikey" | "chatgpt"

# UI/behavior
disable_response_storage = false
file_opener = "code"                      # Editor to open files with
hide_agent_reasoning = false
show_raw_agent_reasoning = false          # Surfaces raw chain-of-thought
profile = "default"                       # Named profile
instructions = ""                         # Inline instructions

# Notifications
notify = "auto"                           # Notification behavior

# Tools
[tools]
web_search = true                         # Enable native web search (--search flag in TUI)
```

### Custom Model Providers

```toml
# Point built-in OpenAI provider at a proxy
# (set OPENAI_BASE_URL env var instead of defining a new provider)

# Or define a fully custom provider:
[model_providers.my-proxy]
name = "My LLM Proxy"
base_url = "https://proxy.example.com/v1"
env_key = "MY_PROXY_API_KEY"              # Env var holding the API key

# Then reference it:
model_provider = "my-proxy"
model = "my-custom-model"
```

Provider-level network tuning:
```toml
[model_providers.my-proxy]
request_max_retries = 3
stream_max_retries = 2
stream_idle_timeout_ms = 30000
```

### Shell Environment Policy

Controls which env vars Codex passes to subprocesses:

```toml
[shell_environment_policy]
inherit = "core"                          # "none" | "core" (default: "core")
ignore_default_excludes = false
exclude = ["SECRET_*", "AWS_*"]
include_only = ["PATH", "HOME", "EDITOR"]
experimental_use_profile = false          # Run commands through shell profile

[shell_environment_policy.set]
NODE_ENV = "development"
```

### MCP Server Configuration

```toml
[[mcp_servers]]
name = "my-server"
command = "npx"
args = ["-y", "@my/mcp-server"]
```

### Other Data Stored in CODEX_HOME

| Path | Purpose |
|------|---------|
| `~/.codex/config.toml` | Configuration |
| `~/.codex/AGENTS.md` | Global instructions |
| `~/.codex/sessions/` | Thread persistence |
| `~/.codex/` | Logs and other state |

---

## 2. Environment Variables

**Confidence: HIGH** -- verified across official docs and community issues.

| Variable | Purpose | Default |
|----------|---------|---------|
| `CODEX_HOME` | Override config/state directory | `~/.codex` |
| `OPENAI_API_KEY` | API key for OpenAI provider | None (uses ChatGPT auth if not set) |
| `OPENAI_BASE_URL` | Override OpenAI API endpoint (proxy, router, data-residency) | `https://api.openai.com/v1` |
| Custom `env_key` | Per-provider API key (configured in `model_providers.<id>.env_key`) | Varies |

### Auth Methods

Codex supports two auth methods:
1. **ChatGPT account** (recommended for Plus/Pro/Team/Edu/Enterprise plans) -- browser-based OAuth
2. **API key** via `OPENAI_API_KEY` env var

When both are available, `preferred_auth_method` in config.toml controls which is used:
```toml
preferred_auth_method = "apikey"  # or "chatgpt"
```

---

## 3. Model Selection

**Confidence: HIGH** -- verified via official model announcements and docs.

### CLI Flag

```bash
codex --model gpt-5.3-codex "your prompt"
codex -m gpt-5.3-codex "your prompt"

# Or via config override:
codex -c model='"gpt-5.3-codex"' "your prompt"
```

### Available Models (as of February 2026)

| Model | Description | Released |
|-------|-------------|----------|
| `gpt-5.3-codex` | Most capable agentic coding model; default for ChatGPT-auth sessions | Feb 2026 |
| `gpt-5.3-codex-spark` | 15x faster, 128k context, real-time coding (Pro users, research preview) | Feb 2026 |
| `gpt-5.2-codex` | Previous generation, complex software engineering | Late 2025 |
| `gpt-5.1-codex-max` | Long-running tasks, multi-context-window compaction | Mid 2025 |
| `gpt-5-codex-mini` | Smaller, cost-effective option | Mid 2025 |

### Config File

```toml
model = "gpt-5.3-codex"
```

### Local/OSS Models

Codex supports local models via Ollama with the `--oss` flag:
```bash
codex --oss "your prompt"
```

---

## 4. Sandbox Modes & Approval Policies

**Confidence: HIGH** -- verified across security docs, CLI reference, and community issues.

### Sandbox Modes (`--sandbox` flag)

Three sandbox modes control what Codex can technically do:

| Mode | File Access | Network | Use Case |
|------|-------------|---------|----------|
| `read-only` | Read only | Blocked | Consultative mode, planning, review |
| `workspace-write` (default) | Read everywhere; write to CWD + `/tmp` | Blocked by default | Standard development work |
| `danger-full-access` | Full filesystem | Full network | Unrestricted (use with extreme caution) |

In `workspace-write` mode:
- `.git/` and `.codex/` are read-only even when workspace is writable
- Additional writable directories can be added via `--add-dir`
- Network access can be enabled via config: `network_access = true`

Linux uses Landlock/Bubblewrap for OS-level enforcement. macOS uses its own sandbox. Windows has an experimental sandbox.

### Approval Policies (`--ask-for-approval` / `-a` flag)

Controls when Codex must ask before executing:

| Policy | Behavior |
|--------|----------|
| `untrusted` | Ask before everything |
| `on-failure` | Ask only when something fails |
| `on-request` (default) | Ask for actions outside workspace scope or network |
| `never` | Never ask (autonomous mode) |

### Convenience Aliases

```bash
# Full auto: workspace-write sandbox + on-request approvals
codex --full-auto "your prompt"
# Equivalent to:
codex --sandbox workspace-write --ask-for-approval on-request "your prompt"

# YOLO mode (dangerous): bypass all sandbox and approvals
codex --dangerously-bypass-approvals-and-sandbox "your prompt"
# Short form:
codex --yolo "your prompt"
```

### Config File

```toml
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

### Enterprise Admin Controls

Enterprise admins can enforce constraints that users cannot override, including:
- Minimum sandbox mode
- Minimum approval policy
- Web search restrictions

---

## 5. Working Directory

**Confidence: HIGH** -- verified across CLI reference and feature docs.

### `--cd` Flag

Sets the workspace root without requiring shell `cd`:

```bash
codex --cd /path/to/project "your prompt"
```

The active path appears in the TUI header.

### `--add-dir` Flag

Grants additional writable directories alongside the main workspace:

```bash
codex --cd apps/frontend --add-dir ../shared-libs --add-dir ../config "your prompt"
```

Repeatable for multiple paths.

### Default Behavior

By default, Codex uses the current working directory as the workspace root. In `workspace-write` sandbox mode, writes are restricted to this directory plus `/tmp`.

### In Non-Interactive Mode

```bash
codex exec --cd /path/to/project "your prompt"
```

---

## 6. Installation

**Confidence: HIGH** -- verified via npm, GitHub releases, and official docs.

### npm Package

| Package | Purpose |
|---------|---------|
| `@openai/codex` | The CLI binary (global install) |
| `@openai/codex-sdk` | TypeScript SDK for programmatic use (project dependency) |

### Install Commands

```bash
# CLI (global)
npm install -g @openai/codex

# Homebrew (macOS)
brew install --cask codex

# SDK (project dependency)
npm install @openai/codex-sdk
```

### Binary Location

After npm global install, the binary is named `codex` and lives in npm's global bin directory:

```bash
# Find location:
npm bin -g
# Typically: /usr/local/bin/codex or ~/.npm-global/bin/codex

# Verify:
codex --version
```

If `codex: command not found`, add npm's global bin directory to `PATH`.

### Direct Binary Download

Platform-specific binaries available from [GitHub Releases](https://github.com/openai/codex/releases/latest):
- `codex-x86_64-unknown-linux-musl` (Linux x64)
- `codex-aarch64-unknown-linux-musl` (Linux ARM64)
- `codex-x86_64-apple-darwin` (macOS x64)
- `codex-aarch64-apple-darwin` (macOS Apple Silicon)

Archives contain a platform-named binary; rename to `codex` after extracting.

### Runtime

Codex CLI is **96% Rust** with some TypeScript. It runs locally, no cloud-only requirement. Uses Bazel build system internally.

### Node.js Requirements

- CLI (`@openai/codex`): No Node.js runtime needed at all (it's a standalone Rust binary distributed via npm)
- SDK (`@openai/codex-sdk`): Requires Node.js 18+

---

## 7. Integration with PTY/Terminal Emulators

**Confidence: MEDIUM** -- some findings from official docs, but PTY-specific integration details are sparse.

### How Codex Interacts with Terminals

Codex CLI has a full TUI (terminal user interface) for interactive use, built on terminal rendering libraries. It expects a proper terminal for its interactive mode.

### Non-Interactive Mode (Recommended for PTY Integration)

For programmatic control (including from an Electron app via node-pty), **avoid the interactive TUI**. Use one of these approaches:

#### Option A: `codex exec` (Simplest)

Spawn `codex exec` as a subprocess. It runs headlessly, streams progress to stderr, and prints the final message to stdout.

```bash
codex exec --json --model gpt-5.3-codex --cd /path/to/project "your prompt"
```

With `--json`, outputs newline-delimited JSON events (JSONL):
- `thread.started`
- `turn.started` / `turn.completed` / `turn.failed`
- `item.*` (messages, reasoning, commands, file changes, MCP calls, web searches)
- `error`

#### Option B: `codex app-server` (Stateful, Multi-Turn)

For persistent, multi-turn sessions (closer to what Bismarck needs):

```bash
codex app-server --listen stdio://
```

This spawns a stateful process that speaks **JSON-RPC 2.0 over stdio** (note: omits `"jsonrpc":"2.0"` header). Communication protocol:

1. Client sends `initialize` request
2. Client sends `initialized` notification
3. Client sends requests to start threads, run turns
4. Server streams notifications for state changes

#### Option C: `@openai/codex-sdk` (TypeScript, Highest Level)

The SDK wraps the CLI binary, spawning it and exchanging JSONL over stdin/stdout:

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({
  env: process.env,  // Control which env vars the CLI receives
});

const thread = codex.startThread({
  workingDirectory: "/path/to/project",
  skipGitRepoCheck: true,
});

// Streaming events
const { events } = await thread.runStreamed("Fix the failing tests");
for await (const event of events) {
  switch (event.type) {
    case "item.completed":
      console.log("item", event.item);
      break;
    case "turn.completed":
      console.log("usage", event.usage);
      break;
  }
}
```

The SDK allows passing a custom `env` parameter to control environment variables, which is particularly useful for sandboxed environments like Electron apps.

Thread persistence: `~/.codex/sessions/` -- recoverable via `resumeThread()`.

### PTY-Specific Considerations

1. **The interactive TUI requires a proper terminal.** Spawning `codex` (without `exec` or `app-server`) in a node-pty should work for the TUI experience, but this is not the recommended integration path.

2. **Codex has a "unified PTY-backed exec tool" (beta)** -- this means Codex itself uses PTY internally for running subprocess commands. This could potentially conflict with outer PTY wrappers.

3. **The `codex fork` command is TUI-only** and requires an interactive terminal. There's an open issue (#11750) requesting a headless `codex exec fork` variant.

4. **For Electron/Bismarck integration, prefer `@openai/codex-sdk` or `codex app-server`** over spawning the full TUI in a PTY. The SDK handles process lifecycle, event parsing, and provides a clean TypeScript API.

5. **No known showstopper issues** with node-pty specifically, but the TUI mode may have rendering quirks depending on the terminal emulator capabilities exposed by node-pty.

---

## 8. Complete CLI Reference Summary

### Main Commands

| Command | Description |
|---------|-------------|
| `codex` | Interactive TUI mode |
| `codex exec` / `codex e` | Non-interactive/headless mode |
| `codex app-server` | Stateful JSON-RPC server over stdio |

### Key Flags (Interactive + Exec)

| Flag | Short | Description |
|------|-------|-------------|
| `--model` | `-m` | Override model |
| `--sandbox` | | Set sandbox mode (`read-only`, `workspace-write`, `danger-full-access`) |
| `--ask-for-approval` | `-a` | Set approval policy (`untrusted`, `on-failure`, `on-request`, `never`) |
| `--full-auto` | | Alias for `--sandbox workspace-write --ask-for-approval on-request` |
| `--yolo` | | Alias for `--dangerously-bypass-approvals-and-sandbox` |
| `--cd` | | Set workspace root directory |
| `--add-dir` | | Add additional writable directory (repeatable) |
| `--config` / `-c` | | Override config key-value: `-c model='"gpt-5.2-codex"'` |
| `--oss` | | Use local Ollama provider |
| `--search` | | Enable web search (TUI only) |

### Exec-Specific Flags

| Flag | Description |
|------|-------------|
| `--json` | Output JSONL events instead of formatted text |
| `--ephemeral` | Don't persist session files to disk |
| `--images` | Attach images to first message (repeatable, comma-separated) |
| `--color` | Control ANSI color output |

### TUI Slash Commands

| Command | Description |
|---------|-------------|
| `/init` | Generate AGENTS.md scaffold |
| `/permissions` | Switch to read-only mode |
| `/apps` | List connected apps/connectors |

---

## 9. Comparison with Claude Code

For context in Bismarck integration:

| Feature | Claude Code | Codex CLI |
|---------|------------|-----------|
| **Config location** | `~/.claude/` | `~/.codex/` (or `$CODEX_HOME`) |
| **Config format** | JSON (`settings.json`, etc.) | TOML (`config.toml`) |
| **Project instructions** | `CLAUDE.md` | `AGENTS.md` |
| **Override instructions** | `CLAUDE.local.md` | `AGENTS.override.md` |
| **Sandbox modes** | Sandbox on/off | 3 levels: read-only, workspace-write, danger-full-access |
| **Approval modes** | Auto-accept / ask | 4 levels: untrusted, on-failure, on-request, never |
| **Non-interactive** | `claude --print` | `codex exec` |
| **JSON output** | `--output-format json` | `--json` (JSONL events) |
| **Working dir** | `--cwd` | `--cd` |
| **Model flag** | `--model` | `--model` / `-m` |
| **SDK** | `@anthropic-ai/claude-code` | `@openai/codex-sdk` |
| **Language** | TypeScript/Node.js | Rust (96%) + TypeScript |
| **Subprocess protocol** | JSON over stdio | JSONL (exec) or JSON-RPC (app-server) |
| **MCP support** | Yes | Yes (via config.toml) |

---

## Sources

### Official Documentation
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Config Basics](https://developers.openai.com/codex/config-basic/)
- [Advanced Configuration](https://developers.openai.com/codex/config-advanced/)
- [Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [Sample Configuration](https://developers.openai.com/codex/config-sample/)
- [Security](https://developers.openai.com/codex/security/)
- [Codex Models](https://developers.openai.com/codex/models/)
- [Non-interactive Mode](https://developers.openai.com/codex/noninteractive/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Custom Instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md/)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)

### GitHub
- [openai/codex Repository](https://github.com/openai/codex)
- [Config.toml Updated Keys (Issue #2760)](https://github.com/openai/codex/issues/2760)
- [Add codex exec fork (Issue #11750)](https://github.com/openai/codex/issues/11750)
- [codex/docs/config.md](https://github.com/openai/codex/blob/main/docs/config.md)

### npm
- [@openai/codex](https://www.npmjs.com/package/@openai/codex) (CLI)
- [@openai/codex-sdk](https://www.npmjs.com/package/@openai/codex-sdk) (TypeScript SDK)

### Community
- [Custom Base URL Issue](https://community.openai.com/t/cant-setup-codex-cli-with-custom-base-url-and-api-key-via-terminal-env-variables-or-command-options/1363678)
- [GPT-5.3-Codex Announcement](https://openai.com/index/introducing-gpt-5-3-codex/)
- [GPT-5.2-Codex Announcement](https://openai.com/index/introducing-gpt-5-2-codex/)
