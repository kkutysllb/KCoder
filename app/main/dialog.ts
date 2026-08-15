import { existsSync, statSync } from 'fs'
import { ipcMain, BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron'

/**
 * 注册文件/文件夹选择对话框的 IPC 处理器。
 * 渲染进程通过 window.kcoder.dialog.openFolder() 触发原生选择器。
 */
export function setupDialogIPC(getWindow: () => BrowserWindow | null): void {
  // 在 Finder（macOS）/ 资源管理器（Windows）中显示路径。
  // 目录直接打开；文件定位并高亮。
  ipcMain.handle('dialog:showInFolder', (_event, targetPath: string) => {
    if (!targetPath || typeof targetPath !== 'string') return
    try {
      if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
        shell.openPath(targetPath)
      } else {
        shell.showItemInFolder(targetPath)
      }
    } catch {
      // 路径失效等 — 静默（不阻断 UI）
    }
  })

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
