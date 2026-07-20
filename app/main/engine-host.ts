import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'

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
function getDefaultConfig(): EngineConfig {
  return {
    port: 18899 + Math.floor(Math.random() * 1000), // Random port to avoid conflicts
    dataDir: join(app.getPath('userData'), 'engine-data'),
    runtimeToken: randomBytes(32).toString('hex'),
    apiKey: process.env.KCODER_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.KCODER_BASE_URL || 'https://api.deepseek.com',
    model: process.env.KCODER_MODEL || 'deepseek-chat',
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

  // Log configuration status
  if (!fullConfig.apiKey) {
    console.log('[KCoder] No API key configured - engine will start in standby mode. Configure models in Settings.')
  }

  console.log(`[KCoder] Engine config: port=${fullConfig.port}, model=${fullConfig.model}, baseUrl=${fullConfig.baseUrl}`)

  try {
    // Dynamic import to avoid bundling issues
    const { createCodingAgent } = await import('@qiongqi/preset-coding')
    const { createHttpServer } = await import('@qiongqi/http')

    console.log('[KCoder] Creating coding agent...')
    const agent = await createCodingAgent({
      host: '127.0.0.1',
      port: fullConfig.port,
      dataDir: fullConfig.dataDir,
      runtimeToken: fullConfig.runtimeToken,
      // Use placeholder if no key - engine starts but model calls will fail until configured
      apiKey: fullConfig.apiKey || 'pending-configuration',
      baseUrl: fullConfig.baseUrl,
      model: fullConfig.model,
      approvalPolicy: fullConfig.approvalPolicy,
      sandboxMode: 'workspace-write',
      tokenEconomyMode: true,
      insecure: false
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
