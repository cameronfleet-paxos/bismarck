import type { BeadTask, TaskAssignment, TaskNode, DependencyGraph, GraphStats, TaskNodeStatus } from '@/shared/types'
import { devLog } from '@/renderer/lib/dev-logger'

/**
 * Determine the effective status of a task node based on assignment and blockers
 */
function getNodeStatus(
  task: BeadTask,
  assignment: TaskAssignment | undefined,
  allTasks: Map<string, BeadTask>,
  allAssignments: Map<string, TaskAssignment>
): TaskNodeStatus {
  // If the bead task is closed, it's completed (regardless of assignment)
  // This handles merge tasks that don't have TaskAssignment objects
  if (task.status === 'closed') {
    return 'completed'
  }

  // If task has an assignment, use its status
  if (assignment) {
    return assignment.status
  }

  // Task is not assigned - check if it's blocked or ready
  if (task.blockedBy && task.blockedBy.length > 0) {
    // Check if all blockers are completed
    const allBlockersComplete = task.blockedBy.every((blockerId) => {
      const blockerTask = allTasks.get(blockerId)
      const blockerAssignment = allAssignments.get(blockerId)

      // If blocker doesn't exist in our data, assume it's complete
      // (it might be an epic, external task, or already removed)
      if (!blockerTask) return true

      // Blocker is complete if it's closed or assignment is completed
      if (blockerTask.status === 'closed') return true
      if (blockerAssignment?.status === 'completed') return true
      return false
    })

    return allBlockersComplete ? 'ready' : 'blocked'
  }

  // No blockers and no assignment - ready to start
  return 'ready'
}

/**
 * Calculate the depth of each node (distance from roots)
 */
function calculateDepths(
  nodes: Map<string, TaskNode>
): void {
  // Find roots (nodes with no blockers)
  const roots = Array.from(nodes.values()).filter(
    (node) => node.blockedBy.length === 0
  )

  devLog('[calculateDepths] Roots (no blockers):', roots.map(n => n.id))

  // BFS to assign depths
  const visited = new Set<string>()
  let currentLevel = roots.map((n) => n.id)
  let depth = 0

  while (currentLevel.length > 0) {
    const nextLevel: string[] = []

    devLog(`[calculateDepths] Processing depth ${depth}:`, currentLevel)

    for (const nodeId of currentLevel) {
      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      const node = nodes.get(nodeId)
      if (node) {
        node.depth = depth
        // Add all nodes this one blocks to the next level
        nextLevel.push(...node.blocks)
      }
    }

    depth++
    currentLevel = nextLevel
  }

  // Check for unvisited nodes (orphans with unresolved blockers)
  const unvisited = Array.from(nodes.keys()).filter(id => !visited.has(id))
  if (unvisited.length > 0) {
    devLog('[calculateDepths] UNVISITED NODES (bug!):', unvisited)
    for (const id of unvisited) {
      const node = nodes.get(id)
      devLog(`  ${id}: blockedBy=[${node?.blockedBy.join(',')}], blocks=[${node?.blocks.join(',')}]`)
    }
  }
}

/**
 * Find the critical path (longest chain of incomplete tasks)
 */
function findCriticalPath(nodes: Map<string, TaskNode>): string[] {
  // Only consider incomplete tasks
  const incompleteTasks = Array.from(nodes.values()).filter(
    (node) => node.status !== 'completed'
  )

  if (incompleteTasks.length === 0) return []

  // Find leaves (incomplete tasks that don't block any incomplete tasks)
  const leaves = incompleteTasks.filter((node) => {
    return !node.blocks.some((blockedId) => {
      const blocked = nodes.get(blockedId)
      return blocked && blocked.status !== 'completed'
    })
  })

  // DFS from each leaf back to roots, finding longest path
  let longestPath: string[] = []

  function dfs(nodeId: string, path: string[]): void {
    const node = nodes.get(nodeId)
    if (!node) return

    const newPath = [nodeId, ...path]

    // If this is a root (no incomplete blockers), check if it's the longest path
    const incompleteBlockers = node.blockedBy.filter((bid) => {
      const blocker = nodes.get(bid)
      return blocker && blocker.status !== 'completed'
    })

    if (incompleteBlockers.length === 0) {
      if (newPath.length > longestPath.length) {
        longestPath = newPath
      }
      return
    }

    // Continue DFS to blockers
    for (const blockerId of incompleteBlockers) {
      dfs(blockerId, newPath)
    }
  }

  for (const leaf of leaves) {
    dfs(leaf.id, [])
  }

  return longestPath
}

/**
 * Build the complete dependency graph from BeadTasks and TaskAssignments
 */
export function buildDependencyGraph(
  beadTasks: BeadTask[],
  assignments: TaskAssignment[]
): DependencyGraph {
  const nodes = new Map<string, TaskNode>()
  const edges: DependencyGraph['edges'] = []

  // Filter out epics - they're organizational units, not displayable tasks
  const tasks = beadTasks.filter(t => t.type !== 'epic')

  // Create maps for quick lookup
  const taskMap = new Map<string, BeadTask>()
  const assignmentMap = new Map<string, TaskAssignment>()

  for (const task of tasks) {
    taskMap.set(task.id, task)
  }
  for (const assignment of assignments) {
    assignmentMap.set(assignment.beadId, assignment)
  }

  // First pass: create all nodes
  for (const task of tasks) {
    const assignment = assignmentMap.get(task.id)
    const status = getNodeStatus(task, assignment, taskMap, assignmentMap)

    nodes.set(task.id, {
      id: task.id,
      title: task.title,
      status,
      blockedBy: task.blockedBy || [],
      blocks: [], // Will be populated in second pass
      depth: 0,
      isOnCriticalPath: false,
      assignment,
    })
  }

  // Debug: log nodes after first pass
  devLog('[buildDependencyGraph] Nodes created:')
  for (const [id, node] of nodes) {
    devLog(`  ${id}: blockedBy=[${node.blockedBy.join(',')}]`)
  }

  // Second pass: populate blocks relationships and create edges
  for (const task of tasks) {
    const node = nodes.get(task.id)
    if (!node) continue

    for (const blockerId of node.blockedBy) {
      const blockerNode = nodes.get(blockerId)
      if (blockerNode) {
        blockerNode.blocks.push(task.id)
        edges.push({
          from: blockerId,
          to: task.id,
          isOnCriticalPath: false, // Will be updated later
        })
      } else {
        devLog(`  [buildDependencyGraph] WARNING: blocker ${blockerId} not found in nodes for task ${task.id}`)
      }
    }
  }

  // Debug: log blocks after second pass
  devLog('[buildDependencyGraph] Blocks populated:')
  for (const [id, node] of nodes) {
    if (node.blocks.length > 0) {
      devLog(`  ${id}: blocks=[${node.blocks.join(',')}]`)
    }
  }

  // Calculate depths
  calculateDepths(nodes)

  // Debug: log depths after calculation
  devLog('[buildDependencyGraph] Depths calculated:')
  for (const [id, node] of nodes) {
    devLog(`  ${id}: depth=${node.depth}`)
  }

  // Find critical path
  const criticalPath = findCriticalPath(nodes)
  const criticalPathSet = new Set(criticalPath)

  // Mark nodes and edges on critical path
  for (const nodeId of criticalPath) {
    const node = nodes.get(nodeId)
    if (node) {
      node.isOnCriticalPath = true
    }
  }

  for (const edge of edges) {
    if (criticalPathSet.has(edge.from) && criticalPathSet.has(edge.to)) {
      // Check if this edge is actually on the path (consecutive)
      const fromIndex = criticalPath.indexOf(edge.from)
      const toIndex = criticalPath.indexOf(edge.to)
      if (Math.abs(fromIndex - toIndex) === 1) {
        edge.isOnCriticalPath = true
      }
    }
  }

  // Identify roots and leaves
  const roots = Array.from(nodes.values())
    .filter((node) => node.blockedBy.length === 0)
    .map((node) => node.id)

  const leaves = Array.from(nodes.values())
    .filter((node) => node.blocks.length === 0)
    .map((node) => node.id)

  // Calculate max depth
  const maxDepth = Math.max(0, ...Array.from(nodes.values()).map((n) => n.depth))

  return {
    nodes,
    edges,
    roots,
    leaves,
    criticalPath,
    maxDepth,
  }
}

/**
 * Calculate statistics from a dependency graph
 */
export function calculateGraphStats(graph: DependencyGraph): GraphStats {
  const stats: GraphStats = {
    total: 0,
    completed: 0,
    inProgress: 0,
    sent: 0,
    blocked: 0,
    ready: 0,
    failed: 0,
  }

  for (const node of graph.nodes.values()) {
    stats.total++

    switch (node.status) {
      case 'completed':
        stats.completed++
        break
      case 'in_progress':
        stats.inProgress++
        break
      case 'sent':
        stats.sent++
        break
      case 'blocked':
        stats.blocked++
        break
      case 'ready':
      case 'planned':
        stats.ready++
        break
      case 'failed':
        stats.failed++
        break
      case 'pending':
        // Pending assignments count as sent (dispatched but not picked up)
        stats.sent++
        break
    }
  }

  return stats
}

/**
 * Check if a specific task is ready to start
 * (all blockers are complete)
 */
export function isTaskReady(nodeId: string, graph: DependencyGraph): boolean {
  const node = graph.nodes.get(nodeId)
  if (!node) return false

  return node.blockedBy.every((blockerId) => {
    const blocker = graph.nodes.get(blockerId)
    return blocker?.status === 'completed'
  })
}

/**
 * Get upstream chain (all tasks that block this one, recursively)
 */
export function getUpstreamChain(nodeId: string, graph: DependencyGraph): string[] {
  const visited = new Set<string>()
  const result: string[] = []

  function traverse(id: string): void {
    if (visited.has(id)) return
    visited.add(id)

    const node = graph.nodes.get(id)
    if (!node) return

    for (const blockerId of node.blockedBy) {
      result.push(blockerId)
      traverse(blockerId)
    }
  }

  traverse(nodeId)
  return result
}

/**
 * Get downstream chain (all tasks blocked by this one, recursively)
 */
export function getDownstreamChain(nodeId: string, graph: DependencyGraph): string[] {
  const visited = new Set<string>()
  const result: string[] = []

  function traverse(id: string): void {
    if (visited.has(id)) return
    visited.add(id)

    const node = graph.nodes.get(id)
    if (!node) return

    for (const blockedId of node.blocks) {
      result.push(blockedId)
      traverse(blockedId)
    }
  }

  traverse(nodeId)
  return result
}
