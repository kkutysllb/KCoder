/**
 * Diagnostics：dsh 侧车诊断面板（状态、命令、日志尾部、重启）+ 应用更新。
 *
 * @module desktop/renderer/src/views/diagnostics
 */

import { bridge } from '../bridge'
import { el } from './splash'
import type { DshLogLine, DshStatus, UpdateStatus } from '@shared/ipc-contract'

export function mountDiagnostics(root: HTMLElement): void {
  const statusText = document.createElement('div')
  const log = document.createElement('pre')
  log.className = 'log'
  const restartButton = document.createElement('button')
  restartButton.className = 'primary'
  restartButton.textContent = '重启 dsh'

  /* ---- 应用更新卡片 ---- */
  const updateText = document.createElement('div')
  const checkButton = document.createElement('button')
  checkButton.textContent = '检查更新'
  const installButton = document.createElement('button')
  installButton.className = 'primary'
  installButton.textContent = '安装更新并重启'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '诊断'),
        el('div', 'sub', 'dsh 侧车进程的运行状态与输出。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '状态'), statusText, el('div', 'row', [restartButton])]),
        el('div', 'card', [el('h2', '', '应用更新'), updateText, el('div', 'row', [checkButton, installButton])]),
        el('div', 'card', [el('h2', '', '日志（尾部 500 行，实时）'), log]),
      ]),
    ]),
  )

  const stateLabel = (state: DshStatus['state']): string =>
    ({ stopped: '已停止', starting: '启动中', ready: '已就绪', failed: '失败', restarting: '重启中' })[state]

  const render = (status: DshStatus): void => {
    statusText.textContent = `状态：${stateLabel(status.state)}`
      + (status.url !== null ? `　·　地址：${status.url}` : '')
      + (status.source !== null ? `　·　来源：${{ env: 'DSH_BIN', checkout: '本地克隆', path: 'PATH' }[status.source]}` : '')
      + `　·　剩余自动重启：${String(status.restartsLeft)}`
    if (status.error !== null) {
      const err = el('div', '', `错误：${status.error}`)
      err.style.color = 'var(--danger)'
      statusText.append(err)
    }
  }

  const appendLine = (line: DshLogLine): void => {
    const span = document.createElement('span')
    if (line.stream === 'stderr') span.className = 'err'
    span.textContent = `${line.line}\n`
    log.append(span)
    while (log.childElementCount > 500) log.firstElementChild?.remove()
    log.scrollTop = log.scrollHeight
  }

  void bridge.dshStatus().then(render)
  void bridge.dshLogs().then((lines) => {
    log.replaceChildren()
    for (const line of lines) appendLine(line)
  })
  bridge.onDshStateChanged(render)
  bridge.onDshLog(appendLine)

  restartButton.addEventListener('click', () => {
    restartButton.disabled = true
    void bridge.dshRestart().then(() => {
      restartButton.disabled = false
    })
  })

  /* ---- 更新状态渲染与动作 ---- */
  const updateLabel = (u: UpdateStatus): string => {
    const base = `当前版本：${u.currentVersion}`
    const map: Record<UpdateStatus['state'], string> = {
      idle: '　·　尚未检查更新',
      checking: '　·　正在检查…',
      unavailable: '　·　已是最新版本',
      available: `　·　发现新版本 ${u.availableVersion ?? ''}，即将后台下载`,
      downloading: `　·　正在下载 ${u.availableVersion ?? ''}（${String(u.progress ?? 0)}%）`,
      downloaded: `　·　${u.availableVersion ?? ''} 已下载完成，可安装（主界面侧边栏也有安装入口）`,
      installing: '　·　正在退出并安装…',
      error: `　·　检查失败：${u.error ?? '未知'}`,
    }
    return base + map[u.state]
  }

  const renderUpdate = (u: UpdateStatus): void => {
    updateText.textContent = updateLabel(u)
    checkButton.disabled = u.state === 'checking' || u.state === 'downloading' || u.state === 'installing'
    installButton.style.display = u.state === 'downloaded' ? '' : 'none'
    installButton.disabled = u.state === 'installing'
  }

  void bridge.updateStatus().then(renderUpdate)
  bridge.onUpdateStateChanged(renderUpdate)

  checkButton.addEventListener('click', () => {
    checkButton.disabled = true
    void bridge.updateCheck().then(renderUpdate)
  })
  installButton.addEventListener('click', () => {
    installButton.disabled = true
    void bridge.updateInstall()
  })
}
