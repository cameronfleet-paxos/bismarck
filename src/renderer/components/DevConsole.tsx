/**
 * DevConsole
 *
 * Hidden dev panel triggered by Cmd+Shift+D (dev mode only)
 * Provides testing tools for the headless agent flow.
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Play, Square, Loader2, CheckCircle, XCircle, Terminal, Trash2, UserPlus, Download } from 'lucide-react'
import { Button } from './ui/button'
import type { HeadlessAgentInfo, StreamEvent } from '@/shared/types'

interface DevConsoleProps {
  open: boolean
  onClose: () => void
  simulateNewUser?: boolean
  onToggleSimulateNewUser?: () => void
}

interface MockPlanState {
  planId: string
  planDir: string
  tasks: Array<{ id: string; subject: string; status: string }>
}

export function DevConsole({ open, onClose, simulateNewUser, onToggleSimulateNewUser }: DevConsoleProps) {
  const [mockPlan, setMockPlan] = useState<MockPlanState | null>(null)
  const [mockAgents, setMockAgents] = useState<Map<string, HeadlessAgentInfo>>(new Map())
  const [eventLog, setEventLog] = useState<Array<{ time: string; message: string; type: 'info' | 'success' | 'error' }>>([])
  const [isRunning, setIsRunning] = useState(false)
  const [singleAgentId, setSingleAgentId] = useState('')

  // Log helper
  const log = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString()
    setEventLog(prev => [...prev.slice(-49), { time, message, type }])
  }, [])

  // Listen for headless agent events
  useEffect(() => {
    if (!open) return

    const handleStarted = (data: { taskId: string; planId: string; worktreePath: string }) => {
      log(`Agent started: ${data.taskId}`, 'info')
    }

    const handleUpdate = (info: HeadlessAgentInfo) => {
      setMockAgents(prev => {
        const next = new Map(prev)
        if (info.taskId) {
          next.set(info.taskId, info)
        }
        return next
      })
      log(`Agent ${info.taskId}: ${info.status}`, info.status === 'completed' ? 'success' : info.status === 'failed' ? 'error' : 'info')
    }

    const handleEvent = (data: { planId: string; taskId: string; event: StreamEvent }) => {
      log(`Event [${data.taskId}]: ${data.event.type}`, 'info')
    }

    window.electronAPI?.onHeadlessAgentStarted?.(handleStarted)
    window.electronAPI?.onHeadlessAgentUpdate?.(handleUpdate)
    window.electronAPI?.onHeadlessAgentEvent?.(handleEvent)

    return () => {
      // Note: no way to remove individual listeners in current API
    }
  }, [open, log])

  // Run full mock flow
  const handleRunMockFlow = async () => {
    setIsRunning(true)
    log('Starting full mock flow...', 'info')

    try {
      const result = await window.electronAPI?.devRunMockFlow?.()
      if (result) {
        setMockPlan({
          planId: result.planId,
          planDir: result.planDir,
          tasks: result.tasks.map((t: { id: string; subject: string }) => ({ ...t, status: 'pending' })),
        })
        log(`Mock plan created: ${result.planId}`, 'success')
        log(`Created ${result.tasks.length} tasks`, 'info')
      }
    } catch (error) {
      log(`Error: ${error}`, 'error')
    }

    setIsRunning(false)
  }

  // Start single mock agent
  const handleStartSingleAgent = async () => {
    const taskId = singleAgentId.trim() || `test-task-${Date.now()}`
    log(`Starting single mock agent: ${taskId}`, 'info')

    try {
      await window.electronAPI?.devStartMockAgent?.(taskId)
      log(`Mock agent started: ${taskId}`, 'success')
    } catch (error) {
      log(`Error: ${error}`, 'error')
    }
  }

  // Stop all
  const handleStopAll = async () => {
    log('Stopping all mock components...', 'info')

    try {
      await window.electronAPI?.devStopMock?.()
      setMockPlan(null)
      setMockAgents(new Map())
      log('All mock components stopped', 'success')
    } catch (error) {
      log(`Error: ${error}`, 'error')
    }
  }

  // Clear log
  const handleClearLog = () => {
    setEventLog([])
  }

  // Close on Escape key
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div data-testid="dev-console" className="fixed inset-4 z-50 bg-background/95 backdrop-blur-sm border rounded-lg shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-purple-500" />
          <h2 className="font-semibold">Dev Console</h2>
          <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
            Development Only
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Controls */}
        <div className="w-80 border-r p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h3 className="text-sm font-medium mb-2">Mock Flow Controls</h3>
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleRunMockFlow}
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Run Full Mock Flow
              </Button>

              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Task ID (optional)"
                  value={singleAgentId}
                  onChange={(e) => setSingleAgentId(e.target.value)}
                  className="flex-1 px-2 py-1 text-sm rounded border bg-background"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleStartSingleAgent}
                >
                  Start Agent
                </Button>
              </div>

              <Button
                variant="destructive"
                className="w-full"
                onClick={handleStopAll}
              >
                <Square className="w-4 h-4 mr-2" />
                Stop All
              </Button>
            </div>
          </div>

          {/* User Simulation */}
          {onToggleSimulateNewUser && (
            <div>
              <h3 className="text-sm font-medium mb-2">User Simulation</h3>
              <Button
                variant={simulateNewUser ? "destructive" : "outline"}
                className="w-full"
                onClick={onToggleSimulateNewUser}
              >
                {simulateNewUser ? (
                  <>
                    <XCircle className="w-4 h-4 mr-2" />
                    Exit Simulation
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Simulate New User
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                View empty state without affecting data
              </p>
            </div>
          )}

          {/* Simulate Update */}
          <div>
            <h3 className="text-sm font-medium mb-2">Update Simulation</h3>
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await window.electronAPI?.devSetVersionOverride?.('0.1.0')
                  await window.electronAPI?.checkForUpdates?.()
                  log('Simulated outdated version (0.1.0), triggered update check', 'success')
                }}
              >
                <Download className="w-4 h-4 mr-2" />
                Simulate Outdated Version
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={async () => {
                  await window.electronAPI?.devSetVersionOverride?.(null)
                  log('Version override cleared', 'info')
                }}
              >
                Clear Version Override
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Sets app version to 0.1.0 and triggers update check
            </p>
          </div>

          {/* Mock Plan Status */}
          {mockPlan && (
            <div>
              <h3 className="text-sm font-medium mb-2">Mock Plan</h3>
              <div className="text-xs space-y-1 p-2 rounded bg-muted">
                <div>ID: {mockPlan.planId}</div>
                <div className="truncate">Dir: {mockPlan.planDir}</div>
                <div className="mt-2 font-medium">Tasks:</div>
                {mockPlan.tasks.map((task, i) => (
                  <div key={task.id} className="flex items-center gap-2">
                    {mockAgents.get(task.id)?.status === 'completed' ? (
                      <CheckCircle className="w-3 h-3 text-green-500" />
                    ) : mockAgents.get(task.id)?.status === 'running' ? (
                      <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                    ) : mockAgents.get(task.id)?.status === 'failed' ? (
                      <XCircle className="w-3 h-3 text-red-500" />
                    ) : (
                      <div className="w-3 h-3 rounded-full border" />
                    )}
                    <span className="truncate">{i + 1}. {task.subject}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Agents */}
          {mockAgents.size > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">Active Agents ({mockAgents.size})</h3>
              <div className="space-y-2">
                {Array.from(mockAgents.values()).map(info => (
                  <div key={info.id} className="text-xs p-2 rounded bg-muted">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{info.taskId}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        info.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                        info.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                        info.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {info.status}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Events: {info.events.length}
                      {info.result && (
                        <span className="ml-2">
                          Cost: ${info.result.cost?.total_cost_usd?.toFixed(4) || 'N/A'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Event Log */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b">
            <h3 className="text-sm font-medium">Event Log</h3>
            <Button variant="ghost" size="sm" onClick={handleClearLog}>
              <Trash2 className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1">
            {eventLog.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No events yet. Start a mock flow to see events.
              </div>
            ) : (
              eventLog.map((entry, i) => (
                <div
                  key={i}
                  className={`px-2 py-1 rounded ${
                    entry.type === 'success' ? 'bg-green-500/10 text-green-400' :
                    entry.type === 'error' ? 'bg-red-500/10 text-red-400' :
                    'bg-muted'
                  }`}
                >
                  <span className="text-muted-foreground">[{entry.time}]</span>{' '}
                  {entry.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t text-xs text-muted-foreground">
        Press <kbd className="px-1 py-0.5 rounded bg-muted">Esc</kbd> to close or <kbd className="px-1 py-0.5 rounded bg-muted">Cmd+Shift+D</kbd> to toggle.
        Set <code className="px-1 py-0.5 rounded bg-muted">BISMARCK_MOCK_AGENTS=true</code> to use mock agents globally.
      </div>
    </div>
  )
}
