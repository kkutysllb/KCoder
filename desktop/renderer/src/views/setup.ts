/**
 * Setup：首次引导页。检查上游克隆/构建状态，一键初始化（克隆+装依赖+构建），
 * 并在完成后自动启动 dsh。
 *
 * @module desktop/renderer/src/views/setup
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { UpstreamProgress, UpstreamStatus } from '@shared/ipc-contract'

export function mountSetup(root: HTMLElement): void {
  const statusText = document.createElement('div')
  const steps = document.createElement('pre')
  steps.className = 'log'
  steps.textContent = '（尚未开始）'
  const startButton = document.createElement('button')
  startButton.className = 'primary'
  startButton.textContent = '初始化上游（克隆 + 安装依赖 + 构建）'
  const retryButton = document.createElement('button')
  retryButton.textContent = '重试启动引擎'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '设置'),
        el('div', 'sub', 'KCoder 依赖本地 deepseek-harness 克隆；上游不会被修改，也不提交进本项目。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '环境状态'), statusText]),
        el('div', 'card', [
          el('h2', '', '初始化进度（全量构建可能需要数分钟，可最小化等待）'),
          el('div', 'row', [startButton, retryButton]),
          steps,
        ]),
        el('div', 'card', [
          el('h2', '', '也可以在终端完成'),
          (() => {
            const pre = el('pre', 'log', '$ pnpm setup   # 等价于 scripts/setup.sh')
            return pre
          })(),
        ]),
      ]),
    ]),
  )

  const renderStatus = async (): Promise<void> => {
    const status: UpstreamStatus = await bridge.upstreamStatus()
    const parts: string[] = []
    parts.push(`上游克隆：${status.cloned ? '已存在' : '未克隆'}`)
    if (status.cloned) {
      parts.push(`HEAD：${status.head ?? '?'}${status.dirty ? '（工作树有改动）' : ''}`)
      parts.push(`构建产物：${status.built ? '已构建' : '未构建'}`)
      if (status.nodeRange !== null) parts.push(`上游 Node 要求：${status.nodeRange}`)
    }
    parts.push(`会话数据目录：~/.kcoder（DSH_HOME 可覆盖）`)
    statusText.textContent = parts.join('　·　')
    startButton.disabled = !status.cloned ? false : !status.built
    startButton.textContent = !status.cloned ? '初始化上游（克隆 + 安装依赖 + 构建）' : '重新构建上游'
  }
  void renderStatus()

  startButton.addEventListener('click', () => {
    startButton.disabled = true
    steps.textContent = ''
    // 未克隆 → upstream:setup（含克隆步骤）；已克隆 → upstream:sync（install + build）
    const action = bridge
      .upstreamStatus()
      .then((status) => (status.cloned ? bridge.upstreamSync() : bridge.upstreamSetup()))
    void action.then((result) => {
      if (result.ok) {
        steps.textContent += '\n✅ 初始化完成，正在启动 dsh…'
        void bridge.dshStart()
      } else {
        steps.textContent += `\n❌ ${result.error ?? '失败'}`
        startButton.disabled = false
      }
      void renderStatus()
    })
  })

  retryButton.addEventListener('click', () => {
    void bridge.dshStart()
  })

  // 同步过程中主进程也广播 upstream:progress（setup 复用同一通道）
  bridge.onUpstreamProgress((progress: UpstreamProgress) => {
    if (steps.textContent === '（尚未开始）') steps.textContent = ''
    const line = `[${progress.step}] ${progress.line}`
    steps.textContent += `${line}\n`
    if (progress.error) {
      startButton.disabled = false
      startButton.textContent = '重试'
    }
    steps.scrollTop = steps.scrollHeight
  })
}
