import { mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildRouter } from './routes/index.js'
import type { QiongqiConfigStore, ServerRuntime } from './routes/server-runtime.js'
import { startNodeHttpServer, type NodeHttpServerHandle } from './node-http-server.js'
import type { DispatchRequestOptions } from './http-server.js'
import { FileAttachmentStore } from '@qiongqi/attachments'
import { InMemoryApprovalGate } from '@qiongqi/adapter-storage'
import { InMemoryUserInputGate } from '@qiongqi/adapter-storage'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { FileEffectResultStore, FileSessionStore, FileTaskStateStore, FileThreadStore, FileRunEventStore, FileRunStateStore } from '@qiongqi/adapter-storage'
import { HybridSessionStore, HybridThreadStore } from '@qiongqi/adapter-storage'
import {
  DynamicRoutedModelCompatClient,
  ModelCompatClient,
  RoutedModelCompatClient,
  type RoutedModelConfig
} from '@qiongqi/adapter-model'
import { CapabilityRegistry } from '@qiongqi/adapter-tools'
import { buildGoalLocalTools } from '@qiongqi/adapter-tools'
import { buildTodoLocalTools } from '@qiongqi/adapter-tools'
import { LocalToolHost, buildDefaultLocalTools, createActivateSkillTool } from '@qiongqi/adapter-tools'
import { buildMcpToolProviders } from '@qiongqi/adapter-tools'
import { buildMemoryToolProviders } from '@qiongqi/adapter-tools'
import { buildDelegationToolProviders } from '@qiongqi/adapter-tools'
import { buildWebToolProviders } from '@qiongqi/adapter-tools'
import { LocalWorkspaceInspector } from '@qiongqi/adapter-storage'
import { createImmutablePrefix } from '@qiongqi/cache'
import {
  DEFAULT_WORK_MODES,
  buildRuntimeCapabilityManifest,
  type QiongqiCapabilitiesConfig
} from '@qiongqi/contracts'
import type { ApprovalPolicy, SandboxMode } from '@qiongqi/contracts'
import {
  createKernelV3NodeHandlers,
  EffectCommitCoordinator,
  KernelV3TurnRunner,
  ModelProposalRunner,
  PromptBuilder,
  resolveRuntimeRolloutMode,
  ToolRuntimeV3,
  type OrchestrationMode
} from '@qiongqi/loop'
import type {
  ToolHost,
  ToolHostContext,
  ToolHostResult,
  ToolHostPreparation,
  ToolCallLike,
  ModelClient
} from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import { makeApprovalItem, makeUserInputItem } from '@qiongqi/domain'
import {
  AgentCardSchema,
  type AgentCard,
  type SkillSummary
} from '@qiongqi/contracts'
import { TurnOrchestrator } from '@qiongqi/loop'
import { EventedTurnOrchestrator } from '@qiongqi/loop'
import { FileTurnStateStore } from '@qiongqi/loop'
import { TurnEventBus } from '@qiongqi/loop'
import { defaultLoopPlan } from '@qiongqi/loop'
import { defaultLoopEvaluator } from '@qiongqi/loop'
import { FileA2ATaskStore } from './a2a-task-store.js'
import { ContextCompactor } from '@qiongqi/loop'
import type { TokenEconomyConfig } from '@qiongqi/loop'
import {
  modelCapabilitiesForModel,
  modelContextProfilesFromConfig,
  type ContextCompactionConfig,
  type ModelConfig
} from '@qiongqi/loop'
import {
  DEFAULT_STORAGE_CONFIG,
  expandHomePath,
  type RuntimeTuningConfig,
  type StorageConfig
} from '@qiongqi/contracts'
import { InflightTracker } from '@qiongqi/loop'
import { SteeringQueue } from '@qiongqi/loop'
import { RandomIdGenerator } from '@qiongqi/ports'
import type { SessionStore } from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import { QIONGQI_SYSTEM_PROMPT } from '@qiongqi/contracts'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { ThreadService } from '@qiongqi/services'
import { TurnService } from '@qiongqi/services'
import { ReviewService } from './review-service.js'
import { UsageService } from '@qiongqi/services'
import type { UsageEvent } from '@qiongqi/contracts'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  normalizeModelEndpointFormat,
  type ModelEndpointFormat
} from '@qiongqi/contracts'
import { SkillRuntime } from '@qiongqi/skills'

type RuntimeSkillsConfig = NonNullable<QiongqiCapabilitiesConfig['skills']>
type RuntimeWorkModeConfig = RuntimeSkillsConfig['workModes']['modes'][string]
type RuntimeModeSkillOverride = RuntimeSkillsConfig['modeSkillOverrides'][string]
import { SkillPluginHost } from '@qiongqi/skills'
import { buildSkillToolProvider, type SkillToolExecutor } from '@qiongqi/skills'
import { createBashLocalTool } from '@qiongqi/adapter-tools'
import { collectSkillMcpServers } from '@qiongqi/skills'
import { FileMemoryStore } from '@qiongqi/memory'
import { DelegationRuntime, FileDelegationStore } from '@qiongqi/delegation'
import { createChildAgentExecutor } from '@qiongqi/delegation'
import { PeerRegistry, FilePeerStore } from '@qiongqi/delegation'
import { HttpPeerTransport } from './http-peer-transport.js'
import { createOpenTelemetryRuntime, type OpenTelemetryRuntime, type OpenTelemetryRuntimeOptions } from './telemetry.js'
import { AuthService } from './auth-service.js'
import {
  FileQiongqiConfigStore,
  qiongqiConfigFromRuntimeOptions
} from './qiongqi-config-store.js'
import {
  ensureKWorksUserWorkspace,
  kworksUserWorkspacePaths
} from './kworks-workspace-paths.js'
import {
  KWorksUserDataAuthStore,
  FileKWorksUserDataStore,
  type KWorksUserDataStore
} from './kworks-user-data-store.js'
import { SqliteKWorksUserDataStore } from './kworks-sqlite-user-data-store.js'
import { UserScopedModelClient } from './user-scoped-model-client.js'
import { loadFinanceDataSource } from './finance-credentials.js'

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type QiongqiServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  runtimeToken: string
  apiKey: string
  baseUrl: string
  endpointFormat?: ModelEndpointFormat
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  storage?: StorageConfig
  observability?: {
    openTelemetry?: OpenTelemetryRuntimeOptions
  }
  capabilities?: QiongqiCapabilitiesConfig
  startedAt?: string
  /**
   * System prompt for the agent. When omitted, falls back to the
   * built-in Qiongqi system prompt. Embedders (e.g. industry presets)
   * pass their own prompt here to rebrand the agent without forking
   * the runtime.
   */
  systemPrompt?: string
  /**
   * Pinned constraints prepended after the system prompt to keep the
   * stable prefix byte-stable across turns. Optional override for
   * embedders that need custom constraints.
   */
  pinnedConstraints?: string[]
  /**
   * Optional display name for this agent. Surfaced via runtime info
   * and (in later stages) the AgentCard. Defaults to 'Qiongqi'.
   */
  agentName?: string
  /**
   * Explicit skill root directories for the plugin host. When omitted,
   * the runtime checks `<dataDir>/builtin-skills` as a convenience for
   * downstream packagers that drop a curated skill bundle there.
   *
   * Stage 1.3 decoupling: previously the runtime hard-coded
   * `cwd/qiongqi/skills`; this parameter lets embedders pass skill
   * roots explicitly without relying on process layout.
   */
  skillRoots?: string[]
  /**
   * Stage 2: explicit AgentCard override. When omitted, the runtime
   * builds a card automatically from `host`/`port`/`model`/
   * `agentName`/capabilities and persists a stable id under
   * `<dataDir>/agent-identity.json`. Pass an explicit card only when
   * you need to override the auto-derived fields (e.g. behind a proxy
   * with a different public URL).
   */
  agentCard?: AgentCard
  /**
   * Stage 3: orchestration mode for the turn loop.
   *
   * - `kernel_v3` (default) — the durable kernel loop with persisted
   *   checkpoints, effect idempotency, and provider-neutral tool handling.
   * - `classic` — the existing imperative
   *   `TurnOrchestrator`, battle-tested, no behaviour change.
   * - `evented` — the Stage-3 event-driven orchestrator with
   *   `TurnState` persistence and crash recovery.
   *
   * This is a dual-run flag: both paths work, and the classic path
   * remains the default until the evented path passes the full test
   * suite.
   */
  orchestrationMode?: OrchestrationMode
}

export type QiongqiServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
}

export function orchestrationModeForRuntimeOptions(
  options: Pick<QiongqiServeRuntimeOptions, 'orchestrationMode' | 'runtime'>
): OrchestrationMode {
  const rollout = options.runtime?.kernelRollout
  const configured = options.orchestrationMode
    ?? options.runtime?.orchestrationMode
    ?? rollout?.defaultMode
    ?? 'kernel_v3'
  const explicitlyRequestedKernel = options.orchestrationMode === 'kernel_v3'
    || options.runtime?.orchestrationMode === 'kernel_v3'
  return resolveRuntimeRolloutMode({
    configured,
    enabled: explicitlyRequestedKernel || rollout?.enabled !== false
  })
}

// ---------------------------------------------------------------------------
// createCore — infrastructure layer (stores, event bus, services)
// ---------------------------------------------------------------------------

/**
 * Infrastructure layer assembled without any model or tool knowledge.
 *
 * Returned by {@link createCore}. Contains the stores (thread/session),
 * event bus, approval & user-input gates, usage tracker, and the
 * Thread/Turn/Review services. Embedders that want full control can
 * construct a `CoreRuntime` manually (or mock it) and pass it to
 * {@link createToolMatrix} + {@link assembleRuntime} directly.
 */
export interface CoreRuntime {
  sessionStore: SessionStore
  threadStore: ThreadStore
  eventBus: InMemoryEventBus
  approvalGate: InMemoryApprovalGate
  userInputGate: InMemoryUserInputGate
  workspaceInspector: LocalWorkspaceInspector
  usageService: UsageService
  authService: AuthService
  kworksUserDataStore: KWorksUserDataStore
  inflight: InflightTracker
  steering: SteeringQueue
  compactor: ContextCompactor
  ids: RandomIdGenerator
  nowIso: () => string
  allocateSeq: (threadId: string) => number
  events: RuntimeEventRecorder
  turnService: TurnService
  threadService: ThreadService
  storageDiagnostics: () => {
    backend: string
    available: boolean
    degraded: boolean
    reason?: string
    sqlite?: { available: boolean; path?: string; reason?: string }
  }
  storesShutdown?: () => Promise<void>
  userDataShutdown?: () => void
}

/**
 * Build the infrastructure layer: persistent stores, event bus, and
 * the Thread/Turn/Usage services.
 *
 * This is the lowest of the three composition sub-components. It has
 * no dependency on the model client or the tool matrix, so embedders
 * can use it standalone for testing, for headless turn execution, or
 * to swap the model/tool layers without touching storage.
 *
 * The function is idempotent with respect to the data directory — it
 * creates the directory if missing and rehydrates usage carryover
 * from existing events.
 *
 * @param options.dataDir - Directory for persistent state. Created if
 *   missing.
 * @param options.storage - Optional storage backend override
 *   (`'file'` or `'hybrid'`). Defaults to file-based JSONL.
 * @param options.contextCompaction - Passed through to the
 *   {@link ContextCompactor} so compaction thresholds match the
 *   model layer.
 * @param options.models - Per-model overrides used by the compactor
 *   to derive context windows.
 */
export async function createCore(
  options: Pick<QiongqiServeRuntimeOptions, 'dataDir' | 'storage' | 'contextCompaction' | 'models'>
): Promise<CoreRuntime> {
  await mkdir(options.dataDir, { recursive: true })
  const workspaceRoot = workspaceRootFromRuntimeDataDir(options.dataDir)
  await ensureKWorksUserWorkspace(kworksUserWorkspacePaths(workspaceRoot, workspaceUserIdFromRuntimeDataDir(options.dataDir)))
  const eventBus = new InMemoryEventBus()
  const stores = await createPersistentStores({
    dataDir: options.dataDir,
    storage: options.storage,
    nowIso: () => new Date().toISOString()
  })
  const approvalGate = new InMemoryApprovalGate()
  const userInputGate = new InMemoryUserInputGate()
  const workspaceInspector = new LocalWorkspaceInspector()
  const usageService = new UsageService()
  let kworksUserDataStore: KWorksUserDataStore
  try {
    const sqliteStore = new SqliteKWorksUserDataStore({ workspaceRoot })
    await sqliteStore.ready()
    kworksUserDataStore = sqliteStore
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[qiongqi] user-data sqlite unavailable; using file fallback: ${message}`)
    kworksUserDataStore = new FileKWorksUserDataStore({ workspaceRoot })
  }
  const authService = new AuthService({
    store: new KWorksUserDataAuthStore(kworksUserDataStore),
    now: () => new Date()
  })
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const compactor = new ContextCompactor({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  const ids = new RandomIdGenerator()
  const nowIso = () => new Date().toISOString()
  const allocateSeq = (threadId: string) => eventBus.allocateSeq(threadId)
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore: stores.sessionStore,
    allocateSeq,
    nowIso,
    usageSink: async (event) => {
      const thread = await stores.threadStore.get(event.threadId)
      await kworksUserDataStore.appendUsageEvent?.({
        ...(thread?.ownerUserId ? { userId: thread.ownerUserId } : {}),
        threadId: event.threadId,
        seq: event.seq,
        turnId: event.turnId,
        ...(event.model ? { model: event.model } : {}),
        timestamp: event.timestamp,
        usage: event.usage
      })
    }
  })
  const turnService = new TurnService({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    events,
    inflight,
    steering,
    compactor,
    ids,
    nowIso
  })
  const threadService = new ThreadService({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    events,
    ids,
    nowIso
  })
  await seedUsageCarryover({
    threadStore: stores.threadStore,
    sessionStore: stores.sessionStore,
    usageService
  })
  return {
    sessionStore: stores.sessionStore,
    threadStore: stores.threadStore,
    eventBus,
    approvalGate,
    userInputGate,
    workspaceInspector,
    usageService,
    authService,
    kworksUserDataStore,
    inflight,
    steering,
    compactor,
    ids,
    nowIso,
    allocateSeq,
    events,
    turnService,
    threadService,
    storageDiagnostics: stores.diagnostics,
    storesShutdown: stores.shutdown,
    userDataShutdown: () => {
      if ('close' in kworksUserDataStore && typeof kworksUserDataStore.close === 'function') {
        kworksUserDataStore.close()
      }
    }
  }
}

function workspaceRootFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/)
  const usersIndex = parts.lastIndexOf('users')
  if (usersIndex < 0) return dataDir
  const leadingSlash = dataDir.startsWith('/') ? '/' : ''
  return leadingSlash + parts.slice(0, usersIndex).filter(Boolean).join('/')
}

function workspaceUserIdFromRuntimeDataDir(dataDir: string): string {
  const parts = dataDir.split(/[\\/]+/).filter(Boolean)
  const usersIndex = parts.lastIndexOf('users')
  return usersIndex >= 0 && parts[usersIndex + 1] ? parts[usersIndex + 1]! : 'runtime'
}

// ---------------------------------------------------------------------------
// createModelAdapter — model client + capability profiles
// ---------------------------------------------------------------------------

/**
 * Model layer: the HTTP client and capability profiles derived from
 * the user-supplied configuration.
 *
 * Returned by {@link createModelAdapter}. The `modelCapabilities`
 * function lets downstream code ask “does this model support vision /
 * tool calls / streaming?” without re-parsing the config.
 */
export interface ModelAdapter {
  client: ModelCompatClient | RoutedModelCompatClient | DynamicRoutedModelCompatClient
  profiles: ReturnType<typeof modelContextProfilesFromConfig>
  modelCapabilities: (model: string) => ReturnType<typeof modelCapabilitiesForModel>
}

/**
 * Construct the model client and capability profiles.
 *
 * Creates a {@link ModelCompatClient} wired to the supplied
 * `baseUrl` / `apiKey` / `endpointFormat`, plus the context-window
 * and capability profiles derived from the `models` config.
 *
 * This sub-component is synchronous (no I/O) so embedders can call it
 * in hot paths or tests without awaiting.
 */
export function createModelAdapter(
  options: Pick<
    QiongqiServeRuntimeOptions,
    'baseUrl' | 'apiKey' | 'endpointFormat' | 'model' | 'contextCompaction' | 'models' | 'runtime'
  >,
  configStore?: QiongqiConfigStore
): ModelAdapter {
  const streamIdleTimeoutMs = options.runtime?.modelStreamIdleTimeoutMs
  const fallback = {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
    model: options.model,
    ...(streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs } : {})
  }
  const routes = modelProviderRoutesFromConfig(options.models, streamIdleTimeoutMs)
  const client = configStore
    ? new DynamicRoutedModelCompatClient({
        fallback: () => {
          const config = runtimeConfigSnapshot(configStore)
          const configStreamIdleTimeoutMs = config.runtime?.modelStreamIdleTimeoutMs ?? streamIdleTimeoutMs
          return {
            baseUrl: config.serve?.baseUrl ?? options.baseUrl,
            apiKey: config.serve?.apiKey ?? options.apiKey,
            endpointFormat: config.serve?.endpointFormat ?? options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
            model: config.serve?.model ?? options.model,
            ...(configStreamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs: configStreamIdleTimeoutMs } : {})
          }
        },
        routes: () => {
          const config = runtimeConfigSnapshot(configStore)
          return modelProviderRoutesFromConfig(
            config.models,
            config.runtime?.modelStreamIdleTimeoutMs ?? streamIdleTimeoutMs
          )
        }
      })
    : routes.length > 0
      ? new RoutedModelCompatClient({ fallback, routes })
      : new ModelCompatClient(fallback)
  const profiles = modelContextProfilesFromConfig({
    contextCompaction: options.contextCompaction,
    models: options.models
  })
  return {
    client,
    profiles,
    modelCapabilities: (model: string) => {
      const config = configStore?.snapshot?.()
      if (config) {
        return modelCapabilitiesForModel(
          model,
          modelContextProfilesFromConfig({
            contextCompaction: config.contextCompaction ?? options.contextCompaction,
            models: config.models ?? options.models
          })
        )
      }
      return modelCapabilitiesForModel(model, profiles)
    }
  }
}

function runtimeConfigSnapshot(configStore: QiongqiConfigStore): ReturnType<NonNullable<QiongqiConfigStore['snapshot']>> {
  const snapshot = configStore.snapshot?.()
  if (!snapshot) {
    throw new Error('dynamic model routing requires a synchronous config snapshot')
  }
  return snapshot
}

function skillEnabledMapFromCompatSetting(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, boolean> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'boolean') {
      out[name] = raw
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const enabled = (raw as Record<string, unknown>).enabled
      if (typeof enabled === 'boolean') out[name] = enabled
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function modelProviderRoutesFromConfig(
  models: ModelConfig | undefined,
  streamIdleTimeoutMs?: number
): RoutedModelConfig[] {
  const profiles = models?.profiles
  if (!profiles) return []
  const routes: RoutedModelConfig[] = []
  for (const [modelId, profile] of Object.entries(profiles)) {
    const baseUrl = typeof profile.baseUrl === 'string' ? profile.baseUrl.trim() : ''
    if (!baseUrl) continue
    const providerModel = typeof profile.providerModel === 'string' && profile.providerModel.trim()
      ? profile.providerModel.trim()
      : modelId
    routes.push({
      baseUrl,
      apiKey: typeof profile.apiKey === 'string' ? profile.apiKey : '',
      endpointFormat: normalizeModelEndpointFormat(profile.endpointFormat),
      model: providerModel,
      aliases: [modelId, ...(Array.isArray(profile.aliases) ? profile.aliases : [])],
      ...(streamIdleTimeoutMs !== undefined ? { streamIdleTimeoutMs } : {})
    })
  }
  return routes
}

// ---------------------------------------------------------------------------
// createToolMatrix — tool providers, registry, delegation, skills
// ---------------------------------------------------------------------------

/**
 * Tool layer: registry, local tool host, MCP/web providers, skill
 * runtime, delegation runtime, and optional attachment/memory stores.
 *
 * Returned by {@link createToolMatrix}. Embedders that only need a
 * subset (e.g. no delegation, no skills) can construct a `ToolMatrix`
 * manually and pass it to {@link assembleRuntime}.
 */
export interface ToolMatrix {
  registry: CapabilityRegistry
  toolHost: ToolHost
  mcpProviders: Awaited<ReturnType<typeof buildMcpToolProviders>>
  webProviders: ReturnType<typeof buildWebToolProviders>
  skillRuntime: SkillRuntime
  skillPluginHost: SkillPluginHost
  delegationRuntime: DelegationRuntime | undefined
  /** Stage 2: peer registry shared with delegation runtime. */
  peerRegistry: PeerRegistry
  attachmentStore: FileAttachmentStore | undefined
  memoryStore: FileMemoryStore | undefined
  refreshRuntimeTools: () => Promise<void>
  refreshMcpTools: () => Promise<void>
}

class RefreshableToolHost implements ToolHost {
  readonly id = 'local'
  private delegate: LocalToolHost
  private readonly enrichContext?: (context: ToolHostContext) => Promise<ToolHostContext>

  constructor(
    delegate: LocalToolHost,
    enrichContext?: (context: ToolHostContext) => Promise<ToolHostContext>
  ) {
    this.delegate = delegate
    this.enrichContext = enrichContext
  }

  replace(delegate: LocalToolHost): void {
    this.delegate = delegate
  }

  listTools(context?: ToolHostContext) {
    return this.delegate.listTools(context)
  }

  prepare(call: ToolCallLike, context: ToolHostContext): Promise<ToolHostPreparation> {
    return this.withContext(context, (resolved) => this.delegate.prepare(call, resolved))
  }

  execute(
    call: ToolCallLike,
    context: ToolHostContext,
    onUpdate?: (item: TurnItem) => Promise<void> | void,
    preparation?: ToolHostPreparation
  ): Promise<ToolHostResult> {
    return this.withContext(context, (resolved) => this.delegate.execute(call, resolved, onUpdate, preparation))
  }

  clearReadTracker(threadId?: string): void {
    this.delegate.clearReadTracker(threadId)
  }

  diagnostics() {
    return this.delegate.diagnostics()
  }

  private async withContext<T>(
    context: ToolHostContext,
    operation: (resolved: ToolHostContext) => Promise<T>
  ): Promise<T> {
    return operation(this.enrichContext ? await this.enrichContext(context) : context)
  }
}

/**
 * Build the tool layer: registry, local tool host, MCP/web providers,
 * skill runtime, delegation runtime, and optional attachment/memory
 * stores.
 *
 * This sub-component depends on both {@link CoreRuntime} (for event
 * recording, usage tracking) and {@link ModelAdapter} (for delegation
 * to child agents). It is async because MCP servers may need to
 * handshake before their tools are available.
 *
 * @param options.capabilities - The capability manifest controlling
 *   which tool providers are enabled (MCP, web, memory, attachments,
 *   subagents, skills).
 * @param options.skillRoots - Explicit skill directories. See
 *   {@link QiongqiServeRuntimeOptions.skillRoots}.
 * @param core - The {@link CoreRuntime} from {@link createCore}.
 * @param model - The {@link ModelAdapter} from {@link createModelAdapter}.
 */
export async function createToolMatrix(
  options: Pick<
    QiongqiServeRuntimeOptions,
    'dataDir' | 'capabilities' | 'approvalPolicy' | 'sandboxMode' | 'model' | 'models' | 'contextCompaction' | 'runtime' | 'skillRoots' | 'tokenEconomyMode' | 'tokenEconomy'
  >,
  core: CoreRuntime,
  model: ModelAdapter,
  /**
   * Stage 2: peer registry injected from the caller. When supplied,
   * the delegation runtime registers child agents here so they become
   * addressable via `invokePeer`. Created by {@link createAgent} and
   * forwarded down — keeps the registry lifetime tied to the agent,
   * not the tool matrix.
   */
  peerRegistry?: PeerRegistry,
  configStore?: QiongqiConfigStore
): Promise<ToolMatrix> {
  const nowIso = core.nowIso
  const runtimeMountedSkillRoots = options.capabilities?.skills.roots ?? []
  const initialCapabilities = withRuntimeMountedSkillRoots(options.capabilities, runtimeMountedSkillRoots)
  const builtinSkillRoots = await filterDuplicateBuiltinSkillRoots(
    await resolveBuiltinSkillRoots(options.dataDir, options.skillRoots),
    initialCapabilities?.skills.roots ?? []
  )
  const skillRuntime = await SkillRuntime.create(initialCapabilities?.skills)
  const skillPluginHost = await SkillPluginHost.create(initialCapabilities?.skills, {
    builtinRoots: builtinSkillRoots,
    enabledSkillsProvider: configStore
      ? (context) => {
          const owner = context?.ownerUserId
          const userEnabledSkills = owner
            ? skillEnabledMapFromCompatSetting(core.kworksUserDataStore.getUserSettingSync?.(owner, 'capabilities.skills.compat'))
            : undefined
          return userEnabledSkills ?? runtimeConfigSnapshot(configStore).capabilities?.skills?.enabledSkills
        }
      : undefined
  })
  let skillMcpServers = collectSkillMcpServers(
    skillPluginHost.list(),
    process.cwd(),
    (p) => skillPluginHost.isEnabled(p)
  )
  let mcpProviders = await buildMcpToolProviders(mergedMcpConfig(options.capabilities?.mcp, skillMcpServers))
  let webProviders = buildWebToolProviders(options.capabilities?.web)
  const attachmentStore = options.capabilities?.attachments.enabled
    ? new FileAttachmentStore({
        rootDir: join(options.dataDir, 'attachments'),
        config: options.capabilities.attachments,
        nowIso
      })
    : undefined
  const memoryStore = options.capabilities?.memory.enabled
    ? new FileMemoryStore({
        rootDir: join(options.dataDir, 'memory'),
        config: options.capabilities.memory,
        nowIso
      })
    : undefined
  const baseToolProviders = () => [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: buildDefaultLocalTools()
    },
    ...mcpProviders.providers,
    ...webProviders.providers,
    ...buildMemoryToolProviders(memoryStore)
  ]
  const pythonPathEnv = computePythonPathForSkillRoots([...builtinSkillRoots, ...runtimeMountedSkillRoots])
  const enrichFinanceContext = async (context: ToolHostContext): Promise<ToolHostContext> => {
    if (!context.ownerUserId) {
      return pythonPathEnv
        ? { ...context, environment: { ...(context.environment ?? {}), PYTHONPATH: pythonPathEnv } }
        : context
    }
    const resolved = await loadFinanceDataSource(core.kworksUserDataStore, context.ownerUserId)
    return {
      ...context,
      environment: {
        ...(context.environment ?? {}),
        ...(pythonPathEnv ? { PYTHONPATH: pythonPathEnv } : {}),
        ...resolved.environment
      }
    }
  }
  const childRegistry = new CapabilityRegistry(baseToolProviders())
  const childToolHost: ToolHost = new RefreshableToolHost(
    new LocalToolHost({ registry: childRegistry, readTracker: true }),
    enrichFinanceContext
  )
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const delegationRuntime = options.capabilities?.subagents.enabled
    ? new DelegationRuntime({
        config: options.capabilities.subagents,
        store: new FileDelegationStore(join(options.dataDir, 'threads')),
        events: core.events,
        nowIso,
        ...(peerRegistry ? {
          peerRegistry,
          agentsDir: join(options.dataDir, 'agents')
        } : {}),
        executor: createChildAgentExecutor({
          model: model.client,
          toolHost: childToolHost,
          prefix: createImmutablePrefix({ systemPrompt: QIONGQI_SYSTEM_PROMPT }),
          defaultModel: options.model,
          models: options.models,
          contextCompaction: options.contextCompaction,
          approvalPolicy: options.approvalPolicy,
          sandboxMode: options.sandboxMode,
          modelCapabilities: model.modelCapabilities,
          skillRuntime,
          skillPluginHost,
          tokenEconomy,
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(memoryStore ? { memoryStore } : {}),
          nowIso
        }),
        recordExternalUsage: (threadId, usage) => {
          core.usageService.record(threadId, usage)
        }
      })
    : undefined
  const buildMainRegistry = () => new CapabilityRegistry([
    ...baseToolProviders(),
    {
      id: 'goal',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildGoalLocalTools(core.threadService)
    },
    {
      id: 'todo',
      kind: 'gui' as const,
      enabled: true,
      available: true,
      tools: buildTodoLocalTools(core.threadService)
    },
    {
      id: 'skill-control',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: [createActivateSkillTool({
        resolveSkill: (skillId, context) => skillPluginHost.resolveActivatableSkill(skillId, context),
        activateTurnSkill: async ({ threadId, turnId, skillId }) => {
          const turn = await core.turnService.getTurn(threadId, turnId)
          if (!turn) throw new Error('turn not found for skill activation')
          const explicitSkillIds = [...new Set([...(turn.explicitSkillIds ?? []), skillId])].sort()
          await core.turnService.updateTurnMetadata(threadId, turnId, { explicitSkillIds })
        }
      })]
    },
    ...buildDelegationToolProviders(delegationRuntime),
    ...(() => {
      const builtinBash = createBashLocalTool()
      const skillExecutor: SkillToolExecutor = async (template, args, context) => {
        if (template === 'bash') {
          const command = typeof args.command === 'string' ? args.command : ''
          if (!command) return { output: 'skill bash tool declared no command', isError: true }
          return builtinBash.execute({ action: 'run', command }, context)
        }
        return { output: `skill template ${template} is not executable in v1`, isError: true }
      }
      const provider = buildSkillToolProvider(
        skillPluginHost.list(),
        (_skillId, context) => context.activeSkillIds ?? [],
        skillExecutor
      )
      return provider.tools.length ? [provider] : []
    })()
  ])
  let registry = buildMainRegistry()
  const toolHost = new RefreshableToolHost(
    new LocalToolHost({ registry, readTracker: true }),
    enrichFinanceContext
  )
  const refreshRuntimeTools = async () => {
    if (!configStore) return
    const previous = mcpProviders
    const current = runtimeConfigSnapshot(configStore)
    const currentCapabilities = withRuntimeMountedSkillRoots(current.capabilities, runtimeMountedSkillRoots)
    // Normalize legacy "task" work-mode to "office" before reloading the skill
    // host, so effectiveSkillIds resolves correctly for the office mode.
    const normalizedSkills = ensureBuiltinWorkModes(
      normalizeLegacyTaskSkills(currentCapabilities?.skills)
    )
    await skillRuntime.reload(normalizedSkills)
    await skillPluginHost.reload(normalizedSkills)
    skillMcpServers = collectSkillMcpServers(
      skillPluginHost.list(),
      process.cwd(),
      (p) => skillPluginHost.isEnabled(p)
    )
    mcpProviders = await buildMcpToolProviders(mergedMcpConfig(currentCapabilities?.mcp, skillMcpServers))
    webProviders = buildWebToolProviders(currentCapabilities?.web)
    registry = buildMainRegistry()
    toolHost.replace(new LocalToolHost({ registry, readTracker: true }))
    matrix.registry = registry
    matrix.mcpProviders = mcpProviders
    matrix.webProviders = webProviders
    await previous.close().catch(() => undefined)
  }
  const refreshMcpTools = refreshRuntimeTools
  // Stage 2: always give ToolMatrix a peer registry. When the caller
  // didn't supply one (e.g. tests, legacy paths), create a standalone
  // one so the interface is always satisfied.
  const effectivePeerRegistry = peerRegistry ?? new PeerRegistry()
  const matrix: ToolMatrix = {
    registry,
    toolHost,
    mcpProviders,
    webProviders,
    skillRuntime,
    skillPluginHost,
    delegationRuntime,
    peerRegistry: effectivePeerRegistry,
    attachmentStore,
    memoryStore,
    refreshRuntimeTools,
    refreshMcpTools
  }
  return matrix
}

function mergedMcpConfig(
  mcp: QiongqiCapabilitiesConfig['mcp'] | undefined,
  skillMcpServers: ReturnType<typeof collectSkillMcpServers>
): QiongqiCapabilitiesConfig['mcp'] | undefined {
  if (!mcp || Object.keys(skillMcpServers).length === 0) return mcp
  return {
    ...mcp,
    servers: {
      ...mcp.servers,
      ...skillMcpServers as Record<string, typeof mcp.servers[string]>
    }
  }
}

// ---------------------------------------------------------------------------
// createAgent — full runtime assembly (composition root)
// ---------------------------------------------------------------------------

/**
 * Assemble a full Qiongqi serve runtime from core, model adapter, and
 * tool matrix sub-components.
 *
 * This is the top-level composition root — the only place that wires
 * concrete adapters to ports. Returns a {@link ServerRuntime} which
 * can then be mounted via {@link createHttpServer} or used directly
 * for programmatic turn execution.
 *
 * # Quick start
 *
 * ```ts
 * import { createAgent, createHttpServer } from '@qiongqi/http'
 *
 * // 1. Build the agent (no network I/O yet)
 * const agent = await createAgent({
 *   host: '127.0.0.1',
 *   port: 8899,
 *   dataDir: '~/.qiongqi/data',
 *   runtimeToken: process.env.QIONGQI_TOKEN!,
 *   apiKey: process.env.DEEPSEEK_API_KEY!,
 *   baseUrl: 'https://api.deepseek.com',
 *   model: 'deepseek-chat',
 *   approvalPolicy: 'on-request',
 *   sandboxMode: 'workspace',
 *   tokenEconomyMode: true,
 *   insecure: false
 * })
 *
 * // 2. (Optional) override the system prompt
 * // agent.info().model === 'deepseek-chat'
 *
 * // 3. Mount the HTTP server
 * const server = await createHttpServer({
 *   agent,
 *   host: '127.0.0.1',
 *   port: 8899
 * })
 * ```
 *
 * # Composition sub-components
 *
 * Stage 1.3 splits the original 500-line monolith into:
 *   - {@link createCore} — stores, event bus, Thread/Turn/Usage services
 *   - {@link createModelAdapter} — model client + capability profiles
 *   - {@link createToolMatrix} — tool registry, skills, delegation runtime
 *   - {@link createAgent} — this function — full orchestration loop
 *
 * Embedders that only need a subset (e.g. just the stores + model
 * without the tool matrix) can call the sub-components directly and
 * assemble their own runtime shape.
 *
 * @param options - Flat configuration object. See
 *   {@link QiongqiServeRuntimeOptions} for every field.
 * @returns A ready-to-use {@link ServerRuntime}. Call
 *   {@link createHttpServer} to mount it on a TCP port, or invoke
 *   `agent.runTurn()` / `agent.runReview()` programmatically.
 */
export async function createAgent(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  const core = await createCore(options)
  const configStore = new FileQiongqiConfigStore({
    path: options.configPath,
    initial: qiongqiConfigFromRuntimeOptions(options)
  })
  const model = createModelAdapter(options, configStore)
  // Stage 2: create the PeerRegistry that will be shared between
  // the HTTP routes (agent-card discovery), delegation runtime
  // (child agents), and external callers (A2A).
  const peerStore = new FilePeerStore(join(options.dataDir, 'peers'))
  const peerRegistry = new PeerRegistry({
    remoteTransport: new HttpPeerTransport({
      getToken: () => options.runtimeToken || undefined
    }),
    onChange: async (record, action) => {
      if (action === 'register' && record.kind === 'remote') {
        const cards = await peerStore.load()
        const existing = new Map(cards.map((c) => [c.id, c]))
        existing.set(record.card.id, record.card)
        await peerStore.save([...existing.values()])
      } else if (action === 'unregister' && record.kind === 'remote') {
        const cards = (await peerStore.load()).filter((c) => c.id !== record.card.id)
        await peerStore.save(cards)
      }
    }
  })
  // Restore previously persisted remote peers on startup.
  for (const card of await peerStore.load()) {
    await peerRegistry.registerRemote(card).catch(() => {
      // Peers that fail to re-register on startup are silently skipped —
      // the operator can re-discover them later.
    })
  }
  const tools = await createToolMatrix(options, core, model, peerRegistry, configStore)
  return await assembleRuntime({ options, core, model, tools, configStore })
}

/**
 * Backward-compatible alias for {@link createAgent}.
 *
 * @deprecated since stage 1.4 — prefer `createAgent`. The old name is
 *   retained so existing call sites (CLI, presets, tests) can migrate
 *   incrementally.
 */
export async function createQiongqiServeRuntime(
  options: QiongqiServeRuntimeOptions
): Promise<ServerRuntime> {
  return createAgent(options)
}

// ---------------------------------------------------------------------------
// Internal assembly helpers
// ---------------------------------------------------------------------------

function tokenEconomyConfigForOptions(
  options: Pick<QiongqiServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

function withRuntimeMountedSkillRoots(
  capabilities: QiongqiCapabilitiesConfig | undefined,
  runtimeMountedSkillRoots: readonly string[]
): QiongqiCapabilitiesConfig | undefined {
  if (!capabilities?.skills || runtimeMountedSkillRoots.length === 0) return capabilities
  // When the KWorks desktop app mounts skill roots at startup (via
  // KWorks_SKILLS_PATH), skills are a core capability that must stay enabled.
  // Per-section/per-user config writes can flip enabled=false; force-retain it
  // here so the live SkillPluginHost never sees a disabled state.
  return {
    ...capabilities,
    skills: {
      ...capabilities.skills,
      enabled: true,
      roots: uniqueStrings([
        ...runtimeMountedSkillRoots,
        ...capabilities.skills.roots
      ])
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * Rename a legacy `task` work-mode entry to `office` in a skills config.
 * Prevents the skill host from seeing a stale `task` mode (which produces
 * wrong effectiveSkillIds for the office mode). Mirrors the normalization in
 * kworks-compat.ts but operates on the skills capability section.
 */
function normalizeLegacyTaskSkills(skills: QiongqiCapabilitiesConfig['skills'] | undefined): QiongqiCapabilitiesConfig['skills'] | undefined {
  if (!skills?.workModes?.modes) return skills
  const modes = skills.workModes.modes as Record<string, RuntimeWorkModeConfig>
  if (!('task' in modes)) return skills
  const { task, ...rest } = modes
  const nextModes: Record<string, RuntimeWorkModeConfig> = 'office' in rest
    ? rest
    : { ...rest, office: { ...task, id: 'office' } }
  const nextDefault = skills.workModes.defaultModeId === 'task' ? 'office' : skills.workModes.defaultModeId
  const overrides = { ...((skills.modeSkillOverrides ?? {}) as Record<string, RuntimeModeSkillOverride>) }
  if (overrides.task) {
    overrides.office = {
      ...(overrides.office ?? { addedSkillIds: [], removedSkillIds: [] }),
      ...overrides.task
    }
    delete overrides.task
  }
  return {
    ...skills,
    workModes: { ...skills.workModes, defaultModeId: nextDefault, modes: nextModes },
    modeSkillOverrides: overrides
  }
}

/**
 * Ensure all built-in work modes from DEFAULT_WORK_MODES exist in the skills
 * config. Old per-user snapshots persisted before a new built-in mode (e.g.
 * `finance`) was added will be missing it — without this the SkillPluginHost
 * never sees the mode and its skills are invisible.
 */
function ensureBuiltinWorkModes(skills: QiongqiCapabilitiesConfig['skills'] | undefined): QiongqiCapabilitiesConfig['skills'] | undefined {
  if (!skills?.workModes?.modes) return skills
  const modes = skills.workModes.modes as Record<string, RuntimeWorkModeConfig>
  const builtinIds = Object.keys(DEFAULT_WORK_MODES)
  const missing = builtinIds.filter((id) => !modes[id])
  if (missing.length === 0) return skills
  const merged = { ...modes }
  for (const id of missing) {
    const builtin = DEFAULT_WORK_MODES[id as keyof typeof DEFAULT_WORK_MODES]
    if (builtin) {
      merged[id] = { ...builtin }
    }
  }
  return {
    ...skills,
    workModes: { ...skills.workModes, modes: merged }
  }
}

async function filterDuplicateBuiltinSkillRoots(
  builtinRoots: readonly string[],
  configuredRoots: readonly string[]
): Promise<string[]> {
  if (builtinRoots.length === 0 || configuredRoots.length === 0) return uniqueStrings(builtinRoots)
  const configuredIds = await skillPackageIdsFromRoots(configuredRoots)
  if (configuredIds.size === 0) return uniqueStrings(builtinRoots)

  const roots: string[] = []
  for (const root of builtinRoots) {
    const packages = await skillPackageRoots(root)
    if (packages.length === 0) {
      roots.push(root)
      continue
    }
    const missing = packages.filter((pkg) => !configuredIds.has(pkg.id))
    if (missing.length === packages.length) {
      roots.push(root)
    } else {
      roots.push(...missing.map((pkg) => pkg.root))
    }
  }
  return uniqueStrings(roots)
}

async function skillPackageIdsFromRoots(roots: readonly string[]): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const root of roots) {
    for (const pkg of await skillPackageRoots(root)) ids.add(pkg.id)
  }
  return ids
}

async function skillPackageRoots(root: string): Promise<Array<{ id: string; root: string }>> {
  if (!existsSync(root)) return []
  const packages: Array<{ id: string; root: string }> = []
  if (isSkillPackage(root)) packages.push({ id: basename(root), root })
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(root, entry.name)
      if (isSkillPackage(candidate)) packages.push({ id: entry.name, root: candidate })
    }
  } catch {
    return packages
  }
  return packages
}

function isSkillPackage(root: string): boolean {
  return existsSync(join(root, 'skill.json')) || existsSync(join(root, 'SKILL.md'))
}

export function createKernelV3TurnRunner(input: {
  options: QiongqiServeRuntimeOptions
  core: CoreRuntime
  model: ModelAdapter
  modelClient: ModelClient
  tools: ToolMatrix
  prefix: ReturnType<typeof createImmutablePrefix>
  tokenEconomy: TokenEconomyConfig
  runtimeV3Root: string
  events: FileRunEventStore
  toolRuntime: ToolRuntimeV3
}): KernelV3TurnRunner {
  const { options, core, model, tools } = input
  const snapshots = new FileRunStateStore(input.runtimeV3Root, { requireFence: true })
  const taskStates = new FileTaskStateStore(input.runtimeV3Root)

  const awaitUserInput = async (
    threadId: string,
    turnId: string,
    request: {
      id: string
      itemId: string
      prompt: string
      questions: Array<{
        header: string
        id: string
        question: string
        options: Array<{ label: string; description: string }>
      }>
    },
    signal: AbortSignal
  ) => {
    const item = makeUserInputItem({
      id: request.itemId,
      threadId,
      turnId,
      inputId: request.id,
      prompt: request.prompt,
      questions: request.questions
    })
    await core.turnService.applyItem(threadId, item)
    await core.events.record({
      kind: 'user_input_requested',
      threadId,
      turnId,
      itemId: item.id,
      inputId: request.id,
      status: 'pending',
      prompt: request.prompt,
      questions: request.questions
    })
    const pending = core.userInputGate.request({ ...request, threadId, turnId })
    const resolution = await waitForKernelUserInput(
      pending,
      request.id,
      signal,
      core.userInputGate
    )
    await core.turnService.updateItem(threadId, item.id, {
      status: resolution.status,
      finishedAt: core.nowIso()
    } as Partial<TurnItem>)
    await core.events.record({
      kind: 'user_input_resolved',
      threadId,
      turnId,
      itemId: item.id,
      inputId: request.id,
      status: resolution.status,
      prompt: request.prompt,
      questions: request.questions
    })
    return resolution
  }

  const promptBuilder = new PromptBuilder({
    threadStore: core.threadStore,
    sessionStore: core.sessionStore,
    taskStates,
    events: core.events,
    turns: core.turnService,
    usage: core.usageService,
    model: input.modelClient,
    toolHost: tools.toolHost,
    compactor: core.compactor,
    prefix: input.prefix,
    ids: core.ids,
    nowIso: core.nowIso,
    modelCapabilities: model.modelCapabilities,
    skillRuntime: tools.skillRuntime,
    skillPluginHost: tools.skillPluginHost,
    tokenEconomy: input.tokenEconomy,
    contextCompaction: options.contextCompaction,
    runtimeDataDir: options.dataDir,
    ...(tools.attachmentStore ? { attachmentStore: tools.attachmentStore } : {}),
    ...(tools.memoryStore ? { memoryStore: tools.memoryStore } : {}),
    awaitUserInput
  })
  const proposalRunner = new ModelProposalRunner({
    client: input.modelClient,
    endpointFormat: options.endpointFormat,
    onUsage: async (snapshot, request) => {
      const thread = await core.threadStore.get(request.threadId)
      promptBuilder.recordPromptPressure({
        ownerUserId: thread?.ownerUserId ?? 'local-default-owner',
        workspaceKey: thread?.workspace ?? options.dataDir,
        threadId: request.threadId,
        turnId: request.turnId
      }, request.model, snapshot.promptTokens)
      const usage = core.usageService.record(request.threadId, snapshot)
      await core.events.record({
        kind: 'usage',
        threadId: request.threadId,
        turnId: request.turnId,
        model: request.model,
        usage
      })
    }
  })
  const nodes = createKernelV3NodeHandlers({
    threadStore: core.threadStore,
    sessionStore: core.sessionStore,
    taskStates,
    turns: core.turnService,
    promptBuilder,
    proposalRunner,
    toolRuntime: input.toolRuntime,
    createToolContext: async (identity, state) => {
      const [thread, turn] = await Promise.all([
        core.threadStore.get(identity.threadId),
        core.turnService.getTurn(identity.threadId, identity.turnId)
      ])
      if (!thread || !turn) throw new Error('kernel tool context scope unavailable')
      const built = state.nodeData['build-context'] as {
        runtimeContext?: {
          activeSkillIds?: string[]
          allowedToolNames?: string[]
          modelCapabilities?: ReturnType<ModelAdapter['modelCapabilities']>
          approvalPolicy?: ApprovalPolicy
          threadMode?: 'agent' | 'plan'
          workModeId?: string
          guiPlan?: ToolHostContext['guiPlan']
        }
      } | undefined
      const runtimeContext = built?.runtimeContext
      return {
        threadId: identity.threadId,
        turnId: identity.turnId,
        workspace: thread.workspace,
        ownerUserId: identity.ownerUserId,
        threadMode: runtimeContext?.threadMode ?? thread.mode,
        ...(runtimeContext?.workModeId ?? turn.workModeId ?? thread.workModeId
          ? { workModeId: runtimeContext?.workModeId ?? turn.workModeId ?? thread.workModeId }
          : {}),
        ...(runtimeContext?.guiPlan ? { guiPlan: runtimeContext.guiPlan } : {}),
        model: runtimeContext?.modelCapabilities ?? model.modelCapabilities(turn.model ?? options.model),
        activeSkillIds: runtimeContext?.activeSkillIds ?? turn.activeSkillIds,
        memoryPolicy: { enabled: Boolean(tools.memoryStore) },
        delegationPolicy: { enabled: Boolean(tools.delegationRuntime) },
        ...(runtimeContext?.allowedToolNames
          ? { allowedToolNames: runtimeContext.allowedToolNames }
          : {}),
        outputBudget: {
          outputDir: join(options.dataDir, 'threads', identity.threadId, 'tool-output'),
          maxInlineBytes: 64 * 1024,
          previewHeadBytes: 4 * 1024,
          previewTailBytes: 4 * 1024
        },
        approvalPolicy: runtimeContext?.approvalPolicy ?? thread.approvalPolicy,
        abortSignal: core.turnService.getAbortController(identity.turnId)
          ?? new AbortController().signal,
        awaitApproval: async (approval) => {
          await core.turnService.applyItem(identity.threadId, makeApprovalItem({
            id: `item_approval_${approval.id}`,
            threadId: identity.threadId,
            turnId: identity.turnId,
            approvalId: approval.id,
            toolName: approval.toolName,
            summary: approval.summary
          }))
          await core.events.record({
            kind: 'approval_requested',
            threadId: identity.threadId,
            turnId: identity.turnId,
            approvalId: approval.id,
            toolName: approval.toolName,
            status: 'pending',
            summary: approval.summary
          })
          const decision = await core.approvalGate.request(approval)
          await core.turnService.updateItem(
            identity.threadId,
            `item_approval_${approval.id}`,
            { status: decision === 'allow' ? 'allowed' : 'denied', finishedAt: core.nowIso() }
          )
          return decision
        },
        awaitUserInput: (request) => awaitUserInput(
          identity.threadId,
          identity.turnId,
          request,
          core.turnService.getAbortController(identity.turnId)
            ?? new AbortController().signal
        )
      }
    },
    ids: core.ids,
    nowIso: core.nowIso,
    emitRuntimeProgress: true
  })

  return new KernelV3TurnRunner({
    snapshots,
    events: input.events,
    leases: snapshots,
    holderId: `qiongqi:${process.pid}`,
    identityForTurn: async (threadId, turnId) => {
      const thread = await core.threadStore.get(threadId)
      return {
        ownerUserId: thread?.ownerUserId ?? 'local-default-owner',
        workspaceKey: thread?.workspace ?? options.dataDir,
        threadId,
        turnId,
        runId: `run_${threadId}_${turnId}`
      }
    },
    nodes,
    finishTurn: async (threadId, turnId, status, outcome) => {
      const progressId = `item_kernel_progress_run_${threadId}_${turnId}`
      await core.turnService.applyItemOnce(threadId, {
        id: progressId,
        threadId,
        turnId,
        role: 'system',
        status: 'completed',
        createdAt: core.nowIso(),
        kind: 'runtime_progress',
        phase: 'terminated',
        summary: outcome.status === 'completed' ? 'Task completed.' : `Task stopped: ${outcome.reason}.`,
        modelSteps: 0,
        toolCalls: 0,
        evidenceCount: 0,
        artifactCount: 0,
        reason: outcome.reason
      })
      await core.turnService.updateItemOnce(threadId, progressId, {
        status: 'completed',
        phase: 'terminated',
        summary: outcome.status === 'completed' ? 'Task completed.' : `Task stopped: ${outcome.reason}.`,
        reason: outcome.reason
      } as never)
      await core.turnService.finishTurn({
        threadId,
        turnId,
        status,
        ...(status === 'failed'
          ? { error: `${outcome.reason}${outcome.retryable ? ' (retryable)' : ''}` }
          : {})
      })
    },
    nowIso: core.nowIso
  })
}

async function waitForKernelUserInput(
  pending: ReturnType<CoreRuntime['userInputGate']['request']>,
  inputId: string,
  signal: AbortSignal,
  gate: CoreRuntime['userInputGate']
) {
  if (signal.aborted) {
    gate.resolve(inputId, { status: 'cancelled' })
    throw new Error('cancelled while awaiting user input')
  }
  return new Promise<Awaited<typeof pending>>((resolve, reject) => {
    const onAbort = (): void => {
      gate.resolve(inputId, { status: 'cancelled' })
      signal.removeEventListener('abort', onAbort)
      reject(new Error('cancelled while awaiting user input'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then((resolution) => {
      signal.removeEventListener('abort', onAbort)
      resolve(resolution)
    }, reject)
  })
}

async function assembleRuntime(input: {
  options: QiongqiServeRuntimeOptions
  core: CoreRuntime
  model: ModelAdapter
  tools: ToolMatrix
  configStore: QiongqiConfigStore
}): Promise<ServerRuntime> {
  const { options, core, model, tools, configStore } = input
  const prefix = createImmutablePrefix({
    systemPrompt: options.systemPrompt ?? QIONGQI_SYSTEM_PROMPT,
    pinnedConstraints: options.pinnedConstraints ?? [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable Qiongqi prefix byte-stable for prompt-cache reuse'
    ]
  })
  const tokenEconomy = tokenEconomyConfigForOptions(options)
  const scopedModelClient = new UserScopedModelClient({
    fallback: model.client,
    threadService: core.threadService,
    userDataStore: core.kworksUserDataStore,
    ...(options.runtime?.modelStreamIdleTimeoutMs !== undefined
      ? { streamIdleTimeoutMs: options.runtime.modelStreamIdleTimeoutMs }
      : {})
  })
  const reviewService = new ReviewService({
    threadStore: core.threadStore,
    turns: core.turnService,
    model: scopedModelClient,
    defaultModel: options.model,
    nowIso: core.nowIso,
    modelCapabilities: model.modelCapabilities,
    ...(options.models ? { models: options.models } : {}),
    ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
    ...(tokenEconomy ? { tokenEconomy } : {}),
    ...(options.runtime ? { runtime: options.runtime } : {})
  })
  const orchestrationMode = orchestrationModeForRuntimeOptions(options)
  const runtimeV3Root = join(options.dataDir, 'threads')
  const runtimeV3Events = orchestrationMode === 'kernel_v3' ? new FileRunEventStore(runtimeV3Root, { requireFence: true }) : undefined
  const toolRuntime = runtimeV3Events
    ? new ToolRuntimeV3({ toolHost: tools.toolHost, effects: new EffectCommitCoordinator({ events: runtimeV3Events, results: new FileEffectResultStore(runtimeV3Root), nowIso: core.nowIso }) })
    : undefined
  const orchOpts = {
    threadStore: core.threadStore,
    sessionStore: core.sessionStore,
    approvalGate: core.approvalGate,
    userInputGate: core.userInputGate,
    model: scopedModelClient,
    toolHost: tools.toolHost,
    usage: core.usageService,
    events: core.events,
    turns: core.turnService,
    inflight: core.inflight,
    steering: core.steering,
    compactor: core.compactor,
    prefix,
    ids: core.ids,
    nowIso: core.nowIso,
    modelCapabilities: model.modelCapabilities,
    skillRuntime: tools.skillRuntime,
    skillPluginHost: tools.skillPluginHost,
    tokenEconomy,
    contextCompaction: options.contextCompaction,
    runtimeDataDir: options.dataDir,
    ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
    ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {}),
    ...(tools.attachmentStore ? { attachmentStore: tools.attachmentStore } : {}),
    ...(tools.memoryStore ? { memoryStore: tools.memoryStore } : {}),
    onPlanWritten: async ({ threadId, planId, relativePath, markdown }: { threadId: string; planId: string; relativePath: string; markdown: string }) => {
      await core.threadService.syncTodosFromPlan(threadId, {
        planId,
        relativePath,
        markdown,
        preserveCompleted: true
      })
    },
    ...(toolRuntime ? { toolRuntime } : {})
  }
  const loop = orchestrationMode === 'evented_v2'
    ? new EventedTurnOrchestrator(
        orchOpts,
        new FileTurnStateStore(join(options.dataDir, 'threads')),
        new TurnEventBus(),
        defaultLoopPlan(),
        defaultLoopEvaluator
      )
    : orchestrationMode === 'kernel_v3'
      ? createKernelV3TurnRunner({
          options,
          core,
          model,
          modelClient: scopedModelClient,
          tools,
          prefix,
          tokenEconomy,
          runtimeV3Root,
          events: runtimeV3Events ?? new FileRunEventStore(runtimeV3Root),
          toolRuntime: toolRuntime ?? new ToolRuntimeV3({
            toolHost: tools.toolHost,
            effects: new EffectCommitCoordinator({
              events: runtimeV3Events ?? new FileRunEventStore(runtimeV3Root),
              results: new FileEffectResultStore(runtimeV3Root),
              nowIso: core.nowIso
            })
          })
        })
      : new TurnOrchestrator(orchOpts)
  const currentCapabilities = () => {
    const config = configStore.snapshot?.() ?? qiongqiConfigFromRuntimeOptions(options)
    const effectiveCapabilities = withRuntimeMountedSkillRoots(
      config.capabilities ?? options.capabilities,
      options.capabilities?.skills.roots ?? []
    )
    return buildRuntimeCapabilityManifest({
      config: effectiveCapabilities,
      model: model.modelCapabilities(config.serve?.model ?? options.model),
      mcp: {
        configuredServers: Object.keys(effectiveCapabilities?.mcp.servers ?? {}).length,
        connectedServers: tools.mcpProviders.connectedServers,
        toolCount: tools.mcpProviders.toolCount,
        lastError: tools.mcpProviders.diagnostics.find((d) => d.lastError)?.lastError,
        search: {
          active: tools.mcpProviders.search.active,
          indexedToolCount: tools.mcpProviders.search.indexedToolCount,
          advertisedToolCount: tools.mcpProviders.search.advertisedToolCount
        }
      },
      web: {
        fetchAvailable: tools.webProviders.fetchAvailable,
        searchAvailable: tools.webProviders.searchAvailable,
        provider: tools.webProviders.provider,
        reason: tools.webProviders.diagnostics.find((d) => d.reason)?.reason
      },
      skills: {
        configuredRoots: effectiveCapabilities?.skills.roots.length,
        discoveredSkills: tools.skillRuntime.count(),
        reason: tools.skillRuntime.diagnostics().validationErrors[0]?.message
      },
      attachments: { available: Boolean(tools.attachmentStore) },
      memory: { available: Boolean(tools.memoryStore) },
      subagents: { available: Boolean(tools.delegationRuntime) }
    })
  }
  const startedAt = options.startedAt ?? core.nowIso()

  // Stage 2: build or accept the AgentCard. When the caller supplied
  // an explicit card we trust it verbatim (after re-validation).
  // Otherwise we derive one from host/port/model/agentName and
  // persist a stable id under <dataDir>/agent-identity.json so the
  // same dataDir yields the same card id across restarts.
  const skillSummaries: SkillSummary[] = tools.skillRuntime.diagnostics().skills.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version ?? '0.0.0',
    ...(s.description ? { description: s.description } : {}),
    category: 'workflow' as const
  }))
  const initialCapabilities = currentCapabilities()
  const endpointFormat = options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT
  const agentCard = options.agentCard ?? await buildAgentCard({
    dataDir: options.dataDir,
    host: options.host,
    port: options.port,
    agentName: options.agentName ?? 'Qiongqi',
    model: options.model,
    endpointFormats: [endpointFormat],
    capabilities: initialCapabilities,
    skills: skillSummaries
  })

  return {
    threadService: core.threadService,
    turnService: core.turnService,
    reviewService,
    usageService: core.usageService,
    authService: core.authService,
    kworksUserDataStore: core.kworksUserDataStore,
    eventBus: core.eventBus,
    sessionStore: core.sessionStore,
    events: core.events,
    approvalGate: core.approvalGate,
    userInputGate: core.userInputGate,
    workspaceInspector: core.workspaceInspector,
    toolHost: tools.toolHost,
    ...(tools.attachmentStore ? { attachmentStore: tools.attachmentStore } : {}),
    ...(tools.memoryStore ? { memoryStore: tools.memoryStore } : {}),
    /** Stage 2: published at /.well-known/agent-card.json */
    agentCard,
    /** Stage 4: A2A task persistence. */
    a2aTaskStore: new FileA2ATaskStore(join(options.dataDir, 'a2a-tasks')),
    runTurn(threadId, turnId) {
      return loop.runTurn(threadId, turnId)
    },
    async cancelA2ATaskTurn(input) {
      await core.turnService.interruptTurn({ ...input, discard: false })
    },
    runReview(input: Parameters<ReviewService['runReview']>[0]) {
      return reviewService.runReview(input)
    },
    storageDiagnostics: core.storageDiagnostics,
    configStore,
    refreshRuntimeTools: tools.refreshRuntimeTools,
    refreshMcpTools: tools.refreshMcpTools,
    runtimeToken: options.runtimeToken,
    insecure: options.insecure,
    allocateSeq: core.allocateSeq,
    nowIso: core.nowIso,
    info: () => ({
      agentName: options.agentName ?? 'Qiongqi',
      host: options.host,
      port: options.port,
      configPath: options.configPath,
      dataDir: options.dataDir,
      // Dynamic: prefer the live serve.model from the config store so that
      // `activateModel` (which writes serve.model) is reflected without a
      // restart. Falls back to the startup option when no store/snapshot/model
      // is available, preserving the previous behaviour.
      model: configStore?.snapshot?.()?.serve?.model ?? options.model,
      endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
      approvalPolicy: options.approvalPolicy,
      sandboxMode: options.sandboxMode,
      tokenEconomyMode: options.tokenEconomyMode,
      insecure: options.insecure,
      startedAt,
      pid: process.pid,
      capabilities: currentCapabilities()
    }),
    toolDiagnostics: async () => ({
      providers: tools.registry.diagnostics(),
      mcpServers: tools.mcpProviders.diagnostics,
      mcpSearch: tools.mcpProviders.search,
      webProviders: tools.webProviders.diagnostics,
      skills: tools.skillRuntime.diagnostics(),
      attachments: tools.attachmentStore
        ? await tools.attachmentStore.diagnostics()
        : { enabled: false, rootDir: '', count: 0, totalBytes: 0 },
      memory: tools.memoryStore
        ? await tools.memoryStore.diagnostics()
        : { enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] }
    }),
    models: () => {
      const config = runtimeConfigSnapshot(configStore)
      return modelListFromConfig(
        config.models ?? options.models,
        config.serve?.model ?? options.model,
        config.serve?.baseUrl ?? options.baseUrl
      )
    },
    skills: () => tools.skillRuntime.diagnostics(),
    skillsV2: () => tools.skillPluginHost.diagnostics(),
    shutdown: async () => {
      try {
        await tools.mcpProviders.close()
      } finally {
        try {
          await core.storesShutdown?.()
        } finally {
          core.userDataShutdown?.()
        }
      }
    }
  }
}

function modelListFromConfig(
  models: ModelConfig | undefined,
  defaultModel: string,
  defaultBaseUrl: string
): Array<Record<string, unknown>> {
  const profiles = models?.profiles
  if (!profiles || Object.keys(profiles).length === 0) {
    return [{
      id: defaultModel,
      name: defaultModel,
      use: 'qiongqi',
      model: defaultModel,
      display_name: defaultModel,
      description: 'QiongQi runtime model',
      api_key: null,
      base_url: defaultBaseUrl,
      supports_thinking: true,
      supports_reasoning_effort: true,
      reasoning_effort_values: ['auto', 'off', 'low', 'medium', 'high', 'max']
    }]
  }
  return Object.entries(profiles).map(([name, profile]) => ({
    id: name,
    name,
    use: 'qiongqi',
    model: typeof profile.providerModel === 'string' ? profile.providerModel : name,
    display_name: name,
    description: 'QiongQi runtime model',
    api_key: typeof profile.apiKey === 'string' && profile.apiKey.length > 0 ? '********' : null,
    base_url: typeof profile.baseUrl === 'string' ? profile.baseUrl : defaultBaseUrl,
    max_tokens: typeof profile.contextWindowTokens === 'number' ? profile.contextWindowTokens : null,
    supports_thinking: true,
    supports_vision: Array.isArray(profile.inputModalities) && profile.inputModalities.includes('image'),
    supports_reasoning_effort: true,
    reasoning_effort_values: ['auto', 'off', 'low', 'medium', 'high', 'max']
  }))
}

async function createPersistentStores(input: {
  dataDir: string
  storage?: StorageConfig
  nowIso: () => string
}): Promise<{
  threadStore: ThreadStore
  sessionStore: SessionStore
  diagnostics: CoreRuntime['storageDiagnostics']
  shutdown?: () => Promise<void>
}> {
  const storage = input.storage ?? DEFAULT_STORAGE_CONFIG
  if (storage.backend === 'file') {
    return {
      sessionStore: new FileSessionStore({ dataDir: input.dataDir }),
      threadStore: new FileThreadStore({ dataDir: input.dataDir }),
      diagnostics: () => ({
        backend: 'file',
        available: true,
        degraded: false
      })
    }
  }

  const threadStore = new HybridThreadStore({
    dataDir: input.dataDir,
    sqlitePath: storage.sqlitePath ? expandHomePath(storage.sqlitePath) : undefined,
    nowIso: input.nowIso
  })
  await threadStore.ready()
  return {
    threadStore,
    sessionStore: new HybridSessionStore({
      dataDir: input.dataDir,
      index: threadStore
    }),
    diagnostics: () => threadStore.diagnostics(),
    shutdown: async () => {
      threadStore.close()
    }
  }
}

export async function seedUsageCarryover(input: {
  threadStore: ThreadStore
  sessionStore: SessionStore
  usageService: UsageService
}): Promise<void> {
  const threadSummaries = await input.threadStore.list()
  await Promise.all(threadSummaries.map(async (thread) => {
    const events = await input.sessionStore.loadEventsSince(thread.id, 0)
    const latestUsage = events.reduce<UsageEvent | null>((latest, event) => {
      if (event.kind !== 'usage') return latest
      if (!latest || event.seq > latest.seq) return event
      return latest
    }, null)
    if (latestUsage) input.usageService.seedThread(thread.id, latestUsage.usage)
  }))
}

/**
 * Options for {@link createHttpServer}.
 */
export type CreateHttpServerOptions = {
  /**
   * The already-assembled runtime to mount. Obtain it from
   * {@link createAgent}, a preset like `createCodingAgent`, or by
   * composing {@link createCore}/{@link createModelAdapter}/
   * {@link createToolMatrix} directly.
   */
  agent: ServerRuntime
  /** Bind host. Defaults to `'127.0.0.1'`. */
  host?: string
  /** Bind port. `0` lets the OS pick an ephemeral port. */
  port: number
  /**
   * Optional structured access log sink. Receives one redacted entry per
   * request with request id, method, path, status, and duration.
   */
  accessLog?: DispatchRequestOptions['accessLog']
  /** Optional OpenTelemetry runtime. When omitted, `agent.info().observability` is not inspected here. */
  telemetry?: OpenTelemetryRuntime
}

/**
 * Mount a {@link ServerRuntime} on a Node.js HTTP server.
 *
 * This is the transport counterpart to {@link createAgent}: the agent
 * owns the runtime (turn loop, tools, stores), this function owns the
 * TCP listener. Splitting the two lets embedders:
 *
 * - Start the agent once, then restart only the HTTP layer on a
 *   different port (e.g. for hot-reload of TLS certs).
 * - Run an agent headlessly (no HTTP at all) by calling
 *   `agent.runTurn()` directly.
 * - Plug the same agent into a custom transport (WebSocket, IPC,
 *   etc.) without the HTTP machinery.
 *
 * @example
 * ```ts
 * const agent = await createAgent({ ... })
 * const handle = await createHttpServer({ agent, host: '127.0.0.1', port: 8899 })
 * // ... serve traffic ...
 * await handle.close()   // closes HTTP + calls agent.shutdown()
 * ```
 *
 * @returns A {@link QiongqiServeHandle} that owns both the HTTP
 *   server and the runtime lifecycle. `handle.close()` will stop the
 *   listener and invoke `agent.shutdown()`.
 */
export async function createHttpServer(
  options: CreateHttpServerOptions
): Promise<QiongqiServeHandle> {
  const router = buildRouter(options.agent)
  const telemetry = options.telemetry
  const server = await startNodeHttpServer({
    router,
    host: options.host ?? '127.0.0.1',
    port: options.port,
    accessLog: options.accessLog,
    telemetry
  })
  return {
    ...server,
    runtime: options.agent,
    close: async () => {
      try {
        await server.close()
      } finally {
        await telemetry?.shutdown()
        await options.agent.shutdown?.()
      }
    }
  }
}

/**
 * Original one-shot entry point: build the runtime AND start the HTTP
 * server in a single call.
 *
 * @deprecated since stage 1.4 — prefer the split `createAgent` +
 *   {@link createHttpServer} pair. This function is retained for CLI
 *   backward compatibility and delegates to the split pair internally.
 */
export async function startQiongqiServe(
  options: QiongqiServeRuntimeOptions
): Promise<QiongqiServeHandle> {
  const runtime = await createAgent(options)
  const telemetry = createOpenTelemetryRuntime(options.observability?.openTelemetry)
  return createHttpServer({
    agent: runtime,
    host: options.host,
    port: options.port,
    telemetry
  })
}

/**
 * Locate an optional packager-installed skill bundle.
 *
 * Stage 1.3 decoupling: callers can now pass explicit `skillRoots`
 * via options. When not provided, the runtime falls back to checking
 * `<dataDir>/builtin-skills` as a convenience for downstream
 * packagers. Returns undefined when neither is available so the
 * runtime simply starts with an empty skill registry.
 */
export async function resolveBuiltinSkillRoots(
  dataDir: string,
  skillRoots?: string[]
): Promise<string[]> {
  if (skillRoots && skillRoots.length > 0) {
    const explicit = skillRoots.filter((root) => existsSync(root))
    if (explicit.length > 0) return [...new Set(explicit)]
  }
  const roots: string[] = []
  const packaged = join(dataDir, 'builtin-skills')
  if (existsSync(packaged)) roots.push(packaged)
  const qiongqiCodingRoot = await resolveQiongqiCodingSkillRoot()
  if (qiongqiCodingRoot) roots.push(qiongqiCodingRoot)
  return [...new Set(roots)]
}

/**
 * Given a list of skill root directories (e.g. `skills/public/finance/`),
 * find every immediate subdirectory that contains a `src/` folder and build
 * a PYTHONPATH string so that shared Python packages (like `kk_common`)
 * are importable by other skill scripts.
 *
 * Example: `skills/public/finance/kk-common/src/` → added to PYTHONPATH.
 */
function computePythonPathForSkillRoots(skillRoots: readonly string[]): string {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const root of skillRoots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const srcDir = join(root, entry.name, 'src')
        if (existsSync(srcDir) && !seen.has(srcDir)) {
          seen.add(srcDir)
          paths.push(srcDir)
        }
      }
    } catch { /* root may not exist or be unreadable */ }
  }
  if (paths.length === 0) return ''
  const existing = process.env.PYTHONPATH?.trim()
  const all = existing ? [...paths, ...existing.split(':').filter(Boolean)] : paths
  return all.join(':')
}

async function resolveQiongqiCodingSkillRoot(): Promise<string | undefined> {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../../../../skills'),
    join(process.cwd(), 'skills'),
    join(process.cwd(), 'qiongqi/skills')
  ]
  for (const candidate of candidates) {
    if (await hasSkillPackages(candidate)) return candidate
  }
  return undefined
}

async function hasSkillPackages(root: string): Promise<boolean> {
  try {
    const info = await stat(root)
    if (!info.isDirectory()) return false
    return existsSync(join(root, 'tdd', 'skill.json')) || existsSync(join(root, 'review', 'skill.json'))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Stage 2: AgentCard assembly
// ---------------------------------------------------------------------------

/**
 * Derive a stable {@link AgentCard} for this agent instance.
 *
 * The card id is persisted at `<dataDir>/agent-identity.json` so the
 * same dataDir yields the same id across restarts. The first launch
 * generates a new id (`qiongqi:<uuid>`); subsequent launches reload
 * it so peers can re-establish trust without re-discovery.
 */
async function buildAgentCard(input: {
  dataDir: string
  host: string
  port: number
  agentName: string
  model: string
  endpointFormats: AgentCard['model']['endpointFormats']
  capabilities: AgentCard['capabilities']
  skills: SkillSummary[]
}): Promise<AgentCard> {
  const id = await resolveStableAgentId(input.dataDir)
  const baseUrl = `http://${input.host}:${input.port}`
  const card = AgentCardSchema.parse({
    id,
    url: baseUrl,
    name: input.agentName,
    version: '0.1.0',
    skills: input.skills,
    capabilities: input.capabilities,
    model: {
      // provider is derived from the baseUrl host so consumers know
      // which API family the agent speaks without an extra field.
      provider: deriveProviderFromHost(input.host),
      defaultModel: input.model,
      endpointFormats: input.endpointFormats
    }
  })
  return card
}

/**
 * Read or create a stable agent id for the given dataDir.
 *
 * Persistence: `<dataDir>/agent-identity.json` with shape
 * `{ id: 'qiongqi:<uuid>', createdAt: '<iso>' }`.
 */
async function resolveStableAgentId(dataDir: string): Promise<string> {
  const identityPath = join(dataDir, 'agent-identity.json')
  try {
    const text = await readFile(identityPath, 'utf8')
    const parsed = JSON.parse(text) as { id?: unknown }
    if (typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id
    }
  } catch {
    // file doesn't exist or is corrupt — fall through to creation
  }
  const id = `qiongqi:${randomUUID()}`
  try {
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      identityPath,
      JSON.stringify({ id, createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    )
  } catch {
    // Best-effort persistence — id is still returned in-memory.
  }
  return id
}

/**
 * Best-effort provider label derived from the bind host. This is only
 * a hint for discovery UIs; the authoritative model info lives in the
 * runtime capability manifest.
 */
function deriveProviderFromHost(host: string): string {
  // The host is the *bind* address, not the upstream provider, so we
  // can't infer the real provider from it. Use a neutral label and
  // let the capability manifest carry the details.
  return `qiongqi@${host}`
}
