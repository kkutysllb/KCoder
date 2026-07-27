import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startEngine, stopEngine, getEnginePort, getEngineToken, getEngineDataDir } from './engine-host'
import { createWindow } from './window'
import { setupMenu } from './menu'
import { setupTerminalIPC, killAllTerminals } from './terminal'
import { setupDialogIPC } from './dialog'
import {
  listModels,
  saveModel,
  deleteModel,
  activateModel,
  discoverModels,
  type ModelProfileInput
} from './models'

let mainWindow: BrowserWindow | null = null

/**
 * Register product-side model management IPC handlers.
 *
 * The new engine exposes no HTTP CRUD for models; the product drives the
 * engine's UserDataStore directly from the main process.
 */
function setupModelIPC(): void {
  const dataDir = getEngineDataDir()
  ipcMain.handle('model:list', () => listModels(dataDir))
  ipcMain.handle('model:save', (_event, name: string, profile: unknown) =>
    saveModel(dataDir, name, profile as ModelProfileInput)
  )
  ipcMain.handle('model:delete', (_event, name: string) => deleteModel(dataDir, name))
  ipcMain.handle('model:activate', (_event, name: string) => activateModel(dataDir, name))
  ipcMain.handle('model:discover', (_event, input: unknown) =>
    discoverModels(input as Parameters<typeof discoverModels>[0])
  )
}

async function bootstrap(): Promise<void> {
  // Start the QiongQi engine
  console.log('[KCoder] Starting engine...')
  await startEngine()
  console.log(`[KCoder] Engine started on port ${getEnginePort()}`)

  // Register model management IPC (after engine dataDir is known)
  setupModelIPC()

  // Create main window
  mainWindow = createWindow({
    enginePort: getEnginePort(),
    engineToken: getEngineToken(),
    preloadPath: join(__dirname, '../preload/index.mjs')
  })

  // Setup application menu
  setupMenu(mainWindow)

  // Setup PTY terminal IPC handlers
  setupTerminalIPC(() => mainWindow)

  // Setup folder picker dialog IPC handlers
  setupDialogIPC(() => mainWindow)

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
        engineToken: getEngineToken(),
        preloadPath: join(__dirname, '../preload/index.mjs')
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
  killAllTerminals()
  await stopEngine()
})
