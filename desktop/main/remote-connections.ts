/**
 * 远程连接编排：每台主机一个**跑在远端的 KCoder 服务**，一个窗口。
 *
 * 为什么不是"本地 sidecar + 远端执行世界"：那条路要求每一个宿主侧客户端插件
 * 都改成世界感知，而它们（文件树、git、终端、媒体）都假设"本机就是那台机器"。
 * 换成让进程本身跑在远端之后，这些假设全部成立，一个插件都不用改。
 * 细节见 remote-server.ts 的头注释。
 *
 * @module desktop/main/remote-connections
 */

import { existsSync, readFileSync, unwatchFile, watchFile } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { dshHome } from './dsh-contract'
import { bundleSource } from './kcoder-skills-bundle'
import { startRemoteServer, type RemoteBundleSource, type RemoteServerHandle } from './remote-server'
import { remoteDshBin, runtimeDirForRemote, runtimeProbeDetail } from './remote-runtime'
import { readRemoteWorlds } from './remote-world'
import { decorateShellWindow, shellChromeOptions } from './windows'

/** 要装到远端的 KCoder bundle（目录名 + 包名，包名决定 profile 里的落点）。 */
const REMOTE_BUNDLES: readonly { dir: string; name: string }[] = [
  { dir: 'dsh-coding-sidebar', name: 'dsh-coding-sidebar' },
  { dir: 'dsh-file-review-kcoder', name: 'dsh-file-review-kcoder' },
  { dir: 'dsh-shell-prefs', name: 'dsh-shell-prefs' },
  { dir: 'dsh-skills-bundle', name: 'dsh-skills-bundle' },
  { dir: 'dsh-ssh-remote', name: 'dsh-ssh-remote' },
  { dir: 'dsh-terminal', name: '@kkutysllb/dsh-terminal' },
]

/** 一台主机的连接：远端服务句柄与窗口。 */
interface RemoteConnection {
  handle: RemoteServerHandle | null
  window: BrowserWindow | null
}

const connections = new Map<string, RemoteConnection>()

/** 当前已打开的远程连接的主机 id。 */
export function openRemoteHostIds(): string[] {
  return [...connections.keys()]
}

/**
 * 本地 profile 的配置文件路径（模型供应商与密钥就在这里）。
 *
 * 主侧车跑的是 `web` 模板 profile，配置写在 `<DSH_HOME>/profiles/web/`。名字变了
 * 或路径不在时返回 undefined——远端会以未配置状态起来，但连接本身不该因此失败。
 * @returns 文件绝对路径；不存在时为 undefined。
 */
function localProfilePatch(): string | undefined {
  const path = join(dshHome(), 'profiles', 'web', 'cordis.patch.yml')
  return existsSync(path) ? path : undefined
}

/** 本地 bundle 源目录（打包态在 resources，源码态在 bundle/）。 */
function localBundles(): RemoteBundleSource[] {
  return REMOTE_BUNDLES.map(b => ({ name: b.name, dir: bundleSource(b.dir) }))
}

/**
 * 打开（或聚焦）一台已注册主机的连接。
 *
 * 异步两段：先把远端服务装好接好（可能几十秒，含首次搬运），再开窗。窗口加载的
 * 是**本地转发端口**上的远端 dsh——页面里的终端、文件、git 因此全部作用在那台
 * 机器上。
 * @param hostId - 已注册世界的主机 id。
 * @returns 立即返回的结论（真正的结果走窗口或错误框）。
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

  const runtimeDir = runtimeDirForRemote()
  if (runtimeDir === null) return `本地 runtime 不可用，无法装配远端服务\n\n${runtimeProbeDetail()}`

  // 先占位：远端安装是分钟级的，重复点击不该并发起两份。
  const connection: RemoteConnection = { handle: null, window: null }
  connections.set(hostId, connection)

  const fail = (message: string, detail: string): void => {
    connections.delete(hostId)
    dialog.showErrorBox(`连接 ${spec.name || spec.alias} 失败`, `${message}\n\n${detail.slice(-600)}`)
  }

  void startRemoteServer({
    alias: spec.alias,
    runtimeDir,
    bundles: localBundles(),
    remoteNode: remoteDshBin(spec),
    // 远端有自己的 DSH_HOME；带上本地 profile 配置，否则模型与密钥全空。
    profilePatch: localProfilePatch(),
    onLog: (line) => { process.stdout.write(`[remote:${hostId}] ${line}\n`) },
  }).then((handle) => {
    connection.handle = handle
    const created = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'KCoder',
      // 与主窗口同一套外壳选项：否则这里会露出系统标题栏，
      // 侧边栏、状态栏按钮、设置页、主题跟随也全部缺失。
      ...shellChromeOptions(),
    })
    // 装配成 KCoder 外壳窗口：18 套注入器 + 导航策略，与主窗口同一条路径。
    decorateShellWindow(created, () => handle.url)
    connection.window = created
    created.on('closed', () => {
      connection.window = null
      // 关窗即断本地转发；远端服务保留复用（下次连接秒开）。
      void handle.dispose()
      connections.delete(hostId)
    })
    created.once('ready-to-show', () => created.show())
    void created.loadURL(handle.url)
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const detail = typeof error === 'object' && error !== null && 'detail' in error
      ? String((error as { detail: unknown }).detail)
      : ''
    fail(message, detail)
  })

  return `正在连接 ${spec.name || spec.alias}…`
}

/**
 * 关闭所有远程连接。退出时调用：本地转发是独立进程，不清理会留一串 ssh。
 * @returns 全部转发关闭后 resolve。
 */
export async function closeRemoteConnections(): Promise<void> {
  const entries = [...connections.values()]
  connections.clear()
  await Promise.all(entries.map(async (connection) => {
    if (connection.window !== null && !connection.window.isDestroyed()) connection.window.destroy()
    await connection.handle?.dispose().catch(() => {
      // 退出路径上的失败不该阻塞退出。
    })
  }))
}

/**
 * 监听插件写下的「打开远程连接」请求文件。
 *
 * 为什么不用 IPC 桥：渲染 dsh Web UI 的那个窗口是 `sandbox: true` 且**没有
 * preload**——上游 UI 有意不带桌面 API 面。为一个按钮把整个桌面 API 暴露给它，
 * 是拿安全姿态换便利。插件本来就拥有 `<DSH_HOME>/ssh-remote/`，请求文件是双方
 * 已经共用的通道，而主进程保留唯一真正需要的能力（起进程、开窗口）。
 *
 * 起始 `seq` **只作水位、绝不动作**：文件里遗留的请求属于写下它的那次运行。
 * 启动时处理它会让每次开 dev 都弹出一个远程窗口（2026-09-26 实机），而且因为
 * 连接已经存在，之后每次点击都只表现为"聚焦那个窗口"，看着像没反应。
 * @returns 停止监听的清理函数。
 */
export function startRemoteOpenWatcher(): () => void {
  const file = join(dshHome(), 'ssh-remote', 'pending-remote-open.json')

  /** 文件当前序号；缺失/半写/损坏一律按 0。 */
  const sequence = (): number => {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { seq?: unknown }
      const seq = Number(parsed.seq)
      return Number.isFinite(seq) ? seq : 0
    } catch {
      return 0
    }
  }

  let lastSeq = sequence()

  const act = (): void => {
    let request: { seq?: unknown; hostId?: unknown }
    try {
      request = JSON.parse(readFileSync(file, 'utf8')) as typeof request
    } catch {
      return // 不存在或正在写：下一次事件再读
    }
    const seq = Number(request.seq)
    const hostId = typeof request.hostId === 'string' ? request.hostId : ''
    if (!Number.isFinite(seq) || seq <= lastSeq) return
    lastSeq = seq
    if (hostId === '') return
    const outcome = openRemoteConnection(hostId)
    // 用户按了按钮却什么都没发生是最差的反馈：把拒绝理由摆出来。
    if (outcome.startsWith('未找到') || outcome.startsWith('本地 runtime')) {
      dialog.showErrorBox('无法打开远程连接', outcome)
    }
  }

  watchFile(file, { interval: 1000 }, act)
  return () => unwatchFile(file, act)
}
