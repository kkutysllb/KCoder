/**
 * win32 标题栏四钮平铺让位。
 *
 * 背景（Windows titleBarOverlay 遮挡缺陷）：四枚面板按钮
 * （sidebar-cluster/context-button 注入，`position:absolute;
 * right:12/76px`；终端由 @kcoder/terminal 插件 client 注入 right:44px、
 * git 由 @kcoder/git-panel 插件 client 注入 right:108px）挂在自绘
 * 标题栏内——absolute 定位基于包含块 padding box（≈窗口右缘），
 * 标题栏为避让原生控制按钮区（titleBarOverlay 右侧 138px，绘制在
 * 窗口层最顶）加的 padding-right:138px 对 absolute 子元素无效 →
 * 按钮带整段（108+26=134 < 138）落在原生按钮区内被盖。
 *
 * 方案沿革：
 * - 2026-08 下拉收纳（panel-menu）：四钮 display:none，一枚菜单按钮
 *   （right:150px）下拉转发 .click()，状态实时克隆。Windows 现场证明
 *   转发层徒增间接性（开合交互绕远、故障定位多一层疑云），2026-08-30
 *   随「平铺让位」决策废弃。
 * - 现行平铺：四钮不隐藏，仅以样式表 !important 把 right 整体平移
 *   +138px（150/182/214/246，原生区左侧安全位）——样式表 !important
 *   压过各注入方的 inline right（non-important）；按钮的开合态蓝点/
 *   置灰/tooltip 等原生行为全保留，无转发层。macOS/Linux 不注入本
 *   模块，四钮原位平铺不变。
 *
 * 历史：内嵌终端曾以 WebContentsView 承载，页面 DOM 下拉菜单盖不
 * 到 compositor 层，需经 console 通道临时收视图（yieldForMenu）。
 * 2026-08 终端已插件化（页面内 DOM 面板，@kcoder/terminal），
 * compositor 冲突不存在，让位协议整体摘除。
 *
 * @module desktop/main/panel-buttons
 */

import type { BrowserWindow } from 'electron'

/** 注入脚本（页面上下文；模板串内无主进程插值，全部为页面代码）。 */
const SHIFT_JS = `(() => {
  if (window.__dshPanelButtonsShiftWired) return
  window.__dshPanelButtonsShiftWired = true
  const STYLE = '__dsh_desktop_panel_buttons_shift'
  let styleEl = document.getElementById(STYLE)
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = STYLE
    document.head.append(styleEl)
  }
  styleEl.textContent = [
    '#__dsh_desktop_sidebar_panel_btn{right:150px !important}',
    '#__dsh_kc_term_btn{right:182px !important}',
    '#__dsh_desktop_context_btn{right:214px !important}',
    '#__dsh_kc_git_btn{right:246px !important}',
  ].join('')
})()`

/**
 * 挂载四钮平铺让位（仅 win32；其他平台为 no-op，四钮原位不变）。
 */
export function attachPanelButtons(win: BrowserWindow): void {
  if (process.platform !== 'win32') return
  const wc = win.webContents
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    wc.executeJavaScript(SHIFT_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载重试
    })
  }
  wc.on('did-finish-load', onDidLoad)
  win.on('closed', () => {
    wc.removeListener('did-finish-load', onDidLoad)
  })
}
