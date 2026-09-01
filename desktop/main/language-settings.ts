/**
 * 「强制中文回答」设置：通用区注入器 + home patch 层热切换。
 *
 * 生效链（零侵入上游）：
 * - 指令本体在 dsh-language-bundle（bundle/dsh-language-bundle）：全局
 *   system-prompt section 'kcoder:language'（order 1，persona 之后）。
 *   bundle patch 层默认 disabled（上游「跟随模型」原样）；
 * - 本模块按用户偏好维护 $DSH_HOME/cordis.patch.yml（dsh home 用户
 *   patch 层）中的一个定界块：开 = `- id: kcoder-language /
 *   disabled: false` 覆盖 bundle 默认；关 = 移除块。cordis patch 语义
 *   为 id 定位 + 显式键覆盖 + 后层赢（vendor/include applyEntryPatches）；
 * - 该文件被 dsh 的 watchUserPatches 热重载（app-boot/src/index.ts），
 *   改写即重新组合插件行——开关切换无需重启引擎。
 *
 * 定界块用注释标记圈住自己的行，绝不触碰文件里用户手写的其他 patch
 * 行；块被用户手删 = 回落 bundle 默认（关），下次开关动作会重建。
 *
 * 通用区注入（skills-settings.ts 同款模式）：设置对话框 nav 之外，
 * 通用区（div[data-slot="settings.general.item"] 条目列）追加一组
 * 「回答语言」方块行（跟随模型 / 强制中文），console 通道双向通信。
 *
 * @module desktop/main/language-settings
 */

import type { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleMessageText } from './console-channel'
import { dshHome } from './dsh-contract'
import { getSettings, saveSettings } from './store'

/** home 用户 patch 层路径（dsh 的 homePatchPath 同源）。 */
function homePatchPath(): string {
  return join(dshHome(), 'cordis.patch.yml')
}

/** 定界标记（YAML 注释，parser 忽略）。 */
const BLOCK_BEGIN = '# ---- kcoder-language BEGIN (managed by KCoder; remove this block to follow the model default) ----'
const BLOCK_END = '# ---- kcoder-language END ----'

/** 开启态的块内容（覆盖 bundle 层的 disabled: true）。 */
const BLOCK_ON = [
  BLOCK_BEGIN,
  '- id: kcoder-language',
  '  disabled: false',
  BLOCK_END,
  '',
].join('\n')

/**
 * 把 home patch 层的 kcoder-language 定界块同步到用户偏好（幂等）。
 * 文件/目录不存在时按需创建；任何失败只记日志（开关面板照常可写，
 * 下次启动或下次切换重试）。
 */
export function syncLanguagePatch(): void {
  try {
    const on = getSettings().language.forceChinese
    const file = homePatchPath()
    let text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    // 剥掉旧块（跨行容忍：BEGIN 到 END 全删；残缺 BEGIN 删到文件尾）
    const begin = text.indexOf(BLOCK_BEGIN)
    if (begin !== -1) {
      const end = text.indexOf(BLOCK_END, begin)
      text = end === -1 ? text.slice(0, begin) : text.slice(0, begin) + text.slice(end + BLOCK_END.length)
    }
    text = text.replace(/\n{3,}$/, '\n\n')
    text = text.replace(/[^\n]$/, (m) => `${m}\n`)
    if (on) text += (text === '' || text.endsWith('\n') ? '' : '\n') + BLOCK_ON
    const changed = text !== (existsSync(file) ? readFileSync(file, 'utf8') : '')
    if (!changed) return
    mkdirSync(dshHome(), { recursive: true })
    writeFileSync(file, text, 'utf8')
    console.log(`[kcoder-language] home patch 层已${on ? '启用' : '移除'}（热重载生效）`)
  } catch (error) {
    console.error('[kcoder-language] home patch 同步失败:', error)
  }
}

/** 注入脚本（页面上下文执行；纯 JS：模板字符串内禁 TS 注解）。 */
const PAGE_JS = `(() => {
  if (window.__dshLangWired) return
  window.__dshLangWired = true
  const ID = '__dsh_desktop_lang_item'
  const PREFIX = '__dsh_lang__:'

  let state = { forceChinese: false }
  let root = null
  let plainCls = ''
  let selCls = ''

  const OPTIONS = [
    ['off', '跟随模型', '不干预，回答语言由模型自行决定'],
    ['on', '强制中文', '要求 agent 正文用简体中文回答（代码/命令/路径不变）'],
  ]

  const build = () => {
    root = document.getElementById(ID)
    if (root != null) return
    // 通用区挂载锚：任一 data-slot 条目 wrapper 的父容器即 section 根
    const seedWrap = document.querySelector('div[data-slot="settings.general.item"]')
    if (seedWrap == null) return
    const section = seedWrap.parentElement
    if (section == null) return
    // 种子行：克隆 group/title/cubeRow/cube/selected 类名（同 style-settings）
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

    const g = document.createElement('div')
    g.className = group.className
    g.setAttribute('data-key', 'language')
    const t = document.createElement('div')
    if (titleEl != null) t.className = titleEl.className
    t.textContent = '回答语言'
    const row = document.createElement('div')
    row.className = cubeRow.className
    for (const item of OPTIONS) {
      const val = item[0], label = item[1], hint = item[2]
      const b = document.createElement('button')
      b.type = 'button'
      b.className = plainCls
      b.setAttribute('data-val', val)
      b.setAttribute('data-plain', plainCls)
      b.title = hint
      const l1 = document.createElement('span')
      l1.textContent = label
      const l2 = document.createElement('span')
      l2.textContent = hint
      l2.style.cssText = 'font-size:12px;line-height:16px;font-weight:400;color:var(--dsw-alias-label-tertiary,#9aa1ac);'
      b.append(l1, l2)
      b.addEventListener('click', () => {
        state.forceChinese = val === 'on'
        render()
        console.log(PREFIX + JSON.stringify({ language: state }))
      })
      row.append(b)
    }
    g.append(t, row)

    root = document.createElement('div')
    root.id = ID
    root.setAttribute('data-slot', 'settings.general.item')
    root.append(g)
    section.append(root)
    render()
  }

  const render = () => {
    if (root == null) return
    for (const b of root.querySelectorAll('button')) {
      const val = b.getAttribute('data-val')
      const active = state.forceChinese === (val === 'on')
      b.setAttribute('aria-pressed', active ? 'true' : 'false')
      b.className = b.getAttribute('data-plain') + (active && selCls !== '' ? ' ' + selCls : '')
    }
  }

  /* 主进程权威状态回推（注入后与每次写回后） */
  window.__dshLangSync = (s) => {
    if (s == null || typeof s !== 'object') return
    state = { forceChinese: s.forceChinese === true }
    render()
  }

  // 通用区每次激活重新挂载：body 级监听自愈（已存在时幂等空转）
  const mo = new MutationObserver(() => { build() })
  mo.observe(document.body, { childList: true, subtree: true })
  build()
})()`

/**
 * 给 shell 窗口挂回答语言注入器：整页加载后注入页面脚本并推当前状态；
 * console 通道接收写回（落盘 → home patch 同步（热重载生效）→ 回推）。
 */
export function attachLanguageSettingsInjector(win: BrowserWindow): void {
  const { webContents } = win

  const push = (): void => {
    if (win.isDestroyed()) return
    void webContents.executeJavaScript(
      `window.__dshLangSync && window.__dshLangSync(${JSON.stringify(getSettings().language)})`,
      true,
    ).catch(() => {})
  }

  const onConsole = (event: unknown, ...rest: unknown[]): void => {
    const message = consoleMessageText(event, rest)
    if (!message.startsWith('__dsh_lang__:') || win.isDestroyed()) return
    let payload: { language?: { forceChinese?: unknown } }
    try { payload = JSON.parse(message.slice('__dsh_lang__:'.length)) as { language?: { forceChinese?: unknown } } } catch { return }
    const p = payload.language
    if (p === null || typeof p !== 'object') return
    saveSettings({ language: { forceChinese: p.forceChinese === true } })
    syncLanguagePatch()
    push()
  }

  webContents.on('console-message', onConsole)
  webContents.on('did-finish-load', () => {
    void webContents.executeJavaScript(PAGE_JS, true).then(push).catch(() => {})
  })
}
