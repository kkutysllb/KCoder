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
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
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
  /**
   * 本地 runtime 目录（含 `lib/bin.js`）——只用来取**入口脚本**。
   *
   * 引擎包**不再从本地搬**：本地那份是 macOS 构建，DeepSeek 的自有原生包
   * （`@deepseek-ai/node-addon-system-*` 等）是 workspace 包，在 macOS 上只编得出
   * darwin 二进制，linux 变体在本地只是个空壳。照搬的后果是远端跑任务时
   * `Cannot find module '…/node-addon-system-linux-x64/bin/glibc/system.node'`
   * （2026-09-26 实机）。npm 上发布的同名包**带 linux 二进制**，所以改为在远端
   * 按平台安装。
   */
  runtimeDir: string
  /**
   * 引擎版本（如 `0.1.7-rc.2`），由调用方从本地 runtime 读出。
   *
   * 远端装的是**官方发布的元包** `@deepseek-ai/dsh@<该版本>`，由 npm 按**那台
   * 机器**的平台解析整棵依赖树——平台原生模块因此自动正确。
   *
   * 为什么不自己列清单：手工列举本地装过的包会踩两个坑——把 darwin 专用包当直接
   * 依赖（linux 上整单 `EBADPLATFORM` 拒绝），以及漏掉只有传递路径才会拉进来的
   * 原生包。让官方元包定义依赖集，这两类问题都不存在（2026-09-26 实机，两坑都踩过）。
   */
  engineVersion: string
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
  /**
   * 要一并放进远端 DSH 家目录的本地文件（按 basename 落位）。
   *
   * 密钥**不在** profile patch 里——patch 只写 `apiKeyEnv: ZAI_CODING_CN_API_KEY`
   * 这样的引用，真正的值在 `<DSH_HOME>/.credentials.yaml` 的 refs/records 里。
   * 只同步 patch 的结果就是远端把行都列出来、但每个provider 都标"缺 key"
   * （2026-09-26 实机）。媒体模型的密钥同理在 `media-models.env`。
   */
  homeFiles?: readonly string[]
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
      else reject(new RemoteServerError(stderr, `传输到 ${alias} 失败（exit ${String(code)}）：${remoteDir}`))
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
 * 安装结果：远端 runtime 路径，以及**本次是否改动过配置**。
 *
 * 后者决定要不要重启已跑着的远端服务——`loadLayeredEnv` 只在进程启动时读 env，
 * 复用旧进程会让刚带过去的密钥不生效。**不能**用模块级/全局变量传达这件事：
 * 两台主机并发连接时会互相串台。
 */
export interface ProvisionOutcome {
  /** 远端 runtime 目录。 */
  runtimePath: string
  /** 本次是否同步过 profile 配置或密钥文件。 */
  syncedConfig: boolean
}

/**
 * 把 runtime、KCoder bundle 与一个自包含 profile 装到远端。
 *
 * 幂等：runtime 已就位时跳过 277MB 的搬运，只补齐 profile 与平台专用原生模块。
 * 平台原生模块必须单独处理——本地那份是 darwin 变体，照搬过去会以
 * `Cannot find module 'node-addon-require-builtin-linux-x64-gnu'` 直接起不来
 * （2026-09-26 实测）。
 * @param opts - 安装输入。
 * @returns 远端 runtime 路径与本次是否改动过配置。
 */
export async function provisionRemoteRuntime(opts: RemoteServerOptions): Promise<ProvisionOutcome> {
  const log = opts.onLog ?? ((): void => {})
  const { alias, runtimeDir, bundles, remoteNode } = opts

  if (!(await remoteNodeReady(alias, remoteNode))) {
    throw new RemoteServerError(remoteNode, `远端 ${alias} 上没有可用的 Node（${remoteNode}）：请先在该主机上完成引导`)
  }
  const runtimePath = `${REMOTE_ROOT}/runtime`

  // 引擎包在远端按平台安装；入口脚本从本地搬（几 KB）。
  if (opts.engineVersion === '') {
    throw new RemoteServerError('engineVersion 为空', '无法确定引擎版本（本地 runtime 既无 @deepseek-ai/dsh 也无 dsh-app-boot）')
  }
  const engineFingerprint = opts.engineVersion
  const markerPath = `${REMOTE_ROOT}/runtime/.engine-fingerprint`
  const current = await sshRun(alias, `cat ${markerPath} 2>/dev/null || echo NONE`)
  const wanted = createHash('md5').update(engineFingerprint).digest('hex')
  // 跳过条件必须核对**远端实际的包版本**，不能只信标记：曾经出现过"标记写着目标
  // 版本、实际装的是另一个版本"的状态（回落分支错误地也写了标记），于是永远跳过
  // 安装、永远错线（2026-09-26 实机）。
  const engineState = await sshRun(alias, `node -e "console.log(require('${REMOTE_ROOT}/runtime/node_modules/@deepseek-ai/dsh/package.json').version)" 2>/dev/null || echo NONE`)
  const installedVersion = engineState.stdout.trim()

  if (installedVersion === opts.engineVersion && current.stdout.trim() === wanted) {
    log('远端引擎已就位且版本未变，跳过安装')
  } else {
    log(`远端安装引擎 @deepseek-ai/dsh@${opts.engineVersion}（由 npm 按该机平台解析原生依赖）`)
    // 安装**脱离 ssh 会话**跑（setsid nohup + 哨兵文件），随后轮询结果。
    //
    // 直接把 npm 挂在 ssh 命令里在这条链路上必然失败：连接一掉（实测约每三次一次）
    // 远端进程跟着被杀，几分钟的下载全部作废。脱会话之后掉线只影响轮询。
    const install = [
      `R=${REMOTE_ROOT}`,
      'rm -f $R/install-done $R/npm-install.log',
      'rm -rf $R/runtime-staging && mkdir -p $R/runtime-staging',
      // 先装到 staging、成功才就位：中断的安装不会留下半棵依赖树。
      `( cd $R/runtime-staging && printf '{"name":"kcoder-remote-runtime","private":true,"version":"1.0.0"}\\n' > package.json`,
      `  && PATH=${opts.remoteNode.replace(/\/node$/, '')}:$PATH npm i --no-audit --no-fund --ignore-scripts=false @deepseek-ai/dsh@${opts.engineVersion} > $R/npm-install.log 2>&1`,
      '  && rm -rf $R/runtime && mv $R/runtime-staging $R/runtime && echo OK > $R/install-done )',
      '  || echo FAIL > $R/install-done',
    ].join('\n')
    // 已有安装在跑就别再起一个：两次连接会并发装两遍同目录、互相踩（staging 是同
    // 一个路径）。此时直接进入轮询，等前一个跑完即可。
    // `[n]pm` 的方括号是必需的：pgrep -f 匹配整条命令行，而本脚本正文里就含
    // "npm i"，直接写会匹配到它自己 → 永远判定"已在跑" → 永不启动（2026-09-26 实机）。
    const already = await sshRun(alias, `pgrep -f "[n]pm i @deepseek-ai" >/dev/null && echo RUNNING || echo IDLE`)
    if (already.stdout.includes('RUNNING')) {
      log('远端已有安装在跑，等待它完成')
    } else {
      // 脚本**落文件再执行**，绝不塞进 `bash -c "…"`：双引号字符串会被远端外层
      // shell 先做一次展开，脚本里的 `$R` 在外层未定义 → 展开成空 → 路径全变成
      // `/runtime-staging`、`/install-done` → 权限拒绝，连失败哨兵都写不出来
      // （2026-09-26 实机：表现为"安装永远不结束"，追了很久）。
      const scriptName = 'install-engine.sh'
      await sshTarInto(alias, '/tmp', [await writeScriptFile(install, scriptName)], REMOTE_ROOT, log, 3)
      const launched = await sshRun(alias, `setsid nohup bash ${REMOTE_ROOT}/${scriptName} > /dev/null 2>&1 < /dev/null & echo LAUNCHED`, { timeoutMs: 60_000 })
      if (!launched.stdout.includes('LAUNCHED')) {
        throw new RemoteServerError(launched.stderr.slice(-400), '无法在远端启动引擎安装')
      }
    }
    // 装载**有界等待**：安装是锦上添花，不该让"连接"阻塞半小时——那正是用户看到的
    // "长时间没反应"（实测 npm 在 WSL2 上可能卡住几十分钟，而 284 个包早已就位）。
    // 超时后若已有可用引擎就先用它启动，安装在后台继续，下次连接自然生效。
    const deadlineMs = 180_000
    const installDeadline = Date.now() + deadlineMs
    let installResult = ''
    while (Date.now() < installDeadline) {
      await new Promise(r => setTimeout(r, 5000))
      const poll = await sshRun(alias, `cat ${REMOTE_ROOT}/install-done 2>/dev/null || echo RUNNING`)
      const value = poll.stdout.trim()
      if (value !== 'RUNNING' && value !== '') { installResult = value; break }
    }
    if (installResult !== 'OK') {
      const fallback = await sshRun(alias, `test -f ${REMOTE_ROOT}/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js && echo YES || echo NO`)
      if (!fallback.stdout.includes('YES')) {
        const tail = await sshRun(alias, `tail -20 ${REMOTE_ROOT}/npm-install.log 2>/dev/null`)
        throw new RemoteServerError(`${installResult === '' ? '等待安装结果超时且无可用引擎' : 'npm 安装失败'}\n${tail.stdout.slice(-700)}`, '远端引擎安装失败')
      }
      // **不写标记**：写了就等于宣称这个版本已就位，下次会直接跳过安装，于是永远
      // 错线。安装留在后台继续，下次连接再判。
      log(`引擎安装尚未完成（后台继续），先用远端现有引擎启动`)
    } else {
      log('远端引擎安装完成')
      await sshRun(alias, `printf '%s' '${wanted}' > ${markerPath} && echo OK`)
    }
  }

  const bundlePrint = bundleFingerprint(bundles)
  const remotePrint = await sshRun(alias, `cat ${REMOTE_ROOT}/bundles/.fingerprint 2>/dev/null || echo NONE`)
  if (remotePrint.stdout.trim() === bundlePrint) {
    log('bundle 内容未变，跳过搬运')
  } else {
    await sshTarInto(alias, join(bundles[0]!.dir, '..'), bundles.map(b => b.dir.split('/').pop()!), `${REMOTE_ROOT}/bundles`, log, 6)
    await sshRun(alias, `printf '%s\\n' '${bundlePrint}' > ${REMOTE_ROOT}/bundles/.fingerprint && echo OK`)
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
  // 一张清单记下每个已同步文件的内容哈希。没变就不传——**也不触发重启**：远端服务
  // 重启要等就绪行，每次都做会让"连接"从几秒变成一分钟（而 patch/密钥几乎不变）。
  const manifestPath = `${REMOTE_ROOT}/home/.sync-manifest.json`
  const manifestRaw = await sshRun(alias, `cat ${manifestPath} 2>/dev/null || echo '{}'`)
  let manifest: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(manifestRaw.stdout.trim() || '{}')
    if (typeof parsed === 'object' && parsed !== null) manifest = parsed as Record<string, string>
  } catch {
    // 清单损坏：当作空表，重新同步一遍即可。
  }
  let syncedConfig = false

  /** 按内容哈希决定是否同步一个文件到远端 DSH 家目录。 */
  const syncFile = async (localPath: string, remoteDir: string, rename?: string): Promise<void> => {
    if (!existsSync(localPath)) return
    const name = rename ?? localPath.split('/').pop()!
    const hash = createHash('md5').update(readFileSync(localPath)).digest('hex')
    if (manifest[name] === hash) return
    await sshTarInto(alias, join(localPath, '..'), [localPath.split('/').pop()!], remoteDir, log, 4)
    if (rename !== undefined) {
      await sshRun(alias, `mv ${remoteDir}/${localPath.split('/').pop()!} ${remoteDir}/${rename} && echo OK`)
    }
    await sshRun(alias, `chmod 600 ${remoteDir}/${name} && echo OK`)
    manifest[name] = hash
    syncedConfig = true
    log(`已同步 ${name}`)
  }

  await syncFile(opts.profilePatch ?? '', `${REMOTE_ROOT}/home/profiles/${REMOTE_PROFILE}`, 'cordis.patch.yml')
  for (const file of opts.homeFiles ?? []) {
    await syncFile(file, `${REMOTE_ROOT}/home`)
  }
  // profile 里的 patch 与家目录的两份密钥都要能读到；清单本身留在远端供下次比对。
  await sshRun(alias, `printf '%s' '${JSON.stringify(manifest).replaceAll("'", "'\\''")}' > ${manifestPath} && chmod 600 ${manifestPath} && echo OK`)

  return { runtimePath, syncedConfig }
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
 * 远端服务日志（就绪行从这里读；token 只在此文件与 URL 里出现）。
 *
 * **按端口分文件**：单一日志配合"启动前先清空"会让复用判断永远落空——上一轮留下
 * 的服务仍占着端口，新进程同端口启动即 `EADDRINUSE`（2026-09-26 实机）。
 * @param port - 远端监听端口。
 * @returns 该端口专属的日志路径。
 */
function remoteLog(port: number): string {
  return `${REMOTE_ROOT}/server-${String(port)}.log`
}

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
  const outcome = await provisionRemoteRuntime(opts)

  // 配置刚同步过就必须重启：`loadLayeredEnv` 只在进程启动时读 env，复用旧进程会
  // 让刚带过去的密钥对已跑着的服务不生效（用户看到的现象就是"密钥依然缺失"）。
  if (outcome.syncedConfig) {
    log('配置有更新，重启远端服务以加载新的密钥/配置')
    await sshRun(alias, `pkill -f "${REMOTE_ROOT}/runtime/lib/bin.js" 2>/dev/null; sleep 1; echo KILLED`)
  }

  // 候选端口逐个问远端：已在监听且能读到令牌就复用，否则换下一个。
  // 只读日志是不够的——日志会被清空，而进程可能还在（实测撞出 EADDRINUSE）。
  const base = 30100 + (hash(alias) % 900)
  let port = 0
  let entry = ''
  for (let candidate = base; candidate < base + 20; candidate++) {
    const probe = await sshRun(alias, [
      `if ss -ltn 2>/dev/null | grep -q "127.0.0.1:${candidate} "; then`,
      `  grep -o "dsh web: http://127.0.0.1:${candidate}/?token=[A-Za-z0-9_-]*" ${remoteLog(candidate)} 2>/dev/null | tail -1`,
      'else echo FREE; fi',
    ].join('\n'))
    const out = probe.stdout.trim()
    if (out === 'FREE') { port = candidate; break }
    if (out.includes('token=')) { port = candidate; entry = out; break }
    // 端口被占但拿不到令牌（日志丢了）：换下一个，别去撞 EADDRINUSE。
  }
  if (port === 0) throw new RemoteServerError(`base ${String(base)}`, '远端连续 20 个端口都不可用')

  if (entry !== '') {
    log(`复用远端已在跑的服务（端口 ${String(port)}）`)
  } else {
    log(`远端端口 ${String(port)}`)
    const nodeBin = remoteNode.replace(/\/node$/, '')
    const launch = [
      'set -e',
      `export PATH=${nodeBin}:$PATH`,
      `R=${REMOTE_ROOT}`,
      `rm -f ${remoteLog(port)}`,
      `cd $HOME`,
      // 语法是 `dsh <profile> [app 选项…]`——`dsh web` 里的 `web` **就是 profile
      // 名**（web 模板的 profile 恰好叫 web），不是子命令。多写一个 `web` 会被
      // 当成 app 的位置参数（实测 "too many arguments. Expected 0 arguments but
      // got 1: web"）。本地宿主也是这个形状：`dsh web --patch … --port 0`。
      // 入口用**装好的包里自带的**那份（`@deepseek-ai/dsh/lib/bin.js`）：它与引擎同源，
      // 不会像搬本地入口那样与远端引擎错配（实测本地入口在远端报
      // "does not provide an export named 'StartupError'"）。
      // `--profile` 显式给出：`dsh <name>` 的简写是较新 CLI 才有的，旧版直接报
      // "--profile <name> is required"。
      `DSH_HOME=$R/home setsid nohup node $R/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js --profile ${REMOTE_PROFILE} --port ${port} --no-open > ${remoteLog(port)} 2>&1 < /dev/null &`,
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
      const poll = await sshRun(alias, `grep -o "dsh web: http://127.0.0.1:${port}/?token=[A-Za-z0-9_-]*" ${remoteLog(port)} 2>/dev/null | tail -1`)
      entry = poll.stdout.trim()
      if (entry !== '') break
      const failed = await sshRun(alias, `tail -3 ${remoteLog(port)} 2>/dev/null`)
      if (/Error|error:/.test(failed.stdout) && !/did not activate/.test(failed.stdout)) {
        throw new RemoteServerError(failed.stdout.slice(-400), '远端服务启动报错')
      }
    }
    if (entry === '') {
      const tail = await sshRun(alias, `tail -6 ${remoteLog(port)} 2>/dev/null`)
      throw new RemoteServerError(tail.stdout.slice(-400), '远端服务等待就绪超时')
    }
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

/**
 * 把远端脚本写到本地临时文件，供 tar 送过去执行。
 *
 * 为什么不让它走命令行：任何插入 shell 字符串的做法都要再套一层引号，而脚本里
 * 有 `$R`/`$HOME`/引号——套错的代价是静默变形（见上面安装启动处的注释）。
 * @param script - 脚本正文。
 * @param name - 远端文件名。
 * @returns 本地临时文件名。
 */
async function writeScriptFile(script: string, name: string): Promise<string> {
  writeFileSync(join(tmpdir(), name), `${script}\n`)
  return name
}
