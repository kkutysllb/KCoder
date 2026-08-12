import { ipcMain, BrowserWindow, dialog, type OpenDialogOptions } from 'electron'

/**
 * 注册文件/文件夹选择对话框的 IPC 处理器。
 * 渲染进程通过 window.kcoder.dialog.openFolder() 触发原生选择器。
 */
export function setupDialogIPC(getWindow: () => BrowserWindow | null): void {
  // 选择文件夹 — 返回选中路径，取消返回 null
  ipcMain.handle('dialog:openFolder', async (_event, options?: OpenDialogOptions) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      ...options
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  // 选择文件 — 返回选中文件路径，取消返回 null
  ipcMain.handle('dialog:openFile', async (_event, options?: OpenDialogOptions) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      ...options
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })
}
