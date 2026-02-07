import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow, Notification } from 'electron'
import { getConfigDir } from './config'
import { devLog } from './dev-log'

interface StopEvent {
  event: 'stop'
  reason: 'input_required'
  workspaceId: string
}

const servers: Map<string, net.Server> = new Map()
let waitingQueue: string[] = []
let mainWindow: BrowserWindow | null = null
let instanceId: string = ''

export function setInstanceId(id: string): void {
  instanceId = id
}

export function getInstanceId(): string {
  return instanceId
}

// Use /tmp for sockets to avoid macOS 104-char Unix socket path limit
// Full UUIDs exceed limit, so we use shortened IDs (first 8 chars)
function getSocketsDir(): string {
  // Shorten instance ID to first 8 chars
  return path.join('/tmp', 'bm', instanceId.slice(0, 8))
}

function getSocketPath(workspaceId: string): string {
  // Shorten workspace ID to first 8 chars
  return path.join(getSocketsDir(), `${workspaceId.slice(0, 8)}.sock`)
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getWaitingQueue(): string[] {
  return [...waitingQueue]
}

export function removeFromWaitingQueue(workspaceId: string): void {
  waitingQueue = waitingQueue.filter((id) => id !== workspaceId)
  notifyWaitingCountChanged()
}

export function getNextWaitingWorkspace(): string | undefined {
  return waitingQueue[0]
}

function notifyWaitingCountChanged(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('waiting-count-changed', waitingQueue.length)
    mainWindow.webContents.send('waiting-queue-changed', waitingQueue)
  }
}

function handleStopEvent(event: StopEvent): void {
  const { workspaceId } = event
  devLog(`[StopEvent] Handling stop for workspace ${workspaceId}`)

  // Add to waiting queue if not already there
  if (!waitingQueue.includes(workspaceId)) {
    waitingQueue.push(workspaceId)
    devLog(`[StopEvent] Added to queue, queue now: ${JSON.stringify(waitingQueue)}`)
  } else {
    devLog(`[StopEvent] Already in queue`)
  }

  // Send notification
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'Agent Needs Input',
      body: `Workspace ${workspaceId} is waiting for your input`,
      silent: false,
    })
    notification.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
        mainWindow.webContents.send('focus-workspace', workspaceId)
      }
    })
    notification.show()
  }

  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    devLog(`[StopEvent] Sending agent-waiting event to renderer`)
    mainWindow.webContents.send('agent-waiting', workspaceId)
    // Don't auto-focus - let the renderer's expand mode handle visibility
  } else {
    devLog(`[StopEvent] WARNING: mainWindow not available`)
  }

  notifyWaitingCountChanged()
}

export function createSocketServer(workspaceId: string): void {
  devLog(`[SocketServer] Creating socket for workspace ${workspaceId}, instanceId=${instanceId}`)

  const socketsDir = getSocketsDir()

  // Ensure instance socket directory exists
  if (!fs.existsSync(socketsDir)) {
    fs.mkdirSync(socketsDir, { recursive: true })
  }

  const socketPath = getSocketPath(workspaceId)
  devLog(`[SocketServer] Socket path: ${socketPath}`)

  // Remove existing socket file
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath)
  }

  const server = net.createServer((socket) => {
    let buffer = ''

    const processLines = (): void => {
      // Try to parse complete JSON messages (newline-delimited)
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const event = JSON.parse(line) as StopEvent
            if (event.event === 'stop') {
              devLog(`Received stop event for workspace ${workspaceId}`)
              handleStopEvent(event)
            }
          } catch (e) {
            console.error('Failed to parse socket message:', line, e)
          }
        }
      }
    }

    socket.on('data', (data) => {
      buffer += data.toString()
      processLines()
    })

    socket.on('end', () => {
      // Process any remaining data when socket closes (handles messages without trailing newline)
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as StopEvent
          if (event.event === 'stop') {
            devLog(
              `Received stop event (on close) for workspace ${workspaceId}`
            )
            handleStopEvent(event)
          }
        } catch (e) {
          console.error('Failed to parse final buffer:', buffer, e)
        }
        buffer = ''
      }
    })

    socket.on('error', (err) => {
      console.error(`Socket error for workspace ${workspaceId}:`, err)
    })
  })

  server.listen(socketPath, () => {
    devLog(`[SocketServer] Socket server listening at ${socketPath}`)
  })

  server.on('error', (err) => {
    console.error(`[SocketServer] Server error for workspace ${workspaceId}:`, err)
  })

  servers.set(workspaceId, server)
}

export function closeSocketServer(workspaceId: string): void {
  const server = servers.get(workspaceId)
  if (server) {
    server.close()
    servers.delete(workspaceId)
  }

  // Remove socket file
  const socketPath = getSocketPath(workspaceId)
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath)
  }

  // Remove from waiting queue
  removeFromWaitingQueue(workspaceId)
}

export function closeAllSocketServers(): void {
  for (const [workspaceId] of servers) {
    closeSocketServer(workspaceId)
  }
  waitingQueue = []

  // Remove instance-specific socket directory
  if (instanceId) {
    const instanceDir = path.join(getConfigDir(), 'sockets', instanceId)
    if (fs.existsSync(instanceDir)) {
      fs.rmSync(instanceDir, { recursive: true })
    }
  }
}
