/**
 * 上游原生外壳压制层 + 空会话品牌水印：零修改上游的前提下，靠注入
 * 一段 `<style>` 做两件事——把 KCoder 不使用的上游原生侧栏外壳收掉，
 * 以及给空会话铺 KCoder 的 K 水印（均按层叠规则覆盖，不动上游代码）。
 *
 * ## 历史与职责收缩（2026-09-20）
 *
 * 本模块原为「消息样式覆盖层」：正文密度 / 消息列宽 / 正文字号档位，外加
 * 气泡与代码块圆角、深色气泡对比、跳到底部按钮居中、轨迹页打磨——由设置
 * 面板「通用」区的「桌面样式定制」组驱动（style-settings.ts，已随该功能
 * 整体下线）。用户决策：上游排版已完善，宿主不再动正文排版（档位、总开关、
 * 持久化字段 style 全部移除）。
 *
 * 剩下的五段都**不是排版偏好**，没有开关、恒生效：
 * 1. 原生右侧栏外壳压制（NATIVE_SIDEBAR_CSS）；
 * 2. 侧栏「插件」panellist 入口压制（SIDEBAR_PLUGIN_ENTRY_CSS）；
 * 3. 折叠 rail「新建工作区 / 搜索」入口压制（RAIL_BROWSER_ACTIONS_CSS）；
 * 4. 设置对话框头部压制（SETTINGS_DIALOG_HEADER_CSS）；
 * 5. 空会话 K 水印（HERO_WATERMARK_CSS）——品牌落点，用户明确要求保留。
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
 * 原生右侧栏外壳压制（D1a 恢复，2026-09-19；**2026-09-24 修 rc.2 起静默失效**）：
 * dsh-coding-sidebar 复活后右侧工作台由插件承担，原生的展开按钮（会话头角落）、
 * 面板宿主、Session 包装层、**占地的那一列**与**右栏拖拽分隔条**一并隐藏。只摘
 * 用户可见外壳——ui-sidebar-right 的服务层与契约保留（上游多个包在
 * dsh.client.inject 里硬声明它，禁用会让主对话链整体挂掉）。display:none 而非
 * 移除：隐藏元素仍可 .click() 派发（React 事件委托挂在 root）。上游改名 →
 * 压制静默失效（外壳复现），不崩不错位。
 *
 * ⚠️ **rc.2 现场（用户实测：「点任务卡片的打开会弹出原生右栏」）**：上游把
 * `data-sidebar-right-panel` 从**布尔标记**改成了**取值属性**
 * （`SidebarRight.module.css` 只有 `.panel[data-sidebar-right-panel='fullscreen']`）
 * ——正常停靠模式下该属性**根本不存在**，于是旧的 `[data-sidebar-right-panel]`
 * 存在性选择器匹配不到任何元素，**面板不再被隐藏**。这正是本文件预警过的
 * 「上游改名 → 静默失效」。修法不是追那个取值，而是**改锚到占地的那一层**：
 *
 * - rc.2 的面板是 `position:absolute` **覆盖层**（`SidebarRight.module.css` 的
 *   `.panel`），它占的宽度来自**框架的第三条 grid 轨道**
 *   （`ui-layout/AppFrame.tsx` 的 inline `grid-template-columns: 侧栏 / 中列 /
 *   minmax(0px, 右栏)`）⇒ 只隐藏面板会留下一大条空白。隐藏列的宿主
 *   `[data-rightbar-col]` 即让该轨道**没有子元素**：`.frame` 是 grid 且**无
 *   column-gap**，空的 `minmax(0px, Npx)` 轨道解析为 **0 宽**，空白随之消失。
 * - 右栏的分隔条是**框架的兄弟节点**（不在列里，条件渲染于 `rightbarShown`），
 *   列消失后它会孤零零留在右边缘 ⇒ 按稳定属性 `[data-side='rightbar']` 一并隐藏。
 *
 * 本段是「产品铁律 1：不使用上游原生侧边栏功能」的**执行点**
 * （docs/ARCHITECTURE.md §12）——上游把外壳改名或新增侧栏形态时，
 * 正解是改插件仓发新版本，不是放开本压制。
 */
const NATIVE_SIDEBAR_CSS = `[data-sidebar-right-expand],
[data-sidebar-right-panel],
[data-sidebar-right-session],
[data-rightbar-col],
[data-side='rightbar'] {
  display: none !important;
}`

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
 * ## 与官方桌面端折叠形态的对齐分析（为什么这是有意分叉而非失误）
 *
 * - 官方 **macOS** 折叠态与 KCoder 改前完全同款——这两枚入口本就是官方
 *   rail 设计的一部分（figma rail spec），「对齐官方 mac」＝不藏；
 * - 官方 **Windows** 桌面端走得更远：构建产物里
 *   `[data-windows-titlebar] .collapsed .panelList/.regionArea/.footArea`
 *   整列收空、只留标题栏上的 toggle（K logo）与 newSession 两枚悬浮钮
 *   ——regionArea 被收掉即两枚入口在官方 Windows 折叠态同样不可见；
 * - 结论：本段是把官方 Windows 的「折叠后极简」取向**择一移植**到非
 *   Windows 标题栏形态（macOS/Linux）的 rail 上——只收会话浏览器的
 *   两枚入口（region 里的其余内容折叠态本就不渲染），不动面板列与
 *   底部区，不是全量照搬 Windows（footer/头像保持贴底不滑移）。
 *   Windows 上若上游已收 regionArea 则本段匹配不到可见元素，幂等无害。
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

/**
 * 侧栏「插件」入口压制（0.1.6-alpha.2）：上游 ui-plugin-manager 向
 * `sidebar.panellist` 无条件注册侧栏条目（包内无任何配置开关，整行禁用会
 * 连管理页一起死），产品决策把插件管理收进设置页的「插件管理」注入分区
 * （plugin-settings.ts），侧栏入口藏掉。
 *
 * 锚点：panellist 条目渲染为 `nav[class*="panelList"] > … > button`（上游
 * SidebarRoot 的 PanelRow），唯一稳定标识是 `aria-label` = locale 解析后的
 * label（zh「插件」/ en "Plugins"）——button 上没有任何 data-* 属性。
 * **不能隐藏整个 nav**：演示文稿/漫剧工坊/定时任务/动效技能库等第三方
 * 产品条目同为 panellist 注册，一藏全没。
 *
 * display:none 而非移除：设置分区入口卡的「打开插件管理器」要对这个隐藏
 * 按钮派发 `.click()` 走上游真实 selectPanel 路径（sidebar-cluster 看门狗
 * 同款：display:none 不影响 HTMLElement.click() 事件派发）。
 *
 * 上游改名/补 data 属性 → 压制静默失效（入口恢复可见），不崩。
 */
const SIDEBAR_PLUGIN_ENTRY_CSS = `nav[class*="panelList"] button[aria-label="插件"],
nav[class*="panelList"] button[aria-label="Plugins"] {
  display: none !important;
}`

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

/** 注入 CSS（无档位、无总开关：五段恒定生效）。 */
function buildOverlayCss(): string {
  return [NATIVE_SIDEBAR_CSS, SIDEBAR_PLUGIN_ENTRY_CSS, RAIL_BROWSER_ACTIONS_CSS, SETTINGS_DIALOG_HEADER_CSS, HERO_WATERMARK_CSS].join('\n\n')
}

/**
 * 给 shell 窗口挂注入层：每次整页加载后重新注入（幂等替换既有 style
 * 元素，SPA 内部导航不清 head 故只需一次；页面跳转间隙执行失败属正常，
 * 下次 did-finish-load 会重试）。重复调用安全，窗口重建时旧监听随窗口
 * 销毁（先捕获 webContents：closed 后再访问 getter 会抛
 * "Object has been destroyed"，sidebar-cluster 同款防御）。
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
