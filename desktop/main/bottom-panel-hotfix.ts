/**
 * better-sidebar 底面板空白热补丁（rc.8/0.1.1-rc.1 基线兼容）。
 *
 * 症状：点击右上角按钮展开底部面板后，大部分时候底部是一条**空白条**——
 * 对话区被 `--dsh-sidebar-height` 挤压上移，但底面板本体看不见（无 tab 栏、
 * 无终端、无内容）。偶发正常。
 *
 * 根因（插件侧，v0.14.0）：底面板把它自己和对话区的相对定位建立在
 * `centerRect` 之上——`#root [data-slot="conversation"]` 的父元素（中心列）
 * 的 `getBoundingClientRect()`。渲染时用它做两件事：
 *
 *   left: centerRect.left
 *   right: window.innerWidth - centerRect.right
 *   visibility: centerRect.right > 0 ? void 0 : "hidden"
 *
 * 一旦插件在底面板展开的那一帧没能把中心列量出来（`[data-slot=
 * "conversation"]` locate 落空 / 测量返回 0 / 该效果在 noSession 或会话切换
 * 间隙未挂载），`centerRect` 停留在初值 `{ left: 0, right: 0 }`，于是
 * `visibility: hidden`——面板整个隐形。但它自己手写的 layout-push 仍把
 * `--dsh-sidebar-height` 写成面板高度，KCoder 的 sidebar-compat 垫片据此给
 * 中心列加 `margin-bottom`，对话区照样上移。结果就是「上移的对话 + 一条
 * 空白的坑」。
 *
 * 为什么偶发：centerRect 的测量挂在 ResizeObserver（中心列尺寸变化）和
 * `documentElement` style 属性的 MutationObserver（htmlStyleWatcher →
 * locate → measureCenter）上。会话/布局稳定时它能自动量对；但在插件自己
 * 标注为「expand slide 在途 / display:none 祖先」的竞态窗口，测量落空后没有
 * 后续信号把它唤醒，面板就停在 hidden。
 *
 * 热补丁思路（零侵入插件本体）：复用插件**自己**的 `documentElement` style
 * 属性突变触发重测的通道——往 `documentElement` 上 set/remove 一个插件从不
 * 读取的自定义属性（`--kcoder-bottom-panel-hotfix-*`），MutationObserver
 * 的 `attributeFilter: ["style"]` 命中，`locate()` 重新跑，`measureCenter()`
 * 把 `centerRect` 量出真实值，React 重渲染，`visibility` 从 hidden 翻回
 * 正常。再叠加一次 `window` resize 事件作为兜底（唤醒任何 rAF/resize 驱动的
 * 重排，含终端 host 的 openWhenSized 轮询）。
 *
 * 原则：
 * - 只在「面板开着但 visibility:hidden」这一明确症状下动作，其余路径零副作用；
 * - 有界重试 + 冷却，量不出或不该动时静默收手，绝不空转/死循环；
 * - 自幂等（window 标志位），页面导航后重新注入；
 * - 平台无关（底面板在所有平台都可能触发，无 darwin/win32 门控）。
 *
 * @module desktop/main/bottom-panel-hotfix
 */

import type { BrowserWindow } from 'electron'

/** 页面上下文注入脚本（零侵入，重复执行安全）。 */
const PAGE_JS = `(() => {
  if (window.__kcoderBottomPanelHotfixWired) return
  window.__kcoderBottomPanelHotfixWired = true

  // 插件从不读取的自定义变量名：仅在 documentElement.style 属性上 make/
  // break 一次属性突变，专门触发插件 htmlStyleWatcher 的 attributeFilter。
  const NUDGE_KEY = '--kcoder-bottom-panel-hotfix'

  // 底面板本体：位于 [data-dsh-panel-host] 内、className 含 bottomPanel 且
  // 不含 bottomPanelHidden（后者是关闭态，不是本次症状）的元素。排除
  // bottomResize（拖拽条）。
  const panelEl = () => {
    const host = document.querySelector('[data-dsh-panel-host]')
    if (host === null) return null
    const nodes = host.querySelectorAll('[class*="bottomPanel"]')
    for (const el of nodes) {
      const cls = el.className || ''
      if (/bottomPanelHidden/.test(cls)) continue
      if (/bottomResize/.test(cls)) continue
      return el
    }
    return null
  }

  // 症状明确判据：底面板「活着」（没挂 bottomPanelHidden）但整块隐形。
  const openButHidden = () => {
    const p = panelEl()
    if (p === null) return false
    return getComputedStyle(p).visibility === 'hidden'
  }

  // 一次 nudge：改 documentElement.style 属性（触发插件 locate→measureCenter）
  // + 发一次 window resize（兜底重排）。
  let seq = 0
  const nudge = () => {
    seq += 1
    try {
      document.documentElement.style.setProperty(NUDGE_KEY, String(seq))
    } catch {}
    try {
      window.dispatchEvent(new Event('resize'))
    } catch {}
    // 下一帧摘掉，保证下次 nudge 仍是「属性真变化」而非同值 no-op。
    requestAnimationFrame(() => {
      try {
        document.documentElement.style.removeProperty(NUDGE_KEY)
      } catch {}
    })
  }

  // 有界看门狗：面板开着但 hidden 时，最多连续 nudge 若干次；期间一旦
  // 不再 hidden（量出来了）立刻收手并复位；达到上限则进入冷却，冷却后再
  // 允许新一轮（面板关闭→再打开时也能再次覆盖到）。
  const MAX_NUDGES = 6
  const COOLDOWN_MS = 2500
  let nudgedInTurn = 0
  let cooling = false
  let coolingTimer = null

  const tick = () => {
    if (cooling) {
      // 冷却结束前不动作，只等计时器复位。
      return
    }
    if (!openButHidden()) {
      // 正常（或已修复）：复位，下次出症状能立刻覆盖。
      nudgedInTurn = 0
      return
    }
    if (nudgedInTurn >= MAX_NUDGES) {
      // 量不出来：收手，进入冷却，避免空转。
      cooling = true
      if (coolingTimer !== null) window.clearTimeout(coolingTimer)
      coolingTimer = window.setTimeout(() => {
        cooling = false
        nudgedInTurn = 0
      }, COOLDOWN_MS)
      return
    }
    nudgedInTurn += 1
    nudge()
  }

  // 低频轮询（500ms）即可：症状本身是「一直停在那儿」的稳定态，不需要
  // 每帧检查；500ms 应答足够让用户察觉空白被点亮。
  const timer = window.setInterval(tick, 500)
  window.addEventListener('beforeunload', () => {
    if (timer !== null) window.clearInterval(timer)
    if (coolingTimer !== null) window.clearTimeout(coolingTimer)
  }, { once: true })
})()`

/**
 * 给 shell 窗口挂底面板空白热补丁（每次整页加载后重新注入；脚本自幂等）。
 * 页面跳转间隙执行失败属正常，下次 did-finish-load 重试。
 */
export function attachBottomPanelHotfix(win: BrowserWindow): void {
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
