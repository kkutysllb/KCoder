/**
 * workspace 顶栏收纳 DOM 冒烟：按**两个上游版本形态**分别还原会话页头真实结构，
 * 注入 `desktop/main/workspace-header.ts` 里那份真实 HEADER_JS，断言
 * 「收进标题栏但不丢状态徽章」的新行为。
 *
 * ## 回归背景
 *
 * 1. **2026-09-23**：0.1.7-alpha.1 把页头拆成两层（外层 `ConversationHeader`
 *    占位 + 内层 `ConversationSessionHeader` 注册进 slot），只按
 *    `> [class*=_titleRow]` 锚定的规则静默失效 → 只剩一条空带 + 孤立细线。
 * 2. **2026-10-05（本文件当前断言面）**：旧实现把整块页头 `display:none`，
 *    于是注册在 `conversation.session.header.actions` 槽里的**四类状态徽章全体
 *    消失**——上游 `client-ui-agent-preset`（预设）、
 *    `experimental/client-ui-agent-team`（智能体团队）、
 *    `client-ui-subagent`（子代理）、`client-ui-jobs`（后台任务）。用户反馈
 *    「开了智能体团队却不显示、也看不到在跑的代理/后台任务」。
 *    新实现：页头 `position:fixed` 覆盖进 48px 自绘标题栏带内、透明、
 *    `pointer-events:none`，只把状态簇座位放开可交互并靠右对齐。
 *
 * ## 断言面
 *
 * - 两形态页头都必须**被搬进标题栏**（fixed / 48px 高 / min-height:0 / 无底线 /
 *   不 display:none）——纵向空间收益必须保住；
 * - `_crumbs` / `_tabs` / `[data-conversation-header-leading]` 仍必须收掉
 *   （自绘标题栏已显示「工作区 / 会话标题」；标签行是第二行）；
 * - **状态徽章必须可见且命中原生命中测试**（`elementFromPoint` 返回按钮自身，
 *   不是被覆盖层/容器吃掉）——这是本次修复的判别点：旧实现下徽章 display:none；
 * - **徽章必须紧跟标题之后**（行首内边距＝`--dsh-titlebar-title-end` + 10px，
 *   夹具把它钉在 240px ⇒ 徽章左缘必须是 250px）——2026-10-05 第二轮用户反馈的
 *   判别点：首版靠右对齐，徽章堆在按钮带左侧；
 * - **工具座位顶到行末**（`.headerUtilities` 的 `margin-left:auto`，
 *   右缘贴按钮带）——上游那半个几何（标题之后是徽章、行末是工具）；
 * - **会话头「…」必须被移除**（上游 session-log-export 的 `_moreButton`），
 *   **但同一座位里的另一枚工具按钮不得被误伤**（外科式，不是整块收掉）；
 * - **跨注入器契约**：`--dsh-titlebar-status-w` 必须是「徽章簇 + 工具 + 角位
 *   + 固定间距」的**分量之和**，且必须**小于 titleRow 整宽**——那条 auto
 *   外边距混进来会把标题压成 0 宽（首版量整宽侥幸成立）；
 * - 状态簇必须**不得越进按钮带**（默认让位 70px；`_headerCorner` 的
 *   `margin-right:-16px` 必须被归零，否则末枚会滑进按钮带）；
 * - `_titleRow` 的容器型 containment 必须被解除（否则徽章宽度会随行宽
 *   断点收缩，让位宽度不再是内容函数）；
 * - 诱饵卡片：插件管理页的 `_card > _titleRow` 必须**原样可见且未被搬动**
 *   （2026-09-18「卡片点不动」的教训：泛名 `_titleRow` 会误伤）；
 * - 幂等：重复注入不叠加 style 元素。
 *
 * ## 夹具为什么分两次加载
 *
 * 两形态的页头都是 `position:fixed`，同一页里必然叠在同一坐标（真实产品只有
 * 一个页头）——第一次写在同一页时，「角位徽章命中」被另一形态的徽章遮住而误报。
 * 每个 fixture 各加载一次页面即可还原真实条件。
 *
 * ## 夹具必须还原 `display:contents`
 *
 * 上游 slot 锚（`<div data-slot="…">`）带 `display:contents`（ui-renderer 的
 * `ANCHOR_STYLE`，注释原文："display:contents keeps it layout-neutral"）——
 * **该锚不是盒**，故 `_titleRow` 实际就是页头这条 flex 行的直接项目。
 * 2026-10-05 第二轮踩到：夹具当初写成普通 div，`_titleRow` 的 `flex:1` 得不到
 * 可拉伸的父宽 → 整行只有内容宽 → 「工具座位顶到行末」断言假红。夹具已改为
 * 带 `style="display:contents"`；两形状也各钉一条（V016 无 slot 锚，直接子级）。
 *
 * 运行：`env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/smoke-workspace-header.mjs`
 * （本机终端若导出了 `ELECTRON_RUN_AS_NODE=1`，electron 会被按纯 Node 启动而报
 * 「does not provide an export named 'BrowserWindow'」——必须 unset。）
 * 判别力自检：`WORKSPACE_HEADER_SRC=<另一份 workspace-header.ts>` 可换源跑，
 * 本冒烟对**改动前**那份（整块 display:none）必须 FAIL。
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
// HEADER_JS 里带 TS 侧插值（${STYLE_ID} 等）；冒烟按挂载侧同值还原，直接 eval
// 模板字面量即可让插值在此作用域解析。
/* eslint-disable no-unused-vars */
const STYLE_ID = '__dsh_ws_header_css'
const TITLEBAR_H_VAR = '--dsh-titlebar-h'
const TITLEBAR_RIGHT_VAR = '--dsh-titlebar-right-reserve'
const TITLEBAR_TITLE_END_VAR = '--dsh-titlebar-title-end'
const TITLE_GAP = 10
const STATUS_GAP = 20
const CORNER_GAP = 8
const STATUS_W_VAR = '--dsh-titlebar-status-w'
const TITLE_EVENT = '__dsh_title_changed'
/* eslint-enable no-unused-vars */
// 提取失败必须在**加载时**响亮失败：源码里若出现未转义的反引号（模板字面量被
// 提前截断），eval 会抛在模块顶层 —— Electron 主进程不会因此退出，冒烟就变成
// "永远挂着不出结论"（2026-10-05 实际踩到：注释里写了裸反引号）。
let headerJs
try {
  // oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
  headerJs = eval(BT + src.slice(from, endTick) + BT)
  // eslint-disable-next-line no-new-func -- 同上：只做语法检查，不执行
  new Function(headerJs)
} catch (error) {
  console.log(`[ws-header] FAIL: 提取的 HEADER_JS 不是合法 JS（${error instanceof Error ? error.message : String(error)}）`)
  console.log('SMOKE FAILED')
  process.exit(1)
}
// 看门狗：任何阶段卡住都不许静默悬挂（本仓既有教训）
const watchdog = setTimeout(() => {
  console.log('[ws-header] FAIL: 超时未出结论（看门狗 30s）')
  console.log('SMOKE FAILED')
  process.exit(1)
}, 30000)
watchdog.unref?.()

/** 上游真实布局的关键声明（值取自 ConversationRoot.module.css）。 */
const UPSTREAM_CSS = `
  :root { --dsw-alias-border-l3: rgba(255,255,255,.16); }
  body { margin: 0; background: #151517; color: #f9fafb;
         font: 12px -apple-system, system-ui, sans-serif; }
  ._header_x {
    min-height: 76px; padding: 10px 28px 0 20px; box-sizing: border-box;
    border-bottom: 0.5px solid var(--dsw-alias-border-l3);
  }
  ._titleRow_x {
    min-height: 30px; display: flex; align-items: center; container-type: inline-size;
  }
  ._titleCluster_x { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; }
  ._crumbs_x { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; white-space: nowrap; }
  ._crumbCurrent_x { font-weight: 500; }
  ._headerActions_x { display: flex; flex: none; align-items: center; gap: 8px; }
  ._headerUtilities_x { display: flex; flex: none; align-items: center; gap: 8px; margin-left: 20px; }
  ._headerUtilities_x:empty { display: none; }
  ._headerCorner_x { display: flex; flex: none; align-items: center; margin-left: 8px; margin-right: -16px; }
  ._headerCorner_x:empty { display: none; }
  ._tabs_x { height: 16px; margin-top: 10px; }
  ._card_x { border: 1px solid #333; margin: 8px; padding: 8px; }
  ._titleRow_x_decoy { display: flex; align-items: center; }
`
/** 状态槽内容：预设徽章 + 智能体团队 + 角位日志（四类注册方的代表形状）。 */
const STATUS_SLOT = `
  <span class="_presetLabel_x">标准模式</span>
  <button type="button" id="teamBtn">智能体团队</button>
`
/** 诱饵：插件管理页的配置卡片（同名 _titleRow，绝不能误伤/误搬）。 */
const DECOY = `
<section id="decoy">
  <div class="_card_x">
    <div class="_titleRow_x_decoy"><button type="button" id="decoyBtn">插件名</button></div>
  </div>
</section>`
/** ① 0.1.7-alpha.1：header → slot 容器 → titleRow → 状态槽。 */
const BODY_V017 = `
<section id="v017">
  <header class="_header_x">
    <div data-conversation-header-leading=""></div>
    <div data-slot="conversation.session.header" style="display:contents">
      <div class="_titleRow_x">
        <nav class="_crumbs_x"><span class="_crumbCurrent_x">分析当前项目</span></nav>
        <div class="_titleCluster_x">
          <div class="_headerActions_x">
            <div data-slot="conversation.session.header.actions">${STATUS_SLOT}</div>
          </div>
        </div>
        <div class="_headerUtilities_x"><button type="button" id="openInAppBtn">⧉</button><button type="button" class="_moreButton_x" id="moreBtn">…</button></div>
        <div class="_headerCorner_x" data-conversation-header-corner="">
          <button type="button" id="cornerBtn">日志</button>
        </div>
      </div>
      <div class="_tabs_x" role="tablist"><button role="tab">对话</button></div>
    </div>
  </header>
</section>
${DECOY}`
/** ② ≤0.1.6：titleRow 是 header 的直接子级，标记挂在 titleRow 的子元素上。 */
const BODY_V016 = `
<section id="v016">
  <header class="_header_x">
    <div class="_titleRow_x">
      <div data-conversation-header-leading=""></div>
      <nav class="_crumbs_x"><span class="_crumbCurrent_x">分析当前项目</span></nav>
      <div class="_headerActions_x">
        <div data-slot="conversation.session.header.actions">
          <button type="button" id="teamBtn">智能体团队</button>
        </div>
      </div>
      <div class="_headerUtilities_x"><button type="button" id="openInAppBtn">⧉</button><button type="button" class="_moreButton_x" id="moreBtn">…</button></div>
      <div class="_headerCorner_x" data-conversation-header-corner="">
        <button type="button" id="cornerBtn">日志</button>
      </div>
      <div class="_tabs_x" role="tablist"><button role="tab">对话</button></div>
    </div>
  </header>
</section>
${DECOY}`
const page = (body) => `<!doctype html><html data-platform="darwin"><head><meta charset="utf-8"><style>${UPSTREAM_CSS}</style></head><body>${body}</body></html>`

const PROBE = `(() => {
  const el = (sel) => document.querySelector(sel)
  const cs = (sel) => { const n = el(sel); return n === null ? null : getComputedStyle(n) }
  const box = (sel) => { const n = el(sel); return n === null ? null : n.getBoundingClientRect() }
  const hits = (sel) => {
    const n = el(sel)
    if (n === null) return 'MISSING'
    const r = n.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return at === null ? 'NONE' : (at === n || n.contains(at) ? 'SELF' : at.tagName + '#' + at.id)
  }
  const tr = box('header .' + '_titleRow_x')
  const span = (sel) => {
    const r = box(sel)
    return r === null ? null : { left: Math.round(r.left), right: Math.round(r.right) }
  }
  return JSON.stringify({
    vw: window.innerWidth,
    header: { pos: cs('header').position, disp: cs('header').display,
              minH: cs('header').minHeight, bbw: cs('header').borderBottomWidth,
              pe: cs('header').pointerEvents, h: Math.round(box('header').height),
              padLeft: cs('header').paddingLeft },
    crumbs: cs('header .' + '_crumbs_x')?.display,
    leading: cs('header [data-conversation-header-leading]')?.display ?? 'MISSING',
    tabs: cs('header .' + '_tabs_x')?.display,
    titleRow: { disp: cs('header .' + '_titleRow_x')?.display ?? 'MISSING',
                ct: cs('header .' + '_titleRow_x')?.containerType ?? 'MISSING',
                right: tr === null ? -1 : Math.round(tr.right),
                top: tr === null ? -1 : Math.round(tr.top),
                bottom: tr === null ? -1 : Math.round(tr.bottom) },
    actions: { disp: cs('header .' + '_headerActions_x')?.display ?? 'MISSING',
               pe: cs('header .' + '_headerActions_x')?.pointerEvents ?? 'MISSING',
               span: span('header .' + '_headerActions_x') },
    preset: cs('header .' + '_presetLabel_x')?.display ?? 'MISSING',
    team: hits('#teamBtn'),
    corner: { mr: cs('header .' + '_headerCorner_x')?.marginRight ?? 'MISSING',
              right: box('header .' + '_headerCorner_x')?.right ?? -1,
              span: span('header .' + '_headerCorner_x') },
    utils: { ml: cs('header .' + '_headerUtilities_x')?.marginLeft ?? 'MISSING',
             span: span('header .' + '_headerUtilities_x') },
    more: cs('#moreBtn')?.display ?? 'MISSING',
    openInApp: cs('#openInAppBtn')?.display ?? 'MISSING',
    cornerBtn: hits('#cornerBtn'),
    decoyCard: cs('._card_x')?.display,
    decoyTitleRow: { disp: cs('._titleRow_x_decoy')?.display, pos: cs('._titleRow_x_decoy')?.position },
    decoyButton: hits('#decoyBtn'),
    channels: {
      statusW: getComputedStyle(document.documentElement).getPropertyValue('${STATUS_W_VAR}').trim(),
      titleEnd: getComputedStyle(document.documentElement).getPropertyValue('--dsh-titlebar-title-end').trim(),
    },
    styleInjected: document.getElementById('${STYLE_ID}') !== null,
    styleCount: document.querySelectorAll('#${STYLE_ID}').length
  })
})()`

const BAND = 70
/** 夹具给自绘标题栏主文本右缘的假值：徽章必须落在它之后（+ TITLE_GAP）。 */
const TITLE_END = 240

/** 每个 fixture 各加载一次（fixed 页头不能在同页共存，见模块头注释）。 */
async function runShape(win, name, body, opts) {
  const fails = []
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(body)))
  // 模拟自绘标题栏已发布主文本右缘（真实链路由 theme-watcher 注入的脚本写入）
  await win.webContents.executeJavaScript(
    `document.documentElement.style.setProperty('--dsh-titlebar-title-end','${TITLE_END}px')`, true)
  await win.webContents.executeJavaScript(headerJs, true)
  await win.webContents.executeJavaScript(headerJs, true) // 幂等
  const p = JSON.parse(await win.webContents.executeJavaScript(PROBE, true))
  if (process.env.WS_HEADER_DEBUG === '1') console.log(`[${name}] probe=`, JSON.stringify(p))
  const band = p.vw - BAND
  const w = (s) => (s === null ? 0 : s.right - s.left)
  const clusterW = w(p.actions.span)
  const utilsW = w(p.utils.span)
  const cornerW = w(p.corner.span)
  const tag = (s) => `[${name}] ${s}`
  if (p.styleInjected !== true) fails.push(tag('样式未注入'))
  if (p.styleCount !== 1) fails.push(tag(`style 元素不幂等（${p.styleCount} 个）`))
  if (p.header.disp === 'none') fails.push(tag('页头仍被 display:none —— 状态徽章会全体消失（本次回归点）'))
  if (p.header.pos !== 'fixed') fails.push(tag(`页头未搬进标题栏（position=${p.header.pos}）`))
  if (p.header.minH !== '0px') fails.push(tag(`页头最小高未归零（${p.header.minH}）`))
  if (p.header.bbw !== '0px') fails.push(tag(`页头底线未去掉（${p.header.bbw}）`))
  if (p.header.pe !== 'none') fails.push(tag(`页头未让开事件（pointer-events=${p.header.pe}）`))
  if (p.header.h !== 48) fails.push(tag(`页头高度应为 48（实为 ${p.header.h}）`))
  if (p.crumbs !== 'none') fails.push(tag(`面包屑未收纳（${p.crumbs}）`))
  if (p.tabs !== 'none') fails.push(tag(`标签行未收纳（${p.tabs}）`))
  if (opts.hasLeading && p.leading === 'MISSING') fails.push(tag('夹具缺少 data-conversation-header-leading（锚点判据之一）'))
  if (opts.hasLeading && p.leading !== 'none') fails.push(tag(`上游窗口控件座位未收纳（${p.leading}）`))
  if (p.titleRow.disp === 'none') fails.push(tag('状态簇座位被收掉（徽章不可见）'))
  if (p.titleRow.ct !== 'normal') fails.push(tag(`containment 未解除（container-type=${p.titleRow.ct}）`))
  if (p.actions.disp === 'none') fails.push(tag('状态槽被收掉'))
  if (p.actions.pe !== 'auto') fails.push(tag(`状态槽不可交互（pointer-events=${p.actions.pe}）`))
  if (opts.hasPreset && p.preset === 'none') fails.push(tag('预设徽章不可见（上游 AgentPresetLabel 被抹掉）'))
  if (p.team !== 'SELF') fails.push(tag(`智能体团队徽章命中失败（${p.team}）`))
  if (p.cornerBtn !== 'SELF') fails.push(tag(`角位徽章命中失败（${p.cornerBtn}）`))
  if (p.corner.mr !== '0px') fails.push(tag(`角位负右边距未归零（${p.corner.mr}）——末枚徽章会滑进按钮带`))
  // —— 2026-10-05 第二轮：徽章紧跟标题（箭头位置），工具座位顶到行末 ——
  if (p.header.padLeft !== `${TITLE_END + TITLE_GAP}px`) {
    fails.push(tag(`行首内边距未接到标题右缘（${p.header.padLeft} ≠ ${TITLE_END + TITLE_GAP}px）——徽章不会紧跟标题`))
  }
  if (p.actions.span === null) fails.push(tag('状态簇不可量'))
  else if (Math.abs(p.actions.span.left - (TITLE_END + TITLE_GAP)) > 1) {
    fails.push(tag(`徽章未落在标题之后（左缘 ${p.actions.span.left} ≠ ${TITLE_END + TITLE_GAP}）`))
  }
  // 注：`margin-left:auto` 的 computedStyle 是**已用值**（Chrome 解析成 px），
  // 故不按关键字断言；「顶到行末」由下面的自由间距与角位右缘两条几何断言证明。
  if (p.utils.ml === '20px') fails.push(tag('工具座位仍是上游固定 20px 左边距（auto 未生效）'))
  if (p.utils.span === null || p.corner.span === null) fails.push(tag('工具/角位座位不可量'))
  else {
    // 行末是**角位**（上游 headerCorner 的 margin-right:-16px 已被归零），
    // 工具座位紧排在它之前——两者合起来吃满 auto 外边距吸走的那段。
    if (Math.abs(p.corner.span.right - band) > 1) {
      fails.push(tag(`角位未贴到按钮带（右缘 ${p.corner.span.right} ≠ ${band}）`))
    }
    if (p.utils.span.right > p.corner.span.left + 0.5) {
      fails.push(tag(`工具座位越到角位之后（${p.utils.span.right} > ${p.corner.span.left}）`))
    }
    if (Math.abs(p.titleRow.right - band) > 1) {
      fails.push(tag(`titleRow 未铺满整行（右缘 ${p.titleRow.right} ≠ ${band}）——auto 外边距无处可吸`))
    }
    const freeGap = p.utils.span.left - (p.actions.span?.right ?? 0)
    if (freeGap < 20) {
      fails.push(tag(`工具座位未顶到行末（与徽章间距仅 ${freeGap}px，auto 外边距没吸到剩余空间）`))
    }
  }
  // —— 「…」清洗：只摘会话日志菜单那枚，工具座位的另一枚必须留着 ——
  if (p.more !== 'none') fails.push(tag(`会话头「…」未被移除（display=${p.more}）——用户明确要求不要`))
  if (opts.hasPreset && p.openInApp === 'none') fails.push(tag('工具座位被整块误伤（open-in-app 也不见了）'))
  // —— 跨注入器契约：--dsh-titlebar-status-w 必须是「分量之和」，不是 titleRow 整宽 ——
  const expectStatus = clusterW + TITLE_GAP
    + (utilsW > 0 ? utilsW + 20 : 0) + (cornerW > 0 ? cornerW + 8 : 0)
  // 逐分量取整后求和，与注入侧（同样逐分量 Math.round）可差 1px 的亚像素余量
  const statusNum0 = Number.parseFloat(p.channels.statusW)
  if (!(Math.abs(statusNum0 - expectStatus) <= 1)) {
    fails.push(tag(`让位宽度不是分量之和（${p.channels.statusW} ≠ ${expectStatus}px）`))
  }
  // 判别「误量 titleRow 整宽」：整宽含把 utilities 顶到行末的 auto 外边距，
  // 量整宽会把主文本 max-width 压成 0（首版把行靠右时侥幸没暴露）
  const rowW = p.vw - Number.parseFloat(p.header.padLeft) - BAND
  const statusNum = Number.parseFloat(p.channels.statusW)
  if (!(statusNum < rowW - 10)) {
    fails.push(tag(`让位宽度疑似量了 titleRow 整宽（${p.channels.statusW} ≥ 行宽 ${rowW}）——会把标题压成 0 宽`))
  }
  if (p.titleRow.right > band + 0.5) fails.push(tag(`状态簇越进按钮带（右缘 ${p.titleRow.right} > ${band}）`))
  if (p.titleRow.top < 0 || p.titleRow.bottom > p.header.h) fails.push(tag(`状态簇不在标题栏带内（y ${p.titleRow.top}–${p.titleRow.bottom}）`))
  if (p.decoyCard === 'none') fails.push(tag('诱饵卡片被误伤（插件管理卡片会点不动）'))
  if (p.decoyTitleRow.disp === 'none') fails.push(tag('诱饵卡片标题行被误伤'))
  if (p.decoyTitleRow.pos === 'fixed') fails.push(tag('诱饵卡片标题行被误搬进标题栏'))
  if (p.decoyButton !== 'SELF') fails.push(tag(`诱饵卡片按钮被误伤（命中 ${p.decoyButton}）`))
  return { fails, probe: p }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 600, show: false })
  let fails = []
  try {
    const a = await runShape(win, '0.1.7', BODY_V017, { hasLeading: true, hasPreset: true })
    const b = await runShape(win, '≤0.1.6', BODY_V016, { hasLeading: false, hasPreset: false })
    fails = [...a.fails, ...b.fails]
  } catch (error) {
    fails.push(`异常：${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`[ws-header src=${SRC_PATH}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  console.log(fails.length === 0 ? 'ALL PASS' : 'SMOKE FAILED')
  app.exit(fails.length === 0 ? 0 : 1)
})
