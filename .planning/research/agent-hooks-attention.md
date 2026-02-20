# Research: Hook/Event Systems for "Agent Needs Attention" Detection

**Domain:** Coding agent CLI lifecycle events and attention notification
**Researched:** 2026-02-15
**Overall confidence:** MEDIUM-HIGH (Claude Code: HIGH, Codex: MEDIUM, Gemini: MEDIUM, standards: LOW)

---

## Executive Summary

The coding agent CLI ecosystem has converged on a common pattern for lifecycle hooks: named events (Stop, Notification, PreToolUse, etc.) that trigger shell commands, with JSON payloads piped to stdin. Claude Code pioneered this pattern, and both Codex and Gemini CLI have adopted similar (but not identical) systems. There is **no cross-agent standard** for hooks -- each tool has its own config format, event names, and payload schemas. However, the patterns are similar enough that a thin adapter layer per agent is sufficient.

For Bismarck's specific need -- detecting when an agent is waiting for user input -- three mechanisms exist across the ecosystem:

1. **Hook-based** (recommended primary): Claude Code `hooks.Stop` + `hooks.Notification[idle_prompt]`; Codex `notify` callback (limited to `agent-turn-complete`); Gemini CLI `Notification` hooks.
2. **Protocol-based** (recommended for Codex): Codex `app-server` JSON-RPC sends `item/requestApproval` when awaiting user decision -- this is the most reliable Codex attention signal.
3. **PTY-based** (fallback): Monitor terminal output for prompt patterns, screen stability, or process idle state. Unreliable but universal.

**Key finding:** Codex does NOT have a full Claude-Code-style hooks system in its released config.toml as of February 2026. It has a `notify` callback (fires on `agent-turn-complete`) and `tui.notifications` (UI-only). Multiple community PRs propose a comprehensive hooks system, but none appear merged into main. The `app-server` protocol is the better integration path for Codex.

---

## 1. Claude Code Hooks (Current Bismarck Implementation)

**Confidence: HIGH** (verified via official docs + existing codebase)

### How It Works

Claude Code has a mature hooks system configured in `~/.claude/settings.json`. Hooks are organized by event type, with optional matchers for filtering.

### Event Types Relevant to Attention

| Event | When It Fires | Attention Signal? |
|-------|--------------|-------------------|
| `Stop` | Agent finishes responding (waiting for next prompt) | **Yes** -- primary attention signal |
| `Notification` (matcher: `permission_prompt`) | Agent needs permission to use a tool | **Yes** -- agent blocked on approval |
| `Notification` (matcher: `idle_prompt`) | Prompt input idle for 60+ seconds | **Yes** -- agent waiting for input |
| `Notification` (matcher: `elicitation_dialog`) | Agent asking user a question | **Yes** -- agent blocked on user response |
| `SessionStart` | Session begins | No (used for session mapping) |
| `UserPromptSubmit` | User submits a prompt | No |

### Configuration Format

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "/path/to/stop-hook.sh" }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          { "type": "command", "command": "/path/to/notification-hook.sh" }
        ]
      }
    ]
  }
}
```

### Hook Script Input

Hook scripts receive JSON on **stdin** containing event-specific data. Key fields:
- `session_id` -- maps to workspace via session mapping file
- `hook_event_name` -- e.g., "Stop", "Notification"
- `notification_type` -- for Notification events: "permission_prompt", "idle_prompt", etc.

### Environment Variables

- `CLAUDE_PROJECT_DIR` -- absolute path to project root
- `CLAUDE_CODE_REMOTE` -- whether running in remote/web environment
- Custom env vars set by Bismarck: `BISMARCK_WORKSPACE_ID`, `BISMARCK_INSTANCE_ID`

### Bismarck's Current Flow

```
Claude Code agent stops
  -> hooks.Stop fires
  -> stop-hook.sh extracts session_id from stdin JSON
  -> Looks up workspace mapping at ~/.bismarck/sessions/{session_id}.json
  -> Sends JSON event to Unix socket at /tmp/bm/{instance}/{workspace}.sock
  -> socket-server.ts receives event
  -> Adds to waitingQueue, shows macOS notification, updates renderer via IPC
```

This is a **proven, reliable** system. The same pattern should be replicated for other agents.

### Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- HIGH confidence
- [Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- Bismarck codebase: `src/main/hook-manager.ts`, `src/main/socket-server.ts`

---

## 2. OpenAI Codex CLI Attention Mechanisms

**Confidence: MEDIUM** (multiple signals conflict; hooks system status unclear)

### 2a. Codex `notify` Callback (Available Now)

Codex has a `notify` configuration in `~/.codex/config.toml` that runs an external program when the agent finishes a turn.

```toml
notify = ["python3", "/path/to/notification-script.py"]
```

**Key limitations:**
- Currently supports **only** `agent-turn-complete` event type
- The script receives a **single JSON argument** (via argv, NOT stdin like Claude Code)
- JSON payload includes: `type`, `last-assistant-message`, `input-messages`, `thread-id`, `turn-id`
- No `approval-requested` or `idle_prompt` equivalent in the notify callback
- No matcher system -- you get all events or none

**For Bismarck:** The `notify` callback fires when the agent completes a turn, which IS an attention signal (agent is waiting for next input). However, it does NOT fire when the agent is waiting for approval in non-full-auto mode.

### 2b. Codex `tui.notifications` (UI-Only)

```toml
[tui]
notifications = ["agent-turn-complete", "approval-requested"]
```

This is **internal to the Codex TUI** -- it controls which events show in the terminal UI. It cannot trigger external programs. **Not useful for Bismarck** since Bismarck runs Codex in a PTY, not through the Codex TUI notification system.

### 2c. Codex Hooks System (NOT Released -- PR Stage Only)

Multiple PRs propose a comprehensive hooks system for Codex:

| PR | Title | Status |
|----|-------|--------|
| [#2904](https://github.com/openai/codex/pull/2904) | Add support for user defined event hooks | Community PR |
| [#9796](https://github.com/openai/codex/pull/9796) | Comprehensive hooks system for tool, file, and event lifecycle | Community PR |
| [#11067](https://github.com/openai/codex/pull/11067) | Comprehensive hook system with lifecycle events and steering | Community PR |

These PRs propose Claude-Code-style hooks with events like `PreToolUse`, `PostToolUse`, `Stop`, `Notification`, `SessionStart`, etc. -- but **none appear to be merged into the official Codex release** as of February 2026.

**Important clarification:** The `code-notify` project (mylee04/code-notify) claims to support Codex hooks in `config.toml`, suggesting Codex may have adopted a hooks section. However, I could not find official documentation confirming a `[hooks]` section in `config.toml`. The official docs only document `notify` and `tui.notifications`.

**Confidence: LOW** on whether Codex has a full `[hooks]` section. This needs direct verification by inspecting a current Codex installation.

### 2d. Codex App-Server Protocol (Recommended for Rich Integration)

**Confidence: HIGH** (well-documented on developers.openai.com)

The `codex app-server` provides a JSON-RPC 2.0 protocol over stdio (JSONL) that explicitly supports approval flows:

```
codex app-server --listen stdio://
```

**Approval events (server -> client):**
- `item/commandExecution/requestApproval` -- agent wants to run a command, needs permission
- `item/fileChange/requestApproval` -- agent wants to write a file, needs permission

**Payload includes:** `itemId`, `threadId`, `turnId`, optional `reason`/`risk`, `parsedCmd` for display.

**Client responds:** `{ "decision": "accept" | "decline" }`

**Turn lifecycle events:**
- `turn.started` / `turn.completed` -- marks agent activity boundaries
- `item.started` / `item.completed` -- individual tool/message items

**This is the best path for Codex attention detection** because:
1. It explicitly sends `requestApproval` events when waiting for user decision
2. `turn.completed` signals when the agent finishes and is waiting for next input
3. It's a structured protocol, not a shell callback hack
4. It supports mid-turn steering via `turn/steer`

**Trade-off:** Using app-server means NOT running Codex as a simple PTY process. Bismarck would need to spawn `codex app-server` as a subprocess and communicate via JSONL over stdio, then render the agent's output in its own UI rather than showing the Codex TUI directly.

### 2e. Codex Interactive TUI in PTY (Current Bismarck Approach)

If Bismarck runs Codex as an interactive TUI in a PTY (like it does with Claude Code), the attention detection options are:

1. **`notify` callback** -- fires on `agent-turn-complete` (turn finished, waiting for input). This is the primary signal.
2. **PTY output monitoring** -- look for prompt patterns indicating the agent is waiting (fragile).
3. **No `permission_prompt` equivalent** -- unless the hooks system lands, there's no way to get notified when Codex is waiting for approval in the TUI.

### Recommended Codex Strategy for Bismarck

**Phase 1 (PTY mode):** Use `notify` callback in `config.toml` to detect `agent-turn-complete`. Accept the limitation that approval-waiting cannot be detected. Run Codex with `--full-auto` or `--ask-for-approval never` to avoid approval prompts entirely.

**Phase 2 (app-server mode):** Migrate to `codex app-server` for full approval flow support, structured events, and mid-turn steering. This requires building a custom UI for Codex output rather than showing the TUI.

### Sources

- [Codex Advanced Configuration](https://developers.openai.com/codex/config-advanced/)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
- [Hook Request Discussion #2150](https://github.com/openai/codex/discussions/2150)
- [Event Hooks Issue #2109](https://github.com/openai/codex/issues/2109)
- [Hooks PR #11067](https://github.com/openai/codex/pull/11067)
- [code-notify](https://github.com/mylee04/code-notify) -- cross-platform notification tool

---

## 3. Gemini CLI Hooks

**Confidence: MEDIUM** (documented but less verified)

Gemini CLI (v0.26.0+) introduced a hooks system in January 2026. The hook system follows a similar pattern to Claude Code.

### Event Types

| Event | Description | Attention Signal? |
|-------|-------------|-------------------|
| `Notification` | CLI emits a system alert (e.g., tool permission) | **Yes** |
| `AfterAgent` | Agent loop completes | **Yes** (equivalent to Stop) |
| `BeforeTool` / `AfterTool` | Tool lifecycle | No |
| `BeforeAgent` | Agent loop starts | No |
| `SessionStart` / `SessionEnd` | Session lifecycle | No |
| `BeforeModel` / `AfterModel` | Model call lifecycle | No |
| `PreCompress` / `BeforeToolSelection` | Internal events | No |

### Configuration

Hooks are configured in `~/.gemini/settings.json` (similar to Claude Code's format).

### Attention Detection

The `Notification` event fires when the CLI needs tool permissions, making it equivalent to Claude Code's `Notification[permission_prompt]`. The `AfterAgent` event fires when the agent completes, equivalent to Claude Code's `Stop`.

### Bismarck Implications

If Bismarck adds Gemini CLI support in the future, the hook integration would be very similar to Claude Code's -- different config file path and event names, but same shell-script-over-unix-socket pattern.

### Sources

- [Gemini CLI Hooks](https://geminicli.com/docs/hooks/)
- [Gemini CLI Hooks Reference](https://geminicli.com/docs/hooks/reference/)
- [Google Developers Blog: Hooks Announcement](https://developers.googleblog.com/tailor-gemini-cli-to-your-workflow-with-hooks/)
- [gemini-notifier](https://github.com/thoreinstein/gemini-notifier) -- notification hook for Gemini CLI

---

## 4. Other Agents

### Aider

**Confidence: MEDIUM**

Aider has minimal notification support:
- `--notifications` flag enables terminal bell when LLM response is ready
- `--notifications-command` specifies a custom command for notifications
- No event/hook system, no lifecycle events, no matchers

For Bismarck: The `--notifications-command` could be pointed at a Bismarck hook script. It fires when the agent finishes responding (equivalent to Stop). No approval/permission detection.

### Cursor (IDE, not CLI)

**Confidence: MEDIUM**

Cursor 1.7+ has a hooks system with 13 lifecycle events (nearly identical to Claude Code's). Since Cursor is an IDE, not a CLI, this is not directly relevant to Bismarck. However, it confirms the industry convergence on the same hook event model.

### Sources

- [Aider Options Reference](https://aider.chat/docs/config/options.html)
- [Cursor 1.7 Hooks](https://www.infoq.com/news/2025/10/cursor-hooks/)

---

## 5. Open Standards and Protocols

### Is There a Universal Hook Standard?

**No.** There is no cross-agent standard for lifecycle hooks. Each tool has its own:

| Agent | Config Format | Config Location | Event Names | Payload Delivery |
|-------|--------------|-----------------|-------------|-----------------|
| Claude Code | JSON | `~/.claude/settings.json` | Stop, Notification, PreToolUse, etc. | JSON on stdin |
| Codex CLI | TOML | `~/.codex/config.toml` | agent-turn-complete (notify only) | JSON as argv[1] |
| Gemini CLI | JSON | `~/.gemini/settings.json` | AfterAgent, Notification, BeforeTool, etc. | JSON on stdin |
| Aider | CLI flags | CLI args or `.aider.conf.yml` | Response ready (bell/command) | None (command only) |

### Agent Client Protocol (ACP)

The [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol) (by Zed Industries) is a JSON-RPC 2.0 protocol standardizing communication between code editors and AI coding agents. It defines lifecycle events including task creation, execution, approval requests, and completion notifications.

**Relevance to Bismarck:** ACP could theoretically serve as a universal protocol for agent management, but:
- It's designed for editor-agent communication, not agent-manager communication
- Adoption is early (Zed, some JetBrains support)
- No CLI agents (Claude Code, Codex, Gemini) implement it
- The Codex app-server protocol serves a similar purpose but is Codex-specific

**Verdict:** ACP is worth watching but not actionable for Bismarck today.

### MCP (Model Context Protocol)

MCP standardizes how agents access external tools, not how agents report their lifecycle state. It's orthogonal to the hooks/attention problem.

### A2A (Agent-to-Agent Protocol)

Google's A2A protocol is for multi-agent coordination. Not relevant to the attention detection use case.

### Sources

- [Agent Client Protocol](https://github.com/agentclientprotocol/agent-client-protocol)
- [ACP Blog Post](https://blog.promptlayer.com/agent-client-protocol-the-lsp-for-ai-coding-agents/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-11-25)

---

## 6. Alternative Detection Methods (No Hooks)

For agents without hook systems, or as a fallback:

### 6a. PTY Output Pattern Monitoring

Monitor the agent's terminal output for patterns indicating it's waiting for input.

**Approach:**
- Track the last N bytes of PTY output
- Look for prompt patterns (e.g., `> `, `? `, `(y/n)`, agent-specific prompts)
- Detect output silence (no new output for N seconds after a burst)

**Pros:** Universal -- works for any terminal-based agent.

**Cons:**
- Extremely fragile -- prompt patterns change between versions
- False positives from long-running tools (agent seems idle but is waiting for a command to finish)
- False negatives from agents that stream output continuously
- Different terminal emulators handle escape sequences differently

**Tools that help:**
- [pilotty](https://github.com/msmps/pilotty) -- daemon-managed PTY sessions with `--await-change` flag for screen stability detection
- [agent-tui](https://github.com/pproenca/agent-tui) -- virtual terminal emulation with wait conditions

### 6b. Process State Detection

Monitor the agent process's state to detect when it's blocking on stdin.

**Approach:**
- Check process state via `/proc/{pid}/status` (Linux) or `ps` (macOS)
- A process in `S` (sleeping) state reading from fd 0 (stdin) is likely waiting for input
- Use `lsof` or `/proc/{pid}/fdinfo/0` to check if stdin is being read

**Pros:** More reliable than output monitoring. OS-level signal.

**Cons:**
- Platform-specific (Linux vs macOS have different proc interfaces)
- Cannot distinguish "waiting for user input" from "waiting for API response"
- Polling overhead
- May not work in Docker containers depending on proc mount

### 6c. Terminal Bell Detection

Many agents (including Aider) send the terminal bell character (`\x07` or `\a`) when they want attention.

**Approach:**
- Monitor PTY output for the bell character
- When detected, treat as attention signal

**Pros:** Simple, well-defined signal.

**Cons:**
- Not all agents send bells
- Bell can be sent for other reasons (errors, warnings)
- Requires agent to be configured to send bells

### 6d. Hybrid: Hook + Timeout Fallback

The most robust approach for agents with limited hook support:

1. Register whatever hooks are available (e.g., Codex `notify`)
2. Start a timer when the agent emits its last output
3. If no output for N seconds AND no hook has fired, assume the agent is waiting
4. Reset timer when new output appears

This catches the gap between hook events (e.g., Codex `notify` fires on turn complete but not on approval prompts).

### Sources

- [pilotty](https://github.com/msmps/pilotty)
- [agent-tui](https://github.com/pproenca/agent-tui)

---

## 7. Community Projects for Agent Notifications

Several open-source projects have tackled this exact problem:

| Project | Agents Supported | Approach | Active? |
|---------|-----------------|----------|---------|
| [code-notify](https://github.com/mylee04/code-notify) | Claude, Codex, Gemini | Hook scripts per agent | Yes |
| [ai-agents-notifier](https://github.com/hta218/ai-agents-notifier) | Claude Code | Hook scripts | Yes |
| [CCNotify](https://github.com/dazuiba/CCNotify) | Claude Code | Hook scripts | Yes |
| [claude-code-notification](https://github.com/wyattjoh/claude-code-notification) | Claude Code | macOS native notifications via hooks | Yes |
| [Agentastic.dev](https://www.agentastic.dev/) | Claude Code | File-based waiting indicator + hooks | Yes (commercial) |
| [gemini-notifier](https://github.com/thoreinstein/gemini-notifier) | Gemini CLI | Gemini hooks | Yes |

### Agentastic.dev (Most Relevant Competitor)

Agentastic is the closest competitor to Bismarck's attention system. It uses:
1. **File-based waiting indicator**: monitors `.agentastic/waiting` file in workspace. When file exists and has content, agent is waiting.
2. **Terminal bell**: agents send `\a` on task completion, triggering macOS notification.
3. **Claude Code hooks**: standard hook configuration for notification events.

**Key insight from Agentastic:** The file-based approach (`/.agentastic/waiting`) is agent-agnostic -- any agent can create/remove this file. This is a simpler protocol than Unix sockets and could serve as a universal fallback.

### Sources

- [Agentastic Notifications Docs](https://www.agentastic.dev/docs/features/notifications)
- [code-notify README](https://github.com/mylee04/code-notify)

---

## 8. Comparison Matrix: Attention Detection Methods

| Method | Claude Code | Codex (PTY) | Codex (app-server) | Gemini CLI | Aider | Universal |
|--------|------------|-------------|---------------------|------------|-------|-----------|
| Hook: Stop/Turn Complete | `hooks.Stop` | `notify` callback | `turn.completed` event | `AfterAgent` hook | `--notifications-command` | No |
| Hook: Permission/Approval | `Notification[permission_prompt]` | Not available | `requestApproval` event | `Notification` hook | Not available | No |
| Hook: Idle Prompt | `Notification[idle_prompt]` | Not available | N/A | Not verified | Not available | No |
| PTY Output Monitoring | Possible | Possible | N/A | Possible | Possible | Yes |
| Process State Detection | Possible | Possible | N/A | Possible | Possible | Yes |
| Terminal Bell | Possible | Not default | N/A | Not default | `--notifications` | Partial |
| File-based Signal | Custom | Custom | N/A | Custom | Custom | Yes (if convention) |

---

## 9. Recommendations for Bismarck

### Immediate (Codex Support)

1. **Use Codex `notify` callback** for turn-complete detection. Configure in `~/.codex/config.toml`:
   ```toml
   notify = ["/path/to/bismarck/codex-notify.sh"]
   ```
   The script receives JSON as argv[1] (NOT stdin like Claude). Adapt the existing stop-hook pattern.

2. **Run Codex in full-auto mode** (`--full-auto` or `--ask-for-approval never`) to avoid the approval gap where no notification is available.

3. **Add PTY output timeout as fallback**: If no output for 30 seconds after the last burst, consider the agent idle. This catches cases the `notify` callback misses.

### Medium-term (Richer Codex Integration)

4. **Evaluate Codex app-server** for headless/Docker agent execution. The `requestApproval` events give full attention detection, and `turn/steer` enables mid-turn nudges. This is the path to feature parity with Claude Code's attention system.

5. **Monitor Codex hooks PRs** -- if a full hooks system lands in Codex, adopt it immediately. The code-notify project's existence suggests it may already be available in recent versions.

### Architecture

6. **Keep the Unix socket protocol** as the internal attention bus. It's already agent-agnostic. Only the hook scripts that WRITE to the sockets need per-agent adaptation.

7. **Abstract the hook registration** into the `AgentProvider` interface (already planned in `codex-support.md`):
   ```typescript
   interface AgentProvider {
     registerHooks(config: HookRegistrationConfig): Promise<void>
     supportsHooks(): boolean
     getAttentionCapabilities(): {
       turnComplete: boolean
       approvalWaiting: boolean
       idlePrompt: boolean
     }
   }
   ```

8. **Consider a file-based fallback** (like Agentastic's `.waiting` file) as a universal attention signal that any agent hook script can use, avoiding the need for Unix socket support in every hook script.

### What NOT to Do

- Do NOT build a comprehensive PTY output parser to detect agent states. It's a maintenance nightmare and breaks on every agent version update.
- Do NOT wait for a universal standard (ACP, etc.) -- the ecosystem is fragmented and will remain so. Build thin adapters per agent.
- Do NOT use Codex's `tui.notifications` -- it's internal to the TUI and cannot trigger external programs.

---

## 10. Confidence Assessment

| Area | Confidence | Reasoning |
|------|-----------|-----------|
| Claude Code hooks | **HIGH** | Official docs + working Bismarck implementation |
| Codex `notify` callback | **MEDIUM** | Official docs confirm it; exact payload format needs testing |
| Codex hooks system (full) | **LOW** | Multiple PRs exist but merger status unclear; code-notify claims support |
| Codex app-server protocol | **HIGH** | Well-documented on developers.openai.com |
| Gemini CLI hooks | **MEDIUM** | Documented on geminicli.com; not verified firsthand |
| Universal standard | **HIGH** (that none exists) | Confirmed across all sources |
| PTY-based detection | **MEDIUM** | Known to work but fragile; well-understood trade-offs |

---

## 11. Open Questions

1. **Does Codex have a `[hooks]` section in config.toml?** The code-notify project treats it as available, but official docs only show `notify`. Someone needs to install a current Codex version and check `codex --help` or the config schema.

2. **What is the exact JSON payload for Codex `notify`?** Official docs say it's passed as argv[1]. Need to verify: does it include `session_id` or equivalent for workspace mapping?

3. **Can Codex's `notify` callback detect approval-waiting?** The `tui.notifications` supports `approval-requested` filtering, but it's unclear if the `notify` callback also fires for approval events.

4. **Does the Codex app-server protocol support a `turn.completed` notification?** (Distinct from `requestApproval`.) If so, it would cover the "agent finished, waiting for next prompt" case.

5. **Gemini CLI hooks: is the config format JSON?** Multiple sources say `~/.gemini/settings.json` but this needs verification. The code-notify project references it.

---

## Key Takeaway

The hook ecosystem is converging but not standardized. Bismarck's existing architecture (hook script -> Unix socket -> socket server -> waiting queue -> UI) is sound and agent-agnostic at every layer except the hook scripts themselves. Supporting additional agents requires:

1. One hook registration function per agent (writes to that agent's config file)
2. One hook script per agent (reads event data in the agent's format, writes to the same Unix socket)
3. Possibly one config file format adapter per agent (JSON vs TOML)

The total effort per new agent is small -- the hard part is already built.
