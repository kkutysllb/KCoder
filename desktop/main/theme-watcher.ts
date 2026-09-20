/**
 * 主题跟随：上游 Web UI 的主题切换 → Electron 原生外观自适应。
 *
 * 上游契约（packages/client/ui-theme/src/client/index.ts）：
 * - 深色时 `body` 带 `data-ds-dark-theme` 属性（官方注释：以该字段为准，
 *   "body[data-ds-dark-theme] from this field — never from the id"）；
 * - 同时 `documentElement.style.colorScheme = 'dark' | 'light'`；
 * - 偏好（light/dark/system）持久化在 dsh 服务端 settings（~/.kcoder），
 *   随机端口不丢偏好。
 *
 * 桌面端链路（shell 窗口是纯浏览器载体，无 preload）：
 * 1. 注入观察脚本（MutationObserver）监听上述两处 DOM 变化；
 * 2. 通过 console 通道回传主进程（webContents console-message 事件，
 *    CSP 不影响，零导航开销）：
 *    - `__dsh_theme__:<dark|light>`：解析后的实色，只同步窗口 chrome
 *      （标题栏底色/Windows overlay）——不碰 nativeTheme；
 *    - `__dsh_theme_pref__:<light|dark|system>`：用户偏好档（同源
 *      fetch 首页，解析服务端内嵌的 boot 内联脚本
 *      `const preference = "..."`——上游不把偏好落在 DOM，仅实色），
 *      驱动 `nativeTheme.themeSource` 与持久化。三态语义：选深色就深色、
 *      选浅色就浅色、选跟随系统就跟随系统（实色钉死 themeSource 会丢
 *      掉“跟随系统”档：登出后系统翻转不再跟随）；
 * 3. 主进程 `nativeTheme.themeSource` 同步 → 原生标题栏/红绿灯区域、
 *    菜单栏、Dock 与桌面端面板（prefers-color-scheme）全部自适应；
 * 4. 偏好档持久化到 store，下次启动预置，避免首帧闪烁。
 *
 * @module desktop/main/theme-watcher
 */

import { EventEmitter } from 'node:events'
import { nativeTheme, shell, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { getSettings, saveSettings } from './store'

/** console 通道前缀（与注入脚本约定）：解析后的实色。 */
const THEME_PREFIX = '__dsh_theme__:'
/** console 通道前缀（与注入脚本约定）：用户偏好档（三态）。 */
const THEME_PREF_PREFIX = '__dsh_theme_pref__:'
/** 工作区按钮上行通道（打开工作区目录）。 */
const WS_PREFIX = '__dsh_ws__:'

/**
 * macOS 标题栏高度（Window Controls Overlay 覆盖条）。
 * 48px：容纳六枚 26px 图标按钮与标题的宽松状态栏；页面注入等高
 * padding 下移，保证上游 UI 不被覆盖条遮挡（预览面板 bounds 不
 * 消费此高度：预览全高，按钮 top:50% 自居中）。
 * Windows 同高（titleBarOverlay 控制按钮区高 48px）。
 */
export const SHELL_TITLEBAR_HEIGHT = 48

/**
 * 自绘标题栏的平台差异（注入脚本插值用）：
 * - leftPad：左侧保底（macOS 红绿灯区 78px；Windows 无红绿灯，12px）
 * - padRight：右侧让位给窗口控制按钮（macOS 原生红绿灯在左，0；
 *   Windows 用 titleBarOverlay 原生控制按钮，右段 138px 被系统占用，
 *   标题栏整体加 padding-right 后，面板按钮的 right 定位值不用改）
 */
const TITLEBAR_PLATFORM = {
  darwin: { leftPad: 78, padRight: 0 },
  win32: { leftPad: 12, padRight: 138 },
} as const

/** Windows 控制按钮 overlay 的符号色（随主题在 applyShellChromeTheme 更新）。 */
export function overlaySymbolColor(dark: boolean): string {
  return dark ? '#C9CDD4' : '#57606A'
}

/** 当前平台的自绘标题栏参数（linux 等无自绘标题栏，回退 darwin 值不注入）。 */
const TP = TITLEBAR_PLATFORM[process.platform as keyof typeof TITLEBAR_PLATFORM] ?? TITLEBAR_PLATFORM.darwin

/**
 * 注入脚本（页面上下文）：观察上游主题在 DOM 上的落点并上报。
 * 首次立即上报当前状态；之后任何变化（偏好切换/系统翻转）都会触发。
 */
const WATCH_JS = `(() => {
  if (window.__dshThemeWatched) return
  window.__dshThemeWatched = true
  const report = () => {
    const dark = document.body === null
      ? document.documentElement.style.colorScheme === 'dark'
      : document.body.hasAttribute('data-ds-dark-theme')
        || document.documentElement.style.colorScheme === 'dark'
    console.log('__dsh_theme__:' + (dark ? 'dark' : 'light'))
    reportPref(dark ? 'dark' : 'light')
  }
  // 偏好档探测：上游不把偏好落在 DOM（仅实色），但服务端渲染 index 时
  // 内嵌 boot 内联脚本 const preference = "light|dark|system"
  //（boot-theme.ts，每次请求读持久化值）。同源 fetch 首页解析即可。
  // 一致性门：点主题时上游先乐观翻 DOM、后异步持久化，紧跟的 fetch 会
  // 读到持久化前的旧偏好——直接上报会把主进程的 themeSource/overlay
  // 打回上一档（0.6.1 Windows 实测点击深色按钮区变浅、点浅变深的反转
  // 根因）。偏好必须与当前实色自洽（system 恒自洽），不一致延迟重读等
  // 持久化落盘；失败静默，下次变化重试
  const reportPref = (concrete, attempt) => {
    // 必须保留 ?token= 查询串：相对路径 './' 会把 query 丢掉，服务端
    // 401 后偏好永远无法上报，nativeTheme 停留在上次手动实色，
    // 「跟随系统」档随之失效（0.5.9 实测根因，Windows 未复现只是
    // 因为该机 themeSource 恰好未被手动实色钉死）
    fetch(location.pathname + location.search, { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        const m = /const[ \\t]+preference[ \\t]*=[ \\t]*"(light|dark|system)"/.exec(html)
        if (m === null) return
        if (m[1] !== 'system' && m[1] !== concrete) {
          if ((attempt || 0) < 3) setTimeout(() => reportPref(concrete, (attempt || 0) + 1), 500)
          return
        }
        console.log('__dsh_theme_pref__:' + m[1])
        // 偏好档顺手落 DOM，供页面内注入器读取：账号菜单的主题子菜单要标出
        // 「跟随系统/浅色/深色」当前是哪一档，而上游只把实色落 DOM、偏好档
        // 原本仅上报主进程。复用此处已解析好的值，不额外抓取。
        document.documentElement.dataset.kcoderThemePref = m[1]
      })
      .catch(() => {})
  }
  new MutationObserver(report).observe(document.documentElement, {
    attributes: true, attributeFilter: ['style'],
  })
  const watchBody = () => {
    if (document.body !== null) {
      new MutationObserver(report).observe(document.body, {
        attributes: true, attributeFilter: ['data-ds-dark-theme'],
      })
      report()
    } else {
      requestAnimationFrame(watchBody)
    }
  }
  watchBody()
})()`

/** 当前应使用的原生外观（启动时 = 上次已知渲染主题）。 */
export function currentThemePref(): 'system' | 'light' | 'dark' {
  return getSettings().lastTheme
}

/** 当前 landing 页面主题选择（页面按钮三态循环，与上游解耦）。 */
export function currentLandingTheme(): 'system' | 'light' | 'dark' {
  return getSettings().landingTheme
}

/** 主题变化事件面（终端面板等跟随原生外观的组件订阅）。 */
export const themeEvents = new EventEmitter()

/** 驱动原生外观：themeSource + 事件（不写盘，持久化由调用方定）。 */
function driveNativeTheme(pref: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = pref
  themeEvents.emit('theme-changed', pref)
}

/** 已挂主题观察的 shell 窗口（系统翻转时的 chrome 重同步面）。 */
const watchedShellWindows = new Set<BrowserWindow>()
/** 各 shell 窗口最近一次算出的 Windows overlay 参数（focus/restore 重放用）。 */
const lastOverlay = new WeakMap<BrowserWindow, { color: string; symbolColor: string; height: number }>()
let nativeThemeHooked = false

/** shell 链路主题应用：上游实色/偏好档 → themeSource + lastTheme 持久化（变化才写盘）。 */
export function applyNativeTheme(pref: 'system' | 'light' | 'dark'): void {
  driveNativeTheme(pref)
  if (getSettings().lastTheme !== pref) saveSettings({ lastTheme: pref })
}

/** landing 主题应用：页面按钮选择 → themeSource + landingTheme 持久化。 */
export function applyLandingTheme(pref: 'system' | 'light' | 'dark'): void {
  driveNativeTheme(pref)
  if (getSettings().landingTheme !== pref) saveSettings({ landingTheme: pref })
}

/**
 * 把主题观察器挂到 shell 窗口：
 * - did-finish-load 注入观察脚本（每次导航后重新注入，脚本自幂等）；
 * - console-message 过滤通道前缀 → 同步 nativeTheme。
 */
export function attachThemeWatcher(win: BrowserWindow): void {
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (message.startsWith(THEME_PREFIX)) {
      const value = message.slice(THEME_PREFIX.length)
      if (value === 'dark' || value === 'light') {
        // 实色只同步窗口 chrome（即时，无网络等待）；nativeTheme 由
        // 偏好档通道驱动（三态），实色钉死会丢“跟随系统”档
        applyShellChromeTheme(win, value)
      }
      return
    }
    if (message.startsWith(THEME_PREF_PREFIX)) {
      const value = message.slice(THEME_PREF_PREFIX.length)
      if (value === 'system' || value === 'light' || value === 'dark') {
        // 偏好档只驱动 nativeTheme（三态/跟随系统语义）。窗口 chrome 一律
        // 跟随实色通道（DOM 权威，且每次偏好上报前都伴随实色上报）：
        // 拿偏好画 chrome 会与实色赛跑——乐观更新期间读到旧偏好就会把
        // overlay 打回上一档（0.6.1 深↔浅反转根因）；跟随系统档的系统
        // 翻转由下方 nativeTheme 'updated' 重同步兜底
        applyNativeTheme(value)
      }
      return
    }
    // 工作区按钮：打开工作区目录（Finder/资源管理器；路径来自
    // workspace-probe 写入的 --dsh-ws-path，非任意输入）
    if (message.startsWith(WS_PREFIX)) {
      try {
        const payload = JSON.parse(message.slice(WS_PREFIX.length)) as { action?: unknown; path?: unknown }
        if (payload.action === 'reveal' && typeof payload.path === 'string' && payload.path !== '') {
          void shell.openPath(payload.path)
        }
      } catch { /* 非 JSON 忽略 */ }
    }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    // 自绘标题栏 + 页面下移仅 darwin/win32（titleBarStyle:'hidden' 只在
    // 这两平台启用，Linux 保留系统标题栏，注入会造成双标题栏）；
    // 上游 html/body/#root 均 height:100%，padding 下移不溢出
    if (process.platform === 'darwin' || process.platform === 'win32') {
      webContents.executeJavaScript(SHELL_TITLEBAR_JS, true).catch(() => {})
    }
    webContents.executeJavaScript(WATCH_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  watchedShellWindows.add(win)
  // Windows：主题切换发生在窗口后台时（用户在系统设置里切主题），
  // setTitleBarOverlay 会被 DWM 丢弃且定时重放也一并丢掉；回前台时用
  // 最近一次算出的参数整体重放，是唯一可靠的补画时机
  if (process.platform === 'win32') {
    const replayOverlay = (): void => {
      const overlay = lastOverlay.get(win)
      if (overlay === undefined) return
      try { win.setTitleBarOverlay(overlay) } catch { /* 窗口销毁竞态 */ }
    }
    win.on('focus', replayOverlay)
    win.on('restore', replayOverlay)
    win.on('show', replayOverlay)
  }
  win.once('closed', () => {
    watchedShellWindows.delete(win)
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
  })
  // 跟随系统档：OS 外观翻转不产生页面导航，chrome 底色在主进程侧
  // 主动重同步（页面 DOM 由上游 prefers-color-scheme 自行翻转）
  if (!nativeThemeHooked) {
    nativeThemeHooked = true
    nativeTheme.on('updated', () => {
      if (currentThemePref() !== 'system') return
      for (const w of watchedShellWindows) applyShellChromeTheme(w, 'system')
    })
  }
}

/**
 * 按主题给出标题栏/窗口底色（取上游精确 token：sidebar-fill）。
 * 标题栏左半下方是侧边栏、右半是对话区（bg-base，与 sidebar 仅差
 * Δ6，人眼不可辨）：
 * - 深：--dsw-static-neutral-bluish-900 = rgb(27,27,28)
 * - 浅：--dsw-static-neutral-bluish-50 = rgb(249,250,251)
 */
export function themeBackgroundColor(pref: 'system' | 'light' | 'dark' = getSettings().lastTheme): string {
  if (pref === 'light') return '#F9FAFB'
  if (pref === 'dark') return '#1B1B1C'
  return nativeTheme.shouldUseDarkColors ? '#1B1B1C' : '#F9FAFB'
}

/**
 * 自绘标题栏（页面上下文）：替代系统标题栏（WCO 覆盖条在 macOS 不渲染
 * 标题且双击缩放失效，故齐弃）。VS Code 同款方案：
 * - `-webkit-app-region: drag` 拖拽区 → 原生拖动与双击缩放；
 * - 靠左显示「工作区 / 会话标题 〔预设〕」：主文本是 document.title
 *   （上游 DocumentTitle 投射“会话标题 — 产品名”）；工作区前缀由
 *   workspace-probe 探测（workspace.list RPC + 会话配对）写入
 *   --dsh-ws-name，并做成实体按钮（文件夹图标，点击打开工作区目录；
 *   路径读 --dsh-ws-path，上报 __dsh_ws__ 通道由主进程 shell.openPath
 *   执行），agent 预设徽章读 --dsh-agent-preset（workspace-header
 *   读取被收纳的 AgentPresetLabel 文本写入）；两变量均由 apply()
 *   读取拼接（写入方与本脚本互不依赖，通道同 --dsh-sidebar-w；
 *   style 变化会触发既有 observer 重渲染），
 *   起排在中间会话列左缘（侧边栏右边线 + 12px，探测 sidebarCol 实时
 *   广播为 --dsh-sidebar-w，拖宽/折叠动画平滑跟随；侧边栏收起时保底
 *   左侧让位区）；--dsh-titlebar-extra-left（折叠按钮迁移注入器
 *   sidebar-toggle 设置 = 最右按钮右缘 + 间距 8，当前最右即折叠按钮；
 *   排布自 2026-09-20 起为 左箭头/右箭头/折叠）叠加上最小让位，收起态
 *   标题不与红绿灯右侧这串按钮重叠）；max-width 自适应避让：右侧取
 *   按钮带（134px = 四枚 26px 按钮：侧栏面板 12/内嵌终端 44/上下文 76/
 *   git 108px 序——终端由 dsh-terminal、git 面板由 dsh-git-panel
 *   插件 client 注入，上下文入口见 context-button；Windows 另加 padRight
 *   让位原生控制按钮区），长标题省略号截断；
 * - 背景直接解析上游 token `--dsw-specific-sidebar-fill`（body 计算值），
 *   随上游主题切换实时正确，无需主进程回传；
 * - body 注入等高 padding，上游 UI 下移不被遮挡；
 * - 观察 title 变化与主题落点变化，幂等。与 WATCH_JS 共用观察点，
 *   各自独立上报互不干扰。
 */
const SHELL_TITLEBAR_JS = `(() => {
  const ID_BAR = '__dsh_desktop_titlebar'
  const ID_PAD = '__dsh_desktop_titlebar_pad'
  const H = ${SHELL_TITLEBAR_HEIGHT}
  // 宿主标题栏高度声明（上游侧边栏类插件的 URL 契约参数
  // dsh-desktop-titlebar-inset）：就绪 URL 带 ?token= 时 BrowserAuth 会
  // 303 跳到干净 /，查询串被洗掉——这里在页面加载即补回，且尽量早于
  // 插件首次渲染（插件的 desktop-env 有模块级缓存，晚了就吃不到）。
  // 消费方按它把开关簇/面板顶边让到自绘状态栏之下（否则被 z 顶层的
  // 拖拽条整块盖住、点不动——2026-09-19 现场）。
  try {
    const u = new URL(window.location.href)
    if (u.searchParams.get('dsh-desktop-titlebar-inset') !== String(H)) {
      u.searchParams.set('dsh-desktop-titlebar-inset', String(H))
      window.history.replaceState(null, '', u.pathname + u.search + u.hash)
    }
  } catch { /* 契约参数缺席时插件退回自身设置（WCO/设置块），不抛错 */ }
  if (document.getElementById(ID_BAR)) return
  const pad = document.createElement('style')
  pad.id = ID_PAD
  pad.textContent = 'body{padding-top:' + H + 'px;box-sizing:border-box}'
  document.head.append(pad)

  const bar = document.createElement('div')
  bar.id = ID_BAR
  bar.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:' + H + 'px',
    'padding-right:${TP.padRight}px',
    'z-index:2147483647',
    '-webkit-app-region:drag',
    'display:flex', 'align-items:center', 'justify-content:flex-start',
    'font:500 13px -apple-system,"PingFang SC","Segoe UI",sans-serif',
    'user-select:none',
  ].join(';')
  // 双段结构：工作区前缀（弱化色，含 " / " 分隔）+ 标题主体（省略号
  // 打在标题尾部；工作区自身过长独立截断）。flex 子项内 ellipsis 需
  // min-width:0；label 自身改 flex 容器后单行省略号下沉到子 span
  const label = document.createElement('span')
  label.style.cssText = [
    'flex:0 1 auto',
    'margin-left:max(calc(${TP.leftPad}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px)',
    'max-width:calc(100% - max(calc(${TP.leftPad}px + var(--dsh-titlebar-extra-left, 0px)), var(--dsh-sidebar-w, 0px) + 12px) - ${134 + TP.padRight}px)',
    'display:flex', 'align-items:center', 'min-width:0', 'white-space:nowrap',
  ].join(';')
  // 工作区段：实体按钮（文件夹图标 + 名字；点击打开工作区目录）。
  // no-drag 使拖拽区内的点击可达；hover 靠下方注入的 style 规则
  const wsBtn = document.createElement('button')
  wsBtn.id = '__dsh_ws_btn'
  wsBtn.style.cssText = [
    'all:unset', 'box-sizing:border-box', 'flex:none', 'display:inline-flex', 'align-items:center', 'gap:5px',
    'max-width:240px', 'min-width:0', 'padding:3px 7px', 'border-radius:7px',
    'cursor:pointer', '-webkit-app-region:no-drag',
  ].join(';')
  const wsIco = document.createElement('span')
  wsIco.style.cssText = 'flex:none;display:inline-flex;width:16px;height:16px'
  wsIco.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 4.4c0-.7.6-1.3 1.3-1.3h2.8c.4 0 .8.2 1 .5l1 1.1h3.9c.7 0 1.3.6 1.3 1.3v5.6c0 .7-.6 1.3-1.3 1.3H3.1c-.7 0-1.3-.6-1.3-1.3V4.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>'
  const wsName = document.createElement('span')
  wsName.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;line-height:1;display:block'
  wsBtn.append(wsIco, wsName)
  const wsSep = document.createElement('span')
  wsSep.style.cssText = 'flex:none;font-weight:400'
  wsSep.textContent = ' / '
  // 点击 → 上报主进程打开目录（路径在 apply() 从 --dsh-ws-path 刷进 dataset）
  wsBtn.onclick = () => {
    const p = wsBtn.dataset.path || ''
    if (p === '') return
    console.log('__dsh_ws__:' + JSON.stringify({ action: 'reveal', path: p }))
  }
  const ttlTag = document.createElement('span')
  ttlTag.style.cssText = 'flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis'
  // agent 预设标记：小徽章（上游 AgentPresetLabel 本显示在会话标题旁，
  // 随顶栏收纳迁到这里；workspace-header 读 headerActions 写变量）。
  // inline-flex + line-height:1：文本 10px 但行盒继承 13px 字号的
  // normal 行高，不压行盒则文本在徽章内偏上、徽章在标题行里偏移
  const presetTag = document.createElement('span')
  presetTag.style.cssText = 'flex:none;display:inline-flex;align-items:center;line-height:1;max-width:150px;overflow:hidden;text-overflow:ellipsis;margin-left:9px;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:500;letter-spacing:.2px;background:color-mix(in srgb,currentColor 12%,transparent);opacity:.82;cursor:default'
  label.append(wsBtn, wsSep, ttlTag, presetTag)
  bar.append(label)

  // 工作区按钮 hover/图标（cssText 设不了 :hover/后代选择器，注入规则）。
  // svg 16px + display:block + translateY(.5px)：块化消除基线间隙，
  // 微下移补字体字形光学中心偏下（flex 只对齐几何盒中心，
  // 13px 字在行盒内视觉中心偏低，不补则图标显得略高）
  const wsStyle = document.createElement('style')
  wsStyle.textContent = [
    '#__dsh_ws_btn{transition:background .12s ease}',
    '#__dsh_ws_btn:hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#__dsh_ws_btn svg{width:16px;height:16px;display:block;transform:translateY(.5px)}',
  ].join('')
  document.head.append(wsStyle)

  /* 侧边栏右边线探测：标题起排跟随（与终端/预览面板的 sidebarCol
     探针同款；SPA 首帧可能未挂，rAF 轮询等待）。宽度写为 CSS 变量，
     上面 margin/max-width 纯 CSS 消费，拖宽/折叠动画实时重算 */
  const watchSidebarCol = () => {
    const el = document.querySelector('[class*="sidebarCol"]')
    if (el == null) { requestAnimationFrame(watchSidebarCol); return }
    const push = () => {
      document.documentElement.style.setProperty(
        '--dsh-sidebar-w', Math.round(el.getBoundingClientRect().width) + 'px')
    }
    new ResizeObserver(push).observe(el)
    push()
  }
  watchSidebarCol()

  const apply = () => {
    let color = ''
    try { color = getComputedStyle(document.body).getPropertyValue('--dsw-specific-sidebar-fill').trim() } catch {}
    const dark = document.body.hasAttribute('data-ds-dark-theme')
      || document.documentElement.style.colorScheme === 'dark'
    bar.style.background = color || (dark ? '#1B1B1C' : '#F9FAFB')
    label.style.color = dark ? 'rgba(232,234,237,.9)' : 'rgba(26,29,33,.75)'
    let ws = ''
    try { ws = getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-name').trim() } catch {}
    let wsp = ''
    try { wsp = getComputedStyle(document.documentElement).getPropertyValue('--dsh-ws-path').trim() } catch {}
    wsName.textContent = ws
    wsBtn.dataset.path = wsp
    wsBtn.title = wsp !== '' ? '打开工作区目录：' + wsp : ''
    // 恢复显示必须写回 inline-flex：置 '' 会清除 cssText 里的 display，
    // 残留的 all:unset 把按钮打回 inline，文字掉到第二行
    wsBtn.style.display = ws !== '' ? 'inline-flex' : 'none'
    wsSep.style.display = ws !== '' ? '' : 'none'
    ttlTag.textContent = (document.title || '').trim() || 'KCoder'
    let preset = ''
    try { preset = getComputedStyle(document.documentElement).getPropertyValue('--dsh-agent-preset').trim() } catch {}
    presetTag.textContent = preset
    presetTag.style.display = preset !== '' ? '' : 'none'
  }
  /* 主题异步落定自愈：@property 过渡/上游延迟落色时，突变瞬间读到的
     可能还是旧值，而过渡本身不再产生 DOM 变化——每次变化后 120/400ms
     各重读重画一次兜底。主进程在主题事件时也会经 __dshTitlebarApply
     poke 本函数；deep→浅→深卡浅色（Windows 打包版实测）由此治愈 */
  let settleTimers = []
  const applyWithSettle = () => {
    apply()
    for (const t of settleTimers) clearTimeout(t)
    settleTimers = [120, 400].map((d) => setTimeout(apply, d))
  }
  window.__dshTitlebarApply = applyWithSettle
  // 跟随系统档的系统翻转可以不经过上游 DOM 属性，媒体查询直达
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyWithSettle) } catch {}

  const mount = () => {
    document.body.append(bar)
    applyWithSettle()
    new MutationObserver(applyWithSettle).observe(document.documentElement, {
      attributes: true, attributeFilter: ['style', 'class'],
    })
    new MutationObserver(applyWithSettle).observe(document.body, {
      attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'],
    })
    const titleEl = document.querySelector('title')
    if (titleEl) new MutationObserver(applyWithSettle).observe(titleEl, {
      childList: true, characterData: true, subtree: true,
    })
  }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount, { once: true })
})()`

/**
 * 同步 shell 窗口的窗口底色（加载间隙不闪色）。标题栏颜色由注入的
 * 自绘标题栏直接解析上游 token，不经过主进程。
 */
export function applyShellChromeTheme(win: BrowserWindow, pref: 'system' | 'light' | 'dark'): void {
  if (win.isDestroyed()) return
  win.setBackgroundColor(themeBackgroundColor(pref))
  // Windows：titleBarOverlay 原生控制按钮区（最小化/最大化/关闭）随
  // 主题同步底色与符号色（创建时经 options 预置，主题切换后这里刷新）
  if (process.platform === 'win32') {
    const dark = pref === 'system' ? nativeTheme.shouldUseDarkColors : pref === 'dark'
    const overlay = {
      color: themeBackgroundColor(pref),
      symbolColor: overlaySymbolColor(dark),
      height: SHELL_TITLEBAR_HEIGHT,
    }
    // Windows 已知问题：深→浅→深连续切换时，后续 setTitleBarOverlay
    // 可能被 DWM 丢弃（切主题时本窗口通常在后台，是最常见的丢弃场景；
    // 窗口回前台也不重放，overlay 就卡死到重启）。立即一次 + 250/800ms
    // 两次幂等重放；窗口 focus/restore/show 时再整体重放（见
    // attachThemeWatcher），覆盖后台丢弃的所有时序
    try { win.setTitleBarOverlay(overlay) } catch { /* 窗口销毁竞态 */ }
    for (const delay of [250, 800]) {
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.setTitleBarOverlay(overlay)
        } catch { /* 同上 */ }
      }, delay)
    }
    lastOverlay.set(win, overlay)
    // 自绘标题栏条（页面 div）的自愈：主题落点变化后上游 CSS 变量可能
    // 异步落定（@property 过渡等），让页面在 120/400ms 后各重读重画一次；
    // 主进程只在主题事件时 poke，平时由页面自身的观察器驱动
    try {
      void win.webContents.executeJavaScript(
        'window.__dshTitlebarApply && window.__dshTitlebarApply()', true,
      ).catch(() => {})
    } catch { /* webContents 已销毁 */ }
  }
}
