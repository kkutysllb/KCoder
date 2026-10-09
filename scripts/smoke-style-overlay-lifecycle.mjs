/**
 * style-overlay **注入生命周期**冒烟（S5 门 1 / 风险 R-2 的实测项）。
 *
 * 与姊妹脚本 `smoke-style-overlay.mjs` 的分工：
 * - 那支验**CSS 语义**：把源码里的 `*_CSS` 段拼进手搓 fixture，断言三段效果与
 *   2026-10-04 的「侧栏插件入口必须可见」决策。CSS 是**内联**进 fixture 的，
 *   因此**完全没有覆盖注入机制**。
 * - 这支验**注入机制本身**：真的调用产品代码 `attachStyleOverlay()`
 *   （`desktop/main/style-overlay.ts`，经 esbuild 编译后 import——不是照着源码
 *   重敲一遍），在真 BrowserWindow 上跑完整生命周期。
 *
 * 为什么必须有这一条（R-2）：「在插件管理页停用→再启用内置插件」是这个升级里
 * 风险最高的一次实测。上游 `ui-plugin-manager` 的 `setBundleEnabled` 返回
 * `application: 'applied' | 'restart-required'`；我们的 `desktop/main/windows.ts`
 * 在**引擎重启导致端口变化**时会 `loadURL`（整页加载）。于是覆盖层有两种必须
 * 都成立的存活路径：
 *
 *   ① `applied`（热应用，无整页加载）→ head 里已注入的 `<style>` 原地留存；
 *   ② `restart-required`（端口变 → `loadURL` → 整页加载）→ `did-finish-load`
 *      重新触发注入。
 *
 * 两条都靠 `STYLE_ID` 幂等替换兜底（不得产生重复 style），并且**不得**动到
 * 别人注入的 style —— 断言里放了一份「外来插件样式」作为被触碰即红的对照组。
 *
 * 断言（29 项）：
 * - 首次加载后注入发生、**恰好一份**、CSS 与源码合成结果一致（归一化后逐字）；
 * - 三段语义**经由真注入路径**（不是内联）仍然成立；原生右栏五个外壳元素**不得**被压制（2026-10-09 铁律 1 翻转）；
 * - 外来插件样式与 body 上的外来属性未被触碰；
 * - **整页重载后仍恰好一份**（幂等：重复注入不得叠出第二份）+ 语义仍成立；
 * - **覆盖层被抹掉后重载能自愈**（模拟插件启停把 style 清掉的最坏情况）；
 * - 窗口关闭后 `did-finish-load` 监听被摘除（不泄漏）。
 *
 * 运行：pnpm run smoke:style-overlay-lifecycle
 * （底层等价于 `env -u ELECTRON_RUN_AS_NODE pnpm exec electron
 *   scripts/smoke-style-overlay-lifecycle.mjs`）
 *
 * ⚠️ 依赖说明：用 workspace 里 vite 带来的 `esbuild`（未在本仓 package.json 声明，
 * 故走 pnpm store 的显式路径解析）。解析不到时**显式失败**，不静默跳过——静默跳过
 * 等于这条门消失。
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'


const ROOT = resolve(import.meta.dirname, '..')

/**
 * 被测源码路径。默认就是产品文件；**负对照**（证明本冒烟真能红）可指到一份改坏的
 * 副本上，从而不必改动产品树——照本仓既有做法（姊妹脚本用 /tmp 副本重加压制段）。
 * 指向副本时需把 `dsh-contract.ts` 一并复制到同目录（相对 import）。
 */
const OVERLAY_SRC = process.env.KCODER_STYLE_OVERLAY_SRC ?? join(ROOT, 'desktop/main/style-overlay.ts')

/**
 * 解析 esbuild：本仓未声明该依赖，它由 vite 带进 pnpm store。
 * 解析不到即**显式失败**（见模块头「依赖说明」）——静默跳过等于这条门消失。
 * @returns esbuild 模块。
 */
function loadEsbuild() {
  const req = createRequire(import.meta.url)
  const searchPaths = [join(ROOT, 'node_modules/.pnpm/node_modules'), join(ROOT, 'node_modules')]
  const entry = req.resolve('esbuild', { paths: searchPaths })
  return req(entry)
}
const STYLE_ID = '__dsh_desktop_style_override'
const FOREIGN_CSS = '.foreign-marker { color: rgb(1, 2, 3) }'

const fails = []
let total = 0
const check = (ok, message) => { total += 1; if (!ok) fails.push(message) }
const settle = (ms) => new Promise((r) => setTimeout(r, ms))
/** 进度打到 stderr：本脚本要跑真窗口，挂住时 stdout 看不到任何东西。 */
const step = (name) => { console.error(`[step] ${name}`) }
const finish = (code) => {
  const line = fails.length === 0
    ? `PASS ${String(total)}/${String(total)}（真 attachStyleOverlay：首载注入 + 幂等重载 + 自愈 + 不碰外来样式 + 关闭摘监听）`
    : `FAIL ${String(total - fails.length)}/${String(total)}:\n${fails.map((f) => '  - ' + f).join('\n')}`
  // writeSync 而非 console.log：app.exit() 立即终止进程，stdout 上未冲刷的内容会被
  // 截断——本冒烟首跑就丢过整段结论行（exit=0 却看不到 PASS）。
  try { writeSync(1, line + '\n') } catch { console.log(line) }
  setTimeout(() => { app.exit(code) }, 50)
}
/** 看门狗：冒烟永远挂着比红了更糟（拿不到结论还得人工 kill）。 */
const WATCHDOG_MS = 90_000
const watchdog = setTimeout(() => {
  console.error(`[watchdog] ${String(WATCHDOG_MS)}ms 内未跑完，强制退出。最后完成的步骤见上方 [step]。`)
  finish(3)
}, WATCHDOG_MS)

// 关掉最后一个窗口时 Electron 默认走 `window-all-closed → app.quit()`，会在
// 「关闭后监听已摘除」那条断言之前把进程带走（表现为 exit=0 却没有任何结论行）。
// 空处理器阻止自动退出——终止时机由 finish() 控制。
app.on('window-all-closed', () => { /* 保持进程，以便断言关闭后的状态 */ })

// ---- 0. 从源码抽 CSS 段（源序）+ 归一化，作为「应有的注入内容」 ----
const src = readFileSync(OVERLAY_SRC, 'utf8')
const SEGMENTS = [...src.matchAll(/const ([A-Z_]{3,}_CSS) = `([\s\S]*?)`/g)]
  .map((m) => [m[1], m[2].replaceAll(/\$\{[^}]*\}/g, 'data:AA')])
/** 资产 data URL 的真实字节随构建而变，故两侧归一化后比较。 */
// 行尾也必须归一：源码在工作树里是 CRLF（Git autocrlf），而注入后的 CSS 经 CSS
// 解析器读回时换行已被归一成 LF——不归一就会在 Windows 上恒判「内容漂移」
// （2026-10-10 本机 28/30：注入 1063 vs 应为 1095，差值恰为段内换行数）。
const norm = (s) => s.replaceAll(/data:[^"')\s]*/g, 'data:AA').replaceAll(/\r\n?/g, '\n').trim()
const expectedCss = norm(SEGMENTS.map(([, css]) => css).join('\n\n'))
// 段数 4 → 3（2026-10-09）：NATIVE_SIDEBAR_CSS 随 dsh-coding-sidebar 退役摘除，
// 产品侧对原生右栏不再有任何压制。反向断言同时钉住「它不得回流」。
const EXPECTED_SEGMENTS = ['RAIL_BROWSER_ACTIONS_CSS', 'SETTINGS_DIALOG_HEADER_CSS', 'HERO_WATERMARK_CSS']
const RETIRED_SEGMENTS = ['NATIVE_SIDEBAR_CSS']
check(
  SEGMENTS.length === EXPECTED_SEGMENTS.length
    && EXPECTED_SEGMENTS.every((n) => SEGMENTS.some(([got]) => got === n)),
  `源码 CSS 段数=${String(SEGMENTS.length)} 应为 ${String(EXPECTED_SEGMENTS.length)}（实际：${SEGMENTS.map(([n]) => n).join(', ')}）`,
)
for (const retired of RETIRED_SEGMENTS) {
  check(!SEGMENTS.some(([got]) => got === retired), `退役段 ${retired} 回流（2026-10-09 铁律 1 已翻转，原生右栏不再压制）`)
}

// ---- 1. 编译并 import 真产品代码（不是重敲源码） ----
const workdir = mkdtempSync(join(tmpdir(), 'style-overlay-lifecycle-'))
// CJS 而非 ESM：`dsh-contract.ts` 的 resolveAsset 用了 `__dirname`，打成 ESM 会在
// 求值期抛 "__dirname is not defined in ES module scope"（本冒烟首跑即如此）。
const bundle = join(workdir, 'style-overlay.cjs')

/**
 * 把 `__dirname` 钉成**真实的 `desktop/main`**：`dsh-contract.ts` 用
 * `resolve(__dirname,'..','..')` 推 PROJECT_ROOT，而产物落在临时目录时会一路回落到
 * Electron.app 的 Resources，于是 `style-overlay.ts` 求值期读水印资产 ENOENT
 * （本冒烟第二、三次跑即如此）。钉住之后 PROJECT_ROOT = 仓库根，水印走**真资产**，
 * 顺带获得一条真实回归信号：`assets/brand-k.png` 缺失即红。
 */
let attachStyleOverlay
try {
  const { buildSync } = loadEsbuild()
  buildSync({
    entryPoints: [OVERLAY_SRC],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    define: { __dirname: JSON.stringify(join(ROOT, 'desktop/main')) },
    logLevel: 'silent',
  })
  ;({ attachStyleOverlay } = createRequire(import.meta.url)(bundle))
  check(typeof attachStyleOverlay === 'function', 'esbuild 产物未导出 attachStyleOverlay')
} catch (err) {
  check(false, `编译/导入 desktop/main/style-overlay.ts 失败：${err instanceof Error ? err.message : String(err)}`)
}

// ---- 2. fixture：上游 DOM 同构，且**不含**覆盖层 CSS（CSS 必须由真注入带进来） ----
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }
  .s_panelList button { display: inline-block; width: 80px; height: 32px; }
  .a_rail { width: 200px; height: 40px; }
  .x_head { height: 24px; width: 120px; }
  .f_header { height: 32px; width: 120px; }
  #heroScroll { height: 100px; }
</style>
<!-- 对照组：模拟「别的插件注入的样式」。覆盖层不得改写/移除它。 -->
<style id="__foreign_plugin_style">${FOREIGN_CSS}</style>
</head><body data-foreign-plugin="kept">
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

const fixturePath = join(workdir, 'index.html')
writeFileSync(fixturePath, html)

/** 页面内取证（与姊妹脚本同款双判据）。 */
const PROBE = `(() => {
  const hidden = (id) => {
    const el = document.getElementById(id)
    return getComputedStyle(el).display === 'none' && el.offsetWidth === 0
  }
  const visible = (id) => {
    const el = document.getElementById(id)
    return getComputedStyle(el).display !== 'none' && el.offsetWidth > 0
  }
  const hits = document.querySelectorAll('[id="__dsh_desktop_style_override"]')
  const foreign = document.getElementById('__foreign_plugin_style')
  return JSON.stringify({
    overlayCount: hits.length,
    overlayCss: hits.length === 1 ? hits[0].textContent : null,
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
    heroBeforeBg: getComputedStyle(document.getElementById('heroScroll'), '::before').backgroundImage.slice(0, 4),
    foreignCss: foreign === null ? null : foreign.textContent,
    foreignAttr: document.body.dataset.foreignPlugin ?? null,
  })
})()`

/** 语义断言（三段 + 原生右栏不压制）——首载/重载/自愈各验一遍，确保「经由真注入」也成立。 */
function checkSemantics(r, label) {
  check(r.entryPlugins, `[${label}] 侧栏「插件」入口不可见（2026-10-04 恢复决策未生效）`)
  check(r.entryDeck, `[${label}] 第三方 panellist 条目被误伤`)
  check(
    r.nativeShellVisible.length === 5,
    `[${label}] 原生右侧栏外壳未全部可见：可见 ${r.nativeShellVisible.join(',') || '无'}、被压制 ${r.nativeShellHidden.join(',') || '无'}`,
  )
  check(r.railHead && r.railSearch, `[${label}] 折叠 rail 未收（RAIL_BROWSER_ACTIONS_CSS 失效）`)
  check(r.railCollapsedHead, `[${label}] \`_collapsed\` 形态被误伤（:not 精度丢失）`)
  check(r.dlgHeader, `[${label}] 设置对话框头部未收（SETTINGS_DIALOG_HEADER_CSS 失效）`)
  check(r.sectionHeader, `[${label}] 无 close 直子的自绘分区头被误伤`)
  check(r.heroPosition === 'relative', `[${label}] hero position=${r.heroPosition}`)
  check(r.heroBeforeBg === 'url(', `[${label}] hero ::before 背景=${r.heroBeforeBg}…`)
}

app.whenReady().then(async () => {
  try {
  step('创建窗口 + attach（产品同序：先 attach、后 load）')
  const win = new BrowserWindow({ show: false, width: 1280, height: 800 })
  const wc = win.webContents
  const nextLoad = () => new Promise((r) => { wc.once('did-finish-load', () => { r() }) })

  // 产品里是「先 attach、后 load」（windows.ts: decorateShellWindow → loadURL），照同序。
  if (typeof attachStyleOverlay === 'function') attachStyleOverlay(win)

  step('首次加载 fixture')
  let loaded = nextLoad()
  await win.loadFile(fixturePath)
  await loaded
  await settle(250)

  // --- 首次加载 ---
  step('首载取证')
  let r = JSON.parse(await wc.executeJavaScript(PROBE, true))
  check(r.overlayCount === 1, `首次加载后覆盖层 style 份数=${String(r.overlayCount)} 应为 1（注入未发生或重复注入）`)
  check(r.overlayCss !== null && norm(r.overlayCss) === expectedCss,
    `注入 CSS 与源码合成不一致（段数/顺序/内容漂移）：注入 ${String(r.overlayCss === null ? 0 : norm(r.overlayCss).length)} 字符，应为 ${String(expectedCss.length)}`)
  checkSemantics(r, '首载')
  check(r.foreignCss === FOREIGN_CSS, `外来插件样式被改写（${String(r.foreignCss)}）`)
  check(r.foreignAttr === 'kept', `body 上的外来属性被清（${String(r.foreignAttr)}）`)

  // --- 重复 attach + 整页重载（模拟 restart-required → 端口变 → loadURL） ---
  // 只 reload 一次是**测不到幂等守卫的**：整页加载会重建文档，旧 style 本就没了，
  // 于是「每次注入都新建」的坏实现照样只剩一份（本冒烟首版负对照即为此而 PASS）。
  // 真正逼出守卫的是**同一文档内 inject 跑两次**——重复 attach 即该形态，
  // 也正是 `attachStyleOverlay` 文档所声称的「重复调用安全」。
  step('重复 attach（幂等声明）+ 整页重载')
  if (typeof attachStyleOverlay === 'function') attachStyleOverlay(win)
  step('整页重载（幂等性）')
  loaded = nextLoad()
  wc.reload()
  await loaded
  await settle(250)
  r = JSON.parse(await wc.executeJavaScript(PROBE, true))
  check(r.overlayCount === 1, `重载后覆盖层份数=${String(r.overlayCount)} 应为 1（did-finish-load 未重注入或叠了第二份）`)
  check(r.overlayCss !== null && norm(r.overlayCss) === expectedCss, '重载后注入 CSS 与源码合成不一致')
  checkSemantics(r, '重载')

  // --- 最坏情况：覆盖层被抹掉 → 重载自愈 ---
  step('抹掉覆盖层 → 重载自愈')
  await wc.executeJavaScript(
    `(() => { const el = document.getElementById('${STYLE_ID}'); if (el !== null) el.remove() })()`, true)
  const gone = JSON.parse(await wc.executeJavaScript(PROBE, true))
  check(gone.overlayCount === 0, '前置动作失败：覆盖层没被抹掉，自愈断言无意义')
  loaded = nextLoad()
  wc.reload()
  await loaded
  await settle(250)
  r = JSON.parse(await wc.executeJavaScript(PROBE, true))
  check(r.overlayCount === 1 && r.entryPlugins && r.nativeShellVisible.length === 5,
    `覆盖层被抹掉后未能自愈（份数=${String(r.overlayCount)}）`)

  // --- 关闭窗口：did-finish-load 监听应被摘除 ---
  step('关闭窗口 → 监听摘除')
  const before = wc.listenerCount('did-finish-load')
  win.close()
  await settle(150)
  let after = -1
  try { after = wc.listenerCount('did-finish-load') } catch { after = 0 }
  check(before >= 1 && after === 0, `窗口关闭后监听未摘除（before=${String(before)} after=${String(after)}）`)

  clearTimeout(watchdog)
  try { rmSync(workdir, { recursive: true, force: true }) } catch { /* 临时目录，忽略 */ }
  step('完成')
  finish(fails.length === 0 ? 0 : 1)
  } catch (err) {
    clearTimeout(watchdog)
    console.error(`[fatal] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    check(false, `未捕获异常：${err instanceof Error ? err.message : String(err)}`)
    finish(2)
  }
})
