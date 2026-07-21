import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods on the window object
contextBridge.exposeInMainWorld('kcoder', {
  // Platform info
  platform: process.platform,

  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close')
  },

  // Send messages to main process
  send: (channel: string, ...args: unknown[]) => {
    const validChannels = ['save-settings', 'update-engine-config']
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  // IPC event listeners
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ['new-chat', 'open-settings', 'workspace-opened']
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
      }
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, callback: (...args: unknown[]) => void) => void
      off: (channel: string, callback: (...args: unknown[]) => void) => void
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
    }
  }
}
