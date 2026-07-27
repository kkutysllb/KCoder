import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { existsSync } from 'fs'

// Engine configuration
export interface EngineConfig {
  port: number
  dataDir: string
  runtimeToken: string
  // Fallback model used before the user configures anything in Settings.
  // The new engine is model-neutral: it ships no default provider. We pass
  // these top-level fields so the HTTP serve runtime can boot and so threads
  // have a default model to use until the user activates a profile via the
  // Settings page (which writes per-user profiles through UserDataStore).
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
    // The engine is model-neutral — no implicit provider. These remain empty
    // until the user configures a model in Settings. The runtime still boots
    // (standby mode); model CRUD happens through the product-side model store.
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
 * Resolve the bundled skill root. Skills live under <repo>/engine/skills.
 * The new engine no longer relies on `process.cwd()` for skill discovery, so
 * we pass this explicitly via `skillRoots`.
 *
 * The bundle's location differs between dev (electron-vite serves from
 * app/out/main) and a packaged app, so we try a set of candidate paths and
 * return the first that exists on disk.
 */
function resolveBuiltinSkillRoots(): string[] {
  const candidates: string[] = []
  // `__dirname` is resolved by esbuild at bundle time. In dev it points at
  // app/out/main, so three levels up reaches the repo root.
  candidates.push(join(__dirname, '..', '..', '..', 'engine', 'skills'))
  candidates.push(join(__dirname, '..', '..', 'engine', 'skills'))
  // cwd based (electron-vite dev sets cwd to the app or repo dir)
  candidates.push(join(process.cwd(), 'engine', 'skills'))
  candidates.push(join(process.cwd(), '..', 'engine', 'skills'))

  const root = candidates.find((candidate) => existsSync(candidate))
  if (root) {
    console.log(`[KCoder] Resolved builtin skill root: ${root}`)
  } else {
    console.warn(`[KCoder] Could not resolve builtin skill root; tried: ${candidates.join(', ')}`)
  }
  return root ? [root] : []
}

/**
 * Start the QiongQi coding agent engine.
 *
 * The engine is model-neutral and starts in standby mode when no model is
 * configured. Users configure models in Settings, which the product manages
 * through the engine's UserDataStore (per-user model profiles).
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

  try {
    // Dynamic import to avoid bundling issues
    const { createCodingAgent } = await import('@qiongqi/preset-coding')
    const { createHttpServer } = await import('@qiongqi/http')
    const { QiongqiCapabilitiesConfig } = await import('@qiongqi/contracts')

    // Skills + subagents are enabled. CRITICAL: the new engine defaults its
    // work mode to 'office'; KCoder is a coding app, so we must explicitly
    // pin `defaultModeId: 'coding'` to mount the coding skill set.
    //
    // The bundled skill bundle is passed both via `skillRoots` (the engine's
    // explicit builtin-root parameter) AND via `capabilities.skills.roots`.
    // The latter is the authoritative source the SkillPluginHost scans via
    // `discoverPlugins`, and is robust to any builtin-root filtering inside
    // the engine; passing both keeps us aligned with the engine's own
    // preset-coding example.
    const skillRoots = resolveBuiltinSkillRoots()
    console.log('[KCoder] Passing skillRoots to engine:', skillRoots)
    const capabilities = QiongqiCapabilitiesConfig.parse({
      skills: {
        enabled: true,
        roots: skillRoots,
        workModes: { defaultModeId: 'coding' }
      },
      subagents: { enabled: true }
    })

    console.log('[KCoder] Creating coding agent...')
    // The engine's serve config schema rejects empty model/apiKey/baseUrl
    // (min length 1) but treats them as optional. KCoder boots in standby
    // before the user configures a model, so we substitute a non-empty
    // placeholder when the field is unset. The placeholder is never used for
    // a real request: once the user activates a profile in Settings, the
    // per-user profile (UserDataStore) takes precedence at request time via
    // UserScopedModelClient. A turn sent before any model is configured will
    // fail at the provider call with a clear "model not configured" error,
    // which is the correct behaviour.
    const placeholder = 'pending-configuration'
    const agent = await createCodingAgent({
      host: '127.0.0.1',
      port: fullConfig.port,
      dataDir: fullConfig.dataDir,
      runtimeToken: fullConfig.runtimeToken,
      apiKey: fullConfig.apiKey || placeholder,
      baseUrl: fullConfig.baseUrl || placeholder,
      model: fullConfig.model || placeholder,
      approvalPolicy: fullConfig.approvalPolicy,
      sandboxMode: 'workspace-write',
      tokenEconomyMode: true,
      insecure: false,
      capabilities,
      // Explicitly mount the bundled skill bundle. The new engine no longer
      // derives skill roots from cwd, so this is required.
      skillRoots
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
      // The serve handle exposes `close()` (which also shuts down the agent).
      if (engineRuntime.close) {
        await engineRuntime.close()
      } else if (engineRuntime.stop) {
        await engineRuntime.stop()
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
 * Get the engine data directory (the product-side model store reads/writes
 * per-user profiles under `<dataDir>/system/data/user-data.json`).
 */
export function getEngineDataDir(): string {
  return getDefaultConfig().dataDir
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

  throw new Error(`Engine failed to start within ${timeout}ms. Check engine logs.`)
}
