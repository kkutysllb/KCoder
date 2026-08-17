/**
 * 更新按钮注入器：下载完成后，在 shell 窗口（上游 Web UI）侧边栏
 * logo 旁显示一个安装按钮。
 *
 * 定位依据（上游 SidebarRoot.tsx + CSS modules）：
 * - logo 行：`<div className={css.logoRow}>` → 编译后类名形如
 *   `SidebarRoot_logoRow_<hash>`，`[class*="logoRow"]` 可稳定匹配；
 * - 收起态（rail）根节点带 `collapsed` 类，brand 字标隐藏、仅剩
 *   toggle；按钮自适应两种宽度。
 *
 * 通信约定：按钮点击 → 导航 `kcoder://install-update` →
 * windows.ts 的 will-navigate 拦截 → updater.installUpdate()。
 * 全程不注入 preload、不修改上游任何代码——shell 保持纯浏览器载体。
 *
 * @module desktop/main/update-injector
 */

import type { BrowserWindow } from 'electron'
import { updateEvents, updateStatus } from './updater'

/** 按钮元素 id（页面内唯一标记）。 */
const BTN_ID = '__dsh_desktop_update_btn'

/**
 * 注入脚本（页面上下文执行）：
 * - 定位侧边栏 logoRow，在其内部追加安装按钮（logo 旁）；
 * - React 重渲染可能移除按钮 → MutationObserver 自愈重插；
 * - 幂等：已存在时不重复插入。
 */
const SHOW_JS = `(() => {
  const ID = ${JSON.stringify(BTN_ID)}
  const inject = () => {
  if (document.getElementById(ID)) return 'present'
  const row = document.querySelector('[class*="logoRow"]')
  if (!row) return 'absent'
  const root = row.closest('[class*="collapsed"]')
  const rail = root !== null
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.id = ID
  btn.title = '安装更新并重启'
  btn.setAttribute('aria-label', '安装更新并重启')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', rail ? '16' : '15')
  svg.setAttribute('height', rail ? '16' : '15')
  svg.innerHTML = '<path d="M8 1.5a1 1 0 0 1 1 1v5.04l1.8-1.8a1 1 0 1 1 1.4 1.42L8.7 10.66a1 1 0 0 1-1.4 0L3.8 7.16a1 1 0 1 1 1.4-1.42L7 7.54V2.5a1 1 0 0 1 1-1Z" fill="currentColor"/><path d="M2.5 12.5a1 1 0 0 1 1-1h9a1 1 0 1 1 0 2h-9a1 1 0 0 1-1-1Z" fill="currentColor"/>'
  btn.append(svg)
  btn.onclick = () => { window.location.assign('kcoder://install-update') }
  const s = btn.style
  s.all = 'unset'
  s.boxSizing = 'border-box'
  s.display = 'inline-flex'
  s.alignItems = 'center'
  s.justifyContent = 'center'
  s.flexShrink = '0'
  s.width = rail ? '28px' : '26px'
  s.height = rail ? '28px' : '26px'
  s.padding = '0'
  s.border = 'none'
  s.borderRadius = '7px'
  s.cursor = 'pointer'
  s.color = 'var(--dsw-alias-accent, #4D6BFE)'
  s.background = 'transparent'
  s.transition = 'background .15s ease'
  btn.addEventListener('mouseenter', () => { s.background = 'color-mix(in srgb, currentColor 12%, transparent)' })
  btn.addEventListener('mouseleave', () => { s.background = 'transparent' })
  row.append(btn)
  // React 重渲染可能丢弃按钮：观察侧边栏区域，被移除即重插
  const mo = new MutationObserver(() => {
    const still = document.getElementById(ID)
    const target = document.querySelector('[class*="logoRow"]')
    if (target === null) return
    if (still === null) target.append(btn)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  window.__dshDesktopUpdateMO = mo // 供 HIDE 时断开，避免自愈逻辑回插
  return 'injected'
  }
  // 立即尝试；侧边栏尚未挂载（插件树加载中）则短轮询，最长 60s
  if (inject() === 'absent') {
    let n = 0
    const t = setInterval(() => {
      const r = inject()
      if (r !== 'absent' || ++n > 120) clearInterval(t)
    }, 500)
  }
})()`

/** 移除注入（未下载/已安装状态下的清理）：断开自愈 observer 再移除按钮。 */
const HIDE_JS = `(() => {
  window.__dshDesktopUpdateMO?.disconnect()
  delete window.__dshDesktopUpdateMO
  document.getElementById(${JSON.stringify(BTN_ID)})?.remove()
})()`

/** 已注入标记（按 webContents.id 记录，避免反复执行 HIDE_JS）。 */
const injected = new Set<number>()

/**
 * 把注入器挂到 shell 窗口：页面加载完成与更新状态变化时同步按钮显隐。
 * 窗口销毁自动清理（executeJavaScript 对销毁窗口是 no-op 风险，先判活）。
 */
export function attachUpdateInjector(win: BrowserWindow): void {
  const sync = (): void => {
    if (win.isDestroyed()) return
    const show = updateStatus().state === 'downloaded'
    if (show) {
      injected.add(win.webContents.id)
      win.webContents.executeJavaScript(SHOW_JS, true).catch(() => {
        // 页面跳转间隙执行失败属正常，下次状态变化/加载会重试
      })
    } else if (injected.has(win.webContents.id)) {
      injected.delete(win.webContents.id)
      win.webContents.executeJavaScript(HIDE_JS, true).catch(() => {})
    }
  }
  win.webContents.on('did-finish-load', sync)
  updateEvents.on('state-changed', sync)
  win.once('closed', () => updateEvents.off('state-changed', sync))
  // 挂接时若已下载完成（窗口晚于状态打开），立即补一次
  sync()
}
