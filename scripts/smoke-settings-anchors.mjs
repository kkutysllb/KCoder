/**
 * 设置页注入锚点冒烟（KCoder 的两个注入页：「关于」与「数据迁移」）。
 *
 * 为什么必须有这一条：这两个页面靠**上游 DOM 锚点**把自己插进设置弹窗，并把原生分区藏掉——
 *
 *   ① `document.querySelector('[role="dialog"][aria-modal="true"]')`
 *   ② `dlg.querySelector('div[data-slot="settings.section"]') !== null`（否则整段脚本直接 bail）
 *   ③ CSS：`[role="dialog"].<MARKER> [class*="_options"] > div[data-slot="settings.section"]`
 *      `{ display: none !important }`
 *
 * 上游一改这些锚点（类名、层级、portal 位置、属性名），表现是**原生分区在注入页下重复出现**
 * ——不崩、不错位、控制台无声，只有肉眼能发现。而 `scripts/` 下原有 11 支冒烟没有一支覆盖
 * 设置页，这条链此前完全靠人眼（2026-09-25 A2 静态复核时发现）。
 *
 * 做法照抄 `smoke-account-chip.mjs`：**跑真注入脚本**（从 `desktop/main/*.ts` 抽 `PAGE_JS`
 * 模板，按主进程挂载侧的求值方式替换插值）+ **与上游编译产物同构的 fixture**
 * （容器类名取真实编译值 `_1DxxeG_options`，来自 `ui-settings-general/SettingsRoot.module.css`
 * 的 `.options`；`data-slot="settings.section"` 由 `ui-renderer/scoped-slots.tsx` 发射）。
 *
 * 断言：
 * - 注入脚本拿到了导航列并插入了自己的入口（`#__dsh_desktop_*_nav`）；
 * - 点它激活后：**原生分区 computed display === 'none'**，注入分区可见 —— 两个模块各验一遍；
 * - **判别力自检**：把容器类名换成上游改名后的形态（`_sections`），上面那条断言**必须不成立**
 *   （否则说明这条冒烟根本抓不住锚点断裂）。
 *
 * 运行：env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/smoke-settings-anchors.mjs
 * （当前环境若带 ELECTRON_RUN_AS_NODE=1，Electron 会退化成 Node 跑，`import { app } from 'electron'`
 *  直接报无此导出——所以用 `env -u` 前缀。）
 */
import { app, BrowserWindow } from 'electron'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BT = String.fromCharCode(96)

/** 上游编译产物里的真实类名（`ui-settings-general` 的 `.options`）。 */
const REAL_OPTIONS_CLASS = '_1DxxeG_options'
/** 上游若改名，锚点 `[class*="_options"]` 就落空——判别力自检用这个形态。 */
const RENAMED_OPTIONS_CLASS = 'oQd2WG_sections'

/**
 * 从模块源码抽 `const PAGE_JS = \`…\`` 模板体。
 * @param file - desktop/main 下的文件名。
 * @param replacements - 插值替换表（键为 `${…}` 原文）。
 * @returns 可在页面里直接求值的脚本源码。
 */
function extractPageJs(file, replacements) {
  const src = readFileSync(join(ROOT, 'desktop/main', file), 'utf8')
  const decl = 'const PAGE_JS = ' + BT
  const from = src.indexOf(decl) + decl.length
  if (from < decl.length) throw new Error(`${file}: 找不到 PAGE_JS`)
  // 模板以行首 `})()` + 反引号收尾（两个模块同款）
  const terminator = src.indexOf('\n})()' + BT, from)
  if (terminator < 0) throw new Error(`${file}: 找不到 PAGE_JS 结尾`)
  // 终止符本身是脚本的一部分（`})()` 收尾 IIFE）——切掉它会得到语法不完整的脚本，
  // 表现是 executeJavaScript 抛 "Script failed to execute"、注入器一行都没跑。
  let body = src.slice(from, terminator) + '\n})()'
  for (const [needle, value] of Object.entries(replacements)) body = body.split(needle).join(value)
  const leftovers = body.match(/\$\{[^}]*\}/g)
  if (leftovers !== null) throw new Error(`${file}: 仍有未替换的插值 ${leftovers.join(' ')}`)
  // ⚠️ 抽取的是**模板字面量的原始文本**，而真实运行时 `PAGE_JS` 是模板求值的结果——
  // 求值会折叠转义（`\\n` → `\n`）。漏掉这一步，页面拿到的是「双重转义」的脚本：
  // 源码里 `].join('\\n')` 本意是页面脚本里的 `'\n'`（真换行），直接投喂则成了字面量
  // 反斜杠+n，CSS 被拼成 `…}\n[role=…]`，而 CSS 把 `\n` 当转义 ⇒ 第二条起的选择器全变成
  // 元素名 `n[role=…]`、**规则静默失效**（首版冒烟就是这么误报的）。
  body = body.split('\\\\').join('\\')
  return body
}

/** 与上游同构的设置弹窗 fixture。 */
const fixture = optionsClass => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, system-ui, sans-serif; }
  [role="dialog"] { display: block; padding: 16px; }
  nav > div { display: flex; gap: 4px; }
  .${optionsClass} { padding: 8px; }
</style></head><body>
  <div class="Xy7Qk_dialog" role="dialog" aria-modal="true" aria-label="设置">
    <nav><div>
      <button type="button" aria-current="true" class="nav-on">通用</button>
      <button type="button" class="nav-off">模型</button>
    </div></nav>
    <div class="Xy7Qk_content">
      <div class="${optionsClass}">
        <div data-slot="settings.section" id="native-general">通用</div>
        <div data-slot="settings.section" id="native-model">模型</div>
      </div>
    </div>
  </div>
</body></html>`

const cases = [
  {
    name: '关于',
    file: 'about-settings.ts',
    cssId: '__dsh_desktop_about_css',
    navId: '__dsh_desktop_about_nav',
    secId: '__dsh_desktop_about_section',
    marker: '__dsh_ab_on',
    replacements: {
      '${JSON.stringify(BRAND_K_DATA_URL)}': JSON.stringify('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
      '${JSON.stringify(BRAND_CODER_DARK_DATA_URL)}': JSON.stringify('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
      '${JSON.stringify(BRAND_CODER_LIGHT_DATA_URL)}': JSON.stringify('data:image/gif;base64,R0lGODlhAQABAAAAACw='),
      '${JSON.stringify(collectAboutInfo())}': JSON.stringify({}),
    },
  },
  {
    name: '数据迁移',
    file: 'home-migration.ts',
    cssId: '__dsh_desktop_home_migration_css',
    navId: '__dsh_desktop_home_migration_nav',
    secId: '__dsh_desktop_home_migration_section',
    marker: '__dsh_hm_on',
    replacements: {},
  },
]

/** 在给定 fixture 形态下跑一个模块，返回观测结果。 */
async function observe(win, pageJs, optionsClass, testCase) {
  writeFileSync(fixturePath, fixture(optionsClass))
  await win.loadFile(fixturePath)
  try {
    await win.webContents.executeJavaScript(pageJs, true)
  } catch (error) {
    // 注入脚本可能因**占位数据**在内容渲染段抛错（本冒烟只验锚点链，不验内容）。
    // 记下来供排查，但不中断：锚点是否成立由下面的计算样式断言回答。
    pageErrors.push(`${optionsClass}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return win.webContents.executeJavaScript(`(() => {
    var nav = document.getElementById(${JSON.stringify(testCase.navId)})
    if (nav === null) return { nav: false, marked: false, nativeHidden: false, sectionVisible: false }
    nav.click()
    var dlg = document.querySelector('[role="dialog"][aria-modal="true"]')
    var native = Array.prototype.slice.call(dlg.querySelectorAll('div[data-slot="settings.section"]'))
      .filter(function (el) { return el.id.indexOf('native-') === 0 })
    var sec = document.getElementById(${JSON.stringify(testCase.secId)})
    var st = document.getElementById(${JSON.stringify(testCase.cssId)})
    return {
      nav: true,
      marked: dlg.classList.contains(${JSON.stringify(testCase.marker)}),
      stylePresent: st !== null,
      styleLength: st === null ? 0 : st.textContent.length,
      secPresent: sec !== null,
      optionsMatch: dlg.querySelector('[class*="_options"]') !== null,
      styleHead: st === null ? '' : st.textContent.slice(0, 260),
      nativeHidden: native.length > 0 && native.every(function (el) {
        return getComputedStyle(el).display === 'none'
      }),
      sectionVisible: sec !== null && getComputedStyle(sec).display !== 'none',
      nativeCount: native.length,
    }
  })()`, true)
}

const results = []
const pageErrors = []
let failed = false
function check(name, ok, detail) {
  results.push(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failed = true
}

// fixture 落盘 + userData 隔离，都照抄 smoke-account-chip.mjs 的既有范式。
const dir = mkdtempSync(join(tmpdir(), 'settings-anchors-smoke-'))
const fixturePath = join(dir, 'index.html')
app.setPath('userData', mkdtempSync(join(tmpdir(), 'kcoder-settings-smoke-')))

// ⚠️ 不要在 Electron 主进程 ESM 的**顶层** `await app.whenReady()`：它与 whenReady 互等，
// 表现是脚本挂死、连一行输出都没有（首版就这么挂的）。既有冒烟的注释里写着这条。
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 960, height: 720, show: false })
  win.webContents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.startsWith('[')) console.log('  [renderer]', message)
  })
  try {
    for (const testCase of cases) {
      const pageJs = extractPageJs(testCase.file, testCase.replacements)

      // ① 真实锚点形态：注入 → 激活 → 原生分区被藏、注入分区可见
      const good = await observe(win, pageJs, REAL_OPTIONS_CLASS, testCase)
      check(`[${testCase.name}] 导航入口注入成功`, good.nav === true)
      check(`[${testCase.name}] 激活后对话框带标记类`, good.marked === true)
      const diag = `style=${good.stylePresent ? `${good.styleLength}字符` : '缺失'} 注入分区=${good.secPresent ? '在' : '缺'} `
        + `_options命中=${good.optionsMatch ? '是' : '否'} 标记=${good.marked ? '有' : '无'}`
      check(`[${testCase.name}] 原生分区被隐藏（${good.nativeCount} 个）`, good.nativeHidden === true, good.nativeHidden ? undefined : diag)
      if (good.nativeHidden !== true) console.log('    ↳ 注入 CSS 开头：' + JSON.stringify(good.styleHead))
      check(`[${testCase.name}] 注入分区可见`, good.sectionVisible === true)

      // ② 判别力自检：上游把容器类改名的形态下，原生分区**必须没被藏掉**
      const renamed = await observe(win, pageJs, RENAMED_OPTIONS_CLASS, testCase)
      check(`[${testCase.name}] 判别力自检（类名改名 ⇒ 断言必须失败）`, renamed.nativeHidden === false)
    }
  } catch (error) {
    check('冒烟自身未抛异常', false, error instanceof Error ? error.message : String(error))
  } finally {
    win.destroy()
  }

  console.log('[smoke-settings-anchors] 设置页注入锚点（真注入脚本 + 上游同构 fixture）')
  for (const err of pageErrors) console.log(`  （页面脚本抛错，已容错）${err}`)
  for (const line of results) console.log(line)
  console.log(`[smoke-settings-anchors] ${failed ? 'FAILED' : 'ALL PASS'}（${results.length} 项）`)
  app.exit(failed ? 1 : 0)
})
