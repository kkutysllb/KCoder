import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'

export function setupMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings...',
                accelerator: 'CmdOrCtrl+,',
                click: () => {
                  mainWindow.webContents.send('open-settings')
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('new-chat')
          }
        },
        {
          label: 'Open Workspace...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('workspace-opened', result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About KCoder',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              title: 'About KCoder',
              message: 'KCoder',
              detail: 'Agent-driven coding desktop app\nPowered by QiongQi Engine\n\nVersion 0.1.0'
            })
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)
}
