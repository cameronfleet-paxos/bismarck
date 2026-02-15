# Research: OpenAI Codex CLI Interactive Terminal Usage

**Researched:** 2026-02-15
**Confidence:** HIGH (multiple official sources, consistent across docs and GitHub)

## Sources

- [Codex CLI Overview](https://developers.openai.com/codex/cli/)
- [Codex CLI Reference (all flags)](https://developers.openai.com/codex/cli/reference/)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)
- [Codex CLI Slash Commands](https://developers.openai.com/codex/cli/slash-commands/)
- [Codex Authentication](https://developers.openai.com/codex/auth/)
- [Codex Config Basics](https://developers.openai.com/codex/config-basic/)
- [Codex Config Reference](https://developers.openai.com/codex/config-reference/)
- [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive/)
- [GitHub: openai/codex](https://github.com/openai/codex)
- [Codex CLI Going Native (Rust rewrite)](https://github.com/openai/codex/discussions/1174)
- [Codex Changelog](https://developers.openai.com/codex/changelog/)

---

## 1. Interactive Mode

### Default Command

Running `codex` with no arguments launches an **interactive TUI (Terminal User Interface) session**. This is the default and primary mode. The user gets a conversational REPL-style interface where they can type prompts, review Codex's actions in real-time, approve or reject steps, and iterate.

```bash
# Launch interactive session
codex

# Launch with an initial prompt
codex "refactor the auth module to use JWT"

# Launch with prompt and image attachments
codex "match this design" screenshot.png
```

The interactive session is a **full-screen terminal UI**. Codex can read your repository, make edits, and run commands as you iterate together. It is conversational -- you type a message, Codex responds with a plan and/or actions, and you can follow up.

### TUI Technology

Originally built with **React + Ink** (a React renderer for CLIs built on Node.js/TypeScript). OpenAI announced in mid-2025 a full **rewrite to Rust** ("Codex CLI is Going Native"). As of early 2026, the Rust version is the primary distribution. The npm package `@openai/codex` still exists for installation convenience but the binary itself is now a native Rust executable.

### REPL Behavior

Yes, Codex has a REPL-like interactive loop similar to Claude Code:
- You type a prompt/message at the bottom of the screen
- Codex processes it, potentially reading files, writing files, running commands
- You see the actions and results in the transcript
- You can type follow-up messages
- The session persists until you `/exit` or Ctrl+C

### Key Differences from Claude Code

| Aspect | Codex CLI | Claude Code |
|--------|-----------|-------------|
| Default command | `codex` (interactive TUI) | `claude` (interactive REPL) |
| TUI framework | Rust native (formerly Ink/React) | Ink/React (TypeScript) |
| Approval model | Configurable per-session | Permission-based |
| Session resume | `codex resume` subcommand | `claude --resume` flag |
| Non-interactive | `codex exec` / `codex e` | `claude -p` (print mode) |
| Config format | TOML (`~/.codex/config.toml`) | JSON (settings files) |

---

## 2. CLI Flags (Interactive Use)

### Core Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--model <model>` | | Override the model (e.g., `gpt-5.3-codex`, `gpt-5-codex-mini`) |
| `--ask-for-approval <policy>` | | When to prompt: `untrusted`, `on-failure`, `on-request` (default), `never` |
| `--sandbox <mode>` | | Sandbox policy: `read-only` (default), `workspace-write`, `danger-full-access` |
| `--full-auto` | | Convenience alias for `--sandbox workspace-write --ask-for-approval on-request` |
| `--cd <path>` | | Set working directory before starting |
| `--add-dir <path>` | | Add extra writable root directories |
| `-c key=value` | `--config` | Override any config.toml key for this invocation |
| `-q` | `--quiet` | Suppress interactive prompts (for non-interactive/CI use) |
| `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | No approvals, no sandbox. Extremely risky. |
| `--ephemeral` | | Don't persist session rollout files to disk |

### Approval Policies Explained

| Policy | Behavior |
|--------|----------|
| `untrusted` | Only known-safe read-only commands auto-run; everything else prompts |
| `on-failure` | Auto-run in sandbox; prompt only on failure for escalation |
| `on-request` | Model decides when to ask (this is the **default**) |
| `never` | Never prompt (risky, for fully automated use) |

### Sandbox Modes Explained

| Mode | Behavior |
|------|----------|
| `read-only` | Default. Codex can read but not write files or run destructive commands. |
| `workspace-write` | Codex can write within the working directory. |
| `danger-full-access` | No sandbox at all. Network access, arbitrary file writes. |

---

## 3. Session Management

### Automatic Persistence

Every Codex CLI session is **automatically saved** as a JSONL (JSON Lines) file under:

```
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

Each file contains timestamps, message types, user messages, model outputs, token usage, and tool call results.

### Resume Commands

| Command | Behavior |
|---------|----------|
| `codex resume` | Launches an interactive picker showing recent sessions |
| `codex resume --last` | Skips picker, jumps to most recent session from current directory |
| `codex resume --all` | Shows sessions from all directories (not just cwd) |
| `codex resume --last --all` | Most recent session across all directories |
| `codex resume <SESSION_ID>` | Resume a specific session by ID |

You can find session IDs from the picker, `/status` slash command, or by browsing `~/.codex/sessions/`.

### Resume with Overrides

When resuming, you can override the working directory or add extra roots:

```bash
codex resume --last --cd /new/path --add-dir /extra/dir
```

### Session History Configuration

In `~/.codex/config.toml`:

```toml
[history]
persistence = "none"  # Disable local history
max_bytes = 10485760  # Cap history file size (oldest entries dropped when exceeded)
```

### Comparison to Claude Code

| Feature | Codex CLI | Claude Code |
|---------|-----------|-------------|
| Auto-save sessions | Yes (JSONL) | Yes (JSON) |
| Resume command | `codex resume` (subcommand) | `claude --resume` / `claude --continue` |
| Session picker | Yes (built-in) | Yes (built-in) |
| Session location | `~/.codex/sessions/` | `~/.claude/projects/` |
| Disable persistence | Config option | Not exposed |
| Resume by ID | Yes | Yes |

---

## 4. Terminal Behavior

### Full-Screen TUI

Codex CLI launches a **full-screen terminal UI**, not a simple line-by-line REPL. The TUI includes:

- A scrollable transcript area showing the conversation
- An input composer at the bottom for typing prompts
- Status information (model, approval mode, token usage)
- A configurable status line (customizable via `/statusline`)

### Slash Commands (In-Session)

These are typed at the input prompt during an interactive session:

| Command | Description |
|---------|-------------|
| `/model` | Switch models mid-session (picker UI) |
| `/permissions` | Switch approval mode mid-session |
| `/compact` | Summarize conversation to free context window |
| `/new` | Start fresh conversation in same CLI session |
| `/fork` | Clone current conversation into a new thread |
| `/diff` | View git diff of changes within the CLI |
| `/review` | Run code review on working tree or branch |
| `/mention <path>` | Add a file to the conversation context |
| `/status` | Show active model, approval policy, roots, token usage |
| `/statusline` | Customize the footer status line |
| `/debug-config` | Show config layer order and policy sources |
| `/apps` | Pick an app mention to insert |
| `/feedback` | Submit feedback with logs/diagnostics |
| `/resume` | Resume a previous session (within the session) |
| `/quit` or `/exit` | Exit the CLI |

### Image Input

You can paste images directly into the interactive composer, or provide them on the command line:

```bash
codex "implement this design" mockup.png
codex "fix the layout" screenshot1.png,screenshot2.png
```

Supported formats: PNG, JPEG, GIF, WebP.

### Exiting

- `Ctrl+C` -- interrupt/exit
- `/exit` or `/quit` -- slash command to exit

### Keyboard Shortcuts

Not extensively documented, but the TUI supports standard terminal navigation. The `/statusline` command lets you toggle and reorder status bar items.

---

## 5. Binary Name and Installation

### Binary Name

The binary is called **`codex`**.

### Installation Methods

```bash
# npm (works on macOS, Linux, Windows)
npm install -g @openai/codex

# Homebrew (macOS)
brew install --cask codex

# Direct binary download (all platforms)
# Visit https://github.com/openai/codex/releases
# Binaries available for:
#   - aarch64-apple-darwin (macOS ARM)
#   - x86_64-apple-darwin (macOS Intel)
#   - x86_64-unknown-linux-musl (Linux x86)
#   - aarch64-unknown-linux-musl (Linux ARM)
```

### Shell Completions

```bash
codex completion bash   # Generate bash completions
codex completion zsh    # Generate zsh completions
codex completion fish   # Generate fish completions
```

### Implementation Language

The CLI is now written in **Rust** (native binary). The npm package `@openai/codex` serves as a distribution wrapper. Originally it was TypeScript/Node.js using Ink (React for CLIs), but the Rust rewrite was announced in June 2025 and completed by late 2025.

---

## 6. Authentication

### Login Command

```bash
# Interactive login (opens browser for OAuth)
codex login

# Device code auth (for headless/remote environments)
codex login --device-auth

# API key via stdin
printenv OPENAI_API_KEY | codex login --with-api-key
```

### First Run

When you first run `codex`, you are prompted to sign in. Two options are presented:
1. **Sign in with ChatGPT** -- OAuth flow, opens browser, returns access token
2. **Sign in with API key** -- Enter an OpenAI API key

### ChatGPT Account Requirements

ChatGPT-based auth works with: Plus, Pro, Team, Edu, or Enterprise plans. This uses the ChatGPT subscription for model access (no separate API billing).

### Credential Storage

Credentials are cached locally. The storage location is controlled by `cli_auth_credentials_store` in config.toml:

| Value | Behavior |
|-------|----------|
| `auto` (default) | OS credential store when available, else `auth.json` |
| `keyring` | OS credential store (macOS Keychain, Windows Credential Manager, etc.) |
| `file` | Plaintext `~/.codex/auth.json` |

### Auth State Location

```
~/.codex/auth.json      # When using file-based storage
~/.codex/config.toml    # Auth-related config options
```

### Environment Variables

- `OPENAI_API_KEY` -- Can be set as environment variable for API key auth
- `CODEX_HOME` -- Override the default `~/.codex` directory

---

## 7. Clear/Reset Signals

### Conversation Management

| Action | Codex Equivalent | Claude Code Equivalent |
|--------|-----------------|----------------------|
| Clear/reset conversation | `/new` (starts fresh in same session) | `/clear` |
| Compact/summarize context | `/compact` (summarizes to free tokens) | `/compact` |
| Fork conversation | `/fork` (clones to new thread) | No direct equivalent |
| Exit session | `/exit`, `/quit`, `Ctrl+C` | `/exit`, `Ctrl+C` |

### /new (Fresh Conversation)

`/new` starts a fresh conversation in the same CLI session. The previous conversation is preserved in the session log, but the model context is cleared. This is the closest equivalent to a "session clear" -- it lets you switch tasks without leaving the terminal.

### /compact (Context Compression)

`/compact` asks Codex to summarize the conversation so far, replacing earlier turns with a concise summary. This frees context window space while keeping critical details. The user is asked to confirm before the compaction happens.

### /fork (Branch Conversation)

`/fork` clones the current conversation into a new thread with a fresh ID. The original transcript is left untouched. This lets you explore an alternative approach without losing the original conversation state.

### No "(no content)" Equivalent

There is no documented equivalent to Claude Code's `(no content)` signal pattern. Codex's approach is more explicit: use `/new` to start fresh, `/compact` to compress, or just exit and resume later.

---

## 8. Configuration System

### Config File Hierarchy

1. **User-level:** `~/.codex/config.toml` (global defaults)
2. **Project-level:** `.codex/config.toml` (in project root, checked into repo)
3. **CLI flags:** `-c key=value` overrides for single invocations
4. **Profiles:** Named profiles in config.toml (e.g., `[profile.deep-review]`)

### Example config.toml

```toml
# Default model
model = "gpt-5.3-codex"

# Default approval policy
approval_policy = "on-request"

# Default sandbox mode
sandbox_mode = "read-only"

# Default profile (optional)
profile = "default"

# Auth credential storage
cli_auth_credentials_store = "auto"

# Session history
[history]
persistence = "full"
max_bytes = 10485760

# Profile definitions
[profile.fast]
model = "gpt-5-codex-mini"

[profile.deep-review]
model = "gpt-5.3-codex"
approval_policy = "untrusted"
```

### Viewing Active Configuration

Use `/debug-config` in an interactive session to see the config layer order, on/off state, and policy sources. Use `/status` to see the active model, approval policy, writable roots, and token usage.

---

## 9. Non-Interactive / Exec Mode

For completeness, since Bismarck may need to launch Codex programmatically:

```bash
# Run non-interactively
codex exec "fix all lint errors"
codex e "fix all lint errors"    # short alias

# Stream JSONL events
codex exec --json "refactor auth module"

# Pipe prompt from stdin
echo "add error handling" | codex exec -

# Full auto with no prompts
codex exec --full-auto "run tests and fix failures"

# Ephemeral (don't save session)
codex exec --ephemeral "explain this codebase"
```

In exec mode:
- Progress streams to stderr
- Final agent message goes to stdout
- Suitable for piping to other tools
- `--json` flag outputs newline-delimited JSON events

---

## 10. Models Available

| Model | Description | Use Case |
|-------|-------------|----------|
| `gpt-5.3-codex` | Most capable, default | Complex tasks, multi-file changes |
| `gpt-5.3-codex-spark` | Smaller, near-instant | Real-time interactive editing (Pro only, research preview) |
| `gpt-5-codex-mini` | Cost-effective | Simpler tasks |
| `gpt-4.1` | General purpose | Non-coding tasks |
| `gpt-4.1-mini` | Smaller general purpose | Quick questions |

Switch models mid-session with `/model` or set via `--model` flag or `model` in config.toml.

---

## Summary for Bismarck Integration

Key takeaways for building Codex CLI support into Bismarck:

1. **Binary:** `codex` -- installed via npm (`@openai/codex`), Homebrew, or direct download
2. **Interactive launch:** `codex` with no args starts the TUI REPL
3. **Working directory:** `--cd <path>` sets cwd
4. **Session resume:** `codex resume --last` or `codex resume <id>`
5. **Session storage:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
6. **Auth state:** `~/.codex/auth.json` or OS keychain (controlled by `cli_auth_credentials_store`)
7. **Config:** `~/.codex/config.toml` (user) + `.codex/config.toml` (project)
8. **Non-interactive:** `codex exec` / `codex e` for programmatic use
9. **Full-screen TUI:** Uses Rust-native terminal rendering (formerly Ink/React)
10. **No stdin REPL protocol:** Unlike Claude's `--json` mode with structured stdin/stdout, Codex's TUI is designed for human interaction. The `exec` mode is the programmatic interface, outputting JSONL events with `--json`.
