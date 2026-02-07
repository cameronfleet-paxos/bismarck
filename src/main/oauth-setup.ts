/**
 * OAuth Setup for Claude Code
 *
 * Handles running `claude setup-token` to get an OAuth token
 * and storing it for use by headless agents.
 */

import { setClaudeOAuthToken } from './config'
import { spawnWithPath } from './exec-utils'
import { devLog } from './dev-log'

// Regex to match OAuth tokens from claude setup-token output
// Tokens are ~108 chars and end with 'AA'
const TOKEN_REGEX = /sk-ant-oat01-[A-Za-z0-9_-]+AA/

// Strip ANSI escape sequences and control characters from output
// This handles color codes, cursor movement, and other terminal control sequences
function stripAnsi(str: string): string {
  return (
    str
      // Remove all ANSI escape sequences (colors, cursor movement, etc.)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
      // Remove carriage returns
      .replace(/\r/g, '')
      // Remove newlines to handle tokens split across lines
      .replace(/\n/g, '')
  )
}

/**
 * Run `claude setup-token` to interactively get an OAuth token
 *
 * This spawns the claude CLI with the setup-token command, which:
 * 1. Opens the browser for OAuth authentication
 * 2. Outputs the token to stdout when complete
 *
 * We use `script -q /dev/null` to allocate a PTY, which is required
 * for the interactive OAuth flow to work properly.
 *
 * @returns The OAuth token string
 * @throws Error if setup-token fails or no token is found
 */
export async function runSetupToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    devLog('[OAuthSetup] Starting claude setup-token...')

    // Use `script` to allocate a PTY for the interactive command
    // This is necessary on macOS/Linux for the OAuth flow to work
    // Use spawnWithPath to ensure claude is found in user paths
    const proc = spawnWithPath('script', ['-q', '/dev/null', 'claude', 'setup-token'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let tokenFound = false

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString()
      stdout += chunk

      // Strip ANSI codes and check for token in output
      const cleanOutput = stripAnsi(stdout)
      const match = cleanOutput.match(TOKEN_REGEX)
      if (match && !tokenFound) {
        tokenFound = true
        const token = match[0]
        devLog('[OAuthSetup] Token found, length:', token.length)
        devLog('[OAuthSetup] Token prefix:', token.substring(0, 40) + '...')
        setClaudeOAuthToken(token)
        // Kill the process since we have the token
        proc.kill()
        resolve(token)
      }
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (tokenFound) {
        // Already resolved with token
        return
      }

      devLog('[OAuthSetup] Process closed with code:', code)
      devLog('[OAuthSetup] stdout length:', stdout.length)

      // Try one more time to find token in accumulated output
      const cleanOutput = stripAnsi(stdout)
      const match = cleanOutput.match(TOKEN_REGEX)
      if (match) {
        const token = match[0]
        devLog('[OAuthSetup] Token found on close, length:', token.length)
        devLog('[OAuthSetup] Token prefix:', token.substring(0, 40) + '...')
        setClaudeOAuthToken(token)
        resolve(token)
        return
      }

      if (code !== 0) {
        reject(new Error(`setup-token exited with code ${code}: ${stderr}`))
      } else {
        // Process completed but no token found
        reject(new Error('No OAuth token found in setup-token output'))
      }
    })

    proc.on('error', (err) => {
      devLog('[OAuthSetup] Process error:', err.message)
      reject(new Error(`Failed to run setup-token: ${err.message}`))
    })
  })
}

/**
 * Check if the claude CLI is available
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    // Use spawnWithPath to search for claude in user paths
    const proc = spawnWithPath('which', ['claude'], { stdio: 'pipe' })

    proc.on('close', (code) => {
      resolve(code === 0)
    })

    proc.on('error', () => {
      resolve(false)
    })
  })
}
