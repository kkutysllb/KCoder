/**
 * IPC 注册：按 desktop/shared/ipc-contract.ts 的契约实现主进程侧。
 *
 * 事件广播使用 WebContents 广播（面板窗口按需存在）；
 * invoke 处理器全部有返回值，渲染端可 await。
 *
 * @module desktop/main/ipc
 */

import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { getShellWindow, logoutToLanding, showShellWindow } from './windows'
import { authLogin, authLoggedIn, authRegister, authStatus } from './auth'
import { applyLandingTheme, currentLandingTheme } from './theme-watcher'
import { dshManager } from './dsh-manager'
import { progressEvents, setupUpstream, syncUpstream, upstreamStatus } from './upstream'
import { communityPlugins, installedPlugins, latestVersions, runPluginCommand, updatePlugin } from './plugins'
import { checkForUpdates, getReleaseNotes, installUpdate, updateEvents, updateStatus } from './updater'
import { refreshStyleOverlay } from './style-overlay'
import { getSettings, saveSettings } from './store'
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
  // 统一更新入口（主进程按包属选路）：内置可更新层走 add <pkg>@latest
  // （物化 bundle 不在 deps，pnpm update 无从谈起），用户插件走
  // update --latest。--latest 必须显式：pnpm update 遵守 package.json
  // 范围，而 0.x 包的 ^ 只允许 patch 级（^0.12.2 不含 0.13.0）——不加会在
  // 范围内空转成功，版本纹丝不动（v0.1.9 mac 点击“更新”显示成功但仍
  // 提示更新的根因）
  ipcMain.handle('plugins:update', (_event, pkg: string) => updatePlugin(pkg))

  /* ---- 应用自动更新 ---- */
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:release-notes', (_e, version: string) => getReleaseNotes(version))

  /* ---- 桌面动作 ---- */
  // 外链门禁：未登录一律拒绝跳转（landing 停留语义）；已登录仅放行
  // http(s)，其余协议（file:/自定义）不交系统
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (!authLoggedIn() || !/^https?:\/\//.test(url)) return Promise.resolve()
    void shell.openExternal(url)
    return Promise.resolve()
  })
  ipcMain.handle('shell:show', (event) => {
    const url = dshManager.status.url
    // 门禁：未登录拒开工作台（showShellWindow 内部同款兑底，双保险）
    if (url === null || !authLoggedIn()) return false
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

  /* git 面板 IPC 已退役（2026-08）：@kkutysllb/dsh-git-panel 插件自带
   * webServer RPC（/dsh-git-panel/api/snapshot|open-plan）替代。 */

  /* 内嵌终端 IPC 已退役（2026-08）：@kkutysllb/dsh-terminal 插件自带
   * webServer RPC（/dsh-terminal/api/rpc + SSE 输出流）替代。 */

  /* ---- 本地账户鉴权（门禁数据源；登出连带窗口收场） ---- */
  ipcMain.handle('auth:status', () => authStatus())
  ipcMain.handle('auth:register', (_event, username: unknown, password: unknown) =>
    authRegister(username, password))
  ipcMain.handle('auth:login', (_event, username: unknown, password: unknown) =>
    authLogin(username, password))
  ipcMain.handle('auth:logout', () => {
    // 登出收场：收起并卸载工作台（windows.logoutToLanding，内部完成
    // authLogout）+ landing 回到登录表单（workspace 菜单的
    // kcoder://auth-logout 拦截路径直调同款函数，两路行为一致）
    logoutToLanding()
    return { ok: true, error: null, status: authStatus() }
  })

  /* ---- landing 页面主题（三态循环按钮；与上游解耦，独立持久化） ---- */
  ipcMain.handle('theme:landing', () => currentLandingTheme())
  ipcMain.handle('theme:setLanding', (_event, pref: unknown) => {
    if (pref !== 'system' && pref !== 'light' && pref !== 'dark') return currentLandingTheme()
    applyLandingTheme(pref)
    return currentLandingTheme()
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
