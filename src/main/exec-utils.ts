/**
 * Utility for executing shell commands with extended PATH
 * GUI apps don't inherit shell PATH, so we need to explicitly include
 * common user binary directories
 */

import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { exec as execCallback, spawn as spawnRaw, ExecOptions, SpawnOptions, ChildProcess } from 'child_process'
import { promisify } from 'util'

const execRaw = promisify(execCallback)

/**
 * Get extended PATH that includes common user bin directories
 * This is needed because GUI apps don't inherit shell PATH
 */
export function getExtendedPath(): string {
  const home = os.homedir()
  const extraPaths = [
    // User local binaries
    `${home}/.local/bin`,
    // Cargo (Rust)
    `${home}/.cargo/bin`,
    // asdf version manager
    `${home}/.asdf/shims`,
    `${home}/.asdf/bin`,
    // nvm (Node Version Manager)
    `${home}/.nvm/current/bin`,
    // pyenv
    `${home}/.pyenv/shims`,
    `${home}/.pyenv/bin`,
    // Go
    `${home}/go/bin`,
    // Homebrew
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    // Standard paths
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  const currentPath = process.env.PATH || ''
  // Prepend extra paths so they take priority, deduplicate
  const allPaths = [...extraPaths, ...currentPath.split(':')]
  return [...new Set(allPaths)].filter(Boolean).join(':')
}

/**
 * Find the full path to a binary by searching common locations
 * Returns null if not found
 */
export function findBinary(name: string): string | null {
  const home = os.homedir()
  const searchPaths = [
    `${home}/.local/bin`,
    `${home}/.cargo/bin`,
    `${home}/.asdf/shims`,
    `${home}/.asdf/bin`,
    `${home}/.nvm/current/bin`,
    `${home}/.pyenv/shims`,
    `${home}/.pyenv/bin`,
    `${home}/go/bin`,
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]

  for (const dir of searchPaths) {
    const fullPath = path.join(dir, name)
    try {
      // Check if file exists and is executable
      fs.accessSync(fullPath, fs.constants.X_OK)
      return fullPath
    } catch {
      // Not found or not executable, continue searching
    }
  }

  return null
}

/**
 * Check if a binary is available
 */
export function hasBinary(name: string): boolean {
  return findBinary(name) !== null
}

/**
 * Execute a command with extended PATH that includes user bin directories
 * Use this instead of child_process.exec for commands that might be in user paths
 */
export async function execWithPath(
  command: string,
  options?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  const env = {
    ...process.env,
    PATH: getExtendedPath(),
  }
  const result = await execRaw(command, { ...options, env })
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

/**
 * Execute a binary by its name, automatically finding its full path
 * Throws if binary is not found
 */
export async function execBinary(
  binaryName: string,
  args: string[],
  options?: ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = findBinary(binaryName)
  if (!binaryPath) {
    throw new Error(`Binary not found: ${binaryName}. Searched common paths.`)
  }

  // Quote args that contain spaces
  const quotedArgs = args.map(arg =>
    arg.includes(' ') ? `"${arg}"` : arg
  )
  const command = `"${binaryPath}" ${quotedArgs.join(' ')}`

  return execWithPath(command, options)
}

/**
 * Spawn a process with extended PATH that includes user bin directories
 * Use this instead of child_process.spawn for commands that might be in user paths
 * Returns the ChildProcess for streaming output
 */
export function spawnWithPath(
  command: string,
  args: string[],
  options?: SpawnOptions
): ChildProcess {
  const env = {
    ...process.env,
    PATH: getExtendedPath(),
  }
  return spawnRaw(command, args, { ...options, env: { ...options?.env, ...env } })
}

/**
 * Get environment variables with extended PATH
 * Useful when you need to set up env for spawn but want to add more variables
 */
export function getEnvWithPath(additionalEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...additionalEnv,
    PATH: getExtendedPath(),
  }
}

/**
 * Detect paths for all standard tools using findBinary
 * This works in production Electron builds where 'which' doesn't find tools
 */
export function detectToolPaths(): { bd: string | null; gh: string | null; git: string | null } {
  return {
    bd: findBinary('bd'),
    gh: findBinary('gh'),
    git: findBinary('git'),
  }
}

/**
 * Extended result from getEnvFromShellProfileWithReason
 */
interface ShellProfileResult {
  value: string | null
  reason?: 'command_substitution' | 'unresolved_ref' | 'invalid_token'
}

/**
 * Get an environment variable value from shell profile files with reason for failure
 * This is used internally to provide better error messages to the UI
 */
async function getEnvFromShellProfileWithReason(varName: string): Promise<ShellProfileResult> {
  const home = os.homedir()

  // Shell profile files to check - we read ALL of them to build a complete picture
  const profileFiles = [
    path.join(home, '.zshenv'),
    path.join(home, '.zprofile'),
    path.join(home, '.zshrc'),
    path.join(home, '.profile'),
    path.join(home, '.bash_profile'),
    path.join(home, '.bashrc'),
  ]

  // Collect ALL exports from all profile files
  const allExports = new Map<string, string>()

  for (const profilePath of profileFiles) {
    try {
      const content = fs.readFileSync(profilePath, 'utf-8')
      const fileExports = parseAllExportsFromContent(content)

      for (const [key, value] of fileExports) {
        allExports.set(key, value)
      }
    } catch {
      // File doesn't exist or can't be read, continue to next
    }
  }

  // Look up the requested variable
  const rawValue = allExports.get(varName)
  if (!rawValue) {
    return { value: null }
  }

  // Check for command substitution before attempting resolution
  if (rawValue.includes('$(') || rawValue.includes('`')) {
    return { value: null, reason: 'command_substitution' }
  }

  // Resolve any variable references
  const resolvedValue = resolveVariableReferences(rawValue, allExports)
  if (!resolvedValue) {
    return { value: null, reason: 'unresolved_ref' }
  }

  // Validate it looks like a GitHub token
  if (isValidGitHubToken(resolvedValue)) {
    return { value: resolvedValue }
  }

  return { value: null, reason: 'invalid_token' }
}

/**
 * Detect GitHub token from environment variables or shell profile
 * Returns token and source, or null if not found
 *
 * Checks in order:
 * 1. Current process environment variables (works when launched from terminal)
 * 2. Shell profile via login shell (works when launched from Finder/Spotlight)
 *
 * Note: We intentionally do NOT check `gh auth token` or ~/.config/gh/hosts.yml
 * because those return OAuth tokens that don't work with SAML SSO organizations.
 * Users need to provide a PAT (Personal Access Token) that has been authorized
 * for SAML SSO via the GITHUB_TOKEN environment variable.
 */
export async function detectGitHubToken(): Promise<{ token: string; source: string } | null> {
  // Common GitHub token environment variable names
  // We check all of these but report as "GITHUB_TOKEN" for simplicity
  const envVars = [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'GITHUB_API_TOKEN',
    'GITHUB_ACCESS_TOKEN',
    'GITHUB_PAT',
    'GH_PAT',
  ]

  // 1. Check current process environment (works when launched from terminal)
  for (const envVar of envVars) {
    const token = process.env[envVar]
    if (token && token.length > 0) {
      return { token, source: `${envVar} environment variable` }
    }
  }

  // 2. Try to get from shell profile by spawning a login shell
  // This works for GUI apps launched from Finder that don't inherit shell env vars
  for (const envVar of envVars) {
    const token = await getEnvFromShellProfile(envVar)
    if (token && token.length > 0) {
      return { token, source: `${envVar} from shell profile` }
    }
  }

  return null
}

/**
 * Detect GitHub token with extended failure information
 * Used by the setup wizard to provide better guidance to users
 */
export async function detectGitHubTokenWithReason(): Promise<{
  token: string | null
  source: string | null
  reason?: 'command_substitution' | 'unresolved_ref' | 'invalid_token' | 'not_found'
}> {
  // Common GitHub token environment variable names
  // We check all of these but report as "GITHUB_TOKEN" for simplicity
  const envVars = [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'GITHUB_API_TOKEN',
    'GITHUB_ACCESS_TOKEN',
    'GITHUB_PAT',
    'GH_PAT',
  ]

  // 1. Check current process environment (works when launched from terminal)
  for (const envVar of envVars) {
    const token = process.env[envVar]
    if (token && token.length > 0) {
      return { token, source: `${envVar} environment variable` }
    }
  }

  // 2. Try to get from shell profile with reason tracking
  for (const envVar of envVars) {
    const result = await getEnvFromShellProfileWithReason(envVar)
    if (result.value) {
      return { token: result.value, source: `${envVar} from shell profile` }
    }
    // If we found the variable but couldn't resolve it, return the reason
    if (result.reason) {
      return { token: null, source: null, reason: result.reason }
    }
  }

  return { token: null, source: null, reason: 'not_found' }
}

/**
 * Get an environment variable value from shell profile files
 *
 * Security considerations:
 * - We parse the files directly rather than executing them to avoid running arbitrary code
 * - We only look for simple `export VAR=value` patterns
 * - The token is only used within this process, never logged or exposed
 *
 * This approach is safer than spawning a shell but may miss complex configurations
 * (e.g., tokens set via scripts or conditionals). For those cases, users should
 * manually configure the token in Settings.
 *
 * Multi-pass resolution:
 * 1. Collect ALL exports from ALL profile files into one Map
 * 2. Look up the requested variable
 * 3. Resolve any $VAR references using the collected exports
 * 4. Validate with isValidGitHubToken()
 */
async function getEnvFromShellProfile(varName: string): Promise<string | null> {
  const home = os.homedir()

  // Shell profile files to check - we read ALL of them to build a complete picture
  const profileFiles = [
    path.join(home, '.zshenv'),        // zsh sources this for all shells (first)
    path.join(home, '.zprofile'),
    path.join(home, '.zshrc'),
    path.join(home, '.profile'),
    path.join(home, '.bash_profile'),
    path.join(home, '.bashrc'),
  ]

  // Collect ALL exports from all profile files
  const allExports = new Map<string, string>()

  for (const profilePath of profileFiles) {
    try {
      const content = fs.readFileSync(profilePath, 'utf-8')
      const fileExports = parseAllExportsFromContent(content)

      // Merge into allExports (later files override earlier ones)
      for (const [key, value] of fileExports) {
        allExports.set(key, value)
      }
    } catch {
      // File doesn't exist or can't be read, continue to next
    }
  }

  // Look up the requested variable
  const rawValue = allExports.get(varName)
  if (!rawValue) {
    return null
  }

  // Resolve any variable references
  const resolvedValue = resolveVariableReferences(rawValue, allExports)
  if (!resolvedValue) {
    return null
  }

  // Validate it looks like a GitHub token
  if (isValidGitHubToken(resolvedValue)) {
    return resolvedValue
  }

  return null
}

/**
 * Parse an export statement from shell profile content
 * Handles common patterns:
 * - export VAR=value
 * - export VAR="value"
 * - export VAR='value'
 *
 * Does NOT handle:
 * - Command substitution: export VAR=$(command)
 * - Variable references: export VAR=$OTHER_VAR
 * - Conditional exports or exports inside functions
 */
function parseExportFromContent(content: string, varName: string): string | null {
  // Match: export VARNAME=value or export VARNAME="value" or export VARNAME='value'
  // The value can be:
  // - Unquoted: sequence of non-whitespace, non-special chars
  // - Double-quoted: anything between double quotes (may contain escaped chars)
  // - Single-quoted: anything between single quotes (literal)

  const patterns = [
    // export VAR="value" (double-quoted)
    new RegExp(`^\\s*export\\s+${varName}="([^"]*)"`, 'm'),
    // export VAR='value' (single-quoted)
    new RegExp(`^\\s*export\\s+${varName}='([^']*)'`, 'm'),
    // export VAR=value (unquoted - be conservative, only allow token-like chars)
    new RegExp(`^\\s*export\\s+${varName}=([a-zA-Z0-9_]+)`, 'm'),
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    if (match && match[1]) {
      const value = match[1]
      // Validate it looks like a GitHub token (starts with ghp_, gho_, ghs_, ghu_, or github_pat_)
      // This prevents accidentally picking up placeholder values
      if (isValidGitHubToken(value)) {
        return value
      }
    }
  }

  return null
}

/**
 * Check if a value looks like a valid GitHub token
 * GitHub tokens have specific prefixes:
 * - ghp_ : Personal access tokens (classic)
 * - gho_ : OAuth tokens
 * - ghs_ : Server-to-server tokens
 * - ghu_ : User-to-server tokens
 * - github_pat_ : Fine-grained personal access tokens
 */
function isValidGitHubToken(value: string): boolean {
  if (!value || value.length < 10) return false

  const validPrefixes = ['ghp_', 'gho_', 'ghs_', 'ghu_', 'github_pat_']
  return validPrefixes.some(prefix => value.startsWith(prefix))
}

/**
 * Parse ALL export statements from shell profile content into a Map
 * This collects all exports so we can resolve variable references later
 *
 * Handles:
 * - export VAR=value
 * - export VAR="value"
 * - export VAR='value'
 * - export VAR=$OTHER_VAR (raw, for later resolution)
 * - export VAR="${OTHER_VAR}" (raw, for later resolution)
 */
function parseAllExportsFromContent(content: string): Map<string, string> {
  const exports = new Map<string, string>()

  // Split content into lines and process each
  const lines = content.split('\n')

  for (const line of lines) {
    // Skip comments and empty lines
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Match export statements - be more permissive to capture variable refs
    // export VAR="value" or export VAR='value' or export VAR=value
    const exportMatch = trimmed.match(/^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!exportMatch) continue

    const varName = exportMatch[1]
    let rawValue = exportMatch[2]

    // Handle quoted values
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      // Double-quoted - strip quotes but preserve content (including $vars)
      rawValue = rawValue.slice(1, -1)
    } else if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
      // Single-quoted - strip quotes, content is literal
      rawValue = rawValue.slice(1, -1)
    } else {
      // Unquoted - take until whitespace or comment
      const spaceIdx = rawValue.search(/\s|#/)
      if (spaceIdx > 0) {
        rawValue = rawValue.substring(0, spaceIdx)
      }
    }

    exports.set(varName, rawValue)
  }

  return exports
}

/**
 * Resolve variable references ($VAR and ${VAR}) in a value
 *
 * Returns the resolved value, or null if:
 * - The value contains command substitution $(...)
 * - A referenced variable cannot be resolved
 * - Recursion depth exceeded (cycle protection)
 *
 * @param value - The value to resolve
 * @param exports - Map of all exported variables
 * @param visited - Set of variable names currently being resolved (cycle detection)
 * @param maxDepth - Maximum recursion depth (default 10)
 */
function resolveVariableReferences(
  value: string,
  exports: Map<string, string>,
  visited: Set<string> = new Set(),
  maxDepth: number = 10
): string | null {
  // Check for command substitution - we can't safely resolve these
  if (value.includes('$(') || value.includes('`')) {
    return null
  }

  // Check recursion depth
  if (maxDepth <= 0) {
    return null
  }

  // Pattern to match variable references: $VAR or ${VAR}
  const varPattern = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g

  let result = value
  let match: RegExpExecArray | null

  // Find all variable references
  const refs: Array<{ full: string; varName: string }> = []
  while ((match = varPattern.exec(value)) !== null) {
    refs.push({ full: match[0], varName: match[1] })
  }

  // If no variable references, return the value as-is
  if (refs.length === 0) {
    return value
  }

  // Resolve each reference
  for (const ref of refs) {
    // Check for cycles
    if (visited.has(ref.varName)) {
      return null
    }

    // Look up the variable in our exports
    const refValue = exports.get(ref.varName)
    if (refValue === undefined) {
      // Variable not found in exports - can't resolve
      return null
    }

    // Recursively resolve the referenced value
    const newVisited = new Set(visited)
    newVisited.add(ref.varName)

    const resolvedRef = resolveVariableReferences(refValue, exports, newVisited, maxDepth - 1)
    if (resolvedRef === null) {
      return null
    }

    // Replace the reference with the resolved value
    result = result.replace(ref.full, resolvedRef)
  }

  return result
}
