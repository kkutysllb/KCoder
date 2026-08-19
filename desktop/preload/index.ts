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
  showShell: () => ipcRenderer.invoke('shell:show'),
  terminalTabs: () => ipcRenderer.invoke('terminal:tabs'),
  terminalNew: () => ipcRenderer.invoke('terminal:new'),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalRestartTab: (id) => ipcRenderer.invoke('terminal:restart', id),
  terminalClose: (id) => ipcRenderer.invoke('terminal:close', id),
  terminalHide: () => ipcRenderer.invoke('terminal:hide'),
  terminalPanelResize: (dy) => ipcRenderer.invoke('terminal:panel-resize', dy),
  terminalTheme: () => ipcRenderer.invoke('terminal:theme'),
  clipboardReadText: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWriteText: (text) => ipcRenderer.invoke('clipboard:write', text),
  previewEntries: () => ipcRenderer.invoke('preview:entries'),
  previewReadFile: (path) => ipcRenderer.invoke('preview:read-file', path),
  previewHide: () => ipcRenderer.invoke('preview:hide'),
  previewPanelResize: (dx) => ipcRenderer.invoke('preview:panel-resize', dx),
  previewOpenEditor: (path) => ipcRenderer.invoke('preview:open-editor', path),
  previewMode: () => ipcRenderer.invoke('preview:mode'),
  previewSetMode: (mode) => ipcRenderer.invoke('preview:set-mode', mode),
  trajectoryFetch: () => ipcRenderer.invoke('trajectory:fetch'),
  gitSnapshot: () => ipcRenderer.invoke('git:snapshot'),
  gitRefresh: () => ipcRenderer.invoke('git:refresh'),
  gitFetch: () => ipcRenderer.invoke('git:fetch'),
  gitCommit: (message) => ipcRenderer.invoke('git:commit', message),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitBranchSwitch: (name) => ipcRenderer.invoke('git:branch-switch', name),
  gitBranchCreate: (name, base) => ipcRenderer.invoke('git:branch-create', name, base),
  gitHide: () => ipcRenderer.invoke('git:hide'),
  gitOpenPlan: (path) => ipcRenderer.invoke('git:open-plan', path),
  gitSubagents: () => ipcRenderer.invoke('git:subagents'),
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
  onTerminalReset: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('terminal:reset', listener)
    return () => ipcRenderer.removeListener('terminal:reset', listener)
  },
  onTerminalTheme: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, t: Parameters<typeof cb>[0]): void => cb(t)
    ipcRenderer.on('terminal:theme', listener)
    return () => ipcRenderer.removeListener('terminal:theme', listener)
  },
  onPreviewActivity: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, entry: Parameters<typeof cb>[0], focus: boolean): void => cb(entry, focus)
    ipcRenderer.on('preview:activity', listener)
    return () => ipcRenderer.removeListener('preview:activity', listener)
  },
  onPreviewRefresh: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('preview:refresh', listener)
    return () => ipcRenderer.removeListener('preview:refresh', listener)
  },
  onPreviewMode: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, m: Parameters<typeof cb>[0]): void => cb(m)
    ipcRenderer.on('preview:mode-changed', listener)
    return () => ipcRenderer.removeListener('preview:mode-changed', listener)
  },
  onTrajectoryUpdate: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Parameters<typeof cb>[0]): void => cb(s)
    ipcRenderer.on('trajectory:update', listener)
    return () => ipcRenderer.removeListener('trajectory:update', listener)
  },
  onGitSnapshot: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Parameters<typeof cb>[0]): void => cb(s)
    ipcRenderer.on('git:changed', listener)
    return () => ipcRenderer.removeListener('git:changed', listener)
  },
  onGitSubagents: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, list: Parameters<typeof cb>[0]): void => cb(list)
    ipcRenderer.on('subagents:changed', listener)
    return () => ipcRenderer.removeListener('subagents:changed', listener)
  },
}

contextBridge.exposeInMainWorld('dshDesktop', bridge)
