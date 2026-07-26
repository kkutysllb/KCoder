import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'

// Engine configuration
export interface EngineConfig {
  port: number
  dataDir: string
  runtimeToken: string
  apiKey: string
  baseUrl: string
  model: string
  approvalPolicy: 'auto' | 'on-request' | 'never' | 'untrusted' | 'suggest'
}

// Default configuration
// All user data lives under ~/.kcoder (never in the project root)
function getDefaultConfig(): EngineConfig {
  return {
    port: 18899 + Math.floor(Math.random() * 1000), // Random port to avoid conflicts
    dataDir: join(homedir(), '.kcoder', 'engine-data'),
    runtimeToken: randomBytes(32).toString('hex'),
    // 不预设任何模型 — 完全由用户在设置页配置
    apiKey: process.env.KCODER_API_KEY || '',
    baseUrl: process.env.KCODER_BASE_URL || '',
    model: process.env.KCODER_MODEL || '',
    approvalPolicy: 'auto'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engineRuntime: any = null
let enginePort: number = 0
let engineToken: string = ''

/**
 * Start the QiongQi coding agent engine
 * Engine starts without requiring API key - users can configure models later via settings.
 */
export async function startEngine(config?: Partial<EngineConfig>): Promise<void> {
  const fullConfig = { ...getDefaultConfig(), ...config }
  enginePort = fullConfig.port
  engineToken = fullConfig.runtimeToken

  // Enable CORS for the local engine — the renderer (Vite dev server or
  // file://) is cross-origin relative to http://127.0.0.1:<port>.
  // Safe because the engine only binds loopback and requires token auth.
  if (!process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS = '*'
  }

  // Log configuration status
  if (!fullConfig.apiKey) {
    console.log('[KCoder] No API key configured - engine will start in standby mode. Configure models in Settings.')
  }

  console.log(`[KCoder] Engine config: port=${fullConfig.port}, model=${fullConfig.model}, baseUrl=${fullConfig.baseUrl}`)

  // 清理磁盘上残留的旧 serve 配置（之前硬编码 deepseek-chat 写入的）
  // 当 model 为空（待配置状态）时，移除 config.json 里 serve.model/apiKey/baseUrl
  if (!fullConfig.model) {
    try {
      const configPath = join(fullConfig.dataDir, 'config.json')
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed?.serve?.model || parsed?.serve?.apiKey || parsed?.serve?.baseUrl) {
        delete parsed.serve.model
        delete parsed.serve.apiKey
        delete parsed.serve.baseUrl
        writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8')
        console.log('[KCoder] Cleared stale serve.model/apiKey/baseUrl from disk config')
      }
    } catch { /* 配置文件不存在或解析失败 — 忽略 */ }
  }

  try {
    // Dynamic import to avoid bundling issues
    const { createCodingAgent } = await import('@qiongqi/preset-coding')
    const { createHttpServer } = await import('@qiongqi/http')
    const { QiongqiCapabilitiesConfig } = await import('@qiongqi/contracts')

    // Skills default to disabled when capabilities is omitted — explicitly
    // enable them so the builtin skill bundle (engine/skills/) is mounted.
    const capabilities = QiongqiCapabilitiesConfig.parse({
      skills: { enabled: true },
      subagents: { enabled: true }
    })

    console.log('[KCoder] Creating coding agent...')
    // 引擎以待配置状态启动 — 空的 model/apiKey/baseUrl 会被
    // qiongqiConfigFromRuntimeOptions 过滤掉，不写入 serve 配置
    const agent = await createCodingAgent({
      host: '127.0.0.1',
      port: fullConfig.port,
      dataDir: fullConfig.dataDir,
      runtimeToken: fullConfig.runtimeToken,
      apiKey: fullConfig.apiKey,
      baseUrl: fullConfig.baseUrl,
      model: fullConfig.model,
      approvalPolicy: fullConfig.approvalPolicy,
      sandboxMode: 'workspace-write',
      tokenEconomyMode: true,
      insecure: false,
      capabilities
    })

    console.log('[KCoder] Agent runtime created, starting HTTP server...')
    const serverHandle = await createHttpServer({
      agent,
      host: '127.0.0.1',
      port: fullConfig.port
    })

    engineRuntime = serverHandle
    console.log(`[KCoder] HTTP server listening on port ${serverHandle.port}`)

    // Wait for engine to be ready
    await waitForHealthy(serverHandle.port)
  } catch (error) {
    console.error('[KCoder] Failed to start engine:', error)
    throw error
  }
}

/**
 * Stop the engine gracefully
 */
export async function stopEngine(): Promise<void> {
  if (engineRuntime) {
    try {
      if (engineRuntime.stop) {
        await engineRuntime.stop()
      } else if (engineRuntime.close) {
        await engineRuntime.close()
      }
    } catch (error) {
      console.error('[KCoder] Error stopping engine:', error)
    }
    engineRuntime = null
    console.log('[KCoder] Engine stopped')
  }
}

/**
 * Get the port the engine is running on
 */
export function getEnginePort(): number {
  return enginePort
}

/**
 * Get the runtime token for API authentication
 */
export function getEngineToken(): string {
  return engineToken
}

/**
 * Wait for the engine health check to pass
 * Note: /health endpoint is unauthenticated
 */
async function waitForHealthy(port: number, timeout = 30000): Promise<void> {
  const startTime = Date.now()
  const url = `http://127.0.0.1:${port}/health`

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        console.log('[KCoder] Engine health check passed:', data)
        return
      }
      console.log(`[KCoder] Health check returned ${response.status}, retrying...`)
    } catch (error) {
      // Engine not ready yet, retry
      const elapsed = Date.now() - startTime
      if (elapsed % 5000 < 500) {
        console.log(`[KCoder] Waiting for engine... (${Math.round(elapsed / 1000)}s)`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Engine failed to start within ${timeout}ms. Check if API key is configured.`)
}
