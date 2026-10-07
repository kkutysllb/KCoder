/**
 * 自绘标题栏 DOM 冒烟：注入 `desktop/main/theme-watcher.ts` 里那份真实
 * SHELL_TITLEBAR_JS（+ workspace-header 的 HEADER_JS 以还原两注入器的真实
 * 叠加），断言主文本来源与跨注入器交互。
 *
 * ## 回归背景（2026-10-05）
 *
 * 主文本原取 `document.title`。上游 `DocumentTitle` 投射的是
 * 「会话标题 — 产品名」，而产品名是**构建期内联**的 `DSH_CLIENT_TITLE`
 * （scripts/client-build-environment.ts）；本产品构建未内联 → `?? ` 回退到
 * locale 键 `brand.localBuild`＝**「DSH 本地构建」**，于是标题栏一直挂着这串
 * 与产品无关的字。同时旧实现只为 `AgentPresetLabel` 抄了一枚合成预设徽章
 * （--dsh-agent-preset 通道），上游其余三类状态徽章（智能体团队/子代理/任务）
 * 全被页头的 display:none 抹掉。
 *
 * 修法：主文本改读**面包屑当前项**（`[class*=_crumbCurrent]`，与 DocumentTitle
 * 同源的 session.title，但不带产品名），活通道由 workspace-header 派发
 * `__dsh_title_changed` 事件；合成预设徽章删除（真徽章已在标题栏带内可见）。
 *
 * ## 断言面
 *
 * - 标题栏文本含工作区名 + 会话标题；**即使 `document.title` 里带着产品名，
 *   标题栏也绝不含它**（判别点）；也不含硬编码回退 'KCoder'；
 * - 几何通道：`--dsh-titlebar-h`=48px、`--dsh-titlebar-right-reserve`=70px
 *   （darwin）必须写到 documentElement，供 workspace-header 消费；
 * - 绘制层级：标题栏 z-index 必须**低于**页头覆盖层（否则徽章被条的背景盖住）
 *   ——注意这是**绘制**主张，与「能不能点」是两件事；
 * - **app-region（能不能点，2026-10-05 第三轮）**：用上游合成模型
 *   （ui-web window-drag/regions.ts：按几何 + DOM 顺序、忽略层叠，最后被收集的
 *   盒子决定）判定若干点。夹具必须建出 app-region 层（base.css 的 drag 声明、
 *   可交互元素 no-drag、ConversationRoot 的簇级 no-drag、页头的 data-window-drag），
 *   否则判据退化为恒 false 的**假绿** —— 上一版夹具漏了这一层，只用
 *   elementFromPoint 断言「可点」，把「看得见、点不动」判成了绿。断言：
 *   徽章（button **与裸 span** 两形态）所在点不可拖；条左侧空白必须仍可拖；
 *   自绘条必须排在 #root 之前；
 * - 跨注入器 DOM 命中：状态徽章必须**点在徽章上**（不是条），而条的空白处必须
 *   **仍归条**（页头 pointer-events:none 生效）——两者缺一都是真 bug；
 * - 标签 `max-width` 必须含 `--dsh-titlebar-status-w`（为徽章让位）；
 * - 合成预设徽章不得回流：标签子元素恒为 3（工作区按钮 / 分隔符 / 标题）；
 * - 活通道：面包屑文本变化后标题栏必须在下一拍内更新；
 * - 静态守卫：源码里主文本赋值不得退回 `document.title`。
 *
 * 运行：`env -u ELECTRON_RUN_AS_NODE pnpm exec electron scripts/smoke-titlebar.mjs`
 * （本机终端若导出了 `ELECTRON_RUN_AS_NODE=1`，electron 会被按纯 Node 启动。）
 * 判别力自检：`KCODER_TITLEBAR_SRC=<另一份 theme-watcher.ts>` 可换源跑；对把
 * 主文本退回 document.title 的版本必须 FAIL。
 * 判别力自检（app-region 面）：`KCODER_TITLEBAR_BAR_MODE=append` 把「条排在
 * #root 之前」改回旧写法，必须 FAIL（徽章被吞）。
 *
 * @module scripts/smoke-titlebar
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'

const BT = String.fromCharCode(96)
const SRC_PATH = process.env.KCODER_TITLEBAR_SRC ?? 'desktop/main/theme-watcher.ts'
const src = readFileSync(SRC_PATH, 'utf8')

/** 从源码里按「模板串起点 → 收尾反引号」切出可执行原文（含闭合的 \n})()）。 */
function extract(source, name) {
  const decl = `const ${name} = ` + BT
  const from = source.indexOf(decl) + decl.length
  const tail = source.indexOf('\n})()' + BT, from)
  if (tail === -1) return null
  // 收尾反引号的位置：必须含闭合的 })()，切到 tail 会漏掉收尾而语法不全
  const endTick = source.indexOf(BT, tail + 1)
  return endTick === -1 ? null : source.slice(from, endTick)
}

const barBody = extract(src, 'SHELL_TITLEBAR_JS')
const headerBody = extract(readFileSync('desktop/main/workspace-header.ts', 'utf8'), 'HEADER_JS')
if (barBody === null || headerBody === null) {
  console.log(`[titlebar] FAIL: 无法从 ${SRC_PATH} 提取注入脚本`)
  process.exit(1)
}

// 判别力自检（负对照）：把「条排在 #root 之前」改回旧写法（append 到末尾）——
// 上游契约下条会成为最后一个 app-region 盒子、把徽章整片吞掉，本冒烟必须因此
// FAIL。用法：`KCODER_TITLEBAR_BAR_MODE=append …`。替换必须命中，否则负对照
// 变成静默空转（假绿）。
const BAR_MODE = process.env.KCODER_TITLEBAR_BAR_MODE ?? 'insert'
const barBodyUsed = BAR_MODE === 'append'
  ? barBody.replace('document.body.insertBefore(bar, root)', 'document.body.append(bar)')
  : barBody
if (BAR_MODE === 'append' && barBodyUsed === barBody) {
  console.log('[titlebar] FAIL: 负对照替换未命中（源码里找不到 insertBefore(bar, root)）')
  process.exit(1)
}

// 让被 eval 的模板字面量里的 ${…} 在本作用域解析（与挂载侧同值）。
/* eslint-disable no-unused-vars */
const SHELL_TITLEBAR_HEIGHT = 48
const TITLEBAR_H_VAR = '--dsh-titlebar-h'
const TITLEBAR_RIGHT_VAR = '--dsh-titlebar-right-reserve'
const TITLEBAR_RIGHT_BAND = 70
const TITLEBAR_STATUS_VAR = '--dsh-titlebar-status-w'
const TITLEBAR_TITLE_END_VAR = '--dsh-titlebar-title-end'
const TITLEBAR_TITLE_EVENT = '__dsh_title_changed'
const TP = { leftPad: 78, padRight: 0 } // darwin
const STYLE_ID = '__dsh_ws_header_css'
const TITLE_EVENT = '__dsh_title_changed'
const STATUS_W_VAR = '--dsh-titlebar-status-w' // workspace-header 注入脚本用的名字
const TITLE_GAP = 10
const STATUS_GAP = 20
const CORNER_GAP = 8
/* eslint-enable no-unused-vars */
// 提取/求值失败必须在**加载时**响亮退出：模块顶层抛错时 Electron 不结束进程，
// 冒烟会变成"永远挂着不出结论"（2026-10-05 连续踩到两次：源码多一个未转义
// 反引号、少一个插值常量，症状都是挂住而非红）。
let barJs
let headerJs
try {
  // oxlint-disable-next-line no-eval -- 测试夹具:按模板字符串语义还原页面注入源码
  barJs = eval(BT + barBodyUsed + BT)
  // oxlint-disable-next-line no-eval -- 同上
  headerJs = eval(BT + headerBody + BT)
  // eslint-disable-next-line no-new-func -- 同前：只做语法检查，不执行
  new Function(barJs)
  // eslint-disable-next-line no-new-func -- 同上
  new Function(headerJs)
} catch (error) {
  console.log(`[titlebar] FAIL: 注入脚本无法求值（${error instanceof Error ? error.message : String(error)}）`)
  console.log('SMOKE FAILED')
  process.exit(1)
}

const PRODUCT_TAIL = 'DSH 本地构建'
const SESSION_TITLE = '分析当前项目'
const WS_NAME = '论文'

// 真实宿主**没有** data-platform：本壳无 preload（sidebar-toggle.ts 模块注释），
// 引擎 web bundle 只读不写它（AppFrame.tsx:168 读 dataset.platform），写它的是
// 上游桌面壳的 preload。而上游那张 app-region 表（base.css 的 drag 行与可交互
// 元素削减、ConversationRoot 的四簇削减）**整流作用域在 html[data-platform='darwin']
// 下** ⇒ 在真机上一条都不生效。夹具必须照此建模（带该标记的夹具会掩盖真根因，
// 2026-10-05 第二版冒烟就是这样假的绿）。KCODER_TITLEBAR_PLATFORM=1 可切到
// 「上游桌面端」形态，用来验证我们补的那层与上游原有的规则**兼容且幂等**。
const PLATFORM_ATTR = process.env.KCODER_TITLEBAR_PLATFORM === '1' ? ' data-platform="darwin"' : ''

const html = `<!doctype html><html${PLATFORM_ATTR}><head><meta charset="utf-8"><style>
  :root { --dsh-ws-name: ${WS_NAME}; --dsw-specific-sidebar-fill: #1b1b1c; --dsw-alias-border-l3: rgba(255,255,255,.16); }
  body { margin: 0; background: #151517; color: #f9fafb; font: 12px -apple-system, system-ui, sans-serif; }
  ._header_x { min-height: 76px; padding: 10px 28px 0 20px; box-sizing: border-box;
               border-bottom: .5px solid var(--dsw-alias-border-l3); }
  ._titleRow_x { min-height: 30px; display: flex; align-items: center; container-type: inline-size; }
  ._titleCluster_x { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; }
  ._crumbs_x { display: flex; align-items: center; gap: 4px; }
  ._headerActions_x { display: flex; flex: none; align-items: center; gap: 8px; }
  ._headerUtilities_x { display: flex; flex: none; align-items: center; gap: 8px; margin-left: 20px; }
  ._headerUtilities_x:empty { display: none; }
  ._headerCorner_x { display: flex; flex: none; align-items: center; margin-left: 8px; margin-right: -16px; }
  ._headerCorner_x:empty { display: none; }
  ._tabs_x { height: 16px; }
  /* —— app-region 层（2026-10-05 第三轮补建）——
     上一版夹具漏了这一层，却用 elementFromPoint 断言「徽章可点」，于是把
     「看得见、点不动」判成了绿：DOM 命中与窗口可拖拽是两码事。
     下列三条是**上游原样**的 app-region 表（逐条照抄）：
     · ui-web base.css:55 —— 拖拽行标记 → 唯一 drag 声明；
     · ui-web base.css:82-90 —— 可交互元素自我削减 no-drag；
     · ui-layout ConversationRoot.module.css:57-62 —— 四簇级 no-drag。
     注意它们整流作用域在 html[data-platform='darwin'] 下，而默认夹具（真实宿主
     形态）**没有**该标记 ⇒ 这三条**全部失效**：断言必须在「上游那层不在场」的
     前提下也成立，否则修的是夹具不是产品。KCODER_TITLEBAR_PLATFORM=1 时才生效，
     用于验证我们补的那层与上游规则兼容。 */
  html[data-platform='darwin'] [data-window-drag] { -webkit-app-region: drag; }
  html[data-platform='darwin'] :is(
    button, a, input, select, textarea, summary, [contenteditable='true'], [tabindex],
    [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip'],
    [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'],
    [role='menuitemradio'], [role='option'], [role='checkbox'], [role='radio'], [role='switch'],
    [role='slider'], [role='combobox'], [role='textbox']
  ) { -webkit-app-region: no-drag; }
  html[data-platform='darwin'] ._headerActions_x,
  html[data-platform='darwin'] ._headerUtilities_x,
  html[data-platform='darwin'] ._headerCorner_x { -webkit-app-region: no-drag; }
</style></head><body>
<div id="root">
<header class="_header_x" data-window-drag>
  <div data-conversation-header-leading=""></div>
  <div data-slot="conversation.session.header" style="display:contents">
    <div class="_titleRow_x">
      <nav class="_crumbs_x"><span class="_crumbCurrent_x">${SESSION_TITLE}</span></nav>
      <div class="_titleCluster_x">
        <div class="_headerActions_x">
          <div data-slot="conversation.session.header.actions">
            <button type="button" id="teamBtn">智能体团队</button>
            <span id="presetBadge">标准模式</span>
          </div>
        </div>
      </div>
      <div class="_headerUtilities_x"><button type="button" class="_moreButton_x" id="moreBtn">…</button></div>
      <div class="_headerCorner_x" data-conversation-header-corner="">
        <button type="button" id="cornerBtn">日志</button>
      </div>
    </div>
    <div class="_tabs_x" role="tablist"><button role="tab">对话</button></div>
  </div>
</header>
<!-- 带内、但**不在会话页头作用域**里的可交互元素（真机对应右栏页签
     「文件 × / 任务管理 ×」，其 y 落在 48px 带内）。它只能靠 theme-watcher 补的
     那条**可交互元素 no-drag** 得救：上游 base.css 那份同样挂在平台标记下，
     真机上不生效。 -->
<button type="button" id="panelTab" style="position:fixed;top:8px;left:600px">任务管理</button>
</div>
</body></html>`

const PROBE = `(async () => {
  const el = (sel) => document.querySelector(sel)
  const cs = (sel) => { const n = el(sel); return n === null ? null : getComputedStyle(n) }
  const hit = (n) => {
    if (n === null) return 'MISSING'
    const r = n.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return at === null ? 'NONE' : (at === n || n.contains(at) ? 'SELF' : at.tagName + '#' + at.id)
  }
  // —— 上游 app-region 合成模型（逐字移植 ui-web window-drag/regions.ts）——
  // 「按几何 + DOM 顺序、忽略层叠，最后被收集的盒子决定」：判定为可拖 ⇒ 点击
  // 在 Electron 原生窗口层就被吃掉，到不了页面。**这才是「能不能点」的判据**；
  // elementFromPoint 只回答 DOM 命中（pointer-events），看不见这一层。
  const collectRegions = () => {
    const out = []
    for (const n of Array.from(document.querySelectorAll('*'))) {
      const st = getComputedStyle(n)
      const region = st.getPropertyValue('-webkit-app-region')
      if (region !== 'drag' && region !== 'no-drag') continue
      if (st.visibility === 'hidden' || st.display === 'none') continue
      const r = n.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      out.push({ x: r.x, y: r.y, width: r.width, height: r.height, draggable: region === 'drag' })
    }
    return out
  }
  const isDraggableAt = (regions, x, y) => {
    let draggable = false
    for (const r of regions) {
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) draggable = r.draggable
    }
    return draggable
  }
  const dragAt = (n, regions) => {
    if (n === null) return null
    const r = n.getBoundingClientRect()
    return isDraggableAt(regions, r.left + r.width / 2, r.top + r.height / 2)
  }
  const bar = document.getElementById('__dsh_desktop_titlebar')
  const label = bar === null ? null : bar.firstElementChild
  const before = bar === null ? '' : bar.textContent
  // 活通道：改面包屑文本 → workspace-header 的观察者应派发事件 → 标题栏更新
  const crumb = el('[class*="_crumbCurrent"]')
  if (crumb !== null) crumb.textContent = '改过的标题'
  await new Promise((resolve) => setTimeout(resolve, 300))
  const after = bar === null ? '' : bar.textContent
  // 收集放在最后：settle 之后的几何才是终态
  const regions = collectRegions()
  const rootEl = document.getElementById('root')
  return JSON.stringify({
    regionCount: regions.length,
    dragBoxes: regions.filter((r) => r.draggable).length,
    noDragBoxes: regions.filter((r) => !r.draggable).length,
    teamDrag: dragAt(el('#teamBtn'), regions),
    // 诊断：命中徽章点的 app-region 盒子（按 DOM 顺序）。默认夹具无 data-platform
    // ⇒ 上游那层失效，这里的 no-drag 只可能来自**本产品自己补的簇级削减**；
    // 若只剩 titlebar=drag 一条，说明徽章仍在被吞。
    teamBoxes: (() => {
      const n = el('#teamBtn')
      if (n === null) return []
      const r = n.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const out = []
      for (const m of Array.from(document.querySelectorAll('*'))) {
        const st = getComputedStyle(m)
        const region = st.getPropertyValue('-webkit-app-region')
        if (region !== 'drag' && region !== 'no-drag') continue
        if (st.visibility === 'hidden' || st.display === 'none') continue
        const b = m.getBoundingClientRect()
        if (b.width === 0 || b.height === 0) continue
        if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
          out.push(m.tagName + (m.id === '' ? '' : '#' + m.id) + '=' + region)
        }
      }
      return out
    })(),
    presetDrag: dragAt(el('#presetBadge'), regions),
    wsBtnDrag: dragAt(el('#__dsh_ws_btn'), regions),
    // 带内但不在会话页头作用域里的可交互元素（右栏页签一类）
    panelTabDrag: dragAt(el('#panelTab'), regions),
    // 条左侧空白（红绿灯区）：无内容覆盖，应仍可拖窗
    bandEmptyDrag: isDraggableAt(regions, 20, 24),
    // 诊断：按 DOM 顺序列出命中 (20,24) 的 app-region 盒子（失败时直接看出是谁
    // 把这一点的拖拽权削掉的，不必再猜）
    bandEmptyBoxes: (() => {
      const out = []
      for (const n of Array.from(document.querySelectorAll('*'))) {
        const st = getComputedStyle(n)
        const region = st.getPropertyValue('-webkit-app-region')
        if (region !== 'drag' && region !== 'no-drag') continue
        if (st.visibility === 'hidden' || st.display === 'none') continue
        const r = n.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (20 >= r.x && 20 < r.x + r.width && 24 >= r.y && 24 < r.y + r.height) {
          out.push(n.tagName + (n.id === '' ? '' : '#' + n.id) + '=' + region)
        }
      }
      return out
    })(),
    barBeforeRoot: bar === null || rootEl === null ? null
      : (bar.compareDocumentPosition(rootEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    vw: window.innerWidth,
    docTitle: document.title,
    barExists: bar !== null,
    before, after,
    barZ: bar === null ? null : getComputedStyle(bar).zIndex,
    headerZ: cs('header').zIndex,
    labelMaxWidth: label === null ? null : label.style.maxWidth,
    labelChildren: label === null ? 0 : label.children.length,
    labelTexts: label === null ? [] : [...label.children].map((c) => c.textContent),
    geomH: document.documentElement.style.getPropertyValue('--dsh-titlebar-h'),
    geomRight: document.documentElement.style.getPropertyValue('--dsh-titlebar-right-reserve'),
    statusW: document.documentElement.style.getPropertyValue('--dsh-titlebar-status-w'),
    titleEnd: document.documentElement.style.getPropertyValue('--dsh-titlebar-title-end'),
    labelRight: label === null ? null : Math.round(label.getBoundingClientRect().right),
    actionsLeft: (() => { const n = el('[class*="_headerActions"]'); return n === null ? null : Math.round(n.getBoundingClientRect().left) })(),
    moreDisp: cs('#moreBtn')?.display ?? 'MISSING',
    teamHit: hit(el('#teamBtn')),
    barLabelHit: hit(label),
    headerHit: hit(el('header')),
    teamRect: (() => { const n = el('#teamBtn'); if (n === null) return null
      const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) } })()
  })
})()`

app.whenReady().then(async () => {
  // 看门狗：注入脚本抛错时 Electron 默认不退出（main 里 await 链断在半途），
  // 脚本会永久挂住——超时即判 FAIL 并退出，绝不留悬挂进程。
  const watchdog = setTimeout(() => {
    console.log('[titlebar] FAIL: 看门狗超时 30s —— 注入脚本可能抛错后窗口未关')
    app.exit(1)
  }, 30_000)
  const win = new BrowserWindow({ width: 900, height: 600, show: false })
  // executeJavaScript 的失败只给通用信息；真错在渲染进程控制台，必须转发出来
  win.webContents.on('console-message', (...args) => {
    const e = args[0]
    const text = e !== null && typeof e === 'object' && 'message' in e
      ? `${e.sourceId ?? ''}:${e.lineNumber ?? ''} ${e.message}`
      : String(args[1] ?? '')
    console.log(`[renderer] ${text}`)
  })
  /** 逐步执行：失败时报出是哪一段，而不是笼统的「Script failed to execute」。 */
  const step = async (name, script) => {
    try {
      return await win.webContents.executeJavaScript(script, true)
    } catch (error) {
      throw new Error(`步骤「${name}」失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const fails = []
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    // 夹具的 document.title 故意带产品名：旧实现（读 document.title）会把它显示出来
    await step('设置 document.title',
      `document.title = ${JSON.stringify(`${SESSION_TITLE} — ${PRODUCT_TAIL}`)}`)
    await step('注入 workspace-header', headerJs)
    await step('注入自绘标题栏', barJs)
    const p = JSON.parse(await step('读取探针', PROBE))

    // 静态守卫：主文本赋值不得退回 document.title（本次回归点）
    if (/ttlTag\.textContent\s*=\s*\(?\s*document\.title/.test(src)) {
      fails.push('源码里主文本又退回 document.title（产品名会重新挂上条）')
    }
    if (p.docTitle.indexOf(PRODUCT_TAIL) === -1) {
      fails.push(`夹具失效：document.title 未带产品名（${p.docTitle}）——判别力前提不成立`)
    }
    if (p.barExists !== true) fails.push('标题栏未注入')
    if (p.before.indexOf(PRODUCT_TAIL) !== -1) fails.push(`标题栏文本含产品名「${PRODUCT_TAIL}」（${p.before}）`)
    if (p.before.indexOf('KCoder') !== -1) fails.push(`标题栏文本含硬编码回退 'KCoder'（${p.before}）`)
    if (p.before.indexOf(SESSION_TITLE) === -1) fails.push(`标题栏未显示会话标题（${p.before}）`)
    if (p.before.indexOf(WS_NAME) === -1) fails.push(`标题栏未显示工作区名（${p.before}）`)
    if (p.after.indexOf('改过的标题') === -1) fails.push(`面包屑活通道未生效（改后仍为「${p.after}」）`)
    if (p.after.indexOf(PRODUCT_TAIL) !== -1) fails.push('活通道更新后重新引入产品名')
    if (p.geomH.trim() !== '48px') fails.push(`--dsh-titlebar-h 未发布或值不对（${p.geomH}）`)
    if (p.geomRight.trim() !== '70px') fails.push(`--dsh-titlebar-right-reserve 未发布或值不对（${p.geomRight}）`)
    if (p.statusW.trim() === '' || p.statusW.trim() === '0px') {
      fails.push(`--dsh-titlebar-status-w 未量出（${p.statusW}）——长标题会钻到徽章下面`)
    }
    // —— 2026-10-05 第二轮：跨注入器端到端（标题右缘 → 徽章左缘）——
    // 这条是本轮需求的判别点：徽章必须在**主文本实测右缘之后**，而不是靠右堆到
    // 按钮带左侧（首版）。左右两侧都是真实测量：右边由 theme-watcher 发布、
    // 左边由 workspace-header 消费，中间只隔一条 CSS 变量。
    if (p.titleEnd.trim() === '') fails.push('--dsh-titlebar-title-end 未发布（徽章无处对齐）')
    if (p.titleEnd.trim() !== `${p.labelRight}px`) {
      fails.push(`--dsh-titlebar-title-end 与主文本实测右缘不一致（${p.titleEnd} ≠ ${p.labelRight}px）`)
    }
    if (p.actionsLeft === null || Math.abs(p.actionsLeft - (p.labelRight + TITLE_GAP)) > 1) {
      fails.push(`徽章未落在主文本之后（左缘 ${p.actionsLeft} ≠ ${p.labelRight + TITLE_GAP}）`)
    }
    if (p.moreDisp !== 'none') fails.push(`会话头「…」未被移除（display=${p.moreDisp}）`)
    // 绘制层级（与「可点」是两件事，别混用）：页头必须画在条之上，否则条的
    // 背景会盖住徽章。**能点与否由下面的 app-region 断言判，不由 z-index 判。**
    if (Number(p.headerZ) <= Number(p.barZ)) fails.push(`绘制层级不对：页头 ${p.headerZ} 必须高于标题栏 ${p.barZ}（否则徽章被条的背景盖住）`)
    if (p.labelMaxWidth === null || p.labelMaxWidth.indexOf(TITLEBAR_STATUS_VAR) === -1) {
      fails.push(`标签 max-width 未为状态簇让位（${p.labelMaxWidth}）`)
    }
    if (p.labelChildren !== 3) fails.push(`标签子元素应为 3（工作区/分隔/标题），实为 ${p.labelChildren}——合成徽章回流？`)
    if (p.teamHit !== 'SELF') fails.push(`状态徽章 DOM 命中被条吃掉（命中 ${p.teamHit}${p.teamRect === null ? '' : ' @' + JSON.stringify(p.teamRect)}）`)
    if (p.barLabelHit !== 'SELF') fails.push(`标题栏空白处未归条（命中 ${p.barLabelHit}）——页头 pointer-events:none 失效`)

    // —— 2026-10-05 第三轮：app-region（决定点击能否落到徽章上）——
    // 判别力前提自检：夹具没建出 app-region 层时，合成模型对任何点都返回 false，
    // 下面「徽章可点」会变成一条**假绿**。上一版冒烟正是这样把「点不动」判成绿的。
    if (p.regionCount === 0) {
      fails.push('夹具未产出任何 app-region 盒子（判别力前提不成立：合成模型无从判定）')
    } else {
      if (p.dragBoxes < 2) fails.push(`drag 盒子只有 ${p.dragBoxes} 个（应含自绘条与页头拖拽行）——夹具不忠实`)
      if (p.noDragBoxes < 3) fails.push(`no-drag 盒子只有 ${p.noDragBoxes} 个（应含 actions/utilities/corner 三簇）——夹具不忠实`)
    }
    // 自绘条必须排在 #root 之前：否则它成为最后一个 app-region 盒子，吞掉其后一切
    if (p.barBeforeRoot !== true) {
      fails.push('自绘条未排在 #root 之前——它会成为最后一个 app-region 盒子，把徽章整片吞掉')
    }
    // 可拖 ⇒ 点击在原生窗口层被吃掉。徽章（button 与**裸 span** 两种形态）都必须
    // 不可拖：button 靠 base.css 的可交互规则，裸 span 只能靠上游的簇级 no-drag
    // （AgentPresetLabel 真身就是 span，故这条是真实形态的判别点）。
    if (p.teamDrag !== false) {
      fails.push(`状态徽章（button）落在拖拽区里：该点可拖 ⇒ 点击到不了页面（drag=${p.teamDrag}；命中盒子 ${JSON.stringify(p.teamBoxes)}）`)
    }
    if (p.presetDrag !== false) {
      fails.push(`状态徽章（裸 span，同 AgentPresetLabel）落在拖拽区里：簇级 no-drag 未生效（drag=${p.presetDrag}）`)
    }
    if (p.wsBtnDrag !== false) {
      fails.push(`标题栏自身按钮落在拖拽区里（drag=${p.wsBtnDrag}）`)
    }
    // 带内、会话页头之外的可交互元素（真机：右栏页签）——靠 theme-watcher 补的
    // 可交互元素 no-drag 得救；缺了它这一类全被条吞掉（同一根因的第二个实例）。
    if (p.panelTabDrag !== false) {
      fails.push(`带内可交互元素（会话页头之外，如右栏页签）被条吞掉（drag=${p.panelTabDrag}）`)
    }
    if (p.bandEmptyDrag !== true) {
      fails.push(`标题栏左侧空白不可拖（drag=${p.bandEmptyDrag}；命中盒子 ${JSON.stringify(p.bandEmptyBoxes)}）——修条顺序不得把窗口拖拽一起弄丢`)
    }
    // 常驻诊断：判据的全部输入都打出来（成败都打），便于定位而无需再猜。
    // 注意必须在 try 内：p 是块内 const。
    console.log(`[titlebar] 平台标记=${PLATFORM_ATTR === '' ? '缺席（真实宿主形态）' : '在场（上游桌面端形态）'}`
      + ` boxes=${p.regionCount}(drag=${p.dragBoxes}) 徽章点=${JSON.stringify(p.teamBoxes)}`
      + ` dragAtBadge=${p.teamDrag} dragAtPreset=${p.presetDrag} dragAtBand=${p.bandEmptyDrag} 条在#root前=${p.barBeforeRoot}`)
  } catch (error) {
    fails.push(`异常：${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(`[titlebar src=${SRC_PATH}]`, fails.length === 0 ? 'PASS' : 'FAIL: ' + fails.join('; '))
  console.log(fails.length === 0 ? 'ALL PASS' : 'SMOKE FAILED')
  clearTimeout(watchdog)
  app.exit(fails.length === 0 ? 0 : 1)
})
