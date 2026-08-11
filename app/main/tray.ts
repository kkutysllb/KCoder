/**
 * tray.ts — 系统托盘图标 + 右键菜单.
 *
 * 职责：
 *   1. 在系统托盘区显示 KCoder 图标
 *   2. 提供右键菜单：显示窗口 / 新会话 / 打开设置 / 退出
 *   3. 单击（macOS）/ 双击（Windows / Linux）切换主窗口可见性
 *   4. 跨平台图标：macOS Template（自动适配明暗主题）/ Windows ICO / Linux PNG
 *
 * 设计要点：
 *   - Tray 是整个 app 生命周期的单例（与 mainWindow 平级），退出时显式 destroy()
 *   - 菜单文案支持 zh-CN / en，通过 updateLocale() 在 renderer 切换语言时同步
 *   - 窗口关闭不销毁 Tray（macOS / "保留在托盘"行为；其他平台行为可后续按需调整）
 *   - 窗口隐藏后单击托盘图标恢复（保留窗口状态，不重建）
 */
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

export type TrayLocale = 'zh-CN' | 'en'

/** Tray 文案字典（main 进程不能直接用 renderer 的 i18n，自己持有轻量副本） */
const STRINGS: Record<TrayLocale, {
  tooltip: string
  show: string
  hide: string
  newChat: string
  settings: string
  quit: string
}> = {
  'zh-CN': {
    tooltip: 'KCoder — 智能编码工作站',
    show: '显示主窗口',
    hide: '隐藏主窗口',
    newChat: '新会话',
    settings: '设置...',
    quit: '退出 KCoder'
  },
  'en': {
    tooltip: 'KCoder — Agentic coding workspace',
    show: 'Show main window',
    hide: 'Hide main window',
    newChat: 'New chat',
    settings: 'Settings...',
    quit: 'Quit KCoder'
  }
}

let trayInstance: Tray | null = null
let currentLocale: TrayLocale = 'zh-CN'

/**
 * 解析托盘图标路径。跨平台差异：
 *
 * - macOS：优先用 iconTemplate.png（16x16 黑色 + alpha）。Electron 在文件名
 *   以 "Template" 结尾（不含扩展名）时自动启用 Template 模式——macOS 会按
 *   系统主题自动反相显示，无需我们提供明/暗两套。
 *   实现细节：Electron 用 setTemplateImage(true) 触发；这里直接传
 *   iconTemplate.png 文件名给 Tray，Electron 不会自动认，需要 nativeImage
 *   + setTemplateImage 才能正确生效。
 *
 * - Windows：用 iconWindows.ico（含 16/24/32/48/64 五尺寸，自动选最佳）
 *
 * - Linux：用 iconLinux32.png（22x22 在大多数 GNOME/KDE 托盘区最清晰，
 *   32x32 作为备选）
 */
function resolveTrayIcon(): string | Electron.NativeImage {
  const buildDir = resolveBuildDir()
  if (!buildDir) {
    // 找不到 build/，回退到默认空图标（Electron 会用透明占位）
    return nativeImage.createEmpty()
  }

  if (process.platform === 'darwin') {
    // macOS Template 图标：必须用 nativeImage + setTemplateImage(true)。
    // 文件名以 "Template" 结尾（@2x 自动按 DPI 加载），macOS 会按系统主题
    // 自动反相显示——浅色主题显示黑色 K，深色主题显示白色 K，无需提供两套。
    //
    // 重要：图标内容必须是「纯黑 + alpha」格式（K 字母作为黑色形状，
    // 背景完全透明）。如果整个图标都是不透明黑色，Template 模式会显示
    // 成一个白色方块——这是常见的踩坑点。
    const templatePath = join(buildDir, 'tray', 'iconTemplate.png')
    const template2xPath = join(buildDir, 'tray', 'iconTemplate@2x.png')
    if (existsSync(templatePath) && existsSync(template2xPath)) {
      // 用 createFromPath 同时加载 1x/2x（filename 自动识别 @2x）
      const img = nativeImage.createFromPath(template2xPath)
      img.setTemplateImage(true)
      return img
    }
    if (existsSync(templatePath)) {
      const img = nativeImage.createFromPath(templatePath)
      img.setTemplateImage(true)
      return img
    }
  }

  if (process.platform === 'win32') {
    const icoPath = join(buildDir, 'tray', 'iconWindows.ico')
    if (existsSync(icoPath)) return icoPath
  }

  // Linux / fallback
  const pngPath = join(buildDir, 'tray', 'iconLinux32.png')
  if (existsSync(pngPath)) return pngPath

  return nativeImage.createEmpty()
}

/**
 * 解析 build/ 目录（含 tray/ 子目录的图标资源）。
 *
 * 开发模式：<repo>/app/build（__dirname = <repo>/app/out/main）
 * 打包模式：<Resources>/build（electron-builder 把 build/ 纳入包内资源时）
 */
function resolveBuildDir(): string | null {
  if (app.isPackaged) {
    const packagedPath = join(process.resourcesPath, 'build')
    if (existsSync(packagedPath)) return packagedPath
  }
  // 开发模式：__dirname = <repo>/app/out/main，回溯 3 层到 app/
  const devPath = join(__dirname, '..', '..', 'build')
  return existsSync(devPath) ? devPath : null
}

/**
 * 构建托盘右键菜单。
 *
 * 菜单项根据当前窗口可见性动态切换 "显示 / 隐藏" 文案。
 */
function buildMenu(getMainWindow: () => BrowserWindow | null): Menu {
  const s = STRINGS[currentLocale]
  const win = getMainWindow()
  const isVisible = win !== null && win.isVisible()

  return Menu.buildFromTemplate([
    {
      label: isVisible ? s.hide : s.show,
      click: () => toggleWindowVisibility(getMainWindow)
    },
    { type: 'separator' },
    {
      label: s.newChat,
      accelerator: 'CmdOrCtrl+N',
      click: () => {
        const w = getMainWindow()
        if (w) {
          if (!w.isVisible()) w.show()
          w.focus()
          w.webContents.send('new-chat')
        }
      }
    },
    {
      label: s.settings,
      accelerator: 'CmdOrCtrl+,',
      click: () => {
        const w = getMainWindow()
        if (w) {
          if (!w.isVisible()) w.show()
          w.focus()
          w.webContents.send('open-settings')
        }
      }
    },
    { type: 'separator' },
    {
      label: s.quit,
      accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
      click: () => app.quit()
    }
  ])
}

/**
 * 切换主窗口可见性。
 *
 * 行为：
 *   - 窗口隐藏 → 显示 + 聚焦
 *   - 窗口可见但未聚焦 → 仅聚焦
 *   - 窗口可见且已聚焦 → 隐藏（macOS 行为；Win/Linux 也可以这样）
 */
function toggleWindowVisibility(getMainWindow: () => BrowserWindow | null): void {
  const win = getMainWindow()
  if (!win) return

  if (!win.isVisible()) {
    win.show()
    win.focus()
  } else if (!win.isFocused()) {
    win.focus()
  } else {
    win.hide()
  }
}

/**
 * 创建并返回 KCoder 系统托盘。
 *
 * 生命周期：
 *   - 在 bootstrap() 末尾（mainWindow 创建后）调用
 *   - 在 app.before-quit 时调 destroyTray() 显式销毁
 *
 * @param getMainWindow 返回当前主窗口的 accessor（避免循环引用，因为
 *                      mainWindow 可能在 closed 事件后被置 null）
 */
export function createTray(getMainWindow: () => BrowserWindow | null): Tray {
  if (trayInstance) return trayInstance

  const icon = resolveTrayIcon()
  trayInstance = new Tray(icon)

  const s = STRINGS[currentLocale]
  trayInstance.setToolTip(s.tooltip)

  // 右键菜单（所有平台都支持）
  trayInstance.setContextMenu(buildMenu(getMainWindow))

  // 单击 / 双击行为（平台差异）
  if (process.platform === 'darwin') {
    // macOS：单击托盘图标 = 切换主窗口可见性
    trayInstance.on('click', () => toggleWindowVisibility(getMainWindow))
  } else {
    // Windows / Linux：双击显示窗口
    trayInstance.on('double-click', () => toggleWindowVisibility(getMainWindow))
  }

  // 右键点击时刷新菜单（"显示 / 隐藏" 文案需要按当前可见性切换）
  trayInstance.on('right-click', () => {
    trayInstance?.popUpContextMenu(buildMenu(getMainWindow))
  })

  console.log(`[KCoder] Tray created (platform=${process.platform}, locale=${currentLocale})`)
  return trayInstance
}

/**
 * 销毁托盘（退出前调用，避免 macOS 上 app.quit() 后托盘残留）。
 */
export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy()
    trayInstance = null
    console.log('[KCoder] Tray destroyed')
  }
}

/**
 * 切换托盘菜单语言。
 *
 * 由 renderer 在 i18n 切换语言时通过 IPC 通知 main 调用本方法。
 * 重建 ContextMenu 即可生效（无需销毁 Tray 实例）。
 */
export function updateTrayLocale(
  locale: TrayLocale,
  getMainWindow: () => BrowserWindow | null
): void {
  if (!STRINGS[locale]) return
  if (locale === currentLocale && trayInstance) return

  currentLocale = locale
  if (trayInstance) {
    const s = STRINGS[locale]
    trayInstance.setToolTip(s.tooltip)
    trayInstance.setContextMenu(buildMenu(getMainWindow))
    console.log(`[KCoder] Tray locale updated: ${locale}`)
  }
}
