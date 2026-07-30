/**
 * engine-host.ts — KCoder 后端引擎宿主入口（QiLin sidecar 版本）.
 *
 * 本模块 spawn 一个独立的 QiLin Python sidecar（基于 LangGraph
 * Platform），通过 127.0.0.1:<port> HTTP/SSE 通信。
 * 对外导出签名（EngineConfig、startEngine、stopEngine、getEnginePort、
 * getEngineToken、getEngineDataDir）完全保持不变，KCoder renderer 无感。
 *
 * 硬约束：QiLin 引擎仓库（https://github.com/kkutysllb/QiLin）只读；所有
 * 适配代码在 KCoder 仓库内。QiLin 以 pip 依赖形式被 sidecar 子进程加载。
 *
 * MVP 阶段：
 *   - apiKey/baseUrl/model 暂不注入 sidecar（占位即可启动）；Phase 2 通过
 *     KCoder model store + QiLin config reload 注入真实凭据。
 *   - approvalPolicy 暂由 sidecar 默认（auto）；Phase 2 接 QiLin interrupt。
 */

import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'

import {
  startQiLin,
  stopQiLin,
  getQiLinPort,
  isQiLinRunning,
  type QiLinRuntimeConfig
} from './qilin-runtime-manager'
import { syncEngineModelsBestEffort } from './qilin-config-injector'

// Engine configuration（保留原签名，renderer 通过 ipc 消费这些字段元信息）
export interface EngineConfig {
  port: number
  dataDir: string
  runtimeToken: string
  // Fallback model fields. Sidecar 自身用 config.yaml 里的占位模型启动；
  // 真实凭据由 Settings 页面写入 KCoder model store，Phase 2 注入 QiLin。
  apiKey: string
  baseUrl: string
  model: string
  approvalPolicy: 'auto' | 'on-request' | 'never' | 'untrusted' | 'suggest'
}

// Default configuration. All user data lives under ~/.kcoder (never in repo).
function getDefaultConfig(): EngineConfig {
  return {
    port: 18899 + Math.floor(Math.random() * 1000), // 与原版相同的随机端口范围
    dataDir: join(homedir(), '.kcoder', 'qilin-data'),
    runtimeToken: randomBytes(32).toString('hex'),
    apiKey: process.env.KCODER_API_KEY || '',
    baseUrl: process.env.KCODER_BASE_URL || '',
    model: process.env.KCODER_MODEL || '',
    approvalPolicy: 'auto'
  }
}

let enginePort: number = 0
let engineToken: string = ''
let engineDataDir: string = getDefaultConfig().dataDir

/**
 * Start the QiLin coding agent engine (Python sidecar).
 *
 * Spawns a `langgraph dev` subprocess inside python-runtime/, waits for the
 * LangGraph Platform /ok endpoint to return 200, then returns. The renderer
 * can immediately hit http://127.0.0.1:<port>/v1/* (the gateway translation
 * layer is added in Phase 2; in Phase 1 only /ok + native LangGraph routes
 * are available).
 */
export async function startEngine(config?: Partial<EngineConfig>): Promise<void> {
  const fullConfig = { ...getDefaultConfig(), ...config }
  engineToken = fullConfig.runtimeToken
  engineDataDir = fullConfig.dataDir

  if (!process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS = '*'
  }

  if (!fullConfig.apiKey) {
    console.log('[KCoder] No API key configured - QiLin will start in standby. Configure models in Settings.')
  }

  console.log(
    `[KCoder] Engine config: port=${fullConfig.port}, model=${fullConfig.model}, baseUrl=${fullConfig.baseUrl}`
  )

  // 把 EngineConfig 翻译成 QiLinRuntimeConfig（runtime-manager 的入参）
  const runtimeConfig: QiLinRuntimeConfig = {
    port: fullConfig.port,
    dataDir: fullConfig.dataDir,
    // runtimeDir / pythonPath 用 runtime-manager 的探测默认值（<repo>/python-runtime）
    // 用户可以在 Settings 里覆盖；Phase 2 接入
    startupTimeoutMs: 60000
  }

  try {
    const { port } = await startQiLin(runtimeConfig)
    enginePort = port
    console.log(`[KCoder] QiLin sidecar listening on port ${port}`)
  } catch (error) {
    console.error('[KCoder] Failed to start QiLin sidecar:', error)
    throw error
  }

  // 引擎启动后防御性注入：把已有 model profiles 写入 config.yaml。
  // 覆盖“用户不打开 Settings 但引擎重启”场景。失败不阻塞启动。
  try {
    await syncEngineModelsBestEffort(fullConfig.dataDir)
  } catch (err) {
    console.warn('[KCoder] Best-effort config injection failed (non-fatal):', err)
  }
}

/**
 * Stop the engine gracefully.
 *
 * SIGTERM the Python sidecar; the runtime-manager handles the 3s SIGKILL
 * fallback. Safe to call multiple times.
 */
export async function stopEngine(): Promise<void> {
  if (!isQiLinRunning()) {
    console.log('[KCoder] Engine already stopped')
    return
  }
  try {
    await stopQiLin()
    console.log('[KCoder] Engine stopped')
  } catch (error) {
    console.error('[KCoder] Error stopping engine:', error)
  } finally {
    enginePort = 0
  }
}

/**
 * Get the port the engine is running on (0 if not started).
 *
 * Renderer 通过 ipc 调这个函数，拿到 port 后直接 fetch http://127.0.0.1:<port>/v1/*
 * 行为与 QiongQi 版本完全一致。
 */
export function getEnginePort(): number {
  return enginePort || getQiLinPort()
}

/**
 * Get the runtime token for API authentication.
 *
 * 注意：QiLin sidecar 在 MVP 阶段不做 token 鉴权（loopback only）。
 * 这个值仍然返回，保持 ipc 契约；renderer 把它放进 X-Engine-Token header，
 * sidecar 会忽略（Phase 2 接 QiLin auth 时再启用）。
 */
export function getEngineToken(): string {
  return engineToken
}

/**
 * Get the engine data directory.
 *
 * Sidecar 把 sqlite / .qilin/ 等运行时数据写在这里，KCoder 的 model store
 * 也通过这个路径找配置文件（Phase 2 用）。
 */
export function getEngineDataDir(): string {
  return engineDataDir
}
