/**
 * KCoder landing page.
 *
 * The desktop shell deliberately keeps this page framework-free. It is the
 * hand-off point into the deepseek-harness workspace, so the primary action
 * is always visible while the product preview explains what opens next.
 */

import type { DshStatus } from '@shared/ipc-contract'

interface LandingDesktopBridge {
  dshStatus(): Promise<DshStatus>
  showShell(): Promise<boolean>
  onDshStateChanged(cb: (status: DshStatus) => void): () => void
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
        <div class="engine-status" data-engine-status>
          <span class="engine-status-dot" aria-hidden="true"></span>
          <span data-engine-label>正在连接引擎</span>
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

        <section class="workspace-preview" aria-label="工作台预览">
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
                <div class="preview-editor-heading"><span>Connect authentication</span><b>Ready</b></div>
                <div class="preview-editor-sub">3 files · local engine · last run just now</div>
                <pre><span class="code-line code-line-1"><span class="line-number">12</span> <span class="syntax-keyword">async function</span> <span class="syntax-fn">signIn</span>(email, password) {'{'}</span>
<span class="code-line code-line-2"><span class="line-number">13</span> <span class="line-add">+  const session = await engine.authLogin(...)</span></span>
<span class="code-line code-line-3"><span class="line-number">14</span> <span class="line-add">+  persistSession(session.access_token)</span><span class="typing-caret" aria-hidden="true"></span></span>
<span class="code-line code-line-4"><span class="line-number">15</span> {'}'}</span></pre>
                <div class="preview-result"><span>✓</span> Engine session connected</div>
              </div>
            </div>
            <div class="preview-composer"><span class="composer-k">K</span><span>Ask KCoder to continue this task…</span><span class="composer-send">↵</span></div>
          </div>
          <div class="preview-caption"><span class="caption-line"></span><span>Plan clearly. Build confidently.</span></div>
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
  const renderDshStatus = (status: DshStatus): void => {
    if (workbenchButton === null) return
    const isReady = status.state === 'ready' && status.url !== null
    workbenchButton.disabled = !isReady
    workbenchButton.querySelector('span')!.textContent = isReady ? '进入工作台' : status.state === 'failed' ? '引擎启动失败' : '正在连接引擎…'
    engineLabel?.replaceChildren(document.createTextNode(isReady ? '引擎已就绪' : status.state === 'failed' ? '引擎启动失败' : '正在连接引擎'))
    engineStatus?.classList.toggle('is-ready', isReady)
    engineStatus?.classList.toggle('is-failed', status.state === 'failed')
  }

  if (desktop !== undefined) {
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
}
