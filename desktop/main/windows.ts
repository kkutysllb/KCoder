/**
 * 窗口层：承载上游 Web UI 的主窗口（shell）+ 桌面端本地页面（bootstrap/面板）。
 *
 * shell 窗口刻意**不注入 preload**——它是上游 Web UI 的纯浏览器载体，
 * 同源 fetch 与 WebSocket 直接命中 dsh 的 API 网关；桌面能力全部经由
 * 独立的面板窗口（带 preload）提供，两者互不污染。
 *
 * @module desktop/main/windows
 */

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, nativeTheme, shell } from 'electron'
import { resolveAsset } from './dsh-contract'
import { dshManager } from './dsh-manager'
import { installUpdate } from './updater'
import { attachUpdateInjector } from './update-injector'
import { attachBrandInjector } from './brand-injector'
import { attachThemeWatcher, overlaySymbolColor, SHELL_TITLEBAR_HEIGHT, themeBackgroundColor } from './theme-watcher'
import { attachStyleOverlay } from './style-overlay'
import { attachWorkspaceHeader } from './workspace-header'
import { attachStatsHover } from './stats-hover'
import { attachPicker } from './attach-picker'
import { attachSessionLogInjector } from './session-log-export'
import { attachStyleSettingsInjector } from './style-settings'
import { attachSkillsSettingsInjector } from './skills-settings'
import { terminalPanel } from './terminal-panel'
import { previewPanel } from './preview-panel'
import { gitPanel } from './git-panel'
import { getSettings, saveSettings } from './store'

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径。 */
const PRELOAD = join(__dirname, '../preload/index.js')

let shellWindow: BrowserWindow | null = null
const panels = new Map<string, BrowserWindow>()

/** 退出意图标志：before-quit 置位后，主窗口 close 不再拦截（hide）。 */
let quitting = false

/** 标记应用进入退出序列（before-quit 首行调用）。 */
export function markQuitting(): void {
  quitting = true
}

/** 供菜单等处引用。 */
export function getShellWindow(): BrowserWindow | null {
  return shellWindow
}

/**
 * 创建（或复用并导航到 dsh URL）shell 窗口。
 * @param dshUrl - dsh web 就绪地址（http://127.0.0.1:<port>）。
 */
export function showShellWindow(dshUrl: string): void {
  if (shellWindow === null || shellWindow.isDestroyed()) {
    const bounds = getSettings().windowBounds
    shellWindow = new BrowserWindow({
      width: bounds?.width ?? 1440,
      height: bounds?.height ?? 900,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'KCoder',
      // 按上次已知主题设底色，页面加载期间不白闪/黑闪
      backgroundColor: themeBackgroundColor(),
      // macOS/Windows：隐藏系统标题栏（macOS 保留红绿灯；Windows 用
      // titleBarOverlay 原生控制按钮——绘制在窗口最上层，不被面板
      // WebContentsView 遮挡，自绘按钮做不到这点）。标题栏本体由
      // theme-watcher 注入自绘拖拽区（VS Code 同款）：颜色直接解析
      // 上游 token 随主题实时变化，拖拽移动原生可用，标题显示
      // document.title（上游 DocumentTitle 投射会话任务标题）。
      // 注：macOS 不用 WCO 覆盖条——它在 macOS 不渲染标题且双击缩放失效。
      ...(process.platform === 'darwin' || process.platform === 'win32'
        ? {
            titleBarStyle: 'hidden' as const,
            ...(process.platform === 'win32'
              ? {
                  titleBarOverlay: {
                    color: themeBackgroundColor(),
                    symbolColor: overlaySymbolColor(nativeTheme.shouldUseDarkColors),
                    height: SHELL_TITLEBAR_HEIGHT,
                  },
                }
              : {}),
          }
        : {}),
      // 官方 DeepSeek 图标（macOS 用 Dock 图标，此项服务 Linux/Windows）
      icon: resolveAsset('icon.png'),
      // 纯浏览器载体：无 node、无 preload、webSecurity 开启
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    shellWindow.once('ready-to-show', () => {
      shellWindow?.maximize()
      shellWindow?.show()
    })
    // Windows：应用菜单（menu.ts 全局设置）会占一行窗口内菜单栏，与
    // 自绘标题栏叠出双栏；隐藏（Alt 临时唤出菜单属系统行为，保留）
    if (process.platform === 'win32') shellWindow.setMenuBarVisibility(false)
    shellWindow.on('resized', persistBounds)
    shellWindow.on('moved', persistBounds)
    // 托盘保活：关主窗口 = 隐藏（dsh 继续跑，SPA 状态保留，重新
    // 打开不重载）；偏好设置页可关。真正退出走 before-quit
    // （markQuitting 置位后放行销毁）
    shellWindow.on('close', (event) => {
      const w = shellWindow
      if (!quitting && w !== null && !w.isDestroyed() && getSettings().keepRunningInTray) {
        event.preventDefault()
        w.hide()
      }
    })
    // 更新下载完成后：侧边栏 logo 旁出现安装按钮（注入器零侵入上游）
    attachUpdateInjector(shellWindow)
    // 品牌化：侧边栏 logo 换 KCoder 标 + 标题产品名替换（零侵入）
    attachBrandInjector(shellWindow)
    // 主题跟随：上游 UI 主题切换 → 原生标题栏/菜单栏自适应（零侵入）
    attachThemeWatcher(shellWindow)
    // 消息样式覆盖层：排版 token/气泡/代码块微调（零侵入，token 改名静默失效）
    attachStyleOverlay(shellWindow)
    // workspace 顶栏收纳：会话标题/标签/日志按钮迁至状态栏与抽屉，
    // 上游头部隐藏 + 轨迹视图兜底回对话（零侵入，类改名静默失效）
    attachWorkspaceHeader(shellWindow)
    // 会话统计图表面板：hover 输入框下方缩略条 → 底部弹出自绘图表
    //（零侵入：拦截该行 hover 压制上游文本 Tooltip）
    attachStatsHover(shellWindow)
    // 附件选择器：drag-to-attachment 插件的模式切换按钮 → 点击改为
    // 打开原生文件对话框（真实路径经插件 fast path 直接入队）
    attachPicker(shellWindow)
    // 会话日志导出：设置面板导航列注入「会话日志」行（fiber 探测当前
    // 会话 → 上游 /api/session.export 下载；Electron 默认弹保存对话框）
    attachSessionLogInjector(shellWindow)
    // 样式设置：设置面板通用区注入密度/列宽方块行（console 通道写回，
    // 偏好设置面板只留桌面特有项）
    attachStyleSettingsInjector(shellWindow)
    // 技能设置：设置面板导航列注入「技能」分区（三来源技能目录 +
    // 行展开正文；console 通道拉目录/正文，白名单读取）
    attachSkillsSettingsInjector(shellWindow)
    // 内嵌终端面板：底部真实终端（pty + xterm），页面探针/按钮注入
    // （按钮宿主是自绘标题栏，darwin/win32 注入；pty-host 平台无关）
    terminalPanel.attach(shellWindow)
    // 文件预览抽屉：右侧 agent 文件活动预览（mux 订阅 + 语法高亮/diff）
    previewPanel.attach(shellWindow)
    // git 环境面板：标题栏按钮 → 右上浮动面板（主进程 git 探测，
    // 工作区跟随 file-activity；按钮宿主同为自绘标题栏）
    gitPanel.attach(shellWindow)
    // 开合/拖宽 → 终端面板收窄让位（回调注入避免循环依赖）
    previewPanel.onLayoutChange = () => terminalPanel.relayout()
    // 右侧停靠互斥：任一面板展示时收起另一个（钩子只在 show 触发，
    // 无环；互斥关闭不算手动关，git 面板保留任务期自动展开资格）
    gitPanel.onShow = () => previewPanel.hide()
    previewPanel.onShow = () => gitPanel.hideByConflict()
    // 只允许停留在 dsh 回环地址；外链交给系统浏览器
    shellWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('kcoder:')) return { action: 'deny' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    shellWindow.webContents.on('will-navigate', (event, url) => {
      // 安装按钮的回调协议：拦下并触发安装，绝不真正导航
      if (url.startsWith('kcoder:')) {
        event.preventDefault()
        if (url === 'kcoder://install-update') void installUpdate()
        return
      }
      // 实时取当前 dsh 地址（dsh 重启端口会变，不能用创建时的闭包值）
      const current = dshManager.status.url ?? dshUrl
      if (!url.startsWith(current)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    // dsh Web UI 无需任何浏览器特权
    shellWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })
  }
  // 已在承载同一 dsh 实例 → 只恢复展示，绝不变相重载整页。
  // macOS 下 dock 点击/Cmd+Tab 切回都会触发 activate → 此函数，
  // 无条件 loadURL 会让每次窗口激活都整页刷新（会话重拉 + 样式
  // 覆盖层/标题栏/徽章延迟重注入的双重闪烁）。
  // dsh 重启端口变化 → 前缀不匹配 → 正常加载新实例（sync 流程）。
  // SPA 内部路由（…/session/xxx）共享同一前缀，不会被误判为外部地址
  if (!shellWindow.webContents.getURL().startsWith(dshUrl)) {
    void shellWindow.loadURL(dshUrl)
  }
  if (shellWindow.isMinimized()) shellWindow.restore()
  if (!shellWindow.isVisible()) shellWindow.show()
  shellWindow.focus()
}

function persistBounds(): void {
  const win = shellWindow
  if (win === null || win.isDestroyed()) return
  saveSettings({ windowBounds: win.getNormalBounds() })
}

/**
 * 打开（或聚焦）一个桌面端本地面板窗口。
 * @param panel - 面板标识，同时是 hash 路由（#/diagnostics 等）。
 * @param title - 窗口标题。
 */
export function openPanel(
  panel: 'setup' | 'diagnostics' | 'sync' | 'plugins' | 'preferences',
  title: string,
): void {
  const existing = panels.get(panel)
  if (existing !== undefined && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 880,
    height: 640,
    title,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: themeBackgroundColor(),
    icon: resolveAsset('icon.png'),
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  panels.set(panel, win)
  win.on('closed', () => panels.delete(panel))
  win.once('ready-to-show', () => win.show())
  const url = RENDERER_URL !== undefined
    ? `${RENDERER_URL}/#/${panel}`
    : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/${panel}`
  void win.loadURL(url)
}

/**
 * 打开 bootstrap 窗口（landing/splash/失败引导）。landing 是桌面端
 * 的首屏，保持到用户主动进入工作台；splash/setup 仍使用紧凑的引导尺寸。
 */
export function showBootstrap(route: 'landing' | 'splash' | 'setup'): BrowserWindow {
  const landing = route === 'landing'
  const win = new BrowserWindow({
    width: landing ? 1320 : 720,
    height: landing ? 860 : 560,
    minWidth: landing ? 960 : undefined,
    minHeight: landing ? 640 : undefined,
    title: 'KCoder',
    resizable: landing,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: themeBackgroundColor(),
    icon: resolveAsset('icon.png'),
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  })
  win.once('ready-to-show', () => {
    if (landing) win.maximize()
    win.show()
  })
  const url = RENDERER_URL !== undefined
    ? `${RENDERER_URL}/#/${route}`
    : `${pathToFileURL(join(__dirname, '../renderer/index.html')).href}#/${route}`
  void win.loadURL(url)
  return win
}

/** 关闭全部面板窗口（应用退出前）。 */
export function closePanels(): void {
  for (const win of panels.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  panels.clear()
}
