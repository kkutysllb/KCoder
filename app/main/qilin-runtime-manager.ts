/**
 * runtime-manager.ts — QiLin Python sidecar 生命周期管理.
 *
 * 职责：
 *   1. 定位 Python 3.12+ 解释器（系统 python3 / venv python / 用户配置）
 *   2. spawn `langgraph dev` 子进程（QiLin service，内部端口）
 *   3. spawn `python -m kcoder_gateway.main` 子进程（gateway，renderer-facing 端口）
 *   4. 轮询 /ok + /health 直到两个进程就绪（或超时）
 *   5. 暴露 stopQiLin() 优雅关闭两个子进程（SIGTERM → SIGKILL 兜底）
 *
 * 架构：renderer → gateway (config.port) → langgraph dev (config.port+1)
 *   - gateway 端口是对外暴露的（renderer 调 /v1/*）
 *   - langgraph dev 端口是内部的（gateway 代理到它）
 *
 * 历史：原 QiongQi 时代的 engine-host 在主进程内直接启动引擎；新方案
 * 改为 spawn 两个独立的 Python 子进程。KCoder renderer 完全无感。
 *
 * 本文件不依赖 QiLin 引擎仓库的任何代码；QiLin 仅以 pip 依赖形式被 langgraph dev
 * 子进程加载。
 */

import { spawn, type ChildProcess } from 'child_process'
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
  /** Gateway 监听端口（renderer-facing，127.0.0.1）。langgraph dev 用 port+1。 */
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
  langgraphChild: ChildProcess
  gatewayChild: ChildProcess
  gatewayPort: number // renderer-facing（= config.port）
  langgraphPort: number // 内部（= config.port + 1）
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
 * 启动 QiLin sidecar（langgraph dev + gateway 两个子进程）。
 *
 * 架构：renderer → gateway (config.port) → langgraph dev (config.port+1)
 *
 * @returns gateway 监听端口（renderer-facing）
 */
export async function startQiLin(config: QiLinRuntimeConfig): Promise<{ port: number }> {
  if (_running) {
    console.warn('[KCoder] QiLin sidecar already running on port', _running.gatewayPort)
    return { port: _running.gatewayPort }
  }

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
  // 建立六大子目录（config/runtime/product/cache/logs/backups），并把数据根
  // 通过 KCODER_APP_DATA_DIR 环境变量传给 sidecar。sidecar 内部的
  // KCoderDataSpace 模块负责生成 qilin.runtime.yaml + 迁移 v0.1 散落数据。
  const appDataDir = config.dataDir || resolveAppDataDir()
  const subDirs = ['config', 'runtime', 'runtime/qilin', 'runtime/qilin/data',
                   'runtime/langgraph_api', 'product', 'cache', 'logs', 'backups']
  for (const sub of subDirs) {
    mkdirSync(join(appDataDir, sub), { recursive: true })
  }
  console.log(`[KCoder] App data dir: ${appDataDir}`)

  const pythonPath = resolvePython(config)
  const gatewayPort = config.port
  const langgraphPort = config.port + 1 // 内部端口
  const timeoutMs = config.startupTimeoutMs || 60000

  console.log(
    `[KCoder] Starting QiLin sidecar: python=${pythonPath}, ` +
      `gateway=${gatewayPort}, langgraph=${langgraphPort}, runtimeDir=${runtimeDir}`
  )

  // sidecar 子进程共享的数据根 / QiLin 配置路径环境变量
  // 注意：QILIN_CONFIG_PATH 最终指向 <appDataDir>/config/qilin.runtime.yaml，
  // 该文件由 sidecar 的 KCoderDataSpace 在首次启动时生成。这里检查：
  //   - 已存在 → 直接用（langgraph dev + gateway 都读它）
  //   - 不存在 → 让 sidecar 自己生成；langgraph dev 首次启动用仓库内 config.yaml
  //     作为 fallback，gateway 启动后 KCoderDataSpace 会生成 runtime.yaml 供下次使用
  const sidecarEnv: NodeJS.ProcessEnv = { ...process.env }
  const runtimeConfigPath = join(appDataDir, 'config', 'qilin.runtime.yaml')
  if (existsSync(runtimeConfigPath)) {
    sidecarEnv.QILIN_CONFIG_PATH = runtimeConfigPath
    console.log(`[KCoder] Using existing runtime config: ${runtimeConfigPath}`)
  } else {
    // 首次启动：langgraph dev 用仓库内 config.yaml，gateway 启动后会生成
    // runtime.yaml 供下次使用
    sidecarEnv.QILIN_CONFIG_PATH = join(runtimeDir, 'config.yaml')
    console.log(`[KCoder] First run: using template config, will generate runtime.yaml`)
  }
  sidecarEnv.KCODER_APP_DATA_DIR = appDataDir
  sidecarEnv.QILIN_HOME = join(appDataDir, 'runtime', 'qilin')

  // ── 1. 启动 langgraph dev（QiLin service，内部端口）
  const langgraphArgs = [
    '-m',
    'langgraph_cli',
    'dev',
    '--port',
    String(langgraphPort),
    '--host',
    '127.0.0.1',
    '--no-browser',
    '--allow-blocking', // make_lead_agent 含同步阻塞调用（os.getcwd 等）；dev 模式必需
    // 关闭热重载：dev 的 watcher 盯整个 CWD（含 .langgraph_api/*.pckl checkpoint
    // 存储），每次 run 写 pckl 都触发 "changes detected" → 重载循环 → 新 run
    // 全部卡 pending、SSE 流静默（前端表现为永久停止状态）。KCoder 的引擎代码
    // 改动走重启生效，不需要热重载。
    '--no-reload',
    '--config',
    join(runtimeDir, 'langgraph.json')
  ]

  const langgraphChild = spawn(pythonPath, langgraphArgs, {
    cwd: runtimeDir,
    env: sidecarEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  forwardLogs(langgraphChild, 'QiLin')

  langgraphChild.on('exit', (code, signal) => {
    console.log(`[KCoder] langgraph dev exited (code=${code}, signal=${signal})`)
    if (_running?.langgraphChild === langgraphChild) {
      _running = null
    }
  })

  await waitForOk(langgraphPort, timeoutMs)
  console.log(`[KCoder] QiLin service healthy on internal port ${langgraphPort}`)

  // ── 2. 启动 gateway（renderer-facing 端口）
  const gatewayChild = spawn(pythonPath, ['-m', 'kcoder_gateway.main'], {
    cwd: runtimeDir,
    env: {
      ...sidecarEnv,
      KCODER_GATEWAY_PORT: String(gatewayPort),
      KCODER_GATEWAY_HOST: '127.0.0.1',
      QILIN_SERVICE_URL: `http://127.0.0.1:${langgraphPort}`,
      QILIN_EXTENSIONS_CONFIG_PATH: join(runtimeDir, 'extensions_config.json')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  forwardLogs(gatewayChild, 'Gateway')

  gatewayChild.on('exit', (code, signal) => {
    console.log(`[KCoder] gateway exited (code=${code}, signal=${signal})`)
    if (_running?.gatewayChild === gatewayChild) {
      _running = null
    }
  })

  await waitForHealth(gatewayPort, timeoutMs)

  _running = {
    langgraphChild,
    gatewayChild,
    gatewayPort,
    langgraphPort,
    startedAt: Date.now()
  }

  console.log(`[KCoder] QiLin sidecar healthy on port ${gatewayPort} (gateway)`)
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
    return typeof data === 'object' && data !== null && (data as { status?: string }).status === 'ok'
  }, timeoutMs, 'gateway /health')
}

/** 轮询 GET /ok（LangGraph Platform 标准端点）直到 200 或超时。 */
async function waitForOk(port: number, timeoutMs: number): Promise<void> {
  return waitForHttp(
    `http://127.0.0.1:${port}/ok`,
    (data: unknown) =>
      typeof data === 'object' && data !== null && (data as { ok?: boolean }).ok === true,
    timeoutMs,
    'langgraph /ok'
  )
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

/** 优雅停止 QiLin sidecar（gateway + langgraph dev）。SIGTERM 3s 兜底 SIGKILL。 */
export async function stopQiLin(): Promise<void> {
  if (!_running) return
  const { gatewayChild, langgraphChild, gatewayPort } = _running
  console.log(`[KCoder] Stopping QiLin sidecar on port ${gatewayPort}`)

  // 先停 gateway（停止接受新请求），再停 langgraph dev
  await killChild(gatewayChild, 'gateway')
  await killChild(langgraphChild, 'langgraph dev')

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
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        console.warn(`[KCoder] ${label} did not exit on SIGTERM; sending SIGKILL`)
        child.kill('SIGKILL')
      }
      resolve()
    }, 3000)

    child.once('exit', () => {
      clearTimeout(killTimer)
      resolve()
    })

    child.kill('SIGTERM')
  })
}

/** 当前 sidecar 是否在运行（gateway + langgraph dev 都未退出）。 */
export function isQiLinRunning(): boolean {
  return _running !== null && !_running.gatewayChild.killed && !_running.langgraphChild.killed
}

/** 当前 sidecar 的 gateway 端口（未运行返回 0）。 */
export function getQiLinPort(): number {
  return _running?.gatewayPort ?? 0
}
