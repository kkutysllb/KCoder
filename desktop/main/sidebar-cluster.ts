/**
 * coding-sidebar 开关簇收纳（零侵入代理注入器）：插件右上角的开关簇
 * （fixed 宿主层内 absolute，z-45）与 KCoder 自绘状态栏（z 最高、48px）
 * 在同一区域叠死，且层级被状态栏物理盖住——纯 CSS 挪位进状态栏不可行。
 * 因此与 sidebar-toggle（上游折叠按钮迁移）同构：
 *
 * - 隐藏插件开关簇本体（CSS，display:none 兑底）；
 * - 状态栏右侧按钮序列末尾注入一枚 KCoder 同款代理按钮（图标克隆
 *   插件按钮 svg，语义 = 右侧面板开合）；
 * - 点击转发插件真实按钮（React 合成事件照常，开关状态、面板动画
 *   全部由插件驱动）；disabled / aria-label / 图标实时同步；
 * - 插件缺席（未装/禁用/host 未挂载）→ 代理按钮隐藏，不残留死按钮；
 *   无会话（noSession）→ 插件按钮 disabled，代理同步置灰。
 *
 * 底面板产品侧弃用（2026-08）：插件底面板在 agent 运行态黑屏（渲染
 * height 与 geometry 挤压两条写入路径状态快照脱节：面板 height:0 但
 * --dsh-sidebar-height 残留 220px，且 bottomOpenedOnce 置位后无自动
 * 唤醒信号，热补丁只认 visibility:hidden 症状治不了），产品决策弃用
 * 插件底面板，终端回归自研（terminal-panel，按钮 right 44）。本注入器
 * 不再注入底面板代理按钮，并加压制看门狗：插件底面板仍有无按钮的
 * 打开路径——会话状态持久化恢复（record.bottomOpen）、活动 pane 归位
 * （activePane 落在 bottomSplits 自动展开）——低频轮询发现展开态即
 * 转发一次开关簇首枚按钮收回（簇本体 display:none 不影响
 * HTMLElement.click() 事件派发，React 合成事件照常，与代理转发同款
 * 机制）；收回后插件状态机自行持久化 bottomOpen:false，下次启动不再
 * 恢复展开。零 patch：契约面只有 class 导出名（bottomPanel /
 * bottomPanelHidden）与簇按钮顺序，插件更新不破坏；若未来版本改名，
 * 压制静默失效回到插件原状（届时插件或已修复黑屏，重新评估）。
 *
 * git 互斥让位协议已随宿主面板退役（2026-08）：旧版曾在本脚本暴露
 * window.__dshPanelOpen/Toggle/__dshOpenPlan 并经 MutationObserver
 * 上报开合沿供旧 git 卡片反向让位与计划预览点火；git 面板已由
 * dsh-git-panel 客户端插件整体替代（软依赖 betterSidebar.openTab
 * 直连预览，无需 DOM 模拟），上述暴露与 observer 一并摘除。
 *
 * 上游契约（全部运行时探测，哈希前缀无关）：
 * - 开关簇宿主 `[data-dsh-panel-host]`（插件 fixed 覆盖层，data 属性
 *   是插件的稳定 API 面）；簇 `[class*="toggleCluster"]`、按钮
 *   `[class*="toggleButton"]`（CSS modules 导出名稳定，哈希前缀随
 *   版本漂移不影响 `[class*=…]` 匹配）；簇内按钮顺序：底部面板在
 *   前、右侧面板在后（宽屏两枚；窄屏 ≤767px 只渲染右侧面板一枚——
 *   取最后一枚恒为右侧面板，首枚仅在枚举 ≥2 时作底部面板，两平台
 *   语义皆稳）；底面板元素 `[class*="bottomPanel"]`，收起态追加
 *   `[class*="bottomPanelHidden"]`；
 * - 按钮宿主：theme-watcher 注入的自绘状态栏（#__dsh_desktop_titlebar）。
 *
 * right 序：侧栏面板 12（本注入器）/ 内嵌终端 44（terminal-panel）/
 * 上下文 76（context-button）/ git 108（dsh-git-panel 插件）；
 * 标题避让带同步见 theme-watcher。
 *
 * 宿主时序不保证：bar 由 theme-watcher 注入（同 did-finish-load，
 * 本注入器注册在其后），轮询等待 bar 存在（与 sidebar-toggle 同款）。
 *
 * @module desktop/main/sidebar-cluster
 */
import type { BrowserWindow } from 'electron'

/** 代理按钮：右侧面板开合（插件主开关）。 */
const PANEL_BTN_ID = '__dsh_desktop_sidebar_panel_btn'

/** 代理按钮右缘 right 偏移（DIP，全局 right 序：侧栏面板 12（本注入器）/
 * 内嵌终端 44（terminal-panel）/ 上下文 76（context-button）/ git 108（插件）。 */
const PANEL_BTN_RIGHT = 12

const PAGE_JS = `(() => {
  if (window.__dshSidebarClusterWired) return
  window.__dshSidebarClusterWired = true
  const PANEL_BTN = '${PANEL_BTN_ID}'
  const bar = () => document.getElementById('__dsh_desktop_titlebar')
  // 插件开关簇与按钮（CSS modules 导出名稳定，哈希前缀无关）
  const cluster = () => document.querySelector('[data-dsh-panel-host] [class*="toggleCluster"]')
  const pluginBtns = () => Array.from(cluster()?.querySelectorAll('button[class*="toggleButton"]') ?? [])
  // 语义映射：最后一枚恒为右侧面板（窄屏唯一一枚也是它）；首枚仅在
  // 枚举 ≥2 时是底部面板（宽屏顺序：底部在前、右侧在后），压制看门狗用
  const panelSrc = () => { const b = pluginBtns(); return b.length > 0 ? b[b.length - 1] : null }

  const style = document.createElement('style')
  style.id = '__dsh_desktop_sidebar_cluster_style'
  style.textContent = [
    // 隐藏插件开关簇本体（代理接管；代理缺席的平台 Linux 不注入本样式）
    '[data-dsh-panel-host] [class*="toggleCluster"]{display:none !important}',
    '#' + PANEL_BTN + '{all:unset;box-sizing:border-box;position:absolute;right:${PANEL_BTN_RIGHT}px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
    // 图标统一 clamp：克隆插件 toggleButton 的 svg 时压到 16px，与侧边栏顶部
    // 三枚按钮（sidebar-toggle）同级，避免插件大图标撑大代理按钮、两处不一致。
    '#' + PANEL_BTN + ' svg{width:16px;height:16px;display:block;flex:none}',
    'body[data-ds-dark-theme] #' + PANEL_BTN + '{color:rgba(232,234,237,.8)}',
    '#' + PANEL_BTN + ':hover:not(:disabled){background:color-mix(in srgb,currentColor 10%,transparent)}',
    '#' + PANEL_BTN + ':active:not(:disabled){background:color-mix(in srgb,currentColor 18%,transparent)}',
    '#' + PANEL_BTN + ':disabled{opacity:.4;cursor:default}',
  ].join('')
  document.head.append(style)

  // 单枚代理同步：缺席隐藏；disabled / aria-label / 图标克隆插件按钮
  const syncOne = (proxy, src) => {
    if (proxy == null) return
    if (src == null) {
      if (proxy.style.display !== 'none') proxy.style.display = 'none'
      return
    }
    if (proxy.style.display === 'none') proxy.style.display = ''
    if (proxy.disabled !== src.disabled) proxy.disabled = src.disabled
    const label = src.getAttribute('aria-label') || ''
    if (label !== '' && proxy.title !== label) {
      proxy.title = label
      proxy.setAttribute('aria-label', label)
    }
    const svg = src.querySelector('svg')
    const box = proxy.firstElementChild
    if (svg != null && box != null && box.innerHTML !== svg.outerHTML) {
      box.innerHTML = svg.outerHTML
    }
  }
  const sync = () => {
    syncOne(document.getElementById(PANEL_BTN), panelSrc())
  }

  /* ---- 底面板压制看门狗（产品侧弃用，见注入器头注释）----
 * 展开态判定：面板元素存在且不含收起态 class；发现即转发一次簇首枚
 * 按钮（React 合成点击切换 bottomOpen）。冷却窗口盖住收起过渡，防
 * 连击抖动；窄屏簇只一枚（无底面板按钮）且底面板本就不渲染，天然
 * 空转。低频轮询永久存续（页面导航后本脚本重注入，旧定时器随页面
 * 销毁自动清理），成本 = 每秒一次 querySelector。 */
  const bottomExpanded = () => document.querySelector('[class*="bottomPanel"]:not([class*="bottomPanelHidden"])')
  let lastSuppress = 0
  const suppressBottom = () => {
    if (bottomExpanded() == null) return
    const now = Date.now()
    if (now - lastSuppress < 800) return
    lastSuppress = now
    const btns = pluginBtns()
    if (btns.length >= 2) btns[0].click()
  }
  setInterval(suppressBottom, 800)

  const injectBtns = () => {
    if (document.getElementById(PANEL_BTN) != null) return 'present'
    const host = bar()
    if (host == null) return 'absent'
    const b = document.createElement('button')
    b.type = 'button'
    b.id = PANEL_BTN
    b.style.display = 'none' // 插件簇出现前隐藏（sync 负责点亮）
    const box = document.createElement('span')
    box.style.cssText = 'display:inline-flex;align-items:center;justify-content:center'
    b.append(box)
    b.addEventListener('click', () => { panelSrc()?.click() })
    host.append(b)
    sync()
    return 'injected'
  }

  let tries = 0
  const poll = setInterval(() => {
    const status = injectBtns()
    sync()
    if (status !== 'absent' || ++tries > 120) clearInterval(poll)
  }, 500)

  // 自愈：插件重挂开关簇（React 重建）/ 按钮态变化后重新同步
  new MutationObserver(sync)
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })
})()`

/**
 * 把开关簇收纳注入器挂到 shell 窗口：
 * 仅 darwin/win32（自绘状态栏存在的平台；Linux 无状态栏，插件开关簇
 * 原样显示，底面板压制看门狗也随本脚本不注入——Linux 用户仍可完整
 * 使用插件底面板）；did-finish-load 注入（每次导航后重新注入，脚本
 * 自幂等）。
 */
export function attachSidebarCluster(win: BrowserWindow): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  })
}
