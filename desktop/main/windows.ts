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
import { authLoggedIn, authLogout } from './auth'
import { attachAccountChip } from './account-chip'
import { resolveAsset } from './dsh-contract'
import { dshManager } from './dsh-manager'
import { installUpdate } from './updater'
import { attachUpdateInjector } from './update-injector'
import { attachBrandInjector } from './brand-injector'
import { attachThemeWatcher, currentLandingTheme, applyLandingTheme, overlaySymbolColor, SHELL_TITLEBAR_HEIGHT, themeBackgroundColor } from './theme-watcher'
import { attachSidebarToggle } from './sidebar-toggle'
import { attachSidebarCluster } from './sidebar-cluster'
import { attachClipboardFix } from './clipboard-fix'
import { attachContextButton } from './context-button'
import { terminalPanel } from './terminal-panel'
import { gitPanel } from './git-panel'
import { attachStyleOverlay } from './style-overlay'
import { attachSettingsPage } from './settings-page'
import { attachWorkspaceHeader } from './workspace-header'
import { attachStatsHover } from './stats-hover'
import { attachPicker } from './attach-picker'
import { attachWorkspaceProbe } from './workspace-probe'
import { attachStyleSettingsInjector } from './style-settings'
import { attachLanguageSettingsInjector } from './language-settings'
import { attachSkillsSettingsInjector } from './skills-settings'
import { attachMcpSettingsInjector } from './mcp-settings'
import { attachPanelMenu } from './panel-menu'
import { getSettings, saveSettings } from './store'

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径。 */
const PRELOAD = join(__dirname, '../preload/index.js')

let shellWindow: BrowserWindow | null = null
const panels = new Map<string, BrowserWindow>()

/** landing 窗口单例引用（登出后复现，不堆叠窗口）。 */
let landingWindow: BrowserWindow | null = null

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
 * 登录门禁统一闸口：未登录 → 回 landing 登录页（菜单/托盘/IPC/
 * activate 全部入口汇于此，无一绕过）。
 * @param dshUrl - dsh web 就绪地址（http://127.0.0.1:<port>）。
 */
export function showShellWindow(dshUrl: string): void {
  if (!authLoggedIn()) {
    showLanding()
    return
  }
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
            ...(process.platform === 'darwin'
              ? {
                  // macOS hidden 模式红绿灯默认按系统标题栏高度（~28px）
                  // 定位，落在自绘 48px bar 的上半部（中心 ~y10-15）；
                  // 显式下移到 bar 中心（y18-30，灯高 ~12-14px → 中心
                  // ~y24-25），与迁移的折叠按钮（top:50% 居中于 bar）
                  // 垂直对齐——用户反馈"折叠按钮位置不对"即两者不同高。
                  trafficLightPosition: { x: 12, y: 18 },
                }
              : {
                  titleBarOverlay: {
                    color: themeBackgroundColor(),
                    symbolColor: overlaySymbolColor(nativeTheme.shouldUseDarkColors),
                    height: SHELL_TITLEBAR_HEIGHT,
                  },
                }),
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
    // 注入器体系：每个注入器各自在 webContents 挂 did-finish-load /
    // did-stop-loading 监听（十余条，随窗口销毁一同释放），超出
    // EventEmitter 默认上限 10 会刷 MaxListenersExceededWarning——
    // 这里统一抬高上限（0 = 不设限），消除噪音
    shellWindow.webContents.setMaxListeners(0)
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
    // 侧边栏折叠按钮迁移：logoRow 内 toggle 隐藏 → 标题栏红绿灯右侧
    // 注入代理按钮（点击转发上游 toggle.click()，图标随状态克隆；
    // 宿主=自绘标题栏，故注册在 attachThemeWatcher 之后）
    attachSidebarToggle(shellWindow)
    // better-sidebar 开关簇收纳：插件右上开关簇隐藏 → 状态栏注入面板
    // 代理按钮 + 底面板压制看门狗（产品侧弃用插件底面板，见注入器头
    // 注释；宿主=自绘状态栏，故注册在 attachThemeWatcher 之后）
    attachSidebarCluster(shellWindow)
    // 剪贴板写兜底：wrap 页面 navigator.clipboard.writeText，失败（失焦
    // /权限拒绝）兜底主进程 electron.clipboard——上游复制点击的 check
    // 反馈链不再静默断掉（消息泡/代码块全站复制点受益）
    attachClipboardFix(shellWindow)
    // 上下文面板 GUI 入口：状态栏第三枚按钮（插件代理与终端按钮左侧，
    // right 76），点击等价输入框 /context 回车（走 dsh-context input
    // trigger 真实契约，不发送消息）；打开态拉满主页面区域 + 右上角
    // 「返回任务」按钮
    attachContextButton(shellWindow)
    // 内嵌终端面板：底部真实终端（pty + xterm，自研回归——插件底面板
    // agent 运行态黑屏且无唤醒信号，产品侧弃用入口由 sidebar-cluster
    // 压制；按钮 right 44，页面探针/让位注入，多工作区独立视图）
    terminalPanel.attach(shellWindow)
        // git 环境面板：右侧浮动卡片（主进程 git 探测 + 写操作串行队列；
        // 计划文档扫描/子代理轨迹聚合；按钮 right 108——上下文按钮左侧，
        // win32 由 panel-menu 收进下拉菜单；工作区跟随 file-activity）
    gitPanel.attach(shellWindow)
    // 消息样式覆盖层：排版 token/气泡/代码块微调（零侵入，token 改名静默失效）
    attachStyleOverlay(shellWindow)
    // 设置页单页化：设置模态浮层 → 铺满窗口两分栏（左 nav + 右内容，
    // 底部让位状态栏；纯 CSS 形态覆盖，行为层全留上游，类改名静默失效）
    attachSettingsPage(shellWindow)
    // workspace 顶栏收纳：会话标题/标签/日志按钮迁至状态栏与抽屉，
    // 上游头部隐藏 + 轨迹视图兜底回对话（零侵入，类改名静默失效）
    attachWorkspaceHeader(shellWindow)
    // 会话统计图表面板：hover 输入框下方缩略条 → 底部弹出自绘图表
    //（零侵入：拦截该行 hover 压制上游文本 Tooltip）
    attachStatsHover(shellWindow)
    // 附件选择器：drag-to-attachment 插件的模式切换按钮 → 点击改为
    // 打开原生文件对话框（真实路径经插件 fast path 直接入队）
    attachPicker(shellWindow)
    // 工作区探针：选中会话 → workspace.list 解析 → 标题栏工作区名/按钮
    // + file-activity 工作区基准；附带正文文件徽章（类型徽章 + edit
    // 增删行数）与历史会话补拉拦截（预览/Git 面板删除后独立存续）
    attachWorkspaceProbe(shellWindow)
    // 样式设置：设置面板通用区注入密度/列宽/字号方块行（console 通道写回，
    // 偏好设置面板只留桌面特有项）
    attachStyleSettingsInjector(shellWindow)
    // 回答语言：设置面板通用区注入「回答语言」行（跟随模型/强制中文；
    // 写回经 home patch 层热重载即时生效，无需重启引擎）
    attachLanguageSettingsInjector(shellWindow)
    // 技能设置：设置面板导航列注入「技能」分区（三来源技能目录 +
    // 行展开正文；console 通道拉目录/正文，白名单读取）
    attachSkillsSettingsInjector(shellWindow)
    // MCP 服务器：设置面板导航列注入「MCP 服务器」分区（列表 + 行内
    // 编辑表单；console 通道 CRUD mcp-store，保存后上游 HMR 热加载）
    attachMcpSettingsInjector(shellWindow)
    // win32 面板收纳菜单：原生控制按钮区盖住右侧面板按钮，
    // 四枚代理按钮收进一枚下拉菜单（点击转发原按钮，状态实时克隆；
    // 其他平台 no-op 不注入）
    attachPanelMenu(shellWindow)
    // 登录账号行：侧边栏底部设置按钮上方（头像 + 账号名，点击弹
    // 设置/退出菜单；零侵入，settingsArea 改名静默失效）
    attachAccountChip(shellWindow)
    // 只允许停留在 dsh 回环地址；外链交给系统浏览器
    shellWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('kcoder:')) return { action: 'deny' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    shellWindow.webContents.on('will-navigate', (event, url) => {
      // 回调协议：拦下并执行，绝不真正导航。install-update =
      // 更新安装（update-injector）；auth-logout = 登出收场
      // （account-chip 菜单，shell 窗口无 preload 的既有通道）
      if (url.startsWith('kcoder:')) {
        event.preventDefault()
        if (url === 'kcoder://install-update') void installUpdate()
        else if (url === 'kcoder://auth-logout') logoutToLanding()
        return
      }
      // 实时取当前 dsh 地址（dsh 重启端口会变，不能用创建时的闭包值）
      const current = dshManager.status.url ?? dshUrl
      if (!url.startsWith(current)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    // dsh Web UI 无需任何浏览器特权。唯一放行：剪贴板写入权限——对话上
    // 「复制」按钮用 navigator.clipboard.writeText，沙箱窗口默认拒绝该
    // 权限会导致复制持续无效果（drag-to-attachment 插件 copyUserText 静默
    // 吞错）。仅放行 clipboard-sanitized-write，其余照旧拒绝。
    shellWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write')
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

/**
 * landing 窗口单例：已在 → 恢复展示；不在 → 新建（登出后复现、
 * 门禁回退共用；closed 清引用，不堆叠窗口）。启动首屏同样经此入口。
 */
export function showLanding(): BrowserWindow {
  if (landingWindow !== null && !landingWindow.isDestroyed()) {
    if (landingWindow.isMinimized()) landingWindow.restore()
    landingWindow.show()
    landingWindow.focus()
    return landingWindow
  }
  landingWindow = showBootstrap('landing')
  landingWindow.on('closed', () => { landingWindow = null })
  return landingWindow
}

/**
 * 登出收场（IPC 与 workspace 菜单 kcoder://auth-logout 两路共用）：
 * 清会话态 → 收起并卸载工作台页面（hide + about:blank：托盘保活
 * 语义下不销毁窗口；登出用户的会话页不再挂在隐藏窗口里，重登录
 * showShellWindow 全新加载，所有注入器按新账号重跑）→ landing
 * 回到登录表单。
 */
export function logoutToLanding(): void {
  authLogout()
  const shell = getShellWindow()
  if (shell !== null && !shell.isDestroyed()) {
    shell.hide()
    if (!shell.webContents.isDestroyed()) void shell.webContents.loadURL('about:blank')
  }
  // 主题还原：landing 自己的主题选择（页面按钮三档，store 独立字段）。
  // 与上游完全解耦——shell 期间 theme-watcher 钉的什么主题都不落地，
  // 登出后 landing 显示的一律是用户在 landing 上选的档，稳定可预期
  applyLandingTheme(currentLandingTheme())
  showLanding()
}

/** 关闭全部面板窗口（应用退出前）。 */
export function closePanels(): void {
  for (const win of panels.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  panels.clear()
}
