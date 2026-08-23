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
import { communityPlugins, installedPlugins, latestVersions, runPluginCommand } from './plugins'
import { checkForUpdates, installUpdate, updateEvents, updateStatus } from './updater'
import { refreshStyleOverlay } from './style-overlay'
import { getSettings, saveSettings } from './store'
import { terminalPanel, terminalTheme } from './terminal-panel'
import { gitPanel } from './git-panel'
import type { Preferences, StyleSettings, UpstreamProgress } from '@shared/ipc-contract'

/** 偏好设置合法档位枚举（非法 patch 丢弃，防御性校验）。 */
const DENSITY_VALUES: StyleSettings['density'][] = ['compact', 'standard', 'native']
const WIDTH_VALUES: StyleSettings['contentWidth'][] = ['narrow', 'wide', 'extra']
/** 自定义正文字号合法域：'auto' 或 12–20 整数。 */
function validFontSize(v: unknown): v is StyleSettings['fontSize'] {
  if (v === 'auto') return true
  return typeof v === 'number' && Number.isInteger(v) && v >= 12 && v <= 20
}

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
  ipcMain.handle('plugins:latest', (_event, names: string[]) => latestVersions(names))
  ipcMain.handle('plugins:community', (_event, query?: string, page?: number) => communityPlugins(query, page))
  ipcMain.handle('plugins:add', (_event, pkg: string) => runPluginCommand(['add', pkg]))
  ipcMain.handle('plugins:remove', (_event, pkg: string) => runPluginCommand(['remove', pkg]))
  // --latest 必须显式：pnpm update 遵守 package.json 范围，而 0.x 包的
  // ^ 只允许 patch 级（^0.12.2 不含 0.13.0）——不加会在范围内空转
  // 成功，版本纹丝不动（v0.1.9 mac 点击“更新”显示成功但仍提示更新的根因）
  ipcMain.handle('plugins:update', (_event, pkg: string) => runPluginCommand(['update', '--latest', pkg]))

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

  /* ---- 剪贴板 ---- */
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return Promise.resolve()
  })

  /* ---- git 环境面板（右侧浮动卡片；探测与写操作主进程串行） ---- */
  ipcMain.handle('git:snapshot', () => gitPanel.current())
  ipcMain.handle('git:refresh', () => gitPanel.refresh())
  ipcMain.handle('git:fetch', () => gitPanel.fetch())
  ipcMain.handle('git:commit', (_event, message: unknown) =>
    gitPanel.commit(typeof message === 'string' ? message : ''))
  ipcMain.handle('git:push', () => gitPanel.push())
  ipcMain.handle('git:branch-switch', (_event, name: unknown) =>
    gitPanel.switchBranch(typeof name === 'string' ? name : ''))
  ipcMain.handle('git:branch-create', (_event, name: unknown, base: unknown) =>
    gitPanel.createBranch(
      typeof name === 'string' ? name : '',
      typeof base === 'string' ? base : null,
    ))
  ipcMain.handle('git:hide', () => {
    gitPanel.hide(true)
    return Promise.resolve()
  })
  ipcMain.handle('git:open-plan', (_event, path: unknown) => {
    const target = typeof path === 'string' ? path : ''
    // 只放行快照里见过的计划文档路径（防任意路径打开）
    const known = gitPanel.current().plans.some(p => p.path === target)
    if (known) gitPanel.openPlan(target)
    return Promise.resolve()
  })
  ipcMain.handle('git:subagents', () => gitPanel.subagents())

  /* ---- 内嵌终端（面板视图 ↔ pty，多标签：每个工作区一份私有桶）
   * 调用方工作区 = event.sender 所属 view 的 workspace（不是
   * currentWorkspace，否则 B view 调用 close(id) 会被当作 A 桶操作；
   * 按 view 反查保证调用方只能操作自己工作区桶内的 session）。 */
  ipcMain.handle('terminal:tabs', (event) => {
    const bucket = terminalPanel.bucketOfWebContentsId(event.sender.id)
    return terminalPanel.ptyHost().list(bucket)
  })
  ipcMain.handle('terminal:new', (event) => {
    const bucket = terminalPanel.bucketOfWebContentsId(event.sender.id)
    return terminalPanel.ptyHost().create(bucket)
  })
  ipcMain.handle('terminal:write', (_event, id: number, data: string) => {
    terminalPanel.ptyHost().write(id, data)
  })
  ipcMain.handle('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminalPanel.ptyHost().resize(id, cols, rows)
  })
  ipcMain.handle('terminal:restart', (event, id: number) => {
    const bucket = terminalPanel.bucketOfWebContentsId(event.sender.id)
    return terminalPanel.ptyHost().restart(id, bucket)
  })
  ipcMain.handle('terminal:close', (event, id: number) => {
    const bucket = terminalPanel.bucketOfWebContentsId(event.sender.id)
    return terminalPanel.ptyHost().close(id, bucket)
  })
  ipcMain.handle('terminal:hide', (event) => {
    // 关闭"调用方所在工作区"的面板可见性，不影响其他工作区
    const bucket = terminalPanel.bucketOfWebContentsId(event.sender.id)
    terminalPanel.hide(bucket)
  })
  ipcMain.handle('terminal:theme', () => terminalTheme())
  ipcMain.handle('terminal:panel-resize', (_event, dy: number) => {
    terminalPanel.adjustHeight(dy)
    return terminalPanel.height()
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
        fontSize: validFontSize(p.fontSize) ? p.fontSize : current.style.fontSize,
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
