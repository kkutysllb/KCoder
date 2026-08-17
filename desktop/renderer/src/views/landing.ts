/**
 * KCoder 欢迎屏。
 *
 * 视觉移植自 KCoder 原项目 WelcomeScreen（assets/legacy/WelcomeScreen）：
 * 时段问候 + 品牌光晕 + 示例卡。原版的主输入区在这里由「进入工作台」
 * 桥接按钮替代——真正的输入发生在 deepseek-harness Web UI 里。
 */

import type { DshStatus } from '@shared/ipc-contract'

interface LandingDesktopBridge {
  dshStatus(): Promise<DshStatus>
  showShell(): Promise<boolean>
  onDshStateChanged(cb: (status: DshStatus) => void): () => void
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return '早上好，新的一天从代码开始'
  if (hour >= 12 && hour < 18) return '下午好，保持专注继续前进'
  if (hour >= 18 && hour < 23) return '晚上好，辛苦了一天记得休息'
  return '夜深啦，困了也要照顾好自己哦'
}

/** 示例卡（移植自原项目 i18n welcome.tip1-3；点击进入工作台继续）。 */
const tips = [
  {
    icon: 'arch',
    text: '帮我理解这个项目的架构',
  },
  {
    icon: 'code',
    text: '@src 入口文件，解释启动流程',
  },
  {
    icon: 'search',
    text: '找出所有 TODO 并列出来',
  },
] as const

const TIP_ICONS: Record<(typeof tips)[number]['icon'], string> = {
  arch: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 7l9-4 9 4-9 4-9-4z" /><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9 4 9-4M3 17l9 4 9-4" />',
  code: '<path stroke-linecap="round" stroke-linejoin="round" d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 5l-2 14" />',
  search: '<circle cx="11" cy="11" r="7" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4-4" />',
}

export function mountLanding(root: HTMLElement): void {
  root.className = 'landing-root'
  root.innerHTML = `
    <div class="welcome">
      <div class="welcome-glow" aria-hidden="true"></div>
      <div class="welcome-brand">
        <img src="kcoder.png" alt="KCoder" width="56" height="56" />
        <h1>${greeting()}</h1>
      </div>
      <button class="welcome-enter" type="button" data-open-shell disabled>正在连接引擎…</button>
      <p class="welcome-tip-title">试试这些</p>
      <div class="welcome-tips">
        ${tips
          .map(
            (tip) => `
        <button class="welcome-tip" type="button" data-tip>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${TIP_ICONS[tip.icon]}</svg>
          <span>${tip.text}</span>
        </button>`,
          )
          .join('')}
      </div>
      <p class="welcome-footer">KCoder · 引擎：deepseek-harness</p>
    </div>
  `

  const workbenchButton = root.querySelector<HTMLButtonElement>('[data-open-shell]')
  const desktop = (window as Window & { dshDesktop?: LandingDesktopBridge }).dshDesktop
  const renderDshStatus = (status: DshStatus): void => {
    if (workbenchButton === null) return
    if (status.state === 'ready' && status.url !== null) {
      workbenchButton.disabled = false
      workbenchButton.textContent = '进入工作台'
      return
    }
    workbenchButton.disabled = true
    workbenchButton.textContent = status.state === 'failed' ? '引擎启动失败，请检查设置' : '正在连接引擎…'
  }

  if (desktop !== undefined) {
    void desktop.dshStatus().then(renderDshStatus)
    desktop.onDshStateChanged(renderDshStatus)
    workbenchButton?.addEventListener('click', () => {
      workbenchButton.disabled = true
      workbenchButton.textContent = '正在打开工作台…'
      void desktop.showShell().then((opened) => {
        if (!opened) void desktop.dshStatus().then(renderDshStatus)
      })
    })
    for (const card of root.querySelectorAll<HTMLButtonElement>('[data-tip]')) {
      card.addEventListener('click', () => void desktop.showShell())
    }
  } else if (workbenchButton !== null) {
    workbenchButton.hidden = true
  }
}
