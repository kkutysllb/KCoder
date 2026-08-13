import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export interface WindowOptions {
  enginePort: number
  engineToken: string
  preloadPath: string
}

export function createWindow(options: WindowOptions): BrowserWindow {
  const { enginePort, engineToken, preloadPath } = options

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

  // Show window when ready, maximized by default.
  //
  // 用户首次启动 / 每次启动默认最大化窗口，提升开箱体验。用户手动还原后，
  // 当前会话保留还原尺寸；下次启动仍然最大化（行为简单可预测，不绑定
  // 持久化的窗口尺寸状态——若未来需要"记住上次尺寸"，可引入 electron-store）。
  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  // Open external links in default browser；workspace 虚拟路径/相对路径/file://
  // 等非 http(s) URL 直接 deny——否则 Electron 会新建黑屏窗口或把无效地址
  // 丢给系统浏览器。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Load the app
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    // Development: load from Vite dev server with engine port/token as query params
    const devUrl = `${process.env['ELECTRON_RENDERER_URL']}?enginePort=${enginePort}&engineToken=${engineToken}`
    mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Production: load built files
    const indexPath = join(__dirname, '../renderer/index.html')
    mainWindow.loadFile(indexPath, {
      query: { enginePort: String(enginePort), engineToken }
    })
  }

  return mainWindow
}

// Need to import app for isPackaged check
import { app } from 'electron'
