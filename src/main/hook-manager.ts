import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getConfigDir } from './config'
import { PERSONA_PROMPTS } from './persona-prompts'

const HOOK_SCRIPT_NAME = 'stop-hook.sh'
const NOTIFICATION_HOOK_SCRIPT_NAME = 'notification-hook.sh'
const SESSION_START_HOOK_SCRIPT_NAME = 'session-start-hook.sh'
const PERSONA_MODE_HOOK_SCRIPT_NAME = 'persona-mode-hook.sh'

interface HookCommand {
  type: 'command'
  command: string
}

interface HookConfig {
  matcher?: string
  hooks: HookCommand[]
}

interface ClaudeSettings {
  hooks?: {
    Stop?: HookConfig[]
    Notification?: HookConfig[]
    SessionStart?: HookConfig[]
    UserPromptSubmit?: HookConfig[]
    [key: string]: HookConfig[] | undefined
  }
  [key: string]: unknown
}

function getClaudeSettingsPath(): string {
  const homeDir = app?.getPath('home') || process.env.HOME || ''
  return path.join(homeDir, '.claude', 'settings.json')
}

function getHookScriptPath(): string {
  return path.join(getConfigDir(), 'hooks', HOOK_SCRIPT_NAME)
}

function getNotificationHookScriptPath(): string {
  return path.join(getConfigDir(), 'hooks', NOTIFICATION_HOOK_SCRIPT_NAME)
}

function getSessionStartHookScriptPath(): string {
  return path.join(getConfigDir(), 'hooks', SESSION_START_HOOK_SCRIPT_NAME)
}

function getPersonaModeHookScriptPath(): string {
  return path.join(getConfigDir(), 'hooks', PERSONA_MODE_HOOK_SCRIPT_NAME)
}

// Get the config directory name (e.g., '.bismarck' or '.bismarck-dev')
function getConfigDirName(): string {
  return process.env.NODE_ENV === 'development' ? '.bismarck-dev' : '.bismarck'
}

/**
 * Escape a string for use in a bash script heredoc
 * Handles special characters to prevent JSON parsing issues
 */
function escapeForBashHeredoc(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

export function createHookScript(): void {
  const configDirName = getConfigDirName()
  const hookScript = `#!/bin/bash
# Bismarck StopHook - signals when agent needs input
# Optimized: single jq call, grep for mapping file

# Extract session_id with grep (faster than jq for simple extraction)
SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] && exit 0

MAPPING="$HOME/${configDirName}/sessions/\${SESSION_ID}.json"
[ ! -f "$MAPPING" ] && exit 0

# Read both values in one pass using grep (avoids jq startup overhead)
WORKSPACE_ID=$(grep -o '"workspaceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
INSTANCE_ID=$(grep -o '"instanceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
[ -z "$WORKSPACE_ID" ] || [ -z "$INSTANCE_ID" ] && exit 0

# Shortened IDs for macOS socket path limit
SOCKET_PATH="/tmp/bm/\${INSTANCE_ID:0:8}/\${WORKSPACE_ID:0:8}.sock"

[ -S "$SOCKET_PATH" ] && printf '{"event":"stop","reason":"input_required","workspaceId":"%s"}\\n' "$WORKSPACE_ID" | nc -U "$SOCKET_PATH" 2>/dev/null
exit 0
`

  const hookPath = getHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

export function createNotificationHookScript(): void {
  const configDirName = getConfigDirName()
  const hookScript = `#!/bin/bash
# Bismarck NotificationHook - signals when agent needs permission
# Optimized: single jq call, grep for mapping file

# Extract session_id with grep (faster than jq for simple extraction)
SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] && exit 0

MAPPING="$HOME/${configDirName}/sessions/\${SESSION_ID}.json"
[ ! -f "$MAPPING" ] && exit 0

# Read both values in one pass using grep (avoids jq startup overhead)
WORKSPACE_ID=$(grep -o '"workspaceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
INSTANCE_ID=$(grep -o '"instanceId":"[^"]*"' "$MAPPING" | cut -d'"' -f4)
[ -z "$WORKSPACE_ID" ] || [ -z "$INSTANCE_ID" ] && exit 0

# Shortened IDs for macOS socket path limit
SOCKET_PATH="/tmp/bm/\${INSTANCE_ID:0:8}/\${WORKSPACE_ID:0:8}.sock"

[ -S "$SOCKET_PATH" ] && printf '{"event":"stop","reason":"input_required","workspaceId":"%s"}\\n' "$WORKSPACE_ID" | nc -U "$SOCKET_PATH" 2>/dev/null
exit 0
`

  const hookPath = getNotificationHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

export function createSessionStartHookScript(): void {
  const configDirName = getConfigDirName()
  const hookScript = `#!/bin/bash
# Bismarck SessionStart hook - creates session-to-workspace mapping
# Runs at session start when env vars ARE available

SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] || [ -z "$BISMARCK_WORKSPACE_ID" ] || [ -z "$BISMARCK_INSTANCE_ID" ] && exit 0

mkdir -p "$HOME/${configDirName}/sessions"
printf '{"workspaceId":"%s","instanceId":"%s"}' "$BISMARCK_WORKSPACE_ID" "$BISMARCK_INSTANCE_ID" > "$HOME/${configDirName}/sessions/\${SESSION_ID}.json"
exit 0
`

  const hookPath = getSessionStartHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

/**
 * Create the unified persona mode hook script
 * This single script handles all persona modes: none, bismarck, otto, and custom
 */
export function createPersonaModeHookScript(): void {
  const configDirName = getConfigDirName()

  // Escape the persona prompts for embedding in bash
  const bismarckPromptEscaped = escapeForBashHeredoc(PERSONA_PROMPTS.bismarck)
  const ottoPromptEscaped = escapeForBashHeredoc(PERSONA_PROMPTS.otto)

  const hookScript = `#!/bin/bash
# Bismarck Persona Mode hook - injects persona prompts for interactive agents
# Fires on UserPromptSubmit to add context to interactive Claude sessions
# Supports: none, bismarck, otto, custom

# Check settings file
SETTINGS_FILE="$HOME/${configDirName}/settings.json"
[ ! -f "$SETTINGS_FILE" ] && exit 0

# Extract personaMode using grep (faster than jq)
# Look for "personaMode": "value" pattern
PERSONA_MODE=$(grep -o '"personaMode"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" | head -1 | sed 's/.*"personaMode"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')

# If no personaMode found or is "none", exit silently
[ -z "$PERSONA_MODE" ] && exit 0
[ "$PERSONA_MODE" = "none" ] && exit 0

# Function to output JSON with persona prompt
output_persona() {
  local PROMPT="$1"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\\n' "$PROMPT"
}

case "$PERSONA_MODE" in
  "bismarck")
    output_persona "${bismarckPromptEscaped}"
    ;;
  "otto")
    output_persona "${ottoPromptEscaped}"
    ;;
  "custom")
    # Extract customPersonaPrompt from settings
    # This is trickier since it can contain newlines and special chars
    # We use a Python one-liner for reliable JSON parsing
    CUSTOM_PROMPT=$(python3 -c "
import json
import sys
try:
    with open('$SETTINGS_FILE', 'r') as f:
        settings = json.load(f)
    prompt = settings.get('playbox', {}).get('customPersonaPrompt', '')
    if prompt:
        # Escape for JSON embedding
        escaped = prompt.replace('\\\\', '\\\\\\\\').replace('\"', '\\\\\"').replace('\\n', '\\\\n').replace('\\r', '\\\\r').replace('\\t', '\\\\t')
        print(escaped, end='')
except:
    pass
" 2>/dev/null)
    [ -n "$CUSTOM_PROMPT" ] && output_persona "$CUSTOM_PROMPT"
    ;;
  *)
    # Unknown mode, exit silently
    ;;
esac

exit 0
`

  const hookPath = getPersonaModeHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

export function configureClaudeHook(): void {
  const settingsPath = getClaudeSettingsPath()
  const hookScriptPath = getHookScriptPath()
  const notificationHookScriptPath = getNotificationHookScriptPath()
  const sessionStartHookScriptPath = getSessionStartHookScriptPath()
  const personaModeHookScriptPath = getPersonaModeHookScriptPath()

  // Ensure hook scripts exist
  createHookScript()
  createNotificationHookScript()
  createSessionStartHookScript()
  createPersonaModeHookScript()

  // Read existing settings or create new
  let settings: ClaudeSettings = {}
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8')
      settings = JSON.parse(content)
    } catch (e) {
      console.error('Failed to read Claude settings:', e)
    }
  }

  // Initialize hooks structure if needed
  if (!settings.hooks) {
    settings.hooks = {}
  }

  let settingsChanged = false

  // Configure Stop hook
  // Check for EXACT path match to ensure dev/prod hooks don't conflict
  const stopHookExists = settings.hooks.Stop?.some((config) =>
    config.hooks.some((hook) => hook.command === hookScriptPath)
  )

  if (!stopHookExists) {
    const newHookCommand: HookCommand = {
      type: 'command',
      command: hookScriptPath,
    }

    if (settings.hooks.Stop && settings.hooks.Stop.length > 0) {
      // Add to existing Stop[0].hooks array (alongside notify.sh, allow-sleep.sh, etc.)
      settings.hooks.Stop[0].hooks.push(newHookCommand)
    } else {
      // Create new Stop config array
      settings.hooks.Stop = [
        {
          hooks: [newHookCommand],
        },
      ]
    }
    settingsChanged = true
    console.log('Configured Claude Code Stop hook for Bismarck')
  }

  // Configure Notification hook for permission prompts
  // Check for EXACT path match to ensure dev/prod hooks don't conflict
  const notificationHookExists = settings.hooks.Notification?.some((config) =>
    config.hooks.some((hook) => hook.command === notificationHookScriptPath)
  )

  if (!notificationHookExists) {
    const newNotificationHook: HookConfig = {
      matcher: 'permission_prompt',
      hooks: [
        {
          type: 'command',
          command: notificationHookScriptPath,
        },
      ],
    }

    if (!settings.hooks.Notification) {
      settings.hooks.Notification = []
    }
    settings.hooks.Notification.push(newNotificationHook)
    settingsChanged = true
    console.log('Configured Claude Code Notification hook for Bismarck')
  }

  // Configure SessionStart hook to create session-to-workspace mapping
  // Check for EXACT path match to ensure dev/prod hooks don't conflict
  const sessionStartHookExists = settings.hooks.SessionStart?.some((config) =>
    config.hooks.some((hook) => hook.command === sessionStartHookScriptPath)
  )

  if (!sessionStartHookExists) {
    const newSessionStartHook: HookConfig = {
      hooks: [
        {
          type: 'command',
          command: sessionStartHookScriptPath,
        },
      ],
    }

    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = []
    }
    settings.hooks.SessionStart.push(newSessionStartHook)
    settingsChanged = true
    console.log('Configured Claude Code SessionStart hook for Bismarck')
  }

  // Configure UserPromptSubmit hook for Persona Mode (unified)
  // Check for EXACT path match to ensure dev/prod hooks don't conflict
  const personaModeHookExists = settings.hooks.UserPromptSubmit?.some((config) =>
    config.hooks.some((hook) => hook.command === personaModeHookScriptPath)
  )

  if (!personaModeHookExists) {
    // Remove old bismarck-mode-hook and otto-mode-hook entries if they exist
    if (settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (config) => !config.hooks.some((hook) =>
          hook.command.includes('bismarck-mode-hook') || hook.command.includes('otto-mode-hook')
        )
      )
    }

    // Add the new unified persona-mode-hook
    const newPersonaModeHook: HookConfig = {
      hooks: [
        {
          type: 'command',
          command: personaModeHookScriptPath,
        },
      ],
    }

    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = []
    }
    settings.hooks.UserPromptSubmit.push(newPersonaModeHook)
    settingsChanged = true
    console.log('Configured Claude Code UserPromptSubmit hook for Persona Mode')
  }

  if (settingsChanged) {
    // Ensure .claude directory exists
    const claudeDir = path.dirname(settingsPath)
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true })
    }

    // Write updated settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
  }
}

export function isHookConfigured(): boolean {
  const settingsPath = getClaudeSettingsPath()
  const hookScriptPath = getHookScriptPath()
  const notificationHookScriptPath = getNotificationHookScriptPath()
  const sessionStartHookScriptPath = getSessionStartHookScriptPath()
  const personaModeHookScriptPath = getPersonaModeHookScriptPath()

  if (!fs.existsSync(settingsPath)) {
    return false
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content) as ClaudeSettings

    // Check for EXACT path match to ensure dev/prod hooks don't conflict
    const stopHookExists =
      settings.hooks?.Stop?.some((config) =>
        config.hooks.some((hook) => hook.command === hookScriptPath)
      ) ?? false

    const notificationHookExists =
      settings.hooks?.Notification?.some((config) =>
        config.hooks.some((hook) => hook.command === notificationHookScriptPath)
      ) ?? false

    const sessionStartHookExists =
      settings.hooks?.SessionStart?.some((config) =>
        config.hooks.some((hook) => hook.command === sessionStartHookScriptPath)
      ) ?? false

    const personaModeHookExists =
      settings.hooks?.UserPromptSubmit?.some((config) =>
        config.hooks.some((hook) => hook.command === personaModeHookScriptPath)
      ) ?? false

    return stopHookExists && notificationHookExists && sessionStartHookExists && personaModeHookExists
  } catch {
    return false
  }
}
