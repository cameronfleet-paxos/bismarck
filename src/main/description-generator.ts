/**
 * Description Generator - Uses Claude Haiku to auto-generate purpose descriptions
 * and completion criteria for repositories based on their name, path, remote URL,
 * and contents of key documentation files.
 *
 * Uses Claude Code CLI (`claude -p`) for generation instead of direct API calls.
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { DiscoveredRepo, DescriptionProgressEvent } from '../shared/types'
import { getDefaultBranch } from './git-utils'
import { spawnWithPath, findBinary } from './exec-utils'
import { devLog } from './dev-log'

export interface DescriptionResult {
  repoPath: string
  purpose: string
  completionCriteria: string
  protectedBranches: string[]
  error?: string
}

// Bismarck victory quotes for celebrating each completed repository analysis
const BISMARCK_VICTORY_QUOTES = [
  "The great questions of the day will not be settled by speeches — but by iron and code!",
  "Not by rhetoric, but by repositories.",
  "A conquering army cannot be stopped!",
  "Laws are like sausages — it is best not to see them being made. Unlike this code.",
  "When you want to fool the world, tell the truth. This repo speaks for itself.",
  "Politics is the art of the possible. So is good software.",
  "Be polite; write diplomatically; even in a declaration of war one observes the rules of politeness.",
  "Never believe anything until it has been officially denied. Or until tests pass.",
  "People never lie so much as after a hunt, during a war, or before an election. But code never lies.",
  "With a gentleman I am always a gentleman and a half.",
  "The main thing is to make history, not to write it. This repo is ready.",
  "An appeal to fear never finds an echo in German hearts. Nor in well-documented code.",
  "Anyone who has ever looked into the glazed eyes of a soldier dying on the battlefield will think hard before starting a war. Same for production bugs.",
  "A government must not waiver once it has chosen its course. It must not look to the left or right but go forward.",
  "The secret of politics? Make a good treaty with Russia. The secret of code? Good documentation."
]

// Get a random victory quote
function getRandomVictoryQuote(): string {
  return BISMARCK_VICTORY_QUOTES[Math.floor(Math.random() * BISMARCK_VICTORY_QUOTES.length)]
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Read relevant repository context files for the AI prompt
 * Reads README.md, CLAUDE.md, AGENTS.md, package.json (truncated to ~2000 chars each)
 */
async function readRepoContext(repoPath: string): Promise<string> {
  const files = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json']
  const contents: string[] = []

  for (const file of files) {
    const filePath = path.join(repoPath, file)
    if (await fileExists(filePath)) {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        // Truncate to ~2000 chars per file to stay within token limits
        contents.push(`=== ${file} ===\n${content.slice(0, 2000)}`)
      } catch (error) {
        // Ignore read errors for individual files
      }
    }
  }

  return contents.join('\n\n')
}

/**
 * Detect protected branches for a repository
 * Returns the default branch as a starting point
 */
async function detectProtectedBranches(repoPath: string): Promise<string[]> {
  const defaultBranch = await getDefaultBranch(repoPath)
  // Return default branch as protected - can enhance later with git config checks
  return [defaultBranch]
}

/**
 * Generate purpose descriptions for multiple repositories using Claude Haiku via claude CLI
 * Calls are made in parallel for efficiency
 *
 * @param repos - Repositories to generate descriptions for
 * @param onProgress - Optional callback for real-time progress updates
 */
export async function generateDescriptions(
  repos: DiscoveredRepo[],
  onProgress?: (event: DescriptionProgressEvent) => void
): Promise<DescriptionResult[]> {
  // Emit initial pending status for all repos
  if (onProgress) {
    for (const repo of repos) {
      onProgress({
        repoPath: repo.path,
        repoName: repo.name,
        status: 'pending',
      })
    }
  }

  // Check if claude CLI is available
  const claudePath = findBinary('claude')
  if (!claudePath) {
    devLog('[DescriptionGenerator] Claude CLI not found, returning empty descriptions')
    // Still detect protected branches even without claude CLI
    const results = await Promise.all(
      repos.map(async (repo) => {
        const protectedBranches = await detectProtectedBranches(repo.path)
        const result = {
          repoPath: repo.path,
          purpose: '',
          completionCriteria: '',
          protectedBranches,
        }
        // Emit completed status (even though we didn't generate descriptions)
        if (onProgress) {
          onProgress({
            repoPath: repo.path,
            repoName: repo.name,
            status: 'completed',
            result: {
              purpose: '',
              completionCriteria: '',
              protectedBranches,
            },
            quote: getRandomVictoryQuote(),
          })
        }
        return result
      })
    )
    return results
  }

  const results = await Promise.all(
    repos.map(async (repo): Promise<DescriptionResult> => {
      // Emit generating status
      if (onProgress) {
        onProgress({
          repoPath: repo.path,
          repoName: repo.name,
          status: 'generating',
        })
      }

      try {
        const [description, protectedBranches] = await Promise.all([
          generateSingleDescription(repo),
          detectProtectedBranches(repo.path),
        ])

        const result = {
          repoPath: repo.path,
          purpose: description.purpose,
          completionCriteria: description.completionCriteria,
          protectedBranches,
        }

        // Emit completed status with result and victory quote
        if (onProgress) {
          onProgress({
            repoPath: repo.path,
            repoName: repo.name,
            status: 'completed',
            result: {
              purpose: description.purpose,
              completionCriteria: description.completionCriteria,
              protectedBranches,
            },
            quote: getRandomVictoryQuote(),
          })
        }

        return result
      } catch (error) {
        console.error(`[DescriptionGenerator] Error generating description for ${repo.path}:`, error)
        const protectedBranches = await detectProtectedBranches(repo.path)
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Emit error status
        if (onProgress) {
          onProgress({
            repoPath: repo.path,
            repoName: repo.name,
            status: 'error',
            error: errorMessage,
          })
        }

        return {
          repoPath: repo.path,
          purpose: '',
          completionCriteria: '',
          protectedBranches,
          error: errorMessage,
        }
      }
    })
  )

  return results
}

interface GeneratedDescription {
  purpose: string
  completionCriteria: string
}

/**
 * Generate a purpose description and completion criteria for a single repository
 * Uses claude CLI with -p flag for headless mode
 */
async function generateSingleDescription(
  repo: DiscoveredRepo
): Promise<GeneratedDescription> {
  const repoInfo = buildRepoInfo(repo)
  const repoContext = await readRepoContext(repo.path)

  const prompt = `Based on the following repository information and file contents, generate:

1. PURPOSE: A 1-2 sentence description of what this codebase does
2. COMPLETION CRITERIA: 2-4 bullet points describing what "done" looks like for work in this repo (e.g., tests pass, builds succeed, code is linted)

Repository Info:
${repoInfo}

${repoContext ? `File Contents:\n${repoContext}` : ''}

Respond in this exact format:
PURPOSE: <your purpose description>
COMPLETION_CRITERIA:
- <criterion 1>
- <criterion 2>
- <criterion 3>`

  // Use claude CLI with -p flag for headless prompt
  const result = await runClaudePrompt(prompt)

  // Parse the response
  const purposeMatch = result.match(/PURPOSE:\s*(.+?)(?=\nCOMPLETION_CRITERIA:|$)/s)
  const criteriaMatch = result.match(/COMPLETION_CRITERIA:\s*(.+)$/s)

  const purpose = purposeMatch?.[1]?.trim() || ''
  const criteriaText = criteriaMatch?.[1]?.trim() || ''

  // Clean up completion criteria - join bullet points into a single string
  const completionCriteria = criteriaText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('-') || line.startsWith('•'))
    .join('\n')

  return { purpose, completionCriteria }
}

/**
 * Run a prompt using claude CLI and return the result
 */
async function runClaudePrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--model', 'haiku'
    ]

    const process = spawnWithPath('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    process.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    process.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`))
        return
      }

      try {
        // Parse JSON output to extract the result
        const json = JSON.parse(stdout)
        // The JSON output format has a 'result' field with the text response
        const result = json.result || ''
        resolve(result)
      } catch (parseError) {
        // If JSON parsing fails, try to use stdout directly
        // This handles cases where the output might not be valid JSON
        console.warn('[DescriptionGenerator] Failed to parse JSON, using raw output')
        resolve(stdout.trim())
      }
    })

    process.on('error', (err) => {
      reject(err)
    })

    // Close stdin as we're not sending any input
    process.stdin?.end()
  })
}

/**
 * Build a human-readable string of repository information for the prompt
 */
function buildRepoInfo(repo: DiscoveredRepo): string {
  const parts: string[] = []

  parts.push(`Repository name: ${repo.name}`)
  parts.push(`Path: ${repo.path}`)

  if (repo.remoteUrl) {
    // Clean up the remote URL for better readability
    const cleanUrl = repo.remoteUrl
      .replace(/^git@github\.com:/, 'github.com/')
      .replace(/^git@/, '')
      .replace(/\.git$/, '')
    parts.push(`Remote: ${cleanUrl}`)
  }

  return parts.join('\n')
}
