import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getConfigDir } from './config'

const HOOK_SCRIPT_NAME = 'stop-hook.sh'
const NOTIFICATION_HOOK_SCRIPT_NAME = 'notification-hook.sh'
const SESSION_START_HOOK_SCRIPT_NAME = 'session-start-hook.sh'

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

export function createHookScript(): void {
  const hookScript = `#!/bin/bash
# Bismarck StopHook - signals when agent needs input
# Optimized: single jq call, grep for mapping file

# Extract session_id with grep (faster than jq for simple extraction)
SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] && exit 0

MAPPING="$HOME/.bismarck/sessions/\${SESSION_ID}.json"
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
  const hookScript = `#!/bin/bash
# Bismarck NotificationHook - signals when agent needs permission
# Optimized: single jq call, grep for mapping file

# Extract session_id with grep (faster than jq for simple extraction)
SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] && exit 0

MAPPING="$HOME/.bismarck/sessions/\${SESSION_ID}.json"
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
  const hookScript = `#!/bin/bash
# Bismarck SessionStart hook - creates session-to-workspace mapping
# Runs at session start when env vars ARE available

SESSION_ID=$(grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -z "$SESSION_ID" ] || [ -z "$BISMARCK_WORKSPACE_ID" ] || [ -z "$BISMARCK_INSTANCE_ID" ] && exit 0

mkdir -p "$HOME/.bismarck/sessions"
printf '{"workspaceId":"%s","instanceId":"%s"}' "$BISMARCK_WORKSPACE_ID" "$BISMARCK_INSTANCE_ID" > "$HOME/.bismarck/sessions/\${SESSION_ID}.json"
exit 0
`

  const hookPath = getSessionStartHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

export function configureClaudeHook(): void {
  const settingsPath = getClaudeSettingsPath()
  const hookScriptPath = getHookScriptPath()
  const notificationHookScriptPath = getNotificationHookScriptPath()
  const sessionStartHookScriptPath = getSessionStartHookScriptPath()

  // Ensure hook scripts exist
  createHookScript()
  createNotificationHookScript()
  createSessionStartHookScript()

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
  const stopHookExists = settings.hooks.Stop?.some((config) =>
    config.hooks.some((hook) => hook.command.includes('bismarck'))
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
  const notificationHookExists = settings.hooks.Notification?.some((config) =>
    config.hooks.some((hook) => hook.command.includes('bismarck'))
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
  const sessionStartHookExists = settings.hooks.SessionStart?.some((config) =>
    config.hooks.some((hook) => hook.command.includes('bismarck'))
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

  if (!fs.existsSync(settingsPath)) {
    return false
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content) as ClaudeSettings

    const stopHookExists =
      settings.hooks?.Stop?.some((config) =>
        config.hooks.some((hook) => hook.command.includes('bismarck'))
      ) ?? false

    const notificationHookExists =
      settings.hooks?.Notification?.some((config) =>
        config.hooks.some((hook) => hook.command.includes('bismarck'))
      ) ?? false

    const sessionStartHookExists =
      settings.hooks?.SessionStart?.some((config) =>
        config.hooks.some((hook) => hook.command.includes('bismarck'))
      ) ?? false

    return stopHookExists && notificationHookExists && sessionStartHookExists
  } catch {
    return false
  }
}
