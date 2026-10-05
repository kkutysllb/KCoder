/**
 * @kkutysllb/dsh-terminal — client 半（dsh shell 页面内自包含交付物）。
 *
 * 嵌入式终端面板：主界面底部的真实终端（VS Code 同款），平移自退役
 * 宿主（desktop/main/terminal-panel.ts 的 PAGE_JS + pty-host 编排 +
 * desktop/renderer/src/views/terminal.ts 的 xterm 视图），语义一致：
 * - 每工作区独立面板桶（DOM 常驻、xterm buffer 不丢，display 切换）；
 *   切工作区仅切显示，不销毁、不杀 shell；开合偏好 per-workspace 记忆；
 * - 工作区探针：选中会话 fiber 解析 + session/list RPC（强信号唯一
 *   映射；弱信号仅启动初态兜底；乱序防御 wsGen 代数）——与宿主一致；
 * - 布局：left = 侧边栏实时宽度（ResizeObserver 跟随），不侵占侧栏；
 *   让位：centerCol/detailsCol padding-bottom + --dsh-terminal-inset
 *   （client 直设，无需主进程 executeJavaScript）；
 * - 多标签：每标签一个 shell（server PtyHost 会话），"+" 新建、× 关闭、
 *   restart 重建；隐藏标签持续收数据（SSE 全量广播按桶路由）；
 * - 真实终端回放（模式平移自 dsh-coding-sidebar）：注册标签即拉服务端
 *   transcript（snapshot RPC）回放历史——页面刷新/面板重建不再丢输出；
 *   回放在途期间到达的 SSE 新帧进 pending 队列，历史写完再 flush（严格
 *   保序，不重不漏）；
 * - 依赖降级：开面板前探 /api/deps，node-pty 缺失/损坏时渲染降级卡
 *   （原因 + 可复制的修复命令 + 重试），不再无声失败；
 * - header 上缘 4px 拖条调高（clamp + localStorage 持久化）；
 * - 右键菜单：复制/粘贴/清屏/新建/关闭（navigator.clipboard，页面
 *   同源权限；宿主 bridge IPC 不再存在）。
 *
 * 与宿主实现的差异（README 同步说明）：
 * - WebContentsView → 页面内 fixed DOM（z-index 900，低于上游 modal，
 *   上下文沉浸让位由层叠天然达成，ctxMode 冻结协议省略）；
 * - IPC 推送 → SSE（/dsh-terminal/api/stream 全局一条，断线 3s 重连）；
 * - xterm 依赖 vendor 化：client 无 import，首次开面板懒拉 vendor 三件
 *   （server 白名单托管，eval 挂 window.Terminal / FitAddonTrust）；
 * - ⌘W 关标签砍掉（主页面里 ⌘W 属关窗语义不可拦）；⌘T 新建保留。
 *
 * 按钮锚点链：KCoder 自绘标题栏（right:44，拖拽区显式 no-drag）→
 * 原生 dsh web/桌面壳的会话头右上角动作区（conversation.session.header.corner
 * slot；原生壳无锚点 1，v1.2.0 起回退注入，此前按钮在原生壳永不出现），
 * id __dsh_kc_term_btn。
 *
 * @module @kkutysllb/dsh-terminal/client
 */

window.__ModuleLoader__.load({
  id: '@kkutysllb/dsh-terminal',
  factory: () => {
    const exports = {}

    exports.inject = []

    exports.apply = function apply() {
      if (window.__dshKcTermWired) return
      window.__dshKcTermWired = true

      const BTN_ID = '__dsh_kc_term_btn'
      const STYLE_ID = '__dsh_kc_term_style'
      const API = '/dsh-terminal/api'
      const TITLEBAR_ID = '__dsh_desktop_titlebar'
      /** 无工作区桶键（兜底：探针尚未解析到时）。 */
      const NO_WORKSPACE_KEY = ''
      /** 面板高度（默认/界限；localStorage 持久化）。 */
      const PANEL_DEFAULT_H = 280
      const PANEL_MIN_H = 140
      const PANEL_MAX_H = 620
      const H_KEY = 'dsh-terminal-panel-h'
      /** SSE 断线重连间隔。 */
      const SSE_RETRY_MS = 3000
      /** vendor 懒加载三件。 */
      const VENDOR = ['xterm.js', 'addon-fit.js', 'xterm.css']

      /* ---- 主题 token（上游 bg-base/sidebar-fill 系；亮暗双轨） ----
       * v1.3.0 起不再带 `border`：分隔线由 fg 走 color-mix 现算（亮暗自动
       * 跟随且色相与正文一致）。删掉这条死 token 是为了不让硬编码色值有
       * 回流的口子——旧值 `rgba(0,0,0,.10)` 在暗色主题下会脏成灰线。 */
      const themeOf = () => {
        const dark = document.body.hasAttribute('data-ds-dark-theme')
        return dark
          ? { dark: true, bg: '#151517', headerBg: '#1B1B1C', fg: '#E8EAED', accent: '#4D6BFE' }
          : { dark: false, bg: '#FFFFFF', headerBg: '#F9FAFB', fg: '#1A1D21', accent: '#4D6BFE' }
      }

      const clampH = (h) => Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, Math.round(h)))

      const el = (tag, cls, text) => {
        const node = document.createElement(tag)
        if (cls !== '') node.className = cls
        if (text !== undefined) node.textContent = text
        return node
      }

      const iconBtn = (label, svg) => {
        const btn = el('button', 'kt-btn')
        btn.type = 'button'
        btn.title = label
        btn.setAttribute('aria-label', label)
        btn.innerHTML = svg
        return btn
      }

      /** 标签文字：目录短名（区分度最高；shell 名走 header 的 shell 徽标）。 */
      const tabLabel = (tab) => {
        const parts = String(tab.cwd || '').split('/').filter(Boolean)
        return parts.pop() ?? String(tab.cwd ?? '')
      }

      /** 标签前置图标（终端提示符母题，与开关按钮同一套笔画）。 */
      const TAB_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none">'
        + '<rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2" stroke="currentColor" stroke-width="1.25"/>'
        + '<path d="M4.7 6.4 6.3 8l-1.6 1.6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>'
        + '<path d="M8 10h3.2" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'
        + '</svg>'

      /**
       * 服务端 `tabOf()` 的 `title` 字段装的是 **shell 短名**，不是标签
       * 标题：`entry.js` 里是 `shellDisplayName(s.shell ?? defaultShell())`
       *（`/bin/zsh` → `zsh`、`C:\...\pwsh.exe` → `pwsh`）。
       *
       * 所以 header 的 shell 徽标直接显示**服务端算好的值**，客户端不猜
       * 平台：`$SHELL`、passwd 登录 shell、Windows 的 pwsh 探测链，乃至
       * `DSH_TERMINAL_SHELL` 覆写后的实际落点都如实反映。猜平台（darwin
       * → zsh）会在用户自定义 shell 时说谎，也会在 spawn 回退到 bash
       * 时与真实进程不符。
       */
      const shellNameOf = (tab) => (typeof tab?.title === 'string' ? tab.title : '')

      /**
       * header 的 shell 徽标：跟随活动标签，显示**服务端给出的** shell 短名。
       * 无活动标签（或服务端未给名）时整体隐藏，不留空胶囊。
       */
      const syncShellChip = (p) => {
        const chip = p.shellChip
        if (chip === undefined) return
        const st = p.tabs.get(p.activeId)
        const name = st === undefined ? '' : String(st.shellName ?? '')
        if (name === '') {
          chip.hidden = true
          chip.textContent = ''
          chip.removeAttribute('title')
          return
        }
        chip.hidden = false
        chip.textContent = name
        chip.title = `当前 shell：${name}`
      }

      /* ---- xterm vendor 懒加载（首次开面板时拉一次，失败重试） ---- */
      let vendorPromise = null
      const ensureXterm = () => {
        if (vendorPromise !== null) return vendorPromise
        vendorPromise = (async () => {
          for (const name of VENDOR) {
            const res = await fetch(`${API}/vendor/${name}`)
            if (!res.ok) throw new Error(`vendor ${name} ${res.status}`)
            const text = await res.text()
            if (name === 'xterm.css') {
              const style = el('style')
              style.setAttribute('data-dsh-terminal-vendor', name)
              style.textContent = text
              document.head.append(style)
            } else {
              // UMD：eval 下无 module/exports，走 globalThis 挂载分支
              ;(0, eval)(text)
            }
          }
          // UMD 挂载名实测：xterm.js → window.Terminal（class 本体）；
          // addon-fit → window.FitAddon（{ FitAddon: class } 命名空间对象）
          const TerminalCtor = window.Terminal
          const FitNs = window.FitAddon
          const FitCtor = FitNs !== null && typeof FitNs === 'object' ? (FitNs.FitAddon ?? FitNs) : FitNs
          if (typeof TerminalCtor !== 'function' || typeof FitCtor !== 'function') {
            throw new Error('xterm vendor eval failed')
          }
          return { Terminal: TerminalCtor, FitAddon: FitCtor }
        })()
        vendorPromise.catch(() => { vendorPromise = null }) // 失败允许重试
        return vendorPromise
      }

      /* ---- 当前会话 → 工作目录解析（同源 RPC；平移自 PAGE_JS） ---- */
      // 收集全部 selected 树行的会话 id：多棵树可能同时各有 selected
      //（会话树 + 搜索结果等），取第一个会拿到另一棵树的残留选中
      const probeSessionIds = () => {
        const ids = []
        for (const node of document.querySelectorAll('[role="treeitem"][aria-selected="true"]')) {
          const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$'))
          let fiber = fiberKey !== undefined ? node[fiberKey] : null
          while (fiber != null) {
            const n = fiber.memoizedProps != null ? fiber.memoizedProps.node : null
            if (n != null && typeof n.id === 'string') { ids.push(n.id); break }
            fiber = fiber.return
          }
        }
        return ids
      }
      let rpcSeq = 0
      // 解析代数：debounce 上报与按钮点击并发时，后发起的解析读到更新的
      // DOM；先发起的旧结果即使响应晚到也不得覆盖 → 代数不等的直接丢弃。
      let wsGen = 0
      // 结果语义（平移）：matched=true 强信号；matched=false 弱信号（仅
      // 启动初态）；null = 有选中但解析不出或响应乱序——宁可不上报。
      const resolveWorkspace = async () => {
        const gen = ++wsGen
        const doResolve = async () => {
          const res = await fetch('/api/session/list', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request', rpcId: 'kcoder-terminal-' + (++rpcSeq),
              method: 'session/list', payload: { args: { _request: {} } },
            }),
          })
          if (!res.ok) return null
          const envelope = await res.json().catch(() => null)
          const result = envelope != null && envelope.result != null ? envelope.result : null
          const items = result != null && result.ok === true && result.value != null
            && Array.isArray(result.value.items) ? result.value.items : null
          if (items == null || items.length === 0) return null
          const usable = items.filter(it => it != null && typeof it.sessionId === 'string')
          if (usable.length === 0) return null
          const ids = probeSessionIds()
          if (ids.length > 0) {
            const selected = usable.filter(it => ids.includes(it.sessionId))
            const dirs = new Set()
            for (const it of selected) {
              if (typeof it.cwd === 'string' && it.cwd !== '') dirs.add(it.cwd)
            }
            if (dirs.size !== 1) return null
            const path = [...dirs][0]
            return { matched: true, path, title: path.split('/').filter(Boolean).pop() ?? '' }
          }
          const withCwd = usable.filter(it => typeof it.cwd === 'string' && it.cwd !== '')
          if (withCwd.length === 0) return null
          const latest = withCwd.slice()
            .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0]
          return { matched: false, path: latest.cwd, title: latest.cwd.split('/').filter(Boolean).pop() ?? '' }
        }
        const ws = await doResolve().catch(() => null)
        return gen === wsGen ? ws : null
      }

      /* ---- 工作区状态（宿主 TerminalPanel.activeBucket 语义平移） ---- */
      let activeBucket = null // null = 未解析（绝不猜）
      let activeTitle = ''
      let fallbackSeen = false // 弱信号仅从未有过强信号时采纳（错桶根因防御）

      const applyWorkspace = (ws) => {
        if (ws == null) return
        if (ws.matched) {
          activeBucket = ws.path
          activeTitle = ws.title
          fallbackSeen = true
        } else if (!fallbackSeen && activeBucket === null) {
          activeBucket = ws.path
          activeTitle = ws.title
        } else {
          return
        }
        switchVisible(activeBucket)
      }

      const watchSelection = () => {
        let debounce = 0
        new MutationObserver(() => {
          window.clearTimeout(debounce)
          debounce = window.setTimeout(() => { void resolveWorkspace().then(applyWorkspace) }, 600)
        }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
        void resolveWorkspace().then(applyWorkspace)
      }

      /* ---- 侧边栏宽度探针（面板 left/width 跟随；平移 PAGE_JS） ---- */
      let sidebarW = 0
      const watchSidebar = () => {
        const sidebarEl = () => document.querySelector('[class*="sidebarCol"]')
        const target = sidebarEl()
        if (target == null) { requestAnimationFrame(watchSidebar); return }
        let raf = 0
        const reportW = () => {
          raf = 0
          sidebarW = Math.round(target.getBoundingClientRect().width)
          layout()
        }
        new ResizeObserver(() => { if (raf === 0) raf = requestAnimationFrame(reportW) }).observe(target)
        reportW()
      }

      /* ---- 让位（平移 __dshTerminalPad）：内容列 padding + 几何广播 ---- */
      const pad = (h) => {
        document.documentElement.style.setProperty('--dsh-terminal-inset', h > 0 ? h + 'px' : '0px')
        const cols = document.querySelectorAll('[class*="centerCol"], [class*="detailsCol"]')
        for (const col of cols) {
          if (h > 0) col.style.paddingBottom = h + 'px'
          else col.style.removeProperty('padding-bottom')
        }
      }

      /* ---- 面板高度（全局一个值，localStorage 持久化） ---- */
      let panelH = clampH(Number(window.localStorage.getItem(H_KEY)) || PANEL_DEFAULT_H)
      const setPanelH = (h) => {
        const next = clampH(h)
        if (next === panelH) return
        panelH = next
        try { window.localStorage.setItem(H_KEY, String(next)) } catch { /* 隐私态静默 */ }
        layout()
      }

      /* ---- 全局样式（面板 + 按钮 + 菜单；平移 PAGE_CSS，前缀 kt-） ---- */
      const style = el('style')
      style.id = STYLE_ID
      style.textContent = `
#${BTN_ID}:not(.kt-corner){all:unset;box-sizing:border-box;position:absolute;right:44px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:7px;cursor:pointer;color:rgba(26,29,33,.65);-webkit-app-region:no-drag;transition:background .15s ease}
body[data-ds-dark-theme] #${BTN_ID}:not(.kt-corner){color:rgba(232,234,237,.8)}
#${BTN_ID}.kt-corner{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;margin-left:6px;border-radius:7px;cursor:pointer;color:inherit;-webkit-app-region:no-drag;transition:background .15s ease}
#${BTN_ID}:hover{background:color-mix(in srgb,currentColor 10%,transparent)}
#${BTN_ID}:active{background:color-mix(in srgb,currentColor 18%,transparent)}
#${BTN_ID}[data-open="1"]{background:color-mix(in srgb,currentColor 14%,transparent)}
.kt-panel{all:unset;box-sizing:border-box;position:fixed;bottom:0;display:none;flex-direction:column;font:500 12px -apple-system,"PingFang SC","Segoe UI",sans-serif;z-index:900;background:#fff;border-top:1px solid var(--kt-hair,transparent);border-top-left-radius:10px;border-top-right-radius:10px;box-shadow:var(--kt-shadow,none);overflow:hidden}
.kt-panel[data-shown="1"]{display:flex}
/* 上缘拖条：命中区保留 6px，但**不再实心填色**。旧版把整条刷成分隔色，
   亮色下就是一条突兀的灰杠（用户报的「边框痕迹粗糙」的根因）。改为常态
   隐形、悬停浮出一枚居中胶囊（停靠区手感），拖动语义与命中区不变。 */
.kt-grip{position:relative;height:6px;flex:none;cursor:row-resize}
.kt-grip::after{content:"";position:absolute;left:50%;top:2px;width:34px;height:2px;margin-left:-17px;border-radius:2px;background:transparent;transition:background .16s ease,width .16s ease,margin-left .16s ease}
.kt-grip:hover::after{width:56px;margin-left:-28px;background:var(--kt-hair,transparent)}
.kt-grip:active::after{background:var(--kt-accent,transparent);opacity:.75}
.kt-header{flex:none;height:34px;display:flex;align-items:stretch;gap:6px;padding:0 8px;user-select:none;border-bottom:1px solid var(--kt-hair,transparent)}
.kt-tabs{flex:1;min-width:0;display:flex;align-items:stretch;gap:2px;overflow-x:auto;scrollbar-width:none}
.kt-tabs::-webkit-scrollbar{display:none}
.kt-tab{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;padding:0 7px 0 11px;max-width:170px;border-radius:7px;cursor:pointer;flex:none}
.kt-tab .kt-tab-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:13px;height:13px;opacity:.48;transition:opacity .15s ease}
.kt-tab[data-active="1"] .kt-tab-icon{opacity:.9}
.kt-tab[data-exited="1"] .kt-tab-icon{opacity:.28}
.kt-tab .kt-tab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.55}
.kt-tab[data-active="1"]{background:rgba(128,128,128,.14);box-shadow:inset 0 0 0 1px var(--kt-hair,transparent)}
.kt-tab[data-active="1"] .kt-tab-label{opacity:1;font-weight:600}
.kt-tab .kt-x{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;cursor:pointer;opacity:0;flex:none}
.kt-tab:hover .kt-x,.kt-tab[data-exited="1"] .kt-x{opacity:.7}
.kt-tab .kt-x:hover{background:rgba(128,128,128,.25);opacity:1}
.kt-tab[data-exited="1"] .kt-tab-label{opacity:.35;font-style:italic}
/* header 的 shell 名徽标：等宽字体 + 胶囊形，读出「这个标签底下跑的是什么
   shell」。文字由服务端 shellDisplayName 给出，不猜平台。 */
.kt-shell{flex:none;display:inline-flex;align-items:center;height:20px;margin-top:7px;padding:0 8px;border-radius:999px;border:1px solid var(--kt-hair,transparent);background:var(--kt-chip,transparent);font:600 10.5px/1 Menlo,Monaco,"SF Mono",ui-monospace,monospace;letter-spacing:.03em;opacity:.62;white-space:nowrap;user-select:text}
.kt-shell[hidden]{display:none}
.kt-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-top:4px;border-radius:6px;cursor:pointer}
.kt-btn:hover{background:rgba(128,128,128,.18)}
.kt-btn svg{display:block}
.kt-term{flex:1;min-height:0;position:relative}
.kt-term .kt-page{position:absolute;inset:0;padding:2px 8px 6px}
.kt-term .kt-page[hidden]{display:none}
.kt-term .xterm{height:100%}
/* xterm viewport 固定 overflow-y:scroll（vendor/xterm.css:96），而本仓那份
   xterm.css 是**裁剪版、不带任何滚动条配色规则** ⇒ 浏览器默认滚动条直接露出：
   亮色下白底白条看不出来，暗色下就是面板右缘一条 15px 白杠（实测
   offsetWidth-clientWidth=15，elementFromPoint 命中 .xterm-viewport）。
   按亮暗主题给它一套细滚动条（track 透明 ⇒ 露出终端底色）。
   注：两条写法并存是刻意的——Chromium ≥121 认 scrollbar-width/color 并忽略
   ::-webkit-scrollbar；旧版（Electron 24 = Chromium 112）反之。 */
.kt-term .xterm-viewport{scrollbar-width:thin;scrollbar-color:var(--kt-bar,transparent) transparent}
.kt-term .xterm-viewport::-webkit-scrollbar{width:10px;height:10px}
.kt-term .xterm-viewport::-webkit-scrollbar-track{background:transparent}
.kt-term .xterm-viewport::-webkit-scrollbar-thumb{background:var(--kt-bar,transparent);background-clip:content-box;border:2px solid transparent;border-radius:6px}
.kt-term .xterm-viewport::-webkit-scrollbar-thumb:hover{background:var(--kt-bar-hover,transparent);background-clip:content-box;border:2px solid transparent}
.kt-term .xterm-viewport::-webkit-scrollbar-corner{background:transparent}
.kt-exit{flex:none;display:none;align-items:center;gap:10px;padding:6px 12px;font-size:12px;opacity:.8;border-top:1px solid var(--kt-hair,transparent)}
.kt-menu{position:fixed;z-index:901;min-width:148px;padding:4px;border-radius:8px;border:1px solid var(--kt-hair,transparent);box-shadow:0 10px 30px var(--kt-raise,rgba(0,0,0,.28));font-size:12px}
.kt-menu button{all:unset;box-sizing:border-box;display:flex;width:100%;padding:5px 10px;border-radius:5px;cursor:pointer}
.kt-menu button:hover{background:rgba(128,128,128,.18)}
.kt-menu button:disabled{opacity:.35;cursor:default}
.kt-menu .kt-sep{height:1px;margin:4px 6px;background:var(--kt-hair,transparent)}
.kt-deps{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:16px 20px;overflow:auto}
.kt-deps-title{font-weight:700;font-size:13px}
.kt-deps-cause{opacity:.75;font-size:12px;word-break:break-all}
.kt-deps-cmd{display:flex;align-items:center;gap:8px}
.kt-deps-cmd code{flex:0 1 auto;max-width:100%;overflow-x:auto;padding:4px 8px;border-radius:6px;background:rgba(128,128,128,.14);font:500 12px Menlo,Monaco,monospace;white-space:nowrap}
.kt-deps-cmd button{all:unset;box-sizing:border-box;cursor:pointer;padding:3px 10px;border-radius:6px;font-weight:600;flex:none}
.kt-deps-cmd button:hover{background:rgba(128,128,128,.25)}
.kt-deps-note{opacity:.6;font-size:11px;max-width:640px}
.kt-deps-retry{all:unset;box-sizing:border-box;cursor:pointer;align-self:flex-start;padding:5px 14px;border-radius:7px;font-weight:600;background:rgba(77,107,254,.15);color:#4D6BFE}
.kt-deps-retry:hover{background:rgba(77,107,254,.28)}
`
      document.head.append(style)

      /* ---- pty RPC 封装 ---- */
      const rpc = async (body) => {
        const res = await fetch(`${API}/rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error(`rpc ${res.status}`)
        return res.json()
      }

      /* ---- node-pty 依赖状态（ok:true 缓存；不 ok 每次重查，修复后自然恢复） ---- */
      let depsOk = null // null = 尚未查询
      const fetchDeps = async () => {
        if (depsOk === true) return { ok: true }
        try {
          const res = await fetch(`${API}/deps`)
          const body = res.ok ? await res.json() : null
          depsOk = body !== null && body !== undefined && body.ok === true
          if (depsOk) return { ok: true }
          return body != null && body.ok === false
            ? body
            : { ok: false, cause: 'deps ' + res.status, command: '' }
        } catch (error) {
          return { ok: false, cause: String(error?.message ?? error), command: '' }
        }
      }

      /* ---- 单工作区面板（平移 WorkspaceView + mountTerminal） ---- */
      const panels = new Map() // bucket → PanelState
      const xtermReady = ensureXterm()

      const palette = () => {
        const t = themeOf()
        return {
          token: t,
          xterm: {
            background: t.bg,
            foreground: t.fg,
            cursor: t.accent,
            cursorAccent: t.bg,
            selectionBackground: t.accent + '59',
          },
        }
      }

      const applyPalette = (panel) => {
        const p = palette()
        panel.root.style.background = p.token.bg
        // 镀铬派生量：全部从宿主既有 token 现算，不引入第十六套色板。
        // 分隔线走 color-mix(fg)：亮暗自动跟随且色相与正文一致——旧版
        // 硬编码 rgba(0,0,0,.10) 在暗色主题下会脏成一条灰线。
        panel.root.style.setProperty('--kt-fg', p.token.fg)
        panel.root.style.setProperty('--kt-accent', p.token.accent)
        panel.root.style.setProperty('--kt-hair', `color-mix(in srgb, ${p.token.fg} 14%, transparent)`)
        panel.root.style.setProperty('--kt-chip', `color-mix(in srgb, ${p.token.fg} 6%, transparent)`)
        // xterm viewport 的滚动条（见样式块注释）：默认滚动条在暗色下是白杠
        panel.root.style.setProperty('--kt-bar', `color-mix(in srgb, ${p.token.fg} 26%, transparent)`)
        panel.root.style.setProperty('--kt-bar-hover', `color-mix(in srgb, ${p.token.fg} 42%, transparent)`)
        panel.root.style.setProperty('--kt-raise', p.token.dark ? 'rgba(0,0,0,.6)' : 'rgba(15,23,42,.16)')
        panel.root.style.setProperty('--kt-shadow', p.token.dark
          ? '0 -10px 30px rgba(0,0,0,.55)'
          : '0 -10px 30px rgba(15,23,42,.13)')
        panel.header.style.background = p.token.headerBg
        panel.header.style.color = p.token.fg
        panel.exitBar.style.background = p.token.bg
        panel.exitBar.style.color = p.token.fg
        panel.menu.style.background = p.token.headerBg
        panel.menu.style.color = p.token.fg
        panel.palette = p.xterm
        for (const st of panel.tabs.values()) st.term.options.theme = p.xterm
      }

      /** 依赖降级面板（panel-shaped：与 layout/applyPalette/开合协议兼容）。 */
      const ensureDepsPanel = (bucket, deps) => {
        const root = el('div', 'kt-panel')
        root.id = bucket === NO_WORKSPACE_KEY ? '__dsh_kc_term_panel' : '__dsh_kc_term_panel_deps_' + panels.size
        const grip = el('div', 'kt-grip')
        const header = el('div', 'kt-header')
        const termHost = el('div', 'kt-term')
        const exitBar = el('div', 'kt-exit')
        const menu = el('div', 'kt-menu')
        menu.style.display = 'none'
        const card = el('div', 'kt-deps')
        card.append(el('div', 'kt-deps-title', '终端依赖不可用（降级模式）'))
        card.append(el('div', 'kt-deps-cause', deps.cause || 'node-pty 加载失败'))
        const cmdRow = el('div', 'kt-deps-cmd')
        const code = el('code', '', deps.command || 'dsh plugin install')
        const copy = el('button', '', '复制')
        copy.type = 'button'
        copy.onclick = () => { void navigator.clipboard?.writeText(code.textContent ?? '').catch(() => {}) }
        cmdRow.append(code, copy)
        card.append(cmdRow)
        if (deps.note) card.append(el('div', 'kt-deps-note', deps.note))
        const retry = el('button', 'kt-deps-retry', '重试')
        retry.type = 'button'
        retry.onclick = () => {
          depsOk = null
          panels.delete(bucket)
          root.remove()
          show(bucket)
        }
        card.append(retry)
        termHost.append(card)
        root.append(grip, header, termHost, exitBar, menu)
        // 挂 documentElement：上游 SPA 重渲染重写 body 不清外部节点（同教训）。
        document.documentElement.append(root)
        const panel = {
          bucket, root, grip, header, termHost, exitBar, menu,
          tabs: new Map(), activeId: -1, open: false, shown: false, loaded: true,
          palette: null, depsMode: true,
          resyncTabs: () => {},
        }
        // 降级卡此前从不调 applyPalette：面板底色落回 CSS 的 #fff，暗色
        // 主题下是一块白板，而且 body 主题翻转的观察者重涂也涂不到它。
        applyPalette(panel)
        panels.set(bucket, panel)
        return panel
      }

      /** 懒建指定工作区面板 DOM（vendor 就绪后；已存在直接返回）。 */
      const ensurePanel = async (bucket) => {
        let panel = panels.get(bucket)
        // 上游 SPA 重渲染会整表重写 body（切会话等），外部节点随之被清：
        // 断连的孤儿面板按缺失处理，删档重建（xterm buffer 不保留）。
        if (panel !== undefined && !panel.root.isConnected) {
          panels.delete(bucket)
          panel = undefined
        }
        if (panel !== undefined) return panel
        // 依赖预检：node-pty 缺失/损坏时渲染降级卡（原因 + 修复命令 + 重试），
        // 不再无声失败；修复后重试自然恢复。
        const deps = await fetchDeps()
        if (!deps.ok) return ensureDepsPanel(bucket, deps)
        // 现取而非用预热常量：预热失败置空 vendorPromise 后，这里重拉新 promise
        const { Terminal, FitAddon } = await ensureXterm()
        const root = el('div', 'kt-panel')
        root.id = bucket === NO_WORKSPACE_KEY ? '__dsh_kc_term_panel' : `__dsh_kc_term_panel_${panels.size}`
        const grip = el('div', 'kt-grip')
        const header = el('div', 'kt-header')
        const tabsBar = el('div', 'kt-tabs')
        const newBtn = iconBtn('新建终端标签（⌘T）',
          '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>')
        const restartBtn = iconBtn('重启 shell（在当前工作区目录）',
          '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M13.7 1.8v2.7h-2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>')
        const closeBtn = iconBtn('关闭终端面板（会话保留）',
          '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>')
        const shellChip = el('span', 'kt-shell')
        shellChip.hidden = true
        header.append(tabsBar, shellChip, newBtn, restartBtn, closeBtn)
        const termHost = el('div', 'kt-term')
        const exitBar = el('div', 'kt-exit')
        const exitText = el('span', '', 'shell 进程已退出')
        const relaunch = el('button', '', '重新启动')
        relaunch.type = 'button'
        relaunch.style.cssText = 'all:unset;cursor:pointer;padding:3px 10px;border-radius:6px;font-weight:600'
        relaunch.onmouseenter = () => { relaunch.style.background = 'rgba(128,128,128,.25)' }
        relaunch.onmouseleave = () => { relaunch.style.background = 'transparent' }
        exitBar.append(exitText, relaunch)
        const menu = el('div', 'kt-menu')
        menu.style.display = 'none'
        root.append(grip, header, termHost, exitBar, menu)
        // 挂 documentElement：上游 SPA 重渲染（恢复会话/切树）会重写 body，
        // 外部节点全灭；html 直下不动（git-panel 同款教训）。
        document.documentElement.append(root)

        panel = {
          bucket, root, grip, header, tabsBar, shellChip, termHost, exitBar, menu,
          tabs: new Map(), activeId: -1, open: false, shown: false, loaded: false,
          palette: null,
        }

        const registerTab = (tab) => {
          const host = el('div', 'kt-page')
          host.hidden = true
          termHost.append(host)
          const term = new Terminal({
            fontFamily: 'Menlo, Monaco, "DejaVu Sans Mono", "Courier New", monospace',
            fontSize: 13,
            cursorBlink: true,
            convertEol: false,
            scrollback: 4000,
            theme: panel.palette,
          })
          const fit = new FitAddon()
          term.loadAddon(fit)
          term.open(host)
          // ⌘T 新建（⌘W 不拦：主页面里属关窗语义）
          term.attachCustomKeyEventHandler((event) => {
            if (event.metaKey && event.key === 't' && event.type === 'keydown') {
              void newTab(panel)
              return false
            }
            return true
          })
          const tabEl = el('button', 'kt-tab')
          tabEl.type = 'button'
          tabEl.title = `${tab.title} — ${tab.cwd}`
          const icon = el('span', 'kt-tab-icon')
          icon.innerHTML = TAB_ICON
          const label = el('span', 'kt-tab-label', tabLabel(tab))
          const x = el('button', 'kt-x')
          x.type = 'button'
          x.title = '关闭标签'
          x.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" fill="none"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
          tabEl.append(icon, label, x)
          tabsBar.append(tabEl)
          const st = { id: tab.id, term, fit, host, el: tabEl, shellName: shellNameOf(tab), exited: !tab.alive, replaying: true, pending: [], disposed: false }
          tabEl.dataset.exited = st.exited ? '1' : '0'
          tabEl.onclick = () => setActive(panel, st.id)
          x.onclick = e => { e.stopPropagation(); void closeTab(panel, st.id) }
          term.onData(data => { void rpc({ op: 'write', id: st.id, data }).catch(() => {}) })
          term.onResize(({ cols, rows }) => { void rpc({ op: 'resize', id: st.id, cols, rows }).catch(() => {}) })
          panel.tabs.set(st.id, st)
          // 真实终端回放：注册即拉服务端 transcript 写历史（页面刷新/面板
          // 重建后不再丢输出）。回放在途期间到达的 SSE 新帧进 pending，
          // 历史写完统一 flush——严格保序，不重不漏。
          void rpc({ op: 'snapshot', id: st.id }).then(out => {
            if (st.disposed) return
            if (out != null && out.ok && typeof out.chunk === 'string' && out.chunk !== '') {
              try { st.term.write(out.chunk) } catch { /* term 已释放 */ }
            }
          }).catch(() => {}).finally(() => {
            st.replaying = false
            if (st.pending.length > 0) {
              const queued = st.pending
              st.pending = []
              for (const c of queued) { try { st.term.write(c) } catch { break } }
            }
          })
          return st
        }

        const setActive = (p, id) => {
          const st = p.tabs.get(id)
          if (st === undefined) return
          p.activeId = id
          for (const t of p.tabs.values()) {
            t.el.dataset.active = t.id === id ? '1' : '0'
            t.host.hidden = t.id !== id
          }
          p.exitBar.style.display = st.exited ? 'flex' : 'none'
          syncShellChip(p)
          // 隐藏期间尺寸可能滞后：激活即补 fit + 上报（pty 端补 resize）
          if (p.termHost.clientWidth !== 0 && p.termHost.clientHeight !== 0) {
            try { st.fit.fit() } catch { /* 容器暂不可测 */ }
          }
          st.term.focus()
        }

        const markExited = (p, id) => {
          const st = p.tabs.get(id)
          if (st === undefined) return
          st.exited = true
          st.el.dataset.exited = '1'
          if (id === p.activeId) p.exitBar.style.display = 'flex'
        }

        const closeTab = async (p, id) => {
          if (id === -1) return
          const st = p.tabs.get(id)
          if (st === undefined) return
          const out = await rpc({ op: 'close', id, cwd: p.bucket === NO_WORKSPACE_KEY ? '' : p.bucket }).catch(() => null)
          if (out === null) return
          st.disposed = true
          st.term.dispose()
          st.host.remove()
          st.el.remove()
          p.tabs.delete(id)
          // 对齐服务端剩余标签（防御：本地与远端应一致）
          const ids = new Set((out.tabs ?? []).map(t => t.id))
          for (const [kid, kst] of [...p.tabs]) {
            if (!ids.has(kid)) { kst.disposed = true; kst.term.dispose(); kst.host.remove(); kst.el.remove(); p.tabs.delete(kid) }
          }
          if (p.tabs.size === 0) {
            // 全部关闭 → 收起面板（下次打开 ensureFirst 新建全新会话）
            p.activeId = -1
            hide(p.bucket)
            return
          }
          if (id === p.activeId) {
            const last = [...p.tabs.keys()].pop()
            if (last !== undefined) setActive(p, last)
          }
        }

        const newTab = async (p) => {
          const out = await rpc({ op: 'new', cwd: p.bucket === NO_WORKSPACE_KEY ? '' : p.bucket }).catch(() => null)
          if (out === null || out.tab === undefined) {
            // 新建失败可能是 node-pty 缺失/损坏（spawn 加载失败）：探测 deps，
            // 确认缺失则把面板替换为降级卡（修复命令 + 重试）。
            const deps = await fetchDeps().catch(() => null)
            if (deps !== null && !deps.ok) {
              panels.delete(p.bucket)
              if (p.root.isConnected) p.root.remove()
              show(p.bucket)
            }
            return
          }
          const st = registerTab(out.tab)
          setActive(p, st.id)
          st.term.focus()
        }

        // 按当前桶增量对齐（宿主 terminal:reset 同语义：同 id 保留原
        // xterm 实例与 buffer，仅做差异增删——切走再切回原状恢复）。
        const resyncTabs = async (p) => {
          const out = await rpc({ op: 'tabs', cwd: p.bucket === NO_WORKSPACE_KEY ? '' : p.bucket }).catch(() => null)
          if (out === null) return
          const fresh = out.tabs ?? []
          const freshIds = new Set(fresh.map(t => t.id))
          for (const [kid, kst] of [...p.tabs]) {
            if (!freshIds.has(kid)) {
              kst.disposed = true
              kst.term.dispose(); kst.host.remove(); kst.el.remove(); p.tabs.delete(kid)
            }
          }
          for (const tab of fresh) {
            if (p.tabs.has(tab.id)) continue
            const st = registerTab(tab)
            if (p.activeId === -1 || tab.alive) p.activeId = st.id
          }
          if (p.activeId !== -1 && !p.tabs.has(p.activeId)) {
            p.activeId = [...p.tabs.keys()][0] ?? -1
          }
          if (p.activeId !== -1) setActive(p, p.activeId)
          // 无活动标签（桶空 / resync 后全灭）时同样要收徽标，否则会留下
          // 上一个标签的 shell 名——比不显示更容易误导。
          syncShellChip(p)
        }
        panel.resyncTabs = () => { void resyncTabs(panel) }

        /* ---- header 动作 ---- */
        newBtn.onclick = () => { void newTab(panel) }
        restartBtn.onclick = async () => {
          if (panel.activeId === -1) return
          const out = await rpc({ op: 'restart', id: panel.activeId, cwd: panel.bucket === NO_WORKSPACE_KEY ? '' : panel.bucket }).catch(() => null)
          const st = panel.tabs.get(panel.activeId)
          if (out === null || out.tab === undefined || out.tab === null || st === undefined) return
          st.exited = false
          st.el.dataset.exited = '0'
          st.el.title = `${out.tab.title} — ${out.tab.cwd}`
          st.shellName = shellNameOf(out.tab)
          const lbl = st.el.querySelector('.kt-tab-label')
          if (lbl !== null) lbl.textContent = tabLabel(out.tab)
          syncShellChip(panel)
          st.term.reset()
          panel.exitBar.style.display = 'none'
          st.term.focus()
        }
        closeBtn.onclick = () => { hide(panel.bucket) }
        relaunch.onclick = () => { restartBtn.click() }

        /* ---- 右键菜单（navigator.clipboard；页面同源权限） ---- */
        const closeMenu = () => { menu.style.display = 'none' }
        const menuItem = (label, action, disabled = false) => {
          const item = el('button', '', label)
          item.type = 'button'
          item.disabled = disabled
          item.onclick = () => { closeMenu(); action() }
          return item
        }
        const menuSep = () => el('div', 'kt-sep')
        termHost.addEventListener('contextmenu', e => {
          e.preventDefault()
          const st = panel.tabs.get(panel.activeId)
          if (st === undefined) return
          const hasSel = st.term.hasSelection()
          menu.innerHTML = ''
          menu.append(
            menuItem('复制', () => {
              const sel = st.term.getSelection()
              if (sel !== '') void navigator.clipboard?.writeText(sel).catch(() => {})
              st.term.clearSelection()
            }, !hasSel),
            menuItem('粘贴', () => {
              void navigator.clipboard?.readText().then(text => { if (text !== '') st.term.paste(text) }).catch(() => {})
            }),
            menuItem('清屏', () => { st.term.clear() }),
            menuSep(),
            menuItem('新建标签', () => { void newTab(panel) }),
            menuItem('关闭标签', () => { void closeTab(panel, st.id) }, panel.tabs.size <= 1),
          )
          menu.style.display = 'block'
          const rect = menu.getBoundingClientRect()
          menu.style.left = `${Math.max(2, Math.min(e.clientX, window.innerWidth - rect.width - 2))}px`
          menu.style.top = `${Math.max(2, Math.min(e.clientY, window.innerHeight - rect.height - 2))}px`
        })
        document.addEventListener('pointerdown', e => {
          if (menu.style.display === 'none') return
          if (e.target instanceof Node && menu.contains(e.target)) return
          closeMenu()
        }, true)
        window.addEventListener('blur', closeMenu)

        /* ---- 上缘拖条：调面板高度（向下拖正 = 面板变矮） ---- */
        let dragging = false
        let lastY = 0
        let pending = 0
        let raf = 0
        grip.onpointerdown = e => {
          dragging = true
          lastY = e.clientY
          pending = 0
          grip.setPointerCapture(e.pointerId)
          e.preventDefault()
        }
        grip.onpointermove = e => {
          if (!dragging) return
          pending += e.clientY - lastY
          lastY = e.clientY
          if (raf === 0) {
            raf = requestAnimationFrame(() => {
              raf = 0
              if (pending !== 0) {
                const sent = pending
                pending = 0
                setPanelH(panelH - sent)
              }
            })
          }
        }
        grip.onpointerup = () => { dragging = false }
        grip.onpointercancel = () => { dragging = false }

        /* ---- 尺寸：容器变化只 refit 活动标签（隐藏的激活时补） ---- */
        const refit = () => {
          if (termHost.clientWidth === 0 || termHost.clientHeight === 0) return
          const st = panel.tabs.get(panel.activeId)
          if (st === undefined) return
          try { st.fit.fit() } catch { /* 忽略瞬时不可测 */ }
        }
        new ResizeObserver(() => refit()).observe(termHost)

        applyPalette(panel)
        panels.set(bucket, panel)
        await resyncTabs(panel)
        // 宿主 ensureFirst 语义：桶内无标签时新建首标签（否则空面板）
        if (panel.tabs.size === 0) await newTab(panel)
        return panel
      }

      /* ---- 开合（平移 TerminalPanel show/hide/toggle/switchVisible） ---- */
      const syncButtonState = () => {
        const open = [...panels.values()].some(p => p.open)
        const btn = document.getElementById(BTN_ID)
        if (btn !== null) btn.setAttribute('data-open', open ? '1' : '0')
      }

      const layout = () => {
        const contentW = window.innerWidth
        const x = Math.min(sidebarW, Math.max(contentW - 200, 0))
        // 右边界让位右侧栏（better-sidebar 浮层展开时）
        const w = Math.max(contentW - x - rightPanelW, 0)
        let anyShown = false
        for (const p of panels.values()) {
          if (!p.shown) continue
          anyShown = true
          p.root.style.left = `${x}px`
          p.root.style.width = `${w}px`
          p.root.style.height = `${panelH}px`
        }
        pad(anyShown ? panelH : 0)
      }

      const show = (bucket) => {
        const key = bucket ?? NO_WORKSPACE_KEY
        void ensurePanel(key).then(p => {
          p.open = true
          p.shown = true
          p.root.setAttribute('data-shown', '1')
          void rpc({ op: 'tabs', cwd: key === NO_WORKSPACE_KEY ? '' : key }).then(() => p.resyncTabs()).catch(() => {})
          layout()
          syncButtonState()
          const first = [...p.tabs.values()].find(t => t.id === p.activeId)
          if (first !== undefined) first.term.focus()
        }).catch((error) => { console.error('[dsh-terminal] show failed:', error) /* vendor 加载失败静默（下次点击重试） */ })
      }

      const hide = (bucket) => {
        const key = bucket ?? NO_WORKSPACE_KEY
        const p = panels.get(key)
        if (p === undefined) return
        p.open = false
        p.shown = false
        p.root.removeAttribute('data-shown')
        layout()
        syncButtonState()
      }

      const toggle = () => {
        const bucket = activeBucket ?? NO_WORKSPACE_KEY
        const p = panels.get(bucket)
        if (p !== undefined && p.open) hide(bucket)
        else show(bucket)
      }

      /** 切工作区：目标桶按自己的开合记忆恢复，其余仅隐藏（记忆保留）。 */
      const switchVisible = (newBucket) => {
        for (const [bucket, p] of panels) {
          if (!p.root.isConnected) continue // 孤儿（SPA 重渲染清除）：跳过不 resync
          const shouldShow = bucket === newBucket && p.open
          p.shown = shouldShow
          if (shouldShow) p.root.setAttribute('data-shown', '1')
          else p.root.removeAttribute('data-shown')
          if (shouldShow) p.resyncTabs()
        }
        layout()
        syncButtonState()
      }

      /* ---- SSE 输出流（全局一条广播，按桶路由；断线重连） ---- */
      const connectStream = () => {
        const es = new EventSource(`${API}/stream`)
        es.onmessage = (ev) => {
          let msg = null
          try { msg = JSON.parse(ev.data) } catch { return }
          if (msg === null || msg === undefined) return
          const p = panels.get(msg.bucket)
          if (p === undefined) return
          if (msg.type === 'data') {
            const st = p.tabs.get(msg.id)
            if (st === undefined || st.disposed) return
            // 回放在途：新帧先入 pending 队列，snapshot 历史写完再 flush。
            if (st.replaying) st.pending.push(msg.chunk)
            else st.term.write(msg.chunk)
          }
          else if (msg.type === 'exit') {
            const st = p.tabs.get(msg.id)
            if (st === undefined) return
            st.exited = true
            st.el.dataset.exited = '1'
            if (msg.id === p.activeId) p.exitBar.style.display = 'flex'
          }
        }
        es.onerror = () => {
          es.close()
          window.setTimeout(connectStream, SSE_RETRY_MS)
        }
      }

      /* ---- 主题跟随（body data-ds-dark-theme 翻转 → 全部面板重涂） ---- */
      new MutationObserver(() => {
        for (const p of panels.values()) applyPalette(p)
      }).observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

      /* ---- 窗口 resize → 重排（view 时代 win.on('resize') 的等价物） ---- */
      window.addEventListener('resize', () => layout())

      /* ---- 右侧栏宽度探针（面板右边界让位） ---- */
      // KCoder better-sidebar 把面板实时宽度写在根变量 --dsh-sidebar-width
      //（展开/拖宽 setProperty、收起 removeProperty），监听 style 属性变
      // 化即得右边界。QiLin AppFrame 右栏不写该变量 → 回退为直接量
      // [data-rightbar-col] 列宽，开合/拖宽由 ResizeObserver 驱动重排，
      // 终端面板右边界精确停在右侧栏左缘，不侵占其下方区域。
      let rightPanelW = 0
      let rightbarWatched = null
      const armRightbarWatcher = () => {
        const el = document.querySelector('[data-rightbar-col]')
        if (el === null) return null
        if (rightbarRo !== null && rightbarWatched !== el) { rightbarRo.observe(el); rightbarWatched = el }
        return el
      }
      const readRightPanel = () => {
        let w = Number.parseFloat(document.documentElement.style.getPropertyValue('--dsh-sidebar-width'))
        if (!Number.isFinite(w) || w <= 0) {
          const el = armRightbarWatcher()
          w = el !== null ? el.getBoundingClientRect().width : 0
        }
        const next = Number.isFinite(w) && w > 0 ? Math.round(w) : 0
        if (next !== rightPanelW) { rightPanelW = next; layout() }
      }
      const rightbarRo = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(readRightPanel) : null
      readRightPanel()
      new MutationObserver(readRightPanel).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
      // 右栏列晚于本脚本初始化（React 挂载在后）：DOM 变化兜底重探，
      // 探到即交棒 ResizeObserver 并停表，避免常驻监听
      const rightbarMountMo = new MutationObserver(() => {
        if (armRightbarWatcher() !== null) { readRightPanel(); rightbarMountMo.disconnect() }
      })
      if (rightbarWatched === null) rightbarMountMo.observe(document.body, { childList: true, subtree: true })

      /* ---- 终面板开关按钮（锚点链：宿主自绘标题栏 → 原生会话头 corner） ----
       * 锚点 1（KCoder 桌面壳）：主进程 executeJavaScript 注入的
       *   #__dsh_desktop_titlebar（绝对定位 right:44，拖拽区宿主任命）；
       * 锚点 2（原生 dsh web/桌面壳）：上游会话头右上角动作区
       *   [data-slot="conversation.session.header.corner"]（slot 工具化
       *   DOM，键随 ui-conversation 源码稳定；外层另有非哈希
       *   data-conversation-header-corner 兜底选择器）。原生壳没有锚点 1
       *   （那是 KCoder 主进程私有的），此前按钮永不注入——不显示并非
       *   遮挡。corner 为 display:contents 包装器，按钮作为其末位子节点
       *   参与标题行 flex；行整体 data-window-drag，按钮显式 no-drag。
       *   会话头仅会话页渲染（hero/设置页无 corner）→ 页面内按钮随
       *   路由消失属预期，巡逻恢复；锚点 1 存在时永远优先——含竞态后到
       *   升级（corner 先落、标题栏后现 → 巡逻迁回标题栏）。 */
      const CORNER_ID = 'conversation.session.header.corner'
      const injectBtn = () => {
        const existing = document.getElementById(BTN_ID)
        const bar = document.getElementById(TITLEBAR_ID)
        // 孤儿回收：锚点宿主被上游整表重写时按钮随之脱挂——视为缺失重建
        //（v1.1.x 起的旧洞：脱挂按钮占住 id，巡逻永远 'present' 不重建）。
        if (existing !== null && !existing.isConnected) existing.remove()
        if (existing !== null && existing.isConnected) {
          // 锚点升级：corner 只是回退位。KCoder 壳的标题栏由主进程
          // executeJavaScript 在 did-finish-load 注入，时序可能晚于 React
          // 会话头首帧（竞态窗口内按钮先落 corner 且再不挪位——v1.2.0
          // KCoder 回归的根因）；巡逻发现标题栏即迁回 v1.1.x 位形
          // （right:44 绝对定位）。原生壳无标题栏 → 永驻 corner，不受影响。
          if (bar !== null && existing.classList.contains('kt-corner')) {
            existing.classList.remove('kt-corner')
            bar.append(existing)
            return 'moved'
          }
          return 'present'
        }
        let host = bar
        let cornerMode = false
        if (host === null) {
          cornerMode = true
          host = document.querySelector(`[data-slot="${CORNER_ID}"], [data-conversation-header-corner]`)
          if (host === null) return 'absent'
        }
        const btn = el('button')
        btn.type = 'button'
        btn.id = BTN_ID
        btn.title = '切换内嵌终端'
        btn.setAttribute('aria-label', '切换内嵌终端')
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 16 16')
        svg.setAttribute('width', '16')
        svg.setAttribute('height', '16')
        svg.setAttribute('fill', 'none')
        svg.innerHTML = '<rect x="2" y="2.5" width="12" height="11" rx="1.75" stroke="currentColor" stroke-width="1.2"/><path d="M4.9 6.3 6.6 8l-1.7 1.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.3 9.9h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
        btn.append(svg)
        if (cornerMode) btn.className = 'kt-corner'
        btn.onclick = () => {
          void resolveWorkspace().then(ws => {
            if (ws != null && ws.matched) { activeBucket = ws.path; activeTitle = ws.title; fallbackSeen = true }
            toggle()
          }).catch(() => toggle())
        }
        host.append(btn)
        return 'injected'
      }
      // 锚点宿主会被上游 SPA 重渲染整表重写/换元（按钮随之丢失）：前 60s
      // 高频注入，此后转低频常驻巡逻，发现按钮被清即重建。
      let tries = 0
      const fastPoll = setInterval(() => {
        if (injectBtn() !== 'absent' || ++tries > 120) {
          clearInterval(fastPoll)
          setInterval(() => { injectBtn() }, 5000)
        }
      }, 500)

      /* ---- 启动：探针 + SSE + 预热 vendor ---- */
      if (document.body !== null) watchSelection()
      else document.addEventListener('DOMContentLoaded', () => watchSelection(), { once: true })
      requestAnimationFrame(watchSidebar)
      connectStream()
      void xtermReady.catch(() => {}) // 预热失败静默，开面板时重试
      void rpc({ op: 'tabs', cwd: '' }).catch(() => {}) // 预热连接（无害）
    }

    return exports
  },
})
