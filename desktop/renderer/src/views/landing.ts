/**
 * KCoder landing page（v2：对齐 deepseek.com/harness 的设计语言）。
 *
 * 居中 hero（眉题/双行标题/副文案/pill CTA）→ 真实桌面截图大图（呼吸
 * 光晕 + 慢浮）→ 三张特性卡片（真实截图内嵌，hover 抬升，点击即进
 * 工作台）。动画全部为纯 CSS（landing.css），prefers-reduced-motion 退场。
 *
 * 本地鉴权门禁（登录态双视图，逻辑与 v1 一致）：
 * - 已登录：hero + showcase + 卡片；
 * - 未登录：同布局下 showcase 换成认证卡片（登录/注册）；
 * - 登录态由主进程持久化（记住我），登出切回认证视图。
 *
 * 截图资产：desktop/renderer/public/shots/*.png——真实运行态的 CDP 抓图
 * （抓图流程见 landing 重设计会话记录），随 public/ 进构建产物。
 */

import '../landing.css'
import type { AuthResult, AuthStatus, DshStatus } from '@shared/ipc-contract'

interface LandingDesktopBridge {
  dshStatus(): Promise<DshStatus>
  showShell(): Promise<boolean>
  onDshStateChanged(cb: (status: DshStatus) => void): () => void
  authStatus(): Promise<AuthStatus>
  authRegister(username: string, password: string): Promise<AuthResult>
  authLogin(username: string, password: string): Promise<AuthResult>
  authLogout(): Promise<AuthResult>
}

const quickStarts = [
  { label: '理解当前项目', icon: 'layers' },
  { label: '查找待办事项', icon: 'check' },
  { label: '解释入口文件', icon: 'code' },
] as const

const QUICK_ICONS: Record<(typeof quickStarts)[number]['icon'], string> = {
  layers: '<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  code: '<path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>',
}

/** 特性卡片：真实运行态截图（public/shots/），点击整卡进工作台。 */
const featureCards = [
  {
    shot: 'shots/workspace.png',
    caption: 'KCoder — 会话',
    title: '对话驱动开发',
    desc: '拆解、实现与验证在同一个对话流里完成，过程实时可见、随时介入。',
  },
  {
    shot: 'shots/terminal.png',
    caption: 'KCoder — 终端',
    title: '内置终端',
    desc: '每个工作区独立终端会话，构建、运行与排查不离开应用。',
  },
  {
    shot: 'shots/sidebar.png',
    caption: 'KCoder — 工作台侧栏',
    title: '侧边工作台',
    desc: '文件树与编辑器常驻侧栏，交付物与变更随手可查。',
  },
] as const

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

/**
 * 平台判定：主修饰键是 ⌘ 还是 Ctrl。提示字形与按键判定必须同源——此前提示硬编码
 * 「⌘ ↵」，在 Windows 上既看不懂也按不响（且当时**根本没有绑定**，见下）。
 * 渲染层自足取值，不为一行装饰扩 IPC 桥面。
 */
function prefersCmdKey(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  const name = data?.platform ?? navigator.platform ?? ''
  return /mac|iphone|ipad/i.test(name)
}

function shotFrame(caption: string, img: string, alt: string, extraClass = ''): string {
  return `
    <span class="shot-frame ${extraClass}">
      <span class="shot-titlebar"><span class="shot-lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="shot-caption">${caption}</span></span>
      <img class="shot-img" src="${img}" alt="${alt}" loading="lazy" />
    </span>`
}

export function mountLanding(root: HTMLElement): void {
  root.className = 'landing-root'
  root.innerHTML = `
    <div class="landing-shell">
      <header class="landing-header">
        <div class="landing-brand">
          <img src="kcoder.png" alt="KCoder" width="38" height="38" />
          <div>
            <strong>KCoder</strong>
            <span>桌面版 · AI coding workspace</span>
          </div>
        </div>
        <div class="landing-header-side">
          <div class="engine-status" data-engine-status>
            <span class="engine-status-dot" aria-hidden="true"></span>
            <span data-engine-label>正在连接引擎</span>
          </div>
        </div>
      </header>

      <main class="landing-scroll">
        <section class="hero" aria-labelledby="landing-title">
          <p class="hero-eyebrow anim" style="--d:.05s">✦ KCODER · DESKTOP WORKSPACE</p>
          <h1 class="hero-title anim" id="landing-title" style="--d:.14s">从一个想法，<br /><em>开始构建。</em></h1>
          <p class="hero-desc anim" style="--d:.24s">让智能体帮你理解项目、拆解任务并完成实现。保持专注，把每一次对话都变成可交付的代码。</p>
          <div class="hero-actions anim" style="--d:.34s">
            <button class="landing-enter" type="button" data-open-shell disabled>
              <span>正在连接引擎…</span>
              ${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}
            </button>
            <span class="landing-shortcut">⌘ ↵</span>
            <button type="button" class="auth-switch" data-auth-logout hidden>退出登录</button>
          </div>
          <div class="hero-chips anim" style="--d:.42s" aria-label="快捷开始">
            ${quickStarts.map((item) => `
              <button class="hero-chip" type="button" data-tip>
                ${icon(QUICK_ICONS[item.icon])}<span>${item.label}</span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="showcase" data-workspace-view aria-label="工作台实况">
          <div class="showcase-glow" aria-hidden="true"></div>
          <div class="anim" style="--d:.45s">
            ${shotFrame('KCoder — 工作台', 'shots/hero.png', 'KCoder 工作台实况截图', 'hero-shot')}
          </div>
        </section>

        <section class="features" data-workspace-view aria-labelledby="features-title">
          <h2 class="features-title anim" id="features-title" style="--d:.52s">对话即工作台。<br /><em>交付触手可及。</em></h2>
          <div class="feature-grid">
            ${featureCards.map((card, i) => `
              <button class="feature-card anim" type="button" data-tip style="--d:${(0.6 + i * 0.12).toFixed(2)}s">
                ${shotFrame(card.caption, card.shot, card.title)}
                <span class="feature-copy"><strong>${card.title}</strong><small>${card.desc}</small></span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="auth-panel" data-auth-view hidden>
          <p class="auth-panel-eyebrow">KCODER / ACCOUNT</p>
          <h2 class="auth-panel-title" data-auth-title>欢迎回来</h2>
          <p class="auth-panel-sub">登录后继续你的本地编码工作区。</p>
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
  /** 主修饰键与提示字形同源（macOS：⌘ ↵；Windows/Linux：Ctrl ↵）。 */
  const cmdKey = prefersCmdKey()
  const shortcutEl = root.querySelector<HTMLElement>('.landing-shortcut')
  if (shortcutEl !== null) shortcutEl.textContent = cmdKey ? '⌘ ↵' : 'Ctrl ↵'

  /* ---------- 登录门禁双视图：已登录 = showcase，未登录 = 认证卡 ---------- */
  const authView = root.querySelector<HTMLElement>('[data-auth-view]')
  const workspaceViews = root.querySelectorAll<HTMLElement>('[data-workspace-view]')
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

  /** 鉴权态：null = 尚未从主进程取回（按未登录渲染认证视图，保守落闸）。 */
  let auth: AuthStatus | null = null
  /** 表单模式（login/register）。 */
  let mode: 'login' | 'register' = 'login'

  const showError = (text: string): void => {
    if (errorEl === null) return
    errorEl.textContent = text
    errorEl.hidden = false
  }

  const renderGate = (): void => {
    const loggedIn = auth?.loggedIn === true
    if (authView !== null) authView.hidden = loggedIn
    for (const view of workspaceViews) view.hidden = !loggedIn
    if (logoutButton !== null) logoutButton.hidden = !loggedIn
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
        renderGate()
      } else {
        showError(r.error ?? '操作失败，请重试')
      }
    })
  })

  logoutButton?.addEventListener('click', () => {
    if (desktop === undefined) return
    void desktop.authLogout().then((r) => {
      auth = r.status
      // 回认证视图时清空敏感字段（账号保留方便重登，密码必清）
      if (passInput !== null) passInput.value = ''
      if (confirmInput !== null) confirmInput.value = ''
      renderGate()
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
    void desktop.authStatus().then((status) => {
      auth = status
      // 无任何账户时默认注册态（首用引导）；有账户默认登录态
      if (!status.hasAccount) {
        mode = 'register'
        renderMode()
      }
      renderGate()
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
    // 兑现那枚提示：此前只有硬编码的「⌘ ↵」文字、任何平台都没有绑定（空头支票）。
    // 与「进入工作台」走同一条路径（直接 click，共用同一处状态机与文案），按钮
    // 禁用时（引擎未就绪）不动。视图切走后 DOM 已换，用 isConnected 让监听器失效。
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      if (cmdKey ? !event.metaKey : !event.ctrlKey) return
      if (workbenchButton === null || workbenchButton.disabled || !workbenchButton.isConnected) return
      event.preventDefault()
      workbenchButton.click()
    })
    root.querySelectorAll<HTMLButtonElement>('[data-tip]').forEach((button) => {
      button.addEventListener('click', () => void desktop.showShell())
    })
  } else if (workbenchButton !== null) {
    workbenchButton.hidden = true
  }

  renderMode()
  renderGate()
}
