/**
 * 设置页单页化（零侵入形态改造）：上游 SettingsRoot（ui-settings-general）
 * 是居中 800px 模态浮层（figma 501:29947：overlay/mask/panel 三层 + 左
 * 188px nav rail + content 的两分栏内芯），KCoder 桌面形态把它改成铺满
 * 窗口的单页两分栏——与工作区「左列表右内容」的页面心智一致：
 *
 * - 浮层语义（居中、圆角 r24、lv3 阴影、半透明 mask）全部去除，panel
 *   以 overlay（fixed inset 0）为定位宿主 inset 铺满，顶部让位 KCoder
 *   自绘状态栏 48px（fixed top:0 z 最高；Linux 无状态栏，让 0）；
 * - nav rail 背景分层（--dsw-specific-sidebar-fill + border-l1，AppFrame
 *   sidebarCol 同款 token）——左列表右内容的分栏层次与 workspace 一致；
 * - nav 顶部注入「返回工作区」按钮（MutationObserver 等面板挂载，插
 *   navTitle 之前；点击转发面板 header 的 close 按钮走上游真实关闭
 *   路径；文案中文写死，context-button「返回任务」同款先例）；
 * - 内容区限宽：options 右侧统一为 960px 居中的卡片列；通用设置的每个
 *   功能项独立成卡片，桌面样式定制内部再按 data-key 拆分卡片，避免宽屏
 *   表单横向拉满造成信息稀疏。
 *
 * 行为层一概不动（上游 Escape 关闭、mask 点击关闭、close 按钮、进入
 * 焦点落 close 按钮、onboarding 步骤组合全部照常）——单页形态下 mask
 * 被 panel 完全盖住不可见，Escape / close / 返回按钮都是返回工作区的
 * 路径。settings.section 各分区（上游常规/模型/预设/插件 + KCoder 注入
 * 的样式/语言/技能/MCP）渲染在 .options 滚动区，限宽对它们同样生效。
 *
 * 上游契约（哈希形态无关，style-overlay 同款经验：运行时即时编译
 * _<hash>_<类名> / vite build _<类名>_<hash>，子串匹配通吃）：
 * - 结构锚 `[class*="_overlay"] > [class*="_panel"][role="dialog"]`——
 *   overlay/mask/panel 三件套同层结构是 SettingsRoot 专属组合
 *   （ui-primitives Modal 的 DOM 结构不同，泛名 _panel/_overlay 不会
 *   误伤；特异性 (0,3,0) 恒赢上游单类 (0,1,0)）；
 * - 面板内锚（均以 role=dialog 限定）：`> [class*="_nav"]`（rail）、
 *   `[class*="_navTitle"]`（标题，返回按钮插入位）、`[class*="_header"]
 *   > [class*="_close"]`（关闭按钮，返回转发目标）、`[class*="_options"]`
 *   （内容滚动区）；
 * - 图标 IconChevronLeftOutline14 path 零误差复制自 ui-primitives
 *   icons/index.tsx（上游图标资产，非自造）；
 * - 类改名 / 结构调整 → 覆盖静默失效回模态原样，不崩不错位。
 *
 * @module desktop/main/settings-page
 */
import type { BrowserWindow } from 'electron'
import { SHELL_TITLEBAR_HEIGHT } from './theme-watcher'

/** 注入的 style 元素 id（幂等；SPA 内部导航不清 head，常驻即可）。 */
const STYLE_ID = '__dsh_desktop_settings_page_style'

/** 「返回工作区」按钮 id（挂面板 nav 内，随面板卸载消亡，无需清理）。 */
const BACK_ID = '__dsh_desktop_settings_back'

/** 顶部让位高度：自绘状态栏在窗口顶部（fixed top:0 z 最高），Linux
 * 无状态栏让 0。panel 需从状态栏下缘起铺（状态栏靠 body padding-top
 * 下推上游正常流，但 overlay 是 fixed 相对视口，必须显式让位）。 */
const TOP = process.platform === 'linux' ? 0 : SHELL_TITLEBAR_HEIGHT

const PAGE_JS = `(() => {
  if (window.__dshSettingsPageWired) return
  window.__dshSettingsPageWired = true
  const BACK = '${BACK_ID}'

  const style = document.createElement('style')
  style.id = '${STYLE_ID}'
  style.textContent = [
    // 面板铺满：脱离 overlay 的 flex 居中流，inset 定位（top 让位顶部
    // 自绘状态栏，left/right/bottom 贴满），宽高交给 inset；浮层痕迹
    // （圆角/阴影/max-width 收缩）一并去除。z-index:1 上游原值。
    '[class*="_overlay"] > [class*="_panel"][role="dialog"]{position:absolute;inset:${String(TOP)}px 0 0 0;width:auto;height:auto;max-width:none;border-radius:0;box-shadow:none}',
    // nav rail 分层：workspace sidebarCol 同款填充 + 边线，左列表右内容；
    // 宽度 188→240（铺满形态下右内容区很宽，nav 适当加宽比例更协调）
    '[role="dialog"] > [class*="_nav"]{width:240px;background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1)}',
    // 内容限宽居中：右侧表单保持稳定阅读宽度，宽窗口不拉成横向长表单。
    '[role="dialog"] [class*="_options"]{padding:28px 40px 48px}',
    '[role="dialog"] [class*="_options"] > [data-slot="settings.section"]{display:block!important;width:min(100%,960px);max-width:960px!important;margin:0 auto}',
    '[role="dialog"] [class*="_options"] > [data-slot="settings.section"] > *{width:100%;max-width:none;margin-left:auto;margin-right:auto}',
    // 技能/MCP/关于是注入器追加的独立容器，不走 settings.section slot；显式
    // 给它们同一列宽，避免 options 的居中 flex 触发 shrink-to-fit。
    '[role="dialog"] [class*="_options"] > #__dsh_desktop_skills_section,[role="dialog"] [class*="_options"] > #__dsh_desktop_mcp_section,[role="dialog"] [class*="_options"] > #__dsh_desktop_about_section{box-sizing:border-box;width:min(100%,960px);max-width:960px;margin:0 auto;min-width:0}',
    // 通用设置：每个功能项独立成卡片，保留 slot wrapper 的地址能力。
    '[role="dialog"] [data-slot="settings.general.item"]{display:block!important;width:100%;max-width:none!important;margin:0 0 14px!important}',
    '[role="dialog"] [data-slot="settings.general.item"] > *{box-sizing:border-box;width:100%;margin:0!important;padding:20px 24px!important;border:1px solid var(--dsw-alias-border-l2);border-radius:16px!important;background:var(--dsw-alias-bg-module-platform);box-shadow:0 2px 10px rgba(9,16,29,.035)}',
    '[role="dialog"] [data-slot="settings.general.item"] > * [class*="_row"],[role="dialog"] [data-slot="settings.general.item"] > * [class*="_group"]{border-bottom:0}',
    // 桌面样式注入项本身包含多组设置：外层只负责排版，组级别各自成卡。
    '[role="dialog"] [data-slot="settings.general.item"] > #__dsh_desktop_style_item{display:grid;gap:14px;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important}',
    '[role="dialog"] #__dsh_desktop_style_item > [data-key]{box-sizing:border-box;width:100%;margin:0!important;padding:20px 24px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-module-platform);box-shadow:0 2px 10px rgba(9,16,29,.035)}',
    '[role="dialog"] [data-slot="settings.general.item"]:last-child{margin-bottom:0!important}',
    // 深色主题阴影减弱，避免卡片边缘发脏；浅色沿用同一套结构。
    'body[data-ds-dark-theme] [role="dialog"] [data-slot="settings.general.item"] > *,body[data-ds-dark-theme] [role="dialog"] #__dsh_desktop_style_item > [data-key]{box-shadow:0 2px 12px rgba(0,0,0,.16)}',
    // 返回按钮：navCell 同款盒（40 高 r12）+ sidebar 交互 token
    '#' + BACK + '{display:flex;align-items:center;gap:8px;height:40px;padding:9px 16px 9px 12px;box-sizing:border-box;border:none;border-radius:12px;background:transparent;cursor:pointer;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left;flex:none}',
    '#' + BACK + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover)}',
    '#' + BACK + ':active{background:var(--dsw-specific-sidebar-nav-item-active)}',
    '#' + BACK + ' svg{flex:none;display:block}',
    '#' + BACK + ' span{overflow:hidden;white-space:nowrap}',
  ].join('')
  document.head.append(style)

  // 「返回工作区」注入（幂等）：面板打开才挂载，等 navTitle 出现插其前；
  // 点击转发 header close 按钮（React 合成事件照常，上游真实关闭路径）。
  // svg 全 DOM 构造（createElementNS，不用 innerHTML 解析）。
  const backIcon = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '14')
    svg.setAttribute('height', '14')
    svg.setAttribute('viewBox', '0 0 14 14')
    svg.setAttribute('fill', 'none')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M8.5 2.15137L8.07617 2.57617L5.34863 5.30273C5.09294 5.55843 4.86618 5.78438 4.70215 5.98828C4.53117 6.20088 4.38244 6.44405 4.33398 6.75C4.30778 6.91565 4.30778 7.08435 4.33398 7.25C4.38244 7.55595 4.53117 7.79912 4.70215 8.01172C4.86618 8.21561 5.09294 8.44157 5.34863 8.69727L8.07617 11.4238L8.5 11.8486L9.34863 11L8.92383 10.5762L6.19727 7.84863C5.92268 7.57405 5.75151 7.40124 5.6377 7.25977C5.53096 7.12709 5.52187 7.07728 5.51953 7.0625C5.51297 7.02105 5.51297 6.97895 5.51953 6.9375C5.52187 6.92272 5.53096 6.87291 5.6377 6.74023C5.75152 6.59876 5.92268 6.42595 6.19727 6.15137L8.92383 3.42383L9.34863 3L8.5 2.15137Z')
    path.setAttribute('fill', 'currentColor')
    svg.append(path)
    return svg
  }
  const ensureBack = () => {
    if (document.getElementById(BACK) != null) return
    const title = document.querySelector('[role="dialog"] [class*="_navTitle"]')
    if (title == null || title.parentNode == null) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.id = BACK
    btn.title = '返回工作区'
    btn.setAttribute('aria-label', '返回工作区')
    const label = document.createElement('span')
    label.textContent = '返回工作区'
    btn.append(backIcon(), label)
    btn.addEventListener('click', () => {
      document.querySelector('[role="dialog"] [class*="_header"] > [class*="_close"]')?.click()
    })
    title.parentNode.insertBefore(btn, title)
  }
  ensureBack()
  new MutationObserver(ensureBack).observe(document.body, { subtree: true, childList: true })
})()`

/**
 * 把设置页单页化挂到 shell 窗口：did-finish-load 注入（每次导航后重注入，
 * 脚本自幂等）；MutationObserver 仅面板开合时各命中一次 navTitle 查询。
 */
export function attachSettingsPage(win: BrowserWindow): void {
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
