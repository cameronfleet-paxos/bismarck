/**
 * OAuth Setup for Claude Code
 *
 * Handles running `claude setup-token` to get an OAuth token
 * and storing it for use by headless agents.
 */

import { setClaudeOAuthToken } from './config'
import { spawnWithPath } from './exec-utils'

// Regex to match OAuth tokens from claude setup-token output
const TOKEN_REGEX = /sk-ant-oat01-[A-Za-z0-9_-]+/

// Strip ANSI escape sequences from output
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
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
    console.log('[OAuthSetup] Starting claude setup-token...')

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
        console.log('[OAuthSetup] Token found, storing...')
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

      console.log('[OAuthSetup] Process closed with code:', code)
      console.log('[OAuthSetup] stdout length:', stdout.length)

      // Try one more time to find token in accumulated output
      const cleanOutput = stripAnsi(stdout)
      const match = cleanOutput.match(TOKEN_REGEX)
      if (match) {
        const token = match[0]
        console.log('[OAuthSetup] Token found on close, storing...')
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
      console.log('[OAuthSetup] Process error:', err.message)
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
