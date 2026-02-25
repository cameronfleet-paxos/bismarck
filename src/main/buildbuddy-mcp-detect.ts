import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

export interface McpDetectionResult {
  path: string | null
  source: string
  valid: boolean
}

/**
 * Detect the BuildBuddy MCP server installation path.
 *
 * Checks these sources in order:
 * 1. Global mcpServers.buildbuddy in ~/.claude.json
 * 2. Per-project mcpServers.buildbuddy in ~/.claude.json projects
 * 3. Well-known paths: ~/.local/lib/buildbuddy-mcp, /usr/local/lib/buildbuddy-mcp
 */
export async function detectBuildBuddyMcpPath(): Promise<McpDetectionResult> {
  const claudeJsonPath = path.join(os.homedir(), '.claude.json')

  try {
    const raw = await fs.readFile(claudeJsonPath, 'utf-8')
    const claudeConfig = JSON.parse(raw)

    // 1. Check global mcpServers.buildbuddy
    const globalMcp = claudeConfig?.mcpServers?.buildbuddy
    if (globalMcp?.args?.[0]) {
      const candidate = extractMcpDir(globalMcp.args[0])
      if (candidate) {
        const valid = await validateMcpPath(candidate)
        return { path: candidate, source: '~/.claude.json (global)', valid }
      }
    }

    // 2. Check per-project mcpServers.buildbuddy
    const projects = claudeConfig?.projects
    if (projects && typeof projects === 'object') {
      for (const [projectPath, projectConfig] of Object.entries(projects)) {
        const config = projectConfig as Record<string, unknown>
        const mcpServers = config?.mcpServers as Record<string, { args?: string[] }> | undefined
        const bbMcp = mcpServers?.buildbuddy
        if (bbMcp?.args?.[0]) {
          const candidate = extractMcpDir(bbMcp.args[0])
          if (candidate) {
            const valid = await validateMcpPath(candidate)
            const projectName = path.basename(projectPath)
            return { path: candidate, source: `~/.claude.json (${projectName} project)`, valid }
          }
        }
      }
    }
  } catch {
    // ~/.claude.json missing or unparseable — fall through to well-known paths
  }

  // 3. Well-known paths
  const wellKnownPaths = [
    path.join(os.homedir(), '.local', 'lib', 'buildbuddy-mcp'),
    '/usr/local/lib/buildbuddy-mcp',
  ]

  for (const candidate of wellKnownPaths) {
    const valid = await validateMcpPath(candidate)
    if (valid) {
      return { path: candidate, source: 'well-known path', valid: true }
    }
  }

  return { path: null, source: 'not found', valid: false }
}

/**
 * Extract the MCP server directory from an args[0] path like
 * "/path/to/buildbuddy-mcp/dist/index.js" → "/path/to/buildbuddy-mcp"
 */
function extractMcpDir(argsPath: string): string | null {
  // Expected: .../dist/index.js — go up two levels
  const dir = path.dirname(path.dirname(argsPath))
  if (!dir || dir === '.' || dir === '/') return null
  return dir
}

/**
 * Validate that <dir>/dist/index.js exists.
 */
async function validateMcpPath(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'dist', 'index.js'))
    return true
  } catch {
    return false
  }
}
