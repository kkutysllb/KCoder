import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export interface WindowOptions {
  enginePort: number
  preloadPath: string
}

export function createWindow(options: WindowOptions): BrowserWindow {
  const { enginePort, preloadPath } = options

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the app
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    // Development: load from Vite dev server with engine port as query param
    const devUrl = `${process.env['ELECTRON_RENDERER_URL']}?enginePort=${enginePort}`
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Production: load built files
    const indexPath = join(__dirname, '../renderer/index.html')
    mainWindow.loadFile(indexPath, {
      query: { enginePort: String(enginePort) }
    })
  }

  return mainWindow
}

// Need to import app for isPackaged check
import { app } from 'electron'
