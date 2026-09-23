/**
 * workspace 顶栏收纳 DOM 冒烟：还原会话页头在**两个上游版本**下的真实结构 +
 * 一个「插件管理卡片标题行」诱饵，注入 `desktop/main/workspace-header.ts` 里
 * 那份真实 HEADER_JS，断言收纳规则的命中面。
 *
 * ## 回归背景（2026-09-23 实机定位）
 *
 * 0.1.7-alpha.1 把页头拆成两层：外层 `ConversationHeader`（占位
 * `<header class="_header">`，自带 min-height:76px + `border-bottom: 0.5px
 * solid var(--dsw-alias-border-l3)`）与内层 `ConversationSessionHeader`
 * （注册进 `conversation.session.header` slot）。于是 `_titleRow` 被 slot 容器
 * `<div data-slot="conversation.session.header">` 包住、**不再是 header 的直接
 * 子级**——只按 `> [class*="_titleRow"]` 锚定的主规则静默失效，header 容器带着
 * 76px 最小高与那条底线活下来，内容又被兜底规则收掉：页面上只剩一条空带 +
 * 孤立细线。因为 border 只在 `.headerBlank`（会话尚未开始）时被去掉，这条线
 * 表现为「任务一开始跑就冒出来」。
 *
 * ## 断言面
 *
 * - 0.1.7 形态：`_header` 容器必须 display:none（本次修复点）；
 * - ≤0.1.6 形态：`_header` 容器同样必须被收掉（旧判据不许回归）；
 * - 诱饵卡片：插件管理页的 `_card > _titleRow` 必须**原样可见**（2026-09-18
 *   那次「卡片点不动」的教训：裸 `_titleRow` 选择器会误伤）；
 * - 页头内的 `_titleRow` / `_tabs` 兜底：即使在容器规则失效的旧运行时里也要
 *   被收掉（保证「最坏情况只是顶距残留」）。
 *
 * 运行：pnpm exec electron scripts/smoke-workspace-header.mjs
 * 判别力自检：`WORKSPACE_HEADER_SRC=<另一份 workspace-header.ts>` 可换源跑，
 * 本冒烟对「只有旧直接子级规则」的版本必须 FAIL。
 *
 * @module scripts/smoke-workspace-header
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'

const BT = String.fromCharCode(96)
const SRC_PATH = process.env.WORKSPACE_HEADER_SRC ?? 'desktop/main/workspace-header.ts'
const src = readFileSync(SRC_PATH, 'utf8')
const decl = 'const HEADER_JS = ' + BT
const from = src.indexOf(decl) + decl.length
const tail = src.indexOf('\n})()' + BT, from)
const endTick = src.indexOf(BT, tail + 1)
if (from <= decl.length || tail === -1 || endTick === -1) {
  console.log(`[ws-header] FAIL: 无法从 ${SRC_PATH} 提取 HEADER_JS`)
  process.exit(1)
}
// HEADER_JS 里带 TS 侧插值（${STYLE_ID}）；冒烟按挂载侧同值还原，直接 eval
// 模板字面量即可让插值在此作用域解析。
// oxlint-disable-next-line no-unused-vars -- 供下面被 eval 的模板字面量解析 ${STYLE_ID}，静态分析看不到该引用
const STYLE_ID = '__dsh_ws_header_css'
// oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
const headerJs = eval(BT + src.slice(from, endTick) + BT)

/** 上游 dark 主题的两个关键变量（真实值取自 design-platform.css）。 */
const DARK_VARS = `:root {
  --dsw-alias-bg-base: #151517;
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-label-primary: rgb(249, 250, 251);
}`

const html = `<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><style>
${DARK_VARS}
  body { margin: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
         font: 12px -apple-system, system-ui, sans-serif; }
  /* 忠实还原上游 .header 的两个关键属性：最小高 + 底线 */
  ._header_1x, ._header_2x {
    min-height: 76px; padding: 10px 28px 0 20px; box-sizing: border-box;
    border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  }
  ._headerBlank_1x { min-height: 0; border-bottom: none; }
  ._titleRow_1z, ._titleRow_2y { min-height: 30px; display: flex; align-items: center; }
  ._tabs_1v, ._tabs_2w { height: 16px; }
  ._card_3x { border: 1px solid #333; margin: 8px; padding: 8px; }
  ._titleRow_3y { display: flex; align-items: center; }
</style></head><body>
<!-- ① 0.1.7-alpha.1：header 容器 → slot 容器 → titleRow（本次回归形态） -->
<section id="v017">
  <header class="_header_1x">
    <div class="_headerLeading_1y" data-conversation-header-leading=""></div>
    <div data-slot="conversation.session.header">
      <div class="_titleRow_1z">
        <div class="_headerCorner_1w" data-conversation-header-corner=""></div>
        <span>分析当前项目</span>
      </div>
      <div class="_tabs_1v" role="tablist"><button role="tab">对话</button></div>
    </div>
  </header>
</section>
<!-- ② ≤0.1.6-alpha.2：titleRow 是 header 的直接子级，
     且 data-conversation-header-leading 挂在 titleRow 的**子元素**上
     （0.1.6 源码：<div class=titleRow><div class=headerLeading data-…-leading>） -->
<section id="v016">
  <header class="_header_2x">
    <div class="_titleRow_2y">
      <div class="_headerLeading_2x" data-conversation-header-leading=""></div>
      <nav class="_crumbs_2z">分析当前项目</nav>
      <div class="_tabs_2w" role="tablist"><button role="tab">对话</button></div>
    </div>
  </header>
</section>
<!-- ③ 诱饵：插件管理页的配置卡片（同名 _titleRow，绝不能误伤） -->
<section id="decoy">
  <div class="_card_3x">
    <div class="_titleRow_3y"><button type="button" class="_cardOpen_3z">插件名</button></div>
  </div>
</section>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, show: false })
  const fails = []
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await win.webContents.executeJavaScript(headerJs, true)
    const probe = JSON.parse(await win.webContents.executeJavaScript(`(() => {
      const disp = (sel) => {
        const el = document.querySelector(sel)
        return el === null ? 'MISSING' : getComputedStyle(el).display
      }
      return JSON.stringify({
        header017: disp('#v017 > header'),
        titleRow017: disp('#v017 ._titleRow_1z'),
        tabs017: disp('#v017 ._tabs_1v'),
        header016: disp('#v016 > header'),
        titleRow016: disp('#v016 ._titleRow_2y'),
        decoyCard: disp('#decoy ._card_3x'),
        decoyTitleRow: disp('#decoy ._titleRow_3y'),
        decoyButton: disp('#decoy ._cardOpen_3z'),
        styleInjected: document.getElementById('__dsh_ws_header_css') !== null,
      })
    })()`, true))

    if (probe.styleInjected !== true) fails.push('样式未注入')
    if (probe.header017 !== 'none') fails.push(`0.1.7 页头容器未被收纳（${probe.header017}）—— 空带 + 孤立细线回归`)
    if (probe.titleRow017 !== 'none') fails.push(`0.1.7 标题行未被收纳（${probe.titleRow017}）`)
    if (probe.tabs017 !== 'none') fails.push(`0.1.7 标签行未被收纳（${probe.tabs017}）`)
    if (probe.header016 !== 'none') fails.push(`≤0.1.6 页头容器未被收纳（${probe.header016}）`)
    if (probe.titleRow016 !== 'none') fails.push(`≤0.1.6 标题行未被收纳（${probe.titleRow016}）`)
    if (probe.decoyCard === 'none') fails.push('诱饵卡片被误伤（插件管理卡片会点不动）')
    if (probe.decoyTitleRow === 'none') fails.push('诱饵卡片标题行被误伤')
    if (probe.decoyButton === 'none') fails.push('诱饵卡片按钮被误伤')
  } catch (error) {
    fails.push(`异常：${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`[ws-header src=${SRC_PATH}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  console.log(fails.length === 0 ? 'ALL PASS' : 'SMOKE FAILED')
  app.exit(fails.length === 0 ? 0 : 1)
})
