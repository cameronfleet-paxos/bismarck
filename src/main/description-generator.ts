/**
 * Description Generator - Uses Claude Haiku to auto-generate purpose descriptions
 * and completion criteria for repositories based on their name, path, remote URL,
 * and contents of key documentation files.
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { DiscoveredRepo } from '../shared/types'
import { getDefaultBranch } from './git-utils'

export interface DescriptionResult {
  repoPath: string
  purpose: string
  completionCriteria: string
  protectedBranches: string[]
  error?: string
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
 * Generate purpose descriptions for multiple repositories using Claude Haiku
 * Calls are made in parallel for efficiency
 */
export async function generateDescriptions(
  repos: DiscoveredRepo[]
): Promise<DescriptionResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    console.log('[DescriptionGenerator] No ANTHROPIC_API_KEY found, returning empty descriptions')
    // Still detect protected branches even without API key
    const results = await Promise.all(
      repos.map(async (repo) => ({
        repoPath: repo.path,
        purpose: '',
        completionCriteria: '',
        protectedBranches: await detectProtectedBranches(repo.path),
      }))
    )
    return results
  }

  const client = new Anthropic({ apiKey })

  const results = await Promise.all(
    repos.map(async (repo): Promise<DescriptionResult> => {
      try {
        const [description, protectedBranches] = await Promise.all([
          generateSingleDescription(client, repo),
          detectProtectedBranches(repo.path),
        ])
        return {
          repoPath: repo.path,
          purpose: description.purpose,
          completionCriteria: description.completionCriteria,
          protectedBranches,
        }
      } catch (error) {
        console.error(`[DescriptionGenerator] Error generating description for ${repo.path}:`, error)
        const protectedBranches = await detectProtectedBranches(repo.path)
        return {
          repoPath: repo.path,
          purpose: '',
          completionCriteria: '',
          protectedBranches,
          error: error instanceof Error ? error.message : String(error),
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
 */
async function generateSingleDescription(
  client: Anthropic,
  repo: DiscoveredRepo
): Promise<GeneratedDescription> {
  const repoInfo = buildRepoInfo(repo)
  const repoContext = await readRepoContext(repo.path)

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `Based on the following repository information and file contents, generate:

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
- <criterion 3>`,
      },
    ],
  })

  const textBlock = response.content.find(block => block.type === 'text')
  const text = textBlock?.text?.trim() || ''

  // Parse the response
  const purposeMatch = text.match(/PURPOSE:\s*(.+?)(?=\nCOMPLETION_CRITERIA:|$)/s)
  const criteriaMatch = text.match(/COMPLETION_CRITERIA:\s*(.+)$/s)

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
