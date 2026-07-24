import { z } from 'zod'

export const RUNTIME_CAPABILITY_CONTRACT_VERSION = 1

export const RuntimeCapabilityStatus = z.enum(['available', 'disabled', 'unavailable'])
export type RuntimeCapabilityStatus = z.infer<typeof RuntimeCapabilityStatus>

export const RuntimeCapabilityState = z
  .object({
    status: RuntimeCapabilityStatus,
    enabled: z.boolean(),
    available: z.boolean(),
    reason: z.string().optional()
  })
  .strict()
export type RuntimeCapabilityState = z.infer<typeof RuntimeCapabilityState>

export const ModelInputModality = z.enum(['text', 'image'])
export type ModelInputModality = z.infer<typeof ModelInputModality>

export const ModelMessagePartSupport = z.enum(['text', 'image_url', 'input_image'])
export type ModelMessagePartSupport = z.infer<typeof ModelMessagePartSupport>

export const ModelCapabilityMetadata = z
  .object({
    id: z.string().min(1),
    inputModalities: z.array(ModelInputModality).min(1),
    outputModalities: z.array(ModelInputModality).min(1),
    supportsToolCalling: z.boolean(),
    contextWindowTokens: z.number().int().positive().optional(),
    messageParts: z.array(ModelMessagePartSupport).min(1)
  })
  .strict()
export type ModelCapabilityMetadata = z.infer<typeof ModelCapabilityMetadata>

const CapabilityToggleConfig = z
  .object({
    enabled: z.boolean().default(false)
  })
  .strict()

const StringRecord = z.record(z.string(), z.string())

export const McpTransportKind = z.enum(['stdio', 'streamable-http', 'sse'])
export type McpTransportKind = z.infer<typeof McpTransportKind>

export const McpTrustScope = z.enum(['user', 'workspace'])
export type McpTrustScope = z.infer<typeof McpTrustScope>

export const McpToolDiscoveryMode = z.enum(['direct', 'search', 'auto'])
export type McpToolDiscoveryMode = z.infer<typeof McpToolDiscoveryMode>

export const McpSearchConfig = z
  .object({
    enabled: z.boolean().default(false),
    mode: McpToolDiscoveryMode.default('auto'),
    autoThresholdToolCount: z.number().int().positive().default(24),
    topKDefault: z.number().int().positive().default(5),
    topKMax: z.number().int().positive().default(10),
    minScore: z.number().nonnegative().default(0.15),
    bm25: z
      .object({
        k1: z.number().positive().default(1.2),
        b: z.number().min(0).max(1).default(0.75)
      })
      .strict()
      .default(() => ({ k1: 1.2, b: 0.75 }))
  })
  .strict()
  .superRefine((search, ctx) => {
    if (search.topKDefault > search.topKMax) {
      ctx.addIssue({
        code: 'custom',
        path: ['topKDefault'],
        message: 'topKDefault must be less than or equal to topKMax'
      })
    }
  })
export type McpSearchConfig = z.infer<typeof McpSearchConfig>

export const McpServerConfig = z
  .object({
    enabled: z.boolean().default(true),
    transport: McpTransportKind,
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    url: z.string().min(1).optional(),
    headers: StringRecord.default({}),
    env: StringRecord.default({}),
    trustScope: McpTrustScope.default('workspace'),
    trustedWorkspaceRoots: z.array(z.string().min(1)).default([]),
    timeoutMs: z.number().int().positive().default(30_000)
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio MCP servers require command'
      })
    }
    if ((server.transport === 'streamable-http' || server.transport === 'sse') && !server.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `${server.transport} MCP servers require url`
      })
    }
    if (server.url) {
      try {
        const parsed = new URL(server.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server url must use http or https'
          })
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP server url must be a valid URL'
        })
      }
    }
    if (server.trustScope === 'workspace' && server.trustedWorkspaceRoots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['trustedWorkspaceRoots'],
        message: 'workspace-scoped MCP servers require at least one trusted workspace root'
      })
    }
  })
export type McpServerConfig = z.infer<typeof McpServerConfig>

export const McpCapabilityConfig = CapabilityToggleConfig.extend({
  servers: z.record(z.string().min(1), McpServerConfig).default({}),
  search: McpSearchConfig.default(() => McpSearchConfig.parse({}))
}).strict()
export type McpCapabilityConfig = z.infer<typeof McpCapabilityConfig>

export const WebCapabilityConfig = CapabilityToggleConfig.extend({
  fetchEnabled: z.boolean().default(false),
  searchEnabled: z.boolean().default(false),
  provider: z.string().min(1).optional(),
  allowDomains: z.array(z.string().min(1)).default([]),
  denyDomains: z.array(z.string().min(1)).default([])
}).strict()
export type WebCapabilityConfig = z.infer<typeof WebCapabilityConfig>

export const SkillMarketplaceSource = z.union([
  z.object({ kind: z.literal('git'), url: z.string().min(1), branch: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1) }).strict()
])
export type SkillMarketplaceSource = z.infer<typeof SkillMarketplaceSource>

export const SkillMarketplaceConfig = z.object({
  source: SkillMarketplaceSource.optional(),
  autoUpdate: z.boolean().default(false)
}).strict()
export type SkillMarketplaceConfig = z.infer<typeof SkillMarketplaceConfig>

export const DEFAULT_LOCKED_SKILL_IDS = [
  'find-skills',
  'goal',
  'skill-creator',
  'todo',
  'web'
] as const

const SkillId = z.string().min(1)

export const WorkModeConfig = z.object({
  id: SkillId,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  builtin: z.boolean().default(false),
  editable: z.boolean().default(true),
  defaultSkillIds: z.array(SkillId).default([])
}).strict()
export type WorkModeConfig = z.infer<typeof WorkModeConfig>

export const DEFAULT_WORK_MODES = {
  coding: {
    id: 'coding',
    name: 'Coding 模式',
    description: 'Full-cycle software engineering: spec-driven design, implementation, testing, debugging, review, optimization, and delivery. Skills are orchestrated per task scenario with recursive analysis and verification at each step.',
    builtin: true,
    editable: true,
    defaultSkillIds: [
      'acceptance-criteria',
      'agent-memory-isolation',
      'api-contract-first',
      'api-design',
      'architecture',
      'brainstorming',
      'build-system',
      'ci-cd',
      'code-review',
      'codebase-analysis',
      'concurrent-async-programming',
      'context-engineering',
      'context-management',
      'database',
      'database-performance-tuning',
      'debug',
      'debugging',
      'dependency-upgrade',
      'deployment',
      'diff-analysis',
      'docs',
      'environment-setup',
      'error-handling',
      'fastapi-backend',
      'frontend-engineering',
      'frontend-performance',
      'git-worktrees',
      'goal',
      'handoff-docs',
      'implement',
      'llm-app-development',
      'migration',
      'observability',
      'operations-runbook',
      'patch-authoring',
      'performance',
      'planning',
      'playwright-verification',
      'pr-review-advanced',
      'product-spec',
      'project-delivery-workflow',
      'project-scaffolding',
      'qa-test-plan',
      'qiongqi-roi',
      'react-nextjs',
      'refactor',
      'refactoring',
      'release-engineering',
      'requirements-analysis',
      'review',
      'rollback-recovery',
      'scratch-workspace',
      'security-hardening',
      'security-review',
      'skill-authoring',
      'spec-driven-development',
      'state-management',
      'subagent-orchestration',
      'systematic-debugging',
      'task-decomposition',
      'tdd',
      'technical-design',
      'test-driven-development',
      'test-writer',
      'todo',
      'typescript',
      'ui-polish',
      'using-git-worktrees',
      'using-superpowers',
      'verification-before-completion',
      'vertical-slice-development',
      'web',
      'web-accessibility',
      'webapp-testing',
      'workflow-automation'
    ]
  }
} satisfies Record<string, WorkModeConfig>

export const WorkModesConfig = z.object({
  defaultModeId: SkillId.default('coding'),
  modes: z.record(SkillId, WorkModeConfig).default(() => DEFAULT_WORK_MODES)
}).strict()
export type WorkModesConfig = z.infer<typeof WorkModesConfig>

export const ModeSkillOverrideConfig = z.object({
  addedSkillIds: z.array(SkillId).default([]),
  removedSkillIds: z.array(SkillId).default([])
}).strict()
export type ModeSkillOverrideConfig = z.infer<typeof ModeSkillOverrideConfig>

export const SkillsCapabilityConfig = CapabilityToggleConfig.extend({
  roots: z.array(z.string().min(1)).default([]),
  legacySkillMd: z.boolean().default(true),
  marketplace: SkillMarketplaceConfig.default(() => SkillMarketplaceConfig.parse({})),
  enabledSkills: z.record(z.string().min(1), z.boolean()).default({}),
  lockedSkillIds: z.array(SkillId).default(() => [...DEFAULT_LOCKED_SKILL_IDS]),
  workModes: WorkModesConfig.default(() => WorkModesConfig.parse({})),
  modeSkillOverrides: z.record(SkillId, ModeSkillOverrideConfig).default({})
}).strict()
export type SkillsCapabilityConfig = z.infer<typeof SkillsCapabilityConfig>

export const SubagentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxParallel: z.number().int().nonnegative().default(0),
  maxChildRuns: z.number().int().nonnegative().default(0),
  // Accept the removed legacy field so old configs keep loading, but ignore it.
  defaultStepLimit: z.number().int().positive().optional()
})
  .strict()
  .transform(({ defaultStepLimit: _legacyDefaultStepLimit, ...config }) => config)
export type SubagentsCapabilityConfig = z.output<typeof SubagentsCapabilityConfig>

/**
 * 多 agent 图能力配置。team 模式（evented_v2）编排的预算与上限。
 * 来源：KWorks capabilities.ts（AgentGraphCapabilityConfig）。
 */
/**
 * 默认启用的 specialist id 集合（KCoder 原生 10 个编码 specialist）。
 * 来源：KWorks DEFAULT_AGENT_GRAPH_SPECIALIST_IDS（KCoder 替换为原生 specialist）。
 */
export const DEFAULT_AGENT_GRAPH_SPECIALIST_IDS = [
  'planning',
  'backend',
  'frontend',
  'testing',
  'review',
  'security',
  'devops',
  'docs',
  'frontend-native',
  'tooling'
] as const

export const AgentGraphCapabilityConfig = CapabilityToggleConfig.extend({
  /** 并行执行的 agent 节点上限。 */
  maxParallelNodes: z.number().int().positive().default(4),
  /** 单次路由可激活的 specialist 数量上限。 */
  maxActivatedSpecialists: z.number().int().nonnegative().default(10),
  /** 每个节点的最大重试次数。 */
  maxRetriesPerNode: z.number().int().nonnegative().default(2),
  /** 单次运行的最大时长（毫秒）。 */
  maxDurationMs: z.number().int().positive().default(600000),
  /** 启用的 specialist id 集合（决策服务 preflight 检查非空）。 */
  specialistRegistry: z.array(z.string().min(1)).default(() => [...DEFAULT_AGENT_GRAPH_SPECIALIST_IDS])
})
  .strict()
  .transform((config) => ({
    ...config,
    specialistRegistry:
      config.enabled && config.specialistRegistry.length === 0
        ? [...DEFAULT_AGENT_GRAPH_SPECIALIST_IDS]
        : config.specialistRegistry
  }))
export type AgentGraphCapabilityConfig = z.output<typeof AgentGraphCapabilityConfig>

/**
 * 运行时能力快照 — 决策服务在决定编排模式时读取，并持久化到 Turn 上。
 * revision 是内容哈希前缀（cap_<sha256_16hex>），用于幂等校验。
 * 来源：KWorks capabilities.ts（RuntimeCapabilitySnapshotSchema）。
 */
export const RuntimeCapabilitySnapshotSchema = z.object({
  revision: z.string().min(1),
  subagents: SubagentsCapabilityConfig,
  agentGraph: AgentGraphCapabilityConfig
}).strict()
export type RuntimeCapabilitySnapshot = z.infer<typeof RuntimeCapabilitySnapshotSchema>

export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES = 512 * 1024
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION = 1280
export const DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE = 'image/webp'
export const DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/octet-stream'
] as const

export const AttachmentsCapabilityConfig = CapabilityToggleConfig.extend({
  maxImageBytes: z.number().int().positive().default(5 * 1024 * 1024),
  maxImageDimension: z.number().int().positive().default(4096),
  allowedMimeTypes: z.array(z.string().min(1)).default(() => [...DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES]),
  textFallbackMaxBase64Bytes: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_BASE64_BYTES),
  textFallbackMaxImageDimension: z.number().int().positive().default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_MAX_IMAGE_DIMENSION),
  textFallbackPreferredMimeType: z.string().min(1).default(DEFAULT_ATTACHMENT_TEXT_FALLBACK_PREFERRED_MIME_TYPE)
})
  .strict()
  .transform((config) => ({
    ...config,
    enabled: true,
    allowedMimeTypes: mergeAttachmentMimeTypes(config.allowedMimeTypes)
  }))
export type AttachmentsCapabilityConfig = z.infer<typeof AttachmentsCapabilityConfig>

export const MemoryCapabilityConfig = CapabilityToggleConfig.extend({
  scopes: z.array(z.enum(['user', 'workspace', 'project'])).default(['user', 'workspace', 'project']),
  maxInjectedRecords: z.number().int().positive().default(8)
})
  .strict()
  .transform((config) => ({
    ...config,
    enabled: true
  }))
export type MemoryCapabilityConfig = z.infer<typeof MemoryCapabilityConfig>

export const QiongqiCapabilitiesConfig = z
  .object({
    mcp: McpCapabilityConfig.default(() => McpCapabilityConfig.parse({})),
    web: WebCapabilityConfig.default(() => WebCapabilityConfig.parse({})),
    skills: SkillsCapabilityConfig.default(() => SkillsCapabilityConfig.parse({})),
    subagents: SubagentsCapabilityConfig.default(() => SubagentsCapabilityConfig.parse({})),
    agentGraph: AgentGraphCapabilityConfig.default(() => AgentGraphCapabilityConfig.parse({})),
    attachments: AttachmentsCapabilityConfig.default(() => AttachmentsCapabilityConfig.parse({})),
    memory: MemoryCapabilityConfig.default(() => MemoryCapabilityConfig.parse({}))
  })
  .strict()
export type QiongqiCapabilitiesConfig = z.infer<typeof QiongqiCapabilitiesConfig>

export const DEFAULT_QIONGQI_CAPABILITIES_CONFIG: QiongqiCapabilitiesConfig = QiongqiCapabilitiesConfig.parse({})

export const RuntimeCapabilityManifest = z
  .object({
    contractVersion: z.literal(RUNTIME_CAPABILITY_CONTRACT_VERSION),
    model: ModelCapabilityMetadata,
    cli: z
      .object({
        serve: RuntimeCapabilityState,
        run: RuntimeCapabilityState,
        chat: RuntimeCapabilityState,
        exec: RuntimeCapabilityState
      })
      .strict(),
    mcp: RuntimeCapabilityState.extend({
      configuredServers: z.number().int().nonnegative(),
      connectedServers: z.number().int().nonnegative(),
      toolCount: z.number().int().nonnegative(),
      search: z
        .object({
          enabled: z.boolean(),
          mode: McpToolDiscoveryMode,
          active: z.boolean(),
          indexedToolCount: z.number().int().nonnegative(),
          advertisedToolCount: z.number().int().nonnegative()
        })
        .strict()
    }).strict(),
    web: RuntimeCapabilityState.extend({
      fetch: RuntimeCapabilityState,
      search: RuntimeCapabilityState,
      provider: z.string().optional()
    }).strict(),
    skills: RuntimeCapabilityState.extend({
      configuredRoots: z.number().int().nonnegative(),
      discoveredSkills: z.number().int().nonnegative()
    }).strict(),
    subagents: RuntimeCapabilityState.extend({
      maxParallel: z.number().int().nonnegative(),
      maxChildRuns: z.number().int().nonnegative()
    }).strict(),
    attachments: RuntimeCapabilityState.extend({
      maxImageBytes: z.number().int().positive(),
      maxImageDimension: z.number().int().positive(),
      allowedMimeTypes: z.array(z.string().min(1)),
      textFallbackMaxBase64Bytes: z.number().int().positive(),
      textFallbackMaxImageDimension: z.number().int().positive(),
      textFallbackPreferredMimeType: z.string().min(1)
    }).strict(),
    memory: RuntimeCapabilityState.extend({
      scopes: z.array(z.enum(['user', 'workspace', 'project'])),
      maxInjectedRecords: z.number().int().positive()
    }).strict()
  })
  .strict()
export type RuntimeCapabilityManifest = z.infer<typeof RuntimeCapabilityManifest>

export function buildRuntimeCapabilityManifest(input: {
  config?: QiongqiCapabilitiesConfig
  model: ModelCapabilityMetadata
  mcp?: {
    configuredServers?: number
    connectedServers?: number
    toolCount?: number
    lastError?: string
    search?: {
      active?: boolean
      indexedToolCount?: number
      advertisedToolCount?: number
    }
  }
  web?: {
    fetchAvailable?: boolean
    searchAvailable?: boolean
    provider?: string
    reason?: string
  }
  skills?: {
    configuredRoots?: number
    discoveredSkills?: number
    reason?: string
  }
  attachments?: {
    available?: boolean
    reason?: string
  }
  memory?: {
    available?: boolean
    reason?: string
  }
  subagents?: {
    available?: boolean
    reason?: string
  }
}): RuntimeCapabilityManifest {
  const config = QiongqiCapabilitiesConfig.parse(input.config ?? {})
  const configuredMcpServers = input.mcp?.configuredServers ?? Object.keys(config.mcp.servers).length
  const connectedMcpServers = input.mcp?.connectedServers ?? 0
  const mcpToolCount = input.mcp?.toolCount ?? 0
  const mcpState = mcpCapabilityState(config.mcp.enabled, connectedMcpServers, input.mcp?.lastError)
  const webFetchState = providerCapabilityState(
    config.web.enabled && config.web.fetchEnabled,
    'web fetch is disabled by config',
    input.web?.fetchAvailable === true,
    input.web?.reason ?? 'web fetch provider is unavailable'
  )
  const webSearchState = providerCapabilityState(
    config.web.enabled && config.web.searchEnabled,
    'web search is disabled by config',
    input.web?.searchAvailable === true,
    input.web?.reason ?? 'web search provider is unavailable'
  )
  const webState = webCapabilityState(config.web.enabled, webFetchState, webSearchState, input.web?.reason)
  const configuredSkillRoots = input.skills?.configuredRoots ?? config.skills.roots.length
  const discoveredSkills = input.skills?.discoveredSkills ?? 0
  const skillsState = skillsCapabilityState(config.skills.enabled, discoveredSkills, input.skills?.reason)
  return RuntimeCapabilityManifest.parse({
    contractVersion: RUNTIME_CAPABILITY_CONTRACT_VERSION,
    model: input.model,
    cli: {
      serve: available(),
      run: unavailable('not implemented'),
      chat: unavailable('not implemented'),
      exec: unavailable('not implemented')
    },
    mcp: {
      ...mcpState,
      configuredServers: configuredMcpServers,
      connectedServers: connectedMcpServers,
      toolCount: mcpToolCount,
      search: {
        enabled: config.mcp.search.enabled,
        mode: config.mcp.search.mode,
        active: input.mcp?.search?.active ?? false,
        indexedToolCount: input.mcp?.search?.indexedToolCount ?? mcpToolCount,
        advertisedToolCount: input.mcp?.search?.advertisedToolCount ?? mcpToolCount
      }
    },
    web: {
      ...webState,
      fetch: webFetchState,
      search: webSearchState,
      provider: input.web?.provider ?? config.web.provider
    },
    skills: {
      ...skillsState,
      configuredRoots: configuredSkillRoots,
      discoveredSkills
    },
    subagents: {
      ...providerCapabilityState(
        config.subagents.enabled,
        'subagents are disabled by config',
        input.subagents?.available === true,
        input.subagents?.reason ?? 'subagent runtime is unavailable'
      ),
      maxParallel: config.subagents.maxParallel,
      maxChildRuns: config.subagents.maxChildRuns
    },
    attachments: {
      ...providerCapabilityState(
        config.attachments.enabled,
        'attachments are disabled by config',
        input.attachments?.available === true,
        input.attachments?.reason ?? 'attachment store is unavailable'
      ),
      maxImageBytes: config.attachments.maxImageBytes,
      maxImageDimension: config.attachments.maxImageDimension,
      allowedMimeTypes: config.attachments.allowedMimeTypes,
      textFallbackMaxBase64Bytes: config.attachments.textFallbackMaxBase64Bytes,
      textFallbackMaxImageDimension: config.attachments.textFallbackMaxImageDimension,
      textFallbackPreferredMimeType: config.attachments.textFallbackPreferredMimeType
    },
    memory: {
      ...providerCapabilityState(
        config.memory.enabled,
        'memory is disabled by config',
        input.memory?.available === true,
        input.memory?.reason ?? 'memory store is unavailable'
      ),
      scopes: config.memory.scopes,
      maxInjectedRecords: config.memory.maxInjectedRecords
    }
  })
}

function available(): RuntimeCapabilityState {
  return { status: 'available', enabled: true, available: true }
}

function unavailable(reason: string): RuntimeCapabilityState {
  return { status: 'unavailable', enabled: false, available: false, reason }
}

function stateFromEnabled(
  enabled: boolean,
  disabledReason: string,
  unavailableReason: string
): RuntimeCapabilityState {
  return enabled
    ? { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
    : { status: 'disabled', enabled: false, available: false, reason: disabledReason }
}

function providerCapabilityState(
  enabled: boolean,
  disabledReason: string,
  availableProvider: boolean,
  unavailableReason: string
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: disabledReason }
  return availableProvider
    ? { status: 'available', enabled: true, available: true }
    : { status: 'unavailable', enabled: true, available: false, reason: unavailableReason }
}

function mergeAttachmentMimeTypes(values: readonly string[]): string[] {
  return [...new Set([...DEFAULT_ATTACHMENT_ALLOWED_MIME_TYPES, ...values])]
}

function webCapabilityState(
  enabled: boolean,
  fetchState: RuntimeCapabilityState,
  searchState: RuntimeCapabilityState,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'web access is disabled by config' }
  if (fetchState.available || searchState.available) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no web providers available'
  }
}

function skillsCapabilityState(
  enabled: boolean,
  discoveredSkills: number,
  reason: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'Skills are disabled by config' }
  if (discoveredSkills > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: reason ?? 'no Skills discovered'
  }
}

function mcpCapabilityState(
  enabled: boolean,
  connectedServers: number,
  lastError: string | undefined
): RuntimeCapabilityState {
  if (!enabled) return { status: 'disabled', enabled: false, available: false, reason: 'MCP is disabled by config' }
  if (connectedServers > 0) return { status: 'available', enabled: true, available: true }
  return {
    status: 'unavailable',
    enabled: true,
    available: false,
    reason: lastError ?? 'no MCP servers connected'
  }
}
