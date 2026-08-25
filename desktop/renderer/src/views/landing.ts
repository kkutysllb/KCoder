/**
 * KCoder landing page.
 *
 * The desktop shell deliberately keeps this page framework-free. It is the
 * hand-off point into the deepseek-harness workspace, so the primary action
 * is always visible while the product preview explains what opens next.
 *
 * 本地鉴权门禁（登录态双视图）：
 * - 未登录：左侧品牌介绍，右侧登录/注册面板；
 * - 已登录：左侧品牌介绍，右侧工作台预览；
 * - 登录态由主进程持久化（记住我），登出切回登录视图。
 */

import type { AuthResult, AuthStatus, DshStatus } from '@shared/ipc-contract'

interface LandingDesktopBridge {
  dshStatus(): Promise<DshStatus>
  showShell(): Promise<boolean>
  onDshStateChanged(cb: (status: DshStatus) => void): () => void
  authStatus(): Promise<AuthStatus>
  authRegister(username: string, password: string): Promise<AuthResult>
  authLogin(username: string, password: string): Promise<AuthResult>
  authLogout(): Promise<AuthResult>
  landingTheme(): Promise<ThemePref>
  setLandingTheme(pref: ThemePref): Promise<ThemePref>
}

const quickStarts = [
  { label: '理解当前项目', detail: '梳理目录、依赖与启动路径', icon: 'layers' },
  { label: '查找待办事项', detail: '扫描 TODO、FIXME 与风险点', icon: 'check' },
  { label: '解释入口文件', detail: '从 src 入口开始读懂代码', icon: 'code' },
] as const

const QUICK_ICONS: Record<(typeof quickStarts)[number]['icon'], string> = {
  layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
}

/** 主题三态（landing 自有，与上游解耦）：图标 + 提示文案 + 循环后继。 */
type ThemePref = 'light' | 'dark' | 'system'
const THEME_META: Record<ThemePref, { icon: string; label: string }> = {
  light: {
    icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    label: '浅色',
  },
  dark: {
    icon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    label: '深色',
  },
  system: {
    icon: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    label: '跟随系统',
  },
}
const THEME_NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' }

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

export function mountLanding(root: HTMLElement): void {
  root.className = 'landing-root'
  root.innerHTML = `
    <div class="landing-shell">
      <header class="landing-header">
        <div class="landing-brand">
          <img src="kcoder.png" alt="KCoder" width="42" height="42" />
          <div>
            <strong>KCoder</strong>
            <span>AI coding workspace</span>
          </div>
        </div>
        <div class="landing-header-side">
          <button class="theme-toggle" type="button" data-theme-toggle title="主题：跟随系统" hidden>
            <span class="theme-toggle-icon" data-theme-icon>${icon(THEME_META.system.icon)}</span>
          </button>
          <div class="engine-status" data-engine-status>
            <span class="engine-status-dot" aria-hidden="true"></span>
            <span data-engine-label>正在连接引擎</span>
          </div>
        </div>
      </header>

      <main class="landing-main">
        <section class="landing-intro" aria-labelledby="landing-title">
          <p class="landing-eyebrow">KCODER / WORKSPACE</p>
          <h1 id="landing-title">从一个想法，<br /><em>开始构建。</em></h1>
          <p class="landing-description">让智能体帮你理解项目、拆解任务并完成实现。保持专注，把每一次对话都变成可交付的代码。</p>
          <div class="landing-actions">
            <button class="landing-enter" type="button" data-open-shell disabled>
              <span>正在连接引擎…</span>
              ${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}
            </button>
            <span class="landing-shortcut">⌘ ↵</span>
            <button type="button" class="auth-switch" data-auth-logout hidden>退出登录</button>
          </div>
          <div class="quick-starts" aria-label="快捷开始">
            <p>从一个具体问题开始</p>
            <div class="quick-start-list">
              ${quickStarts.map((item) => `
                <button class="quick-start" type="button" data-tip>
                  <span class="quick-start-icon">${icon(QUICK_ICONS[item.icon])}</span>
                  <span class="quick-start-copy"><strong>${item.label}</strong><small>${item.detail}</small></span>
                  <span class="quick-start-arrow" aria-hidden="true">${icon('<path d="M5 12h13M13 7l5 5-5 5"/>')}</span>
                </button>
              `).join('')}
            </div>
          </div>
        </section>

        <section class="landing-right">
          <div class="landing-mode-tabs" role="tablist" aria-label="右侧内容">
            <button class="landing-mode-tab is-active" type="button" data-mode-tab="preview" role="tab" aria-selected="true">工作台预览</button>
            <button class="landing-mode-tab" type="button" data-mode-tab="auth" role="tab" aria-selected="false">登录 / 注册</button>
          </div>

          <div class="landing-auth-panel" data-auth-view hidden>
            <p class="landing-eyebrow">KCODER / ACCOUNT</p>
            <h2 class="landing-auth-title" data-auth-title>欢迎回来</h2>
            <p class="landing-auth-subtitle">登录后继续你的本地编码工作区。</p>
            <form class="auth-card" data-auth-form novalidate>
              <div class="auth-tabs" role="tablist" aria-label="登录或注册">
                <button type="button" class="auth-tab" data-auth-tab="login" role="tab">登录</button>
                <button type="button" class="auth-tab" data-auth-tab="register" role="tab">注册</button>
              </div>
              <label class="auth-field">账号
                <input data-auth-user name="username" autocomplete="username" spellcheck="false" placeholder="2–24 位字母、数字或中文" />
              </label>
              <label class="auth-field">密码
                <input data-auth-pass name="password" type="password" autocomplete="current-password" placeholder="至少 4 位" />
              </label>
              <label class="auth-field" data-auth-confirm hidden>确认密码
                <input data-auth-confirm-input type="password" autocomplete="new-password" placeholder="再输一次" />
              </label>
              <p class="auth-error" data-auth-error hidden></p>
              <button class="auth-submit" type="submit" data-auth-submit>登录</button>
            </form>
            <p class="auth-note">账户信息仅保存在本机，用于保护你的工作区。</p>
          </div>

        <section class="workspace-preview" data-workspace-preview aria-label="工作台预览">
          <div class="preview-window">
            <div class="preview-titlebar">
              <span class="window-lights" aria-hidden="true"><i></i><i></i><i></i></span>
              <span class="preview-title"><img src="kcoder.png" alt="" width="16" height="16" />auth-flow</span>
              <span class="preview-branch">main</span>
            </div>
            <div class="preview-body">
              <aside class="preview-sidebar">
                <span class="preview-sidebar-label">WORKSPACE</span>
                <div class="preview-file active"><span class="file-dot blue"></span>src / auth.ts</div>
                <div class="preview-file"><span class="file-dot purple"></span>src / engine.ts</div>
                <div class="preview-file"><span class="file-dot amber"></span>README.md</div>
                <span class="preview-sidebar-label preview-sidebar-label-spaced">AGENT</span>
                <div class="agent-state"><span></span>Ready to build</div>
              </aside>
              <div class="preview-editor">
                <div class="preview-editor-heading"><span>Connect authentication</span><b data-ready-badge>Ready</b></div>
                <div class="preview-editor-sub">3 files · local engine · last run just now</div>
                <pre><span class="code-line" style="--row: 0"><span class="line-number">12</span><span class="code-text"><span class="syntax-keyword">async function</span> <span class="syntax-fn">signIn</span>(email, password) {'{'}<span class="row-caret" aria-hidden="true"></span></span></span>
<span class="code-line" style="--row: 1"><span class="line-number">13</span><span class="code-text line-add">+  const session = await engine.authLogin(...)<span class="row-caret" aria-hidden="true"></span></span></span>
<span class="code-line" style="--row: 2"><span class="line-number">14</span><span class="code-text line-add">+  persistSession(session.access_token)<span class="row-caret" aria-hidden="true"></span></span></span>
<span class="code-line" style="--row: 3"><span class="line-number">15</span><span class="code-text">{'}'}<span class="row-caret" aria-hidden="true"></span></span></span></pre>
                <div class="preview-result"><span>✓</span> Engine session connected</div>
              </div>
            </div>
            <div class="preview-composer"><span class="composer-k">K</span><span>Ask KCoder to continue this task…</span><span class="composer-send">↵</span></div>
          </div>
          <div class="preview-caption"><span class="caption-line"></span><span>Plan clearly. Build confidently.</span></div>
        </section>
        </section>
      </main>

      <footer class="landing-footer">
        <span>KCoder · powered by deepseek-harness</span>
        <span>Local-first · Your workspace, your code</span>
      </footer>
    </div>
  `

  const workbenchButton = root.querySelector<HTMLButtonElement>('[data-open-shell]')
  const engineLabel = root.querySelector<HTMLElement>('[data-engine-label]')
  const engineStatus = root.querySelector<HTMLElement>('[data-engine-status]')
  const desktop = (window as Window & { dshDesktop?: LandingDesktopBridge }).dshDesktop

  /* ---------- 右侧内容标签：预览默认，认证按需打开 ---------- */
  const authView = root.querySelector<HTMLElement>('[data-auth-view]')
  const workspacePreview = root.querySelector<HTMLElement>('[data-workspace-preview]')
  const modeTabs = root.querySelectorAll<HTMLButtonElement>('[data-mode-tab]')
  const logoutButton = root.querySelector<HTMLButtonElement>('[data-auth-logout]')
  const form = root.querySelector<HTMLFormElement>('[data-auth-form]')
  const titleEl = root.querySelector<HTMLElement>('[data-auth-title]')
  const userInput = root.querySelector<HTMLInputElement>('[data-auth-user]')
  const passInput = root.querySelector<HTMLInputElement>('[data-auth-pass]')
  const confirmRow = root.querySelector<HTMLElement>('[data-auth-confirm]')
  const confirmInput = root.querySelector<HTMLInputElement>('[data-auth-confirm-input]')
  const errorEl = root.querySelector<HTMLElement>('[data-auth-error]')
  const submitButton = root.querySelector<HTMLButtonElement>('[data-auth-submit]')
  const tabs = root.querySelectorAll<HTMLButtonElement>('[data-auth-tab]')

  /** 鉴权态：null = 尚未从主进程取回（按未登录渲染登录视图，保守落闸）。 */
  let auth: AuthStatus | null = null
  /** 表单模式（login/register）。 */
  let mode: 'login' | 'register' = 'login'
  let activeRightView: 'preview' | 'auth' = 'preview'

  const showError = (text: string): void => {
    if (errorEl === null) return
    errorEl.textContent = text
    errorEl.hidden = false
  }

  const renderRightView = (): void => {
    const showAuth = activeRightView === 'auth'
    if (authView !== null) authView.hidden = !showAuth
    if (workspacePreview !== null) workspacePreview.hidden = showAuth
    for (const tab of modeTabs) {
      const selected = tab.dataset.modeTab === activeRightView
      tab.classList.toggle('is-active', selected)
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    }
  }

  for (const tab of modeTabs) {
    tab.addEventListener('click', () => {
      activeRightView = tab.dataset.modeTab === 'auth' ? 'auth' : 'preview'
      renderRightView()
      if (activeRightView === 'auth') userInput?.focus()
    })
  }

  /** 更新认证状态，不再强制替换右侧内容。 */
  const renderAuth = (): void => {
    const loggedIn = auth?.loggedIn === true
    if (logoutButton !== null) logoutButton.hidden = !loggedIn
    renderRightView()
  }

  /** 表单模式切换（标题/tab/确认密码字段随动）。 */
  const renderMode = (): void => {
    for (const tab of tabs) {
      tab.classList.toggle('is-active', tab.dataset.authTab === mode)
      tab.setAttribute('aria-selected', tab.dataset.authTab === mode ? 'true' : 'false')
    }
    if (confirmRow !== null) confirmRow.hidden = mode !== 'register'
    if (submitButton !== null) submitButton.textContent = mode === 'login' ? '登录' : '注册并登录'
    if (titleEl !== null) titleEl.textContent = mode === 'login' ? '欢迎回来' : '创建账号'
    if (errorEl !== null) errorEl.hidden = true
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      mode = tab.dataset.authTab === 'register' ? 'register' : 'login'
      renderMode()
    })
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (desktop === undefined || userInput === null || passInput === null) return
    const username = userInput.value.trim()
    const password = passInput.value
    if (errorEl !== null) errorEl.hidden = true
    if (submitButton !== null) submitButton.disabled = true
    const request: Promise<AuthResult> = mode === 'register'
      ? (confirmInput !== null && confirmInput.value !== password
          ? Promise.resolve({ ok: false, error: '两次输入的密码不一致', status: auth ?? { loggedIn: false, username: null, hasAccount: false } })
          : desktop.authRegister(username, password))
      : desktop.authLogin(username, password)
    void request.then((r) => {
      if (submitButton !== null) submitButton.disabled = false
      if (r.ok) {
        auth = r.status
        activeRightView = 'preview'
        renderAuth()
      } else {
        showError(r.error ?? '操作失败，请重试')
      }
    })
  })

  logoutButton?.addEventListener('click', () => {
    if (desktop === undefined) return
    void desktop.authLogout().then((r) => {
      auth = r.status
      // 回登录视图时清空敏感字段（账号保留方便重登，密码必清）
      if (passInput !== null) passInput.value = ''
      if (confirmInput !== null) confirmInput.value = ''
      activeRightView = 'auth'
      renderAuth()
    })
  })

  const renderDshStatus = (status: DshStatus): void => {
    // 进入按钮只跟引擎状态——它只出现在已登录视图（登录态门禁由
    // 主进程 showShellWindow 兜底，渲染层无需重复拦截）
    if (workbenchButton !== null) {
      const isReady = status.state === 'ready' && status.url !== null
      workbenchButton.disabled = !isReady
      workbenchButton.querySelector('span')!.textContent = isReady ? '进入工作台' : status.state === 'failed' ? '引擎启动失败' : '正在连接引擎…'
    }
    const isReady = status.state === 'ready' && status.url !== null
    engineLabel?.replaceChildren(document.createTextNode(isReady ? '引擎已就绪' : status.state === 'failed' ? '引擎启动失败' : '正在连接引擎'))
    engineStatus?.classList.toggle('is-ready', isReady)
    engineStatus?.classList.toggle('is-failed', status.state === 'failed')
  }

  if (desktop !== undefined) {
    const themeButton = root.querySelector<HTMLButtonElement>('[data-theme-toggle]')
    const themeIcon = root.querySelector<HTMLElement>('[data-theme-icon]')
    /** 图标/提示随当前档刷新（IPC 后 prefers-color-scheme 由主进程驱动翻转） */
    const renderTheme = (pref: ThemePref): void => {
      if (themeIcon !== null) themeIcon.innerHTML = icon(THEME_META[pref].icon)
      if (themeButton !== null) themeButton.title = `主题：${THEME_META[pref].label}（点击切换）`
    }
    if (themeButton !== null) {
      themeButton.hidden = false
      themeButton.addEventListener('click', () => {
        void desktop.landingTheme().then((current) => desktop.setLandingTheme(THEME_NEXT[current]).then(renderTheme))
      })
    }
    void desktop.landingTheme().then(renderTheme)
    void desktop.authStatus().then((status) => {
      auth = status
      // 无任何账户时默认注册态（首用引导）；有账户默认登录态
      if (!status.hasAccount) {
        mode = 'register'
        renderMode()
      }
      renderAuth()
    })
    void desktop.dshStatus().then(renderDshStatus)
    desktop.onDshStateChanged(renderDshStatus)
    workbenchButton?.addEventListener('click', () => {
      workbenchButton.disabled = true
      workbenchButton.querySelector('span')!.textContent = '正在打开工作台…'
      void desktop.showShell().then((opened) => {
        if (!opened) void desktop.dshStatus().then(renderDshStatus)
      })
    })
    root.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach((button) => {
      button.addEventListener('click', () => void desktop.showShell())
    })
  } else if (workbenchButton !== null) {
    workbenchButton.hidden = true
  }

  renderMode()
  renderAuth()
}
