/**
 * runtime-manager.ts — QiLin Python sidecar 生命周期管理.
 *
 * 职责：
 *   1. 定位 Python 3.12+ 解释器（系统 python3 / venv python / 用户配置）
 *   2. spawn `python run_gateway.py`（引擎自带 gateway：app.gateway 单进程，
 *      auth / threads / runs / memory / skills / mcp 全部能力）
 *   3. 轮询 /health 直到就绪（或超时）
 *   4. 暴露 stopQiLin() 优雅关闭子进程（SIGTERM → SIGKILL 兜底）
 *
 * 架构：renderer → engine gateway (config.port)
 *
 * 2026-08 重构：删除自研 kcoder_gateway 翻译层与 langgraph dev 平台，
 * 前端直连引擎自带生产级 gateway（vendor/qilin/app/gateway）。
 * 历史：原 QiongQi 时代 engine-host 直接启动引擎；v0.2 曾用双进程
 * （langgraph dev + 自研 gateway），因平台适配层的复杂度与稳定性问题
 * 重构为单进程。
 *
 * 本文件不依赖 QiLin 引擎仓库的任何代码；引擎仅以 pip 依赖 + venv
 * 形式被 run_gateway.py 子进程加载。
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

/** QiLin sidecar 运行配置（由 engine-host.ts 构造传入）。 */
export interface QiLinRuntimeConfig {
  /** Python 解释器绝对路径；未指定时按系统 python3 → venv python 顺序探测。 */
  pythonPath?: string
  /** python-runtime/ 目录绝对路径；未指定时用 <repo>/python-runtime。 */
  runtimeDir?: string
  /** 引擎 gateway 监听端口（renderer-facing，127.0.0.1）。 */
  port: number
  /**
   * 用户数据根目录（v0.2 起统一 ~/.kcoder）。引擎数据 / 配置 / 日志都落在其下。
   * 未指定时用 ~/.kcoder；可用 KCODER_APP_DATA_DIR 环境变量覆盖。
   */
  dataDir?: string
  /** 启动超时毫秒；默认 60000。 */
  startupTimeoutMs?: number
}

/**
 * 解析 KCoder 用户数据根目录（跨平台统一）。
 *
 * 优先级：
 *   1. KCODER_APP_DATA_DIR 环境变量（命令行 / 调试覆盖）
 *   2. ~/.kcoder（产品默认，macOS / Windows / Linux 一致）
 *
 * 选择 ~/.kcoder 而非系统 Application Support 目录：避免 macOS 空格路径
 * 被 sandbox bash 拆词；数据可见可备份；与仓库内调试缓存区分。
 */
export function resolveAppDataDir(): string {
  if (process.env.KCODER_APP_DATA_DIR) {
    return process.env.KCODER_APP_DATA_DIR
  }
  return join(homedir(), '.kcoder')
}

interface RunningHandle {
  child: ChildProcess
  port: number // renderer-facing（= config.port）
  startedAt: number
}

let _running: RunningHandle | null = null

// 开发调试日志：sidecar 的 stdout/stderr 同时写进 <repo>/logs/kcoder-debug.log，
// 每次 startQiLin 覆盖（flags:'w' 截断），便于在终端之外快速翻找诊断信息。
let _debugLogStream: WriteStream | null = null

function openDebugLog(repoRoot: string): WriteStream {
  const logDir = join(repoRoot, 'logs')
  mkdirSync(logDir, { recursive: true })
  const stream = createWriteStream(join(logDir, 'kcoder-debug.log'), { flags: 'w' })
  stream.write(`=== KCoder debug log — ${new Date().toISOString()} ===\n`)
  return stream
}

/**
 * 定位 Python 解释器。优先级：
 *   1. config.pythonPath（用户在 Settings 里显式配置）
 *   2. <runtimeDir>/.venv/bin/python（venv 已就绪）
 *   3. 系统 `python3`
 * 找不到或版本 <3.12 抛错（QiLin requires-python 是 >=3.12）。
 */
function resolvePython(config: QiLinRuntimeConfig): string {
  const candidates: string[] = []
  if (config.pythonPath) candidates.push(config.pythonPath)
  if (config.runtimeDir) {
    candidates.push(join(config.runtimeDir, '.venv', 'bin', 'python'))
    candidates.push(join(config.runtimeDir, '.venv', 'bin', 'python3'))
  }
  candidates.push('python3')

  for (const candidate of candidates) {
    try {
      // 简单存在性检查；系统命令通过 which/shell 后续会验证
      if (candidate.includes('/')) {
        if (!existsSync(candidate)) continue
      }
      return candidate
    } catch {
      continue
    }
  }
  throw new Error(
    `[KCoder] No Python 3.12+ interpreter found. Tried: ${candidates.join(', ')}. ` +
      'Configure one in Settings > Engine > Python Path, or create a venv under python-runtime/.venv.'
  )
}

/**
 * 解析 python-runtime/ 目录绝对路径。
 *
 * 优先级：
 *   1. config.runtimeDir（上层显式指定，最高优先级）
 *   2. KCODER_PYTHON_RUNTIME 环境变量（调试覆盖）
 *   3. 打包模式：<Resources>/python-runtime（electron-builder extraResources）
 *   4. 开发模式：<repo>/python-runtime（__dirname = <repo>/app/out/main，
 *      回溯 3 层到仓库根）
 */
export function resolveRuntimeDir(config?: Partial<QiLinRuntimeConfig>): string {
  if (config?.runtimeDir) return config.runtimeDir
  if (process.env.KCODER_PYTHON_RUNTIME) return process.env.KCODER_PYTHON_RUNTIME
  if (app.isPackaged) return join(process.resourcesPath, 'python-runtime')
  return resolve(__dirname, '..', '..', '..', 'python-runtime')
}

/**
 * 启动 QiLin sidecar（引擎自带 gateway 单进程）。
 *
 * 架构：renderer → engine gateway (config.port)
 *
 * @returns gateway 监听端口（renderer-facing）
 */
export async function startQiLin(config: QiLinRuntimeConfig): Promise<{ port: number }> {
  if (_running) {
    console.warn('[KCoder] QiLin sidecar already running on port', _running.port)
    return { port: _running.port }
  }

  // 自愈：清掉崩溃/强退残留的孤儿 sidecar（多套并存 = 内存溢出元凶）
  killOrphanSidecars()

  // 打开调试日志（每次启动覆盖）；dev 模式写到仓库根 logs/，打包模式落到数据根 logs/
  const repoRoot = app.isPackaged
    ? (config.dataDir || resolveAppDataDir())
    : resolve(__dirname, '..', '..', '..')
  _debugLogStream?.end()
  _debugLogStream = openDebugLog(repoRoot)
  console.log(`[KCoder] Debug log: ${join(repoRoot, 'logs', 'kcoder-debug.log')}`)

  const runtimeDir = resolveRuntimeDir(config)
  if (!existsSync(runtimeDir)) {
    throw new Error(`[KCoder] python-runtime/ not found at ${runtimeDir}`)
  }
  // 回填到 config，使 resolvePython 能探测 <runtimeDir>/.venv/bin/python
  config.runtimeDir = runtimeDir

  // ── v0.2: 用户数据空间统一根 ~/.kcoder ────────────────────────────
  // 数据根通过 KCODER_APP_DATA_DIR 传给 run_gateway.py，由它生成/使用
  // qilin.runtime.yaml（缺则从仓库模板生成，sqlite 落数据根）。
  const appDataDir = config.dataDir || resolveAppDataDir()
  const subDirs = ['config', 'runtime', 'runtime/qilin', 'runtime/qilin/data',
                   'product', 'cache', 'logs', 'backups']
  for (const sub of subDirs) {
    mkdirSync(join(appDataDir, sub), { recursive: true })
  }
  console.log(`[KCoder] App data dir: ${appDataDir}`)

  const pythonPath = resolvePython(config)
  const gatewayPort = config.port
  const timeoutMs = config.startupTimeoutMs || 60000

  console.log(
    `[KCoder] Starting QiLin engine gateway: python=${pythonPath}, port=${gatewayPort}, runtimeDir=${runtimeDir}`
  )

  const sidecarEnv: NodeJS.ProcessEnv = { ...process.env }
  sidecarEnv.KCODER_APP_DATA_DIR = appDataDir
  sidecarEnv.KCODER_GATEWAY_PORT = String(gatewayPort)
  sidecarEnv.KCODER_GATEWAY_HOST = '127.0.0.1'
  sidecarEnv.QILIN_EXTENSIONS_CONFIG_PATH = join(runtimeDir, 'extensions_config.json')
  // run_gateway.py 内部解析 QILIN_CONFIG_PATH（数据根 config）与 QILIN_HOME

  // ── 启动引擎 gateway（单进程，run_gateway.py 入口）──
  const child = spawn(pythonPath, [join(runtimeDir, 'run_gateway.py')], {
    cwd: runtimeDir,
    env: sidecarEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组：uvicorn worker 与 parent 同组，killChild 用 -pid 杀整组。
    detached: true
  })

  forwardLogs(child, 'QiLin')

  child.on('exit', (code, signal) => {
    console.log(`[KCoder] engine gateway exited (code=${code}, signal=${signal})`)
    if (_running?.child === child) {
      _running = null
    }
  })

  await waitForHealth(gatewayPort, timeoutMs)

  _running = {
    child,
    port: gatewayPort,
    startedAt: Date.now()
  }

  console.log(`[KCoder] QiLin engine gateway healthy on port ${gatewayPort}`)
  return { port: gatewayPort }
}

/** 转发子进程 stdout/stderr 到主进程日志 + 调试日志文件（加前缀便于区分）。 */
function forwardLogs(child: ChildProcess, prefix: string): void {
  const toFile = (line: string): void => {
    _debugLogStream?.write(line + '\n')
  }
  child.stdout?.on('data', (chunk: Buffer) => {
    chunk
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        console.log(`[${prefix}] ${line}`)
        toFile(`[${prefix}] ${line}`)
      })
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    chunk
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        console.error(`[${prefix}!] ${line}`)
        toFile(`[${prefix}!] ${line}`)
      })
  })
}

/** 轮询 GET /health（gateway 端点）直到 200 或超时。 */
async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  return waitForHttp(`http://127.0.0.1:${port}/health`, (data: unknown) => {
    const status = (data as { status?: string } | null)?.status ?? ''
    return status === 'ok' || status === 'healthy'
  }, timeoutMs, 'engine gateway /health')
}

/** 通用 HTTP 健康检查轮询。 */
async function waitForHttp(
  url: string,
  validate: (data: unknown) => boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url)
      if (resp.ok) {
        const data = await resp.json()
        if (validate(data)) return
      }
    } catch {
      // 进程还在启动
    }
    const elapsed = Date.now() - start
    if (elapsed > 0 && elapsed % 5000 < 500) {
      console.log(`[KCoder] Waiting for ${label}... (${Math.round(elapsed / 1000)}s)`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`[KCoder] ${label} failed to become healthy within ${timeoutMs}ms`)
}

/** 优雅停止 QiLin sidecar（单进程）。SIGTERM 3s 兜底 SIGKILL。 */
export async function stopQiLin(): Promise<void> {
  if (!_running) return
  const { child, port } = _running
  console.log(`[KCoder] Stopping QiLin sidecar on port ${port}`)

  await killChild(child, 'engine gateway')

  _running = null
  _debugLogStream?.end()
  _debugLogStream = null
}

/** SIGTERM 一个子进程，3s 兜底 SIGKILL。 */
function killChild(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve) => {
    if (child.killed) {
      resolve()
      return
    }
    // 杀整个进程组（spawn 时 detached: true 建组）：langgraph dev 的 worker、
    // gateway 的子线程都会随组终止。负 pid = 组内全部进程。
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal)
      } catch {
        // 组已不存在（进程自己退了）→ 只杀 parent 兜底
        try {
          child.kill(signal)
        } catch {
          /* 已退出 */
        }
      }
    }
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        console.warn(`[KCoder] ${label} did not exit on SIGTERM; sending SIGKILL to group`)
        killGroup('SIGKILL')
      }
      resolve()
    }, 3000)

    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })

    killGroup('SIGTERM')
  })
}

/**
 * 启动前清理孤儿 sidecar（自愈）。
 *
 * Electron 崩溃 / 强杀（Cmd+Q 之外的退出路径）不会执行 before-quit 的
 * stopEngine，残留的 engine gateway 会以随机端口共存堆积——
 * 每套 1 个 Python 进程数百 MB，多套并存即内存溢出 + 持续 IO 发烫。
 *
 * 判据（防误杀，实测踩坑：只按命令行匹配会把**另一个活实例**的引擎
 * 当孤儿杀掉——旧窗口随即「无法连接引擎」）：只杀「父进程已死」的真
 * 孤儿（ppid=1 = 被 launchd 收养）。正常引擎的父进程是本 Electron 或
 * 上一实例退出前的进程链，未退出的实例引擎不满足 ppid=1，不会被杀。
 */
function killOrphanSidecars(): void {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return
  try {
    const out = execSync(
      "pgrep -f 'run_gateway.py|app.gateway' 2>/dev/null || true",
      { encoding: 'utf-8', timeout: 5000 }
    )
    const pids = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && Number(l) !== process.pid)
    for (const pidStr of pids) {
      const pid = Number(pidStr)
      // 真孤儿判据：父进程是 launchd（ppid=1）。父进程活着的 = 别的活实例
      // 的引擎（多窗口/切换瞬间），跳过不杀。
      let ppid = 0
      try {
        ppid = Number(execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf-8' }).trim())
      } catch {
        continue // 进程已消失
      }
      if (ppid !== 1) {
        console.log(`[KCoder] sidecar pid=${pid} still has parent (ppid=${ppid}), skip orphan cleanup`)
        continue
      }
      try {
        process.kill(-pid, 'SIGKILL') // 组杀（worker 同组）
      } catch {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* 已退出 */
        }
      }
      console.warn(`[KCoder] killed orphan sidecar pid=${pid} (ppid=1)`)
    }
  } catch {
    // pgrep 不存在等 — 静默（清理是尽力而为）
  }
}

/** 当前 sidecar 是否在运行（engine gateway 未退出）。 */
export function isQiLinRunning(): boolean {
  return _running !== null && !_running.child.killed
}

/** 当前 sidecar 的端口（未运行返回 0）。 */
export function getQiLinPort(): number {
  return _running?.port ?? 0
}
