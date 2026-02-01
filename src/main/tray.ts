import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { getWaitingQueue, getNextWaitingWorkspace } from './socket-server'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

export function createTray(window: BrowserWindow): void {
  mainWindow = window

  // Create tray with empty image (will show as a dot on macOS)
  tray = new Tray(nativeImage.createEmpty())

  updateTray(0)
}

export function updateTray(waitingCount: number): void {
  if (!tray) return

  // Update title to show count (appears next to tray icon on macOS)
  if (waitingCount > 0) {
    tray.setTitle(` ${waitingCount}`)
  } else {
    tray.setTitle('')
  }

  tray.setToolTip(
    waitingCount > 0
      ? `Bismark - ${waitingCount} agent${waitingCount > 1 ? 's' : ''} waiting`
      : 'Bismark - No agents waiting'
  )

  // Update context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Bismark${waitingCount > 0 ? ` (${waitingCount} waiting)` : ''}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    {
      label: 'Focus Next Waiting',
      enabled: waitingCount > 0,
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
          const nextWorkspace = getNextWaitingWorkspace()
          if (nextWorkspace) {
            mainWindow.webContents.send('focus-workspace', nextWorkspace)
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  // Click on tray icon shows/focuses app
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
      }

      // If there are waiting agents, focus the first one
      const currentWaitingQueue = getWaitingQueue()
      if (currentWaitingQueue.length > 0) {
        mainWindow.webContents.send('focus-workspace', currentWaitingQueue[0])
      }
    }
  })
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
