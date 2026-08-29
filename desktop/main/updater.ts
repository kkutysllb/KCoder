/**
 * 应用自动更新（electron-updater）。
 *
 * 行为约定（与产品要求一致）：
 * 1. 启动后自动检测 GitHub Releases（仅打包版；dev 下优雅降级为提示）；
 * 2. 发现新版本 → **后台静默下载**（autoDownload），不打扰用户；
 *    同时异步拉取该版本发布说明（GitHub Release 正文，约定见
 *    release/README.md）——下载图标悬停气泡与诊断面板展示；
 * 3. 下载完成 → 状态广播 `downloaded`，shell 侧边栏安装按钮保持展示（见
 *    update-injector），菜单/托盘同步出现"安装并重启"；
 * 4. 用户触发安装 → 先优雅关停 dsh 侧车，再 quitAndInstall 退出、
 *    装新版本并自动重启。
 *
 * @module desktop/main/updater
 */

import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater, type Logger } from 'electron-updater'
import { dshManager } from './dsh-manager'
import type { UpdateState, UpdateStatus } from '@shared/ipc-contract'

/** 状态广播：`state-changed` 携带最新快照（ipc.ts 转发给全部窗口）。 */
export const updateEvents = new EventEmitter()

/** 内部状态（快照的单一事实源）。 */
let state: UpdateState = 'idle'
let availableVersion: string | null = null
let progress: number | null = null
let error: string | null = null
let releaseNotes: string | null = null

export function updateStatus(): UpdateStatus {
  return {
    state,
    currentVersion: app.getVersion(),
    availableVersion,
    progress,
    error,
    releaseNotes,
  }
}

function setState(next: UpdateState, patch: Partial<{ version: string | null; progress: number | null; error: string | null }> = {}): void {
  state = next
  if (patch.version !== undefined) availableVersion = patch.version
  if (patch.progress !== undefined) progress = patch.progress
  if (patch.error !== undefined) error = patch.error
  updateEvents.emit('state-changed', updateStatus())
}

/* ---------- 更新日志：electron-updater 内部事件落盘（排查有据） ---------- */

let updaterLogStream: ReturnType<typeof createWriteStream> | null = null

function updaterLog(level: 'info' | 'warn' | 'error' | 'debug', message?: unknown): void {
  try {
    if (updaterLogStream === null) {
      // 首次写日志时才解析 DSH_HOME（用户显式设置时从之，否则上游
      // 默认 ~/.dsh——与 dshHome() 同步；不走其引用避免循环依赖）
      const logDir = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'logs')
      mkdirSync(logDir, { recursive: true })
      updaterLogStream = createWriteStream(join(logDir, 'updater.log'), { flags: 'a' })
    }
    const text = typeof message === 'string' ? message : JSON.stringify(message) ?? String(message)
    updaterLogStream.write(`[${new Date().toISOString()}] [${level}] ${text}\n`)
  } catch {
    // 日志失败不阻塞更新链路
  }
}

/* ---------- electron-updater 事件 → 状态机 ---------- */

function wireAutoUpdater(): void {
  autoUpdater.autoDownload = true // 检测到即后台静默下载
  autoUpdater.autoInstallOnAppQuit = true // 用户忽略按钮时，退出顺手升级
  // 不设 null：electron-updater 默认 console 直出会污染主进程 stdout，
  // 而 null 又让生产事故零日志（此前排查全靠 ShipIt 日志）——改落盘
  autoUpdater.logger = {
    info: (m?: unknown) => updaterLog('info', m),
    warn: (m?: unknown) => updaterLog('warn', m),
    error: (m?: unknown) => updaterLog('error', m),
    debug: (m: string) => updaterLog('debug', m),
  } satisfies Logger

  autoUpdater.on('checking-for-update', () => setState('checking'))
  autoUpdater.on('update-available', (info) => {
    availableVersion = info.version
    releaseNotes = null
    setState('available', { version: info.version })
    // autoDownload=true 时 electron-updater 随即开始下载，稍后进入 downloading
    // 发布说明异步补齐（不阻塞状态机）：到位后再广播一次，气泡/诊断面板刷新。
    void getReleaseNotes(info.version).then((notes) => {
      if (availableVersion !== info.version) return // 版本已切换，丢弃迟到结果
      releaseNotes = notes
      updateEvents.emit('state-changed', updateStatus())
    })
  })
  autoUpdater.on('update-not-available', () => {
    releaseNotes = null
    setState('unavailable', { version: null })
  })
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

/* ---------- 发布说明：GitHub Release 正文（更新内容的唯一展示源） ---------- */

/** 按版本缓存（含失败结果，防重复轰炸；进程内生效，重启重拉）。 */
const notesCache = new Map<string, string | null>()

/** GitHub 拉取超时（毫秒）。 */
const NOTES_TIMEOUT_MS = 8_000

/**
 * 拉取指定版本的发布说明（GitHub Release 正文，仓内约定见 release/README.md）。
 * 失败（无网络/无该版本 release）返回 null，消费端降级为“版本可用”提示。
 */
export async function getReleaseNotes(version: string): Promise<string | null> {
  const v = version.replace(/^v/, '')
  if (notesCache.has(v)) return notesCache.get(v) ?? null
  let notes: string | null = null
  try {
    const res = await fetch(`https://api.github.com/repos/kkutysllb/KCoder/releases/tags/v${v}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KCoder-updater' },
      signal: AbortSignal.timeout(NOTES_TIMEOUT_MS),
    })
    if (res.ok) {
      const data = (await res.json()) as { body?: unknown }
      if (typeof data.body === 'string' && data.body.trim() !== '') notes = data.body.trim()
    }
  } catch {
    // 离线/超时：静默降级，更新链路不受影响（落 updater.log 有据）
    updaterLog('warn', `拉取 v${v} 发布说明失败（离线或无该 release），悬停气泡降级为纯版本提示`)
  }
  notesCache.set(v, notes)
  return notes
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
  try {
    // isSilent=false 在 Windows 显示安装向导；macOS 直接替换重启
    autoUpdater.quitAndInstall(false, true)
  } catch (err) {
    // quitAndInstall 异常（Squirrel 桥缺失等）：回到 error 态而非
    // unhandled rejection——否则界面永远停在 installing，进程也不退
    setState('error', { error: `退出安装失败：${err instanceof Error ? err.message : String(err)}` })
    return updateStatus()
  }
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
