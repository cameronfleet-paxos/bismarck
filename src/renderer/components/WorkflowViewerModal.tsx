import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/renderer/components/ui/dialog'
import { WorkflowStatusViewer } from './workflow/WorkflowStatusViewer'
import type { NodeStatus } from './workflow/WorkflowStatusViewer'
import type { WorkflowNode, WorkflowEdge } from '@/shared/cron-types'

interface WorkflowViewerModalProps {
  open: boolean
  onClose: () => void
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  nodeStatuses: Map<string, NodeStatus>
  jobName: string
}

export function WorkflowViewerModal({
  open,
  onClose,
  nodes,
  edges,
  nodeStatuses,
  jobName,
}: WorkflowViewerModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Workflow Status</DialogTitle>
          <DialogDescription>{jobName}</DialogDescription>
        </DialogHeader>
        <div style={{ height: '60vh' }}>
          <WorkflowStatusViewer
            nodes={nodes}
            edges={edges}
            nodeStatuses={nodeStatuses}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
