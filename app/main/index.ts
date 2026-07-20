import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { startEngine, stopEngine, getEnginePort } from './engine-host'
import { createWindow } from './window'
import { setupMenu } from './menu'

let mainWindow: BrowserWindow | null = null

async function bootstrap(): Promise<void> {
  // Start the QiongQi engine
  console.log('[KCoder] Starting engine...')
  await startEngine()
  console.log(`[KCoder] Engine started on port ${getEnginePort()}`)

  // Create main window
  mainWindow = createWindow({
    enginePort: getEnginePort(),
    preloadPath: join(__dirname, '../preload/index.js')
  })

  // Setup application menu
  setupMenu(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  await bootstrap()

  app.on('activate', () => {
    // On macOS, re-create a window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow({
        enginePort: getEnginePort(),
        preloadPath: join(__dirname, '../preload/index.js')
      })
    }
  })
})

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Graceful shutdown
app.on('before-quit', async () => {
  console.log('[KCoder] Shutting down engine...')
  await stopEngine()
})
