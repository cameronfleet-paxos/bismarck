import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import { Switch } from '@/renderer/components/ui/switch'
import type { WorkflowNode, HeadlessAgentNodeData, RalphLoopNodeData, ShellCommandNodeData } from '@/shared/cron-types'
import type { Agent } from '@/shared/types'

interface NodeConfigPanelProps {
  node: WorkflowNode
  onDataChange: (data: WorkflowNode['data']) => void
  onLabelChange: (label: string) => void
  onClose: () => void
}

export function NodeConfigPanel({ node, onDataChange, onLabelChange, onClose }: NodeConfigPanelProps) {
  const [agents, setAgents] = useState<Agent[]>([])

  useEffect(() => {
    window.electronAPI.getWorkspaces().then((workspaces) => {
      // Filter to selectable agents (same logic as CommandSearch)
      setAgents(workspaces.filter(agent =>
        !agent.isOrchestrator &&
        !agent.isPlanAgent &&
        !agent.parentPlanId &&
        !agent.isHeadless &&
        !agent.isStandaloneHeadless
      ))
    })
  }, [])

  const title = node.type === 'headless-agent' ? 'Headless Agent' :
    node.type === 'ralph-loop' ? 'Ralph Loop' : 'Shell Command'

  return (
    <div className="w-72 border rounded-lg bg-card p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Configure {title}</h4>
        <Button size="icon-xs" variant="ghost" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <Label className="text-xs">Label</Label>
        <Input
          value={node.label || ''}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={title}
          className="text-sm"
        />
      </div>

      {node.type === 'headless-agent' && (
        <HeadlessAgentConfig
          data={node.data as HeadlessAgentNodeData}
          agents={agents}
          onChange={onDataChange}
        />
      )}

      {node.type === 'ralph-loop' && (
        <RalphLoopConfig
          data={node.data as RalphLoopNodeData}
          agents={agents}
          onChange={onDataChange}
        />
      )}

      {node.type === 'shell-command' && (
        <ShellCommandConfig
          data={node.data as ShellCommandNodeData}
          onChange={onDataChange}
        />
      )}
    </div>
  )
}

function HeadlessAgentConfig({
  data,
  agents,
  onChange,
}: {
  data: HeadlessAgentNodeData
  agents: Agent[]
  onChange: (data: HeadlessAgentNodeData) => void
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Reference Agent</Label>
        <select
          value={data.referenceAgentId}
          onChange={(e) => onChange({ ...data, referenceAgentId: e.target.value })}
          className="w-full h-9 px-3 text-sm border rounded-md bg-background"
        >
          <option value="">Select agent...</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Prompt</Label>
        <textarea
          value={data.prompt}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          placeholder="Enter prompt for headless agent..."
          className="w-full min-h-24 p-2 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Model</Label>
        <div className="flex gap-1">
          {(['sonnet', 'opus', 'haiku'] as const).map(model => (
            <button
              key={model}
              onClick={() => onChange({ ...data, model })}
              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded ${
                data.model === model
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              {model.charAt(0).toUpperCase() + model.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs">Plan Phase</Label>
        <Switch
          checked={data.planPhase}
          onCheckedChange={(checked) => onChange({ ...data, planPhase: checked })}
        />
      </div>
    </>
  )
}

function RalphLoopConfig({
  data,
  agents,
  onChange,
}: {
  data: RalphLoopNodeData
  agents: Agent[]
  onChange: (data: RalphLoopNodeData) => void
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Reference Agent</Label>
        <select
          value={data.referenceAgentId}
          onChange={(e) => onChange({ ...data, referenceAgentId: e.target.value })}
          className="w-full h-9 px-3 text-sm border rounded-md bg-background"
        >
          <option value="">Select agent...</option>
          {agents.map(agent => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Prompt</Label>
        <textarea
          value={data.prompt}
          onChange={(e) => onChange({ ...data, prompt: e.target.value })}
          placeholder="Enter prompt for Ralph Loop..."
          className="w-full min-h-24 p-2 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Completion Phrase</Label>
        <Input
          value={data.completionPhrase}
          onChange={(e) => onChange({ ...data, completionPhrase: e.target.value })}
          placeholder="<promise>COMPLETE</promise>"
          className="font-mono text-sm"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Max Iterations</Label>
          <Input
            type="number"
            value={data.maxIterations}
            onChange={(e) => onChange({ ...data, maxIterations: Math.max(1, parseInt(e.target.value) || 50) })}
            min={1}
            max={500}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs">Model</Label>
          <div className="flex gap-1">
            {(['sonnet', 'opus'] as const).map(model => (
              <button
                key={model}
                onClick={() => onChange({ ...data, model })}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded ${
                  data.model === model
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {model.charAt(0).toUpperCase() + model.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function ShellCommandConfig({
  data,
  onChange,
}: {
  data: ShellCommandNodeData
  onChange: (data: ShellCommandNodeData) => void
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Command</Label>
        <textarea
          value={data.command}
          onChange={(e) => onChange({ ...data, command: e.target.value })}
          placeholder="echo 'Hello World'"
          className="w-full min-h-20 p-2 text-sm border rounded-md bg-background resize-y focus:outline-none focus:ring-2 focus:ring-primary font-mono"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Working Directory</Label>
        <Input
          value={data.workingDirectory}
          onChange={(e) => onChange({ ...data, workingDirectory: e.target.value })}
          placeholder="/path/to/directory"
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Timeout (seconds)</Label>
        <Input
          type="number"
          value={data.timeout}
          onChange={(e) => onChange({ ...data, timeout: Math.max(1, parseInt(e.target.value) || 300) })}
          min={1}
          max={86400}
        />
      </div>
    </>
  )
}
