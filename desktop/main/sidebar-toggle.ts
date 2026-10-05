/**
 * 侧边栏折叠按钮迁移 + 会话导航 + 折叠无痕（零侵入注入器）：
 *
 * ## 标题栏左簇（按钮迁移，2026-09-20 用户指定展开态排布）
 * 1. 把上游位于侧边栏 logoRow 右侧的折叠按钮（button.iconButton.toggle，
 *    React 持有、展开/收起两态同一按钮，onClick 走 toggleSidebar 驱动
 *    折叠动画）移到自绘标题栏红绿灯区域右侧；
 * 2. 展开态排布：左箭头 84px → 右箭头 128px → 折叠按钮 174px，三枚 26×26。
 *    分组语义：两枚箭头是一对耦合控件，与 macOS 侧栏惯例（Finder/Mail 的
 *    返回/前进）同序，占据红绿灯右侧第一串；折叠按钮改的是布局而非内容，
 *    落在这一串末位。左=上一个会话、右=下一个会话——在侧边栏会话树
 *    （ui-workspace WorkspaceBrowser，role="tree" 内 role="treeitem" 的
 *    会话行，aria-selected 标记当前会话）中点击相邻行（React 合成事件照常
 *    驱动 onOpen 切换会话）。
 *
 * ## 折叠无痕（2026-10-04，对齐官方桌面端 macOS 折叠形态）
 * 官方桌面端靠 preload 在文档解析早期写 <html data-platform="darwin">
 * （app.asar /lib/preload-app.cjs 实证），AppFrame 据此把折叠宽取 0
 * （columns.ts SIDEBAR_COLLAPSED=56 的 plain-web 分支不生效）：macOS 折叠态
 * **整列归零**、无 rail，控件由 shell.leading seat（HeaderLeadingControls：
 * toggle + new chat 两枚）补回红绿灯右侧。KCoder shell 无 preload → 走
 * plain-web 分支 → 折叠留 56px rail。无痕 = 保持 plain-web，自持归零：
 * - 锚：AppFrame frame 元素（[class*="sidebarCol"] 的父节点，sidebarCol
 *   探针已被 theme-watcher 长期验证）inline
 *   grid-template-columns: '<轨1>px minmax(400px,1fr) minmax(0px,<右栏>px)'
 *   + data-sidebar-collapsed 布尔属性（折叠时存在，AppFrame.tsx 实证）；
 * - 动作：折叠时轨 2/3 从 inline 原样复制、轨 1 写 0px，产出一条
 *   !important 规则写进独立 <style>——不改 React 的 inline（层叠天然压过
 *   非 important 内联；同元素 [data-animating] 的 grid 轨道过渡照常生效，
 *   折叠/展开保留官方缓动）；展开或解析失败 → 清空规则（退化为 56px
 *   rail，即无痕前的行为，不崩）；
 * - 配套：折叠态 sidebarCol 的 0.5px 右描边一并压掉（0 宽元素仍会画线；
 *   sidebarCol 自带 overflow:hidden，0 宽轨自动裁掉 rail 内容）；
 * - 上游 toggle **两态都隐藏**——原「折叠态恢复显示 rail K logo」随 rail
 *   退役（brand-injector 的 swapRail 同日退役，见该文件头注释）。
 *
 * ## 原生右栏轨道归零（2026-10-05，用户实测「点尾卡文件弹出右栏空白区」）
 *
 * 上游原生右栏（ui-sidebar-right）被产品压制（style-overlay 的
 * NATIVE_SIDEBAR_CSS 把面板/列/分隔条 display:none），但**轨道的预留不随
 * 元素消失**：AppFrame 的 inline 模板第三轨是 `minmax(0px, <右栏宽>px)`，
 * 真实 Chromium 实测（staging/probe-rightbar-gap.mjs）——把
 * `[data-rightbar-col]` 置 display:none 后，计算值仍是
 * `260px 660px 480px`，第三轨照旧按增长上限撑满，中列只拿到 1140px，
 * 于是右侧留下一条**空白**（= 用户截图红框）。空 minmax 轨并非解析为 0 宽
 * ——旧注释那条推断有误，这正是本 bug 反复「复发」的原因：CSS 压制从来
 * 没能力收回这段宽度，真正的防线一直是插件认领打开手势。
 *
 * 触发链（2026-10-05 实测定位）：尾卡的「变更」手势走上游
 * `ctx.sidebarRight.openResource('dsh-resource://changes-review/…')`；退役
 * dsh-file-review-kcoder 后**没人再认领该地址**（它的 review-address.ts
 * 正是包 `openResource` 认领 changes-review 的那道门），于是落到引擎默认
 * 通道打开原生右栏 → 面板被压制看不见、**轨道预留的空白看得见**。
 *
 * 因此本注入器（frame 轨道覆盖的唯一所有者，避免两条 !important 规则互压）
 * 在折叠无痕之外**恒把第三轨写 0px**：轨 1/2 仍从 inline 原样复制
 * （折叠态轨 1 写 0），轨 3 固定 0。任何原生打开手势都不再占宽，产品侧
 * 无需重新实现审查 UI（file-review 已按用户决定退役）。
 *
 * 锚：`:has(> [data-rightbar-col])`——结构锚（frame = 右栏列的父节点），
 * 与类名/hash 无关；运行期 `CSS.supports('selector(:has(> div))')` 探测，
 * 不支持时退回折叠态的 `[data-sidebar-collapsed]` 属性锚（轨 3 归零在该
 * 退化路径上不可用，行为与本次改动前一致，不崩）。
 *
 * ## 新会话代理（2026-10-04，折叠态左簇第二枚）
 * 折叠态 rail 随无痕不可见，rail 里的 newSession 按钮仍可程序化点击
 * （overflow 裁剪 ≠ 不可点：HTMLElement.click() 照常派发 React 合成事件）
 * ——代理点击转发 button[class*="newSession"]；图标静态内联
 * IconNewChatOutlineRegular（strokeWidth 1，16px，与官方 seat 同款字形；
 * 静态而非克隆——上游 newSession 图标随 wide/rail/windowsTitlebar 分支
 * 漂移 14/16/18，克隆会把漂移带进代理，同折叠按钮 2026-09-30 决策）；
 * aria-label/disabled 实时镜像；上游缺席 → 代理隐藏不留死按钮。
 * 展开态代理隐藏（展开态有 logoRow brand 新会话入口）。
 * 折叠态排布：折叠按钮 84px → 新会话 120px（对齐官方 seat 节奏：官方
 * 88px 起 28×28 gap8——字形间距 20px；本仓沿用红绿灯右侧 84px 起排惯例、
 * 26×26 按钮，字形间距同为 20px）。
 *
 * 注入脚本（页面上下文）做四件事：
 * 1. 隐藏上游 toggle（两态；inline display:none + CSS !important 兑底，
 *    React 重建的按钮不带 inline 样式靠 CSS 兜底）；
 * 2. 折叠无痕规则管理 + 左簇状态自适应 + 标题栏 label 让位随态更新
 *    （frame 属性 observer + body childList observer 全部汇入 syncAll；
 *    --dsh-titlebar-extra-left：折叠 76/142、展开 130/196，theme-watcher
 *    的 margin-left/max-width 消费此变量，CSS 变量变化自动重算无需重建）；
 * 3. 在自绘标题栏（theme-watcher 注入的 #__dsh_desktop_titlebar）注入四枚
 *    按钮（DOM 序恒为 左箭头→右箭头→折叠→新会话；display:none 不进 Tab
 *    序，故两态的焦点序都与视觉序一致：展开 prev/next/toggle、折叠
 *    toggle/new）；红绿灯区域 12~64px 不可侵占，双平台同坐标；注入顺序
 *    即 Tab 序基础。Windows 无原生红绿灯：左角绘制三颗装饰红绿灯圆点
 *    （与 macOS 同色同几何，纯装饰 pointer-events:none，拖拽区照旧穿透）；
 *    - 折叠按钮点击 → 上游 toggle.click()：React 合成事件照常，折叠状态、
 *      动画、rail 全部由上游驱动；图标为静态内联 panel-left 矢量（恒
 *      16px，不克隆——上游 panelIcon 随状态漂移尺寸，克隆会把漂移带进
 *      按钮，2026-09-30 决策），aria-label/title 实时同步；
 *    - 新会话代理点击 → 上游 newSession.click()（见上节）；
 *    - 箭头按钮点击 → 会话树相邻行 click()，aria-label 固定；收起态无
 *      会话列表 → 先触发上游 toggle 展开再导航；
 * 4. label 让位坐标 = 当前态最右按钮右缘 + 间距 8 - 平台 leftPad。
 *
 * 自愈教训（保留警示）：绝不能在 observer 回调里回写按钮 innerHTML——
 * TOGGLE_ICON_SVG 是自闭合写法，innerHTML 写入后读回为展开形态，「读回 !==
 * 源串」恒真 → sync 再写 → 再触发 → 无限微任务风暴，主线程 100% 冻结
 * （0.15.0 当晚渲染进程卡死根因）。图标只在注入时写一次，sync 只同步
 * aria/title。轨道切分器刻意不用正则：模板字符串内 \s 会被转义折叠成 s
 * （单反斜杠陷阱），字符行走解析无此风险。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，本注入器
 * 注册在其后），轮询等待 bar 存在（与 sidebar-cluster 同款）。
 *
 * @module desktop/main/sidebar-toggle
 */
import type { BrowserWindow } from 'electron'

/** 展开态折叠按钮左缘占位符（smoke 从源码提取后替换为平台值）。 */
const PLACEHOLDER = '${TOGGLE_BTN_LEFT}'

/** 左箭头（上一个会话）按钮左缘占位符。 */
const ARROW_PREV_PLACEHOLDER = '${TOGGLE_ARROW_PREV_LEFT}'

/** 右箭头（下一个会话）按钮左缘占位符。 */
const ARROW_NEXT_PLACEHOLDER = '${TOGGLE_ARROW_NEXT_LEFT}'

/** 折叠态折叠按钮左缘占位符（无痕态左簇首枚）。 */
const COLLAPSED_TOGGLE_PLACEHOLDER = '${COLLAPSED_TOGGLE_LEFT}'

/** 折叠态新会话代理按钮左缘占位符。 */
const NEW_BTN_PLACEHOLDER = '${NEW_BTN_LEFT}'

/** 展开态标题栏 label 让位量占位符（最右按钮右缘 + 间距 8 - 平台 leftPad）。 */
const EXTRA_PLACEHOLDER = '${TOGGLE_EXTRA_LEFT}'

/** 折叠态标题栏 label 让位量占位符（左簇换成 toggle+new 两枚后的同公式值）。 */
const COLLAPSED_EXTRA_PLACEHOLDER = '${COLLAPSED_EXTRA_LEFT}'

/**
 * 折叠按钮静态图标占位符：构建时替换为完整 panel-left path（取自上游
 * dsh-client-ui-primitives 的 IconPanelLeftOutline16，viewBox 0 0 16 16、
 * fillRule evenodd、fill currentColor，固定 16×16）。放占位符是因为
 * 2151 字符的 path 数据内嵌会让源码这一行不可读；真值由下方
 * TOGGLE_ICON_SVG 常量（模块装配段）注入。
 */
const TOGGLE_ICON_PLACEHOLDER = '${TOGGLE_ICON_SVG}'

/** 新会话代理静态图标占位符（同上，IconNewChatOutlineRegular，三笔 stroke）。 */
const NEW_ICON_PLACEHOLDER = '${NEW_ICON_SVG}'

/** 装饰红绿灯开关占位符（Windows：左角绘制三颗装饰圆点，与 macOS 原生
 * 红绿灯同几何，锚定按钮组；macOS：原生红绿灯在场，不绘制）。 */
const DOTS_PLACEHOLDER = '${TOGGLE_DECO_DOTS}'

/**
 * 折叠按钮静态图标（路径与上游 IconPanelLeftOutline16 逐字形一致，恒 16px 框）。
 *
 * viewBox 外扩 1.75px（画稿按 16/19.5 ≈ 0.82 渲染）：上游这枚 panel-left 的
 * 画稿铺满整个 16px 框（ink 16×15），而标题栏同排的其它字形——本注入器的
 * new-chat（ink 13.2）、右侧 open-in-app 那三枚（VS Code / 终端 / 面板，
 * ink 12.9~13.3）——画稿本身内缩约 20%。2026-10-04 用户反馈「左侧折叠钮比
 * 右侧按钮组明显大」：截图像素实测（DPR 2、页面缩放 0.81）显示差异**全部
 * 来自画稿、不在按钮盒**——折叠钮 ink 26 native px vs 同排 21/21/23（连本组
 * 自己的 new-chat 也是 21），而按钮盒 26px 与 shell 记录的右侧那组同值。
 * 外扩 viewBox 后 ink ≈ 21，与同排齐平；盒径（26px）与命中区不动。
 */
const TOGGLE_ICON_SVG =
  '<svg width="16" height="16" viewBox="-1.75 -1.75 19.5 19.5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="' +
  'M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 1.25338e-09 10.3111 1.25338e-09 9.14986V6.85014C1.25329e-09 5.68895 -0.000126137 4.7629 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272Z' +
  'M5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715Z' +
  'M4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.8268 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z' +
  '"/></svg>'

/**
 * 新会话代理静态图标（与上游 IconNewChatOutlineRegular strokeWidth=1 逐字形
 * 一致：气泡轮廓 + 纵横两笔加号，stroke currentColor 继承按钮色，恒 16px）。
 */
const NEW_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" stroke-width="1" aria-hidden="true">' +
  '<path d="M2.37091 11.2501C1.58745 9.89288 1.32067 8.29835 1.61969 6.76006C1.91872 5.22177 2.76342 3.8433 3.99826 2.87846C5.2331 1.91362 6.77494 1.42737 8.33988 1.50925C9.90482 1.59113 11.3875 2.23562 12.5149 3.32406C13.6425 4.41269 14.3387 5.87206 14.4754 7.4334C14.612 8.99474 14.18 10.5529 13.2587 11.8209C12.3375 13.0888 10.9891 13.9813 9.46194 14.3337C8.18691 14.628 6.85895 14.5294 5.64989 14.0605C5.1712 13.8748 4.76962 13.4932 4.26534 13.3967C3.67413 13.2835 2.95257 13.5598 2.03794 14.3337" stroke="currentColor"/>' +
  '<path d="M8 5V11" stroke="currentColor"/>' +
  '<path d="M5 8H11" stroke="currentColor"/>' +
  '</svg>'

const PAGE_JS = `(() => {
  if (window.__dshSidebarToggleWired) return
  window.__dshSidebarToggleWired = true
  const BTN_ID = '__dsh_desktop_toggle_btn'
  const PREV_ID = '__dsh_desktop_prev_btn'
  const NEXT_ID = '__dsh_desktop_next_btn'
  const NEW_ID = '__dsh_desktop_new_btn'
  const VOID_ID = '__dsh_desktop_sidebar_void_style'
  const BTN_LEFT = ${PLACEHOLDER}
  const PREV_LEFT = ${ARROW_PREV_PLACEHOLDER}
  const NEXT_LEFT = ${ARROW_NEXT_PLACEHOLDER}
  const COLLAPSED_TOGGLE_LEFT = ${COLLAPSED_TOGGLE_PLACEHOLDER}
  const NEW_LEFT = ${NEW_BTN_PLACEHOLDER}
  const EXTRA_LEFT = ${EXTRA_PLACEHOLDER} // 展开态：最右按钮右缘 + 间距 8 - 平台 leftPad
  const COLLAPSED_EXTRA_LEFT = ${COLLAPSED_EXTRA_PLACEHOLDER} // 折叠态同公式
  const DECO_DOTS = ${DOTS_PLACEHOLDER} // Windows true：绘制装饰红绿灯；macOS false（原生红绿灯）
  const DOTS_ID = '__dsh_desktop_deco_lights'
  // 会话导航箭头图标（chevron，参考用户图中红框内左右箭头形态）
  const ARROW_LEFT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>'
  const ARROW_RIGHT_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'
  // 折叠/新会话按钮固定图标：与上游同字形、静态内联（注入时一次写入），
  // 不克隆上游 svg——上游图标随状态漂移尺寸（见文件头），克隆会把漂移带
  // 进按钮；更不能在 observer 回调回写 innerHTML（无限微任务风暴，见文件头）。
  const TOGGLE_ICON_SVG = ${TOGGLE_ICON_PLACEHOLDER}
  const NEW_ICON_SVG = ${NEW_ICON_PLACEHOLDER}

  // —— 锚点：AppFrame frame = sidebarCol 的父节点 ——
  // sidebarCol 探针与 theme-watcher 同款（长期验证）；frame 持有 inline
  // grid-template-columns（三轨）与 data-sidebar-collapsed 布尔属性。
  const frameEl = () => {
    const col = document.querySelector('[class*="sidebarCol"]')
    return col !== null ? col.parentElement : null
  }
  const isCollapsed = () => {
    const f = frameEl()
    return f !== null && f.hasAttribute('data-sidebar-collapsed')
  }
  // 上游折叠按钮（logoRow 右侧，两态同一按钮）与上游新会话按钮
  // （SidebarRoot 两态都渲染；折叠态被 0 宽轨裁剪但仍可程序化点击）
  const toggleEl = () => document.querySelector('[class*="logoRow"] button[class*="toggle"]')
  const newEl = () => document.querySelector('button[class*="newSession"]')

  // 标题栏 label 让位初值（展开态）：theme-watcher 的 margin-left/max-width
  // 消费此变量；layoutCluster 会按折叠/展开覆盖
  document.documentElement.style.setProperty('--dsh-titlebar-extra-left', EXTRA_LEFT + 'px')

  // —— 上游 toggle 两态都隐藏（rail 随无痕退役）——
  const hideToggle = () => {
    const t = toggleEl()
    if (t !== null && t.style.display !== 'none') t.style.display = 'none'
  }
  hideToggle()

  // 兜底样式 + 注入按钮外观（与 sidebar-cluster 代理按钮同款，四枚共享）
  const style = document.createElement('style')
  style.id = '__dsh_desktop_toggle_style'
  // 按钮选择器组：前缀/后缀必须应用到每个 id——直接用逗号组字符串
  // 拼 ' svg'/':hover' 只会作用于最后一个选择器（#A,#B,#C svg 实为
  // #A、#B、#C svg 三个选择器）
  const btnSel = (prefix, suffix) => [BTN_ID, PREV_ID, NEXT_ID, NEW_ID].map((id) => prefix + '#' + id + suffix).join(',')
  const rules = [
    // 上游 toggle 两态隐藏（rail 已无痕；React 重建的按钮不带 inline display，靠此兑底）
    '[class*="logoRow"] button[class*="toggle"]{display:none !important}',
    btnSel('', '') + '{all:unset;box-sizing:border-box;position:absolute;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    // 图标尺寸钳制（双保险）：四枚按钮内 svg 一律 16×16
    btnSel('', ' svg') + '{width:16px !important;height:16px !important;max-width:16px;max-height:16px;display:block;flex:none}',
    '#' + BTN_ID + '{left:' + BTN_LEFT + 'px}',
    '#' + PREV_ID + '{left:' + PREV_LEFT + 'px}',
    '#' + NEXT_ID + '{left:' + NEXT_LEFT + 'px}',
    '#' + NEW_ID + '{left:' + NEW_LEFT + 'px}',
    btnSel('body[data-ds-dark-theme] ', '') + '{color:rgba(232,234,237,.8)}',
    btnSel('', ':hover') + '{background:color-mix(in srgb,currentColor 10%,transparent)}',
    btnSel('', ':active') + '{background:color-mix(in srgb,currentColor 18%,transparent)}',
    btnSel('', ':disabled') + '{opacity:.4;cursor:default}',
  ]
  // Windows 装饰红绿灯：与 macOS 原生红绿灯同几何（left 12、三颗 12px
  // 圆点、间距 8，占 12~64px，top:50% 垂直居中与按钮同排）；纯装饰
  // pointer-events:none。macOS 不注入（原生红绿灯由系统绘制）。
  if (DECO_DOTS) {
    rules.push('#' + DOTS_ID + '{position:absolute;left:12px;top:50%;transform:translateY(-50%);display:flex;gap:8px;pointer-events:none;user-select:none}')
    rules.push('#' + DOTS_ID + ' i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)}')
  }
  style.textContent = rules.join('')
  document.head.append(style)

  // —— 折叠无痕 + 原生右栏轨道归零：独立 style 元素，textContent 随态清写 ——
  // 规则：轨 2 从 frame inline 原样复制、轨 1 折叠时写 0px、**轨 3 恒 0px**
  // （见文件头「原生右栏轨道归零」），!important 压过 React inline（不改
  // inline，同元素 [data-animating] 的 grid 轨道过渡照常生效）；解析失败 →
  // 清空（退化为上游原样，不崩）。
  const voidStyle = document.createElement('style')
  voidStyle.id = VOID_ID
  document.head.append(voidStyle)
  // 结构锚：frame = [data-rightbar-col] 的父节点（不绑类名/hash）。:has()
  // 需 Chromium 105+，运行期探测一次；不支持时退化为折叠态属性锚。
  const FRAME_SEL = (() => {
    try { return CSS.supports('selector(:has(> div))') ? ':has(> [data-rightbar-col])' : null } catch (e) { return null }
  })()
  // 轨道切分：顶层空格切分、括号感知（minmax(400px, 1fr) 含空格不切开）。
  // 刻意不用正则——模板字符串内 \\s 会被转义折叠（单反斜杠陷阱），字符
  // 行走无此风险。inline 值由浏览器序列化，分隔符恒为单空格。
  const splitTracks = (raw) => {
    const out = []
    let cur = ''
    let depth = 0
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      if (depth === 0 && c === ' ') {
        if (cur !== '') { out.push(cur); cur = '' }
        continue
      }
      cur += c
    }
    if (cur !== '') out.push(cur)
    return out
  }
  const syncVoid = () => {
    let css = ''
    const f = frameEl()
    if (f !== null) {
      const raw = f.style.gridTemplateColumns
      const tracks = typeof raw === 'string' && raw !== '' ? splitTracks(raw) : null
      if (tracks !== null && tracks.length === 3) {
        const collapsed = f.hasAttribute('data-sidebar-collapsed')
        // 轨 3 恒 0px：上游原生右栏被压制后面板不可见，但轨道照旧按
        // minmax(0px,Npx) 的增长上限预留 → 留下空白（见文件头实测）。
        const value = (collapsed ? '0px' : tracks[0]) + ' ' + tracks[1] + ' 0px'
        // 注入卫生：轨值只可能是 px/minmax/fr 组合，含危险字符一律判失败
        if (!/[{};<>]/.test(value)) {
          // 结构锚优先；折叠态再补属性锚（既有选择器，兼 :has 不可用时的兜底）
          if (FRAME_SEL !== null) css += FRAME_SEL + '{grid-template-columns:' + value + ' !important}'
          if (collapsed) {
            css += '[data-sidebar-collapsed]{grid-template-columns:' + value + ' !important}'
            css += '[data-sidebar-collapsed] > [class*="sidebarCol"]{border-right:none !important}'
          }
        }
      }
    }
    if (voidStyle.textContent !== css) voidStyle.textContent = css
  }

  // —— 左簇状态自适应 + label 让位随态更新 ——
  // toggle 的 left 由这里 inline 写（84↔174）；prev/next 折叠态藏、new
  // 展开态藏（display:none 不进 Tab 序，两态焦点序与视觉序一致）。new 的
  // 显示还要求上游按钮在场（缺席不留死按钮）。
  const layoutCluster = () => {
    const collapsed = isCollapsed()
    const btn = document.getElementById(BTN_ID)
    if (btn !== null) btn.style.left = (collapsed ? COLLAPSED_TOGGLE_LEFT : BTN_LEFT) + 'px'
    const prevBtn = document.getElementById(PREV_ID)
    if (prevBtn !== null && prevBtn.style.display !== (collapsed ? 'none' : '')) {
      prevBtn.style.display = collapsed ? 'none' : ''
    }
    const nextBtn = document.getElementById(NEXT_ID)
    if (nextBtn !== null && nextBtn.style.display !== (collapsed ? 'none' : '')) {
      nextBtn.style.display = collapsed ? 'none' : ''
    }
    const newBtn = document.getElementById(NEW_ID)
    if (newBtn !== null) {
      const want = collapsed && newEl() !== null ? '' : 'none'
      if (newBtn.style.display !== want) newBtn.style.display = want
    }
    const wantExtra = (collapsed ? COLLAPSED_EXTRA_LEFT : EXTRA_LEFT) + 'px'
    const root = document.documentElement
    if (root.style.getPropertyValue('--dsh-titlebar-extra-left') !== wantExtra) {
      root.style.setProperty('--dsh-titlebar-extra-left', wantExtra)
    }
  }

  // —— 语义同步：折叠按钮 aria/title 从上游 toggle 实时同步（展开=收起
  // 侧边栏 / 折叠=展开侧边栏）；新会话代理镜像上游 aria/disabled（图标为
  // 静态内联，绝不在此回写 innerHTML——见文件头微任务风暴教训）。
  const sync = () => {
    const t = toggleEl()
    const btn = document.getElementById(BTN_ID)
    if (t !== null && btn !== null) {
      const label = t.getAttribute('aria-label') || t.title || ''
      if (label !== '' && btn.getAttribute('aria-label') !== label) {
        btn.setAttribute('aria-label', label)
        btn.title = label
      }
    }
    const src = newEl()
    const proxy = document.getElementById(NEW_ID)
    if (src !== null && proxy !== null) {
      const off = src.disabled === true || src.getAttribute('aria-disabled') === 'true'
      if (proxy.disabled !== off) proxy.disabled = off
      const label = src.getAttribute('aria-label') || ''
      if (label !== '' && proxy.getAttribute('aria-label') !== label) {
        proxy.setAttribute('aria-label', label)
        proxy.title = label
      }
    }
  }

  // 会话导航：在侧边栏会话树（ui-workspace WorkspaceBrowser，role="tree"
  // 内 role="treeitem" 的会话行，aria-selected 标记当前会话）中点击相邻
  // 行，React 合成事件照常驱动 onOpen 切换会话。列表仅展开态挂载：
  // 收起态点箭头先展开侧边栏（上游 toggle），再点即导航。
  const sessionRows = () =>
    document.querySelectorAll('[role="tree"] [role="treeitem"][class*="sessionRow"]')
  const navigateSession = (dir) => {
    const rows = sessionRows()
    if (rows.length === 0) {
      const t = toggleEl()
      if (t !== null && isCollapsed()) t.click()
      return
    }
    let current = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('aria-selected') === 'true') {
        current = i
        break
      }
    }
    const target =
      current === -1 ? (dir > 0 ? 0 : rows.length - 1) : current + dir
    if (target >= 0 && target < rows.length) rows[target].click()
  }

  // 全量同步：所有 observer（body childList / frame 属性）与轮询都汇入
  // 这一个函数——状态只进不出，不会互相覆盖。
  const syncAll = () => {
    ensureFrameObs()
    hideToggle()
    sync()
    syncVoid()
    layoutCluster()
  }

  // frame 属性 observer：折叠态切换（data-sidebar-collapsed 增删）与
  // 折叠态窗口缩放（inline 轨道随视口重写 → 轨 2/3 复制保持新鲜）都经此
  // 进入 syncAll。frame 被 React 重建时由 ensureFrameObs 换绑。
  let frameObs = null
  let frameSeen = null
  const ensureFrameObs = () => {
    const f = frameEl()
    if (f === null) return
    if (frameObs !== null && frameSeen === f) return
    if (frameObs !== null) frameObs.disconnect()
    frameObs = new MutationObserver(syncAll)
    frameObs.observe(f, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'] })
    frameSeen = f
  }

  const bar = () => document.getElementById('__dsh_desktop_titlebar')

  const injectBtn = () => {
    // 哨兵取**最后追加**的那枚（新会话代理）：改序后仍是「四枚齐备」的
    // 判据，不会把半注入状态误判为已注入
    if (document.getElementById(NEW_ID) !== null) return 'present'
    const host = bar()
    if (host === null) return 'absent'
    // Windows 装饰红绿灯先于按钮注入（macOS DECO_DOTS=false 跳过；bar
    // 为自注入元素非 React 持有，注入后无需 observer 自愈）
    if (DECO_DOTS && document.getElementById(DOTS_ID) === null) {
      const wrap = document.createElement('span')
      wrap.id = DOTS_ID
      wrap.setAttribute('aria-hidden', 'true')
      const colors = ['#FF5F57', '#FEBC2E', '#28C840']
      for (let i = 0; i < colors.length; i++) {
        const d = document.createElement('i')
        d.style.background = colors[i]
        wrap.append(d)
      }
      host.append(wrap)
    }
    const mkBtn = (id, aria, iconSvg, onClick) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.id = id
      if (aria !== '') {
        b.setAttribute('aria-label', aria)
        b.title = aria
      }
      const box = document.createElement('span')
      box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
      if (iconSvg !== '') box.innerHTML = iconSvg
      b.append(box)
      b.onclick = onClick
      host.append(b)
      return b
    }
    // 追加序 = DOM 序（Tab 序基础）：左箭头 → 右箭头 → 折叠 → 新会话。
    // 定位靠各自 left；两态可见子集不同但 display:none 不进 Tab 序，焦点
    // 序恒与视觉序一致（展开 prev→next→toggle / 折叠 toggle→new）。
    mkBtn(PREV_ID, '上一个会话', ARROW_LEFT_SVG, () => navigateSession(-1))
    mkBtn(NEXT_ID, '下一个会话', ARROW_RIGHT_SVG, () => navigateSession(1))
    mkBtn(BTN_ID, '', TOGGLE_ICON_SVG, () => {
      const t = toggleEl()
      if (t !== null) t.click()
    })
    // 新会话代理初始隐藏（展开态态默认；layoutCluster 首跑按态纠正）
    const newBtn = mkBtn(NEW_ID, '新会话', NEW_ICON_SVG, () => {
      const src = newEl()
      if (src !== null) src.click()
    })
    newBtn.style.display = 'none'
    syncAll()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtn()
    syncAll()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：React 重建 toggle/侧栏（body childList）后重新隐藏 + 语义同步；
  // frame 属性变化（折叠切换/窗口缩放）由 frameObs 承接，同入 syncAll。
  new MutationObserver(syncAll)
    .observe(document.body, { subtree: true, childList: true })
})()`

/**
 * 把折叠按钮迁移注入器挂到 shell 窗口：
 * 仅 darwin/win32（自绘标题栏存在的平台）；did-finish-load 注入
 * （每次导航后重新注入，脚本自幂等）。
 */
export function attachSidebarToggle(win: BrowserWindow): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  // 双平台同坐标。展开态（2026-09-20 用户指定）：红绿灯区域 12~64px 不可
  // 侵占 → 左箭头 84 → 右箭头 128 → 折叠 174。折叠态（2026-10-04 无痕）：
  // 折叠 84 → 新会话 120——对齐官方 leading seat 的两枚节奏（官方 88px 起
  // 28×28 gap8 = 字形间距 20px；本仓 84px 起 26×26，字形间距同为 20px）。
  // Windows 无原生红绿灯，由装饰圆点补齐同几何左角；leftPad 与
  // theme-watcher 一致（darwin 78/win32 12）。
  const leftPad = process.platform === 'win32' ? 12 : 78
  const prev = 84
  const next = 128
  const toggle = 174
  const collapseToggle = 84
  const newBtn = 120
  // label 让位 = 当前态最右按钮右缘 + 间距 8 - leftPad（两态各算各的；
  // 取最大值，改排布不必动这两行）：
  // 展开：174+26+8-78=130（mac）/ 196（win）；折叠：120+26+8-78=76 / 142
  const extra = Math.max(prev, next, toggle) + 26 + 8 - leftPad
  const collapseExtra = Math.max(collapseToggle, newBtn) + 26 + 8 - leftPad
  const script = PAGE_JS
    .replaceAll(PLACEHOLDER, String(toggle))
    .replaceAll(ARROW_PREV_PLACEHOLDER, String(prev))
    .replaceAll(ARROW_NEXT_PLACEHOLDER, String(next))
    .replaceAll(COLLAPSED_TOGGLE_PLACEHOLDER, String(collapseToggle))
    .replaceAll(NEW_BTN_PLACEHOLDER, String(newBtn))
    .replaceAll(EXTRA_PLACEHOLDER, String(extra))
    .replaceAll(COLLAPSED_EXTRA_PLACEHOLDER, String(collapseExtra))
    .replaceAll(DOTS_PLACEHOLDER, process.platform === 'win32' ? 'true' : 'false')
    .replaceAll(TOGGLE_ICON_PLACEHOLDER, JSON.stringify(TOGGLE_ICON_SVG))
    .replaceAll(NEW_ICON_PLACEHOLDER, JSON.stringify(NEW_ICON_SVG))
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(script, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
