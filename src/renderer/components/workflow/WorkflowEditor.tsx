import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, Save, X, ZoomIn, ZoomOut, Maximize2, Container, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { WorkflowCanvasNode } from '@/renderer/components/workflow/WorkflowNode'
import { NodeConfigPanel } from '@/renderer/components/workflow/NodeConfigPanel'
import type { CronJob, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowGraph, HeadlessAgentNodeData, RalphLoopNodeData, ShellCommandNodeData } from '@/shared/cron-types'
import { SCHEDULE_PRESETS } from '@/shared/cron-types'

interface WorkflowEditorProps {
  jobId?: string // undefined = new job
  onSave: () => void
  onCancel: () => void
}

function generateId(): string {
  return crypto.randomUUID()
}

function createDefaultNodeData(type: WorkflowNodeType): HeadlessAgentNodeData | RalphLoopNodeData | ShellCommandNodeData {
  switch (type) {
    case 'headless-agent':
      return { referenceAgentId: '', prompt: '', model: 'sonnet', planPhase: true }
    case 'ralph-loop':
      return { referenceAgentId: '', prompt: '', completionPhrase: '<promise>COMPLETE</promise>', maxIterations: 50, model: 'sonnet' }
    case 'shell-command':
      return { command: '', workingDirectory: '', timeout: 300 }
  }
}

/**
 * Detect cycles in the graph using DFS
 */
function hasCycle(nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  const adjacency: Map<string, string[]> = new Map()
  for (const node of nodes) adjacency.set(node.id, [])
  for (const edge of edges) {
    const targets = adjacency.get(edge.source)
    if (targets) targets.push(edge.target)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    inStack.add(nodeId)
    for (const neighbor of adjacency.get(nodeId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (inStack.has(neighbor)) {
        return true
      }
    }
    inStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true
    }
  }
  return false
}

export function WorkflowEditor({ jobId, onSave, onCancel }: WorkflowEditorProps) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [schedulePreset, setSchedulePreset] = useState<string>('daily-9am')
  const [enabled, setEnabled] = useState(true)
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [connectingMouse, setConnectingMouse] = useState({ x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })

  // Load existing job
  useEffect(() => {
    if (jobId) {
      window.electronAPI.getCronJob(jobId).then(job => {
        if (job) {
          setName(job.name)
          setSchedule(job.schedule)
          setEnabled(job.enabled)
          setNodes(job.workflowGraph.nodes)
          setEdges(job.workflowGraph.edges)
          // Try to match a preset
          const matchedPreset = SCHEDULE_PRESETS.find(p => p.cron === job.schedule)
          setSchedulePreset(matchedPreset ? job.schedule : 'custom')
        }
      })
    }
  }, [jobId])

  const handleAddNode = (type: WorkflowNodeType) => {
    const id = generateId()
    const newNode: WorkflowNode = {
      id,
      type,
      position: {
        x: 200 + Math.random() * 100,
        y: 100 + nodes.length * 130,
      },
      data: createDefaultNodeData(type),
      label: type === 'headless-agent' ? 'Headless Agent' : type === 'ralph-loop' ? 'Ralph Loop' : 'Shell Command',
    }
    setNodes(prev => [...prev, newNode])
    setSelectedNodeId(id)
    setShowAddMenu(false)
  }

  const handleDeleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId))
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }

  const handleNodeMouseDown = (nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()

    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    setDraggingNodeId(nodeId)
    setDragOffset({
      x: e.clientX / zoom - node.position.x - pan.x / zoom,
      y: e.clientY / zoom - node.position.y - pan.y / zoom,
    })
    setSelectedNodeId(nodeId)
  }

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingNodeId) {
      const newX = e.clientX / zoom - dragOffset.x - pan.x / zoom
      const newY = e.clientY / zoom - dragOffset.y - pan.y / zoom
      setNodes(prev => prev.map(n =>
        n.id === draggingNodeId ? { ...n, position: { x: newX, y: newY } } : n
      ))
    }
    if (connectingFrom) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        setConnectingMouse({
          x: (e.clientX - rect.left - pan.x) / zoom,
          y: (e.clientY - rect.top - pan.y) / zoom,
        })
      }
    }
    if (isPanning) {
      setPan(prev => ({
        x: prev.x + (e.clientX - panStart.x),
        y: prev.y + (e.clientY - panStart.y),
      }))
      setPanStart({ x: e.clientX, y: e.clientY })
    }
  }, [draggingNodeId, dragOffset, zoom, pan, connectingFrom, isPanning, panStart])

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingNodeId(null)
    setConnectingFrom(null)
    setIsPanning(false)
  }, [])

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === 'svg') {
      setSelectedNodeId(null)
      if (e.button === 0) {
        setIsPanning(true)
        setPanStart({ x: e.clientX, y: e.clientY })
      }
    }
  }

  const handleConnectStart = (nodeId: string) => {
    setConnectingFrom(nodeId)
  }

  const handleConnectEnd = (nodeId: string) => {
    if (connectingFrom && connectingFrom !== nodeId) {
      // Check if this edge already exists
      const exists = edges.some(e => e.source === connectingFrom && e.target === nodeId)
      if (!exists) {
        const newEdge: WorkflowEdge = {
          id: generateId(),
          source: connectingFrom,
          target: nodeId,
        }
        // Check if adding this edge creates a cycle
        const testEdges = [...edges, newEdge]
        if (!hasCycle(nodes, testEdges)) {
          setEdges(prev => [...prev, newEdge])
        } else {
          setError('Cannot create connection: would create a cycle')
          setTimeout(() => setError(null), 3000)
        }
      }
    }
    setConnectingFrom(null)
  }

  const handleDeleteEdge = (edgeId: string) => {
    setEdges(prev => prev.filter(e => e.id !== edgeId))
  }

  const handleNodeDataUpdate = (nodeId: string, data: WorkflowNode['data']) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data } : n))
  }

  const handleNodeLabelUpdate = (nodeId: string, label: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, label } : n))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a name for this automation')
      return
    }
    if (nodes.length === 0) {
      setError('Please add at least one node to the workflow')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const graph: WorkflowGraph = { nodes, edges }

      if (jobId) {
        await window.electronAPI.updateCronJob(jobId, {
          name: name.trim(),
          schedule,
          enabled,
          workflowGraph: graph,
        })
      } else {
        await window.electronAPI.createCronJob({
          name: name.trim(),
          schedule,
          enabled,
          workflowGraph: graph,
        })
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handlePresetChange = (value: string) => {
    setSchedulePreset(value)
    if (value !== 'custom') {
      const preset = SCHEDULE_PRESETS.find(p => p.cron === value)
      if (preset) setSchedule(preset.cron)
    }
  }

  const handleZoom = (delta: number) => {
    setZoom(prev => Math.max(0.25, Math.min(2, prev + delta)))
  }

  const handleFitView = () => {
    if (nodes.length === 0) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    const minX = Math.min(...nodes.map(n => n.position.x))
    const maxX = Math.max(...nodes.map(n => n.position.x)) + 200
    const minY = Math.min(...nodes.map(n => n.position.y))
    const maxY = Math.max(...nodes.map(n => n.position.y)) + 80
    const canvas = canvasRef.current
    if (!canvas) return
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const scaleX = cw / (maxX - minX + 100)
    const scaleY = ch / (maxY - minY + 100)
    const newZoom = Math.min(scaleX, scaleY, 1.5)
    setZoom(newZoom)
    setPan({
      x: (cw - (maxX - minX) * newZoom) / 2 - minX * newZoom,
      y: (ch - (maxY - minY) * newZoom) / 2 - minY * newZoom,
    })
  }

  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null

  const getNodeCenter = (nodeId: string): { x: number; y: number } => {
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    return { x: node.position.x + 100, y: node.position.y + 40 }
  }

  return (
    <div data-testid="workflow-editor" className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Top bar */}
      <div className="flex items-center gap-3 pb-4 border-b mb-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Automation name..."
          className="max-w-xs"
        />

        {/* Schedule */}
        <div className="flex items-center gap-2">
          <select
            value={schedulePreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            className="h-9 px-3 text-sm border rounded-md bg-background"
          >
            {SCHEDULE_PRESETS.map(p => (
              <option key={p.cron} value={p.cron}>{p.label}</option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {schedulePreset === 'custom' && (
            <Input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="* * * * *"
              className="w-32 font-mono"
            />
          )}
        </div>

        <div className="flex-1" />

        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}

        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Canvas and config panel */}
      <div className="flex-1 flex gap-4 min-h-0">
        {/* Canvas */}
        <div className="flex-1 relative border rounded-lg overflow-hidden bg-muted/30">
          {/* Canvas toolbar */}
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-background/80 backdrop-blur rounded-md border p-1">
            <div className="relative">
              <Button size="icon-xs" variant="ghost" onClick={() => setShowAddMenu(!showAddMenu)}>
                <Plus className="h-4 w-4" />
              </Button>
              {showAddMenu && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-card border rounded-md shadow-lg py-1 z-20">
                  <button
                    onClick={() => handleAddNode('headless-agent')}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  >
                    <Container className="h-4 w-4 text-blue-400" />
                    Headless Agent
                  </button>
                  <button
                    onClick={() => handleAddNode('ralph-loop')}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  >
                    <RefreshCw className="h-4 w-4 text-purple-400" />
                    Ralph Loop
                  </button>
                  <button
                    onClick={() => handleAddNode('shell-command')}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2"
                  >
                    <TerminalSquare className="h-4 w-4 text-green-400" />
                    Shell Command
                  </button>
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-border" />
            <Button size="icon-xs" variant="ghost" onClick={() => handleZoom(0.1)} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={() => handleZoom(-0.1)} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={handleFitView} title="Fit view">
              <Maximize2 className="h-4 w-4" />
            </Button>
            {selectedNodeId && (
              <>
                <div className="w-px h-4 bg-border" />
                <Button size="icon-xs" variant="ghost" onClick={() => handleDeleteNode(selectedNodeId)} title="Delete selected">
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </>
            )}
          </div>

          {/* Canvas area */}
          <div
            ref={canvasRef}
            className="w-full h-full cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          >
            {/* SVG for edges */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ zIndex: 1 }}
            >
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
                {edges.map(edge => {
                  const from = getNodeCenter(edge.source)
                  const to = getNodeCenter(edge.target)
                  const fromY = from.y + 40
                  const toY = to.y - 40
                  return (
                    <g key={edge.id} className="pointer-events-auto cursor-pointer" onClick={() => handleDeleteEdge(edge.id)}>
                      <path
                        d={`M ${from.x} ${fromY} C ${from.x} ${fromY + 50}, ${to.x} ${toY - 50}, ${to.x} ${toY}`}
                        fill="none"
                        stroke="oklch(0.6 0.05 250)"
                        strokeWidth={2}
                        markerEnd="url(#arrowhead)"
                      />
                      {/* Invisible wider path for easier click target */}
                      <path
                        d={`M ${from.x} ${fromY} C ${from.x} ${fromY + 50}, ${to.x} ${toY - 50}, ${to.x} ${toY}`}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={12}
                      />
                    </g>
                  )
                })}
                {/* Connecting line preview */}
                {connectingFrom && (
                  <path
                    d={`M ${getNodeCenter(connectingFrom).x} ${getNodeCenter(connectingFrom).y + 40} L ${connectingMouse.x} ${connectingMouse.y}`}
                    fill="none"
                    stroke="oklch(0.7 0.1 250)"
                    strokeWidth={2}
                    strokeDasharray="4"
                  />
                )}
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 10 3.5, 0 7"
                      fill="oklch(0.6 0.05 250)"
                    />
                  </marker>
                </defs>
              </g>
            </svg>

            {/* Nodes */}
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                zIndex: 2,
              }}
            >
              {nodes.map(node => (
                <WorkflowCanvasNode
                  key={node.id}
                  node={node}
                  isSelected={node.id === selectedNodeId}
                  onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                  onConnectStart={() => handleConnectStart(node.id)}
                  onConnectEnd={() => handleConnectEnd(node.id)}
                  onDelete={() => handleDeleteNode(node.id)}
                />
              ))}
            </div>

            {/* Empty state */}
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none" style={{ zIndex: 3 }}>
                <div className="text-center">
                  <p className="text-sm">Click + to add workflow nodes</p>
                  <p className="text-xs mt-1">Drag from output (bottom) to input (top) to connect nodes</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Config panel */}
        {selectedNode && (
          <NodeConfigPanel
            node={selectedNode}
            onDataChange={(data) => handleNodeDataUpdate(selectedNode.id, data)}
            onLabelChange={(label) => handleNodeLabelUpdate(selectedNode.id, label)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  )
}
