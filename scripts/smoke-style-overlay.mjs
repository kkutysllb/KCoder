/**
 * style-overlay 注入 CSS 冒烟：从源码抽出全部 `<NAME>_CSS` 片段（不写死
 * 段数——新增/改名段会被自动纳入，压制回归无从藏身）→ 拼装进手搓的上游
 * DOM fixture → 断言剩余三段的**语义**与两条产品决策：
 *
 * - **侧栏「插件」入口必须可见**（产品负责人 2026-10-04 拍板恢复上游
 *   workspace 插件菜单；设置页「内置插件 → 插件管理」tab 同期保留、不在
 *   本文件作用面内）。fixture 同时放一枚第三方 panellist 条目，证明压制
 *   从未（也不得）做成「整条 nav 收掉」；
 * - **原生右侧栏不得再被压制**（2026-10-09，铁律 1 翻转）：dsh-coding-sidebar
 *   整线退役、右侧工作台交回上游原生，本文件抽出并拼装的 CSS 里不得再出现
 *   右栏压制锚点（静态保护），fixture 里那五个原生右栏外壳元素必须**全部可见**
 *   （动态保护）。两道保护都做了「有人把压制加回来就红」的取向；
 * - **静态回退保护**：拼装后的 CSS 不得出现 panellist 锚点
 *   （`panelList` / `aria-label="插件"` / `aria-label="Plugins"`）——有人把
 *   压制加回来会当场红；
 * - 其余三段仍然生效：折叠 rail 的 sectionHeader/search 收掉而 `_collapsed`
 *   形态不收（选择器精度）；设置对话框头部「带 close 直子」收掉、「自绘头」
 *   不受影响（双保险守卫）；hero 水印的 ::before 仍带 data URL 背景与
 *   relative 定位。
 *
 * 运行：pnpm run smoke:style-overlay        ← 已挂进 package.json（2026-10-04）
 * （底层等价于 `env -u ELECTRON_RUN_AS_NODE pnpm exec electron
 *   scripts/smoke-style-overlay.mjs`；`ELECTRON_RUN_AS_NODE` 会把 electron
 *   当纯 Node 启动、拿不到 app/BrowserWindow，故须 env -u 解除）
 * 手调也可：pnpm exec electron scripts/smoke-style-overlay.mjs
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** 源码里应存在的三段（缺段即失败——段被删等于压制/水印静默消失）。 */
const EXPECTED = ['RAIL_BROWSER_ACTIONS_CSS', 'SETTINGS_DIALOG_HEADER_CSS', 'HERO_WATERMARK_CSS']

/** panellist 锚点：拼装后的 CSS 出现任一即「压制回归」。 */
const ANCHORS = ['panelList', 'aria-label="插件"', 'aria-label="Plugins"']

/**
 * 原生右侧栏压制锚点：拼装后的 CSS 出现任一即「铁律 1 压制回归」
 * （2026-10-09 翻转后，产品侧对原生右栏不再有任何压制面）。
 */
const RIGHTBAR_ANCHORS = ['data-sidebar-right', 'data-rightbar-col', "data-side='rightbar'", 'data-side="rightbar"']

const fails = []
let total = 0
const check = (ok, message) => { total += 1; if (!ok) fails.push(message) }

// ---- 1. 抽段（模板串内无嵌套反引号；插值占位为合法小 data URL） ----
const src = readFileSync(join(ROOT, 'desktop/main/style-overlay.ts'), 'utf8')
const segments = new Map()
for (const m of src.matchAll(/const ([A-Z_]{3,}_CSS) = `([\s\S]*?)`/g)) {
  segments.set(m[1], m[2].replaceAll(/\$\{[^}]*\}/g, 'data:image/png;base64,AA=='))
}
check(segments.size === EXPECTED.length, `CSS 段数=${String(segments.size)} 应为 ${String(EXPECTED.length)}（实际：${[...segments.keys()].join(', ')}）`)
for (const name of EXPECTED) check(segments.has(name), `缺段 ${name}`)

// 拼装用**全部**抽到的段（不是 EXPECTED 四段）：这样新增/改名的压制段也会
// 真正作用到 fixture 上，被 DOM 断言抓住——EXPECTED 只负责「该在的在不在」。
const css = [...segments.values()].join('\n\n')
for (const anchor of ANCHORS) {
  check(!css.includes(anchor), `CSS 出现 panellist 锚点「${anchor}」——侧栏「插件」入口压制回归（2026-10-04 已由产品决策移除）`)
}
for (const anchor of RIGHTBAR_ANCHORS) {
  check(!css.includes(anchor), `CSS 出现原生右栏压制锚点「${anchor}」——铁律 1 压制回归（2026-10-09 已随插件退役翻转，右侧工作台归上游原生）`)
}

// ---- 2. fixture：上游 panellist / 原生右侧栏外壳 / rail / 设置对话框 / hero ----
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }
  .s_panelList button { display: inline-block; width: 80px; height: 32px; }
  .a_rail { width: 200px; }
  .x_head { height: 24px; }
  .f_header { height: 32px; }
${css}
</style></head><body>
<nav class="s_panelList">
  <button id="entryPlugins" aria-label="插件">插件</button>
  <button id="entryDeck" aria-label="演示文稿">演示文稿</button>
</nav>
<div data-sidebar-right-expand id="shellExpand">expand</div>
<div data-sidebar-right-panel id="shellPanel">panel</div>
<div data-sidebar-right-session id="shellSession">session</div>
<div data-rightbar-col id="shellCol">col</div>
<div data-side="rightbar" id="shellSplit">split</div>
<div class="a_rail b_root" id="rail">
  <div class="c_sectionHeader" id="railHead">新建工作区</div>
  <div class="d_search" id="railSearch">搜索</div>
</div>
<div class="a_rail b_root e_collapsed" id="railCollapsed">
  <div class="c_sectionHeader" id="railCollapsedHead">新建工作区</div>
</div>
<div data-shortcut-modal="settings" id="dlg">
  <div class="f_header" id="dlgHeader"><button class="g_close" id="dlgClose">×</button></div>
  <div class="f_header" id="sectionHeader">分区自绘头</div>
</div>
<div data-phase="hero"><div data-conversation-scroll id="heroScroll">hero</div></div>
</body></html>`

/** 页面内取证：隐藏/可见一律「computed display + offsetWidth」双判据。 */
const PROBE = `(() => {
  const hidden = (id) => {
    const el = document.getElementById(id)
    return getComputedStyle(el).display === 'none' && el.offsetWidth === 0
  }
  const visible = (id) => {
    const el = document.getElementById(id)
    return getComputedStyle(el).display !== 'none' && el.offsetWidth > 0
  }
  const heroBefore = getComputedStyle(document.getElementById('heroScroll'), '::before')
  return JSON.stringify({
    entryPlugins: visible('entryPlugins'),
    entryDeck: visible('entryDeck'),
    nativeShellVisible: ['shellExpand', 'shellPanel', 'shellSession', 'shellCol', 'shellSplit'].filter(visible),
    nativeShellHidden: ['shellExpand', 'shellPanel', 'shellSession', 'shellCol', 'shellSplit'].filter(hidden),
    railHead: hidden('railHead'),
    railSearch: hidden('railSearch'),
    railCollapsedHead: visible('railCollapsedHead'),
    dlgHeader: hidden('dlgHeader'),
    sectionHeader: visible('sectionHeader'),
    heroPosition: getComputedStyle(document.getElementById('heroScroll')).position,
    heroBeforeBg: heroBefore.backgroundImage.slice(0, 4),
  })
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 })
  const dir = mkdtempSync(join(tmpdir(), 'style-overlay-smoke-'))
  writeFileSync(join(dir, 'index.html'), html)
  await win.loadFile(join(dir, 'index.html'))
  await new Promise((r) => setTimeout(r, 300))
  const r = JSON.parse(await win.webContents.executeJavaScript(PROBE, true))

  // 产品决策：上游侧栏「插件」入口可见（恢复），第三方 panellist 条目不受影响
  check(r.entryPlugins, '侧栏「插件」入口不可见——2026-10-04 恢复决策未生效（压制又回来了？）')
  check(r.entryDeck, '第三方 panellist 条目被误伤（压制做了整条 nav 收掉）')
  // 原生右侧栏不得再被压制（2026-10-09 铁律 1 翻转）
  check(
    r.nativeShellVisible.length === 5,
    `原生右侧栏外壳未全部可见：可见 ${r.nativeShellVisible.join(',') || '无'}（应 5/5）、被压制 ${r.nativeShellHidden.join(',') || '无'}`,
  )
  // 其余三段仍生效
  check(r.railHead, '折叠 rail sectionHeader 未收（RAIL_BROWSER_ACTIONS_CSS 失效）')
  check(r.railSearch, '折叠 rail search 未收（RAIL_BROWSER_ACTIONS_CSS 失效）')
  check(r.railCollapsedHead, '`_collapsed` 形态被误伤（选择器 :not 精度丢失）')
  check(r.dlgHeader, '设置对话框头部未收（SETTINGS_DIALOG_HEADER_CSS 失效）')
  check(r.sectionHeader, '无 close 直子的自绘分区头被误伤（双保险守卫丢失）')
  check(r.heroPosition === 'relative', `hero 滚动区 position=${r.heroPosition} 应为 relative（水印定位丢失）`)
  check(r.heroBeforeBg === 'url(', `hero ::before 背景=${r.heroBeforeBg}… 应为 url( 开头（水印丢失）`)

  console.log(fails.length === 0
    ? `PASS ${String(total)}/${String(total)}（插件入口恢复 + 原生右栏不再压制 + 两组锚点静态保护 + 其余三段）`
    : `FAIL ${String(total - fails.length)}/${String(total)}:\n${fails.join('\n')}`)
  app.exit(fails.length === 0 ? 0 : 1)
})
