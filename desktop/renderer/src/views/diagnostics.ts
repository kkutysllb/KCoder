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
  restartButton.textContent = '重启引擎'

  /* ---- 应用更新卡片 ---- */
  const updateText = document.createElement('div')
  const checkButton = document.createElement('button')
  checkButton.textContent = '检查更新'
  const installButton = document.createElement('button')
  installButton.className = 'primary'
  installButton.textContent = '安装更新并重启'
  // 新版本发布说明区（GitHub Release 正文；与侧边栏下载图标悬停气泡同源）
  const notesBox = document.createElement('pre')
  notesBox.className = 'log'
  notesBox.style.display = 'none'
  notesBox.style.maxHeight = '220px'

  root.append(
    el('div', 'page', [
      el('div', 'page-header', [
        el('h1', '', '诊断'),
        el('div', 'sub', 'KCoder 引擎进程的运行状态与输出。'),
      ]),
      el('div', 'page-body', [
        el('div', 'card', [el('h2', '', '状态'), statusText, el('div', 'row', [restartButton])]),
        el('div', 'card', [el('h2', '', '应用更新'), updateText, notesBox, el('div', 'row', [checkButton, installButton])]),
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
  /** 发布说明 md → 纯文本（textContent 渲染，只去标题/引用/加粗标记，列表改·）。 */
  const mdToText = (md: string): string =>
    md
      .split('\n')
      .map((l) => {
        const t = l.replace(/^#+\s*/, '').replace(/^>\s?/, '').replace(/\*\*(.+?)\*\*/g, '$1')
        return /^[-*]\s/.test(l) ? '· ' + t.replace(/^[-*]\s/, '') : t
      })
      .join('\n')

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
    /* 新版本发布说明：发现新版本即展示（状态二次广播会随说明补齐刷新） */
    const hasNew =
      u.availableVersion !== null && (u.state === 'available' || u.state === 'downloading' || u.state === 'downloaded')
    notesBox.style.display = hasNew ? '' : 'none'
    if (!hasNew || u.availableVersion === null) return
    const v = u.availableVersion
    notesBox.dataset.version = v
    if (u.releaseNotes !== null) {
      notesBox.textContent = `── v${v} 更新内容 ──\n${mdToText(u.releaseNotes)}`
      return
    }
    notesBox.textContent = `── v${v} 更新内容：获取中… ──`
    void bridge.updateReleaseNotes(v).then((notes) => {
      if (notesBox.dataset.version !== v) return // 面板已切到别的版本，丢弃迟到结果
      notesBox.textContent =
        notes !== null ? `── v${v} 更新内容 ──\n${mdToText(notes)}` : `── v${v}：暂无更新内容（离线或该版本未发布说明） ──`
    })
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
