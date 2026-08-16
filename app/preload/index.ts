import { contextBridge, ipcRenderer, type OpenDialogOptions } from 'electron'

// Expose protected methods on the window object
contextBridge.exposeInMainWorld('kcoder', {
  // Platform info
  platform: process.platform,

  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    // Toggle maximize/restore — used by the landing page's double-click-on-header.
    // Returns the new maximized state.
    toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize') as Promise<boolean>,
    // Query current maximized state (for UI affordance sync).
    isMaximized: () => ipcRenderer.invoke('window-is-maximized') as Promise<boolean>
  },

  // Send messages to main process
  send: (channel: string, ...args: unknown[]) => {
    const validChannels = ['save-settings', 'tray:update-locale']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  // Restart the Python sidecar engine (stop → start with fresh config).
  // Returns new { port, token } so the renderer can update its API client.
  restartEngine: () =>
    ipcRenderer.invoke('engine:restart') as Promise<{ port: number; token: string }>,

  // Product-side model management (drives the engine's UserDataStore).
  // The new engine exposes no HTTP model CRUD; the product owns this.
  // userId is the authenticated user's id — required so profiles resolve
  // against the same user that owns the threads.
  models: {
    list: (userId: string) => ipcRenderer.invoke('model:list', userId) as Promise<unknown>,
    save: (userId: string, name: string, profile: unknown) =>
      ipcRenderer.invoke('model:save', userId, name, profile) as Promise<void>,
    delete: (userId: string, name: string) =>
      ipcRenderer.invoke('model:delete', userId, name) as Promise<void>,
    activate: (userId: string, name: string) =>
      ipcRenderer.invoke('model:activate', userId, name) as Promise<void>,
    discover: (input: unknown) => ipcRenderer.invoke('model:discover', input) as Promise<unknown>
  },

  // IPC event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['new-chat', 'open-settings', 'workspace-opened', 'window-state-changed', 'engine:restarted']
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.removeListener(channel, callback)
  },

  // PTY terminal API
  terminal: {
    create: (options?: { cwd?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', options) as Promise<{
        id: string
        shell: string
        name: string
        cwd: string
      }>,
    write: (id: string, data: string) => ipcRenderer.send('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id) as Promise<void>,
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_event: unknown, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => {
        ipcRenderer.removeListener('terminal:data', handler)
      }
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_event: unknown, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', handler)
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler)
      }
    }
  },

  // Folder / file picker dialog API
  dialog: {
    openFolder: (options?: OpenDialogOptions) =>
      ipcRenderer.invoke('dialog:openFolder', options) as Promise<string | null>,
    openFile: (options?: OpenDialogOptions) =>
      ipcRenderer.invoke('dialog:openFile', options) as Promise<string | null>,
    /** 在 Finder/资源管理器中显示路径（目录打开，文件定位高亮）。 */
    showInFolder: (targetPath: string) =>
      ipcRenderer.invoke('dialog:showInFolder', targetPath) as Promise<void>
  },

  // Sub-agents: sub_agents.json CRUD + config.yaml re-sync（主进程读写并注入 custom_agents）。
  syncSubAgents: () => ipcRenderer.invoke('sub-agents:sync') as Promise<void>,
  subAgents: {
    list: () =>
      ipcRenderer.invoke('sub-agents:list') as Promise<{ settings: Record<string, unknown>; subAgents: unknown[] }>,
    create: (payload: unknown) => ipcRenderer.invoke('sub-agents:create', payload) as Promise<unknown>,
    delete: (id: string) => ipcRenderer.invoke('sub-agents:delete', id) as Promise<void>,
    updateSettings: (settings: unknown) =>
      ipcRenderer.invoke('sub-agents:update-settings', settings) as Promise<void>,
    sync: () => ipcRenderer.invoke('sub-agents:sync') as Promise<void>
  },
  // 项目注册表（产品层，主进程 projects.json）
  projects: {
    list: () => ipcRenderer.invoke('projects:list') as Promise<{ projects: unknown[] }>,
    create: (path: string, name?: string, options?: { silentMissing?: boolean }) =>
      ipcRenderer.invoke('projects:create', path, name, options) as Promise<unknown>,
    update: (projectId: string, patch: unknown) =>
      ipcRenderer.invoke('projects:update', projectId, patch) as Promise<unknown>,
    delete: (projectId: string) =>
      ipcRenderer.invoke('projects:delete', projectId) as Promise<unknown>
  },

  // 产品级本地服务（2026-08 重构）：runtime-config / token-usage / workspace git。
  // 自研 gateway 删除后由主进程 + python-runtime/product_services.py 提供。
  local: {
    runtimeConfig: {
      get: (section?: string) =>
        ipcRenderer.invoke('local:runtime-config-get', section) as Promise<unknown>,
      set: (section: string, value: Record<string, unknown>) =>
        ipcRenderer.invoke('local:runtime-config-set', section, value) as Promise<unknown>
    },
    tokenUsage: {
      stats: (year?: number, month?: number) =>
        ipcRenderer.invoke('local:token-usage-stats', year, month) as Promise<unknown>,
      timeseries: (days?: number) =>
        ipcRenderer.invoke('local:token-usage-timeseries', days) as Promise<unknown>
    },
    git: {
      status: (repo: string) => ipcRenderer.invoke('local:git-status', repo) as Promise<unknown>,
      createBranch: (repo: string, name: string) =>
        ipcRenderer.invoke('local:git-branch-create', repo, name) as Promise<unknown>,
      commit: (repo: string, message: string) =>
        ipcRenderer.invoke('local:git-commit', repo, message) as Promise<unknown>,
      push: (repo: string) => ipcRenderer.invoke('local:git-push', repo) as Promise<unknown>,
      branches: (repo: string) =>
        ipcRenderer.invoke('local:git-branches', repo) as Promise<unknown>,
      log: (repo: string, n?: number) =>
        ipcRenderer.invoke('local:git-log', repo, n) as Promise<unknown>,
      repoExists: (repo: string) =>
        ipcRenderer.invoke('local:repo-exists', repo) as Promise<boolean>
    },
    fs: {
      tree: (path: string) => ipcRenderer.invoke('local:ws-tree', path) as Promise<unknown>,
      files: (path: string) => ipcRenderer.invoke('local:ws-files', path) as Promise<unknown>,
      read: (path: string) => ipcRenderer.invoke('local:ws-read', path) as Promise<unknown>,
      write: (path: string, content: string) =>
        ipcRenderer.invoke('local:ws-write', path, content) as Promise<unknown>,
      fileType: (path: string) => ipcRenderer.invoke('local:ws-type', path) as Promise<unknown>,
      revert: (workspace: string, path: string, status: string) =>
        ipcRenderer.invoke('local:ws-revert', workspace, path, status) as Promise<unknown>
    }
  }
})

// Type declaration for the exposed API
declare global {
  interface Window {
    kcoder: {
      platform: NodeJS.Platform
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        toggleMaximize: () => Promise<boolean>
        isMaximized: () => Promise<boolean>
      }
      send: (channel: string, ...args: unknown[]) => void
      /** Restart the Python sidecar engine, returns new port + token. */
      restartEngine: () => Promise<{ port: number; token: string }>
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
      models: {
        list: (userId: string) => Promise<unknown>
        save: (userId: string, name: string, profile: unknown) => Promise<void>
        delete: (userId: string, name: string) => Promise<void>
        activate: (userId: string, name: string) => Promise<void>
        discover: (input: unknown) => Promise<unknown>
      }
      terminal: {
        create: (options?: { cwd?: string; cols?: number; rows?: number }) => Promise<{
          id: string
          shell: string
          name: string
          cwd: string
        }>
        write: (id: string, data: string) => void
        resize: (id: string, cols: number, rows: number) => void
        kill: (id: string) => Promise<void>
        onData: (callback: (id: string, data: string) => void) => () => void
        onExit: (callback: (id: string, exitCode: number) => void) => () => void
      }
      dialog: {
        openFolder: (options?: OpenDialogOptions) => Promise<string | null>
        openFile: (options?: OpenDialogOptions) => Promise<string | null>
        showInFolder: (targetPath: string) => Promise<void>
      }
      syncSubAgents: () => Promise<void>
      subAgents: {
        list: () => Promise<{ settings: Record<string, unknown>; subAgents: unknown[] }>
        create: (payload: unknown) => Promise<unknown>
        delete: (id: string) => Promise<void>
        updateSettings: (settings: unknown) => Promise<void>
        sync: () => Promise<void>
      }
      projects: {
        list: () => Promise<{ projects: unknown[] }>
        create: (path: string, name?: string, options?: { silentMissing?: boolean }) => Promise<unknown>
        update: (projectId: string, patch: unknown) => Promise<unknown>
        delete: (projectId: string) => Promise<unknown>
      }
      local: {
        runtimeConfig: {
          get: (section?: string) => Promise<unknown>
          set: (section: string, value: Record<string, unknown>) => Promise<unknown>
        }
        tokenUsage: {
          stats: (year?: number, month?: number) => Promise<unknown>
          timeseries: (days?: number) => Promise<unknown>
        }
        git: {
          status: (repo: string) => Promise<unknown>
          createBranch: (repo: string, name: string) => Promise<unknown>
          commit: (repo: string, message: string) => Promise<unknown>
          push: (repo: string) => Promise<unknown>
          branches: (repo: string) => Promise<unknown>
          log: (repo: string, n?: number) => Promise<unknown>
          repoExists: (repo: string) => Promise<boolean>
        }
        fs: {
          tree: (path: string) => Promise<unknown>
          files: (path: string) => Promise<unknown>
          read: (path: string) => Promise<unknown>
          write: (path: string, content: string) => Promise<unknown>
          fileType: (path: string) => Promise<unknown>
          revert: (workspace: string, path: string, status: string) => Promise<unknown>
        }
      }
    }
  }
}
