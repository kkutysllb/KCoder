/**
 * Preload：以 contextBridge 暴露契约化的 `window.dshDesktop`。
 *
 * 只做白名单转发（通道名与 shared/ipc-contract 一一对应），
 * 不暴露 ipcRenderer 本体，不暴露 Node 能力。
 *
 * @module desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from '@shared/ipc-contract'

const bridge: DesktopBridge = {
  dshStatus: () => ipcRenderer.invoke('dsh:status'),
  dshLogs: () => ipcRenderer.invoke('dsh:logs'),
  dshStart: () => ipcRenderer.invoke('dsh:start'),
  dshRestart: () => ipcRenderer.invoke('dsh:restart'),
  upstreamStatus: () => ipcRenderer.invoke('upstream:status'),
  upstreamSync: () => ipcRenderer.invoke('upstream:sync'),
  upstreamSetup: () => ipcRenderer.invoke('upstream:setup'),
  pluginsInstalled: () => ipcRenderer.invoke('plugins:installed'),
  pluginsLatest: (names) => ipcRenderer.invoke('plugins:latest', names),
  pluginsCommunity: (query, page) => ipcRenderer.invoke('plugins:community', query, page),
  pluginAdd: (pkg) => ipcRenderer.invoke('plugins:add', pkg),
  pluginRemove: (pkg) => ipcRenderer.invoke('plugins:remove', pkg),
  pluginUpdate: (pkg) => ipcRenderer.invoke('plugins:update', pkg),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  revealPath: (path) => ipcRenderer.invoke('shell:revealPath', path),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateReleaseNotes: (version) => ipcRenderer.invoke('update:release-notes', version),
  showShell: () => ipcRenderer.invoke('shell:show'),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authRegister: (username, password) => ipcRenderer.invoke('auth:register', username, password),
  authLogin: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  landingTheme: () => ipcRenderer.invoke('theme:landing'),
  setLandingTheme: (pref) => ipcRenderer.invoke('theme:setLanding', pref),
  clipboardReadText: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard:write', text),
  terminalTabs: () => ipcRenderer.invoke('terminal:tabs'),
  terminalNew: () => ipcRenderer.invoke('terminal:new'),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalRestartTab: (id) => ipcRenderer.invoke('terminal:restart', id),
  terminalClose: (id) => ipcRenderer.invoke('terminal:close', id),
  terminalHide: () => ipcRenderer.invoke('terminal:hide'),
  terminalPanelResize: (dy) => ipcRenderer.invoke('terminal:panel-resize', dy),
  terminalTheme: () => ipcRenderer.invoke('terminal:theme'),
  preferencesGet: () => ipcRenderer.invoke('preferences:get'),
  preferencesSet: (patch) => ipcRenderer.invoke('preferences:set', patch),
  onDshStateChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: Parameters<typeof cb>[0]): void => cb(status)
    ipcRenderer.on('dsh:state-changed', listener)
    return () => ipcRenderer.removeListener('dsh:state-changed', listener)
  },
  onDshLog: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, line: Parameters<typeof cb>[0]): void => cb(line)
    ipcRenderer.on('dsh:log', listener)
    return () => ipcRenderer.removeListener('dsh:log', listener)
  },
  onUpstreamProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: Parameters<typeof cb>[0]): void => cb(p)
    ipcRenderer.on('upstream:progress', listener)
    return () => ipcRenderer.removeListener('upstream:progress', listener)
  },
  onUpdateStateChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Parameters<typeof cb>[0]): void => cb(s)
    ipcRenderer.on('update:state-changed', listener)
    return () => ipcRenderer.removeListener('update:state-changed', listener)
  },
  onTerminalData: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: string, id: number): void => cb(chunk, id)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, id: number): void => cb(id)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  onTerminalTheme: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, t: Parameters<typeof cb>[0]): void => cb(t)
    ipcRenderer.on('terminal:theme', listener)
    return () => ipcRenderer.removeListener('terminal:theme', listener)
  },
  onTerminalReset: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('terminal:reset', listener)
    return () => ipcRenderer.removeListener('terminal:reset', listener)
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
