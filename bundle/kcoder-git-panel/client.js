/**
 * @kcoder/git-panel — client 半（shell 页面内独立浮动面板）。
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
 * @module @kcoder/git-panel/client
 */

window.__ModuleLoader__.load({
  id: '@kcoder/git-panel',
  factory: () => {
    const exports = {}

    exports.inject = []

    exports.apply = function apply(ctx) {
      if (window.__dshKcGitWired) return
      window.__dshKcGitWired = true

      const BTN_ID = '__dsh_kc_git_btn'
      const PANEL_ID = '__dsh_kc_git_panel'
      const STYLE_ID = '__dsh_kc_git_style'
      const API = '/kc-git-panel/api'
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

      const SVG = {
        branch: '<svg viewBox="0 0 16 16" fill="none"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" fill="currentColor"/></svg>',
        folder: '<svg viewBox="0 0 16 16" fill="none"><path d="M1.8 3.5c0-.6.4-1 1-1h3l1.4 1.6h6c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1v-8.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
        refresh: '<svg viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        close: '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
        plan: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2.2h10c.6 0 1 .4 1 1v9.6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V3.2c0-.6.4-1 1-1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
      }

      /* ---- 样式：面板（git.ts PAGE_CSS 平移 + fixed 外壳）+ 标题栏按钮/徽章 ---- */
      const CSS = [
        '#' + PANEL_ID + '{position:fixed;right:' + PANEL_MARGIN + 'px;top:' + PANEL_TOP + 'px;width:min(' + PANEL_W + 'px,calc(100vw - 24px));height:clamp(' + PANEL_MIN_H + 'px,calc(100vh - ' + (PANEL_TOP + PANEL_MARGIN) + 'px),' + PANEL_MAX_H + 'px);z-index:2147483647;display:flex;flex-direction:column;font:400 12px/1.55 -apple-system,"PingFang SC","Segoe UI",sans-serif}',
        '#' + PANEL_ID + ' .gt-card{flex:1;min-height:0;display:flex;flex-direction:column;border-radius:12px;border:1px solid var(--gt-border);background:var(--gt-bg);box-shadow:0 14px 44px rgba(9,16,29,.22),0 2px 8px rgba(9,16,29,.10);overflow:hidden;color:var(--gt-fg);--gt-bg:#FFFFFF;--gt-header:#F9FAFB;--gt-fg:#1A1D21;--gt-border:rgba(0,0,0,.10);--gt-muted:rgba(26,29,33,.55);--gt-chip:rgba(128,128,128,.14);--gt-hover:rgba(128,128,128,.12);--gt-accent:#2F6FED;--gt-add:#1A7F37;--gt-del:#CF222E;--gt-mono:ui-monospace,Menlo,Monaco,monospace}',
        '@media (prefers-color-scheme: dark){#' + PANEL_ID + ' .gt-card{--gt-bg:#1B1B1C;--gt-header:#222325;--gt-fg:#E8EAED;--gt-border:#2C2C2E;--gt-muted:rgba(232,234,237,.55);--gt-chip:rgba(128,128,128,.18);--gt-hover:rgba(128,128,128,.16);--gt-accent:#7C9BFF;--gt-add:#3FB950;--gt-del:#F85149;box-shadow:0 14px 44px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4)}}',
        // 应用内主题轨道（theme-watcher 同步上游暗色到 body 标记）
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
      ].join('')

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.append(style)

      /* ---- 面板骨架（挂 documentElement：SPA 重渲染不动它） ---- */
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
      // 任务计划（约定位置扫到的 agent 计划文档；点击走软依赖预览链）
      const planCaps = el('div', 'gt-caps', '任务计划')
      const planList = el('div')
      const empty = el('div', 'gt-empty')
      body.append(planCaps, planList, empty)

      card.append(header, status, body)
      panel.append(card)
      document.documentElement.append(panel)

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
        const cwd = currentCwd()
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
      new MutationObserver(applySidebarMutual).observe(document.body, {
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

      /* ---- 渲染（git.ts render 平移） ---- */
      function render(s) {
        wName.textContent = s.workspace ?? '—'
        la.textContent = '+' + s.added
        ld.textContent = '\u2212' + s.removed
        const setPill = (p, v) => { p.querySelector('b').textContent = String(v) }
        setPill(pStaged, s.staged)
        setPill(pChanged, s.changed)
        setPill(pUntracked, s.untracked)
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
        btn.onclick = () => { yielded = false; setOpen(!open) } // 手动清义务
        host.append(btn)
        renderBadge()
        return true
      }
      setInterval(() => { injectBtn() }, 500)

      closeBtn.onclick = () => { yielded = false; setOpen(false) } // 手动清义务
      refreshBtn.onclick = () => { void refresh() }

      // 开合 API（外部编排入口）
      window.__dshGitPanelOpen = () => { if (!open) { yielded = false; setOpen(true) } }
      window.__dshGitPanelToggle = () => { yielded = false; setOpen(!open) }

      // 启动：收起态 + 降频轮询（徽章保活），首拉立即
      void refresh()
      schedule()
    }

    return exports
  },
})
