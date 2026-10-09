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
import { BrowserWindow, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron'
import { authLoggedIn, authLogout } from './auth'
import { attachAccountChip } from './account-chip'
import { resolveAsset } from './dsh-contract'
import { dshManager } from './dsh-manager'
import { installUpdate } from './updater'
import { attachUpdateInjector } from './update-injector'
import { attachBrandInjector } from './brand-injector'
import { attachThemeWatcher, applyNativeTheme, overlaySymbolColor, SHELL_TITLEBAR_HEIGHT, themeBackgroundColor } from './theme-watcher'
import { attachSidebarToggle } from './sidebar-toggle'
import { attachClipboardFix } from './clipboard-fix'
import { attachStyleOverlay } from './style-overlay'
import { attachSettingsPage } from './settings-page'
import { attachWorkspaceHeader } from './workspace-header'
import { attachWorkspaceProbe } from './workspace-probe'
import { attachMcpSettingsInjector } from './mcp-settings'
import { attachAboutSettingsInjector } from './about-settings'
import { attachHomeMigrationInjector } from './home-migration'
import { getSettings, saveSettings } from './store'
import { SHELL_PAGE_ORIGIN, hostOriginOf, isShellPageUrl, shellPageUrl } from './shell-protocol-core'

/** dev 模式下 renderer 的 vite 服务地址；生产为 out/renderer 静态文件。 */
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL

/** 预加载脚本绝对路径。 */
const PRELOAD = join(__dirname, '../preload/index.js')

/** 引擎 shell 页单桥 preload（__DSH_HOST_PATHS__；铁律 1 唯一例外，见该文件头）。 */
const HOST_PATHS_PRELOAD = join(__dirname, '../preload/host-paths.js')

let shellWindow: BrowserWindow | null = null
const panels = new Map<string, BrowserWindow>()

/** 协议模式下 shell 当前已加载的侧车 origin（hostOrigin 变化才重载，见下）。 */
let shellLoadedHostOrigin: string | null = null

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
      // 纯浏览器载体：无 node、无 preload、webSecurity 开启。
      // webviewTag：内置浏览器（ui-sidebar-browser）在 Electron 侧用
      // <webview> 承载（上游 apps/desktop/src/main.ts 同样是
      // `webviewTag: primary`）；KCoder 只有 Electron 一种宿主，故开启。
      // guest 的安全面由下面的 will-attach-webview 强制（对齐上游
      // apps/desktop/src/browser-guests.ts 的加固序列）。
      webPreferences: {
        // 铁律 1 的唯一例外（2026-10-09）：host-paths 单桥，只暴露
        // __DSH_HOST_PATHS__（拖/粘文件转 @路径）。data-platform /
        // dshDesktopBoot / window.desktop 等一概不进引擎页——上游 web
        // 形态保持，注入器自持几何的前提；例外边界见该 preload 文件头
        // 与 plans/kcoder-app-protocol.md D3。
        preload: HOST_PATHS_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: true,
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
    // <webview> guest 加固（对齐上游 browser-guests.ts）：主窗口开了
    // webviewTag 之后，渲染进程一旦被注入就能用 webview 提权——这里剥掉
    // 危险偏好并强制安全值。partition 归属留给插件自己（ui-sidebar-browser
    // 按 Workspace 键控存储分区），不在此覆盖。
    shellWindow.webContents.on('will-attach-webview', (_event, preferences) => {
      for (const key of [
        'preload', 'preloadURL', 'nodeIntegration', 'nodeIntegrationInWorker',
        'nodeIntegrationInSubFrames', 'allowRunningInsecureContent', 'webviewTag',
        'plugins', 'navigateOnDragDrop', 'disableDialogs',
      ]) {
        Reflect.deleteProperty(preferences, key)
      }
      Object.assign(preferences, {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        plugins: false,
        navigateOnDragDrop: false,
        disableDialogs: true,
      })
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
    // 装配成 KCoder 外壳窗口：品牌/主题/侧边栏/设置页/状态栏按钮等 18 套
    // 注入器与导航策略。远程窗口走同一个函数，两处不会漂移。
    // 导航守卫的基址：协议层下页面 origin 恒为 kcoder-app://app，Host 地址只活在
    // 主进程转发层，故守卫基址是常量（2026-10-10 legacy 退役，见
    // plans/kcoder-app-protocol.md 阶段 4 第二步）。
    decorateShellWindow(shellWindow, () => SHELL_PAGE_ORIGIN)
  }
  // 已在承载同一 dsh 实例 → 只恢复展示，绝不变相重载整页。
  // macOS 下 dock 点击/Cmd+Tab 切回都会触发 activate → 此函数，
  // 无条件 loadURL 会让每次窗口激活都整页刷新（会话重拉 + 样式
  // 覆盖层/标题栏/徽章延迟重注入的双重闪烁）。
  // dsh 重启端口变化 → 前缀不匹配 → 正常加载新实例（sync 流程）。
  // SPA 内部路由（…/session/xxx）共享同一前缀，不会被误判为外部地址。
  // 加载目标用带启动令牌的入口 URL（alpha.1 BrowserAuth 门禁：首次访问
  // 拿令牌换签名 cookie，303 回 `/`；此后同源请求凭 cookie 通行）。
  //
  // 协议加载是唯一形态（2026-10-10 legacy 退役）：页面 origin 恒为
  // kcoder-app://app，Host 地址只活在主进程转发层，重载判据是
  // 「hostOrigin 变化」——dsh 重启换端口后必须整页重载（HTML 注入的
  // streamBaseUrl 随端口固化，WS 才能重连）；激活/聚焦路径 hostOrigin 不变
  // → 只聚焦。
  {
    const hostOrigin = hostOriginOf(dshUrl)
    if (!isShellPageUrl(shellWindow.webContents.getURL()) || shellLoadedHostOrigin !== hostOrigin) {
      shellLoadedHostOrigin = hostOrigin
      void shellWindow.loadURL(shellPageUrl(SHELL_TITLEBAR_HEIGHT))
    }
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
  if (landing) applyNativeTheme('dark') // landing 可见 ⇒ 原生外观钉深色（含已登录用户从 shell 返回/activate 路径）
  const win = new BrowserWindow({
    width: landing ? 1320 : 720,
    height: landing ? 860 : 560,
    minWidth: landing ? 960 : undefined,
    minHeight: landing ? 640 : undefined,
    title: 'KCoder',
    resizable: landing,
    show: false,
    autoHideMenuBar: true,
    // bootstrap 窗口（landing/splash/setup）恒深底：landing 恒深色，
    // 不随上游 lastTheme 翻转，避免加载期浅色闪底
    backgroundColor: themeBackgroundColor('dark'),
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
  // 主题：showLanding → showBootstrap('landing') 内统一钉深色（唯一闸口）
  showLanding()
}

/** 关闭全部面板窗口（应用退出前）。 */
export function closePanels(): void {
  for (const win of panels.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  panels.clear()
}


/**
 * 承载 dsh Web UI 的窗口共用的外壳选项：隐藏系统标题栏 + 自绘 48px 条
 * （macOS 红绿灯下移到条中心；Windows 用 WCO 原生控制按钮），以及主题底色
 * 与图标。主窗口与远程窗口共用，避免一边有一套、另一边是默认系统标题栏。
 * @returns 可直接展开进 BrowserWindow 构造参数的片段。
 */
export function shellChromeOptions(): BrowserWindowConstructorOptions {
  return {
    backgroundColor: themeBackgroundColor(),
    icon: resolveAsset('icon.png'),
    ...(process.platform === 'darwin' || process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          ...(process.platform === 'darwin'
            ? { trafficLightPosition: { x: 12, y: 18 } }
            : {
                titleBarOverlay: {
                  color: themeBackgroundColor(),
                  symbolColor: overlaySymbolColor(nativeTheme.shouldUseDarkColors),
                  height: SHELL_TITLEBAR_HEIGHT,
                },
              }),
        }
      : {}),
  }
}

/**
 * 把一个承载 dsh Web UI 的窗口装配成 KCoder 外壳窗口。
 *
 * 之所以必须共用：主窗口与远程窗口都是「上游 UI + 宿主注入」，任何一侧漏装
 * 都会立刻表现为「和 KCoder 不一致」——远程窗口第一版就只装了品牌注入，
 * 于是侧边栏、状态栏按钮、设置页、主题跟随全部缺失（2026-09-26 实机）。
 * @param win - 目标窗口（主窗口或某台远程主机的连接窗口）。
 * @param getBaseUrl - 该窗口当前应停留的 dsh 基址（端口会变，须实时取）。
 */
export function decorateShellWindow(win: BrowserWindow, getBaseUrl: () => string): void {
    attachUpdateInjector(win)
    // 品牌化：侧边栏 logo 换 KCoder 标 + 标题产品名替换（零侵入）
    attachBrandInjector(win)
    // 主题跟随：上游 UI 主题切换 → 原生标题栏/菜单栏自适应（零侵入）
    attachThemeWatcher(win)
    // 侧边栏折叠按钮迁移：logoRow 内 toggle 隐藏 → 标题栏红绿灯右侧
    // 注入代理按钮（点击转发上游 toggle.click()，图标随状态克隆；
    // 宿主=自绘标题栏，故注册在 attachThemeWatcher 之后）
    attachSidebarToggle(win)
    // 侧栏开关入口不再由宿主代理：dsh-coding-sidebar 已于 2026-10-09 整线
    // 退役（铁律 1 翻转），右侧工作台交回上游原生——面板开合入口是上游会话头
    // 角位的展开按钮，无需注入（原 sidebar-cluster.ts 代理注入器随之删除，
    // 历史见 docs/ARCHITECTURE.md §12）。
    // 剪贴板写兜底：wrap 页面 navigator.clipboard.writeText，失败（失焦
    // /权限拒绝）兜底主进程 electron.clipboard——上游复制点击的 check
    // 反馈链不再静默断掉（消息泡/代码块全站复制点受益）
    attachClipboardFix(win)
    // 终端不再由 KCoder 承载（2026-10-09）：内置终端插件
    // （@kkutysllb/dsh-terminal，2026-08 起替代宿主 WebContentsView 面板）已整线
    // 退役，终端交回上游原生右侧栏的终端 tab（上一步已解除 ui-sidebar-terminal
    // 禁用）。历史：宿主 terminal-panel.ts/pty-host.ts 2026-08 退役 → 插件化
    // 底部 DOM 面板 → 本次连插件一起退役（plans/retire-terminal-plugin.md）。
    // git 环境面板已退役（2026-08）：由 dsh-git-panel 客户端插件
    // （bundle/dsh-git-panel，dsh client-modules 加载）整体替代——
    // 按钮 right 108 由插件注入，数据走插件自带 webServer RPC
    // 宿主注入 CSS：上游原生外壳压制（右侧栏外壳 + 侧栏「插件」入口）
    // + 空会话 K 水印（零侵入，与排版偏好无关，恒生效；类名/属性改名静默失效）
    attachStyleOverlay(win)
    // 设置页单页化：设置模态浮层 → 铺满窗口两分栏（左 nav + 右内容，
    // 底部让位状态栏；纯 CSS 形态覆盖，行为层全留上游，类改名静默失效）
    attachSettingsPage(win)
    // workspace 顶栏收纳：会话标题/标签/日志按钮迁至状态栏与抽屉，
    // 上游头部隐藏 + 轨迹视图兜底回对话（零侵入，类改名静默失效）
    attachWorkspaceHeader(win)
    // 页面探针：正文文件**类型**徽章（预览/Git 面板删除后独立存续）。
    // 工作区探针（session/list → --dsh-ws-name/--dsh-ws-path → 标题栏工作区名
    // 前缀与按钮）已于 2026-10-10 随用户判定「鸡肋」整体退役。edit 的 +n/−n
    // 统计与历史补拉拦截已于
    // 2026-10-05 退役（与上游 ToolRow 自带 diff 统计重复）；workspace-base
    // 工作区基准与 console 上行已于 2026-10-08 随自建「技能」分区一并
    // 退役——技能设置面整体归 dsh-skills-bundle 1.1.0 的原生设置页
    attachWorkspaceProbe(win)
    // MCP 服务器：设置面板导航列注入「MCP 服务器」分区（列表 + 行内
    // 编辑表单；console 通道 CRUD mcp-store，保存后上游 HMR 热加载）
    attachMcpSettingsInjector(win)
    // 关于：设置面板导航列末尾注入「关于」分区（产品介绍 + 版本信息卡；
    // 版本全部运行时派生：应用元数据/运行时目录/fork 锚点，发布自动同步）
    attachAboutSettingsInjector(win)
    // 数据迁移：设置面板导航列注入「数据迁移」入口（仅老用户未迁移时
    // 出现；整库搬移 ~/.dsh → ~/.kcoder 零重建，完成后旧目录自动移除）
    attachHomeMigrationInjector(win)
    // win32 面板按钮平铺让位已退役（2026-10-09）：它的最后一条规则就是内置终端
    // 插件的按钮（panel-buttons.ts 整模块删除）——宿主自绘标题栏右端现在不再注入
    // 任何按钮，无需让位（历史见该模块的 git 记录与 ARCHITECTURE §4）。
    // 登录账号行：侧边栏底部设置按钮上方（头像 + 账号名，点击弹
    // 设置/退出菜单；零侵入，settingsArea 改名静默失效）
    attachAccountChip(win)
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('kcoder:')) return { action: 'deny' }
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
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
      const current = getBaseUrl()
      if (!url.startsWith(current)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    // dsh Web UI 无需任何浏览器特权。唯一放行：剪贴板写入权限——对话上
    // 「复制」按钮用 navigator.clipboard.writeText，沙箱窗口默认拒绝该
    // 权限会导致复制持续无效果。仅放行 clipboard-sanitized-write，
    // 其余照旧拒绝。
    win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write')
    })
}
