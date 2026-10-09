/**
 * 正文文件类型徽章（零侵入注入器）。自 preview-panel 迁出：文件预览抽屉/Git
 * 面板删除后仍独立存续的页面级功能——
 *
 * 1. 正文文件类型徽章（唯一在役职责）：工具卡片文件路径按钮（scoped 类名含 _fileLink，
 *    文本即路径）与正文文件 mention（_fileMention）——按扩展名前置类型
 *    徽章（TS/JS/MD…）与链接配色。React 只管理首文本节点，前置徽章 span
 *    与 dataset 属性不受意；行重挂会重建按钮，MutationObserver 重扫补回。
 *
 * ## 退役记录（2026-10-10）
 *
 * 工作区探针（选中会话 → session/list RPC → 解析 cwd → 写 --dsh-ws-name /
 * --dsh-ws-path 供自绘标题栏拼「工作区 / 标题」前缀与那枚工作区按钮）整段退役：
 * 用户判定该前缀**鸡肋**（且 S-D2 把按钮搬进官方槽后位置也变了），要求删除。
 * 随之删除：probeSessionId / resolveWorkspace / reportWorkspace / watchSelection
 * 与两个 CSS 变量的写入；theme-watcher 的条上按钮、`__dsh_ws__` console 通道与
 * 主进程 shell.openPath 消费点、smoke-workspace-probe 的两条变量断言；
 * dsh-shell-prefs 里注册到 conversation.session.header.utilities 的槽组件一并撤除。
 *
 * ## 通道（主进程 → 页面走 executeJavaScript 注入 {@link PAGE_JS}）
 *（无上行——原 `__dsh_wsprobe__:` console 上行已于 2026-10-08 拆除）。
 *
 * ## 退役记录（2026-10-05）
 *
 * 本文件原有三件事；第 3 件的一半（edit 的 +n/−n 统计徽章）与第 2 件
 * （fetch /api/session/page 拦截 → 上报 sessionId 触发历史补拉）已随该徽章
 * 一并退役：
 *
 * - **为什么退役**：那枚统计徽章与上游 `client-ui-tool` 的 `ToolRow` 自带的
 *   同一行 diff 统计重复（`diffTotals(diff.card.diffs)` → `+added -removed`，
 *   见 `ui-tool/src/client/tool/components/ToolRow.tsx:248-250`）——同一行出现
 *   两枚 +n/−n，用户判定冲突并要求退役（保留上游那份，本产品不再插一份）。
 * - **随之删除**：`window.__dshFileStat` 通道、`statCache`/`applyStat`、
 *   fetch 拦截、以及主进程侧整条只服务于它的数据链（session/page 历史补拉、
 *   /api/changes.summary numstat、turn-end 微型探针、按工作区分桶的活动表）。
 * - **不在此列**：类型徽章（TS/JS/MD…）与链接配色**保留**，它们与上游无重复。
 *
 * ## 退役记录（2026-10-08）
 *
 * workspace-base 工作区基准与 `__dsh_wsprobe__:` console 上行整链拆除：
 * 它的唯一读者是自建「技能」设置分区（skills-catalog 的工作区项目技能
 * 探位），而技能设置面已整体归 dsh-skills-bundle 1.1.0 的原生设置页
 * （settings.section 插槽 + 插件自有 fenced API），KCoder 的注入器
 * （skills-settings.ts / skills-catalog.ts / workspace-base.ts）随之退役，
 * 不允许两条技能开关/目录来源并存。探针只剩标题栏变量与类型徽章两个职责。
 *
 * @module desktop/main/workspace-probe
 */

import type { BrowserWindow } from 'electron'

/**
 * 页面注入脚本（上游 shell 页面上下文；纯 JS：模板串内禁 TS 注解）。
 * 工作区探针 + 正文文件徽章（无状态栏按钮——面板已删；无 console 上行——
 * workspace 基准链已随技能分区退役）。
 */
const PAGE_JS = `(() => {
  if (window.__dshWsProbeWired) return
  window.__dshWsProbeWired = true

  /* ---- 正文文件类型徽章 ----
   * 目标：工具卡片文件路径按钮（scoped 类名含 _fileLink 子串，文本即
   * 路径）与正文文件 mention（_fileMention）——两个类名全仓唯一，
   * 按「_+类名」子串匹配对 hash 位置无感（dsh 即时编译产物 hash 在前
   * （_96PAOq_fileLink），vite build 产物 hash 在后，均能命中）。
   * React 只管理首文本节点（单字符串 children 走 nodeValue 更新），
   * 前置徽章 span 与 dataset 属性不受意；行重挂会重建按钮，
   * MutationObserver 重扫补回。
   *
   * 2026-10-05：本段只留**类型徽章 + 链接配色**。原先附在文件路径后的
   * edit +n/−n 统计已退役（上游 ui-tool 的 ToolRow 自带同一行的 diff
   * 统计，同一行出现两枚 → 用户判定冲突），连带 window.__dshFileStat
   * 通道与主进程数据链一并删除；理由与清单见本文件头与 workspace-base.ts。
   * ⚠ 本段在模板串内：注释里禁写裸反引号（会提前截断模板串，TS1005）。 */
  const fbStyle = document.createElement('style')
  fbStyle.id = '__dsh_desktop_filebadge_style'
  fbStyle.textContent = [
    '[class*="_fileLink"], [class*="_fileMention"] { color: #2F6FED !important; font-weight: 500; }',
    'body[data-ds-dark-theme] [class*="_fileLink"], body[data-ds-dark-theme] [class*="_fileMention"] { color: #7C9BFF !important; }',
    '.__dsh-fb { display: inline-block; margin-right: 5px; padding: 1px 4px; border-radius: 4px; font: 600 9px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .3px; background: rgba(47,111,237,.12); color: #2F6FED; vertical-align: .5px; }',
    'body[data-ds-dark-theme] .__dsh-fb { background: rgba(124,155,255,.16); color: #7C9BFF; }',
  ].join('')
  document.head.append(fbStyle)

  const FB_EXTS = {
    ts: 'TS', tsx: 'TSX', mts: 'TS', cts: 'TS',
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS',
    json: 'JSON', css: 'CSS', scss: 'SCSS', less: 'LESS',
    html: 'HTML', xml: 'XML', svg: 'SVG', md: 'MD',
    py: 'PY', rb: 'RB', go: 'GO', rs: 'RS', java: 'JAVA',
    c: 'C', h: 'H', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#',
    swift: 'SWIFT', kt: 'KT', sh: 'SH', zsh: 'SH',
    yml: 'YAML', yaml: 'YAML', toml: 'TOML', sql: 'SQL', lua: 'LUA', php: 'PHP',
  }
  const extOf = (text) => { const m = /\\.([A-Za-z0-9]{1,5})\\s*$/.exec(text); return m !== null ? m[1].toLowerCase() : null }
  const fbScan = () => {
    const targets = document.querySelectorAll('[class*="_fileLink"], [class*="_fileMention"]')
    for (const btn of targets) {
      const text = (btn.textContent || '').trim()
      if (btn.dataset.dshfb !== '1') {
        const ext = extOf(text)
        if (ext !== null && FB_EXTS[ext] !== undefined) {
          const b = document.createElement('span')
          b.className = '__dsh-fb'
          b.textContent = FB_EXTS[ext]
          btn.insertBefore(b, btn.firstChild)
        }
        btn.dataset.dshfb = '1'
      }
    }
  }
  let fbDebounce = 0
  const fbObserve = () => {
    new MutationObserver(() => {
      clearTimeout(fbDebounce)
      fbDebounce = setTimeout(fbScan, 300)
    }).observe(document.body, { childList: true, subtree: true })
    fbScan()
  }
  if (document.body) fbObserve()
  else document.addEventListener('DOMContentLoaded', () => fbObserve(), { once: true })
})()`

/**
 * 把探针挂到 shell 窗口：did-finish-load 注入 {@link PAGE_JS}
 * （工作区探针 + 正文文件类型徽章；无 console 上行——workspace 基准链
 * 已于 2026-10-08 随技能分区退役，见文件头）。
 */
export function attachWorkspaceProbe(win: BrowserWindow): void {
  // 先捕获：closed 时窗口已销毁，再访问 win.webContents getter 会抛
  //（theme-watcher/workspace-header 同款防御）
  const { webContents } = win
  const onDidLoad = (): void => {
    if (win.isDestroyed()) return
    webContents.executeJavaScript(PAGE_JS, true).catch(() => {
      // 页面跳转间隙执行失败属正常，下次加载会重试
    })
  }
  webContents.on('did-finish-load', onDidLoad)
  win.once('closed', () => {
    webContents.removeListener('did-finish-load', onDidLoad)
  })
}
