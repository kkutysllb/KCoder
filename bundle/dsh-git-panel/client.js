/**
 * @kkutysllb/dsh-git-panel — client 半（shell 页面内独立浮动面板）。
 *
 * 交付形态：dsh client-modules 按 package.json 的 dsh.client 声明把本
 * 文件作为 `exports["./client"]` bundle 读入，经 /plugins combo 路由以
 * 普通 script 拼接执行——因此这里没有 import/export，走
 * window.__ModuleLoader__.load({id, factory}) 注册协议（inject: []，
 * 立即 apply；betterSidebar/sessions 等全部 ctx.get 软探测）。
 *
 * 结构平移自退役宿主（desktop/main/git-panel.ts 的 PAGE_JS +
 * desktop/renderer/src/views/git.ts），差异：
 * - 面板从 WebContentsView 换成页面内 fixed DOM（z-index 顶格，与
 *   titlebar/panel-menu 同约定；无需 view 时代的菜单让位协议）；
 * - 数据从 IPC 推送换成轮询 RPC（开 15s / 收 60s，开合与刷新立即拉）；
 * - cwd 由 client 按当前会话现场读取（sessions 快照），随会话切换跟随；
 * - 计划点击预览三层软依赖：betterSidebar editor tab →（缺席）
 *   server open-plan 系统默认应用；
 * - 互斥让位双向（旧宿主 sidebar-cluster 协议平移，页面内直连）：
 *   反向：better-sidebar 面板展开沿自动收起 git 卡片（点计划预览时
 *   主动让位兼容“面板已展开无沿”路径），侧边栏收起沿履约恢复；仅
 *   让位收起才自动恢复，用户手动开关不参与义务。正向：git 卡片开启
 *   时侧边栏开着则收起避让（点簇末枚开关按钮，display:none 不影响
 *   click 派发，React 合成事件照常），git 手动关闭时履约开回；反向
 *   让位收起即解除正向义务，防交叉残留。
 * - 开关按钮 id __dsh_kc_git_btn / 位置 right:108px（旧宿主按钮
 *   __dsh_desktop_git_btn 已随宿主退役同步摘除，本按钮接替原位）。
 *
 * @module @kkutysllb/dsh-git-panel/client
 */

window.__ModuleLoader__.load({
  id: '@kkutysllb/dsh-git-panel',
  factory: () => {
    const exports = {}

    exports.inject = []

    exports.apply = function apply(ctx) {
      if (window.__dshKcGitWired) return
      window.__dshKcGitWired = true

      const BTN_ID = '__dsh_kc_git_btn'
      const PANEL_ID = '__dsh_kc_git_panel'
      const STYLE_ID = '__dsh_kc_git_style'
      const FLY_ID = '__dsh_kc_git_fly'
      const API = '/dsh-git-panel/api'
      /** 开面板轮询（旧宿主 POLL_MS 同款）。 */
      const POLL_OPEN_MS = 15000
      /** 收起态降频轮询（徽章保活即可）。 */
      const POLL_CLOSED_MS = 60000
      /** 面板几何（旧宿主 PANEL_W/TOP/MARGIN/MAX_H 同款）。 */
      const PANEL_W = 360
      const PANEL_TOP = 60
      const PANEL_MARGIN = 12
      const PANEL_MAX_H = 620
      const PANEL_MIN_H = 200
      /** 内容区让位宽度（面板宽 + 双倍 margin）。 */
      const PAD_W = 384
      /** 标题栏按钮宿主（theme-watcher 注入）。 */
      const TITLEBAR_ID = '__dsh_desktop_titlebar'

      // 空快照（挂载后第一次拉取前）
      const EMPTY = {
        workspace: null, isRepo: false,
        staged: 0, changed: 0, untracked: 0, added: 0, removed: 0, plans: [],
        error: null,
      }

      let snapshot = EMPTY
      let open = false
      let timer = null
      /** 工作位置切换（worktree 路径覆盖；null = 跟随会话 cwd）。 */
      let cwdOverride = null
      let changesOpen = false
      let commitOpen = false
      /** flyout 模式：null | 'location' | 'branch' | 'create'。 */
      let flyMode = null
      let branchCache = null
      let busyAction = false
      let hintMsg = ''

      const SVG = {
        branch: '<svg viewBox="0 0 16 16" fill="none"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" fill="currentColor"/></svg>',
        folder: '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 3.5c0-.6.4-1 1-1h3l1.4 1.6h6c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1v-8.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        x: '<svg viewBox="0 0 16 16" fill="none"><path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        refresh: '<svg viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        close: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        plan: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2.2h10c.6 0 1 .4 1 1v9.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        chevron: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        check: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.5 3.5L13 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        plus: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        laptop: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 3.8h10v6.4H3z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.8 12.5h12.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        commit: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 8h4.3M10.2 8h4.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        github: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 0 0-2.06 12.67c.33.06.45-.14.45-.32v-1.13c-1.8.39-2.19-.87-2.19-.87-.3-.76-.72-.96-.72-.96-.6-.4.04-.4.04-.4.66.05 1.01.68 1.01.68.59 1 1.55.72 1.93.55.06-.43.23-.72.42-.89-1.44-.16-2.96-.72-2.96-3.2 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.72 0 0 .55-.17 1.8.66a6.2 6.2 0 0 1 3.28 0c1.24-.83 1.79-.66 1.79-.66.36.89.13 1.55.07 1.72.42.45.66 1.03.66 1.74 0 2.49-1.52 3.04-2.97 3.2.24.2.44.6.44 1.22v1.8c0 .18.12.39.46.32A6.5 6.5 0 0 0 8 1.5Z"/></svg>',
        external: '<svg viewBox="0 0 16 16" fill="none"><path d="M6.5 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9.5M9 3h4v4M13 3L7.5 8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        changes: '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M8 5.5v5M5.5 8h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      }

      /* ---- 样式：面板（git.ts PAGE_CSS 平移 + fixed 外壳）+ 标题栏按钮/徽章 ---- */
      const CSS = [
        '#' + PANEL_ID + '{position:fixed;right:' + PANEL_MARGIN + 'px;top:' + PANEL_TOP + 'px;width:min(' + PANEL_W + 'px,calc(100vw - 24px));height:clamp(' + PANEL_MIN_H + 'px,calc(100vh - ' + (PANEL_TOP + PANEL_MARGIN) + 'px),' + PANEL_MAX_H + 'px);z-index:2147483647;display:flex;flex-direction:column;font:400 12px/1.55 -apple-system,"PingFang SC","Segoe UI",sans-serif}',
        '#' + PANEL_ID + ' .gt-card{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--gt-border);background:var(--gt-bg);box-shadow:0 14px 44px rgba(9,16,29,.22),0 2px 8px rgba(9,16,29,.10);overflow:hidden;color:var(--gt-fg);--gt-bg:#FFFFFF;--gt-header:#F9FAFB;--gt-fg:#1A1D21;--gt-border:rgba(0,0,0,.10);--gt-muted:rgba(26,29,33,.55);--gt-chip:rgba(128,128,128,.14);--gt-hover:rgba(128,128,128,.12);--gt-accent:#2F6FED;--gt-add:#1A7F37;--gt-del:#CF222E;--gt-mono:ui-monospace,Menlo,Monaco,monospace}',
        // 应用内主题轨道（唯一轨道；上游契约：以 body[data-ds-dark-theme]
        // 为准——不用 prefers-color-scheme，避免「应用内浅色+系统深色」
        // 三态组合下面板与应用壳不一致）
        'body[data-ds-dark-theme] #' + PANEL_ID + ' .gt-card{--gt-bg:#1B1B1C;--gt-header:#222325;--gt-fg:#E8EAED;--gt-border:#2C2C2E;--gt-muted:rgba(232,234,237,.55);--gt-chip:rgba(128,128,128,.18);--gt-hover:rgba(128,128,128,.16);--gt-accent:#7C9BFF;--gt-add:#3FB950;--gt-del:#F85149;box-shadow:0 14px 44px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}',
        '#' + PANEL_ID + ' .gt-header{flex:none;height:34px;display:flex;align-items:center;gap:6px;padding:0 8px 0 12px;background:var(--gt-header);border-bottom:1px solid var(--gt-border);user-select:none}',
        '#' + PANEL_ID + ' .gt-ws{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1;font:600 12px/1 var(--gt-mono)}',
        '#' + PANEL_ID + ' .gt-wname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#' + PANEL_ID + ' .gt-ws svg{width:13px;height:13px;flex:none;color:var(--gt-accent)}',
        '#' + PANEL_ID + ' .gt-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;cursor:pointer;color:var(--gt-muted);flex:none}',
        '#' + PANEL_ID + ' .gt-btn:hover{background:var(--gt-hover);color:var(--gt-fg)}',
        '#' + PANEL_ID + ' .gt-btn svg{width:14px;height:14px}',
        '#' + PANEL_ID + ' .gt-status{flex:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:8px 12px;border-bottom:1px solid var(--gt-border)}',
        '#' + PANEL_ID + ' .gt-lines{font:650 12px/1.2 var(--gt-mono);font-variant-numeric:tabular-nums;margin-right:2px}',
        '#' + PANEL_ID + ' .gt-lines .a{color:var(--gt-add)}',
        '#' + PANEL_ID + ' .gt-lines .d{color:var(--gt-del);margin-left:4px}',
        '#' + PANEL_ID + ' .gt-pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:6px;background:var(--gt-chip)}',
        '#' + PANEL_ID + ' .gt-pill b{font:650 11px/1.2 var(--gt-mono);font-variant-numeric:tabular-nums}',
        '#' + PANEL_ID + ' .gt-pill span{font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-body{flex:1;min-height:0;overflow-y:auto;padding:10px 12px 16px}',
        '#' + PANEL_ID + ' .gt-caps{margin:4px 0 6px;font-size:10px;color:var(--gt-muted);letter-spacing:.5px;user-select:none}',
        '#' + PANEL_ID + ' .gt-caps::after{content:\'\';display:inline-block;width:60px;height:1px;background:linear-gradient(to right,var(--gt-border),transparent);vertical-align:middle;margin-left:6px}',
        '#' + PANEL_ID + ' .gt-plan{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:7px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-plan:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-plan svg{width:13px;height:13px;flex:none;color:var(--gt-accent);display:block}',
        '#' + PANEL_ID + ' .gt-plan .t{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-plan .w{flex:none;font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-hint{margin-top:8px;font-size:10px;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;color:var(--gt-muted);font-size:12px;text-align:center;padding:0 20px}',
        // 标题栏按钮（旧宿主同款视觉与位置；旧按钮已随宿主退役接替原位）。
        // 关键：bar 是 -webkit-app-region:drag 拖拽区（theme-watcher），
        // 按钮必须显式 no-drag，否则点击被窗口拖拽吞掉（DOM 无 click）。
        '#' + BTN_ID + '{all:unset;box-sizing:border-box;position:absolute;right:108px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}',
        '#' + BTN_ID + ':hover{background:rgba(128,128,128,.16);color:rgba(26,29,33,.9)}',
        '#' + BTN_ID + '[data-on="1"]{background:rgba(47,111,237,.14);color:#2F6FED}',
        'body[data-ds-dark-theme] #' + BTN_ID + '{color:rgba(232,234,237,.6)}',
        'body[data-ds-dark-theme] #' + BTN_ID + ':hover{background:rgba(128,128,128,.22);color:rgba(232,234,237,.9)}',
        'body[data-ds-dark-theme] #' + BTN_ID + '[data-on="1"]{background:rgba(124,155,255,.18);color:#7C9BFF}',
        '#' + BTN_ID + ' svg{width:15px;height:15px;flex:none}',
        // 非 git 仓库置灰（旧宿主 .dim 同款；panel-menu 菜单项禁用态同源）
        '#' + BTN_ID + '.dim{opacity:.4;cursor:default}',
        '#' + BTN_ID + '.dim:hover{background:transparent;color:rgba(26,29,33,.65)}',
        // 双色胶囊与代码 diff 约定一致：+N 绿底、−N 红底（面板 gt-lines 同款色族）
        '#' + BTN_ID + ' .bdg{position:absolute;top:-3px;right:-10px;display:inline-flex;height:14px;border-radius:7px;overflow:hidden;white-space:nowrap;color:#FFF;font:600 9px/14px -apple-system,"PingFang SC",sans-serif;text-align:center}',
        '#' + BTN_ID + ' .bdg .a{padding:0 4px;background:#1A7F37}',
        '#' + BTN_ID + ' .bdg .d{padding:0 4px;background:#CF222E}',
        'body[data-ds-dark-theme] #' + BTN_ID + ' .bdg .a{background:#238636}',
        'body[data-ds-dark-theme] #' + BTN_ID + ' .bdg .d{background:#DA3633}',
        // ---- 环境信息行（Codex 风格行布局） ----
        '#' + PANEL_ID + ' .gt-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-row:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-row .ic{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-row .ic svg{width:14px;height:14px;display:block}',
        '#' + PANEL_ID + ' .gt-row .lb{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-row .chev{display:inline-flex;width:12px;height:12px;flex:none;color:var(--gt-muted);transition:transform .15s ease}',
        '#' + PANEL_ID + ' .gt-row .chev svg{width:12px;height:12px;display:block}',
        '#' + PANEL_ID + ' .gt-row[data-open="1"] .chev{transform:rotate(180deg)}',
        '#' + PANEL_ID + ' .gt-row .cnt{flex:none;font:650 10px/1.4 var(--gt-mono);color:var(--gt-muted)}',
        '#' + PANEL_ID + ' .gt-row.dim{opacity:.45;cursor:default}',
        '#' + PANEL_ID + ' .gt-row.dim:hover{background:transparent}',
        // 变更文件列表
        '#' + PANEL_ID + ' .gt-files{margin:0 0 6px 15px;border-left:1px solid var(--gt-border);padding:2px 0 2px 6px}',
        '#' + PANEL_ID + ' .gt-file{all:unset;box-sizing:border-box;display:flex;gap:6px;align-items:center;width:100%;padding:3px 6px;border-radius:6px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-file:hover{background:var(--gt-hover)}',
        '#' + PANEL_ID + ' .gt-file .st{flex:none;width:14px;text-align:center;font:650 10px/1.6 var(--gt-mono)}',
        '#' + PANEL_ID + ' .gt-file .st.a,#' + PANEL_ID + ' .gt-file .st.u{color:var(--gt-add)}',
        '#' + PANEL_ID + ' .gt-file .st.d{color:var(--gt-del)}',
        '#' + PANEL_ID + ' .gt-file .st.m{color:#BF8700}',
        'body[data-ds-dark-theme] #' + PANEL_ID + ' .gt-file .st.m{color:#D29922}',
        '#' + PANEL_ID + ' .gt-file .fp{flex:1;min-width:0;font:400 11px/1.6 var(--gt-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + PANEL_ID + ' .gt-file .ln{flex:none;font:600 10px/1.6 var(--gt-mono);color:var(--gt-muted)}',
        // 提交盒
        '#' + PANEL_ID + ' .gt-cbox{margin:2px 8px 8px 23px;display:flex;flex-direction:column;gap:6px}',
        '#' + PANEL_ID + ' .gt-msg{resize:vertical;min-height:44px;max-height:120px;border-radius:8px;border:1px solid var(--gt-border);background:transparent;color:var(--gt-fg);font:400 12px/1.5 -apple-system,"PingFang SC","Segoe UI",sans-serif;padding:6px 8px;outline:none}',
        '#' + PANEL_ID + ' .gt-cbtns{display:flex;gap:6px;align-items:center}',
        '#' + PANEL_ID + ' .gt-abtn{all:unset;box-sizing:border-box;height:24px;padding:0 10px;border-radius:6px;background:var(--gt-accent);color:#FFF;font-size:11px;cursor:pointer}',
        '#' + PANEL_ID + ' .gt-abtn:disabled{opacity:.4;cursor:default}',
        '#' + PANEL_ID + ' .gt-abtn.sec{background:var(--gt-chip);color:var(--gt-fg)}',
        '#' + PANEL_ID + ' .gt-hintline{font-size:10px;color:var(--gt-muted);min-height:12px}',
        // ---- flyout（工作位置 / 分支选择器） ----
        '#' + FLY_ID + '{position:fixed;z-index:2147483647;width:264px;max-height:420px;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--gt-border);background:var(--gt-bg);color:var(--gt-fg);box-shadow:0 14px 44px rgba(9,16,29,.22),0 2px 8px rgba(9,16,29,.10);overflow:hidden;--gt-bg:#FFFFFF;--gt-fg:#1A1D21;--gt-border:rgba(0,0,0,.10);--gt-muted:rgba(26,29,33,.55);--gt-chip:rgba(128,128,128,.14);--gt-hover:rgba(128,128,128,.12);--gt-accent:#2F6FED;--gt-mono:ui-monospace,Menlo,Monaco,monospace}',
        'body[data-ds-dark-theme] #' + FLY_ID + '{--gt-bg:#1B1B1C;--gt-fg:#E8EAED;--gt-border:#2C2C2E;--gt-muted:rgba(232,234,237,.55);--gt-chip:rgba(128,128,128,.18);--gt-hover:rgba(128,128,128,.16);--gt-accent:#7C9BFF;box-shadow:0 14px 44px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}',
        '#' + FLY_ID + ' .fly-cap{padding:10px 12px 4px;font-size:10px;color:var(--gt-muted);letter-spacing:.5px;user-select:none}',
        '#' + FLY_ID + ' .fly-search{all:unset;box-sizing:border-box;margin:6px 10px;display:flex;height:28px;padding:0 8px;border-radius:7px;border:1px solid var(--gt-border);color:var(--gt-fg);font-size:12px}',
        '#' + FLY_ID + ' .fly-list{flex:1;min-height:0;overflow-y:auto;padding:2px 6px 6px}',
        '#' + FLY_ID + ' .fly-row{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:12px}',
        '#' + FLY_ID + ' .fly-row:hover{background:var(--gt-hover)}',
        '#' + FLY_ID + ' .fly-row span:first-child{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-muted)}',
        '#' + FLY_ID + ' .fly-row span:first-child svg{width:14px;height:14px;display:block}',
        '#' + FLY_ID + ' .fly-row .lb{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '#' + FLY_ID + ' .fly-row .ck{display:inline-flex;width:14px;height:14px;flex:none;color:var(--gt-fg)}',
        '#' + FLY_ID + ' .fly-row .ck svg{width:14px;height:14px;display:block}',
        '#' + FLY_ID + ' .fly-div{height:1px;background:var(--gt-border);margin:6px 10px}',
        '#' + FLY_ID + ' .fly-none{padding:8px 12px;font-size:11px;color:var(--gt-muted)}',
        '#' + FLY_ID + ' .fly-zone{display:inline-flex;align-items:center;gap:4px;flex:none}',
        '#' + FLY_ID + ' .fly-del{cursor:pointer;user-select:none;font-size:11px;line-height:1;color:var(--gt-muted);padding:3px 5px;border-radius:5px;opacity:0;transition:opacity .12s}',
        '#' + FLY_ID + ' .fly-del svg{width:12px;height:12px;display:block}',
        '#' + FLY_ID + ' .fly-del:hover{color:var(--gt-fg);background:var(--gt-hover)}',
        '#' + FLY_ID + ' .fly-row:hover .fly-del{opacity:1}',
        '#' + FLY_ID + ' .fly-zone.confirm .fly-del{opacity:1}',
        '#' + FLY_ID + ' .fly-del.danger{color:#e5534b}',
        '#' + FLY_ID + ' .fly-ctag{font-size:11px;color:var(--gt-muted);white-space:nowrap}',
        '#' + FLY_ID + ' .fly-foot{display:flex;justify-content:flex-end;padding:0 10px 10px}',
      ].join('')

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.append(style)

      /* ---- 面板骨架（挂 body 子树：body[data-ds-dark-theme] 主题轨道是
       * 后代选择器，面板必须是其后代才会跟随应用内主题切换；SPA 重渲染
       * 只动 root 容器内部，body 直挂节点不受影响） ---- */
      const el = (tag, cls, text) => {
        const n = document.createElement(tag)
        if (cls) n.className = cls
        if (text) n.textContent = text
        return n
      }

      const panel = el('div')
      panel.id = PANEL_ID
      panel.style.display = 'none'

      const card = el('div', 'gt-card')
      const header = el('div', 'gt-header')
      const wIcon = el('span')
      wIcon.innerHTML = SVG.folder
      const wName = el('span', 'gt-wname')
      const refreshBtn = el('button', 'gt-btn')
      refreshBtn.innerHTML = SVG.refresh
      refreshBtn.title = '重新探测'
      const closeBtn = el('button', 'gt-btn')
      closeBtn.innerHTML = SVG.close
      closeBtn.title = '关闭面板'
      const ws = el('div', 'gt-ws')
      ws.append(wIcon, wName)
      header.append(ws, refreshBtn, closeBtn)

      const status = el('div', 'gt-status')
      const lines = el('span', 'gt-lines')
      const la = el('b', 'a', '+0')
      const ld = el('b', 'd', '\u22120')
      lines.append(la, ld)
      const pill = (label) => {
        const p = el('span', 'gt-pill')
        p.append(el('b', '', '0'), el('span', '', label))
        return p
      }
      const pStaged = pill('已暂存')
      const pChanged = pill('已修改')
      const pUntracked = pill('未跟踪')
      status.append(lines, pStaged, pChanged, pUntracked)

      const body = el('div', 'gt-body')
      // 环境信息区（Codex 风格行布局：变更/工作位置/分支/提交或推送/比较分支）
      const envCaps = el('div', 'gt-caps', '环境信息')
      const mkRow = (icon, label) => {
        const r = el('button', 'gt-row')
        const ic = el('span', 'ic')
        ic.innerHTML = icon
        const lb = el('span', 'lb', label)
        r.append(ic, lb)
        return { r, lb }
      }
      const mkChev = () => { const c = el('span', 'chev'); c.innerHTML = SVG.chevron; return c }
      const chRow = mkRow(SVG.changes, '变更')
      const chCnt = el('span', 'cnt', '0')
      const chChev = mkChev()
      chRow.r.append(chCnt, chChev)
      const filesBox = el('div', 'gt-files')
      filesBox.style.display = 'none'
      const locRow = mkRow(SVG.laptop, '本地')
      locRow.r.append(mkChev())
      const brRow = mkRow(SVG.branch, '—')
      brRow.r.append(mkChev())
      const cpRow = mkRow(SVG.commit, '提交或推送')
      const commitBox = el('div', 'gt-cbox')
      const msgInput = document.createElement('textarea')
      msgInput.className = 'gt-msg'
      msgInput.placeholder = '提交信息'
      const cbtns = el('div', 'gt-cbtns')
      const doCommitBtn = el('button', 'gt-abtn', '提交')
      const doPushBtn = el('button', 'gt-abtn sec', '推送')
      cbtns.append(doCommitBtn, doPushBtn)
      const hintLine = el('div', 'gt-hintline')
      commitBox.append(msgInput, cbtns, hintLine)
      commitBox.style.display = 'none'
      const cmpRow = mkRow(SVG.github, '比较分支')
      const cmpExt = el('span', 'chev')
      cmpExt.innerHTML = SVG.external
      cmpRow.r.append(cmpExt)
      // 任务计划（约定位置扫到的 agent 计划文档；点击走软依赖预览链）
      const planCaps = el('div', 'gt-caps', '任务计划')
      const planList = el('div')
      const empty = el('div', 'gt-empty')
      body.append(envCaps, chRow.r, filesBox, locRow.r, brRow.r, cpRow.r, commitBox, cmpRow.r, planCaps, planList, empty)

      card.append(header, status, body)
      panel.append(card)
      document.body.append(panel)

      // flyout 容器（工作位置/分支选择器；面板左侧弹出；同面板挂 body 子树）
      const fly = el('div')
      fly.id = FLY_ID
      fly.style.display = 'none'
      document.body.append(fly)

      /* ---- 数据与行为 ---- */
      const api = (method, payload) => fetch(API + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      }).then(r => r.text()).then(t => JSON.parse(t))

      // cwd 按当前会话现场读取（多窗口各跟随各的工作区；切会话随轮询生效）
      const currentCwd = () => {
        try {
          const snap = ctx.get('sessions')?.list?.getSnapshot?.()
          const cur = snap?.current
          if (cur === undefined || cur === null) return null
          return snap?.byId?.[cur]?.cwd ?? null
        } catch { return null }
      }

      const refresh = async () => {
        const cwd = effectiveCwd()
        if (cwd === null || cwd === '') {
          snapshot = EMPTY
        } else {
          try {
            snapshot = await api('snapshot', { cwd })
          } catch { return /* 网络/重启间隙：保旧快照 */ }
        }
        render(snapshot)
        renderBadge()
      }

      const schedule = () => {
        if (timer !== null) clearInterval(timer)
        timer = setInterval(() => { void refresh() }, open ? POLL_OPEN_MS : POLL_CLOSED_MS)
      }

      // 内容区右侧让位（面板开时给正文让出 PAD_W；W=0 清除）
      const setPad = (w) => {
        document.documentElement.style.setProperty('--dsh-git-inset', w > 0 ? w + 'px' : '0px')
        const cols = document.querySelectorAll('[class*="centerCol"], [class*="detailsCol"]')
        for (const c of cols) {
          if (w > 0) c.style.paddingRight = w + 'px'
          else c.style.removeProperty('padding-right')
        }
      }

      const setOpen = (next) => {
        open = next
        panel.style.display = open ? '' : 'none'
        if (!open) {
          closeFly()
          commitOpen = false
          commitBox.style.display = 'none'
        }
        renderBadge()
        setPad(open ? PAD_W : 0)
        schedule()
        if (open) {
          // 正向让位：侧边栏开着则收起避让（收起沿会触发 observer，
          // 反向义务 yielded=false 无动作，无环）
          if (!sideYielded && betterSidebarOpen()) {
            sideYielded = true
            setSidebarPanel(false)
          }
          void refresh()
        } else if (sideYielded) {
          // 履约：手动关闭时把当初让位收起的侧边栏开回（反向让位收起
          // 路径在 observer 里已先清 sideYielded，不会误履约）
          sideYielded = false
          setSidebarPanel(true)
        }
      }

      /* ---- 互斥让位（旧宿主 sidebar-cluster 协议平移）：
         better-sidebar 面板展开 → git 卡片收起（预览落地见缝）；侧边栏
         收起 → 履约恢复。沿判定（翻转才动作）天然去重；host 缺席 =
         插件未装视为关。仅让位收起带恢复义务，手动开关不被抢。 ---- */
      let yielded = false // 反向义务：git 因侧边栏让位而收起（收起沿恢复）
      let sideYielded = false // 正向义务：git 开启时收了侧边栏（手动关时开回）
      const betterSidebarOpen = () => {
        const host = document.querySelector('[data-dsh-better-sidebar]')
        if (host === null) return false
        return host.querySelector('[class*="panelHidden"]') === null
      }
      // 侧边栏开关（簇末枚恒为右侧面板，语义同 sidebar-cluster panelSrc；
      // 簇本体被代理按钮收纳 display:none，click 派发照常）
      const setSidebarPanel = (open) => {
        const cluster = document.querySelector('[data-dsh-panel-host] [class*="toggleCluster"]')
        const btns = cluster !== null
          ? Array.from(cluster.querySelectorAll('button[class*="toggleButton"]'))
          : []
        const btn = btns.length > 0 ? btns[btns.length - 1] : null
        if (btn !== null) btn.click()
        return btn !== null
      }
      let lastSidebarOpen = null // null = 初始态，不当沿
      const applySidebarMutual = () => {
        const sbOpen = betterSidebarOpen()
        if (lastSidebarOpen === null) { lastSidebarOpen = sbOpen; return }
        if (sbOpen === lastSidebarOpen) return
        lastSidebarOpen = sbOpen
        if (sbOpen) {
          if (open) {
            sideYielded = false // 正向义务随反向让位解除，防交叉残留
            yielded = true
            setOpen(false)
          }
        } else if (yielded) {
          yielded = false
          setOpen(true)
        }
      }

      /* ---- 设置页联动：进设置页自动收起（仅自动收起带恢复义务），
         返回工作区履约展开。检测锚与 settings-page.ts 同源：
         [class*="_overlay"] > [class*="_panel"][role="dialog"] 是
         SettingsRoot 专属组合（ui-primitives Modal 结构不同不误伤）。
         手动开关不参与义务；关闭路径（Escape/close/返回按钮）都是
         dialog 卸载，同一条沿覆盖。 ---- */
      let settingsYielded = false // 设置页义务：因进设置而收起（退出沿恢复）
      let lastSettingsOpen = null // null = 初始态，不当沿
      const settingsOpen = () =>
        document.querySelector('[class*="_overlay"] > [class*="_panel"][role="dialog"]') !== null
      const applySettingsYield = () => {
        const so = settingsOpen()
        if (lastSettingsOpen === so) return
        lastSettingsOpen = so
        if (so) {
          if (open) { settingsYielded = true; setOpen(false) }
        } else if (settingsYielded) {
          settingsYielded = false
          setOpen(true)
        }
      }
      const applyBodyMutations = () => { applySidebarMutual(); applySettingsYield() }
      new MutationObserver(applyBodyMutations).observe(document.body, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
      })

      /* ---- 计划点击预览（软依赖三层）：
         betterSidebar editor tab → server open-plan 系统默认应用 ---- */
      const openPlan = (plan) => {
        let sidebar = null
        try { sidebar = ctx.get('betterSidebar') ?? null } catch { sidebar = null }
        if (sidebar !== null && typeof sidebar.openTab === 'function') {
          sidebar.openTab({ type: 'editor', title: plan.title, path: plan.path, id: 'editor:' + plan.path })
          // 预览落地面板区：主动让位（面板已展开时无展开沿，沿判定覆盖不到）
          if (betterSidebarOpen()) { yielded = true; setOpen(false) }
          return
        }
        void api('open-plan', { path: plan.path }).catch(() => { /* 回退链末端失败静默 */ })
      }

      /* ---- 环境信息行为（Codex 风格：worktree/分支/提交/推送/比较） ---- */
      const effectiveCwd = () => cwdOverride ?? currentCwd()
      /** 待提交变更总数（staged + changed + untracked）。 */
      const totalChanges = (s) => s.staged + s.changed + s.untracked
      const baseName = (p) => {
        const segs = String(p).split('/').filter(Boolean)
        return segs.length > 0 ? (segs[segs.length - 1] ?? p) : p
      }

      const closeFly = () => { flyMode = null; fly.style.display = 'none'; fly.replaceChildren() }
      const positionFly = (anchor) => {
        const pr = panel.getBoundingClientRect()
        const ar = anchor.getBoundingClientRect()
        fly.style.right = (window.innerWidth - pr.left + 8) + 'px'
        fly.style.top = Math.max(8, Math.min(ar.top - 8, window.innerHeight - 340)) + 'px'
        fly.style.display = 'flex'
      }
      const flyRow = (icon, label, onClick, checked) => {
        const r = el('button', 'fly-row')
        const ic = el('span')
        ic.innerHTML = icon
        const lb = el('span', 'lb', label)
        r.append(ic, lb)
        if (checked) {
          const ck = el('span', 'ck')
          ck.innerHTML = SVG.check
          r.append(ck)
        }
        r.onclick = (ev) => { ev.stopPropagation(); onClick() }
        return r
      }

      // 工作位置（worktree 清单；选中切换面板目标，只读视图切换）
      const openLocationFly = (anchor) => {
        flyMode = 'location'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '工作位置'))
        const list = el('div', 'fly-list')
        const wts = snapshot.worktrees ?? []
        const active = cwdOverride ?? snapshot.root
        if (wts.length === 0) {
          list.append(flyRow(SVG.laptop, '本地', () => { cwdOverride = null; closeFly(); void refresh() }, true))
        }
        for (const wt of wts) {
          const isMain = snapshot.root !== null && wt.path === snapshot.root
          const label = (isMain ? '本地 · ' : '') + (wt.branch ?? '(detached)') + ' · ' + baseName(wt.path)
          list.append(flyRow(SVG.laptop, label, () => {
            cwdOverride = isMain ? null : wt.path
            closeFly()
            void refresh()
          }, wt.path === active))
        }
        fly.append(list)
        positionFly(anchor)
      }

      // 分支选择器（搜索 + 列表✓ + 创建并检出新分支）
      const openCreateFly = (anchor) => {
        flyMode = 'create'
        fly.replaceChildren()
        fly.append(el('div', 'fly-cap', '创建并检出新分支'))
        const input = document.createElement('input')
        input.className = 'fly-search'
        input.placeholder = '分支名'
        const btn = el('button', 'gt-abtn', '创建并检出')
        const foot = el('div', 'fly-foot')
        foot.append(btn)
        fly.append(input, foot)
        btn.onclick = (ev) => { ev.stopPropagation(); void doCreateBranch(input.value) }
        input.onkeydown = (ev) => { if (ev.key === 'Enter') void doCreateBranch(input.value) }
        positionFly(anchor)
        input.focus()
      }
      const openBranchFly = (anchor) => {
        flyMode = 'branch'
        fly.replaceChildren()
        const search = document.createElement('input')
        search.className = 'fly-search'
        search.placeholder = '搜索 ' + (snapshot.workspace ?? '') + ' 分支'
        const cap = el('div', 'fly-cap', '分支')
        const list = el('div', 'fly-list')
        const div = el('div', 'fly-div')
        const createRow = flyRow(SVG.plus, '创建并检出新分支…', () => { openCreateFly(anchor) })
        fly.append(search, cap, list, div, createRow)
        /** 删除当前 flyout 行内局部状态：idle（×）→ confirm → force。 */
        const mkZone = (b, doDelete) => {
          const zone = el('span', 'fly-zone')
          const setConfirm = (force) => {
            zone.className = 'fly-zone confirm'
            zone.replaceChildren()
            const tag = el('span', 'fly-ctag', force ? '未合并，仍删除？' : '删除分支？')
            const yes = el('span', 'fly-del danger', force ? '强制删除' : '删除')
            yes.onclick = (ev) => { ev.stopPropagation(); void doDelete(b, force, () => setConfirm(true)) }
            const no = el('span', 'fly-del', '取消')
            no.onclick = (ev) => { ev.stopPropagation(); setIdle() }
            zone.append(tag, yes, no)
          }
          const setIdle = () => {
            zone.className = 'fly-zone'
            zone.replaceChildren()
            const del = el('span', 'fly-del')
            del.innerHTML = SVG.x
            del.title = '删除分支'
            del.onclick = (ev) => { ev.stopPropagation(); setConfirm(false) }
            zone.append(del)
          }
          setIdle()
          return zone
        }
        /** delete-branch：成功后刷新分支缓存并重填列表；
         *  未合并（merged 标记）时回调升级为强制确认。 */
        const doDelete = async (b, force, onMerged) => {
          if (busyAction) return
          busyAction = true
          let done = false
          try {
            const res = await api('delete-branch', { cwd: effectiveCwd(), name: b, force: force === true })
            if (res.ok) { done = true; actionHint('已删除 ' + b) }
            else if (res.merged === true && !force) { busyAction = false; onMerged(); return }
            else actionHint(res.error ?? '删除失败')
          } catch { actionHint('网络异常') }
          busyAction = false
          if (done) {
            const cwd = effectiveCwd()
            if (cwd !== null && cwd !== '') {
              try { branchCache = await api('branches', { cwd }) } catch { /* 保留旧缓存 */ }
            }
            if (flyMode === 'branch') fill(search.value.trim())
          }
          void refresh()
        }
        const fill = (filter) => {
          list.replaceChildren()
          const bs = (branchCache?.branches ?? []).filter(b => filter === '' || b.toLowerCase().includes(filter.toLowerCase()))
          if (bs.length === 0) list.append(el('div', 'fly-none', '无匹配分支'))
          for (const b of bs) {
            const isCur = b === branchCache?.current
            const row = flyRow(SVG.branch, b, () => { void doCheckout(b) }, isCur)
            if (!isCur) row.append(mkZone(b, doDelete)) // 当前分支不可删
            list.append(row)
          }
        }
        search.oninput = () => { fill(search.value.trim()) }
        positionFly(anchor)
        search.focus()
        void (async () => {
          const cwd = effectiveCwd()
          if (cwd === null || cwd === '') return
          try { branchCache = await api('branches', { cwd }) } catch { return }
          if (flyMode === 'branch') fill(search.value.trim())
        })()
      }

      const actionHint = (text) => { hintMsg = text; hintLine.textContent = text }
      const doCheckout = async (branch) => {
        if (busyAction) return
        busyAction = true
        try {
          const res = await api('checkout', { cwd: effectiveCwd(), branch })
          if (res.ok) { actionHint(''); closeFly() } else { actionHint(res.error ?? '检出失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCreateBranch = async (name) => {
        if (busyAction) return
        busyAction = true
        try {
          const res = await api('create-branch', { cwd: effectiveCwd(), name })
          if (res.ok) { actionHint(''); closeFly() } else { actionHint(res.error ?? '创建失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCommit = async () => {
        if (busyAction) return
        const message = msgInput.value.trim()
        if (message === '') { actionHint('请输入提交信息'); return }
        busyAction = true
        actionHint('提交中…')
        try {
          const res = await api('commit', { cwd: effectiveCwd(), message })
          if (res.ok) {
            msgInput.value = ''
            actionHint('已提交')
            commitOpen = false
            commitBox.style.display = 'none'
          } else { actionHint(res.error ?? '提交失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doPush = async () => {
        if (busyAction) return
        busyAction = true
        actionHint('推送中…')
        try {
          const res = await api('push', { cwd: effectiveCwd() })
          if (res.ok) {
            actionHint('已推送')
            commitOpen = false
            commitBox.style.display = 'none'
          } else { actionHint(res.error ?? '推送失败') }
        } catch { actionHint('网络异常') }
        busyAction = false
        void refresh()
      }
      const doCompare = async () => {
        if (busyAction) return
        busyAction = true
        try { await api('open-compare', { cwd: effectiveCwd() }) } catch { /* 静默 */ }
        busyAction = false
      }

      // 变更文件点击 → better-sidebar editor 预览（软依赖；缺席不动作）
      const openFile = (path) => {
        let sidebar = null
        try { sidebar = ctx.get('betterSidebar') ?? null } catch { sidebar = null }
        if (sidebar !== null && typeof sidebar.openTab === 'function') {
          sidebar.openTab({ type: 'editor', title: baseName(path), path, id: 'editor:' + path })
          if (betterSidebarOpen()) { yielded = true; setOpen(false) }
        }
      }

      // 行事件
      chRow.r.onclick = () => { changesOpen = !changesOpen; render(snapshot) }
      locRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'location') closeFly(); else openLocationFly(locRow.r)
      }
      brRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (flyMode === 'branch' || flyMode === 'create') closeFly(); else openBranchFly(brRow.r)
      }
      cpRow.r.onclick = () => {
        if (!snapshot.isRepo) return
        if (!(totalChanges(snapshot) > 0 || (snapshot.ahead > 0 && snapshot.hasUpstream))) return
        commitOpen = !commitOpen
        commitBox.style.display = commitOpen ? '' : 'none'
        actionHint('')
      }
      cmpRow.r.onclick = () => { if (!cmpRow.r.classList.contains('dim')) void doCompare() }
      doCommitBtn.onclick = () => { void doCommit() }
      doPushBtn.onclick = () => { void doPush() }

      // flyout 外点击关闭（行自身点击由 onclick 接管切换）
      document.addEventListener('mousedown', (ev) => {
        if (flyMode === null) return
        if (fly.contains(ev.target)) return
        if (ev.target instanceof Element && ev.target.closest('#' + PANEL_ID + ' .gt-row') !== null) return
        closeFly()
      })
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeFly() })

      /* ---- 渲染（git.ts render 平移） ---- */
      function render(s) {
        wName.textContent = s.workspace ?? '—'
        la.textContent = '+' + s.added
        ld.textContent = '\u2212' + s.removed
        const setPill = (p, v) => { p.querySelector('b').textContent = String(v) }
        setPill(pStaged, s.staged)
        setPill(pChanged, s.changed)
        setPill(pUntracked, s.untracked)
        // 环境信息行
        chCnt.textContent = String(s.staged + s.changed + s.untracked)
        chRow.r.classList.toggle('dim', !s.isRepo)
        chRow.r.dataset.open = changesOpen && s.isRepo ? '1' : '0'
        locRow.lb.textContent = cwdOverride !== null ? baseName(cwdOverride) : '本地'
        locRow.r.classList.toggle('dim', !s.isRepo)
        brRow.lb.textContent = s.branch ?? (s.isRepo ? '(detached)' : '—')
        brRow.r.classList.toggle('dim', !s.isRepo)
        cpRow.r.classList.toggle('dim', !(s.isRepo && (totalChanges(s) > 0 || (s.ahead > 0 && s.hasUpstream))))
        cpRow.lb.textContent = s.hasUpstream && s.ahead > 0
          ? '提交或推送（' + s.ahead + ' 待推送）'
          : '提交或推送'
        cmpRow.r.classList.toggle('dim', !(s.isRepo && s.remoteUrl !== null && s.defaultBranch !== null && s.branch !== null))
        doCommitBtn.disabled = !(totalChanges(s) > 0) || busyAction
        doPushBtn.disabled = !(s.hasUpstream && s.ahead > 0) || busyAction
        hintLine.textContent = hintMsg
        // 变更文件列表（展开态重建）
        filesBox.style.display = changesOpen && s.isRepo ? '' : 'none'
        if (changesOpen && s.isRepo) {
          filesBox.replaceChildren()
          if (s.files.length === 0) filesBox.append(el('div', 'fly-none', '无变更'))
          for (const f of s.files) {
            const fr = el('button', 'gt-file')
            fr.title = f.path
            const code = f.untracked ? 'U' : (f.x !== ' ' && f.x !== '?' ? f.x : (f.y !== ' ' ? f.y : 'M'))
            const cls = f.untracked ? 'u' : (code === 'A' ? 'a' : (code === 'D' ? 'd' : 'm'))
            fr.append(el('span', 'st ' + cls, code), el('span', 'fp', f.path))
            if (f.added !== null) fr.append(el('span', 'ln', '+' + f.added + ' \u2212' + f.removed))
            fr.onclick = () => { openFile(f.path) }
            filesBox.append(fr)
          }
          if (s.filesTruncated) filesBox.append(el('div', 'gt-hint', '变更过多，仅显示前 200 条'))
        }
        planList.replaceChildren()
        const hasPlans = s.plans.length > 0
        for (const p of s.plans) {
          const row = el('button', 'gt-plan')
          row.title = p.path
          const ico = el('span')
          ico.innerHTML = SVG.plan
          row.append(ico, el('span', 't', p.title), el('span', 'w', p.when))
          row.onclick = () => { openPlan(p) }
          planList.append(row)
        }
        empty.replaceChildren()
        if (s.error !== null) {
          empty.append(el('div', '', s.error))
        } else if (s.workspace === null) {
          empty.append(el('div', '', '等待工作区…'))
        } else if (!s.isRepo) {
          empty.append(el('div', '', '「' + s.workspace + '」不是 git 仓库'))
        } else if (!hasPlans) {
          empty.append(el('div', '', '暂无任务计划文档'))
          empty.append(el('div', 'gt-hint', '约定位置：plans/ · docs/plans/ · .plans/ · plan.md'))
        }
        const hasEmpty = empty.childNodes.length > 0
        empty.style.display = hasEmpty ? '' : 'none'
        planCaps.style.display = hasPlans ? '' : 'none'
        planList.style.display = hasPlans ? '' : 'none'
      }

      /* ---- 徽章/按钮态（PAGE_JS __dshGitBadge 平移，本插件自绘） ---- */
      function renderBadge() {
        const btn = document.getElementById(BTN_ID)
        if (btn === null) return
        const s = snapshot
        btn.classList.toggle('dim', s.isRepo !== true)
        btn.dataset.on = open ? '1' : '0'
        const delta = s.isRepo === true ? s.added + s.removed : 0
        let bdg = btn.querySelector('.bdg')
        if (delta > 0) {
          if (bdg === null) {
            bdg = document.createElement('span')
            bdg.className = 'bdg'
            btn.append(bdg)
          }
          bdg.textContent = ''
          const a = document.createElement('span')
          a.className = 'a'
          a.textContent = '+' + s.added
          const d = document.createElement('span')
          d.className = 'd'
          d.textContent = '\u2212' + s.removed
          bdg.append(a, d)
        } else if (bdg !== null) {
          bdg.remove()
        }
      }

      /* ---- 标题栏按钮（旧宿主 PAGE_JS 注入协议平移 + 图标改 git-branch；
         SPA 内 titlebar 可能重挂，低频轮询永续自愈） ---- */
      const injectBtn = () => {
        const host = document.getElementById(TITLEBAR_ID)
        if (host === null) return false
        if (document.getElementById(BTN_ID) !== null) return true
        const btn = document.createElement('button')
        btn.id = BTN_ID
        btn.title = 'git 工作区'
        btn.innerHTML = SVG.branch
        btn.onclick = () => { yielded = false; settingsYielded = false; setOpen(!open) } // 手动清义务
        host.append(btn)
        renderBadge()
        return true
      }
      setInterval(() => { injectBtn() }, 500)

      closeBtn.onclick = () => { yielded = false; settingsYielded = false; setOpen(false) } // 手动清义务
      refreshBtn.onclick = () => { void refresh() }

      // 开合 API（外部编排入口）
      window.__dshGitPanelOpen = () => { if (!open) { yielded = false; settingsYielded = false; setOpen(true) } }
      window.__dshGitPanelToggle = () => { yielded = false; settingsYielded = false; setOpen(!open) }

      // 启动：收起态 + 降频轮询（徽章保活），首拉立即
      void refresh()
      schedule()
    }

    return exports
  },
})
