/**
 * workspace 顶栏收纳：把上游会话页头**收进自绘标题栏行**——既不再占
 * 纵向空间（为对话内容区腾出 76px），又不丢上游注册在页头里的状态徽章。
 *
 * ## 为什么不是 display:none（2026-10-05 用户反馈的根因）
 *
 * 上游把四类会话状态徽章**全部**注册在同一个槽里 ——
 * `conversation.session.header.actions`（SlotOutlet 渲染为
 * `<div data-slot="conversation.session.header.actions">`，落在
 * `ConversationSessionHeader` 的 `.titleCluster` 内，即会话标题右侧）：
 *
 * | 注册方 | 徽章 | 语义 |
 * |---|---|---|
 * | `client-ui-agent-preset` | `AgentPresetLabel` | 会话预设（「标准模式」等） |
 * | `experimental/client-ui-agent-team` | `TeamAction` | 智能体团队（成员 + 任务） |
 * | `client-ui-subagent` | `SubagentCatalogAction` | 子代理（代理任务） |
 * | `client-ui-jobs` | `JobListAction` | 后台任务 |
 *
 * 旧实现把整个页头 `display:none`，于是**四个注册方一起消失**；只为
 * `AgentPresetLabel` 补了一条「读文本 → 写 --dsh-agent-preset → 自绘标题栏
 * 复刻一枚合成徽章」的旁路（已随本次改动删除）。结果是：开了智能体团队、
 * 有子代理在跑、有后台任务，标题栏一律看不见。
 *
 * 正解不是「再加三条旁路」（每多一个注册方就要多一条，且合成的副本不可点、
 * 不随状态变化），而是**让上游自己的状态簇留在原地并可见**：
 *
 * - 页头整体 `position: fixed` 覆盖进 48px 自绘标题栏带内（透明、`pointer-events:none`），
 *   纵向不再占位——`display:none` 的收益原样保留；
 * - 只把状态簇座位（`.titleRow` 及其内的 headerActions/headerUtilities/headerCorner）
 *   放开 `pointer-events`，于是**任何**上游注册方（含未来新增的）自动出现在
 *   标题栏里，交互（点开团队面板、任务列表）也照旧可用；
 *
 * ## 2026-10-05 第三轮（用户反馈「这些无法点击」）：拖拽权，三层根因
 *
 * `pointer-events` 只管 DOM 命中，**决定点击能不能落到徽章上的是
 * `-webkit-app-region`**：Electron 按「几何 + DOM 顺序、忽略层叠」合成，最后被
 * 收集的盒子决定该点是否可拖，可拖即拖窗、点击到不了页面（ui-web
 * window-drag/regions.ts 是这条契约的可执行表述；上游 e2e 注释亦明说此事
 * **不能用「点一下试试」来判**，上一版冒烟正是用 elementFromPoint 判的，故假绿）。
 * 本轮定位到三层，**第一层才是主因**：
 *
 * ① **本壳从不落 `html[data-platform='darwin']`**。上游的 app-region 表（base.css
 *    的 drag 行与可交互元素削减、ConversationRoot 的四簇削减）**整条作用域挂在
 *    该标记下**；写它的是上游桌面壳的 preload（preload-platform.ts），而 KCoder
 *    shell 是**无 preload 的纯浏览器载体**（sidebar-toggle.ts 模块注释已记），
 *    引擎 web bundle 只读不写它（AppFrame.tsx:168 读 dataset.platform）⇒ 真机上
 *    上游那层**一条都不生效**，48px 带里只剩自绘标题栏那一个 drag 盒子。
 *    ⇒ 修法：按上游同一语义**自补**簇级削减（见下方簇规则注释），作用域不依赖标记。
 * ② 自绘标题栏 append 在 #root 之后 ⇒ 它是最后一个盒子、吞掉一切（已改为排在
 *    #root 之前作拖拽基座，见 theme-watcher 的 mount）。
 * ③ 本覆盖层是全宽 fixed 覆盖层：带 drag 会吞掉排在它之前的盒子（首当其冲是自绘
 *    条自己的按钮），带 no-drag 会把整条带的拖拽权削光（且该属性**会继承**，实测）
 *    ⇒ 正解是 `-webkit-app-region: initial`（不参与合成），拖拽权归自绘条。
 *
 * 冒烟判据已整体换成上游合成模型（收集 computed app-region 盒子 → isDraggableAt），
 * 夹具默认**不带**该标记（真实宿主形态），并有两个负对照：条改回 append、以及
 * 平台标记在场（验证与上游规则兼容）。
 *
 * ## 2026-10-05 第二轮（用户反馈）：位置与清洗
 *
 * **① 徽章必须紧跟标题之后（不是靠右）**。首版把整行靠右（`justify-content:
 * flex-end`），徽章于是贴到按钮带左侧堆成一簇，与上游「状态是标题的延续」的
 * 语义不符。上游的真实几何是：`.titleCluster{flex:1}` 吸收整行、其内
 * `.crumbs` 占左（min-width:0 可省略号）、`.headerActions` 紧随其后
 * （`flex:none` 挤在左侧），而 `.headerUtilities{margin-left:20px}` 与
 * `.headerCorner{margin-left:8px}` 因簇已吃满而在**行末**——即
 * `[标题][徽章] …… [工具][角位]`。
 * 本实现保留自绘标题栏的主文本（它带工作区前缀），故把**行首内边距**接到
 * 主文本右缘（`--dsh-titlebar-title-end`，theme-watcher 量出后写入），
 * `.titleCluster` 压成 `flex:none`（只包徽章）→ 徽章落在标题之后；
 * `.headerUtilities` 改 `margin-left:auto` 顶到行末，复刻上游那半个几何。
 *
 * **② 会话头右上角的 `…`（会话日志/反馈菜单）移除**：它是上游
 * `session-log-export` 的 `SessionLogDownloadHeaderAction`——注册在
 * `conversation.session.header.utilities`，锚 `<Button class="_moreButton">`
 * 内是 `IconEllipsisOutlineRegular`（全仓仅此一处把省略号图标用在会话头上；
 * `aria-label` 取 `header.more` 本地化串，不可作稳定锚）。用户明确要求不要它，
 * 按 `[class*="_moreButton"]` 子串锚（本仓既有 CSS modules 惯例）隐藏。
 * **它是「不要」，不是「收起来」**：规则只作用于会话页头作用域内。
 * ⚠️ 代价如实记录：该菜单里是「下载会话日志」与（可选）「反馈」两项，
 * 隐藏后这两项在会话头上不再可达；要恢复只需删掉那一条选择器。
 *
 * 原生右栏的展开按钮（`ui-sidebar-right` 的 `ExpandButton`，也注册在
 * `conversation.session.header.corner`）**不在本模块处理，但必须保持可点**：
 * 2026-10-09 之后它是进入右侧工作台的**唯一入口**（dsh-coding-sidebar 退役、
 * 铁律 1 翻转，原生右栏接回；原 `NATIVE_SIDEBAR_CSS` 压制已删）。右栏展开时
 * 该按钮自身返回 null。本模块保证角位座位在**有可见注册方时**照常可交互
 * ——展开按钮正是这条保证的直接受益者（冒烟夹具用合成角位按钮钉住这一点）。
 * - `.crumbs`（面包屑）与 `.tabs`（视图标签行）继续收纳：自绘标题栏已显示
 *   「工作区 / 会话标题」，标签行是第二行、塞不进 48px；
 * - `[data-conversation-header-leading]`（上游窗口控件座位）收纳：全仓**零注册方**
 *   （packages/client/ui-conversation/src/client/apply.ts 只声明单例槽），
 *   本产品的窗口按钮在自绘条上。
 *
 * ## 与自绘标题栏的配合（跨注入器，两条通道，互为反向）
 *
 * 1. `--dsh-titlebar-status-w`：本脚本量出「标题右侧**必须让出**的宽度」写到
 *    documentElement，自绘标题栏用它把主文本 `max-width` 收窄（否则长标题会
 *    钻到徽章/工具按钮下面）。该值＝徽章簇 + `headerUtilities` + `headerCorner`
 *    三者宽度 + 固定间距（10 标题间距 / 20·8 两处上游 margin），**不能量
 *    `.titleRow` 整宽**：整宽含把 utilities 顶到行末的那段 `auto` 外边距，
 *    量整宽会把标题压成 0 宽。三个分量都由内容决定、不随标题变化 → 单向。
 * 2. `--dsh-titlebar-title-end`（**由自绘标题栏写入、本脚本消费**）：主文本
 *    右缘的视口 x，本脚本把它接成行首内边距，徽章于是紧跟标题之后。反向依赖
 *    （标题宽度不依赖徽章位置）→ 两条通道合起来仍是**无环**的：
 *    徽章宽 → 标题 max-width → 标题实际宽 → 徽章左缘，箭头单向。
 * 2. `__dsh_title_changed`：本脚本观察面包屑当前项文本变化后派发，自绘标题栏
 *    据此刷新主文本。**标题不再取 `document.title`** —— 上游 DocumentTitle
 *    投射的是「会话标题 — 产品名」，而产品名是**构建期内联**的
 *    `DSH_CLIENT_TITLE`（scripts/client-build-environment.ts），本产品构建未内联
 *    → 回退 locale 键 `brand.localBuild`＝「DSH 本地构建」，于是自绘条上一直挂着
 *    这串与产品无关的字（2026-10-05 用户要求删除）。改读面包屑当前项即拿到
 *    纯会话标题，且与 document.title 同源（都来自 session.title）。
 *
 * ## 上游结构（packages/client/ui-conversation）
 *
 * - **0.1.7-alpha.1 起（现状）**：页头分两层——外层 `ConversationHeader`
 *   渲染 `<header class="_header" data-window-drag>`，内层 `ConversationSessionHeader`
 *   注册进 `conversation.session.header` slot，于是 `.titleRow` / `.tabs` 落在
 *   slot 容器 `<div data-slot="conversation.session.header">` 里、**不再是 header 的
 *   直接子级**，所以定位一律按 `header:has(> [data-slot=…])` 锚定。
 * - 产物类名按「_+类名」子串匹配（hash 位置随构建形态不同，见 style-overlay 同款
 *   说明）；`_header` / `_titleRow` 都是泛名，故每条规则都带 header 作用域前缀。
 * - 上游类/属性改名 → 选择器静默失效回原样（顶栏重现，不崩不错位）。
 *
 * 标签行隐藏后轨迹视图失去入口，但上游视图选择是持久化的（收纳前停在轨迹页的
 * 存量状态会原样恢复）→ 附带兜底观察器：检测到轨迹视图根节点
 * （data-conversation-composer-overlay，全上游唯一）就点击首个 tab 拉回对话
 * （chat 恒为 order:0 首 tab）。`display:none` 的元素仍可 `click()`——React
 * 事件委托挂在 root，不依赖可见性。
 *
 * @module desktop/main/workspace-header
 */

import type { BrowserWindow } from 'electron'

/** 注入的 style 元素 id（幂等替换；SPA 内部导航不清 head）。 */
const STYLE_ID = '__dsh_ws_header_css'

/** 自绘标题栏的几何通道变量（theme-watcher 注入时写入；缺席时用等值兜底）。 */
const TITLEBAR_H_VAR = '--dsh-titlebar-h'
const TITLEBAR_RIGHT_VAR = '--dsh-titlebar-right-reserve'
/** 自绘标题栏主文本右缘（视口 x）——本脚本据此把页头内容起排到标题之后。 */
const TITLEBAR_TITLE_END_VAR = '--dsh-titlebar-title-end'
/** 标题与首枚徽章之间的间距（上游 `.titleCluster{gap:10px}` 同值）。 */
const TITLE_GAP = 10
/**
 * 标题右侧固定间距合计：本模块的 `TITLE_GAP` + 上游
 * `.headerUtilities{margin-left:20px}` + `.headerCorner{margin-left:8px}`。
 * 量得的三个分量宽度之外再补这段，才是主文本该让出的总宽（缺席的座位不计）。
 */
const STATUS_GAP = 20
const CORNER_GAP = 8
/** 本脚本向自绘标题栏发布的状态簇宽度变量。 */
const STATUS_W_VAR = '--dsh-titlebar-status-w'
/** 面包屑文本变化后通知自绘标题栏刷新主文本的事件名。 */
const TITLE_EVENT = '__dsh_title_changed'

/**
 * 注入样式 + 收纳/外传脚本（纯 JS：模板字符串内禁 TS 注解）。
 * 幂等：`window.__dshWsHeaderGuard` 短路；样式元素按 id 复用。
 */
const HEADER_JS = `(() => {
  if (window.__dshWsHeaderGuard) return
  window.__dshWsHeaderGuard = true
  let styleEl = document.getElementById('${STYLE_ID}')
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = '${STYLE_ID}'
    document.head.append(styleEl)
  }
  styleEl.textContent = \`
/* 锚点（每条规则都重复它）：header 元素 + 三条会话页头独有判据任取其一
   —— slot 子级（0.1.7-alpha.1 起形态）、data-conversation-header-leading /
   -corner 标记（≤0.1.6 形态的兜底；标记由 titleRow 内的窗口控件座位渲染，
   两个座位都空着时不挂载，那一路退化为「页头重现」，不崩不错位）。
   三条判据都不是泛名：设置弹窗的页头是 <div>（ui-settings-general），
   插件管理页的 _titleRow 在 _card 里，PlatformOverlay 的 <header> 无 _titleRow
   直接子级 —— 都不会被搬到标题栏。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) {
  position: fixed !important;
  inset: 0 0 auto 0 !important;
  height: var(${TITLEBAR_H_VAR}, 48px) !important;
  min-height: 0 !important;
  /* 行首内边距＝自绘标题栏主文本右缘 + 间距 ⇒ 徽章紧跟标题之后（上游几何：
     状态是标题的延续）。slot 容器是 display:contents（ui-renderer
     ANCHOR_STYLE），titleRow 就是这条 flex 行的直接项目，内边距直接决定起排
     位置。变量缺席（无自绘标题栏的平台）时用 78px＝macOS 红绿灯让位值兜底。 */
  padding: 0 var(${TITLEBAR_RIGHT_VAR}, 12px) 0 calc(var(${TITLEBAR_TITLE_END_VAR}, 78px) + ${TITLE_GAP}px) !important;
  border-bottom: none !important;
  background: transparent !important;
  display: flex !important;
  align-items: center !important;
  /* 起排靠左；把 utilities/corner 顶到行末的是它们自己的 margin-left:auto，
     不是这里的 justify-content（上游靠 .titleCluster{flex:1} 吃满行宽达到
     同一效果，本实现把它压成 flex:none，故改由 auto 外边距承担）。 */
  justify-content: flex-start !important;
  overflow: visible !important;
  pointer-events: none !important;
  /* 覆盖层必须「不参与 app-region 合成」，故写 initial（＝该属性初始值 none
     ＝不被收集）。三个错法与两条 Blink 实测（2026-10-05，真 Chromium/Electron 44 量得）：
       · 不声明 → 上游 [data-window-drag] 的 drag 生效：本层是全宽 fixed 覆盖层，
         会吞掉排在它之前的一切——首当其冲是自绘条自己的按钮（条排在 #root 之前）；
       · no-drag 或 **none** → Blink 把 none 解析成 **no-drag**（不是「无」！），
         且该属性**会继承**（实测 dn=no-drag ⇒ dnChild=no-drag；dg=drag ⇒
         dgChild=drag；initial 可显式退出）⇒ 本层整棵子树一起变成 no-drag 盒子，
         把整条 48px 带的拖拽权削光；
       · initial / unset / revert / revert-layer → computed none ✓（唯一正解）。
     实测表：declared none → computed no-drag；declared initial/unset/revert →
     computed none；未声明 → 随层叠（此处被上游打成 drag）。
     （上游 ui-web window-drag/regions.ts 的注释称该属性「does not inherit」——
     与本机实测不符；此处以实测为准，因为它决定「谁把拖拽权削掉」。）
     拖拽权归自绘条（theme-watcher 的 mount 把它排在 #root 之前作基座），徽章可点
     则靠**簇级**削减：上游那份在 ConversationRoot.module.css:57-62，但作用域挂在
     html[data-platform='darwin'] 上、本壳永不落该标记，故本模块按同一语义自补
     （见下方簇规则的注释）。簇是行的后代、排在基座之后 ⇒ 后出现者胜。 */
  -webkit-app-region: initial !important;
  z-index: 2147483647 !important;
}
/* 上游窗口控件座位（全仓零注册方）+ 面包屑（自绘标题栏已显示「工作区 / 会话
   标题」）+ 视图标签行（第二行，塞不进 48px）：继续收纳。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [data-conversation-header-leading],
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_crumbs"],
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_tabs"] {
  display: none !important;
}
/* 会话头右上角的「…」（上游 session-log-export 的 SessionLogDownloadHeaderAction，
   注册在 conversation.session.header.utilities 槽）：用户明确要求不要它，菜单里
   是「下载会话日志」与（可选）「反馈」两项——隐藏即这两项在会话头不可达（如实
   记录代价）。锚取 _moreButton 子串：该 CSS modules 类名在**引擎客户端全仓仅
   此一处**（session-log-export/src/client/HeaderAction.module.css），且只作用在
   会话页头作用域内；aria-label 取 header.more 本地化串、不可作稳定锚。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_moreButton"] {
  display: none !important;
}
/* 座位容器（div[data-slot="conversation.session.header"]）：上游带
   display:contents（ui-renderer ANCHOR_STYLE，"keeps it layout-neutral"），
   此时本规则不产生盒子、零副作用；若上游哪天不用 contents，它是 flex 行里
   唯一的中间层，必须撑满，否则 _titleRow 的 flex:1 拿不到可拉伸宽度。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) > [data-slot="conversation.session.header"] {
  flex: 1 1 auto !important;
  min-width: 0 !important;
}
/* 状态簇座位。两条几何决定都必须在此写死：
   - flex:1 1 auto（整行铺满）——否则 .headerUtilities 的 margin-left:auto
     没有可分配的剩余空间，工具按钮会紧跟在徽章之后而不是行末；
   - 容器型 containment 必须解除，否则 shrink-to-fit 的内联尺寸被算作 0
     （代价：槽内 @container 断点不再生效，徽章保持全文本——这正是本条要买到
     的性质，也保证徽章宽度只由内容决定，让位宽度单向、不抖）。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_titleRow"] {
  display: flex !important;
  flex: 1 1 auto !important;
  align-items: center !important;
  width: auto !important;
  min-width: 0 !important;
  height: 100% !important;
  min-height: 0 !important;
  padding: 0 !important;
  container-type: normal !important;
}
/* 徽章簇只包徽章（面包屑已收纳）→ 压成 flex:none，宽度＝内容宽，于是整簇
   落在行首内边距处，即标题之后。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_titleCluster"] {
  flex: none !important;
  min-width: 0 !important;
}
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_headerActions"],
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_headerUtilities"],
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_headerCorner"] {
  pointer-events: auto !important;
  /* app-region 削减必须由**我们自己**补出（2026-10-05 现场：徽章「看得见、
     点不动」的真根因）。上游的削减规则（ConversationRoot.module.css:57-62
     的四簇 no-drag、base.css:82-90 的可交互元素 no-drag）**整条作用域在
     html[data-platform='darwin'] 下**，而写这个标记的是上游桌面壳的 preload
     （preload-platform.ts）；**本壳是无 preload 的纯浏览器载体**
     （sidebar-toggle.ts 模块注释已记此事），引擎 web bundle 只读不写它
     （AppFrame.tsx:168 读 dataset.platform）⇒ 在真机上上游那层**一条都不生效**，
     48px 带里只剩自绘标题栏那一个 drag 盒子，凡它覆盖之处点击全被吞掉。
     故此处按上游同一语义（簇级削减整块座位）在页头作用域内等价补出，作用域
     不依赖该标记。条与页头的几何/顺序见 theme-watcher 的 mount 与本模块头注释。 */
  -webkit-app-region: no-drag !important;
}
/* 工具座位顶到行末（上游靠 .titleCluster{flex:1} 达到同一效果，见上方 titleRow
   注释）。upstream 的 20px margin-left 被 auto 取代：吸掉的是剩余空间，故工具
   与徽章之间不会贴死。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_headerUtilities"] {
  margin-left: auto !important;
}
/* 上游 headerCorner 用 margin-right:-16px 探进页头 28px 右内边距；这里右内边距是
   theme-watcher 发布的让位值（2026-10-09 起 = 12px 尾部呼吸位），-16px 的探出必须
   归零，否则末枚角位按钮会直接贴到窗口右缘。12px 内边距 + margin 0 恰好等于上游
   28px - 16px 的视觉结果。 */
header:has(> [data-slot="conversation.session.header"], [data-conversation-header-leading], [data-conversation-header-corner]) [class*="_headerCorner"] {
  margin-right: 0 !important;
}
\`
  /* 轨迹视图兜底 + 标题外传 + 状态簇宽度外传：观察 DOM 变化
     （rAF 合并 + 点击冷却）；文本/宽度有变化才写，避免无谓重排。 */
  let queued = false
  let lastClick = 0
  let lastTitle = null
  /* 面包屑当前项＝纯会话标题（上游 DocumentTitle 用的同一份 session.title）。
     文本变化后派发事件，自绘标题栏据此更新主文本。 */
  const syncTitle = () => {
    const el = document.querySelector('[class*="_crumbCurrent"]')
    const text = el === null ? '' : (el.textContent || '').trim()
    if (text === lastTitle) return
    lastTitle = text
    document.dispatchEvent(new CustomEvent('${TITLE_EVENT}'))
  }
  const ensureChat = () => {
    queued = false
    syncTitle()
    pushReserve()
    if (document.querySelector('[data-conversation-composer-overlay]') === null) return
    const now = Date.now()
    if (now - lastClick < 300) return
    const list = document.querySelector('[class*="_titleRow"] ~ [class*="_tabs"]')
      ?? document.querySelector('[role="tablist"]')
    const tab = list === null ? null : list.querySelector('[role="tab"]')
    if (tab !== null) { lastClick = now; tab.click() }
  }
  /* 标题右侧「必须让出」的宽度外传（自绘标题栏据此收窄主文本）。
     **按分量求和，不量 .titleRow 整宽**：整宽含把 utilities 顶到行末的那段
     auto 外边距，量整宽会把标题压成 0 宽（首版就是这个错，改右对齐时侥幸成立）。
     三分量皆由内容决定、不随标题变化 → 单向、不抖。 */
  const HDR_SEL = "header:has(> [data-slot='conversation.session.header'], [data-conversation-header-leading], [data-conversation-header-corner])"
  const widthOf = (el) => el === null ? -1 : el.getBoundingClientRect().width
  let observed = []
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { pushReserve() })
  /* 座位重挂/换会话时观察集变化 → 重挂观察（同集则早退，无回环）。 */
  const armObserve = (nodes) => {
    if (ro === null) return
    if (nodes.length === observed.length && nodes.every((n, i) => n === observed[i])) return
    ro.disconnect()
    observed = nodes
    for (const n of nodes) ro.observe(n)
  }
  const pushReserve = () => {
    const header = document.querySelector(HDR_SEL)
    const cluster = header === null ? null : header.querySelector('[class*="_headerActions"]')
    if (cluster === null) {
      armObserve([])
      document.documentElement.style.setProperty('${STATUS_W_VAR}', '0px')
      return false
    }
    const utils = header.querySelector('[class*="_headerUtilities"]')
    const corner = header.querySelector('[class*="_headerCorner"]')
    armObserve([cluster, utils, corner].filter((n) => n !== null))
    let total = Math.round(widthOf(cluster)) + ${TITLE_GAP}
    if (widthOf(utils) > 0) total += Math.round(widthOf(utils)) + ${STATUS_GAP}
    if (widthOf(corner) > 0) total += Math.round(widthOf(corner)) + ${CORNER_GAP}
    document.documentElement.style.setProperty('${STATUS_W_VAR}', total + 'px')
    return true
  }
  const onMutate = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(ensureChat)
  }
  const start = () => {
    // characterData：React 重设标题/徽章文案只改文本节点 data
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, characterData: true })
    // 页头可能在 SPA 首帧之后才挂（换会话/换工作区整表重写）：rAF 轮询至找到
    // 状态簇为止，与自绘标题栏探 sidebarCol 同款
    const poll = () => { if (!pushReserve()) requestAnimationFrame(poll) }
    poll()
    onMutate()
  }
  if (document.body !== null) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
})()`

/**
 * 给 shell 窗口挂顶栏收纳（每次整页加载后重新注入；重复调用安全，
 * 窗口重建时旧监听随窗口销毁）。
 */
export function attachWorkspaceHeader(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  //（theme-watcher/style-overlay 同款防御）
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(HEADER_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
