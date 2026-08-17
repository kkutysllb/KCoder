/**
 * 原生应用菜单 + 托盘。
 *
 * 菜单动作只覆盖桌面壳自身（重载 UI、面板、更新、退出）；不试图为上游
 * Web UI 提供业务菜单——那是上游插件树的领域。
 *
 * 更新相关项（应用菜单"检查更新"、托盘同项）随 updater 状态动态重建：
 * downloaded 时变为"安装更新并重启"，点击即退出安装。
 *
 * @module desktop/main/menu
 */

import { app, Menu, Tray, nativeImage, shell, type MenuItemConstructorOptions } from 'electron'
import { dshManager } from './dsh-manager'
import { resolveAsset } from './dsh-contract'
import { checkForUpdates, installUpdate, updateEvents, updateStatus } from './updater'
import { terminalPanel } from './terminal-panel'
import { getShellWindow, openPanel, showShellWindow } from './windows'
import type { UpdateStatus } from '@shared/ipc-contract'

let tray: Tray | null = null

/** 项目仓库/文档链接（帮助菜单与托盘共用）。 */
const REPO_URL = 'https://github.com/kkutysllb/KCoder'
const DSH_DOCS_URL = 'https://github.com/deepseek-ai/deepseek-harness'

/** 更新状态 → 菜单项形态。 */
function updateMenuItem(): MenuItemConstructorOptions {
  const s = updateStatus()
  switch (s.state) {
    case 'checking':
      return { label: '正在检查更新…', enabled: false }
    case 'available':
    case 'downloading':
      return {
        label: `正在下载更新 ${s.availableVersion ?? ''} ${s.progress !== null ? `(${s.progress}%)` : ''}`.trim(),
        enabled: false,
      }
    case 'downloaded':
      return {
        label: `安装更新 ${s.availableVersion ?? ''} 并重启`,
        click: () => void installUpdate(),
      }
    case 'installing':
      return { label: '正在安装更新…', enabled: false }
    default:
      // idle / unavailable / error：点击即（重新）检测
      return { label: '检查更新…', click: () => void checkForUpdates() }
  }
}

/** dsh 侧车状态 → 托盘 tooltip 后缀。 */
function dshTooltip(): string {
  const dsh = dshManager.status
  const upd = updateStatus()
  const dshPart =
    dsh.state === 'ready' ? '运行中' : dsh.state === 'starting' || dsh.state === 'restarting' ? '启动中' : '已停止'
  const updPart = upd.state === 'downloaded' ? ` · 新版本 ${upd.availableVersion} 待安装` : ''
  return `KCoder（dsh ${dshPart}${updPart}）`
}

/** 构建并安装应用菜单；更新状态变化时可重复调用以重建。 */
export function installMenu(): void {
  const shellWindow = (): Electron.BrowserWindow | null => getShellWindow()
  const focusShell = (): void => {
    const url = dshManager.status.url
    if (url !== null) showShellWindow(url)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'KCoder',
      submenu: [
        {
          label: '关于 KCoder',
          click: () => {
            app.setAboutPanelOptions({
              applicationName: 'KCoder',
              applicationVersion: app.getVersion(),
              credits: 'DeepSeek Harness 桌面端 · 图标 © DeepSeek',
              website: REPO_URL,
            })
            app.showAboutPanel()
          },
        },
        updateMenuItem(),
        { type: 'separator' },
        {
          label: '偏好设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => openPanel('preferences', '偏好设置 · KCoder'),
        },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: '退出（同时停止 dsh）',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '文件',
      submenu: [
        {
          label: '新建会话',
          accelerator: 'CmdOrCtrl+N',
          click: focusShell,
        },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重载 Web UI',
          accelerator: 'CmdOrCtrl+R',
          click: () => shellWindow()?.webContents.reload(),
        },
        {
          label: '重启 dsh 服务',
          click: () => dshManager.restart(),
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '工具',
      submenu: [
        {
          label: '偏好设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => openPanel('preferences', '偏好设置 · KCoder'),
        },
        {
          label: '切换内嵌终端',
          accelerator: 'Control+`',
          click: () => {
            const w = getShellWindow()
            if (w !== null && !w.isDestroyed()) w.show()
            terminalPanel.toggle()
          },
        },
        { type: 'separator' },
        {
          label: '设置（上游初始化）…',
          click: () => openPanel('setup', '设置 · KCoder'),
        },
        {
          label: '诊断…',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => openPanel('diagnostics', '诊断 · KCoder'),
        },
        { type: 'separator' },
        {
          label: '同步上游仓库…',
          click: () => openPanel('sync', '同步上游 · KCoder'),
        },
        {
          label: '插件管理…',
          click: () => openPanel('plugins', '插件 · KCoder'),
        },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'front', label: '全部置于前台' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'KCoder 仓库',
          click: () => void shell.openExternal(REPO_URL),
        },
        {
          label: 'DeepSeek Harness 文档',
          click: () => void shell.openExternal(DSH_DOCS_URL),
        },
        {
          label: '社区插件（dsh-plugin）',
          click: () => void shell.openExternal('https://github.com/topics/dsh-plugin'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 安装托盘；重复调用仅刷新菜单与 tooltip（供状态变化时重建）。 */
export function installTray(): void {
  // 官方 DeepSeek 鲸鱼托盘图标（开发/打包路径由 dsh-contract 统一解析）。
  // macOS 用模板图（黑色形状 + alpha，系统自动适配深/浅菜单栏——
  // 原浅紫色在浅色菜单栏对比度不足）；Windows/Linux 任务栏支持彩色，
  // 保持原图。
  if (tray === null) {
    const isMac = process.platform === 'darwin'
    const image = nativeImage.createFromPath(resolveAsset(isMac ? 'trayTemplate.png' : 'tray.png'))
    if (isMac) image.setTemplateImage(true)
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }))
    tray.on('click', () => {
      const url = dshManager.status.url
      if (url !== null) showShellWindow(url)
    })
  }
  tray.setToolTip(dshTooltip())
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        const url = dshManager.status.url
        if (url !== null) showShellWindow(url)
      },
    },
    { type: 'separator' },
    {
      label: '偏好设置…',
      click: () => openPanel('preferences', '偏好设置 · KCoder'),
    },
    {
      label: '设置（上游初始化）…',
      click: () => openPanel('setup', '设置 · KCoder'),
    },
    {
      label: '同步上游仓库…',
      click: () => openPanel('sync', '同步上游 · KCoder'),
    },
    {
      label: '插件管理…',
      click: () => openPanel('plugins', '插件 · KCoder'),
    },
    {
      label: '诊断…',
      click: () => openPanel('diagnostics', '诊断 · KCoder'),
    },
    { type: 'separator' },
    updateMenuItem(),
    { type: 'separator' },
    {
      label: '退出（同时停止 dsh）',
      click: () => app.quit(),
    },
  ])
  tray.setContextMenu(contextMenu)
}

/** 一次性接线：dsh/更新状态变化 → 重建菜单与托盘（幂等）。 */
let wired = false
export function wireMenuRefresh(): void {
  if (wired) return
  wired = true
  dshManager.on('state-changed', () => installTray())
  updateEvents.on('state-changed', () => {
    installMenu()
    installTray()
  })
}
