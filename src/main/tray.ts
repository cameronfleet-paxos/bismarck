import path from 'path'
import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'
import { getWaitingQueue, getNextWaitingWorkspace } from './socket-server'

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null

// Determine asset path based on environment
const getAssetPath = (filename: string): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', filename)
  }
  // In development, assets are at project root
  return path.join(__dirname, '..', '..', '..', 'assets', filename)
}

export function createTray(window: BrowserWindow): void {
  mainWindow = window

  // Load the template icon for macOS menu bar
  const iconPath = getAssetPath('trayTemplate.png')
  const trayIcon = nativeImage.createFromPath(iconPath)
  trayIcon.setTemplateImage(true) // Tell macOS this is a template image

  tray = new Tray(trayIcon)

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
      ? `Bismarck - ${waitingCount} agent${waitingCount > 1 ? 's' : ''} waiting`
      : 'Bismarck - No agents waiting'
  )

  // Update context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Bismarck${waitingCount > 0 ? ` (${waitingCount} waiting)` : ''}`,
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
