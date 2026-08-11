import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startEngine, stopEngine, getEnginePort, getEngineToken, getEngineDataDir } from './engine-host'
import { createWindow } from './window'
import { setupMenu } from './menu'
import { setupTerminalIPC, killAllTerminals } from './terminal'
import { setupDialogIPC } from './dialog'
import { createTray, destroyTray, updateTrayLocale, type TrayLocale } from './tray'
import {
  listModels,
  saveModel,
  deleteModel,
  activateModel,
  discoverModels,
  type ModelProfileInput
} from './models'
import { syncSubAgents } from './sub-agent-injector'

let mainWindow: BrowserWindow | null = null

/**
 * Register product-side model management IPC handlers.
 *
 * The new engine exposes no HTTP CRUD for models; the product drives the
 * engine's UserDataStore directly from the main process.
 */
function setupModelIPC(): void {
  const dataDir = getEngineDataDir()
  // userId is passed from the renderer (the authenticated user's id). It MUST
  // match the thread ownerUserId the engine uses, otherwise model profiles
  // would never resolve at request time.
  ipcMain.handle('model:list', (_event, userId: string) => listModels(dataDir, userId))
  ipcMain.handle('model:save', (_event, userId: string, name: string, profile: unknown) =>
    saveModel(dataDir, userId, name, profile as ModelProfileInput)
  )
  ipcMain.handle('model:delete', (_event, userId: string, name: string) =>
    deleteModel(dataDir, userId, name)
  )
  ipcMain.handle('model:activate', (_event, userId: string, name: string) =>
    activateModel(dataDir, userId, name)
  )
  ipcMain.handle('model:discover', (_event, input: unknown) =>
    discoverModels(input as Parameters<typeof discoverModels>[0])
  )
}

/**
 * Register sub-agents config sync IPC handler.
 *
 * Renderer triggers this after sub-agent CRUD in Settings; main process
 * re-reads sub_agents.json and injects custom_agents into config.yaml.
 */
function setupSubAgentsIPC(): void {
  const dataDir = getEngineDataDir()
  ipcMain.handle('sub-agents:sync', async () => {
    try {
      await syncSubAgents(dataDir)
    } catch (err) {
      console.error('[KCoder] Failed to sync sub-agents:', err)
    }
  })
}

async function bootstrap(): Promise<void> {
  // Start the QiongQi engine
  console.log('[KCoder] Starting engine...')
  await startEngine()
  console.log(`[KCoder] Engine started on port ${getEnginePort()}`)

  // Register model management IPC (after engine dataDir is known)
  setupModelIPC()

  // Register sub-agents config sync IPC (after engine dataDir is known)
  setupSubAgentsIPC()

  // Create main window
  mainWindow = createWindow({
    enginePort: getEnginePort(),
    engineToken: getEngineToken(),
    preloadPath: join(__dirname, '../preload/index.mjs')
  })

  // Register window control IPC handlers (minimize/maximize/toggle/close)
  // These are sent by the renderer's preload bridge (window.kcoder.window.*).
  setupWindowIPC(mainWindow)

  // Setup application menu
  setupMenu(mainWindow)

  // Setup PTY terminal IPC handlers
  setupTerminalIPC(() => mainWindow)

  // Setup folder picker dialog IPC handlers
  setupDialogIPC(() => mainWindow)

  // Setup tray IPC (renderer 切换语言时通知 main 同步 tray 菜单)
  setupTrayIPC()

  // Create system tray (在 mainWindow 创建后)
  createTray(() => mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Register tray-related IPC handlers.
 *
 * renderer 在用户切换 i18n 语言时通过 'tray:update-locale' 通知 main 进程，
 * 让 tray.ts 重建菜单文案。这是必要的因为 main 进程的 Tray 不在 React
 * 树里，不能直接读 i18n context。
 */
function setupTrayIPC(): void {
  ipcMain.on('tray:update-locale', (_event, locale: unknown) => {
    if (locale === 'zh-CN' || locale === 'en') {
      updateTrayLocale(locale as TrayLocale, () => mainWindow)
    }
  })
}

/**
 * Register window control IPC handlers.
 *
 * preload/index.ts exposes `window.kcoder.window.{minimize,maximize,close,
 * toggleMaximize, isMaximized}` — this function wires those IPC channels to
 * the actual BrowserWindow methods.
 *
 * `toggleMaximize` is used by the landing page's double-click-on-header
 * behavior: maximizes if unmaximized, restores otherwise. Returns the new
 * maximized state so the renderer can update its UI affordance.
 */
function setupWindowIPC(win: BrowserWindow): void {
  ipcMain.on('window-minimize', () => win.minimize())
  ipcMain.on('window-maximize', () => win.maximize())
  ipcMain.on('window-close', () => win.close())

  ipcMain.handle('window-toggle-maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
  })

  ipcMain.handle('window-is-maximized', () => win.isMaximized())

  // Notify renderer when maximization state changes (e.g. user uses OS
  // titlebar buttons or Windows snap) so UI state stays in sync.
  win.on('maximize', () => win.webContents.send('window-state-changed', { maximized: true }))
  win.on('unmaximize', () => win.webContents.send('window-state-changed', { maximized: false }))
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
  destroyTray()
  killAllTerminals()
  await stopEngine()
})
