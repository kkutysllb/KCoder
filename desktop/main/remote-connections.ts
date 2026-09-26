/**
 * 远程连接编排：每台已引导主机一个 sidecar，一个窗口。
 *
 * 为什么不能共用宿主侧车：上游 SSH 世界是进程级的（`ctx.fs`/`ctx.subprocess`/
 * `ctx.sandbox` 都是单一服务名，`dsh-ssh` 的 `host` 是部署所有），一个进程只能
 * 有一个执行世界。所以「连到哪台机器」等于「起哪个 sidecar」——这也是上游
 * 决策记录里把「每工作区一个世界」列为未完成项的原因。
 *
 * 每个远程 sidecar 的差异只有一处：追加一个把该主机世界装起来的 overlay
 * （见 remote-world.ts）。产品策略层是共享的，逐主机数据是追加的。
 *
 * @module desktop/main/remote-connections
 */

import { readFileSync, unwatchFile, watchFile } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { DshManager } from './dsh-manager'
import { dshHome } from './dsh-contract'
import type { DshStatus } from '@shared/ipc-contract'
import { readRemoteWorlds, writeRemoteWorldOverlay } from './remote-world'

/** 一台主机的连接：它的 sidecar 与窗口。 */
interface RemoteConnection {
  manager: DshManager
  window: BrowserWindow | null
}

const connections = new Map<string, RemoteConnection>()

/** 当前已打开的远程连接的主机 id（供菜单勾选/去重）。 */
export function openRemoteHostIds(): string[] {
  return [...connections.keys()]
}

/**
 * Open (or focus) the connection to one registered remote host.
 *
 * The window loads the sidecar's own entry URL, which carries the launch token
 * that mints the BrowserAuth cookie — the same path the shell window uses, so a
 * plain window is enough (the dsh web UI is what renders; no desktop preload is
 * involved in serving it).
 * @param hostId - registered world id.
 * @returns a human-readable outcome for the caller's notice surface.
 */
export function openRemoteConnection(hostId: string): string {
  const existing = connections.get(hostId)
  if (existing !== undefined) {
    existing.window?.show()
    existing.window?.focus()
    return `已连接到 ${hostId}`
  }
  const spec = readRemoteWorlds().find(entry => entry.hostId === hostId)
  if (spec === undefined) return `未找到已注册的远程主机 ${hostId}（先运行引导脚本 --register）`

  // 每次打开都重写 overlay：spec 是唯一事实源，陈旧 overlay 会指向已不存在的
  // helper 摘要，而摘要不匹配是拒绝连接（不是降级）。
  const overlay = writeRemoteWorldOverlay(spec)
  const manager = new DshManager()
  const connection: RemoteConnection = { manager, window: null }
  connections.set(hostId, connection)

  manager.on('state-changed', (status: DshStatus) => {
    if (status.state === 'ready' && status.url !== null) {
      const url = manager.shellEntryUrl(status.url)
      const current = connection.window
      if (current === null || current.isDestroyed()) {
        const created = new BrowserWindow({
          width: 1440,
          height: 900,
          minWidth: 960,
          minHeight: 600,
          title: `KCoder — 远程 ${spec.name || spec.alias}`,
          show: false,
        })
        connection.window = created
        created.on('closed', () => { connection.window = null })
        created.once('ready-to-show', () => created.show())
        void created.loadURL(url)
      } else {
        // 崩溃重启后端口与令牌都会变，必须重新加载而不是复用旧 URL。
        void current.loadURL(url)
      }
      return
    }
    if (status.state === 'failed') {
      connection.window?.destroy()
      connections.delete(hostId)
      void manager.stop()
    }
  })

  manager.start([overlay])
  return `正在连接 ${spec.name || spec.alias}…`
}

/**
 * Stop every remote sidecar and close its window. Called on app quit: leaving
 * them running would leak a `dsh web` process per host across restarts.
 * @returns resolution after every manager settled its child.
 */
export async function closeRemoteConnections(): Promise<void> {
  const entries = [...connections.values()]
  connections.clear()
  await Promise.all(entries.map(async (connection) => {
    if (connection.window !== null && !connection.window.isDestroyed()) connection.window.destroy()
    await connection.manager.stop().catch(() => {
      // A shutdown failure must not block the quit path.
    })
  }))
}

/**
 * Watch the plugin's "open a remote connection" request file.
 *
 * Why a file rather than an IPC bridge: the window that renders the dsh Web UI
 * runs with `sandbox: true` and **no preload** — the upstream UI deliberately has
 * no desktop API surface. Handing that page a bridge to widen it for one button
 * would trade the shell's security posture for a convenience. The plugin already
 * owns `<DSH_HOME>/ssh-remote/`, so a request file is a channel both sides
 * already agree on, and the main process keeps the only capability that matters
 * (spawning a process and a window).
 *
 * `seq` is monotonic so a repeated watch event cannot open the same connection
 * twice, and the last seen value is primed before watching so a leftover request
 * from a previous run is not replayed at startup.
 * @returns disposer that stops watching.
 */
export function startRemoteOpenWatcher(): () => void {
  const file = join(dshHome(), 'ssh-remote', 'pending-remote-open.json')
  let lastSeq = 0
  const read = (): void => {
    let request: { seq?: unknown; hostId?: unknown }
    try {
      request = JSON.parse(readFileSync(file, 'utf8')) as typeof request
    } catch {
      return // absent or mid-write: the next event re-reads it
    }
    const seq = Number(request.seq)
    const hostId = typeof request.hostId === 'string' ? request.hostId : ''
    if (!Number.isFinite(seq) || seq <= lastSeq) return
    lastSeq = seq
    if (hostId === '') return
    openRemoteConnection(hostId)
  }
  // Prime first: an existing request belongs to whoever wrote it, not to us.
  read()
  watchFile(file, { interval: 1000 }, read)
  return () => unwatchFile(file, read)
}
