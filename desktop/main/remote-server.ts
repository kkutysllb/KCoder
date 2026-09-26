/**
 * 远端 KCoder 服务（VS Code Server 模式）。
 *
 * 为什么不是「本地 sidecar + 远端执行世界」：那条路要求**每一个**宿主侧客户端
 * 插件都改成世界感知——文件树、git、终端、媒体各自都会用 `node:fs`/
 * `node-pty` 去碰"本机"，而本机不是那台机器。`dsh-coding-sidebar` 一个插件就有
 * 8 个文件直接用宿主 fs，终端的 PTY 更是在本进程里创建的（2026-09-26 实机：
 * 侧边栏终端 `[process exited with code 1]`、独立终端显示本地路径、
 * `cannot resolve target … realpath`）。
 *
 * 换个问法就顺了：**让进程本身跑在那台机器上**。整套 runtime 与 KCoder 的
 * bundle 装到远端，`dsh web` 在远端起，本地只做端口转发。于是终端、文件、git
 * 全部天然是远端的，因为「本机」就是那台机器。这也是 VS Code Remote 的形状。
 *
 * 本模块刻意不依赖 electron：它只用 child_process 与 fs，因此可以用纯 node
 * 直接跑起来验证（产物交付前的实机验收就靠这个）。
 *
 * @module desktop/main/remote-server
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 远端安装根：runtime、bundles、profiles 都在它下面，卸载即 `rm -rf` 一处。 */
const REMOTE_ROOT = '$HOME/.kcoder-remote'
/** 远端 profile 名（`dsh <profile> web …` 的第一个位置参数）。 */
const REMOTE_PROFILE = 'kcoder'
/** 引擎包从 runtime 的拦截层解析，profile 里只放 KCoder 自己的 bundle。 */
const PROFILE_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-shell-prefs',
  'dsh-coding-sidebar',
  'dsh-file-review-kcoder',
  '@kkutysllb/dsh-terminal',
  'dsh-skills-bundle',
]

/** 一个远端 bundle：包名 + 本地源目录。 */
export interface RemoteBundleSource {
  /** package.json 的 name（决定 profile node_modules 里的落点）。 */
  name: string
  /** 本地目录绝对路径。 */
  dir: string
}

/** 建立远端服务所需的输入。 */
export interface RemoteServerOptions {
  /** OpenSSH 别名（`~/.ssh/config` 的 Host）。 */
  alias: string
  /** 已解析的本地 runtime 目录（含 `lib/bin.js` 与 `node_modules`）。 */
  runtimeDir: string
  /** 要装到远端的 KCoder bundle。 */
  bundles: readonly RemoteBundleSource[]
  /** 首次安装要用的远端 Node 可执行文件（用户态安装，免 sudo）。 */
  remoteNode: string
  /**
   * 本地 profile 的 `cordis.patch.yml` 绝对路径。
   *
   * 远端那台有自己的 DSH_HOME，不带上这份的话模型供应商与密钥全是空的——每连一台
   * 机器都要重配一遍，不能接受。该文件同时承载 MCP 服务器与界面偏好，是"这台机器
   * 的 KCoder 配置"的完整表达（实测无本地绝对路径，可整体搬运）。
   */
  profilePatch?: string
  /** 进度/诊断输出。 */
  onLog?: (line: string) => void
  /** 端到端超时（毫秒），覆盖安装 + 启动 + 转发。 */
  timeoutMs?: number
}

/** 一个活着的远端服务。 */
export interface RemoteServerHandle {
  /** 本地入口 URL（含启动令牌），直接交给 BrowserWindow。 */
  url: string
  /** 本地转发端口（与远端同号，故 authority 两侧一致）。 */
  port: number
  /** 关闭本地转发。远端进程保留复用（下次连接秒开）。 */
  dispose(): Promise<void>
}

/** 远端操作失败：message 给人看，detail 给排查。 */
export class RemoteServerError extends Error {
  /** 排查用的原文（远端 stderr / 日志尾部）。 */
  readonly detail: string

  constructor(detail: string, message: string) {
    super(message)
    this.name = 'RemoteServerError'
    this.detail = detail
  }
}

/** 在远端执行一段脚本，返回 { code, stdout, stderr }。 */
function sshAttempt(
  alias: string,
  script: string,
  opts: { timeoutMs?: number; input?: Buffer | string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', alias, script],
      { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // 远端脚本的非零退出经 error.code 表达；连接层失败没有 code。
        const code = error !== null && typeof error.code === 'number' ? error.code : error === null ? 0 : -1
        if (code === -1) reject(new RemoteServerError(String(stderr), `无法连接远端 ${alias}：${String(stderr).trim() || '连接被关闭'}`))
        else resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input)
    }
  })
}

/** 连接层失败的识别：ssh 自己的措辞，与远端脚本的退出码无关。 */
function isTransportFailure(stderr: string): boolean {
  return /Connection closed|Connection reset|kex_exchange_identification|Broken pipe|Connection timed out|Operation timed out/i.test(stderr)
}

/**
 * 在远端执行一段脚本，**连接层失败自动重试**。
 *
 * 实测这条链路约每三次掉一次（`Connection closed by <host> port <n>`），且与
 * 脚本本身无关。安装与启动都是幂等的，重试是正确的代价模型；不重试则会因为
 * 一次网络抖动把整个连接流程判死。
 */
async function sshRun(
  alias: string,
  script: string,
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const attempts = opts.attempts ?? 3
  let last: { code: number; stdout: string; stderr: string } | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await sshAttempt(alias, script, opts)
      if (result.code !== 0 && isTransportFailure(result.stderr) && i < attempts - 1) {
        last = result
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
        continue
      }
      return result
    } catch (error) {
      if (error instanceof RemoteServerError && isTransportFailure(error.detail) && i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
        continue
      }
      throw error
    }
  }
  return last ?? { code: -1, stdout: '', stderr: 'ssh 重试耗尽' }
}

/** 把本地目录 tar 成流，经 ssh 解到远端目标目录（几万小文件走单流，比 rsync 快得多）。 */
async function sshTarInto(
  alias: string,
  localDir: string,
  entries: readonly string[],
  remoteDir: string,
  onLog: (l: string) => void,
  attempts = 3,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await sshTarOnce(alias, localDir, entries, remoteDir, onLog)
      return
    } catch (error) {
      // 与 sshRun 同一套判断：传输层的掉线不该把整个流程判死，重传是幂等的
      // （tar 覆盖解包，目标目录只是被重写一遍）。
      const detail = error instanceof RemoteServerError ? error.detail : ''
      if (i < attempts - 1 && isTransportFailure(detail)) {
        onLog(`传输中断，重试（${String(i + 2)}/${String(attempts)}）`)
        await new Promise(r => setTimeout(r, 1500 * (i + 1)))
        continue
      }
      throw error
    }
  }
}

/** 单次传输尝试（tar 流经 ssh 解包）。 */
function sshTarOnce(alias: string, localDir: string, entries: readonly string[], remoteDir: string, onLog: (l: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    onLog(`传输 ${entries.length} 项 → ${remoteDir}`)
    // -h：解引用符号链接。打包态运行时是真实目录，开发态克隆是 monorepo 符号链接树；
    // 解引用让两种来源都能搬成自足的远端副本。
    const tar = spawn('tar', ['-czhf', '-', '-C', localDir, ...entries], { stdio: ['ignore', 'pipe', 'ignore'] })
    const ssh = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=10', alias, `mkdir -p ${remoteDir} && tar -xzf - -C ${remoteDir}`],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    )
    tar.stdout.pipe(ssh.stdin)
    let stderr = ''
    ssh.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    ssh.on('error', reject)
    ssh.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new RemoteServerError(stderr, `传输到 ${alias} 失败（exit ${String(code)}）`))
    })
    tar.on('error', reject)
  })
}

/** 远端已有的 runtime 是否可直接使用。 */
export async function remoteInstallReady(alias: string): Promise<boolean> {
  const { stdout } = await sshRun(alias, `test -f ${REMOTE_ROOT}/runtime/lib/bin.js && echo READY || echo MISSING`)
  return stdout.includes('READY')
}

/** 远端 Node 是否已在（引导流程装的用户态 Node）。 */
export async function remoteNodeReady(alias: string, remoteNode: string): Promise<boolean> {
  const { stdout } = await sshRun(alias, `test -x ${remoteNode} && ${remoteNode} -v || echo MISSING`)
  return !stdout.includes('MISSING')
}

/**
 * 把 runtime、KCoder bundle 与一个自包含 profile 装到远端。
 *
 * 幂等：runtime 已就位时跳过 277MB 的搬运，只补齐 profile 与平台专用原生模块。
 * 平台原生模块必须单独处理——本地那份是 darwin 变体，照搬过去会以
 * `Cannot find module 'node-addon-require-builtin-linux-x64-gnu'` 直接起不来
 * （2026-09-26 实测）。
 * @param opts - 安装输入。
 * @returns 安装后的远端 runtime 路径。
 */
export async function provisionRemoteRuntime(opts: RemoteServerOptions): Promise<string> {
  const log = opts.onLog ?? ((): void => {})
  const { alias, runtimeDir, bundles, remoteNode } = opts

  if (!(await remoteNodeReady(alias, remoteNode))) {
    throw new RemoteServerError(remoteNode, `远端 ${alias} 上没有可用的 Node（${remoteNode}）：请先在该主机上完成引导`)
  }
  const runtimePath = `${REMOTE_ROOT}/runtime`

  if (await remoteInstallReady(alias)) {
    log('远端 runtime 已就位，跳过搬运')
  } else {
    if (!existsSync(join(runtimeDir, 'lib', 'bin.js'))) {
      throw new RemoteServerError(runtimeDir, `本地 runtime 不完整（缺 lib/bin.js）：${runtimeDir}`)
    }
    await sshTarInto(alias, runtimeDir, ['lib', 'node_modules', 'package.json'], runtimePath, log)
    log('runtime 已就位')
  }

  // 指纹比对：bundle 内容没变就跳过 114MB 的搬运。这条链路实测会掉线，
  // 每次连接都重传既慢又更容易失败；指纹一致时后续连接只剩短命令。
  const fingerprint = bundleFingerprint(bundles)
  const remoteFingerprint = await sshRun(alias, `cat ${REMOTE_ROOT}/bundles/.fingerprint 2>/dev/null || echo NONE`)
  if (remoteFingerprint.stdout.trim() === fingerprint) {
    log('bundle 内容未变，跳过搬运')
  } else {
    await sshTarInto(alias, join(bundles[0]!.dir, '..'), bundles.map(b => b.dir.split('/').pop()!), `${REMOTE_ROOT}/bundles`, log, 6)
    await sshRun(alias, `printf '%s\\n' '${fingerprint}' > ${REMOTE_ROOT}/bundles/.fingerprint && echo OK`)
  }

  // profile：引擎包由 runtime 的拦截层解析，这里只放 KCoder 的 bundle。
  const profileScript = [
    'set -e',
    `R=${REMOTE_ROOT}`,
    `P=$R/home/profiles/${REMOTE_PROFILE}`,
    'mkdir -p "$P/node_modules/@kkutysllb"',
    'cd "$P/node_modules"',
    ...bundles.map((b) => {
      const leaf = b.dir.split('/').pop()!
      const dest = b.name.startsWith('@') ? `${b.name}` : b.name
      return `rm -rf "${dest}"; mkdir -p "$(dirname "${dest}")"; cp -R "$R/bundles/${leaf}" "${dest}"`
    }),
    "printf '[]\\n' > \"$P/cordis.yml\"",
    `printf '%s\\n' '${JSON.stringify({
      name: `dsh-profile-${REMOTE_PROFILE}`,
      private: true,
      dsh: { profile: { bundles: PROFILE_BUNDLES } },
    })}' > "$P/package.json"`,
    'echo PROFILE_OK',
  ].join('\n')
  const profile = await sshRun(alias, profileScript, { timeoutMs: 120_000 })
  if (!profile.stdout.includes('PROFILE_OK')) {
    throw new RemoteServerError(profile.stderr, '远端 profile 组装失败')
  }
  log('profile 已就位')

  // 把本地 profile 配置带过去：模型供应商、密钥、MCP 服务器、界面偏好。
  // 不这样做，远端就是个"没配过的新 KCoder"，每台机器都要重配一次。
  const patch = opts.profilePatch
  if (patch !== undefined && existsSync(patch)) {
    await sshTarInto(alias, join(patch, '..'), [patch.split('/').pop()!], `$R/home/profiles/${REMOTE_PROFILE}`, log, 4)
    await sshRun(alias, `chmod 600 ${REMOTE_ROOT}/home/profiles/${REMOTE_PROFILE}/cordis.patch.yml && echo OK`)
    log('本地 profile 配置已同步（模型/密钥/MCP/偏好）')
  } else {
    log('未提供本地 profile 配置，远端将是未配置状态')
  }

  // 平台专用原生模块：按本地声明取 linux-x64 同名同版本。
  const specs = localAddonSpecs(runtimeDir)
  const already = await sshRun(alias, `test -d ${REMOTE_ROOT}/runtime/node_modules/node-addon-require-builtin-linux-x64-gnu && echo YES || echo NO`)
  if (specs.length > 0 && already.stdout.includes('NO')) {
    const install = await sshRun(alias, [
      'set -e',
      `export PATH=${remoteNode.replace(/\/node$/, '')}:$PATH`,
      `R=${REMOTE_ROOT}`,
      'rm -rf $R/platform && mkdir -p $R/platform && cd $R/platform',
      `printf '{"name":"platform-addons","private":true,"version":"1.0.0"}\\n' > package.json`,
      `npm i --no-audit --no-fund --loglevel=error ${specs.join(' ')} >/dev/null 2>&1`,
      'for item in node_modules/*; do b=$(basename "$item"); [ "$b" = ".package-lock.json" ] && continue;',
      '  if [ "${b:0:1}" = "@" ]; then mkdir -p "$R/runtime/node_modules/$b"; for s in "$item"/*; do cp -R "$s" "$R/runtime/node_modules/$b/"; done',
      '  else cp -R "$item" "$R/runtime/node_modules/"; fi; done',
      'echo ADDONS_OK',
    ].join('\n'), { timeoutMs: 600_000 })
    if (!install.stdout.includes('ADDONS_OK')) {
      throw new RemoteServerError(install.stderr.slice(-400), '远端平台原生模块安装失败')
    }
    log('平台原生模块已就位')
  } else if (specs.length > 0) {
    log('平台原生模块已在位，跳过')
  }
  return runtimePath
}

/**
 * bundle 集合的内容指纹。
 *
 * 用各 bundle 的 `name@version` 拼接而非遍历文件：版本变了说明产物变了，
 * 而未发版时的本地改动由构建流程负责（`sync-bundles` 会更新镜像）。
 * @param bundles - 目标 bundle 列表。
 * @returns 稳定指纹串。
 */
export function bundleFingerprint(bundles: readonly RemoteBundleSource[]): string {
  return bundles
    .map((b) => {
      try {
        const pkg = JSON.parse(readFileSync(join(b.dir, 'package.json'), 'utf8')) as { name?: string; version?: string }
        return `${pkg.name ?? b.name}@${pkg.version ?? '0.0.0'}`
      } catch {
        return `${b.name}@unreadable`
      }
    })
    .sort()
    .join(',')
}

/**
 * 从本地 runtime 的依赖树里收集**本平台已有、而 linux-x64 缺失**的
 * optionalDependencies 规格（`名称@版本`）。
 *
 * 逐个读取 package.json 的 optionalDependencies：照搬 macOS 树会让远端缺
 * 平台原生模块，而版本必须与本地一致（原生 ABI 不跨版本兼容）。
 * @param runtimeDir - 本地 runtime 目录。
 * @returns 可交给 `npm i` 的规格列表。
 */
export function localAddonSpecs(runtimeDir: string): string[] {
  const modules = join(runtimeDir, 'node_modules')
  const specs = new Set<string>()
  const visit = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const pkg = join(dir, entry, 'package.json')
      if (!existsSync(pkg)) continue
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { optionalDependencies?: Record<string, string> }
        for (const [name, range] of Object.entries(parsed.optionalDependencies ?? {})) {
          if (!/linux-x64(-gnu)?$/.test(name)) continue
          if (existsSync(join(modules, name))) continue // 本地已装（本机是 darwin，通常不会命中）
          specs.add(`${name}@${range}`)
        }
      } catch { /* 损坏的 package.json 跳过 */ }
    }
  }
  visit(modules)
  for (const scope of existsSync(modules) ? readdirSync(modules) : []) {
    if (scope.startsWith('@')) visit(join(modules, scope))
  }
  return [...specs].sort()
}

/** 远端服务日志（就绪行从这里读；token 只在此文件与 URL 里出现）。 */
const REMOTE_LOG = `${REMOTE_ROOT}/server.log`

/** 在本地找一个空闲端口（与远端同号，让两侧 authority 一致，cookie 名才对齐）。 */
async function pickPort(preferred: number): Promise<number> {
  const net = await import('node:net')
  const probe = (port: number): Promise<boolean> => new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
  for (let port = preferred; port < preferred + 40; port++) {
    if (await probe(port)) return port
  }
  throw new RemoteServerError(`ports ${preferred}..${preferred + 40}`, '本地找不到可用端口')
}

/**
 * 起一个远端 KCoder 服务并把它接到本地回环。
 *
 * 远端进程**刻意脱离 ssh 会话**（`setsid nohup … &` 写日志）：ssh 掉线不该带走
 * 正在跑的任务，重连时按日志里的就绪行复用同一实例即可。本地那侧只保留一条
 * `ssh -N -L`，端口与远端同号——authority 相同，BrowserAuth 的 cookie 名
 * （`dsh-auth-` + sha256(authority)）才两侧一致。
 * @param opts - 连接与安装输入。
 * @returns 可交给窗口的句柄。
 */
export async function startRemoteServer(opts: RemoteServerOptions): Promise<RemoteServerHandle> {
  const log = opts.onLog ?? ((): void => {})
  const { alias, remoteNode } = opts
  await provisionRemoteRuntime(opts)

  const port = await pickPort(30100 + (hash(alias) % 900))
  log(`远端端口 ${port}`)

  // 已在跑就直接复用：按日志取就绪行，避免重复起进程与重复消耗内存。
  const existing = await sshRun(alias, `grep -o "dsh web: http://127.0.0.1:${port}/?token=[A-Za-z0-9_-]*" ${REMOTE_LOG} 2>/dev/null | tail -1`)
  let entry = existing.stdout.trim()

  if (entry === '') {
    const nodeBin = remoteNode.replace(/\/node$/, '')
    const launch = [
      'set -e',
      `export PATH=${nodeBin}:$PATH`,
      `R=${REMOTE_ROOT}`,
      `rm -f ${REMOTE_LOG}`,
      `cd $HOME`,
      // 语法是 `dsh <profile> [app 选项…]`——`dsh web` 里的 `web` **就是 profile
      // 名**（web 模板的 profile 恰好叫 web），不是子命令。多写一个 `web` 会被
      // 当成 app 的位置参数（实测 "too many arguments. Expected 0 arguments but
      // got 1: web"）。本地宿主也是这个形状：`dsh web --patch … --port 0`。
      `DSH_HOME=$R/home setsid nohup node $R/runtime/lib/bin.js ${REMOTE_PROFILE} --port ${port} --no-open > ${REMOTE_LOG} 2>&1 < /dev/null &`,
      'echo LAUNCHED',
    ].join('\n')
    const started = await sshRun(alias, launch, { timeoutMs: 60_000 })
    if (!started.stdout.includes('LAUNCHED')) {
      throw new RemoteServerError(started.stderr.slice(-400), '远端服务启动失败')
    }
    // 就绪行要等 loader 结算；首次启动含 bundle 解析，给足时间。
    const deadline = Date.now() + (opts.timeoutMs ?? 180_000)
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000))
      const poll = await sshRun(alias, `grep -o "dsh web: http://127.0.0.1:${port}/?token=[A-Za-z0-9_-]*" ${REMOTE_LOG} 2>/dev/null | tail -1`)
      entry = poll.stdout.trim()
      if (entry !== '') break
      const failed = await sshRun(alias, `tail -3 ${REMOTE_LOG} 2>/dev/null`)
      if (/Error|error:/.test(failed.stdout) && !/did not activate/.test(failed.stdout)) {
        throw new RemoteServerError(failed.stdout.slice(-400), '远端服务启动报错')
      }
    }
    if (entry === '') {
      const tail = await sshRun(alias, `tail -6 ${REMOTE_LOG} 2>/dev/null`)
      throw new RemoteServerError(tail.stdout.slice(-400), '远端服务等待就绪超时')
    }
  } else {
    log('复用远端已在跑的服务')
  }

  const token = /token=([A-Za-z0-9_-]+)/.exec(entry)?.[1] ?? ''
  if (token === '') throw new RemoteServerError(entry, '远端就绪行里没有启动令牌')

  const forward = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=10', '-o', 'ExitOnForwardFailure=yes',
      '-N', '-L', `${port}:127.0.0.1:${port}`, alias],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  let forwardError = ''
  forward.stderr.on('data', (chunk: Buffer) => { forwardError += chunk.toString() })

  // 等到本地确实在监听：窗口不能指向一个还没接通的端口。
  const net = await import('node:net')
  const ready = await new Promise<boolean>((resolve) => {
    const deadline = Date.now() + 15_000
    const attempt = (): void => {
      if (forward.exitCode !== null) { resolve(false); return }
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) resolve(false)
        else setTimeout(attempt, 400)
      })
    }
    attempt()
  })
  if (!ready) {
    forward.kill()
    throw new RemoteServerError(forwardError.slice(-400), `端口转发未建立（本地 ${port}）`)
  }
  log(`已接通 127.0.0.1:${port} → ${alias}`)

  return {
    port,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    dispose: async () => {
      forward.kill()
    },
  }
}

/** 稳定的小散列：让同一台主机固定落在一段端口里，便于复用已在跑的远端服务。 */
function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0
  return h
}
