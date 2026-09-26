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
import { localEngineVersion, remoteDshBin, runtimeDirForRemote, runtimeProbeDetail } from './remote-runtime'
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

/**
 * 连接过程的进度页（内联 data URL，不落临时文件）。
 *
 * 用同一套配色与排版，避免"跳到一个陌生页面"的观感；失败态把完整原文摊在页面上，
 * 用户可以直接选中复制——弹窗做不到这点。
 * @param host - 展示名。
 * @param title - 当前阶段标题。
 * @param detail - 失败时的完整原文（成功路径不传）。
 * @returns data URL。
 */
function progressPage(host: string, title: string, detail?: string): string {
  const html = `<!doctype html><meta charset="utf-8"><title>KCoder</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
         background:#17181a; color:#e8e8ea; font:14px/1.7 -apple-system,"PingFang SC",sans-serif }
  .box { width:min(720px,86vw) }
  h1 { font-size:16px; font-weight:600; margin:0 0 6px }
  .host { color:#9aa0a6; margin-bottom:18px }
  .stage { font-family:ui-monospace,Menlo,monospace; font-size:12px; color:#b6bcc4;
           background:#1f2124; border:1px solid #303236; border-radius:8px;
           padding:10px 12px; max-height:38vh; overflow:auto; white-space:pre-wrap }
  .err { color:#ff8f8f }
</style>
<h1 id="t"></h1><div class="host" id="h"></div><div class="stage" id="s"></div>
<script>
  const lines = [];
  window.__stage = (line) => { lines.push(line); const el = document.getElementById('s');
    el.textContent = lines.join('\n'); el.scrollTop = el.scrollHeight; };
  document.getElementById('t').textContent = ${JSON.stringify(title)};
  document.getElementById('h').textContent = ${JSON.stringify(`远程主机：${host}`)};
  ${detail === undefined ? '' : `document.getElementById('s').classList.add('err');
  document.getElementById('s').textContent = ${JSON.stringify(detail)};`}
</script>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

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

/**
 * 需要带到远端的本地密钥文件。
 *
 * `.credentials.yaml` 是 `apiKeyEnv` 引用值的实际存放处（`refs` 里的名字与 patch
 * 里的 `apiKeyEnv` 一一对应）；`media-models.env` 供图像/视频模型使用。两者都不
 * 存在时返回空表——远端少密钥，但不该因此连不上。
 * @returns 存在的文件绝对路径。
 */
function localSecretFiles(): string[] {
  return [join(dshHome(), '.credentials.yaml'), join(dshHome(), 'media-models.env')]
    .filter(path => existsSync(path))
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

  const display = spec.name !== '' ? spec.name : spec.alias

  // 立刻开窗显示进度。窗口等到全部就绪才创建的话，首次连接（可能几分钟：搬运
  // 引擎/bundle、等远端服务就绪）期间用户什么也看不到——"点了没反应"的观感。
  // 同一个窗口在成功时就地换成真正的远端 UI，失败时变成可复制的错误页。
  const created = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'KCoder',
    ...shellChromeOptions(),
  })
  connection.window = created
  created.on('closed', () => {
    connection.window = null
    void connection.handle?.dispose()
    connections.delete(hostId)
  })
  created.once('ready-to-show', () => created.show())
  void created.loadURL(progressPage(display, '正在连接…'))

  /** 往进度页推一行状态（页面未就绪时静默失败，下一行会补上）。 */
  const stage = (line: string): void => {
    process.stdout.write(`[remote:${hostId}] ${line}\n`)
    if (created.isDestroyed()) return
    void created.webContents
      .executeJavaScript(`window.__stage(${JSON.stringify(line)})`)
      .catch(() => { /* 页面还在加载或已跳走 */ })
  }

  void startRemoteServer({
    alias: spec.alias,
    runtimeDir,
    // 引擎在远端按平台装官方元包：本地这份的原生二进制是给 macOS 编的。
    engineVersion: localEngineVersion(runtimeDir) ?? '',
    bundles: localBundles(),
    remoteNode: remoteDshBin(spec),
    // 远端有自己的 DSH_HOME；带上本地 profile 配置与密钥文件，否则模型行会列出来
    // 但每个 provider 都标"缺 key"。
    profilePatch: localProfilePatch(),
    homeFiles: localSecretFiles(),
    onLog: stage,
  }).then((handle) => {
    connection.handle = handle
    decorateShellWindow(created, () => handle.url)
    if (!created.isDestroyed()) void created.loadURL(handle.url)
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const detail = typeof error === 'object' && error !== null && 'detail' in error
      ? String((error as { detail: unknown }).detail)
      : ''
    connection.handle = null
    if (created.isDestroyed()) {
      connections.delete(hostId)
      dialog.showErrorBox(`连接 ${display} 失败`, `${message}\n\n${detail.slice(-600)}`)
      return
    }
    // 错误留在窗口里：可选中、可复制、可整段发给别人，比一次性弹窗有用。
    void created.loadURL(progressPage(display, '连接失败', `${message}\n\n${detail}`))
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
