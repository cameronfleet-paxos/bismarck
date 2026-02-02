import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/renderer/components/ui/button'
import { Input } from '@/renderer/components/ui/input'
import { Label } from '@/renderer/components/ui/label'
import type { ProxiedTool } from '@/main/settings-manager'

interface ProxiedToolsSettingsProps {
  tools: ProxiedTool[]
  onToolAdded: () => void
  onToolRemoved: () => void
}

export function ProxiedToolsSettings({
  tools,
  onToolAdded,
  onToolRemoved,
}: ProxiedToolsSettingsProps) {
  const [newToolName, setNewToolName] = useState('')
  const [newToolPath, setNewToolPath] = useState('')
  const [newToolDescription, setNewToolDescription] = useState('')
  const [editingTool, setEditingTool] = useState<ProxiedTool | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const handleAddProxiedTool = async () => {
    if (!newToolName.trim() || !newToolPath.trim()) return

    try {
      setIsAdding(true)
      await window.electronAPI.addProxiedTool({
        name: newToolName.trim(),
        hostPath: newToolPath.trim(),
        description: newToolDescription.trim() || undefined,
      })
      setNewToolName('')
      setNewToolPath('')
      setNewToolDescription('')
      onToolAdded()
    } catch (error) {
      console.error('Failed to add proxied tool:', error)
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemoveProxiedTool = async (id: string) => {
    try {
      await window.electronAPI.removeProxiedTool(id)
      onToolRemoved()
    } catch (error) {
      console.error('Failed to remove proxied tool:', error)
    }
  }

  const handleEditProxiedTool = (tool: ProxiedTool) => {
    setEditingTool(tool)
    setNewToolName(tool.name)
    setNewToolPath(tool.hostPath)
    setNewToolDescription(tool.description || '')
  }

  const handleUpdateProxiedTool = async () => {
    if (!editingTool || !newToolName.trim() || !newToolPath.trim()) return

    try {
      setIsAdding(true)
      // Remove the old tool and add the updated one
      await window.electronAPI.removeProxiedTool(editingTool.id)
      await window.electronAPI.addProxiedTool({
        name: newToolName.trim(),
        hostPath: newToolPath.trim(),
        description: newToolDescription.trim() || undefined,
      })
      setEditingTool(null)
      setNewToolName('')
      setNewToolPath('')
      setNewToolDescription('')
      onToolAdded()
    } catch (error) {
      console.error('Failed to update proxied tool:', error)
    } finally {
      setIsAdding(false)
    }
  }

  const handleCancelEdit = () => {
    setEditingTool(null)
    setNewToolName('')
    setNewToolPath('')
    setNewToolDescription('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-1">Proxied Tools Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure tools that will be available inside Docker containers via proxy
        </p>
      </div>

      {/* Existing Tools List */}
      <div className="space-y-3">
        {tools.length > 0 ? (
          tools.map((tool) => (
            <div
              key={tool.id}
              className="flex items-start justify-between p-4 bg-muted/50 rounded-md border"
            >
              <div className="flex-1">
                <div className="font-medium">{tool.name}</div>
                <div className="font-mono text-xs text-muted-foreground mt-1">
                  {tool.hostPath}
                </div>
                {tool.description && (
                  <div className="text-sm text-muted-foreground mt-1">
                    {tool.description}
                  </div>
                )}
              </div>
              <div className="flex gap-2 ml-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEditProxiedTool(tool)}
                  className="h-8"
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveProxiedTool(tool.id)}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center p-8 bg-muted/30 rounded-md border border-dashed">
            <p className="text-sm text-muted-foreground">
              No proxied tools configured yet. Add one below.
            </p>
          </div>
        )}
      </div>

      {/* Add/Edit Tool Form */}
      <div className="space-y-4 pt-4 border-t">
        <h4 className="font-medium">
          {editingTool ? 'Edit Proxied Tool' : 'Add Proxied Tool'}
        </h4>

        <div className="space-y-2">
          <Label htmlFor="tool-name">Tool Name</Label>
          <Input
            id="tool-name"
            placeholder="e.g., npm"
            value={newToolName}
            onChange={(e) => setNewToolName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newToolName.trim() && newToolPath.trim()) {
                if (editingTool) {
                  handleUpdateProxiedTool()
                } else {
                  handleAddProxiedTool()
                }
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Command name as it will be called inside the container
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tool-path">Host Path</Label>
          <Input
            id="tool-path"
            placeholder="e.g., /usr/local/bin/npm"
            value={newToolPath}
            onChange={(e) => setNewToolPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newToolName.trim() && newToolPath.trim()) {
                if (editingTool) {
                  handleUpdateProxiedTool()
                } else {
                  handleAddProxiedTool()
                }
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Full path to the command on the host system
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tool-description">Description (optional)</Label>
          <Input
            id="tool-description"
            placeholder="e.g., Node package manager"
            value={newToolDescription}
            onChange={(e) => setNewToolDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newToolName.trim() && newToolPath.trim()) {
                if (editingTool) {
                  handleUpdateProxiedTool()
                } else {
                  handleAddProxiedTool()
                }
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            Brief description of what this tool does
          </p>
        </div>

        <div className="flex gap-2">
          {editingTool ? (
            <>
              <Button
                onClick={handleUpdateProxiedTool}
                disabled={isAdding || !newToolName.trim() || !newToolPath.trim()}
              >
                <Plus className="h-4 w-4 mr-2" />
                {isAdding ? 'Updating...' : 'Update Tool'}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancelEdit}
                disabled={isAdding}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              onClick={handleAddProxiedTool}
              disabled={isAdding || !newToolName.trim() || !newToolPath.trim()}
            >
              <Plus className="h-4 w-4 mr-2" />
              {isAdding ? 'Adding...' : 'Add Tool'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
