/**
 * 应用自动更新（electron-updater）。
 *
 * 行为约定（与产品要求一致）：
 * 1. 启动后自动检测 GitHub Releases（仅打包版；dev 下优雅降级为提示）；
 * 2. 发现新版本 → **后台静默下载**（autoDownload），不打扰用户；
 * 3. 下载完成 → 状态广播 `downloaded`，shell 侧边栏出现安装按钮（见
 *    update-injector），菜单/托盘同步出现"安装并重启"；
 * 4. 用户触发安装 → 先优雅关停 dsh 侧车，再 quitAndInstall 退出、
 *    装新版本并自动重启。
 *
 * @module desktop/main/updater
 */

import { EventEmitter } from 'node:events'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { dshManager } from './dsh-manager'
import type { UpdateState, UpdateStatus } from '@shared/ipc-contract'

/** 状态广播：`state-changed` 携带最新快照（ipc.ts 转发给全部窗口）。 */
export const updateEvents = new EventEmitter()

/** 内部状态（快照的单一事实源）。 */
let state: UpdateState = 'idle'
let availableVersion: string | null = null
let progress: number | null = null
let error: string | null = null

export function updateStatus(): UpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    availableVersion,
    progress,
    error,
  }
}

function setState(next: UpdateState, patch: Partial<{ version: string | null; progress: number | null; error: string | null }> = {}): void {
  state = next
  if (patch.version !== undefined) availableVersion = patch.version
  if (patch.progress !== undefined) progress = patch.progress
  if (patch.error !== undefined) error = patch.error
  updateEvents.emit('state-changed', updateStatus())
}

/* ---------- electron-updater 事件 → 状态机 ---------- */

function wireAutoUpdater(): void {
  autoUpdater.autoDownload = true // 检测到即后台静默下载
  autoUpdater.autoInstallOnAppQuit = true // 用户忽略按钮时，退出顺手升级
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => setState('checking'))
  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version
    setState('available', { version: info.version })
    // autoDownload=true 时 electron-updater 随即开始下载，稍后进入 downloading
  })
  autoUpdater.on('update-not-available', () => setState('unavailable', { version: null }))
  autoUpdater.on('download-progress', (info) => {
    setState('downloading', { progress: Math.round(info.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState('downloaded', { version: info.version, progress: 100 })
  })
  autoUpdater.on('error', (err) => {
    setState('error', { error: err?.message ?? String(err) })
  })
}

/** 是否具备更新能力：dev（未打包）下没有 app-update.yml，只能提示。 */
function updatable(): boolean {
  return app.isPackaged
}

/** 手动/自动触发一次检测。重复调用在 checking 期间被忽略。 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updatable()) {
    setState('error', { error: '开发模式不支持自动更新（需要打包后的应用）' })
    return updateStatus()
  }
  if (state === 'checking' || state === 'downloading' || state === 'downloaded') return updateStatus()
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setState('error', { error: err instanceof Error ? err.message : String(err) })
  }
  return updateStatus()
}

/**
 * 安装已下载的更新：优雅关停 dsh 侧车 → 退出安装 → 自动重启。
 * before-quit 里的停机序列此时已是 stopped，直接放行。
 */
export async function installUpdate(): Promise<UpdateStatus> {
  if (state !== 'downloaded') return updateStatus()
  setState('installing')
  try {
    await dshManager.stop()
  } catch {
    // 安装优先：即使侧车关停异常也不阻塞升级
  }
  // isSilent=false 在 Windows 显示安装向导；macOS 直接替换重启
  autoUpdater.quitAndInstall(false, true)
  return updateStatus()
}

/** app ready 后调用：接线事件 + 延迟自动检测（避开启动竞态）。 */
export function initUpdater(): void {
  wireAutoUpdater()
  if (updatable()) {
    setTimeout(() => {
      void checkForUpdates()
    }, 8_000)
  }
}
