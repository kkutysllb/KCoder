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
    }
  }
}
