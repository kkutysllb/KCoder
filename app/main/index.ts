import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { startEngine, stopEngine, restartEngine, getEnginePort, getEngineToken, getEngineDataDir } from './engine-host'
import { createWindow } from './window'
import { setupMenu } from './menu'
import { setupTerminalIPC, killAllTerminals } from './terminal'
import { setupDialogIPC } from './dialog'
import { setupSettingsIPC } from './settings'
import { createTray, destroyTray, updateTrayLocale, type TrayLocale } from './tray'
import {
  listModels,
  saveModel,
  deleteModel,
  activateModel,
  discoverModels,
  type ModelProfileInput
} from './models'
import {
  syncSubAgents,
  readSubAgentsStore,
  writeSubAgentsStore,
  storeToSubAgentEntries,
  type SubAgentEntry,
  type SubAgentSettings,
  type SubAgentsStore
} from './sub-agent-injector'
import { listProjects, createProject, updateProject, deleteProject } from './project-store'
import {
  initLocalServices,
  getRuntimeConfig,
  updateRuntimeConfigSection,
  getTokenUsageStats,
  getTokenUsageTimeseries,
  gitStatus,
  gitCreateBranch,
  gitCommit,
  gitPush,
  gitBranchList,
  gitLog,
  repoExists,
  workspaceTree,
  workspaceFiles,
  workspaceReadFile,
  workspaceWriteFile,
  workspaceFileType,
  workspaceRevertFile
} from './local-services'

let mainWindow: BrowserWindow | null = null

/**
 * 产品级本地服务 IPC（2026-08 重构）：
 * runtime-config / token-usage / workspace git 由主进程提供。
 */
function setupLocalServicesIPC(): void {
  ipcMain.handle('local:runtime-config-get', (_e, section?: string) =>
    getRuntimeConfig(section))
  ipcMain.handle('local:runtime-config-set', (_e, section: string, value: Record<string, unknown>) =>
    updateRuntimeConfigSection(section, value))
  ipcMain.handle('local:token-usage-stats', (_e, year?: number, month?: number) =>
    getTokenUsageStats(year, month))
  ipcMain.handle('local:token-usage-timeseries', (_e, days?: number) =>
    getTokenUsageTimeseries(days))
  ipcMain.handle('local:git-status', (_e, repo: string) => gitStatus(repo))
  ipcMain.handle('local:git-branch-create', (_e, repo: string, name: string) =>
    gitCreateBranch(repo, name))
  ipcMain.handle('local:git-commit', (_e, repo: string, message: string) =>
    gitCommit(repo, message))
  ipcMain.handle('local:git-push', (_e, repo: string) => gitPush(repo))
  ipcMain.handle('local:git-branches', (_e, repo: string) => gitBranchList(repo))
  ipcMain.handle('local:git-log', (_e, repo: string, n?: number) => gitLog(repo, n))
  ipcMain.handle('local:repo-exists', (_e, repo: string) => repoExists(repo))
  ipcMain.handle('local:ws-tree', (_e, path: string) => workspaceTree(path))
  ipcMain.handle('local:ws-files', (_e, path: string) => workspaceFiles(path))
  ipcMain.handle('local:ws-read', (_e, path: string) => workspaceReadFile(path))
  ipcMain.handle('local:ws-write', (_e, path: string, content: string) =>
    workspaceWriteFile(path, content))
  ipcMain.handle('local:ws-type', (_e, path: string) => workspaceFileType(path))
  ipcMain.handle('local:ws-revert', (_e, workspace: string, path: string, status: string) =>
    workspaceRevertFile(workspace, path, status))
}

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
 * Register engine restart IPC handler.
 *
 * Renderer（设置页重启按钮）调用此 handler 重启 Python sidecar，使
 * config.yaml 中启动时初始化的字段（database.backend / sandbox.use 等）
 * 在不退出 app 的情况下生效。返回新的 { port, token }，由调用方自行更新
 * store + 重建 API 实例。
 */
function setupEngineIPC(): void {
  ipcMain.handle('engine:restart', async () => restartEngine())
}

/**
 * Register sub-agents IPC handlers（sub_agents.json CRUD + config.yaml 注入）。
 *
 * Renderer 在 Settings > Sub-agents 中增删改后触发；主进程读写
 * `<dataDir>/product/kcoder_local/sub_agents.json` 并注入 config.yaml
 * `subagents.custom_agents:`（QiLin 热重载生效）。
 */
function setupSubAgentsIPC(): void {
  const dataDir = getEngineDataDir()

  /** 读 store → 写回 → 注入 config.yaml（CRUD 公共尾部） */
  const commit = async (mutate: (store: SubAgentsStore) => void): Promise<SubAgentsStore> => {
    const store = await readSubAgentsStore(dataDir)
    mutate(store)
    await writeSubAgentsStore(dataDir, store)
    await syncSubAgents(dataDir)
    return store
  }

  ipcMain.handle('sub-agents:list', async (): Promise<{ settings: Record<string, unknown>; subAgents: unknown[] }> => {
    const store = await readSubAgentsStore(dataDir)
    return {
      settings: { ...(store.settings ?? {}) },
      subAgents: storeToSubAgentEntries(store)
    }
  })

  ipcMain.handle('sub-agents:create', async (_e, payload: unknown) => {
    const entry = (payload ?? {}) as Record<string, unknown>
    const id = String(entry.id ?? '').trim()
    if (!id) throw new Error('Sub-agent id is required')
    const store = await commit((s) => {
      const agents = s.agents ?? []
      const idx = agents.findIndex((a) => a.id === id)
      const next: SubAgentEntry = {
        id,
        description: String(entry.description ?? ''),
        content: String(entry.content ?? ''),
        tools: Array.isArray(entry.tools) ? (entry.tools as string[]) : [],
        inheritMode: entry.inheritMode === 'custom' ? 'custom' : 'default'
      }
      if (idx >= 0) agents[idx] = next
      else agents.push(next)
      s.agents = agents
    })
    return storeToSubAgentEntries(store).find((a) => a.id === id) ?? null
  })

  ipcMain.handle('sub-agents:delete', async (_e, id: unknown) => {
    await commit((s) => {
      s.agents = (s.agents ?? []).filter((a) => a.id !== String(id ?? ''))
    })
  })

  ipcMain.handle('sub-agents:update-settings', async (_e, settings: unknown) => {
    const next = (settings ?? {}) as Partial<SubAgentSettings> & Record<string, unknown>
    await commit((s) => {
      s.settings = next as SubAgentSettings
    })
  })

  ipcMain.handle('sub-agents:sync', async () => {
    try {
      await syncSubAgents(dataDir)
    } catch (err) {
      console.error('[KCoder] Failed to sync sub-agents:', err)
    }
  })
}

/**
 * Register projects IPC handlers（产品层项目注册表，引擎无 /api/projects 语义）。
 */
function setupProjectsIPC(): void {
  const dataDir = getEngineDataDir()

  ipcMain.handle('projects:list', async () => {
    const projects = await listProjects(dataDir)
    return { projects }
  })

  ipcMain.handle('projects:create', async (_e, path: unknown, name: unknown, options: unknown) => {
    const opts = (options ?? {}) as { silentMissing?: boolean }
    const result = await createProject(
      dataDir,
      String(path ?? ''),
      typeof name === 'string' ? name : undefined,
      opts.silentMissing === true
    )
    if (result.skipped) {
      return { skipped: true, path: String(path ?? ''), reason: result.reason ?? 'skipped' }
    }
    return result.entry
  })

  ipcMain.handle('projects:update', async (_e, projectId: unknown, patch: unknown) => {
    return updateProject(
      dataDir,
      String(projectId ?? ''),
      (patch ?? {}) as { name?: string; description?: string }
    )
  })

  ipcMain.handle('projects:delete', async (_e, projectId: unknown) => {
    return deleteProject(dataDir, String(projectId ?? ''))
  })
}

async function bootstrap(): Promise<void> {
  // Start the QiongQi engine
  console.log('[KCoder] Starting engine...')
  await startEngine()
  console.log(`[KCoder] Engine started on port ${getEnginePort()}`)

  // 本地服务初始化（product_services.py 依赖 python-runtime 与数据根）
  initLocalServices({
    runtimeDir: join(__dirname, '..', '..', '..', 'python-runtime'),
    dataDir: getEngineDataDir()
  })

  // Register product-local services IPC（runtime-config/token-usage/git）
  setupLocalServicesIPC()

  // Register model management IPC (after engine dataDir is known)
  setupModelIPC()

  // Register sub-agents config sync IPC (after engine dataDir is known)
  setupSubAgentsIPC()

  // Register projects registry IPC (产品层项目注册表)
  setupProjectsIPC()

  // Register engine restart IPC (设置页重启按钮)
  setupEngineIPC()

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

  // Setup save-settings IPC (proxy / cert 从 renderer 偏好应用到 main 进程网络层)
  setupSettingsIPC()

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

// Graceful shutdown。
// Electron 的 before-quit 里 await 并不会阻塞退出流程（事件不等待 async
// 完成），需 preventDefault + 收尾完成后再手动 app.quit() 的标准模式，
// 否则 stopEngine 的组杀来不及执行 → sidecar 孤儿堆积（内存溢出元凶）。
let engineShutdownDone = false
app.on('before-quit', (event) => {
  if (engineShutdownDone) return
  event.preventDefault()
  engineShutdownDone = true
  void (async () => {
    try {
      console.log('[KCoder] Shutting down engine...')
      destroyTray()
      killAllTerminals()
      await stopEngine()
    } finally {
      app.quit()
    }
  })()
})
