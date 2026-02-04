/**
 * Repo Grouper - Uses Claude Haiku to analyze repositories and group them into logical tabs
 *
 * After wizard completion, this module analyzes the selected repos and suggests
 * logical groupings like 'Infrastructure', 'Services', 'Libraries', 'Personal', etc.
 */

import type { Agent, AgentTab } from '../shared/types'
import { spawnWithPath, findBinary } from './exec-utils'
import * as stateManager from './state-manager'

export interface RepoGroup {
  name: string
  agentIds: string[]
}

export interface GroupingResult {
  groups: RepoGroup[]
  error?: string
}

/**
 * Analyze agents and group them into logical categories using Haiku
 */
export async function analyzeAndGroupAgents(agents: Agent[]): Promise<GroupingResult> {
  // Check if claude CLI is available
  const claudePath = findBinary('claude')
  if (!claudePath) {
    console.log('[RepoGrouper] Claude CLI not found, using default grouping')
    return createDefaultGrouping(agents)
  }

  if (agents.length === 0) {
    return { groups: [] }
  }

  // If only a few agents, no need to group
  if (agents.length <= 4) {
    return {
      groups: [{
        name: 'Agents',
        agentIds: agents.map(a => a.id)
      }]
    }
  }

  try {
    const groups = await analyzeWithHaiku(agents)
    return { groups }
  } catch (error) {
    console.error('[RepoGrouper] Error analyzing repos:', error)
    return createDefaultGrouping(agents)
  }
}

/**
 * Use Haiku to analyze repos and suggest groupings
 */
async function analyzeWithHaiku(agents: Agent[]): Promise<RepoGroup[]> {
  // Build repo info for the prompt
  const repoInfos = agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    directory: agent.directory,
    purpose: agent.purpose || ''
  }))

  const prompt = `You are analyzing a set of code repositories to group them into logical tabs for a developer workspace.

Here are the repositories:
${repoInfos.map((r, i) => `${i + 1}. ID: ${r.id}
   Name: ${r.name}
   Path: ${r.directory}
   Purpose: ${r.purpose || 'No description'}`).join('\n\n')}

Group these repositories into 2-5 logical categories based on their names, paths, and purposes. Common categories include:
- Infrastructure (devops, CI/CD, terraform, kubernetes)
- Services (APIs, backends, microservices)
- Libraries (shared packages, SDKs)
- Applications (frontend apps, mobile apps, CLIs)
- Personal (side projects, experiments)
- Documentation (docs, wikis)

IMPORTANT: Each repository ID must appear in exactly one group.

Respond in this exact format (one group per line, comma-separated IDs):
GROUP_NAME: id1, id2, id3
ANOTHER_GROUP: id4, id5

Only output the groups, nothing else.`

  const result = await runClaudePrompt(prompt)

  // Parse the response
  const groups: RepoGroup[] = []
  const assignedIds = new Set<string>()
  const lines = result.trim().split('\n')

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      const name = match[1].trim()
      const ids = match[2].split(',').map(id => id.trim()).filter(id => {
        // Only include valid agent IDs that haven't been assigned yet
        const isValid = repoInfos.some(r => r.id === id) && !assignedIds.has(id)
        if (isValid) assignedIds.add(id)
        return isValid
      })
      if (ids.length > 0) {
        groups.push({ name, agentIds: ids })
      }
    }
  }

  // Add any unassigned agents to an "Other" group
  const unassigned = repoInfos.filter(r => !assignedIds.has(r.id)).map(r => r.id)
  if (unassigned.length > 0) {
    groups.push({ name: 'Other', agentIds: unassigned })
  }

  // If parsing failed, fall back to default grouping
  if (groups.length === 0) {
    return createDefaultGrouping(agents).groups
  }

  return groups
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
        const result = json.result || ''
        resolve(result)
      } catch (parseError) {
        // If JSON parsing fails, try to use stdout directly
        console.warn('[RepoGrouper] Failed to parse JSON, using raw output')
        resolve(stdout.trim())
      }
    })

    process.on('error', (err) => {
      reject(err)
    })

    process.stdin?.end()
  })
}

/**
 * Create default grouping when Haiku is not available
 * Groups agents into tabs of 4 each
 */
function createDefaultGrouping(agents: Agent[]): GroupingResult {
  const groups: RepoGroup[] = []
  const agentIds = agents.map(a => a.id)

  // Group into batches of 4 (max per tab)
  for (let i = 0; i < agentIds.length; i += 4) {
    const batch = agentIds.slice(i, i + 4)
    const groupNum = Math.floor(i / 4) + 1
    groups.push({
      name: `Tab ${groupNum}`,
      agentIds: batch
    })
  }

  return { groups }
}

/**
 * Create tabs from grouping result and assign agents to them
 * Returns the created tabs
 */
export function createTabsFromGroups(groups: RepoGroup[]): AgentTab[] {
  const createdTabs: AgentTab[] = []

  for (const group of groups) {
    // Create tab with the group name - use lowercase for consistency
    const tabName = group.name.toLowerCase()
    const tab = stateManager.createTab(tabName)
    createdTabs.push(tab)

    // Add agents to the tab (up to 4 per regular tab)
    for (const agentId of group.agentIds.slice(0, 4)) {
      stateManager.addActiveWorkspace(agentId)
      stateManager.addWorkspaceToTab(agentId, tab.id)
    }

    // If more than 4 agents in group, create overflow tabs
    if (group.agentIds.length > 4) {
      const remaining = group.agentIds.slice(4)
      for (let i = 0; i < remaining.length; i += 4) {
        const batch = remaining.slice(i, i + 4)
        const overflowNum = Math.floor(i / 4) + 2
        const overflowTab = stateManager.createTab(`${tabName} ${overflowNum}`)
        createdTabs.push(overflowTab)
        for (const agentId of batch) {
          stateManager.addActiveWorkspace(agentId)
          stateManager.addWorkspaceToTab(agentId, overflowTab.id)
        }
      }
    }
  }

  return createdTabs
}

/**
 * Main entry point: analyze agents and create grouped tabs
 */
export async function groupAgentsIntoTabs(agents: Agent[]): Promise<AgentTab[]> {
  console.log(`[RepoGrouper] Grouping ${agents.length} agents into tabs...`)

  const result = await analyzeAndGroupAgents(agents)

  if (result.error) {
    console.warn('[RepoGrouper] Grouping had errors:', result.error)
  }

  console.log(`[RepoGrouper] Creating ${result.groups.length} groups:`,
    result.groups.map(g => `${g.name} (${g.agentIds.length})`).join(', '))

  const tabs = createTabsFromGroups(result.groups)

  // Set the first tab as active
  if (tabs.length > 0) {
    stateManager.setActiveTab(tabs[0].id)
  }

  return tabs
}
