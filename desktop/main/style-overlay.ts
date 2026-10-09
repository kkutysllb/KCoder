/**
 * 上游外壳碎片压制层 + 空会话品牌水印：零修改上游的前提下，靠注入
 * 一段 `<style>` 收掉 KCoder 不使用的上游外壳碎片（折叠 rail 的两枚
 * 会话浏览器入口、设置对话框头部），并给空会话铺 KCoder 的 K 水印
 * （均按层叠规则覆盖，不动上游代码）。
 *
 * **2026-10-09 收缩**：原第一段「原生右侧栏外壳压制」（NATIVE_SIDEBAR_CSS）
 * 随 dsh-coding-sidebar 整线退役一并删除——右侧工作台交回上游原生，
 * 产品侧对原生右栏不再有任何压制（docs/ARCHITECTURE.md §12 铁律 1 翻转）。
 *
 * ## 历史与职责收缩（2026-09-20）
 *
 * 本模块原为「消息样式覆盖层」：正文密度 / 消息列宽 / 正文字号档位，外加
 * 气泡与代码块圆角、深色气泡对比、跳到底部按钮居中、轨迹页打磨——由设置
 * 面板「通用」区的「桌面样式定制」组驱动（style-settings.ts，已随该功能
 * 整体下线）。用户决策：上游排版已完善，宿主不再动正文排版（档位、总开关、
 * 持久化字段 style 全部移除）。
 *
 * 剩下的三段都**不是排版偏好**，没有开关、恒生效：
 * 1. 折叠 rail「新建工作区 / 搜索」入口压制（RAIL_BROWSER_ACTIONS_CSS）；
 * 2. 设置对话框头部压制（SETTINGS_DIALOG_HEADER_CSS）；
 * 3. 空会话 K 水印（HERO_WATERMARK_CSS）——品牌落点，用户明确要求保留。
 * （原第 1 段「原生右侧栏外壳压制」已于 2026-10-09 随插件退役删除。）
 *
 * 历史段落（已移除）：**侧栏「插件」panellist 入口压制**
 * （`SIDEBAR_PLUGIN_ENTRY_CSS`）。2026-10-04 产品负责人拍板恢复上游侧栏
 * 「插件」菜单——上游 `ui-plugin-manager` 的 panellist 条目重新可见，点开
 * 按上游语义在主列渲染插件管理页；产品侧「设置 → 内置插件 → 插件管理」tab
 * （fork 的 `settings.plugins.tab` 贡献，与面板条目**同一个
 * `PluginManagerPage`**）**同期保留不变**，两个入口并存。详见下方历史注释。
 *
 * 注入形态不变：文档末尾追加 `<style>`，上游类名/data 属性改名 → 对应
 * 段静默失效（外壳复现 / 水印消失），不崩不错位。
 *
 * @module desktop/main/style-overlay
 */

import { readFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { resolveAsset } from './dsh-contract'

/** 注入的 style 元素 id（幂等替换；SPA 内部导航不清 head）。 */
const STYLE_ID = '__dsh_desktop_style_override'

/**
 * K mark used by the empty-session watermark. Embed the asset in the injected
 * stylesheet because the shell is served by the dsh sidecar and cannot rely
 * on the desktop renderer's public directory being on its URL origin.
 */
const watermarkDataUrl = `data:image/png;base64,${readFileSync(resolveAsset('brand-k.png')).toString('base64')}`

/**
 * 已退役（2026-10-09）：本段曾是「产品铁律 1：不使用上游原生侧边栏功能」
 * 的执行点——dsh-coding-sidebar 承担右侧工作台期间，这里把上游原生右栏的
 * 展开按钮（会话头角落）、面板宿主、Session 包装层、**占地的那一列**
 * （`[data-rightbar-col]`）与右栏拖拽分隔条（`[data-side='rightbar']`）
 * 一并 display:none。随该插件整线退役，右侧工作台交回上游原生，
 * **压制整体删除**（铁律 1 于 2026-10-09 翻转，见 docs/ARCHITECTURE.md §12）；
 * 网格第三轨的归零（sidebar-toggle.ts）同批拆除。
 *
 * 留档的铁律期教训（当年两次静默失效，后续若再压制上游 DOM 时复用）：
 * - **别用存在性锚点压取值属性**：上游把 `data-sidebar-right-panel` 从布尔标记
 *   改成取值属性后，正常停靠模式下该属性根本不存在，选择器静默失配、面板复现
 *   （2026-09-24 现场）。
 * - **压制元素 ≠ 收回占宽**：面板是 `position:absolute` 覆盖层，宽度来自框架
 *   内联的第三条 grid 轨道；只 display:none 元素会留下一条空白（2026-10-05 现场），
 *   当时靠 sidebar-toggle 恒写 0px 补第二半。
 */

/**
 * 折叠 rail「新建工作区 / 搜索」入口压制（2026-10-02，用户指定）：
 * 上游 ui-workspace 的 WorkspaceBrowser 在折叠态（css.rail，即侧栏收起
 * 后的图标列）保留两枚会话浏览器入口——sectionHeader（36px 框）里的
 * 「新建工作区」按钮（点击弹 side="right" 的 picker popover）与独立一档
 * 的 36px「搜索」控件（点击 = 展开侧栏并聚焦搜索输入，searchOnExpand
 * 手势，等待滑开动画结束再 focus）。KCoder 折叠态取「极简 rail」取向：
 * 两枚连同空占位框一并隐藏（用户明确要求），功能经展开侧栏后照常可达
 * （搜索快捷键的 expand-and-focus 路径不经按钮，不受影响）。
 *
 * ## 与官方桌面端折叠形态的对齐分析（2026-10-04 修订：原「官方 mac 与
 * KCoder 改前完全同款」的表述有误，实测勘正）
 *
 * - 官方 **macOS** 折叠态并非「同款 rail」：其 preload 在文档早期写
 *   `data-platform="darwin"`（app.asar /lib/preload-app.cjs 实证），
 *   AppFrame 据此取 collapsedWidth=0 → 折叠态**整列归零**、无 rail；
 *   两枚入口随列消失，控件由 shell.leading seat（HeaderLeadingControls：
 *   toggle + new chat）补回红绿灯右侧。KCoder 已跟进同形态（sidebar-toggle
 *   的折叠无痕），本段的作用对象随之不可见；
 * - 官方 **Windows** 桌面端折叠态同为零宽（`data-windows-titlebar` 分支
 *   collapsedWidth=0 + caption row 两枚悬浮钮；构建产物
 *   `[data-windows-titlebar] .collapsed …` 实证）——regionArea 被收掉即
 *   两枚入口在官方折叠态同样不可见；
 *   （2026-10-04 随 dsh 0.2.1-alpha.1 复核：**承载该结论的判据未变**——
 *   `document.documentElement.hasAttribute('data-windows-titlebar') ? 0 :
 *   SIDEBAR_COLLAPSED` 两侧同行号；上游同批把
 *   `:global([data-windows-titlebar]) .handle { top: … }` 换成了
 *   `.handle { grid-area: 1 / 1 / 2 / -1 }`——AppFrame 新增 `shell.bottom`
 *   行、`grid-template-rows` 由 `100%` 改 `minmax(0,1fr) auto`，**列数未改**
 *   （inline `gridTemplateColumns` 仍为唯一产出点）⇒ 本节四段选择器逐条复核
 *   后**零改动**；同批的 `[data-side='rightbar']` 拖拽手柄属性仍产出
 *   （AppFrame.tsx 的 `data-side={props.side}`），sidebar-toggle 的
 *   `tracks.length === 3` 判据不受影响。）
 * - 结论：本段压制**保留作幂等兑底**（上游若回退 rail 形态，两枚入口仍被
 *   收掉；无痕下匹配不到可见元素，规则无副作用、不崩不错位）。
 *   （2026-10-02 初版按「官方 Windows 折叠后极简」移植到非 Windows 标题栏
 *   形态的 rail 上；当日为纯 rail 收纳，次日随无痕化退居兑底。）
 *
 * ## 锚点（CSS modules 构建产物形如 `<hash>_<源类名>`，hash 随构建漂移、
 * `_源类名` 后缀稳定；属性选择器作用于整个 class 属性串，故含配不能用
 * `$=` 结尾锚——rail 根的 class 串常以 quietBars 等收尾）
 *
 * - 作用域 = 折叠态的 WorkspaceBrowser 根节点
 *   `[class*='_rail']:not([class*='_collapsed'])[class*='_root']`：
 *   `.collapsed` 是 SidebarRoot 根（外层列）的专属类，用它排除外层根
 *   （其 class 串经 `_railIn` 动画类也含 `_rail`）；全仓另有三处 `_rail`
 *   类——ui-settings-general 的 36px trigger 钮与 ui-attachment 的图片
 *   缩略条（均无 `_root` 同串、不在侧栏列）——不满足双条件，不误伤。
 * - 目标一 = 直接子节点 `[class*='_sectionHeader']`：折叠态内只装
 *   「新建工作区」一枚（label/搜索槽/视图菜单均 wide-only），整框隐藏
 *   顺带收掉 36px 高 + 12px 边距的空占位；
 * - 目标二 = 直接子节点 `[class*='_search']`：折叠态专属的 36px 搜索档
 *   （宽态的搜索槽是 searchSlot 嵌套结构且折叠态不渲染，不冲突）。
 * - 上游类名/结构调整 → 压制静默失效（两枚入口复现），不崩不错位。
 */
const RAIL_BROWSER_ACTIONS_CSS = `
[class*='_rail']:not([class*='_collapsed'])[class*='_root'] > [class*='_sectionHeader'],
[class*='_rail']:not([class*='_collapsed'])[class*='_root'] > [class*='_search'] {
  display: none !important;
}`

/**
 * 设置对话框头部压制（2026-10-02，用户指定）：上游 SettingsRoot 的对话框
 * 头部（css.header，h54 条）只装两样东西——`settings.action` 插槽（注册者
 * 仅 SettingsDocumentAction「打开配置文件」一颗 outline 钮）与「×」关闭钮
 * ——用户要求整条去掉。头部连同按钮一并 display:none（留一条 54px 空带
 * 更难看）。关闭路径不受影响：Esc（useModalLayer 文档级监听）与点遮罩
 * （css.mask onClick=onClose）都在；DesktopUpdateIndicator 挂在主窗口
 * chrome、不在对话框头部，不受影响。
 *
 * 锚点：对话框根的稳定属性 `[data-shortcut-modal='settings']`（上游用于
 * 快捷键路由，非样式哈希）+ 头部的**双保险守卫** `:has(> [class*='_close'])`
 * ——要求目标行内直接挂着一个 css.close 关闭钮才整条隐藏，分区内部自绘
 * 的 `_header` 行（无 close 直子）不会误伤（ui-settings-general 全包仅
 * SettingsRoot 使用 css.header/actions/close，KCoder 注入分区全用 dsk-*
 * 类）。上游把面板属性/类名改名 → 压制静默失效（头部复现），不崩不错位。
 */
const SETTINGS_DIALOG_HEADER_CSS = `
[data-shortcut-modal='settings'] [class*='_header']:has(> [class*='_close']) {
  display: none !important;
}`

/*
 * 侧栏「插件」入口压制——**2026-10-04 已移除**（产品负责人拍板恢复上游入口；
 * 本注释留作历史与防回退说明，规则本身不再注入）。
 *
 * 原规则（0.1.6-alpha.2 引入）：上游 `ui-plugin-manager` 向
 * `sidebar.panellist` 无条件注册侧栏条目（包内无任何配置开关，整行禁用会连
 * 管理页一起死），产品当时把插件管理收进设置页的「插件管理」注入分区
 * （`plugin-settings.ts`，该文件已随 fork 的 `settings.plugins.tab` 落地而
 * 删除），侧栏入口以 `display:none` 藏掉；设置分区入口卡靠对隐藏按钮派发
 * `.click()` 走上游真实 `selectPanel` 路径（`display:none` 不影响
 * `HTMLElement.click()` 派发）。
 *
 * 移除理由（2026-10-04）：该条目是上游在 workspace 侧栏的**插件菜单入口**
 * ——点开在主列渲染 `PluginManagerPage`（安装/启停/卸载/逐插件配置卡齐全），
 * 与设置页 tab 是同一个页面。产品决策「插件管理落在 设置 → 内置插件 →
 * 插件管理」不变，故设置 tab 保留；只是不再压制上游入口，两者并存。
 *
 * 若日后确需再压制，锚点经验如下（原实现即按此取证）：
 * 条目渲染为 `nav[class*="panelList"] > … > button`（上游 SidebarRoot 的
 * PanelRow），唯一稳定标识是 `aria-label` = locale 解析后的 label（zh
 * 「插件」/ en "Plugins"）——button 上没有任何 data-* 属性；**不能隐藏整个
 * nav**——演示文稿/漫剧工坊/定时任务/动效技能库等第三方条目同为 panellist
 * 注册，一藏全没。
 *
 * 回退保护：`scripts/smoke-style-overlay.mjs` 直接扫本文件抽出的 CSS 段，
 * 断言其中不含 panellist 锚点——重新加入压制会当场失败。
 */

/**
 * 空会话 K 水印：仅 hero 阶段显示，所有会话内容保持在其上方。
 *
 * 位置和大小以滚动区为参照，避免跟随 composer 高度变化；opacity 分主题
 * 调整，浅色保持极淡，深色提高一档以免蓝色消失在深背景里。
 *
 * 恒生效：它不是"样式偏好"（原「桌面样式定制」总开关已随该功能下线），
 * 是 KCoder 的品牌落点——用户明确要求保留（2026-09-20）。
 * 上游锚点 `data-phase='hero'` / `data-conversation-scroll` /
 * `data-composer-seat` 改名 → 水印静默消失，不崩。
 */
const HERO_WATERMARK_CSS = `
[data-phase='hero'] [data-conversation-scroll] {
  position: relative;
  isolation: isolate;
}
[data-phase='hero'] [data-conversation-scroll]::before {
  content: '';
  position: absolute;
  top: 42%;
  left: 50%;
  z-index: 0;
  width: min(58vw, 620px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: url('${watermarkDataUrl}') center / contain no-repeat;
  opacity: .035;
  pointer-events: none;
}
[data-phase='hero'] [data-conversation-scroll] > [data-slot='conversation.session'],
[data-phase='hero'] [data-conversation-scroll] > [data-composer-seat] {
  position: relative;
  z-index: 1;
}
body[data-ds-dark-theme] [data-phase='hero'] [data-conversation-scroll]::before {
  opacity: .075;
  filter: saturate(1.08) brightness(1.18);
}`

/** 注入 CSS（无档位、无总开关：三段恒定生效）。 */
function buildOverlayCss(): string {
  return [RAIL_BROWSER_ACTIONS_CSS, SETTINGS_DIALOG_HEADER_CSS, HERO_WATERMARK_CSS].join('\n\n')
}

/**
 * 给 shell 窗口挂注入层：每次整页加载后重新注入（幂等替换既有 style
 * 元素，SPA 内部导航不清 head 故只需一次；页面跳转间隙执行失败属正常，
 * 下次 did-finish-load 会重试）。重复调用安全，窗口重建时旧监听随窗口
 * 销毁（先捕获 webContents：closed 后再访问 getter 会抛
 * "Object has been destroyed"，同类注入器同款防御）。
 */
export function attachStyleOverlay(win: BrowserWindow): void {
  const { webContents } = win
  const inject = (): void => {
    if (win.isDestroyed()) return
    const js = `(() => {
  const css = ${JSON.stringify(buildOverlayCss())}
  let el = document.getElementById('${STYLE_ID}')
  if (el === null) {
    el = document.createElement('style')
    el.id = '${STYLE_ID}'
    document.head.append(el)
  }
  if (el.textContent !== css) el.textContent = css
})()`
    webContents.executeJavaScript(js, true).catch(() => {
      // 页面跳转间隙失败属正常
    })
  }
  webContents.on('did-finish-load', inject)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', inject)
  })
}
