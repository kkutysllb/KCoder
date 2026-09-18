/**
 * 更新图标注入器：检测到新版本后（available 起，含下载中/下载完成），
 * 在 shell 窗口（上游 Web UI）侧边栏 logo 旁显示一个下载图标；
 * 鼠标悬停弹出该版本发布说明气泡（GitHub Release 正文，主进程经
 * SHOW_JS 的 DATA 载荷注入），点击图标 → 安装更新。
 *
 * 定位依据（上游 SidebarRoot.tsx + CSS modules）：
 * - logo 行：`<div className={css.logoRow}>` → 编译后类名形如
 *   `SidebarRoot_logoRow_<hash>`，`[class*="logoRow"]` 可稳定匹配；
 * - 收起态（rail）根节点带 `collapsed` 类，brand 字标隐藏、仅剩
 *   toggle；图标自适应两种宽度。
 *
 * 通信约定：图标点击 → 导航 `kcoder://install-update` →
 * windows.ts 的 will-navigate 拦截 → updater.installUpdate()。
 * 全程不注入 preload、不修改上游任何代码——shell 保持纯浏览器载体。
 *
 * 说明载荷：主进程每次 sync 都把最新 {version, notes, stage} 嵌入
 * SHOW_JS 执行——气泡渲染永远读页内全局 `__dshUpdateInfo`，发布说明
 * 异步补齐（状态二次广播）时气泡内容随之刷新。
 *
 * @module desktop/main/update-injector
 */

import type { BrowserWindow } from 'electron'
import { updateEvents, updateStatus } from './updater'

/** 图标元素 id（页面内唯一标记）。 */
const BTN_ID = '__dsh_desktop_update_btn'

/** 注入脚本载荷：主进程侧以 JSON 内插（版本/说明/阶段）。 */
export interface UpdateInjectData {
  version: string
  /** 发布说明（GitHub Release 正文）；未补齐/拉取失败为 null。 */
  notes: string | null
  /** available=已发现 · downloading=下载中 · downloaded=可安装。 */
  stage: 'available' | 'downloading' | 'downloaded'
}

/**
 * 注入脚本（页面上下文执行）：
 * - 定位侧边栏 logoRow，在其内部追加下载图标（logo 旁）；
 * - 悬停图标/气泡 → 展示发布说明气泡（md 轻量渲染）；
 * - React 重渲染可能移除图标 → MutationObserver 自愈重插；
 * - 幂等：图标已存在时仅刷新说明载荷与气泡内容。
 */
const SHOW_JS = `(() => {
  const ID = ${JSON.stringify(BTN_ID)}
  const POP_ID = '__dsh_desktop_update_pop'
  window.__dshUpdateInfo = __DATA__

  // md 轻量渲染：覆盖发布说明实际用到的语法（标题 1-6 级/加粗/行内代码/
  // 列表含缩进嵌套/引用/链接文字化/分隔线），其余按字面保留——textContent
  // 建节点，杜绝 HTML 注入。行内解析顺序：先摘行内代码（\x60，码内不再
  // 做加粗/链接），非码段做 **加粗** 与 [文字](地址)→文字。
  // （2026-09-19 修订：此前只认一级标题——发布说明全是 ## 小节，整行
  // 原文显示；嵌套列表/行内代码/链接同理。见 v0.6.13 发布说明对照。）
  const renderNotes = (box, info) => {
    box.replaceChildren()
    const head = document.createElement('div')
    head.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:13px'
    const stageTxt = info.stage === 'downloaded' ? '可安装'
      : info.stage === 'downloading' ? '正在后台下载' : '即将后台下载'
    head.textContent = 'KCoder ' + info.version + ' · ' + stageTxt
    box.append(head)
    if (!info.notes) {
      const p = document.createElement('div')
      p.style.cssText = 'opacity:.7'
      p.textContent = '发现新版本，点击图标即可在安装就绪后升级。'
      box.append(p)
      return
    }
    const body = document.createElement('div')
    const lines = info.notes.split('\\n')

    // 行内解析（占位法，2026-09-19 二次修订）：发布说明大量使用
    // 「加粗包裹行内码」（如 加粗 Node PTC 行内码 run_code 按次超时 加粗）——
    // 先摘码会把加粗对拆散、两侧各剩孤星。改为：码先摘成 \x00n\x00 占位符，
    // 链接与加粗在占位文本上解析（占位符不参与 * 与 [ 匹配，跨码配对自然
    // 成立），渲染时占位段落回码 span。
    const CODE_RE = /\\x60([^\\x60]+)\\x60/g
    const BOLD_RE = /\\*\\*(.+?)\\*\\*/g
    const LINK_RE = /\\[([^\\]]+)\\]\\([^)]*\\)/g
    const PLACE_RE = /\\x00(\\d+)\\x00/g

    // 一段（已摘码）占位文本 → DOM 片段；boldWanted 决定整体是否 <b>
    const emit = (frag, text, boldWanted) => {
      let last = 0
      let m
      PLACE_RE.lastIndex = 0
      while ((m = PLACE_RE.exec(text)) !== null) {
        if (m.index > last) {
          const piece = text.slice(last, m.index)
          boldWanted ? (() => { const b = document.createElement('b'); b.textContent = piece; frag.append(b) })() : frag.append(piece)
        }
        const c = document.createElement('span')
        c.style.cssText = 'font-family:ui-monospace,Menlo,monospace;font-size:11px;background:rgba(127,127,127,.14);border-radius:3px;padding:0 3px'
        c.textContent = codeSlots[Number(m[1])]
        frag.append(c)
        last = m.index + m[0].length
      }
      if (last < text.length) {
        const piece = text.slice(last)
        if (boldWanted) { const b = document.createElement('b'); b.textContent = piece; frag.append(b) }
        else frag.append(piece)
      }
    }

    let codeSlots = []
    // 整段：摘码 → 链接文字化 → 加粗切块 → 逐块回填码 span
    const inline = (seg) => {
      codeSlots = []
      const marked = seg.replace(CODE_RE, (_, c) => {
        codeSlots.push(c)
        return '\\x00' + String(codeSlots.length - 1) + '\\x00'
      }).replace(LINK_RE, '$1')
      const frag = document.createDocumentFragment()
      let last = 0
      let m
      BOLD_RE.lastIndex = 0
      while ((m = BOLD_RE.exec(marked)) !== null) {
        if (m.index > last) emit(frag, marked.slice(last, m.index), false)
        emit(frag, m[1], true)
        last = m.index + m[0].length
      }
      if (last < marked.length) emit(frag, marked.slice(last), false)
      return frag
    }

    let list = null
    const flush = () => { list = null }
    for (const raw of lines) {
      const line = raw.replace(/\\s+$/, '')
      if (/^\\s*(-{3,}|\\*{3,})\\s*$/.test(line)) {
        flush()
        const rule = document.createElement('div')
        rule.style.cssText = 'border-top:1px solid rgba(127,127,127,.25);margin:8px 0'
        body.append(rule)
      } else if (/^#{1,6}\\s+/.test(line)) {
        flush()
        const h = document.createElement('div')
        h.style.cssText = 'font-weight:600;margin:8px 0 4px'
        h.textContent = line.replace(/^#+\\s+/, '')
        body.append(h)
      } else if (/^>\\s?/.test(line)) {
        flush()
        const q = document.createElement('div')
        q.style.cssText = 'opacity:.65;margin:4px 0'
        q.append(inline(line.replace(/^>\\s?/, '')))
        body.append(q)
      } else {
        const li = /^(\\s*)[-*]\\s+(.*)$/.exec(line)
        if (li !== null) {
          if (list === null) {
            list = document.createElement('div')
            list.style.cssText = 'margin:2px 0'
            body.append(list)
          }
          const depth = Math.min(Math.floor(li[1].replace(/\\t/g, '  ').length / 2), 3)
          const item = document.createElement('div')
          item.style.cssText = 'padding-left:' + String(10 + depth * 14) + 'px;text-indent:-10px'
          item.append('· ')
          item.append(inline(li[2]))
          list.append(item)
        } else if (line === '') {
          flush()
          const gap = document.createElement('div')
          gap.style.height = '4px'
          body.append(gap)
        } else {
          flush()
          const para = document.createElement('div')
          para.append(inline(line))
          body.append(para)
        }
      }
    }
    box.append(body)
  }

  const showPop = (btn) => {
    let pop = document.getElementById(POP_ID)
    if (!pop) {
      pop = document.createElement('div')
      pop.id = POP_ID
      const s = pop.style
      s.all = 'unset'
      s.boxSizing = 'border-box'
      s.position = 'fixed'
      s.zIndex = '2147483000'
      s.display = 'block'
      s.width = '320px'
      s.maxHeight = '360px'
      s.overflowY = 'auto'
      s.padding = '12px'
      s.borderRadius = '10px'
      s.border = '1px solid var(--dsw-alias-border-light, rgba(128,128,128,.25))'
      s.background = 'var(--dsw-alias-bg-layer-2, #fff)'
      s.color = 'var(--dsw-alias-label-primary, #111)'
      s.fontFamily = 'var(--dsw-font-family, system-ui), system-ui, sans-serif'
      s.fontSize = '12px'
      s.lineHeight = '1.7'
      s.boxShadow = '0 8px 28px rgba(0,0,0,.22)'
      s.whiteSpace = 'normal'
      s.wordBreak = 'break-word'
      document.body.append(pop)
      pop.addEventListener('mouseenter', cancelHide)
      pop.addEventListener('mouseleave', armHide)
    }
    renderNotes(pop, window.__dshUpdateInfo || {})
    const r = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 336))
    const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - 380))
    pop.style.left = left + 'px'
    pop.style.top = top + 'px'
    pop.style.display = 'block'
  }

  let hideTimer = 0
  const armHide = () => {
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      const p = document.getElementById(POP_ID)
      if (p) p.style.display = 'none'
    }, 250)
  }
  const cancelHide = () => clearTimeout(hideTimer)

  const inject = () => {
    const info = window.__dshUpdateInfo
    const existing = document.getElementById(ID)
    if (existing) {
      // 幂等刷新：说明载荷异步补齐时更新悬停气泡（若正展示）
      const open = document.getElementById(POP_ID)
      if (open && open.style.display !== 'none') renderNotes(open, info)
      return 'present'
    }
    const row = document.querySelector('[class*="logoRow"]')
    if (!row) return 'absent'
    const root = row.closest('[class*="collapsed"]')
    const rail = root !== null
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = ID
    btn.setAttribute('aria-label', '发现新版本：' + (info.version || ''))
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
    btn.addEventListener('mouseenter', () => {
      s.background = 'color-mix(in srgb, currentColor 12%, transparent)'
      cancelHide()
      showPop(btn)
    })
    btn.addEventListener('mouseleave', () => {
      s.background = 'transparent'
      armHide()
    })
    row.append(btn)
    // React 重渲染可能丢弃图标：观察侧边栏区域，被移除即重插
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

/** 移除注入（无新版本状态下的清理）：断开自愈 observer 再移除图标与气泡。 */
const HIDE_JS = `(() => {
  window.__dshDesktopUpdateMO?.disconnect()
  delete window.__dshDesktopUpdateMO
  delete window.__dshUpdateInfo
  document.getElementById(${JSON.stringify(BTN_ID)})?.remove()
  document.getElementById('__dsh_desktop_update_pop')?.remove()
})()`

/** 已注入标记（按 webContents.id 记录，避免反复执行 HIDE_JS）。 */
const injected = new Set<number>()

/** 图标可见的更新阶段：检测到新版本即显（无需等下载完成）。 */
const VISIBLE_STATES = new Set(['available', 'downloading', 'downloaded'])

/**
 * 把注入器挂到 shell 窗口：页面加载完成与更新状态变化时同步图标显隐。
 * 发布说明异步补齐会触发二次广播 → 再次 SHOW（幂等，仅刷新气泡载荷）。
 * 窗口销毁自动清理（executeJavaScript 对销毁窗口是 no-op 风险，先判活）。
 */
export function attachUpdateInjector(win: BrowserWindow): void {
  const sync = (): void => {
    if (win.isDestroyed()) return
    const status = updateStatus()
    const show = VISIBLE_STATES.has(status.state)
    if (show) {
      injected.add(win.webContents.id)
      const data: UpdateInjectData = {
        version: status.availableVersion ?? '',
        notes: status.releaseNotes,
        stage: status.state as UpdateInjectData['stage'],
      }
      // 用 split/join 而非 replace：发布说明内可能含 $&/$' 等替换符，
      // String.replace 会把它们当特殊序列展开，污染注入脚本。
      const js = SHOW_JS.split('__DATA__').join(JSON.stringify(data))
      win.webContents.executeJavaScript(js, true).catch(() => {
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
  // 挂接时若已检测到新版本（窗口晚于状态打开），立即补一次
  sync()
}
