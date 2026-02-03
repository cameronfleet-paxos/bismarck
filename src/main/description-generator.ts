/**
 * Description Generator - Uses Claude Haiku to auto-generate purpose descriptions
 * for repositories based on their name, path, and remote URL.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { DiscoveredRepo } from '../shared/types'

export interface DescriptionResult {
  repoPath: string
  purpose: string
  error?: string
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
    return repos.map(repo => ({
      repoPath: repo.path,
      purpose: '',
    }))
  }

  const client = new Anthropic({ apiKey })

  const results = await Promise.all(
    repos.map(async (repo): Promise<DescriptionResult> => {
      try {
        const purpose = await generateSingleDescription(client, repo)
        return {
          repoPath: repo.path,
          purpose,
        }
      } catch (error) {
        console.error(`[DescriptionGenerator] Error generating description for ${repo.path}:`, error)
        return {
          repoPath: repo.path,
          purpose: '',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  )

  return results
}

/**
 * Generate a purpose description for a single repository
 */
async function generateSingleDescription(
  client: Anthropic,
  repo: DiscoveredRepo
): Promise<string> {
  const repoInfo = buildRepoInfo(repo)

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 150,
    messages: [
      {
        role: 'user',
        content: `Based on the following repository information, write a 1-2 sentence purpose description for this codebase. Be concise and focus on what the project likely does.

${repoInfo}

Write only the purpose description, nothing else.`,
      },
    ],
  })

  const textBlock = response.content.find(block => block.type === 'text')
  return textBlock?.text?.trim() || ''
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
