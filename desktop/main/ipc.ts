/**
 * IPC 注册：按 desktop/shared/ipc-contract.ts 的契约实现主进程侧。
 *
 * 事件广播使用 WebContents 广播（面板窗口按需存在）；
 * invoke 处理器全部有返回值，渲染端可 await。
 *
 * @module desktop/main/ipc
 */

import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { getShellWindow, showShellWindow } from './windows'
import { dshManager } from './dsh-manager'
import { progressEvents, setupUpstream, syncUpstream, upstreamStatus } from './upstream'
import { communityPlugins, installedPlugins, runPluginCommand } from './plugins'
import { checkForUpdates, installUpdate, updateEvents, updateStatus } from './updater'
import { terminalPanel, terminalTheme } from './terminal-panel'
import { previewPanel, openInEditor } from './preview-panel'
import { fileActivity } from './file-activity'
import { refreshStyleOverlay } from './style-overlay'
import { getSettings, saveSettings } from './store'
import { readFile, stat } from 'node:fs/promises'
import type { Preferences, StyleSettings, UpstreamProgress, PreviewFileContent } from '@shared/ipc-contract'

/** preview:read-file 的文件大小上限（超出截断）。 */
const PREVIEW_FILE_LIMIT = 1_000_000

/** 偏好设置合法档位枚举（非法 patch 丢弃，防御性校验）。 */
const DENSITY_VALUES: StyleSettings['density'][] = ['compact', 'standard', 'native']
const WIDTH_VALUES: StyleSettings['contentWidth'][] = ['narrow', 'wide', 'extra']

/** 当前偏好快照（偏好设置页可读写的子集）。 */
function preferences(): Preferences {
  const s = getSettings()
  return { style: s.style, keepRunningInTray: s.keepRunningInTray }
}

/** 安装全部 IPC 处理器与事件桥。 */
export function registerIpc(): void {
  /* ---- dsh 侧车 ---- */
  ipcMain.handle('dsh:status', () => dshManager.status)
  ipcMain.handle('dsh:logs', () => dshManager.logTail)
  ipcMain.handle('dsh:start', () => {
    dshManager.start()
    return dshManager.status
  })
  ipcMain.handle('dsh:restart', () => dshManager.restart())

  /* ---- 上游仓库 ---- */
  ipcMain.handle('upstream:status', () => upstreamStatus())
  ipcMain.handle('upstream:sync', async () => {
    const result = await syncUpstream()
    if (result.ok) {
      // 同步成功 → 重启 dsh 加载新构建；就绪后自动拉起 shell 窗口
      dshManager.restart()
      dshManager.once('state-changed', (status) => {
        if (status.state === 'ready' && status.url !== null) showShellWindow(status.url)
      })
    }
    return result
  })
  ipcMain.handle('upstream:setup', () => setupUpstream())

  /* ---- 插件 ---- */
  ipcMain.handle('plugins:installed', () => installedPlugins())
  ipcMain.handle('plugins:community', () => communityPlugins())
  ipcMain.handle('plugins:add', (_event, pkg: string) => runPluginCommand(['add', pkg]))
  ipcMain.handle('plugins:remove', (_event, pkg: string) => runPluginCommand(['remove', pkg]))
  ipcMain.handle('plugins:update', (_event, pkg: string) => runPluginCommand(['update', pkg]))

  /* ---- 应用自动更新 ---- */
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())

  /* ---- 桌面动作 ---- */
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle('shell:show', (event) => {
    const url = dshManager.status.url
    if (url === null) return false
    showShellWindow(url)
    BrowserWindow.fromWebContents(event.sender)?.close()
    return true
  })
  ipcMain.handle('shell:revealPath', (_event, target: string) => {
    void shell.showItemInFolder(target)
    return Promise.resolve()
  })

  /* ---- 内嵌终端（面板视图 ↔ pty，多标签：全部动作常 id） ---- */
  ipcMain.handle('terminal:tabs', () => terminalPanel.ptyHost().list())
  ipcMain.handle('terminal:new', () => {
    const ws = terminalPanel.currentWorkspace()
    return terminalPanel.ptyHost().create(ws.path)
  })
  ipcMain.handle('terminal:write', (_event, id: number, data: string) => {
    terminalPanel.ptyHost().write(id, data)
  })
  ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminalPanel.ptyHost().resize(id, cols, rows)
  })
  ipcMain.handle('terminal:restart', (_event, id: number) => {
    const ws = terminalPanel.currentWorkspace()
    return terminalPanel.ptyHost().restart(id, ws.path)
  })
  ipcMain.handle('terminal:close', (_event, id: number) => {
    return terminalPanel.ptyHost().close(id)
  })
  ipcMain.handle('terminal:hide', () => {
    terminalPanel.hide()
  })
  ipcMain.handle('terminal:theme', () => terminalTheme())
  ipcMain.handle('terminal:panel-resize', (_event, dy: number) => {
    terminalPanel.adjustHeight(dy)
    return terminalPanel.height()
  })

  /* ---- 剪贴板（终端右键菜单复制/粘贴） ---- */
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return Promise.resolve()
  })

  /* ---- 文件预览抽屉（右侧面板：活动列表/读盘/开合/拖宽） ---- */
  ipcMain.handle('preview:entries', () => fileActivity.list())
  ipcMain.handle('preview:read-file', async (_event, path: string): Promise<PreviewFileContent> => {
    if (typeof path !== 'string' || path === '') return { ok: false, content: null, truncated: false, error: '无效路径' }
    try {
      const info = await stat(path)
      if (!info.isFile()) return { ok: false, content: null, truncated: false, error: '不是常规文件' }
      const buf = await readFile(path)
      const truncated = buf.byteLength > PREVIEW_FILE_LIMIT
      const content = (truncated ? buf.subarray(0, PREVIEW_FILE_LIMIT) : buf).toString('utf8')
      return { ok: true, content, truncated, error: null }
    } catch (error) {
      return { ok: false, content: null, truncated: false, error: String(error) }
    }
  })
  ipcMain.handle('preview:hide', () => {
    previewPanel.hide()
  })
  ipcMain.handle('preview:panel-resize', (_event, dx: number) => {
    previewPanel.adjustWidth(dx)
    return previewPanel.width()
  })
  ipcMain.handle('preview:open-editor', (_event, path: string) => {
    if (typeof path !== 'string' || path === '') return { ok: false, error: '无效路径' }
    return openInEditor(path)
  })
  ipcMain.handle('preview:mode', () => previewPanel.getMode())
  ipcMain.handle('preview:set-mode', (_event, mode: unknown) => {
    // 抽屉内切换（不强制展示）：非法值兜底回文件模式
    previewPanel.setMode(mode === 'trajectory' ? 'trajectory' : 'files', false)
  })
  ipcMain.handle('trajectory:fetch', () => fileActivity.trajectorySnapshot())
  // 活动流转发（面板视图按需消费；隐藏时视图仍在，重开即回）；
  // edit 活动同时推给 shell 页面补正文文件链接的 +n/−n 徽章。
  // 分桶后带桶键：其他工作区的后台活动不进当前视图/正文（防互串）
  fileActivity.on('activity', (entry, wsKey) => {
    if (wsKey !== fileActivity.activeKey()) return
    previewPanel.forwardActivity(entry, false)
    if (entry.kind === 'edit') {
      previewPanel.pushFileStat(entry.path, entry.added, entry.removed)
    }
  })
  // 轨迹时间线转发（预览抽屉的轨迹模式；视图隐藏时同样接收，重开即新鲜）
  fileActivity.on('trajectory', (snapshot) => {
    previewPanel.forwardTrajectory(snapshot)
  })

  /* ---- 偏好设置（样式档位/托盘保活；写后即时生效） ---- */
  ipcMain.handle('preferences:get', () => preferences())
  ipcMain.handle('preferences:set', (_event, patch: Partial<Preferences>) => {
    if (patch === null || typeof patch !== 'object') return preferences()
    const current = getSettings()
    if (patch.style !== null && typeof patch.style === 'object') {
      const p = patch.style
      const next: StyleSettings = {
        enabled: typeof p.enabled === 'boolean' ? p.enabled : current.style.enabled,
        density: DENSITY_VALUES.includes(p.density) ? p.density : current.style.density,
        contentWidth: WIDTH_VALUES.includes(p.contentWidth) ? p.contentWidth : current.style.contentWidth,
      }
      saveSettings({ style: next })
      // 样式变更 → 立即重注入 shell 窗口（不等下次整页加载）
      const w = getShellWindow()
      if (w !== null && !w.isDestroyed()) refreshStyleOverlay(w)
    }
    if (typeof patch.keepRunningInTray === 'boolean') {
      // 托盘保活是每次关窗时读 store 判定，写完即生效，无需广播
      saveSettings({ keepRunningInTray: patch.keepRunningInTray })
    }
    return preferences()
  })

  /* ---- 事件广播（面板窗口存在才有听众） ---- */
  dshManager.on('state-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('dsh:state-changed', status)
    }
  })
  dshManager.on('log', (line) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('dsh:log', line)
    }
  })
  progressEvents.on('progress', (progress: UpstreamProgress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('upstream:progress', progress)
    }
  })
  updateEvents.on('state-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:state-changed', status)
    }
  })
}
