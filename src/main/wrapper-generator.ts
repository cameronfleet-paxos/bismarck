/**
 * Wrapper Generator
 *
 * Generates bash wrapper scripts for custom proxied tools.
 * Each wrapper script forwards tool invocations through the Bismarck
 * tool proxy server running on the host, enabling Docker containers
 * to use host-side tools (npm, kubectl, etc.) without installing them.
 *
 * Wrappers are stored per-container in ~/.bismarck/tool-wrappers/<containerId>/
 * and mounted into Docker containers at /bismarck-tools.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { getConfigDir } from './config'
import { loadSettings } from './settings-manager'

/**
 * Generate wrapper scripts for all enabled, non-builtIn proxied tools.
 * Returns the host directory path containing the wrappers, or null if none were generated.
 */
export async function generateToolWrappers(containerId: string): Promise<string | null> {
  const settings = await loadSettings()
  const customTools = settings.docker.proxiedTools.filter(t => t.enabled && !t.builtIn)

  if (customTools.length === 0) {
    return null
  }

  const wrapperDir = path.join(getConfigDir(), 'tool-wrappers', containerId)
  await fs.mkdir(wrapperDir, { recursive: true })

  for (const tool of customTools) {
    const script = generateWrapperScript(tool.name)
    const scriptPath = path.join(wrapperDir, tool.name)
    await fs.writeFile(scriptPath, script, { mode: 0o755 })
  }

  return wrapperDir
}

/**
 * Remove wrapper scripts for a container.
 * Silently ignores if the directory doesn't exist.
 */
export async function cleanupToolWrappers(containerId: string): Promise<void> {
  const wrapperDir = path.join(getConfigDir(), 'tool-wrappers', containerId)
  try {
    await fs.rm(wrapperDir, { recursive: true, force: true })
  } catch {
    // Directory doesn't exist or already removed
  }
}

/**
 * Generate a bash wrapper script that proxies a tool invocation
 * through the Bismarck tool proxy server.
 */
function generateWrapperScript(toolName: string): string {
  return `#!/bin/bash
set -e
PROXY_URL="\${TOOL_PROXY_URL:-http://host.docker.internal:9847}"
HOST_CWD="\${BISMARCK_HOST_WORKTREE_PATH:-}"
ARGS_JSON=$(printf '%s\\n' "$@" | jq -R . | jq -s .)
if [ -n "$HOST_CWD" ]; then
  BODY=$(jq -n --argjson args "$ARGS_JSON" --arg cwd "$HOST_CWD" '{args: $args, cwd: $cwd}')
else
  BODY=$(jq -n --argjson args "$ARGS_JSON" '{args: $args}')
fi
AUTH_HEADER=()
if [ -n "$TOOL_PROXY_TOKEN" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer \${TOOL_PROXY_TOKEN}")
fi
RESPONSE=$(curl -s -X POST "\${PROXY_URL}/${toolName}" \\
  -H "Content-Type: application/json" \\
  "\${AUTH_HEADER[@]}" \\
  -d "$BODY")
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
STDOUT=$(echo "$RESPONSE" | jq -r '.stdout // empty')
STDERR=$(echo "$RESPONSE" | jq -r '.stderr // empty')
EXIT_CODE=$(echo "$RESPONSE" | jq -r '.exitCode // 1')
if [ -n "$STDOUT" ]; then
  echo "$STDOUT"
fi
if [ -n "$STDERR" ]; then
  echo "$STDERR" >&2
fi
exit "$EXIT_CODE"
`
}
