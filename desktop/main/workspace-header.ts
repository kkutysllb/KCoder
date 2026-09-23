/**
 * workspace 顶栏收纳：隐藏上游会话页头部的标题行与标签行，为对话
 * 内容区腾出垂直空间（会话标题与自绘状态栏重复；轨迹已迁至状态栏
 * 按钮 + 右侧抽屉；会话日志迁至状态栏按钮）。
 *
 * 上游结构（packages/ui-conversation）：
 * - **0.1.7-alpha.1 起（现状）**：页头分两层——外层 `ConversationHeader`
 *   渲染占位 `<header class="_header">`（min-height:76px +
 *   `border-bottom:0.5px solid var(--dsw-alias-border-l3)`），内层
 *   `ConversationSessionHeader` 注册进 `conversation.session.header` slot，
 *   于是 `.titleRow` / `.tabs` 落在 slot 容器
 *   `<div data-slot="conversation.session.header">` 里、**不再是 header 的
 *   直接子级**。收纳必须按 slot 锚点收掉整个 header 容器：只收 titleRow/tabs
 *   的话，容器会带着 76px 最小高与那条底线留下来，页面上就是「一条空带 +
 *   一根孤立细线」（`border` 仅 `.headerBlank` 时去掉，所以这条线恰好
 *   会话一开始跑就出现——2026-09-23 实机定位并修复，见 scripts/smoke-workspace-header.mjs）。
 * - **≤0.1.6-alpha.2**：`ConversationSessionHeader` 自己就是 `<header>`，
 *   `.titleRow` 是其直接子级（`:has(> …)` 判据成立）。
 * - 两种形态下 `.header` 内都含 `.titleRow`（crumbs 面包屑 + headerActions/
 *   headerUtilities 两个 slot——会话日志按钮注册在 headerUtilities）与
 *   `.tabs`（role=tablist 的对话/轨迹标签行，视图选择持久化）；
 * - 产物类名按「_+类名」子串匹配（hash 位置随构建形态不同，见
 *   style-overlay 同款说明）；唯一性：_titleRow 全仓唯一；_tabs 与
 *   ui-settings-plugins 撞名 → 「titleRow 之后兄弟」锚定；_header
 *   泛名 → :has(> titleRow) 锚定直接父级（其他 header 无此直接
 *   子级，不误伤）。
 *
 * 标签行隐藏后轨迹视图失去入口，但上游视图选择是持久化的（收纳前
 * 停在轨迹页的存量状态会原样恢复）→ 附带兜底观察器：检测到轨迹
 * 视图根节点（data-conversation-composer-overlay，全上游唯一）就
 * 点击首个 tab 拉回对话（chat 恒为 order:0 首 tab）。display:none
 * 的元素仍可 click()——React 事件委托挂在 root，不依赖可见性。
 *
 * 会话的 agent 预设标记（AgentPresetLabel：注册在 headerActions
 * slot，仅配了预设的会话渲染——每会话必有，默认「标准模式」）也随
 * 之不可见 → 同一观察器顺带读取写入 --dsh-agent-preset
 * （--dsh-ws-name 同款跨注入器变量通道），自绘标题栏消费展示。
 * 读取锚点用 slot 系统的 data-slot 属性（SlotOutlet 给每个 slot 包
 * 的锚点容器，scoped-slots.tsx 的 <div data-slot={key}>，slot key
 * 是语义标识比类名稳）；实测 DOM：容器内首 span 即 AgentPresetLabel
 * 根（css.label 类）。其他注册方（SubagentCatalog/JobList）根是
 * button 不在匹配面内；DOM 隐藏不影响读取。
 *
 * 上游类/属性改名 → 选择器静默失效回原样（顶栏重现，不崩不错位）。
 *
 * @module desktop/main/workspace-header
 */

import type { BrowserWindow } from 'electron'

/** 注入的 style 元素 id（幂等替换；SPA 内部导航不清 head）。 */
const STYLE_ID = '__dsh_ws_header_css'

/** 收纳脚本（纯 JS：模板字符串内禁 TS 注解）+ 样式，自幂等。 */
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
/* 会话头部整体收纳，两条主规则按上游版本取其一（都用 :has 锚定，.header
   泛名同名多，绝不裸匹配）：
   ① 0.1.7-alpha.1 起（本条是现状必需项）：上游把页头拆成
      ConversationHeader（占位 <header class="_header">）+ ConversationSessionHeader
      （注册进 conversation.session.header slot），titleRow 因此被 slot 容器
      <div data-slot="conversation.session.header"> 包住、不再是 header 的直接
      子级 —— 下面 ② 的直接子级判据在 0.1.7 静默失效，header 容器会带着
      min-height:76px 与 border-bottom:0.5px solid var(--dsw-alias-border-l3)
      活下来：内容被兜底规则收掉、只剩一条空带 + 孤立细线，且因为 .headerBlank
      才 border:none，这条线正好「会话一开始跑就冒出来」（2026-09-23 实机定位）。
      锚点用 slot 系统的 data-slot（语义标识，比哈希类名稳），元素名 header
      与类名两条并列，任一改名都还有另一条。
   ② ≤0.1.6-alpha.2：titleRow 是 header 的直接子级。 */
header:has(> [data-slot="conversation.session.header"]) { display: none !important; }
[class*="_header"]:has(> [data-slot="conversation.session.header"]) { display: none !important; }
[class*="_header"]:has(> [class*="_titleRow"]) { display: none !important; }
/* 兜底（.header 改名时仍要收掉标题行）：必须按「会话头部自己的子标记」锚定，
   绝不能写成裸的 [class*="_titleRow"]。
   0.1.6-alpha.2 现场（2026-09-18）：上游插件管理页的配置卡片标题行同样叫
   _titleRow（PluginManagerPage 的 .titleRow，实测一个页面 12 个且全属卡片），
   裸选择器把它们一起 display:none——标题按钮尺寸归零、.cardOpen::after 的
   整卡点击层随之失效，表现为「设置→插件→插件管理」卡片看得见、点不动。
   旧注释「_titleRow 全仓唯一」的前提在本版已不成立。
   锚点用会话头部独有的 data-conversation-header-* 标记（实测确认在
   titleRow 内；两个 slot 空着时不会挂载，故不能拿 data-slot 当锚点）。
   若上游连这对标记也改掉，退化为「不收纳」——只是顶距/标题行残留，
   绝不会误伤别处，这正是本条修正要买到的性质。 */
[class*="_titleRow"]:has([data-conversation-header-leading]) { display: none !important; }
[class*="_titleRow"]:has([data-conversation-header-corner]) { display: none !important; }
/* _tabs 跨包撞名：仅收敛 titleRow 之后的兄弟（会话页标签行） */
[class*="_titleRow"] ~ [class*="_tabs"] { display: none !important; }
\`
  /* 轨迹视图兜底 + agent 预设标记外传：观察 DOM 变化（rAF 合并 +
     点击冷却）；预设文本有变化才写变量（style 属性变化会触发标题栏
     既有 observer 重渲染） */
  let queued = false
  let lastClick = 0
  let lastPreset = null
  const syncPreset = () => {
    // 锚点 = slot 系统的 data-slot 容器（SlotOutlet 包的锚点 div，
    // slot key 语义稳定；实测 headerActions 的直接子元素是它而非
    // 组件根——「> span」因此永远落空）；容器内首 span 带 css.label
    // 类，兜底容器首元素（label 类改名时读 entry 全文本）
    const root = document.querySelector('[data-slot="conversation.session.header.actions"]')
    let text = ''
    if (root !== null) {
      const el = root.querySelector('span[class*="_label"]') ?? root.firstElementChild
      if (el !== null) text = el.textContent.trim()
    }
    if (text === lastPreset) return
    lastPreset = text
    document.documentElement.style.setProperty('--dsh-agent-preset', text)
  }
  const ensureChat = () => {
    queued = false
    syncPreset()
    if (document.querySelector('[data-conversation-composer-overlay]') === null) return
    const now = Date.now()
    if (now - lastClick < 300) return
    const list = document.querySelector('[class*="_titleRow"] ~ [class*="_tabs"]')
      ?? document.querySelector('[role="tablist"]')
    const tab = list === null ? null : list.querySelector('[role="tab"]')
    if (tab !== null) { lastClick = now; tab.click() }
  }
  const onMutate = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(ensureChat)
  }
  const start = () => {
    // characterData：React 重设预设文案只改文本节点 data
    new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true, characterData: true })
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
