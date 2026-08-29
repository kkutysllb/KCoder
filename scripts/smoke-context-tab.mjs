/**
 * 上下文按钮点击原生 tab 冒烟：手搓上游会话视图（tablist 三枚
 * button[role="tab"] 模拟 ConversationSession 头（Chat/Trajectory/
 * context，label 走插件字典 zh「上下文」）+ data-composer-card 内
 * data-composer-input contentEditable（0.1.2-alpha.1 基线形态））
 * + 自绘标题栏 → 注入 context-button 的 PAGE_JS → 断言：
 * - 按钮注入（标题栏内、输入面不可编辑时 disabled）；
 * - 点击按钮 → 原生「上下文」tab 被点击（aria-selected 单选翻转，
 *   其余 tab 转false）——不再开 modal；
 * - 已激活时再点 → toggle 切回「对话」tab（tab click 恰两枚，
 *   「上下文」取消选中，不自行发挥）；
 * - tab 激活翻转（aria-selected 属性变化）→ 按钮 data-on 跟随
 *   （panel-menu 菜单蓝点数据源）；
 * - 手输 /context 打开的 modal（.lc-modal-backdrop 出现/消失）→
 *   沉浸模式接管（__dsh_ctx_mode class + __dsh_ctx__: console 上报
 *   1/0）；modal 期间点按钮冻结不切 tab；
 * - tab 缺席（插件 <0.9/纯上游）→ 回退模拟 /context 输入路径
 *   （composer 收到 '/context' 写入 + Enter keydown）；
 * - composer 惯性态（无会话 workspace-trigger：data-phase="inert"）→
 *   置灰；翻转为实态 → observer 解灰（常驻 div 不挂卸，只听 childList
 *   会永远卡灰）。
 *
 * 运行：pnpm exec electron scripts/smoke-context-tab.mjs
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

// 从源码提取 PAGE_JS 模板串原文，主进程插值占位符静态替换（与 TS
// 模板求值同构：常量均无单引号，可直接嵌入；SHELL_TITLEBAR_HEIGHT
// 与 theme-watcher 一致取 48）
const src = readFileSync(join(ROOT, 'desktop/main/context-button.ts'), 'utf8')
const decl = 'const PAGE_JS = `'
const from = src.indexOf(decl) + decl.length
const endTick = src.indexOf('\n})()`', from)
if (from < decl.length || endTick < 0) throw new Error('无法提取 PAGE_JS')
const iconMatch = /const ICON_SVG =\s*\n?\s*'([^']*)'/.exec(src)
if (iconMatch === null) throw new Error('无法提取 ICON_SVG')
const pageJs = src
  .slice(from, endTick + 5)
  .replaceAll('${CONTEXT_BTN_ID}', '__dsh_desktop_context_btn')
  .replaceAll('${BACK_BTN_ID}', '__dsh_desktop_context_back')
  .replaceAll('${SHELL_TITLEBAR_HEIGHT}', '48')
  .replaceAll('${ICON_SVG}', iconMatch[1])
  .replaceAll('${CONTEXT_PREFIX}', '__dsh_ctx__:')
  .replaceAll('${CONTEXT_BTN_RIGHT}', '76')

// 手搓上游会话视图：tab 头点击模拟 React actions.setView 单选
// （aria-selected 翻转——按钮 data-on 的 observer 数据源）；
// console.log 劫持收集 __dsh_ctx__: 上报；textarea 记录 input /
// Enter keydown（回退路径证据）
const html = (dark, withCtxTab = true, withComposer = true, composerInert = false) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; background: ${dark ? '#17181a' : '#fff'}; color: ${dark ? '#e8eaed' : '#1a1d21'}; padding-top: 48px; height: 100vh; box-sizing: border-box; }
  #__dsh_desktop_titlebar { position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 2147483647; display: flex; align-items: center; background: ${dark ? '#1d1e20' : '#f7f7f8'}; }
  .tabs { display: flex; gap: 4px; padding: 12px 16px; }
  .tabs button { padding: 6px 14px; border: none; border-radius: 6px; background: transparent; cursor: pointer; font-size: 13px; color: inherit; }
  .tabs button[aria-selected="true"] { background: rgba(128,128,128,.2); }
  .main { padding: 16px; font-size: 13px; opacity: .7; }
  .composer { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px; }
  [data-composer-input] { width: 100%; min-height: 60px; box-sizing: border-box; font-size: 13px; border: 1px solid rgba(128,128,128,.3); border-radius: 6px; padding: 6px; }
</style></head><body${dark ? ' data-ds-dark-theme=""' : ''}>
<div id="__dsh_desktop_titlebar"></div>
<div class="tabs" role="tablist">
  <button type="button" role="tab" aria-selected="true" data-id="chat">对话</button>
  <button type="button" role="tab" data-id="trajectory">轨迹</button>
  ${withCtxTab ? '<button type="button" role="tab" data-id="context">上下文</button>' : ''}
</div>
<div class="main">会话主内容区（视图环挂载点）</div>
${withComposer ? `<div class="composer"><div data-composer-card><div data-composer-input role="textbox" aria-multiline="true" data-phase="${composerInert ? 'inert' : 'idle'}"${composerInert ? '' : ' contenteditable="true"'}></div></div></div>` : ''}
<script>
  window.__tabClicks = []
  document.querySelectorAll('[role="tab"]').forEach((b) => {
    b.addEventListener('click', () => {
      window.__tabClicks.push(b.dataset.id)
      document.querySelectorAll('[role="tab"]').forEach((x) => x.setAttribute('aria-selected', x === b ? 'true' : 'false'))
    })
  })
  window.__ctxLogs = []
  const origLog = console.log.bind(console)
  console.log = (...a) => { if (String(a[0]).startsWith('__dsh_ctx__:')) window.__ctxLogs.push(String(a[0])); origLog(...a) }
  window.__inputs = 0
  window.__enters = 0
  const ta = document.querySelector('[data-composer-input],[data-composer-card] textarea')
  if (ta !== null) {
    ta.addEventListener('input', () => { window.__inputs++ })
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__enters++ })
  }
</script>
</body></html>`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TAB = (id) => `document.querySelector('[role="tab"][data-id="${id}"]')`

async function loadFixture(win, dark, withCtxTab, withComposer, composerInert) {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-tab-smoke-'))
  writeFileSync(join(dir, 'index.html'), html(dark, withCtxTab, withComposer, composerInert))
  await win.loadFile(join(dir, 'index.html'))
  await win.webContents.executeJavaScript(pageJs, true)
  await sleep(800)
}

async function runScenario(win, label, dark, withCtxTab = true, withComposer = true, screenshot = false, composerInert = false) {
  await loadFixture(win, dark, withCtxTab, withComposer, composerInert)
  const fails = []

  // ── 基础：按钮注入 + 初始态 ──────────────────────────────────
  const base = JSON.parse(await win.webContents.executeJavaScript(`(() => {
    const btn = document.getElementById('__dsh_desktop_context_btn')
    const ctx = ${TAB('context')}
    const t = document.querySelector('[data-composer-input],[data-composer-card] textarea')
    return JSON.stringify({
      btnExists: btn !== null,
      btnDisabled: btn !== null ? btn.disabled : null,
      ctxTabSelected: ctx !== null ? ctx.getAttribute('aria-selected') : null,
      hasUsable: t !== null && (t.tagName === 'TEXTAREA' || t.dataset.phase !== 'inert'),
    })
  })()`, true))
  if (!base.btnExists) fails.push('状态栏「上下文」按钮未注入')
  if (base.btnDisabled !== !base.hasUsable) fails.push(`按钮 disabled=${base.btnDisabled} 应为 ${!base.hasUsable}（输入面不可编辑置灰）`)

  // ── 惯性态场景：翻 contenteditable 属性 → observer 解灰 ──────
  if (composerInert) {
    const flip = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const c = document.querySelector('[data-composer-input]')
      c.setAttribute('data-phase', 'idle')
      c.setAttribute('contenteditable', 'true')
      await new Promise((r) => setTimeout(r, 400))
      return JSON.stringify({ btnDisabled: document.getElementById('__dsh_desktop_context_btn').disabled })
    })()`, true))
    if (flip.btnDisabled !== false) fails.push(`惯性态翻转为实态后按钮 disabled=${flip.btnDisabled} 应解灰（observer data-phase 翻转）`)
  }

  // ── 主路径：点击 → 原生 tab 切换（不开 modal）────────────────
  // （惯性态按钮置灰点了无反应，跳过点击路径断言）
  if (withCtxTab && withComposer && !composerInert) {
    const clicked = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('__dsh_desktop_context_btn').click()
      await new Promise((r) => setTimeout(r, 400))
      const ctx = ${TAB('context')}
      const chat = ${TAB('chat')}
      return JSON.stringify({
        tabClicks: [...window.__tabClicks],
        ctxSelected: ctx.getAttribute('aria-selected'),
        chatSelected: chat.getAttribute('aria-selected'),
        dataOn: document.getElementById('__dsh_desktop_context_btn').getAttribute('data-on'),
        noModal: document.querySelector('.lc-modal-backdrop') === null,
      })
    })()`, true))
    if (JSON.stringify(clicked.tabClicks) !== JSON.stringify(['context']))
      fails.push(`点击按钮后 tab click=${JSON.stringify(clicked.tabClicks)} 应仅 ['context']（原生 tab 头）`)
    if (clicked.ctxSelected !== 'true') fails.push('点击按钮后「上下文」tab 未激活')
    if (clicked.chatSelected !== 'false') fails.push('点击按钮后「对话」tab 仍激活（单选未翻转）')
    if (clicked.noModal !== true) fails.push('主路径不应打开 modal')
    if (clicked.dataOn !== '1') fails.push(`tab 激活后按钮 data-on=${clicked.dataOn} 应为 1（panel-menu 蓝点源）`)

    // ── 已激活再点 → 不动作 ────────────────────────────────────
    const again = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('__dsh_desktop_context_btn').click()
      await new Promise((r) => setTimeout(r, 150))
      return JSON.stringify({
        tabClicks: [...window.__tabClicks],
        ctxSelected: ${TAB('context')}.getAttribute('aria-selected'),
        chatSelected: ${TAB('chat')}.getAttribute('aria-selected'),
      })
    })()`, true))
    // toggle 是产品语义：再点 = 切回对话（断言曾写「不动作」，与
    // openContext 的 toggle 分支冲突——存量测试债，基线升级期间暴露修正）
    if (JSON.stringify(again.tabClicks) !== JSON.stringify(['context', 'chat']))
      fails.push(`已激活时再点 tab click=${JSON.stringify(again.tabClicks)} 应为 ['context','chat']（toggle 切回对话）`)
    if (again.ctxSelected !== 'false') fails.push('toggle 后「上下文」tab 应取消激活')
    if (again.chatSelected !== 'true') fails.push('toggle 后「对话」tab 应激活')

    // ── 手动切回对话 tab（aria-selected 翻转）→ data-on 移除 ──
    const off = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      ${TAB('chat')}.click()
      await new Promise((r) => setTimeout(r, 400))
      return JSON.stringify({
        dataOn: document.getElementById('__dsh_desktop_context_btn').getAttribute('data-on'),
      })
    })()`, true))
    if (off.dataOn !== null) fails.push(`切回对话后按钮 data-on=${off.dataOn} 应已移除（observer attributes 路径）`)

    // ── 手输 /context 开 modal → 沉浸接管 + 按钮冻结 ───────────
    const modal = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      const bd = document.createElement('div')
      bd.className = 'lc-modal-backdrop'
      document.body.append(bd)
      await new Promise((r) => setTimeout(r, 500))
      const clsOn = document.documentElement.classList.contains('__dsh_ctx_mode')
      const logOn = window.__ctxLogs.includes('__dsh_ctx__:1')
      const clicksBefore = window.__tabClicks.length
      document.getElementById('__dsh_desktop_context_btn').click()
      await new Promise((r) => setTimeout(r, 150))
      const clicksAfter = window.__tabClicks.length
      bd.remove()
      await new Promise((r) => setTimeout(r, 500))
      return JSON.stringify({
        clsOn, logOn, frozen: clicksAfter === clicksBefore,
        clsOff: !document.documentElement.classList.contains('__dsh_ctx_mode'),
        logOff: window.__ctxLogs.includes('__dsh_ctx__:0'),
      })
    })()`, true))
    if (!modal.clsOn) fails.push('modal 出现后未进入沉浸模式（__dsh_ctx_mode 缺席）')
    if (!modal.logOn) fails.push('modal 出现后无 __dsh_ctx__:1 上报')
    if (!modal.frozen) fails.push('modal 期间点按钮触发了 tab 切换（应冻结不动作）')
    if (!modal.clsOff) fails.push('modal 消失后沉浸模式未退出')
    if (!modal.logOff) fails.push('modal 消失后无 __dsh_ctx__:0 上报')

    // ── 回到上下文 tab 后截图（激活态视觉档）──────────────────
    if (screenshot) {
      await win.webContents.executeJavaScript(`${TAB('context')}.click()`, true)
      await sleep(400)
      const img = await win.webContents.capturePage()
      writeFileSync('out/context-tab-dark.png', img.toPNG())
    }
  }

  // ── 回退路径：tab 缺席 → 模拟 /context 输入 ────────────────────
  if (!withCtxTab && withComposer) {
    const fallback = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
      document.getElementById('__dsh_desktop_context_btn').click()
      await new Promise((r) => setTimeout(r, 250))
      const ta = document.querySelector('[data-composer-input],[data-composer-card] textarea')
      return JSON.stringify({
        inputs: window.__inputs,
        enters: window.__enters,
        draft: ta !== null ? (ta.isContentEditable ? (ta.textContent || '') : ta.value) : null,
      })
    })()`, true))
    if (fallback.inputs < 1) fails.push('tab 缺席时未走回退输入路径（composer 无 input）')
    if (fallback.enters < 1) fails.push('回退路径未派发 Enter keydown')
    if (fallback.draft !== '/context') fails.push(`回退路径草稿=${fallback.draft} 应为 /context`)
  }

  console.log(`[${label}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  return fails.length === 0
}

// 注意：不要在 Electron 主进程 ESM 顶层 await app.whenReady() ——
// module evaluation 未完成会阻塞主进程启动序列，与 whenReady 互等死锁。
// 必须用 whenReady().then() 链。userData 指到临时目录避免与运行中的
// KCoder 应用争用 profile。
app.setPath('userData', mkdtempSync(join(tmpdir(), 'kcoder-ctx-smoke-')))
console.error('[ctx-tab-smoke] boot')
app.whenReady().then(async () => {
  console.error('[ctx-tab-smoke] app ready')
  const win = new BrowserWindow({ width: 560, height: 640, show: false })
  const results = []
  results.push(await runScenario(win, 'dark-tab', true, true, true, true))
  results.push(await runScenario(win, 'light-tab', false))
  results.push(await runScenario(win, 'no-tab-fallback', true, false, true))
  results.push(await runScenario(win, 'no-composer-disabled', true, true, false))
  results.push(await runScenario(win, 'inert-composer-disabled', true, true, true, false, true))
  console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED')
  app.exit(results.every(Boolean) ? 0 : 1)
})
