/**
 * 会话日志导出注入器，两个入口共用同一导出链路：
 * - 状态栏按钮（宿主 __dsh_desktop_titlebar，right:108px，在预览/
 *   轨迹按钮左侧）——workspace 顶栏收纳（上游按钮随 headerUtilities
 *   隐藏）后的常驻快捷入口；
 * - 设置面板导航列的「会话日志」行——上游 Session Header「Session
 *   log」下载的设置页入口化（保留）。
 *
 * 上游契约（零侵入、只读）：
 * - 设置面板：SettingsRoot.tsx 的 overlay > panel[role="dialog"] >
 *   nav > [class*="navList"] > button[class*="navCell"]（CSS modules
 *   哈希前缀不影响语义匹配；注入行克隆现有 navCell/navLabel 类名，
 *   hover/布局样式与上游一致）；
 * - 面板是模态的：打开期间会话固定，注入时探测一次即够；
 * - 导出路由：GET /api/session.export?sessionId=…&includeDescendants=true
 *   （同 Session Header 按钮；HEAD 预检后 anchor 下载，zip 文件名约定
 *   dsh-session-<id>.zip——session-log-export controller.ts 同款）；
 * - 当前会话 id：选中行 [role="treeitem"][aria-selected] 的 React fiber
 *   props.node.id（同 terminal-panel 探测契约；blank 新会话行跳过）。
 *
 * 下载行为：shell 无 preload、纯浏览器载体，anchor 下载交给 Electron
 * will-download（桌面壳未设 downloadPath → 弹原生保存对话框，可选位置）。
 *
 * @module desktop/main/session-log-export
 */

import type { BrowserWindow } from 'electron'

/** 注入脚本（页面上下文执行；纯 JS：模板字符串内禁 TS 注解）。 */
const PAGE_JS = `(() => {
  if (window.__dshSessionLogWired) return
  window.__dshSessionLogWired = true

  const ROW_ID = '__dsh_desktop_session_log_row'

  /* 当前选中会话（fiber 探测；DOM/URL 均不暴露会话 id） */
  const probeSession = () => {
    const rows = document.querySelectorAll('[role="treeitem"][aria-selected="true"]')
    for (const el of rows) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
      let fiber = fiberKey !== undefined ? el[fiberKey] : null
      while (fiber != null) {
        const node = fiber.memoizedProps != null ? fiber.memoizedProps.node : null
        if (node != null && typeof node.id === 'string' && node.blank !== true) {
          return { id: node.id, title: typeof node.title === 'string' ? node.title : '' }
        }
        fiber = fiber.return
      }
    }
    return null
  }

  const sessionLabel = (s) => {
    if (s == null) return null
    return s.title !== '' ? s.title : s.id.slice(0, 12)
  }

  /* 导出：HEAD 预检 + anchor 下载（上游 controller.run 同款）；结果经
     onDone(ok, text) 回调——设置行写 span、状态栏按钮换图标 */
  const exportSession = async (session, onDone) => {
    const url = '/api/session.export?sessionId=' + encodeURIComponent(session.id)
      + '&includeDescendants=true'
    try {
      const resp = await fetch(url, { method: 'HEAD' })
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const a = document.createElement('a')
      a.href = url
      a.download = 'dsh-session-' + String(session.id).replace(/[^A-Za-z0-9_-]/g, '_') + '.zip'
      a.click()
      onDone(true, '已开始下载 ✓')
    } catch (e) {
      onDone(false, '导出失败：' + (e && e.message ? e.message : String(e)))
    }
  }

  let current = null
  const refresh = () => {
    current = probeSession()
    const btn = document.getElementById(ROW_ID)
    if (btn == null) return
    const label = btn.querySelector('span[data-name]')
    if (label == null) return
    const name = sessionLabel(current)
    label.textContent = name !== null ? '会话日志 · ' + name : '会话日志 · 无选中会话'
    btn.disabled = current == null
    btn.title = current == null
      ? '主窗口没有选中的会话'
      : '导出会话日志（session.jsonl + 子会话与附件）'
  }

  /* 守护：React 重渲染重建 navList 子节点时重插（面板销毁则随树消失） */
  const guard = new MutationObserver(() => {
    if (document.getElementById(ROW_ID) == null) injectRow()
  })
  
  /* 注入一行导航（克隆上游 navCell 样式，React 重渲染被冲掉则重插） */
  const injectRow = () => {
    const list = document.querySelector('div[role="dialog"] [class*="navList"]')
    if (list == null) return false
    if (document.getElementById(ROW_ID) != null) return true
    const seed = list.querySelector('button')
    if (seed == null) return false
    const seedIcon = seed.querySelector('svg')
    const seedLabel = seed.querySelector('span')

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = ROW_ID
    // 克隆 navCell 类名但剥掉 active 态（选中行作种子时）
    btn.className = seed.className.split(/\\s+/).filter(c => !c.includes('active')).join(' ')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    if (seedIcon != null) {
      for (const a of seedIcon.attributes) svg.setAttribute(a.name, a.value)
      svg.setAttribute('viewBox', '0 0 16 16')
    } else {
      svg.setAttribute('width', '16')
      svg.setAttribute('height', '16')
    }
    svg.innerHTML = '<path d="M8 1.5a.6.6 0 0 1 .6.6v5.2l1.9-1.9a.6.6 0 1 1 .85.85L8.42 9.2a.6.6 0 0 1-.85 0L5.05 6.68a.6.6 0 1 1 .85-.85l1.5 1.5V2.1a.6.6 0 0 1 .6-.6Z" fill="currentColor"/><path d="M2.8 11.4a.6.6 0 0 1 .6.6v.5c0 .5.4.9.9.9h7.4c.5 0 .9-.4.9-.9v-.5a.6.6 0 1 1 1.2 0v.5a2.1 2.1 0 0 1-2.1 2.1H4.3a2.1 2.1 0 0 1-2.1-2.1v-.5a.6.6 0 0 1 .6-.6Z" fill="currentColor"/>'
    const span = document.createElement('span')
    if (seedLabel != null) span.className = seedLabel.className
    span.setAttribute('data-name', '1')
    span.textContent = '会话日志…'
    btn.append(svg, span)
    btn.addEventListener('click', () => {
      if (btn.disabled || current == null) return
      span.textContent = '正在导出…'
      btn.disabled = true
      void exportSession(current, (ok, text) => {
        span.textContent = text
        setTimeout(() => refresh(), ok ? 2000 : 3000)
      })
    })
    list.append(btn)
    refresh()
    guard.observe(list, { childList: true })
    return true
  }

  /* ---- 状态栏按钮（宿主 __dsh_desktop_titlebar，theme-watcher 注入；
     点击时实时探测会话（非模态，随时可切），导出结果换图标反馈 ---- */
  const BAR_BTN_ID = '__dsh_desktop_sessionlog_btn'
  const BAR_TITLE = '导出会话日志（session.jsonl + 子会话与附件）'
  const ICON_DL = '<path d="M8 1.5a.6.6 0 0 1 .6.6v5.2l1.9-1.9a.6.6 0 1 1 .85.85L8.42 9.2a.6.6 0 0 1-.85 0L5.05 6.68a.6.6 0 1 1 .85-.85l1.5 1.5V2.1a.6.6 0 0 1 .6-.6Z" fill="currentColor"/><path d="M2.8 11.4a.6.6 0 0 1 .6.6v.5c0 .5.4.9.9.9h7.4c.5 0 .9-.4.9-.9v-.5a.6.6 0 1 1 1.2 0v.5a2.1 2.1 0 0 1-2.1 2.1H4.3a2.1 2.1 0 0 1-2.1-2.1v-.5a.6.6 0 0 1 .6-.6Z" fill="currentColor"/>'
  const ICON_OK = '<path d="M3.4 8.6l2.9 2.9 6.3-6.3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  const ICON_ERR = '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  const injectBarBtn = () => {
    if (document.getElementById('__dsh_desktop_sessionlog_style') === null) {
      const st = document.createElement('style')
      st.id = '__dsh_desktop_sessionlog_style'
      // 与 preview-panel 状态栏按钮同款基底样式（right 序：终端 12/
      // 预览 44/轨迹 76/日志 108px）；标题避让带同步见 theme-watcher
      st.textContent = [
        '#' + BAR_BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease;right:108px}',
        'body[data-ds-dark-theme] #' + BAR_BTN_ID + '{color:rgba(232,234,237,.8)}',
        '#' + BAR_BTN_ID + ':hover{background:color-mix(in srgb,currentColor 10%,transparent)}',
        '#' + BAR_BTN_ID + ':active{background:color-mix(in srgb,currentColor 18%,transparent)}',
        '#' + BAR_BTN_ID + ':disabled{opacity:.45;cursor:default}',
      ].join('')
      document.head.append(st)
    }
    const host = document.getElementById('__dsh_desktop_titlebar')
    if (host === null || document.getElementById(BAR_BTN_ID) !== null) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BAR_BTN_ID
    btn.title = BAR_TITLE
    btn.setAttribute('aria-label', BAR_TITLE)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.innerHTML = ICON_DL
    btn.append(svg)
    btn.addEventListener('click', () => {
      if (btn.disabled) return
      const s = probeSession()
      if (s === null) return
      btn.disabled = true
      void exportSession(s, (ok, text) => {
        svg.innerHTML = ok ? ICON_OK : ICON_ERR
        btn.title = text
        setTimeout(() => {
          svg.innerHTML = ICON_DL
          btn.title = BAR_TITLE
          btn.disabled = false
        }, ok ? 2000 : 3000)
      })
    })
    host.append(btn)
  }

  // 面板每次打开重新挂载：body 级监听，navList/标题栏出现即注入
  //（标题栏由 theme-watcher 注入，与本脚本时序不定，观察器兜住）
  const panel = new MutationObserver(() => { injectRow(); injectBarBtn() })
  panel.observe(document.body, { childList: true, subtree: true })
  injectRow()
  injectBarBtn()
})()`

/**
 * 把注入器挂到 shell 窗口：整页加载完成时（重）注入。
 * 窗口销毁无需清理（页面上下文随 webContents 消亡）。
 */
export function attachSessionLogInjector(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
