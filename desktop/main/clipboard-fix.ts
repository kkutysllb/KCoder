/**
 * 剪贴板写兜底 + 复制点击弱反馈（零侵入注入器）：上游
 * writeClipboard（ui-primitives clipboard.ts）依赖
 * navigator.clipboard.writeText，失败（Chromium 剪贴板权限 /
 * document 失焦 / iframe 策略）时静默 return false——上游自带的
 * copied 反馈链（check 图标换 1s）随之断掉，用户看到点了没反应
 * （且可能根本没复制上）。Electron 多 WebContentsView 场景（终端/
 * git 面板持有焦点时回页面点复制）正是失焦 reject 的高发环境。
 *
 * 两层修：
 * 1. 修根：wrap 页面 navigator.clipboard.writeText——原生路径成功
 *    照旧（零开销）；reject 兜底走 console 通道 __dsh_clip__: →
 *    主进程 electron.clipboard.writeText（系统剪贴板，无页面焦点/
 *    权限门槛）并吞掉 rejection。上游拿到恒 resolve → return true。
 *    全站复制点（消息泡/代码块等 writeClipboard 调用方）一次受益；
 * 2. 弱反馈（自绘，不依赖上游 copied 链是否走通）：复制按钮
 *    （aria-label zh「复制」/en "Copy" 整词匹配，用户/助手消息泡
 *    与代码块同词典）点击 → 图标短暂变绿 1.2s + 按钮上方「已复制」
 *    弱文字浮标 1.5s（fixed 挂 body 不碰上游样式，随主题双套色）。
 *    writeText 已恒成功，点击即反馈与真实复制结果一致。
 *
 * 契约面：仅 navigator.clipboard.writeText 函数签名（Web 标准面）与
 * console 通道前缀；上游 writeClipboard 的调用方式（await 后按返回值
 * 分支）是其公开源码行为。navigator.clipboard 整体缺席（非 secure
 * context）时本 wrap 不生效，上游落 execCommand 兜底——KCoder 上游
 * 页面恒为 http://localhost（secure），该场景不出现。
 *
 * @module desktop/main/clipboard-fix
 */
import { clipboard, type BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'

/** console 通道前缀（与注入脚本约定；payload = JSON { text }）。 */
const CLIP_PREFIX = '__dsh_clip__:'

/** 页面注入脚本（上游 shell 页面上下文）。 */
const PAGE_JS = `(() => {
  if (window.__dshClipFixWired) return
  window.__dshClipFixWired = true
  const clip = navigator.clipboard
  if (clip != null && typeof clip.writeText === 'function') {
    const native = clip.writeText.bind(clip)
    // 恒 resolve：失败兜底主进程系统剪贴板（console 通道），调用方
    // （上游 writeClipboard）按 resolve 判成功，反馈链走完
    clip.writeText = (text) => native(text).catch(() => {
      console.log('${CLIP_PREFIX}' + JSON.stringify(String(text)))
    })
  }

  /* ---- 点击弱反馈（自绘，不依赖上游 copied 链）----
     复制按钮 aria-label 走上游词典（zh「复制」/en "Copy" 整词）；
     反馈 = 图标短暂变绿 + 按钮上方「已复制」弱文字浮标（fixed 挂
     body，不碰上游按钮样式；同屏只一枚，1.5s 消失）。writeText 已
     wrap 恒成功，点击即反馈与真实复制结果一致。 */
  const TIP_CLS = '__dsh_copied_tip'
  const ON_CLS = '__dsh_copied_on'
  const css = document.createElement('style')
  css.id = '__dsh_desktop_clipfix_style'
  css.textContent = [
    '.' + ON_CLS + '{color:#1F883D !important}',
    'body[data-ds-dark-theme] .' + ON_CLS + '{color:#3FB950 !important}',
    '.' + TIP_CLS + '{position:fixed;z-index:2147483647;pointer-events:none;transform:translate(-50%,-100%);padding:2px 8px;border-radius:6px;background:rgba(31,136,61,.12);color:#1F883D;font:500 12px/18px -apple-system,"PingFang SC",sans-serif;white-space:nowrap}',
    'body[data-ds-dark-theme] .' + TIP_CLS + '{background:rgba(63,185,80,.16);color:#3FB950}',
  ].join('')
  document.head.append(css)
  document.addEventListener('click', (ev) => {
    const el = ev.target instanceof Element ? ev.target : null
    const btn = el !== null ? el.closest('button') : null
    if (btn === null) return
    const label = btn.getAttribute('aria-label') || ''
    if (label !== '复制' && label !== 'Copy') return
    btn.classList.add(ON_CLS)
    setTimeout(() => btn.classList.remove(ON_CLS), 1200)
    const old = document.querySelector('.' + TIP_CLS)
    if (old !== null) old.remove()
    const r = btn.getBoundingClientRect()
    const tip = document.createElement('span')
    tip.className = TIP_CLS
    tip.textContent = '已复制'
    tip.style.left = (r.left + r.width / 2) + 'px'
    tip.style.top = (r.top - 6) + 'px'
    document.body.append(tip)
    setTimeout(() => tip.remove(), 1500)
  }, true)
})()`

/**
 * 挂到 shell 窗口：did-finish-load 注入 wrap（每次导航重注入，脚本自
 * 幂等）；console 通道监听系统剪贴板写入。全平台（无状态栏依赖，
 * Linux 同样受益）。
 */
export function attachClipboardFix(win: BrowserWindow): void {
  const { webContents } = win
  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith(CLIP_PREFIX)) return
    try {
      const payload = JSON.parse(message.slice(CLIP_PREFIX.length)) as { text?: unknown }
      if (typeof payload.text === 'string') clipboard.writeText(payload.text)
    } catch { /* 非 JSON 忽略 */ }
  }
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('console-message', onConsole)
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
