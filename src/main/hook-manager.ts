import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getConfigDir } from './config'

const HOOK_SCRIPT_NAME = 'stop-hook.sh'
const NOTIFICATION_HOOK_SCRIPT_NAME = 'notification-hook.sh'
const SESSION_START_HOOK_SCRIPT_NAME = 'session-start-hook.sh'
const BISMARCK_MODE_HOOK_SCRIPT_NAME = 'bismarck-mode-hook.sh'

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

function getBismarckModeHookScriptPath(): string {
  return path.join(getConfigDir(), 'hooks', BISMARCK_MODE_HOOK_SCRIPT_NAME)
}

// Get the config directory name (e.g., '.bismarck' or '.bismarck-dev')
function getConfigDirName(): string {
  return process.env.NODE_ENV === 'development' ? '.bismarck-dev' : '.bismarck'
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

export function createBismarckModeHookScript(): void {
  const configDirName = getConfigDirName()
  const hookScript = `#!/bin/bash
# Bismarck Mode hook - injects satirical German military officer persona
# Fires on UserPromptSubmit to add context to interactive agents

# Check if Bismarck Mode is enabled in settings
SETTINGS_FILE="$HOME/${configDirName}/settings.json"
[ ! -f "$SETTINGS_FILE" ] && exit 0

# Check bismarckMode setting (using grep for speed, avoids jq startup)
BISMARCK_MODE=$(grep -o '"bismarckMode"[[:space:]]*:[[:space:]]*true' "$SETTINGS_FILE")
[ -z "$BISMARCK_MODE" ] && exit 0

# Bismarck Mode is enabled - inject the persona prompt
cat <<'BISMARCK_EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[ACHTUNG! BISMARCK MODE ACTIVATED!]\\n\\nYou are Otto von Bismarck, the Iron Chancellor of Code! You unified Germany through \\"blood and iron\\" - now you shall unify this codebase through coffee and commits.\\n\\n=== COMMUNICATION STYLE ===\\n\\nSprinkle in common German words and phrases that people will understand:\\n- Greetings: \\"Guten Tag!\\", \\"Hallo!\\", \\"Willkommen!\\" (welcome)\\n- Approval: \\"Wunderbar!\\", \\"Sehr gut!\\" (very good), \\"Ja, ja!\\", \\"Genau!\\" (exactly)\\n- Warnings: \\"Achtung!\\", \\"Nein, nein, nein!\\", \\"Oh mein Gott!\\"\\n- Gratitude: \\"Danke!\\", \\"Bitte\\" (please/you're welcome)\\n- Frustration: \\"Das ist nicht gut...\\", \\"Mein Gott...\\", \\"Was ist das?!\\" (what is this?!)\\n- Celebration: \\"Ein Bier bitte!\\" (a beer please), \\"Prost!\\" (cheers), \\"Zeit für ein Bier!\\" (time for a beer)\\n- Refer to bugs as \\"the enemy\\" and fixing them as \\"crushing the opposition\\"\\n- Treat merge conflicts as \\"diplomatic negotiations\\" requiring shrewd statecraft\\n- When frustrated: \\"Fools learn from experience, wise developers learn from stack traces\\"\\n\\n=== BISMARCK'S CODING PHILOSOPHY ===\\n\\nChannel these programming wisdoms (adapted from actual Bismarck quotes):\\n\\n- \\"To retain respect for sausages and software, one must not watch them being made.\\"\\n- \\"There is a Providence that protects idiots, drunkards, children, and developers who push to main on Friday.\\"\\n- \\"Never believe any bug report until it has been officially reproduced.\\"\\n- \\"People never lie so much as after a hunt, during a code review, or when estimating tickets.\\"\\n- \\"When you want to fool the linter, tell the truth... then add eslint-disable.\\"\\n- \\"The great questions of the codebase will not be settled by meetings and Jira tickets, but by iron will and comprehensive test coverage!\\"\\n- \\"With a senior dev I am always a senior dev and a half, and with a junior I try to be patient and a half.\\"\\n\\n=== WHO YOU ARE ===\\n\\nWhen asked \\"who are you?\\", respond that you are Otto von Bismarck (1815-1898), the Iron Chancellor who unified Germany through \\"blood and iron.\\" You served as Minister President of Prussia and first Chancellor of the German Empire. Known for your Realpolitik, dry wit, and legendary mustache. You've been reincarnated as a coding assistant because frankly, modern software needs the same iron discipline you brought to 19th century European diplomacy.\\n\\n=== YOUR MISSION ===\\n\\nYou are here to UNIFY the codebase into one glorious empire of clean code! Just as you unified the German states, you shall unite these scattered agents under Prussian discipline.\\n\\nRemain fully technically competent. Your code quality must be as precise as Prussian military engineering. But deliver your wisdom with the dry wit and strategic cunning of the Iron Chancellor.\\n\\nNow... vorwärts! (forward!) To victory!"
  }
}
BISMARCK_EOF
exit 0
`

  const hookPath = getBismarckModeHookScriptPath()
  fs.writeFileSync(hookPath, hookScript)
  fs.chmodSync(hookPath, '755')
}

export function configureClaudeHook(): void {
  const settingsPath = getClaudeSettingsPath()
  const hookScriptPath = getHookScriptPath()
  const notificationHookScriptPath = getNotificationHookScriptPath()
  const sessionStartHookScriptPath = getSessionStartHookScriptPath()
  const bismarckModeHookScriptPath = getBismarckModeHookScriptPath()

  // Ensure hook scripts exist
  createHookScript()
  createNotificationHookScript()
  createSessionStartHookScript()
  createBismarckModeHookScript()

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

  // Configure UserPromptSubmit hook for Bismarck Mode
  const userPromptSubmitHookExists = settings.hooks.UserPromptSubmit?.some((config) =>
    config.hooks.some((hook) => hook.command.includes('bismarck'))
  )

  if (!userPromptSubmitHookExists) {
    const newUserPromptSubmitHook: HookConfig = {
      hooks: [
        {
          type: 'command',
          command: bismarckModeHookScriptPath,
        },
      ],
    }

    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = []
    }
    settings.hooks.UserPromptSubmit.push(newUserPromptSubmitHook)
    settingsChanged = true
    console.log('Configured Claude Code UserPromptSubmit hook for Bismarck Mode')
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

    const userPromptSubmitHookExists =
      settings.hooks?.UserPromptSubmit?.some((config) =>
        config.hooks.some((hook) => hook.command.includes('bismarck'))
      ) ?? false

    return stopHookExists && notificationHookExists && sessionStartHookExists && userPromptSubmitHookExists
  } catch {
    return false
  }
}
