/**
 * Sync：上游同步面板。显示克隆状态并一键执行同步流水线
 * （fetch → ff-only pull → pnpm install → pnpm build → 自动重启 dsh）。
 *
 * @module desktop/renderer/src/views/sync
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { UpstreamProgress, UpstreamStatus } from '@shared/ipc-contract'

export function mountSync(root: HTMLElement): void {
  const statusText = document.createElement('div')
  const syncButton = document.createElement('button')
  syncButton.className = 'primary'
  syncButton.textContent = '同步上游（pull + install + build + 重启）'
  const output = document.createElement('pre')
  output.className = 'log'
  output.textContent = '（尚未同步）'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '同步上游'),
        el('div', 'sub', '跟进 deepseek-harness 上游：工作树必须干净，同步后自动重启 dsh。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '仓库状态'), statusText, el('div', 'row', [syncButton])]),
        el('div', 'card', [el('h2', '', '流水线输出'), output]),
      ]),
    ]),
  )

  const render = async (): Promise<void> => {
    const status: UpstreamStatus = await bridge.upstreamStatus()
    if (!status.cloned) {
      statusText.textContent = '上游克隆不存在——请先到“设置”页初始化。'
      syncButton.disabled = true
      return
    }
    statusText.textContent = `HEAD：${status.head ?? '?'}`
      + `　·　${status.behind ? `落后 ${String(status.behindCount)} 个提交` : '已是最新'}`
      + `　·　${status.dirty ? '⚠️ 工作树有本地改动（同步将被拒绝）' : '工作树干净'}`
      + `　·　构建产物：${status.built ? '已构建' : '未构建'}`
    syncButton.disabled = false
  }
  void render()

  syncButton.addEventListener('click', () => {
    syncButton.disabled = true
    output.textContent = ''
    void bridge.upstreamSync().then((result) => {
      output.textContent += result.ok ? '\n✅ 同步完成，dsh 正在以新构建重启' : `\n❌ ${result.error ?? '同步失败'}`
      syncButton.disabled = false
      void render()
    })
  })

  bridge.onUpstreamProgress((progress: UpstreamProgress) => {
    if (output.textContent === '（尚未同步）') output.textContent = ''
    const line = `[${progress.step}] ${progress.line}`
    output.textContent += `${line}\n`
    output.scrollTop = output.scrollHeight
  })
}
