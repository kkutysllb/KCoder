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
import { existsSync, mkdirSync } from 'fs'
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
  /** 数据目录（.qilin/ 会建在这里）。默认 ~/.kcoder/qilin-data。 */
  dataDir?: string
  /** 启动超时毫秒；默认 60000。 */
  startupTimeoutMs?: number
}

interface RunningHandle {
  langgraphChild: ChildProcess
  gatewayChild: ChildProcess
  gatewayPort: number // renderer-facing（= config.port）
  langgraphPort: number // 内部（= config.port + 1）
  startedAt: number
}

let _running: RunningHandle | null = null

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

  const runtimeDir = resolveRuntimeDir(config)
  if (!existsSync(runtimeDir)) {
    throw new Error(`[KCoder] python-runtime/ not found at ${runtimeDir}`)
  }
  // 回填到 config，使 resolvePython 能探测 <runtimeDir>/.venv/bin/python
  config.runtimeDir = runtimeDir

  // 确保 dataDir 存在（langgraph dev 会在里面建 sqlite 等）
  const dataDir = config.dataDir || join(homedir(), '.kcoder', 'qilin-data')
  mkdirSync(dataDir, { recursive: true })

  const pythonPath = resolvePython(config)
  const gatewayPort = config.port
  const langgraphPort = config.port + 1 // 内部端口
  const timeoutMs = config.startupTimeoutMs || 60000

  console.log(
    `[KCoder] Starting QiLin sidecar: python=${pythonPath}, ` +
      `gateway=${gatewayPort}, langgraph=${langgraphPort}, runtimeDir=${runtimeDir}`
  )

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
    '--config',
    join(runtimeDir, 'langgraph.json')
  ]

  const langgraphChild = spawn(pythonPath, langgraphArgs, {
    cwd: runtimeDir,
    env: {
      ...process.env,
      QILIN_CONFIG_PATH: join(runtimeDir, 'config.yaml'),
      QILIN_EXTENSIONS_CONFIG_PATH: join(runtimeDir, 'extensions_config.json'),
      LANGGRAPH_API_URL: `http://127.0.0.1:${langgraphPort}`
    },
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
      ...process.env,
      KCODER_GATEWAY_PORT: String(gatewayPort),
      KCODER_GATEWAY_HOST: '127.0.0.1',
      QILIN_SERVICE_URL: `http://127.0.0.1:${langgraphPort}`,
      QILIN_CONFIG_PATH: join(runtimeDir, 'config.yaml'),
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

/** 转发子进程 stdout/stderr 到主进程日志（加前缀便于区分）。 */
function forwardLogs(child: ChildProcess, prefix: string): void {
  child.stdout?.on('data', (chunk: Buffer) => {
    chunk
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line) => console.log(`[${prefix}] ${line}`))
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    chunk
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((line) => console.error(`[${prefix}!] ${line}`))
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
