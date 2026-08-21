/**
 * 样式设置注入器：把桌面壳的界面样式定制（启用/正文密度/正文字号/
 * 消息列宽，style-overlay 的档位 + 字号梯度缩放）注入上游设置面板
 * 「通用」区——设置入口统一到上游面板，桌面壳偏好设置面板只留桌面
 * 特有项（托盘保活）。
 *
 * 上游契约（零侵入、只读）：
 * - 通用区条目：SettingsRoot 的 options 列内，每个条目包在
 *   div[data-slot="settings.general.item"] 里（GeneralSection.module.css
 *   以该属性收边距）；注入条目追加同属性 wrapper，边距随上游；
 * - 行形态（AppearanceRow）：group > title + cubeRow > button 方块，
 *   aria-pressed 标选中、selected 类加高亮——注入行从种子行克隆
 *   group/title/cubeRow/cube/selected 类名（CSS modules 哈希前缀
 *   不影响语义匹配），样式与原生行零差。
 *
 * 通信（console 通道，同 attach-picker）：
 * - 页面 → 主进程：console.log('__dsh_style__:' + JSON.stringify({style}))
 * - 主进程 → 页面：executeJavaScript 调 window.__dshStyleSync(state)
 *   （注入后与每次写回后各推一次权威状态）
 * - 写回链：校验合并 → saveSettings → refreshStyleOverlay（shell 即时
 *   重注入 CSS，面板开着也能看到效果）→ 回推。
 *
 * @module desktop/main/style-settings
 */

import type { BrowserWindow } from 'electron'
import { consoleMessageText } from './console-channel'
import { refreshStyleOverlay } from './style-overlay'
import { getSettings, saveSettings } from './store'
import type { StyleSettings } from '@shared/ipc-contract'

/** 注入脚本（页面上下文执行；纯 JS：模板字符串内禁 TS 注解）。 */
const PAGE_JS = `(() => {
  if (window.__dshStyleWired) return
  window.__dshStyleWired = true
  const ID = '__dsh_desktop_style_item'
  const PREFIX = '__dsh_style__:'

  let state = { enabled: true, density: 'compact', contentWidth: 'extra', fontSize: 'auto' }
  let root = null
  let plainCls = ''
  let selCls = ''

  const DENSITY = [
    ['compact', '紧凑', '正文 14px · 信息密度高（默认）'],
    ['standard', '标准', '正文 15px · 居中折衷'],
    ['native', '原生', '上游 16px · 完全原始排版'],
  ]
  const WIDTH = [
    ['narrow', '紧凑', '748px（上游默认）'],
    ['wide', '加宽', '960px'],
    ['extra', '超宽', '1080px（默认）'],
  ]

  // 字号 stepper 的域与起点：auto 态跟随当前密度档基准（与
  // style-overlay DENSITIES/native=16 同源）；数字态 12–20 整数
  const autoBase = () => state.density === 'compact' ? 14 : state.density === 'standard' ? 15 : 16
  const curSize = () => state.fontSize === 'auto' ? autoBase() : state.fontSize

  const build = () => {
    root = document.getElementById(ID)
    if (root != null) return
    // 通用区挂载锚：任一 data-slot 条目 wrapper 的父容器即 section 根
    const seedWrap = document.querySelector('div[data-slot="settings.general.item"]')
    if (seedWrap == null) return
    const section = seedWrap.parentElement
    if (section == null) return
    // 种子行（主题外观行）：克隆 group/title/cubeRow/cube/selected 类名
    const seedCube = section.querySelector('button[aria-pressed]')
    if (seedCube == null) return
    const cubeRow = seedCube.parentElement
    const group = cubeRow != null ? cubeRow.parentElement : null
    if (group == null) return
    const titleEl = group.firstElementChild
    const cubes = Array.from(cubeRow.querySelectorAll('button'))
    const pressed = cubes.find(b => b.getAttribute('aria-pressed') === 'true') || seedCube
    const plain = cubes.find(b => b !== pressed)
    plainCls = plain != null ? plain.className : seedCube.className
    const plainList = plain != null ? plain.className.split(/\\s+/) : []
    selCls = pressed.className.split(/\\s+/).filter(c => plainList.indexOf(c) === -1).join(' ')

    const mkGroup = (titleText, options, key) => {
      const g = document.createElement('div')
      g.className = group.className
      g.setAttribute('data-key', key)
      const t = document.createElement('div')
      if (titleEl != null) t.className = titleEl.className
      t.textContent = titleText
      const row = document.createElement('div')
      row.className = cubeRow.className
      for (const item of options) {
        const val = item[0], label = item[1], hint = item[2]
        const b = document.createElement('button')
        b.type = 'button'
        b.className = plainCls
        b.setAttribute('data-val', val)
        b.setAttribute('data-plain', plainCls)
        b.title = hint
        // 双行方块（上游 cube 是 icon-over-label 两行视觉，这里用
        // label + hint 填充：主行继承 cube 14px primary，副行同上游
        // 设置行 desc 规格 12px tertiary）
        const l1 = document.createElement('span')
        l1.textContent = label
        const l2 = document.createElement('span')
        l2.textContent = hint
        l2.style.cssText = 'font-size:12px;line-height:16px;font-weight:400;color:var(--dsw-alias-label-tertiary,#9aa1ac);'
        b.append(l1, l2)
        b.addEventListener('click', () => {
          if (b.disabled) return
          if (key === 'enabled') state.enabled = val === 'on'
          else if (key === 'density') state.density = val
          else state.contentWidth = val
          render()
          console.log(PREFIX + JSON.stringify({ style: state }))
        })
        row.append(b)
      }
      g.append(t, row)
      return g
    }

    // 正文字号 stepper：[−] [当前值/自动] [+]，同一 cubeRow 形态克隆；
    // 中间按钮 auto 态高亮显示「自动」，数字态显示「Npx」，点击复位 auto
    const mkStepper = (titleText, key) => {
      const g = document.createElement('div')
      g.className = group.className
      g.setAttribute('data-key', key)
      const t = document.createElement('div')
      if (titleEl != null) t.className = titleEl.className
      t.textContent = titleText
      const row = document.createElement('div')
      row.className = cubeRow.className
      const changed = () => {
        render()
        console.log(PREFIX + JSON.stringify({ style: state }))
      }
      const mkCube = (val, main, hint, onClick) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = plainCls
        b.setAttribute('data-val', val)
        b.setAttribute('data-plain', plainCls)
        b.title = hint
        const l1 = document.createElement('span')
        l1.textContent = main
        const l2 = document.createElement('span')
        l2.textContent = hint
        l2.style.cssText = 'font-size:12px;line-height:16px;font-weight:400;color:var(--dsw-alias-label-tertiary,#9aa1ac);'
        b.append(l1, l2)
        b.addEventListener('click', () => { if (!b.disabled) onClick() })
        return b
      }
      row.append(
        mkCube('dec', '−', '调小', () => { state.fontSize = Math.max(12, curSize() - 1); changed() }),
        mkCube('auto', '自动', '点击恢复跟随密度档', () => { state.fontSize = 'auto'; changed() }),
        mkCube('inc', '+', '调大', () => { state.fontSize = Math.min(20, curSize() + 1); changed() }),
      )
      g.append(t, row)
      return g
    }

    root = document.createElement('div')
    root.id = ID
    root.setAttribute('data-slot', 'settings.general.item')
    root.append(
      mkGroup('桌面样式定制', [['on', '启用', '密度/列宽优化生效（含轨迹页美化）'], ['off', '关闭', '完全恢复上游原版排版']], 'enabled'),
      mkGroup('正文密度', DENSITY, 'density'),
      mkStepper('正文字号', 'fontSize'),
      mkGroup('消息列宽', WIDTH, 'contentWidth'),
    )
    section.append(root)
    render()
  }

  const render = () => {
    if (root == null) return
    for (const g of root.querySelectorAll('div[data-key]')) {
      const key = g.getAttribute('data-key')
      const off = key !== 'enabled' && !state.enabled
      g.style.opacity = off ? '0.5' : ''
      for (const b of g.querySelectorAll('button')) {
        const val = b.getAttribute('data-val')
        const active = key === 'enabled'
          ? state.enabled === (val === 'on')
          : state[key] === val
        b.setAttribute('aria-pressed', active ? 'true' : 'false')
        b.className = b.getAttribute('data-plain') + (active && selCls !== '' ? ' ' + selCls : '')
        b.disabled = off
        if (key === 'fontSize') {
          // 中间按钮主行随状态刷新；−/+ 到 12/20 边界禁用
          if (val === 'auto') {
            const l1 = b.firstElementChild
            if (l1 != null) l1.textContent = state.fontSize === 'auto' ? '自动' : String(state.fontSize) + 'px'
          } else if (val === 'dec') {
            b.disabled = off || curSize() <= 12
          } else if (val === 'inc') {
            b.disabled = off || curSize() >= 20
          }
        }
      }
    }
  }

  /* 主进程权威状态回推（注入后与每次写回后） */
  window.__dshStyleSync = (s) => {
    if (s == null || typeof s !== 'object') return
    state = {
      enabled: s.enabled !== false,
      density: typeof s.density === 'string' ? s.density : state.density,
      contentWidth: typeof s.contentWidth === 'string' ? s.contentWidth : state.contentWidth,
      fontSize: s.fontSize === 'auto' || (typeof s.fontSize === 'number' && s.fontSize >= 12 && s.fontSize <= 20)
        ? s.fontSize
        : state.fontSize,
    }
    render()
  }

  // 通用区每次激活重新挂载：body 级监听自愈（已存在时幂等空转）
  const mo = new MutationObserver(() => { build() })
  mo.observe(document.body, { childList: true, subtree: true })
  build()
})()`

/**
 * 给 shell 窗口挂样式设置注入器：整页加载后注入页面脚本并推当前状态；
 * console 通道接收写回（校验合并 → 落盘 → 即时重注入样式 → 回推）。
 * 窗口销毁时监听随 webContents 消亡。
 */
export function attachStyleSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshStyleSync && window.__dshStyleSync(${JSON.stringify(getSettings().style)})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith('__dsh_style__:') || win.isDestroyed()) return
    let payload: { style?: Record<string, unknown> }
    try { payload = JSON.parse(message.slice('__dsh_style__:'.length)) as { style?: Record<string, unknown> } } catch { return }
    const p = payload.style
    if (p === null || typeof p !== 'object') return
    // 防御性校验：非法档位丢弃，保留现值（与 ipc.ts preferences:set 同款枚举）
    const cur = getSettings().style
    const next: StyleSettings = {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : cur.enabled,
      density: (['compact', 'standard', 'native'] as const).includes(p.density as StyleSettings['density'])
        ? (p.density as StyleSettings['density'])
        : cur.density,
      contentWidth: (['narrow', 'wide', 'extra'] as const).includes(p.contentWidth as StyleSettings['contentWidth'])
        ? (p.contentWidth as StyleSettings['contentWidth'])
        : cur.contentWidth,
      fontSize: p.fontSize === 'auto' || (typeof p.fontSize === 'number' && Number.isInteger(p.fontSize) && p.fontSize >= 12 && p.fontSize <= 20)
        ? (p.fontSize as StyleSettings['fontSize'])
        : cur.fontSize,
    }
    saveSettings({ style: next })
    refreshStyleOverlay(win)
    push()
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).then(push).catch(() => {})
  })
}
