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
