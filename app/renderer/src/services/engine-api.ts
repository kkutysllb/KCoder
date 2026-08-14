// QiLin Engine API Client
//
// Governed-graph shapes (RoiSnapshot / EngineStreamEvent) are localized to
// ./contracts.ts as structural interfaces. QiLin never emits governed-graph
// events, so the data stays null at runtime.
import type {
  EngineStreamEvent,
  BranchRoiSnapshot,
  RoiSnapshot
} from './contracts'

export interface ThreadResponse {
  id: string
  createdAt: string
  workspace?: string
  model?: string
  mode?: 'agent' | 'plan'
  workModeId?: string
  title?: string
}

export interface SkillEntry {
  id: string
  name: string
  description: string
  version: string
  root: string
  category: string
  family: string
  license: string
  enabled: boolean
  registered: boolean
  status: 'registered' | 'disabled' | 'invalid'
  builtin: boolean
  editable: boolean
  deletable: boolean
  legacy: boolean
  commands: Array<{ id?: string; alias?: string[]; description?: string }>
  contributions: Record<string, unknown>
  permissions: Record<string, unknown>
  validationError?: string
}

export interface MarketplaceSkill {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string[]
  source: string
  downloads: number
}

export interface MarketplaceIndex {
  version: number
  updatedAt: string | null
  skills: MarketplaceSkill[]
}

export interface SubAgentEntry {
  id: string
  name: string
  type: 'builtin' | 'user'
  description: string
  tools: string[]
  source: string
  content: string
  inheritMode: 'default' | 'custom'
  createdAt?: string
  updatedAt?: string
}

export interface McpServerConfigEntry {
  enabled: boolean
  transport: 'stdio' | 'streamable-http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  trustScope?: 'user' | 'workspace'
  trustedWorkspaceRoots?: string[]
  timeoutMs?: number
  description?: string
}

export interface McpConfigResponse {
  mcp_servers: Record<string, McpServerConfigEntry>
  mcpServers: Record<string, McpServerConfigEntry>
  skills: Record<string, { enabled: boolean }>
}

export interface McpServerDiagnostic {
  id: string
  enabled: boolean
  transport: string
  trustScope: string
  available: boolean
  status: 'disabled' | 'connected' | 'error'
  toolCount: number
  lastConnectedAt?: string
  lastError?: string
}

export interface PluginEntry {
  id: string
  name: string
  version: string
  description: string
  builtin: boolean
  enabled: boolean
  source: 'official' | 'community' | 'unknown'
  category: string
  provides: {
    skills: number
    commands: number
    hooks: number
    mcpServers: number
  }
  author?: string
  updatedAt?: string
}

/** DiscoverPlugin — GET /api/plugins/discover 返回的市场插件。 */
export interface DiscoverPlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  category: string
  downloads: number
  installed: boolean
}

export interface CommandEntry {
  id: string
  description: string
  content: string
  source: 'skill' | 'user'
  skillId?: string
  aliases: string[]
  createdAt?: string
  updatedAt?: string
}

export interface RemoteConfig {
  remoteEnabled: boolean
  remoteUrl: string
  remoteToken: string
  exposeEnabled: boolean
  exposeToken: string
  requireAuth: boolean
  permissionLevel: 'readonly' | 'full'
  sessionTimeout: number
}

export interface RemoteSessionInfo {
  id: string
  device: string
  ip: string
  connectedAt: string
  permission: 'readonly' | 'full'
}

export interface TurnResponse {
  threadId: string
  turnId: string
  userMessageItemId: string
}

// ============ Attachment types ============

export interface AttachmentMetadata {
  id: string
  name: string
  mimeType?: string
  size: number
  threadId?: string
  workspace?: string
  createdAt: string
}

// ============ Memory types ============

/** MemoryRecord — a persistent knowledge entry (legacy scope: user/workspace/project). */
export interface MemoryRecord {
  id: string
  content: string
  scope: 'user' | 'workspace' | 'project'
  tags: string[]
  confidence: number
  workspace?: string
  project?: string
  sourceThreadId?: string
  ownerUserId?: string
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

// ============ Runtime config types ============
//
// 对齐 QiLin Pydantic 模型（vendor/qilin/qilin/config/*_config.py）。
// GET /v1/runtime-config 返回热重载后的生效值；PUT 写 config.yaml。

/** 记忆机制配置（对齐 QiLin MemoryConfig）。 */
export interface MemoryRuntimeConfig {
  enabled: boolean
  mode: 'middleware' | 'tool'
  injection_enabled: boolean
  shutdown_flush_timeout_seconds: number
  manager_class: string
  backend_config: Record<string, unknown>
}

/** 上下文尺寸规格（触发阈值 / 保留策略）。 */
export interface ContextSize {
  type: 'fraction' | 'tokens' | 'messages'
  value: number
}

/** 摘要配置（对齐 QiLin SummarizationConfig）。 */
export interface SummarizationConfig {
  enabled: boolean
  model_name: string | null
  trigger: ContextSize | ContextSize[] | null
  keep: ContextSize
  trim_tokens_to_summarize: number | null
  summary_prompt: string | null
  skill_file_read_tool_names: string[]
}

/** 标题生成配置（对齐 QiLin TitleConfig）。 */
export interface TitleConfig {
  enabled: boolean
  max_words: number
  max_chars: number
  model_name: string | null
  prompt_template: string
}

/** 沙箱配置（对齐 QiLin SandboxConfig，仅暴露本地场景字段）。 */
export interface SandboxConfig {
  use: string
  allow_host_bash: boolean
  bash_command_timeout: number
  bash_output_max_chars: number
  read_file_output_max_chars: number
  ls_output_max_chars: number
  [key: string]: unknown
}

/** 数据与持久化配置（对齐 QiLin DatabaseConfig）。 */
export interface DatabaseConfig {
  backend: 'memory' | 'sqlite' | 'postgres'
  checkpoint_channel_mode: 'full' | 'delta'
  sqlite_dir: string
  postgres_url: string
  pool_size: number
  pool_recycle: number
  command_timeout: number | null
  [key: string]: unknown
}

/** 附件上传配置（size 字段以字节存储）。 */
export interface UploadsConfig {
  max_files: number
  max_file_size: number
  max_total_size: number
  auto_convert_documents: boolean
  [key: string]: unknown
}

/** 网络与 Web 工具配置（全局代理 + 搜索/浏览器默认值）。 */
export interface NetworkConfig {
  proxy: string | null
  web_search_max_results: number
  web_fetch_timeout: number
  image_search_max_results: number
  browser_headless: boolean
  browser_viewport_width: number
  browser_viewport_height: number
  browser_timeout_ms: number
  [key: string]: unknown
}

/** Token 用量记录开关（对齐 QiLin TokenUsageConfig）。 */
export interface TokenUsageConfig {
  enabled: boolean
}

/** Token 预算限制（对齐 QiLin TokenBudgetConfig）。 */
export interface TokenBudgetConfig {
  enabled: boolean
  max_tokens: number
  max_input_tokens: number | null
  max_output_tokens: number | null
  warn_threshold: number
  hard_stop_threshold: number
  per_agent: Record<string, unknown>
  [key: string]: unknown
}

/** 运行时配置合集。 */
export interface RuntimeConfig {
  memory: MemoryRuntimeConfig
  summarization: SummarizationConfig
  title: TitleConfig
  sandbox: SandboxConfig
  database: DatabaseConfig
  uploads: UploadsConfig
  network: NetworkConfig
  tokenUsage: TokenUsageConfig
  tokenBudget: TokenBudgetConfig
}

export type RuntimeConfigSection = 'memory' | 'summarization' | 'title' | 'sandbox' | 'database' | 'uploads' | 'network' | 'token_usage' | 'token_budget'

// ============ Token usage statistics types ============

/** 单模型的 token 用量分解（GET /v1/token-usage/stats by_model）。 */
export interface TokenUsageModelBreakdown {
  tokens: number
  runs: number
  llm_call_count: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
}

/** 按调用方分解（lead agent / subagent / middleware）。 */
export interface TokenUsageCallerBreakdown {
  lead_agent: number
  subagent: number
  middleware: number
}

/** 跨会话全局 token 用量统计（GET /v1/token-usage/stats）。 */
export interface TokenUsageStats {
  total_tokens: number
  total_input_tokens: number
  total_output_tokens: number
  total_runs: number
  total_llm_call_count: number
  total_cache_read_tokens: number
  by_model: Record<string, TokenUsageModelBreakdown>
  by_caller: TokenUsageCallerBreakdown
}

/** 按天×模型的时间序列条目（GET /v1/token-usage/timeseries）。 */
export interface TokenUsageTimeseriesItem {
  date: string
  model_name: string
  run_count: number
  llm_call_count: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
}

/** 日历月筛选（北京时间）。 */
export interface MonthFilter {
  year: number
  month: number
}

// ============ Governed graph governance types ============

/** Circuit state for a governed graph run. */
export type CircuitState = 'running' | 'report_only' | 'paused' | 'retired'

/** Graph run status. */
export type GraphRunStatus = 'created' | 'running' | 'suspended' | 'completed' | 'failed' | 'aborted'

/**
 * Graph run inspection — GET /v1/engine/runs/:runId/inspect.
 * Minimal view of GraphRunRecord (the engine's full record is larger; we only
 * consume the fields the renderer needs for governance display).
 */
export interface GraphRunInspection {
  runId: string
  threadId: string
  turnId: string
  graphId: string
  graphRevision: number
  status: GraphRunStatus
  circuitState: CircuitState
  activeNodeIds: string[]
  budgets: { stepsUsed: number; toolCallsUsed: number; inputTokens: number; outputTokens: number; costUsd: number }
  updatedAt: string
}

// ============ Turn Execution Projection types ============
//
// These view types are the renderer's projection of the engine's durable
// run timeline (GET /v1/runtime/evented-v2/runs/:runId/timeline) plus the
// governed engine stream (GET /v1/engine/streams/:streamId/subscribe).
//
// The engine's authoritative timeline shape (EventedV2RunTimeline) is
// browser-unsafe in the foundation package, so we re-declare the minimal
// fields we consume here. The ROI / branch-attribution types are imported
// type-only from ./contracts (structural local interfaces).
//
// DRIFT FIX: the previous hand-written types invented a `parallelGroup`
// field on AgentGraphNodeView that does not exist anywhere in the engine.
// The real unit of parallelism is `branchId` (on AgentRun, GraphAttribution,
// GraphCorrelationIdentity, and DurableBranchRun). These types now model
// branches correctly.

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

/** Branch lifecycle status, aligned with engine DurableBranchRun.status. */
export type BranchStatus = 'queued' | 'running' | 'suspended' | 'completed' | 'failed' | 'aborted'

/**
 * Minimal mirror of the engine's EventedV2RunTimeline — only the fields the
 * renderer consumes. Sourced from GET /v1/runtime/evented-v2/runs/:runId/timeline.
 */
export interface RunTimelineView {
  runId: string
  threadId: string
  turnId?: string
  graphId: string
  status: ExecutionStatus
  activeNodeId: string | null
  /** Agent keys/node ids currently active (root + any running branches). */
  activeAgentStack: string[]
  /** branchId -> projected status. The engine hides 'suspended' as 'running'. */
  branchStatus: Record<string, BranchStatus>
  agentRuns: Array<{
    agentRunId: string
    agentId: string
    nodeId: string
    branchId?: string
    status: ExecutionStatus
    startedAt?: string
    updatedAt?: string
    completedAt?: string
    summary?: string
    error?: string
  }>
  graphMetrics: {
    fanOut: number
    physicalAttempts: number
    retryCount: number
    retryAmplification: number
    criticalPathLatencyMs: number
  }
  roiSnapshot?: RoiSnapshot
  createdAt: string
  updatedAt: string
}

/**
 * A single agent node in the execution DAG projection. Derived from the
 * timeline's agentRuns. `branchId` is the real parallel-branch key (replaces
 * the previous fictitious `parallelGroup`).
 */
export interface AgentGraphNodeView {
  key: string
  agentKey: string
  role: 'manager' | 'specialist'
  phase?: 'planning' | 'execution' | 'synthesis'
  name: string
  status: ExecutionStatus
  required: boolean
  childAgentKeys: string[]
  /** The durable parallel branch this node belongs to (root agents have none). */
  branchId?: string
}

export interface AgentGraphEdgeView {
  from: string
  to: string
  condition?: string
}

export interface AgentGraphHandoffView {
  from: string
  to: string
  status: ExecutionStatus
}

/**
 * A durable parallel branch projection — one entry per branchId in
 * timeline.branchStatus. Drives the parallel-lane rendering in ExecutionView.
 */
export interface BranchProjection {
  branchId: string
  parallelNodeId?: string
  joinNodeId?: string
  status: BranchStatus
  /** Agent node keys active in this branch. */
  agentKeys: string[]
  roiSnapshot?: BranchRoiSnapshot
  /** Set when a result arrived after the branch was aborted/cancelled. */
  lateResult?: boolean
  /** Set when the branch was cancelled by a fail_fast sibling failure. */
  failFastCancelled?: boolean
}

export interface AgentGraphExecutionView {
  key: string
  templateId: string
  nodes: AgentGraphNodeView[]
  edges: AgentGraphEdgeView[]
  handoffs: AgentGraphHandoffView[]
  activeAgentKeys: string[]
  /** Durable parallel branches (v1.1.2). Empty for non-parallel runs. */
  branches: BranchProjection[]
  warnings: string[]
}

export interface AgentExecutionView {
  key: string
  parentKey?: string
  sequence: number
  role: 'root' | 'child' | 'manager' | 'specialist'
  phase?: 'planning' | 'execution' | 'synthesis'
  name: string
  task?: string
  status: ExecutionStatus
  branchId?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  messages: Array<{ key: string; sourceRef: string; role: string; content: string; createdAt: string }>
  reasoning: Array<{ key: string; text: string; createdAt: string }>
  toolRuns: Array<{ key: string; toolName: string; status: ExecutionStatus }>
  summary?: string
}

export interface RuntimeDecisionView {
  preferredMode: 'kernel_v3' | 'evented_v2'
  effectiveMode: 'classic' | 'kernel_v3' | 'evented_v2'
  preference: 'standard' | 'team'
  source: string
  reason: string
  fallbackReason?: string
}

export interface DelegationTreeView {
  roots: string[]
  edges: Array<{ from: string; to: string }>
}

/**
 * TurnExecutionView — the renderer's projection of a turn's execution.
 *
 * evented_v2 runs now carry real `graph` data (nodes/edges/branches/roi)
 * sourced from the run timeline. kernel_v3 keeps the delegation tree.
 * `available: false` is retained for runs that have no durable projection
 * (e.g. classic mode, or before the run is recorded).
 */
export type TurnExecutionView =
  | { version: 1; available: true; revision: string; status: ExecutionStatus; decision: RuntimeDecisionView; agents: AgentExecutionView[]; mode: 'kernel_v3'; delegation: DelegationTreeView }
  | { version: 1; available: true; revision: string; status: ExecutionStatus; decision: RuntimeDecisionView; agents: AgentExecutionView[]; mode: 'evented_v2'; graph: AgentGraphExecutionView }
  | { version: 1; available: true; revision: string; status: ExecutionStatus; decision: RuntimeDecisionView; agents: AgentExecutionView[]; mode: 'classic'; compatibility: { reason: string } }
  | { version: 1; available: false; revision: string; reason: string }

// ============ Thread Goal / Todos types ============

export interface ThreadGoal {
  threadId: string
  objective: string
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: string
  updatedAt: string
}

export interface ThreadTodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}

export interface ThreadTodoList {
  threadId: string
  items: ThreadTodoItem[]
  updatedAt: string
}

/** ApprovalRequest — 审批请求（来自 approval_requested SSE 事件）。 */
export interface ApprovalRequest {
  approvalId: string
  toolName: string
  summary?: string
  status: 'pending' | 'allowed' | 'denied' | 'expired'
}

/** UserInputQuestion — 结构化输入的单个问题。 */
export interface UserInputQuestion {
  header: string
  id: string
  question: string
  options: Array<{ label: string; description: string }>
}

/** UserInputRequest — 结构化输入请求（来自 user_input_requested SSE 事件）。 */
export interface UserInputRequest {
  inputId: string
  prompt?: string
  status: 'pending' | 'submitted' | 'cancelled'
  questions?: UserInputQuestion[]
}

// ============ Auth types (aligned with engine AuthService) ============

export interface AuthUser {
  id: string
  email: string
  username: string
  display_name: string
  system_role: 'admin' | 'user'
  is_admin: boolean
  auth_provider: 'local'
}

export interface AuthSessionResponse {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  user: AuthUser
}

export interface AuthSetupStatus {
  initialized: boolean
  has_admin: boolean
  needs_setup: boolean
  local_auth_enabled: boolean
  registration_enabled: boolean
}

export interface SSEEvent {
  kind: string
  data: Record<string, unknown>
}

/** ThreadSummary — GET /v1/threads 返回的会话摘要。 */
export interface ThreadSummary {
  id: string
  title: string
  workspace: string
  model?: string
  mode?: 'agent' | 'plan'
  workModeId?: string
  status?: string
  createdAt: string
  updatedAt: string
  archived?: boolean
}

/** ModelEntry — GET /api/models 返回的模型条目。 */
export interface ModelEntry {
  id: string
  name: string
  display_name: string
  model: string
  base_url: string | null
  active: boolean
  context_window_tokens: number | null
  supports_tool_calling: boolean
  supports_vision: boolean
  supports_reasoning_effort: boolean
  reasoning_effort_values?: string[]
  // 预设驱动的新字段（供 UI 详情页回显预设状态）
  /** 引擎 class path，决定路由到补丁版还是裸 langchain */
  use?: string
  supports_thinking?: boolean
  when_thinking_enabled?: Record<string, unknown>
  when_thinking_disabled?: Record<string, unknown>
}

/** WorkspaceStatus — GET /v1/workspace/status?path= 返回的工作区状态。 */
export interface WorkspaceStatus {
  path: string
  exists: boolean
  isGitRepository: boolean
  branch: string | null
  headSha: string | null
  isDirty: boolean | null
  fileChangeCount: number | null
  /** 新增行数（git diff --shortstat 统计，仅在工作树脏时有值）。 */
  additions?: number
  /** 删除行数。 */
  deletions?: number
  checkedAt: string
}

/** CommitResult — POST /v1/workspace/commit 与 /push 的结构化返回。 */
export interface CommitResult {
  success: boolean
  /** 提交/推送输出（git stdout，可用于 toast 显示）。 */
  output?: string
  /** 失败时的错误描述。 */
  error?: string
  /** 提交/推送后的 HEAD sha（commit 成功时填）。 */
  headSha?: string
}

/** BranchListResponse — GET /v1/workspace/branches?path= 返回的分支列表。 */
export interface BranchListResponse {
  path: string
  branches: string[]
  current: string | null
}

/** 文件树单层条目（GET /v1/workspace/tree）。 */
export interface WorkspaceTreeEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

/** 全文搜索命中（POST /v1/workspace/search）。 */
export interface SearchHit {
  file: string
  line: number
  column: number
  text: string
}

/** ProjectEntry — GET /v1/projects 返回的已注册项目（一等实体）。 */
export interface ProjectEntry {
  id: string
  name: string
  path: string
  description?: string
  is_git_repo: boolean
  created_at: string
  updated_at: string
}

export class EngineAPI {
  private baseUrl: string
  private token: string
  private authToken: string | null = null
  // The promise that resolves when the current turn's SSE stream ends
  // (turn_completed/turn_failed/turn_aborted). Set by sendMessage, awaited
  // by waitForTurnCompletion.
  private turnCompletion: Promise<void> = Promise.resolve()
  // Authenticated user id — required for product-side model management.
  // The engine stores model profiles per user and resolves them at request
  // time via thread.ownerUserId, so the id here MUST match the logged-in
  // user. Set by the auth flow once login succeeds.
  private userId: string | null = null

  constructor(port: number, token: string = '') {
    this.baseUrl = `http://127.0.0.1:${port}`
    this.token = token
  }

  // User session token takes precedence over runtime token when set
  setAuthToken(token: string | null): void {
    this.authToken = token
  }

  getAuthToken(): string | null {
    return this.authToken
  }

  /** Set the authenticated user id (drives per-user model profile storage). */
  setUserId(userId: string | null): void {
    this.userId = userId
  }

  getUserId(): string | null {
    return this.userId
  }

  /**
   * The authenticated user id, or a clear error. Model management is per-user
   * and there is no useful default — callers must ensure login completed.
   */
  private requireUserId(): string {
    if (!this.userId) {
      throw new Error('Not signed in — model configuration requires an authenticated user')
    }
    return this.userId
  }

  setRuntimeToken(token: string): void {
    this.token = token
  }

  get port(): number {
    return parseInt(this.baseUrl.split(':').pop() || '18899', 10)
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    const bearer = this.authToken || this.token
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`
    }
    return headers
  }

  // Health check
  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers
      })
      return response.ok
    } catch {
      return false
    }
  }

  // ============ Auth API (engine /v1/auth/*) ============
  // New engine consolidated all auth under /v1/auth/* (the /api/v1 prefix is gone).

  async getSetupStatus(): Promise<AuthSetupStatus> {
    const response = await fetch(`${this.baseUrl}/v1/auth/setup-status`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get setup status: ${response.statusText}`)
    }
    return response.json()
  }

  async authInitialize(email: string, password: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/auth/initialize`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ email, password })
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      throw new Error((detail as { detail?: string }).detail || `Initialize failed: ${response.statusText}`)
    }
    return response.json()
  }

  async authLogin(email: string, password: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ email, password })
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      throw new Error((detail as { detail?: string }).detail || `Login failed: ${response.statusText}`)
    }
    return response.json()
  }

  async authRegister(email: string, password: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ email, password })
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      throw new Error((detail as { detail?: string }).detail || `Registration failed: ${response.statusText}`)
    }
    return response.json()
  }

  async authMe(): Promise<AuthUser> {
    const response = await fetch(`${this.baseUrl}/v1/auth/me`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Not authenticated: ${response.statusText}`)
    }
    const data = await response.json() as { user?: AuthUser } & AuthUser
    return data.user ?? data
  }

  async authLogout(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/auth/logout`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Logout failed: ${response.statusText}`)
    }
  }

  async authChangePassword(currentPassword: string, newPassword: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/v1/auth/change-password`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      throw new Error((detail as { detail?: string }).detail || `Change password failed: ${response.statusText}`)
    }
    return response.json()
  }

  // Create a new thread
  async createThread(payload?: {
    title?: string
    workspace?: string
    model?: string
    workModeId?: string
    mode?: 'agent' | 'plan'
  }): Promise<ThreadResponse> {
    // KCoder is a coding app: pin the work mode to 'coding' unless the caller
    // overrides it. The engine defaults new threads to 'office' when the field
    // is omitted, which would mount the wrong skill set for this product.
    const body = { workModeId: 'coding', ...(payload ?? {}) }
    const response = await fetch(`${this.baseUrl}/v1/threads`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to create thread: ${text}`)
    }

    return response.json()
  }

  // Send a message and get streaming response. Returns the turnId for execution polling.
  //
  // Governed graph: the backend drives every turn through the durable
  // governed-graph execution plane. Per-turn fields:
  //   - model_name: override the default model (models[0])
  async sendMessage(
    threadId: string,
    content: string,
    onEvent: (event: SSEEvent) => void,
    attachmentIds?: string[],
    model?: string,
    reasoningMode?: 'auto' | 'off' | 'low' | 'medium' | 'high'
  ): Promise<string> {
    const turnResponse = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        prompt: content,
        ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
        ...(model ? { model_name: model } : {}),
        ...(reasoningMode && reasoningMode !== 'auto' ? { reasoning_mode: reasoningMode } : {})
      })
    })

    if (!turnResponse.ok) {
      const text = await turnResponse.text().catch(() => turnResponse.statusText)
      throw new Error(`Failed to send message: ${text}`)
    }

    const turn: TurnResponse = await turnResponse.json()

    // 订阅线程级 SSE 事件流（后端路径是 /v1/threads/:id/events，不是 /turns/:turnId/events）
    // 不 await — SSE 订阅是 fire-and-forget，让调用方立即拿到 turnId（用于设置 activeTurnId、
    // 停止按钮等）。如果 await，turnId 直到 turn 完成才返回，activeTurnId 在运行期间永远为 null。
    // 存储 promise 供 waitForTurnCompletion 使用。
    this.turnCompletion = this.subscribeToThread(threadId, turn.turnId, onEvent)
    return turn.turnId
  }

  /**
   * Wait for the current turn's SSE stream to end (turn_completed/failed/aborted).
   * Used by useChat.sendMessage to keep isGenerating=true until the turn actually
   * finishes, without blocking the turnId return (which must be immediate so the
   * stop button works).
   */
  async waitForTurnCompletion(): Promise<void> {
    await this.turnCompletion
  }

  // 订阅线程事件流。
  //
  // We use fetch + ReadableStream rather than EventSource because EventSource
  // cannot set the Authorization header (the W3C spec forbids custom headers
  // on EventSource). The engine authenticates the SSE endpoint via
  // `Authorization: Bearer` (or the access_token cookie), so an EventSource
  // with no header would get 401 and silently fail — the renderer would never
  // receive streaming events. fetch lets us send the bearer token and parse
  // the SSE frames manually from the stream.
  private subscribeToThread(
    threadId: string,
    turnId: string,
    onEvent: (event: SSEEvent) => void
  ): Promise<void> {
    const url = `${this.baseUrl}/v1/threads/${threadId}/events`
    const controller = new AbortController()

    // Reconnect tuning: unexpected stream drops (network blip, gateway/langgraph
    // restart) are retried with exponential backoff. A "terminal" SSE event
    // (turn_completed/failed/aborted) or an explicit caller abort stops retries.
    const MAX_RETRIES = 8
    const BASE_DELAY_MS = 1000
    const MAX_DELAY_MS = 30_000

    return new Promise<void>((resolve) => {
      let resolved = false
      let terminal = false // turn reached a terminal state → success, no retry
      let lastEventId = '' // best-effort resume hint (backend may ignore)

      const finish = () => {
        if (resolved) return
        resolved = true
        controller.abort()
        resolve()
      }

      const dispatch = (raw: string) => {
        if (!raw) return
        try {
          const data = JSON.parse(raw) as Record<string, unknown>
          const kind = (data.kind as string) || 'message'
          if (data.eventId) lastEventId = String(data.eventId)
          onEvent({ kind, data })
          // Terminate once the current turn reaches a terminal state.
          if (
            kind === 'turn_completed' ||
            kind === 'turn_failed' ||
            kind === 'turn_aborted'
          ) {
            const eventTurnId = data.turnId as string | undefined
            if (!eventTurnId || eventTurnId === turnId) {
              terminal = true
              finish()
            }
          }
        } catch (e) {
          console.error('[KCoder] Failed to parse SSE event:', e)
        }
      }

      // One SSE attempt: open fetch, pump frames until the stream closes/errors.
      // Returns normally when the stream ends (caller decides whether to retry).
      const attempt = async (): Promise<void> => {
        const headers: Record<string, string> = {
          ...this.headers,
          Accept: 'text/event-stream'
        }
        if (lastEventId) headers['Last-Event-ID'] = lastEventId
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal
        })
        if (!response.ok || !response.body) {
          throw new Error(`SSE stream failed: ${response.status}`)
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // SSE frames are separated by a blank line. Each frame has `event:`
        // and `data:` lines; we only need the data payload (it carries the
        // full `kind` field, so the `event:` line is redundant).
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Split on blank lines (frame boundaries). Keep any trailing
          // partial frame in the buffer.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const dataLines = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).replace(/^ /, ''))
            if (dataLines.length > 0) {
              dispatch(dataLines.join('\n'))
            }
          }
        }
      }

      const sleep = (ms: number) =>
        new Promise<void>((r) => {
          const t = setTimeout(r, ms)
          // If the caller aborts mid-backoff, stop waiting immediately.
          controller.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              r()
            },
            { once: true }
          )
        })

      ;(async () => {
        let retries = 0
        while (!terminal && !resolved) {
          try {
            await attempt()
            // Stream ended cleanly without a terminal event → the run is still
            // in flight but the connection dropped. Reconnect.
            if (terminal || resolved) break
            if (controller.signal.aborted) break
            if (retries >= MAX_RETRIES) {
              console.error('[KCoder] SSE stream ended without terminal event; giving up after retries')
              break
            }
          } catch (e) {
            if ((e as Error).name === 'AbortError') break // caller-initiated stop
            if (terminal || resolved) break
            if (controller.signal.aborted) break
            if (retries >= MAX_RETRIES) {
              console.error('[KCoder] SSE stream error; giving up after retries:', e)
              break
            }
            console.warn(`[KCoder] SSE stream dropped (attempt ${retries + 1}), reconnecting...`, e)
          }
          // Backoff before the next attempt.
          const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retries)
          retries += 1
          await sleep(delay)
        }
      })().catch((e) => {
        if ((e as Error).name !== 'AbortError') {
          console.error('[KCoder] SSE reconnect loop error:', e)
        }
      }).finally(() => finish())

      // Safety timeout (10 minutes) in case the turn-terminal event is missed.
      setTimeout(finish, 10 * 60 * 1000)
    })
  }

  // ============ Turn Control API (steer / interrupt / compact) ============

  /**
   * Steer a running turn — append additional instructions mid-turn without
   * starting a new turn. POST /v1/threads/:id/turns/:turnId/steer { text }
   */
  async steerTurn(threadId: string, turnId: string, text: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns/${turnId}/steer`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ text })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to steer turn: ${detail}`)
    }
  }

  /**
   * Interrupt a running turn — stop the agent. When discard is true, removes
   * generated items (keeps the user prompt).
   * POST /v1/threads/:id/turns/:turnId/interrupt { discard? }
   */
  async interruptTurn(threadId: string, turnId: string, discard?: boolean): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns/${turnId}/interrupt`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ ...(discard != null ? { discard } : {}) })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to interrupt turn: ${detail}`)
    }
    return response.json()
  }

  /**
   * Manually compact the conversation context — summarize older items to free
   * token budget. POST /v1/threads/:id/compact { reason?, budgetTokens? }
   */
  async compactThread(threadId: string, opts?: { reason?: string; budgetTokens?: number }): Promise<{ replacedTokens: number; summary: string }> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}/compact`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        ...(opts?.reason ? { reason: opts.reason } : {}),
        ...(opts?.budgetTokens ? { budgetTokens: opts.budgetTokens } : {})
      })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to compact thread: ${detail}`)
    }
    return response.json()
  }

  // ============ Turn Execution / Durable Engine Stream API ============
  //
  // v1.1.2 surfaces execution data through two governed endpoints:
  //   - GET /v1/runtime/evented-v2/runs/:runId/timeline  (one-shot snapshot)
  //   - GET /v1/engine/streams/:streamId/subscribe        (durable SSE stream)
  //
  // The streamId for a run is the convention `stream:${runId}`. The runId is
  // the engine's multiAgentRunId. The timeline gives the current DAG state
  // (nodes, branches, active stack, ROI); the stream gives live increments
  // (branch.spawned / branch.started / branch.completed / join.* / roi.snapshot).

  /**
   * Fetch the run timeline snapshot.
   * Returns null when the run is not yet recorded (404) — callers treat this
   * as "projection not available yet" rather than an error.
   */
  async getRunTimeline(runId: string): Promise<RunTimelineView | null> {
    const response = await fetch(`${this.baseUrl}/v1/runtime/evented-v2/runs/${encodeURIComponent(runId)}/timeline`, {
      headers: this.headers
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to get run timeline: ${response.statusText}`)
    return (await response.json()) as RunTimelineView
  }

  /**
   * Acknowledge consumed stream events up to `throughSeq` for a subscriber.
   * The engine stream is durable + at-least-once; acking lets the store trim
   * delivered events. Best-effort — failures are logged, not thrown.
   */
  async ackEngineStream(streamId: string, subscriberId: string, throughSeq: number): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/v1/engine/streams/${encodeURIComponent(streamId)}/ack`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ subscriberId, throughSeq })
      })
    } catch (e) {
      console.warn('[KCoder] engine stream ack failed (non-fatal):', e)
    }
  }

  /**
   * Subscribe to the governed durable engine stream for a run.
   *
   * Stream frames use the engine SSE wire format:
   *   id: <seq>
event: <kind>
data: <full EngineStreamEvent JSON>


   * The `data` payload carries `kind`, optional `branchId`, `multiAgentRunId`,
   * `agentRunId`, `seq`, and `payload`. We forward every frame to `onEvent`;
   * the caller decides which kinds to act on (branch.* / join.* / roi.snapshot).
   *
   * Resolves when the stream closes or `shouldStop` returns true. The caller
   * is responsible for acking via ackEngineStream() if it wants durable trim.
   */
  subscribeEngineStream(
    streamId: string,
    onEvent: (event: EngineStreamEvent) => void,
    options?: {
      /** Called after each event; subscription stops when it returns true. */
      shouldStop?: (event: EngineStreamEvent) => boolean
      /** Start consuming from this seq (default: 0 = replay from start). */
      afterSeq?: number
      /** Safety timeout in ms (default 10 min). */
      timeoutMs?: number
      signal?: AbortSignal
    }
  ): Promise<void> {
    const controller = new AbortController()
    const externalSignal = options?.signal
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort()
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const params = new URLSearchParams()
    params.set('subscriber_id', `kcoder-${Math.random().toString(36).slice(2, 10)}`)
    if (options?.afterSeq != null) params.set('after_seq', String(options.afterSeq))
    const url = `${this.baseUrl}/v1/engine/streams/${encodeURIComponent(streamId)}/subscribe?${params.toString()}`

    return new Promise<void>((resolve) => {
      let resolved = false
      const finish = () => {
        if (resolved) return
        resolved = true
        controller.abort()
        resolve()
      }

      (async () => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { ...this.headers, Accept: 'text/event-stream' },
            signal: controller.signal
          })
          if (!response.ok || !response.body) {
            console.warn(`[KCoder] engine stream failed: ${response.status}`)
            finish()
            return
          }
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            for (const frame of frames) {
              const dataLines = frame
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).replace(/^ /, ''))
              if (dataLines.length === 0) continue
              try {
                const evt = JSON.parse(dataLines.join('\n')) as EngineStreamEvent
                onEvent(evt)
                if (options?.shouldStop?.(evt)) {
                  finish()
                  return
                }
              } catch (e) {
                console.warn('[KCoder] failed to parse engine stream event:', e)
              }
            }
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            console.warn('[KCoder] engine stream error:', e)
          }
        } finally {
          finish()
        }
      })()

      setTimeout(finish, options?.timeoutMs ?? 10 * 60 * 1000)
    })
  }

  /**
   * Build a TurnExecutionView from a run timeline snapshot.
   *
   * Maps the timeline's agentRuns/branchStatus/graphMetrics into the renderer's
   * graph projection (nodes/edges/branches/activeAgentKeys). Non-evented_v2 or
   * not-yet-recorded runs return `available: false`.
   */
  buildExecutionViewFromTimeline(
    timeline: RunTimelineView,
    decision: RuntimeDecisionView
  ): TurnExecutionView {
    // Project agentRuns into graph nodes. The first agent is the root manager;
    // agents sharing a branchId form a parallel specialist lane.
    const nodes: AgentGraphNodeView[] = timeline.agentRuns.map((ar, idx) => ({
      key: ar.nodeId,
      agentKey: ar.agentId,
      role: idx === 0 ? 'manager' : 'specialist',
      name: ar.agentId,
      status: ar.status,
      required: true,
      childAgentKeys: [],
      branchId: ar.branchId
    }))

    // Project branches from timeline.branchStatus.
    const branches: BranchProjection[] = Object.entries(timeline.branchStatus).map(
      ([branchId, status]) => ({
        branchId,
        status,
        agentKeys: timeline.agentRuns
          .filter((ar) => ar.branchId === branchId)
          .map((ar) => ar.agentId)
      })
    )

    const graph: AgentGraphExecutionView = {
      key: timeline.graphId,
      templateId: timeline.graphId,
      nodes,
      edges: [],
      handoffs: [],
      activeAgentKeys: timeline.activeAgentStack,
      branches,
      warnings: []
    }

    return {
      version: 1,
      available: true,
      revision: timeline.updatedAt,
      status: timeline.status,
      decision,
      agents: timeline.agentRuns.map((ar, idx) => ({
        key: ar.agentRunId,
        sequence: idx,
        role: idx === 0 ? 'root' : 'specialist',
        name: ar.agentId,
        status: ar.status,
        branchId: ar.branchId,
        startedAt: ar.startedAt,
        completedAt: ar.completedAt,
        summary: ar.summary,
        // The timeline snapshot does not carry per-agent message/tool history;
        // those are empty until a richer per-agent fetch is wired.
        messages: [],
        reasoning: [],
        toolRuns: []
      })),
      mode: 'evented_v2',
      graph
    }
  }

  /**
   * Derive the engine's multiAgentRunId from a thread+turn pair.
   *
   * The engine uses the stable convention `run_${threadId}_${turnId}` (see
   * runtime-factory.ts identityForTurn + tool-call-coordinator.ts). This lets
   * the renderer address the timeline / engine-stream endpoints without the
   * turn response needing to echo the runId back.
   */
  runIdForTurn(threadId: string, turnId: string): string {
    return `run_${threadId}_${turnId}`
  }

  /**
   * Derive the governed engine streamId for a run.
   * Convention: `stream:${runId}` (see durable-engine.ts / durable-graph-store-adapters.ts).
   */
  streamIdForRun(runId: string): string {
    return `stream:${runId}`
  }

  /**
   * Get the turn execution projection.
   *
   * Fetches the run timeline snapshot (runId derived from threadId+turnId via
   * the engine's stable convention) and projects it into a TurnExecutionView.
   * Returns `available:false` when the run is not yet recorded (the engine
   * returns 404 for the timeline endpoint until the graph run is created).
   */
  async getTurnExecution(threadId: string, turnId: string): Promise<TurnExecutionView> {
    const runId = this.runIdForTurn(threadId, turnId)
    const timeline = await this.getRunTimeline(runId)
    if (!timeline) {
      return {
        version: 1,
        available: false,
        revision: '0',
        reason: 'execution projection is not available yet (run not recorded)'
      }
    }
    return this.buildExecutionViewFromTimeline(timeline, {
      preferredMode: 'evented_v2',
      effectiveMode: 'evented_v2',
      preference: 'team',
      source: 'timeline',
      reason: 'durable parallel execution'
    })
  }

  // ============ Governed Graph Governance API ============
  //
  // These hit the governance routes added for governedGraph mode:
  //   - GET  /v1/engine/runs/:runId/inspect          (graph run status + circuit)
  //   - POST /v1/engine/runs/:runId/circuit           (set circuit state)
  //   - POST /v1/engine/runs/:runId/cancel            (cancel the run)
  //   - POST /v1/engine/checkpoints/:checkpointId/resolve  (resolve a checkpoint)

  /** Inspect a governed graph run — status, circuit state, active nodes, budgets. */
  async inspectGraphRun(runId: string): Promise<GraphRunInspection | null> {
    const response = await fetch(`${this.baseUrl}/v1/engine/runs/${encodeURIComponent(runId)}/inspect`, {
      headers: this.headers
    })
    if (response.status === 404) return null
    if (response.status === 503) return null // governed engine not configured
    if (!response.ok) throw new Error(`Failed to inspect graph run: ${response.statusText}`)
    return response.json()
  }

  /** Set the circuit state of a governed graph run (running/report_only/paused/retired). */
  async setGraphCircuit(runId: string, state: CircuitState): Promise<{ runId: string; circuitState: CircuitState }> {
    const response = await fetch(`${this.baseUrl}/v1/engine/runs/${encodeURIComponent(runId)}/circuit`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ state })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to set circuit state: ${text}`)
    }
    return response.json()
  }

  /** Cancel a governed graph run. */
  async cancelGraphRun(runId: string): Promise<{ runId: string; cancelled: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/engine/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to cancel graph run: ${text}`)
    }
    return response.json()
  }

  /** Resolve a governed graph checkpoint (approval decision). */
  async resolveCheckpoint(checkpointId: string, decision: 'allow' | 'deny', opts?: { token?: string; resolutionToken?: string; graphRevision?: number }): Promise<{ checkpointId: string; resolved: boolean }> {
    const response = await fetch(`${this.baseUrl}/v1/engine/checkpoints/${encodeURIComponent(checkpointId)}/resolve`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ decision, ...(opts ?? {}) })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to resolve checkpoint: ${text}`)
    }
    return response.json()
  }

  // ============ Thread Goal / Todos API ============

  async getThreadGoal(threadId: string): Promise<ThreadGoal | null> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}/goal`, {
      headers: this.headers
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to get goal: ${response.statusText}`)
    const data = await response.json()
    return data.goal ?? null
  }

  async getThreadTodos(threadId: string): Promise<ThreadTodoList | null> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}/todos`, {
      headers: this.headers
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to get todos: ${response.statusText}`)
    const data = await response.json()
    return data.todos ?? null
  }

  // Resolve an approval — POST /v1/approvals/:id
  async decideApproval(approvalId: string, decision: 'allow' | 'deny', reason?: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ decision, ...(reason ? { reason } : {}) })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to resolve approval: ${text}`)
    }
    return response.json()
  }

  // Resolve a user-input request — POST /v1/user-inputs/:id
  async resolveUserInput(inputId: string, answers: Array<{ id: string; label: string; value: string }>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/user-inputs/${encodeURIComponent(inputId)}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ answers })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to resolve user input: ${text}`)
    }
    return response.json()
  }

  // Cancel a user-input request — POST /v1/user-inputs/:id { cancelled: true }
  async cancelUserInput(inputId: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/user-inputs/${encodeURIComponent(inputId)}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ cancelled: true })
    })
    if (!response.ok) {
      throw new Error(`Failed to cancel user input: ${response.statusText}`)
    }
    return response.json()
  }

  // 列出会话 — GET /v1/threads
  async listThreads(opts?: { includeArchived?: boolean }): Promise<{ threads: ThreadSummary[] }> {
    const params = new URLSearchParams({ limit: '200' })
    if (opts?.includeArchived) params.set('include_archived', 'true')
    const response = await fetch(`${this.baseUrl}/v1/threads?${params}`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list threads: ${response.statusText}`)
    }
    return response.json()
  }

  // 重命名会话标题 — PATCH /v1/threads/:id
  // 后端只允许更新 title（workspace 等绑定字段不可改）。
  async updateThreadTitle(threadId: string, title: string): Promise<ThreadSummary> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
    if (!response.ok) {
      throw new Error(`Failed to update thread title: ${response.statusText}`)
    }
    return response.json()
  }

  // 更新会话（标题 / 归档） — PATCH /v1/threads/:id
  // 可同时更新 title 与 archived（写入 thread metadata）。
  async updateThread(
    threadId: string,
    opts: { title?: string; archived?: boolean }
  ): Promise<ThreadSummary> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(opts)
    })
    if (!response.ok) {
      throw new Error(`Failed to update thread: ${response.statusText}`)
    }
    return response.json()
  }

  // ============ Project API ============

  // 列出已注册项目 — GET /v1/projects
  async listProjects(): Promise<{ projects: ProjectEntry[] }> {
    const response = await fetch(`${this.baseUrl}/v1/projects`, { headers: this.headers })
    if (!response.ok) {
      throw new Error(`Failed to list projects: ${response.statusText}`)
    }
    return response.json()
  }

  // 注册项目（upsert by path） — POST /v1/projects
  async createProject(path: string, name?: string): Promise<ProjectEntry> {
    const response = await fetch(`${this.baseUrl}/v1/projects`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name })
    })
    if (!response.ok) {
      throw new Error(`Failed to create project: ${response.statusText}`)
    }
    return response.json()
  }

  // 重命名/更新项目 — PATCH /v1/projects/:id
  async updateProject(
    projectId: string,
    patch: { name?: string; description?: string }
  ): Promise<ProjectEntry> {
    const response = await fetch(
      `${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PATCH',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      }
    )
    if (!response.ok) {
      throw new Error(`Failed to update project: ${response.statusText}`)
    }
    return response.json()
  }

  // 注销项目（其下任务自动归档） — DELETE /v1/projects/:id
  async deleteProject(
    projectId: string
  ): Promise<{ deleted: boolean; archivedThreads?: number }> {
    const response = await fetch(
      `${this.baseUrl}/v1/projects/${encodeURIComponent(projectId)}`,
      { method: 'DELETE', headers: this.headers }
    )
    if (!response.ok) {
      throw new Error(`Failed to delete project: ${response.statusText}`)
    }
    return response.json()
  }

  // ============ Workspace / Git API ============

  // 查询工作区状态（git 分支/脏标记） — GET /v1/workspace/status?path=
  async getWorkspaceStatus(path: string): Promise<WorkspaceStatus> {
    const response = await fetch(
      `${this.baseUrl}/v1/workspace/status?path=${encodeURIComponent(path)}`,
      { headers: this.headers }
    )
    if (!response.ok) {
      throw new Error(`Failed to get workspace status: ${response.statusText}`)
    }
    return response.json()
  }

  // 列出指定目录的本地分支。
  //
  // The new engine only exposes GET /v1/workspace/status; the dedicated
  // branches endpoint was removed. We derive the branch list from the
  // status payload where possible and otherwise return an empty list so the
  // directory bar keeps rendering.
  async listBranches(path: string): Promise<BranchListResponse> {
    const status = await this.getWorkspaceStatus(path)
    return {
      path,
      branches: status.branch ? [status.branch] : [],
      current: status.branch
    }
  }

  // 在指定目录新建并检出分支。POST /v1/workspace/branch { path, name, base? }
  // 后端执行 `git checkout -b <name> [base]`，返回 { path, branch, created }。
  // 分支已存在 → 409；非 git 仓库 → 400。
  async createBranch(path: string, name: string, base?: string): Promise<{ path: string; branch: string }> {
    const response = await fetch(`${this.baseUrl}/v1/workspace/branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({ path, name, ...(base ? { base } : {}) })
    })
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}))
      const msg = typeof detail?.detail === 'string' ? detail.detail : response.statusText
      throw new Error(`Failed to create branch: ${msg}`)
    }
    return response.json()
  }

  /**
   * 提交工作区变更。POST /v1/workspace/commit { path, message }
   * 后端会执行 `git add -A` + `git commit -m <message>`，返回结构化结果。
   */
  async commitWorkspace(path: string, message: string): Promise<CommitResult> {
    const response = await fetch(`${this.baseUrl}/v1/workspace/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({ path, message })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : response.statusText
      return { success: false, error: detail, output: '' }
    }
    return { success: true, ...data }
  }

  /**
   * 推送当前分支到远端。POST /v1/workspace/push { path, remote?, branch? }
   */
  async pushWorkspace(path: string, opts?: { remote?: string; branch?: string }): Promise<CommitResult> {
    const response = await fetch(`${this.baseUrl}/v1/workspace/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({ path, ...(opts ?? {}) })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : response.statusText
      return { success: false, error: detail, output: '' }
    }
    return { success: true, ...data }
  }

  /**
   * 强制刷新工作区状态（commit/push 后调用，跳过轮询等待）。
   */
  async refreshWorkspaceStatus(path: string): Promise<WorkspaceStatus> {
    return this.getWorkspaceStatus(path)
  }

  // ============ 文件浏览 / 读取 / 搜索 ============

  /** GET /v1/workspace/tree?path= → 单层目录条目（文件树懒展开用）。 */
  async workspaceTree(path: string): Promise<{ path: string; entries: WorkspaceTreeEntry[]; truncated: boolean }> {
    const r = await fetch(`${this.baseUrl}/v1/workspace/tree?path=${encodeURIComponent(path)}`, { headers: this.headers })
    if (!r.ok) throw new Error(`workspace tree failed: ${r.status}`)
    return r.json()
  }

  /** GET /v1/workspace/file?path= → 读取文本文件内容。 */
  async readWorkspaceFile(path: string): Promise<{ path: string; content: string; size: number; truncated: boolean }> {
    const r = await fetch(`${this.baseUrl}/v1/workspace/file?path=${encodeURIComponent(path)}`, { headers: this.headers })
    if (!r.ok) {
      const detail = await r.json().catch(() => ({}))
      throw new Error(typeof detail?.detail === 'string' ? detail.detail : `read failed: ${r.status}`)
    }
    return r.json()
  }

  /** POST /v1/workspace/search { path, query, glob?, maxResults? } → ripgrep 搜索。 */
  async workspaceSearch(
    path: string,
    query: string,
    opts?: { glob?: string; maxResults?: number }
  ): Promise<{ results: SearchHit[]; truncated: boolean; engine: string }> {
    const r = await fetch(`${this.baseUrl}/v1/workspace/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({ path, query, ...(opts?.glob ? { glob: opts.glob } : {}), ...(opts?.maxResults ? { maxResults: opts.maxResults } : {}) })
    })
    if (!r.ok) throw new Error(`workspace search failed: ${r.status}`)
    return r.json()
  }

  /**
   * 列出当前可用的子代理配置。复用现有 sub-agents 管理 API（见类底部
   * 同名 listSubAgents），InfoPanel 智能体 section 用。
   */

  // Get thread history
  async getThread(threadId: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}`, {
      headers: this.headers
    })

    if (!response.ok) {
      throw new Error(`Failed to get thread: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Delete a thread and ALL its data. The engine's HybridThreadStore.delete
   * recursively removes the entire thread directory (dataDir/threads/<id>/),
   * including tool-output, uploads, turn state, session items, etc.
   * DELETE /v1/threads/:id
   */
  async deleteThread(threadId: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/v1/threads/${threadId}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to delete thread: ${text}`)
    }
    const data = await response.json()
    return Boolean(data.deleted)
  }

  // ============ Attachments API ============
  //
  // Upload files to the engine so the agent can read them during a turn.
  // The attachment id can be passed to sendMessage via the StartTurnRequest's
  // attachmentIds field (the engine injects attachment content into context).

  /**
   * Upload a file as an attachment. The file is base64-encoded and sent as
   * JSON. Returns the attachment metadata (including the id to pass to turns).
   * POST /v1/attachments { name, mimeType, dataBase64, threadId?, workspace? }
   */
  async uploadAttachment(file: File, opts?: { threadId?: string; workspace?: string }): Promise<AttachmentMetadata> {
    const dataBase64 = await fileToBase64(file)
    const response = await fetch(`${this.baseUrl}/v1/attachments`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name: file.name,
        ...(file.type ? { mimeType: file.type } : {}),
        dataBase64,
        ...(opts?.threadId ? { threadId: opts.threadId } : {}),
        ...(opts?.workspace ? { workspace: opts.workspace } : {})
      })
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to upload attachment: ${detail}`)
    }
    const data = await response.json()
    return data.attachment as AttachmentMetadata
  }

  /** Get attachment metadata. GET /v1/attachments/:id */
  async getAttachment(id: string): Promise<AttachmentMetadata | null> {
    const response = await fetch(`${this.baseUrl}/v1/attachments/${encodeURIComponent(id)}`, {
      headers: this.headers
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to get attachment: ${response.statusText}`)
    const data = await response.json()
    return data.attachment as AttachmentMetadata
  }

  // ============ Memory API ============
  //
  // Persistent memory CRUD — the agent stores and retrieves project knowledge
  // (decisions, constraints, evidence) via these endpoints. Memories are scoped
  // to user/workspace and injected into context at turn time.

  /** List memories. GET /v1/memory?workspace=&include_deleted= */
  async listMemories(opts?: { workspace?: string; includeDeleted?: boolean }): Promise<MemoryRecord[]> {
    const params = new URLSearchParams()
    if (opts?.workspace) params.set('workspace', opts.workspace)
    if (opts?.includeDeleted) params.set('include_deleted', 'true')
    const qs = params.toString()
    const response = await fetch(`${this.baseUrl}/v1/memory${qs ? `?${qs}` : ''}`, {
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to list memories: ${response.statusText}`)
    const data = await response.json()
    return (data.memories ?? []) as MemoryRecord[]
  }

  /** Create a memory. POST /v1/memory { content, scope?, tags?, confidence?, workspace? } */
  async createMemory(payload: { content: string; scope?: 'user' | 'workspace' | 'project'; tags?: string[]; confidence?: number; workspace?: string }): Promise<MemoryRecord> {
    const response = await fetch(`${this.baseUrl}/v1/memory`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to create memory: ${detail}`)
    }
    const data = await response.json()
    return data.memory as MemoryRecord
  }

  /** Update a memory. PATCH /v1/memory/:id { content?, tags?, confidence?, disabled? } */
  async updateMemory(id: string, patch: { content?: string; tags?: string[]; confidence?: number; disabled?: boolean }): Promise<MemoryRecord> {
    const response = await fetch(`${this.baseUrl}/v1/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(patch)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to update memory: ${detail}`)
    }
    const data = await response.json()
    return data.memory as MemoryRecord
  }

  /** Delete a memory (soft delete — tombstone). DELETE /v1/memory/:id */
  async deleteMemory(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to delete memory: ${response.statusText}`)
  }

  /** Memory diagnostics. GET /v1/memory/diagnostics */
  async memoryDiagnostics(): Promise<{ enabled: boolean; activeCount: number; tombstoneCount: number }> {
    const response = await fetch(`${this.baseUrl}/v1/memory/diagnostics`, {
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to get memory diagnostics: ${response.statusText}`)
    return response.json()
  }

  // ============ Runtime config API ============
  //
  // 读热重载后的生效值，写 config.yaml。覆盖 memory / summarization / title 三段。
  // PUT 后 QiLin signature 检测自动热重载（1-2s 内生效）。

  /** 读取三段运行时配置生效值。 GET /v1/runtime-config */
  async getRuntimeConfig(): Promise<RuntimeConfig> {
    const response = await fetch(`${this.baseUrl}/v1/runtime-config`, {
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to get runtime config: ${response.statusText}`)
    const data = (await response.json()) as Record<string, unknown>
    // 后端段名为 snake_case（token_usage / token_budget），前端类型为 camelCase。
    // 其他段（memory / sandbox / network 等）为单字段名，无需映射。
    return {
      ...(data as unknown as RuntimeConfig),
      tokenUsage: (data.token_usage ?? {}) as TokenUsageConfig,
      tokenBudget: (data.token_budget ?? {}) as TokenBudgetConfig
    } as RuntimeConfig
  }

  /** 写单段配置到 config.yaml。 PUT /v1/runtime-config/{section} */
  async updateRuntimeConfigSection<S extends RuntimeConfigSection>(
    section: S,
    value: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/runtime-config/${section}`, {
      method: 'PUT',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to update ${section} config: ${detail}`)
    }
    return response.json()
  }

  // ============ Token usage statistics API ============
  //
  // 跨会话聚合统计（runs 表），月度窗口按北京时间。

  /** 全局 token 用量统计。 GET /v1/token-usage/stats?year=&month= */
  async getTokenUsageStats(filter?: MonthFilter): Promise<TokenUsageStats> {
    const params = new URLSearchParams()
    if (filter) {
      params.set('year', String(filter.year))
      params.set('month', String(filter.month))
    }
    const qs = params.toString()
    const response = await fetch(`${this.baseUrl}/v1/token-usage/stats${qs ? `?${qs}` : ''}`, {
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to get token usage stats: ${response.statusText}`)
    return response.json()
  }

  /** 按天×模型 token 用量时间序列。 GET /v1/token-usage/timeseries */
  async getTokenUsageTimeseries(days = 30, filter?: MonthFilter): Promise<TokenUsageTimeseriesItem[]> {
    const params = new URLSearchParams({ days: String(days) })
    if (filter) {
      params.set('year', String(filter.year))
      params.set('month', String(filter.month))
    }
    const response = await fetch(`${this.baseUrl}/v1/token-usage/timeseries?${params.toString()}`, {
      headers: this.headers
    })
    if (!response.ok) throw new Error(`Failed to get token usage timeseries: ${response.statusText}`)
    return response.json()
  }

  // ============ Models API (product-side, over IPC) ============
  //
  // The new engine exposes no HTTP model CRUD. Model configuration is owned
  // by the product and driven through the engine's UserDataStore via IPC
  // (window.kcoder.models). These methods forward to the renderer-side
  // models service so existing call sites (SettingsPanel, CommandInput) keep
  // working unchanged.

  async getModels(): Promise<{ models: ModelEntry[] }> {
    const { getModels: list } = await import('./models')
    return list(this.requireUserId())
  }

  async activateModel(name: string): Promise<void> {
    const { activateModel: activate } = await import('./models')
    return activate(this.requireUserId(), name)
  }

  async discoverModels(
    baseUrl: string,
    apiKey: string,
    endpointFormat?: string
  ): Promise<{ models: Array<{ id: string; name: string }>; count: number }> {
    const { discoverModels: discover } = await import('./models')
    return discover({
      baseUrl,
      apiKey: apiKey || undefined,
      endpointFormat: endpointFormat as 'chat_completions' | 'responses' | 'messages' | undefined
    })
  }

  async createModel(payload: Record<string, unknown>): Promise<unknown> {
    const { createModel: save } = await import('./models')
    // The Settings UI passes a loosely-typed payload; forward the known fields.
    const name = (payload.name as string) ?? (payload.id as string) ?? ''
    if (!name) throw new Error('Model name is required')
    return save(this.requireUserId(), name, {
      providerModel: (payload.model as string) ?? name,
      baseUrl: (payload.baseUrl as string) ?? (payload.base_url as string) ?? '',
      apiKey: (payload.apiKey as string) ?? (payload.api_key as string) ?? undefined,
      endpointFormat: ((payload.endpointFormat as string) ??
        (payload.endpoint_format as string) ??
        undefined) as 'chat_completions' | 'responses' | 'messages' | undefined,
      contextWindowTokens: (payload.contextWindowTokens as number) ??
        (payload.context_window_tokens as number) ?? undefined,
      supportsToolCalling:
        (payload.supportsToolCalling as boolean) ??
        (payload.supports_tool_calling as boolean) ?? undefined,
      // 预设驱动的 QiLin 字段透传
      use: (payload.use as string) ?? undefined,
      displayName: (payload.displayName as string) ?? (payload.display_name as string) ?? undefined,
      supportsThinking: (payload.supportsThinking as boolean) ??
        (payload.supports_thinking as boolean) ?? undefined,
      supportsVision: (payload.supportsVision as boolean) ??
        (payload.supports_vision as boolean) ?? undefined,
      supportsReasoningEffort: (payload.supportsReasoningEffort as boolean) ??
        (payload.supports_reasoning_effort as boolean) ?? undefined,
      whenThinkingEnabled: (payload.whenThinkingEnabled as Record<string, unknown>) ??
        (payload.when_thinking_enabled as Record<string, unknown>) ?? undefined,
      whenThinkingDisabled: (payload.whenThinkingDisabled as Record<string, unknown>) ??
        (payload.when_thinking_disabled as Record<string, unknown>) ?? undefined,
      maxTokens: (payload.maxTokens as number) ?? (payload.max_tokens as number) ?? undefined,
      temperature: (payload.temperature as number) ?? undefined,
      useResponsesApi: (payload.useResponsesApi as boolean) ??
        (payload.use_responses_api as boolean) ?? undefined,
      outputVersion: (payload.outputVersion as string) ??
        (payload.output_version as string) ?? undefined
    })
  }

  // Get marketplace index — product-owned (the engine has no marketplace
  // endpoint). Returns an empty index for now; the product-side marketplace
  // bundle is wired in a later phase.
  async getMarketplace(): Promise<MarketplaceIndex> {
    return { version: 1, updatedAt: null, skills: [] }
  }

  // ============ Skills API ============
  //
  // Endpoints exposed by the gateway (skills_routes.py):
  //   GET    /v1/skills                  — list all skills
  //   PUT    /v1/skills/{name}/enabled   — toggle enabled state
  //   DELETE /v1/skills/{name}           — delete custom skill
  //   POST   /v1/skills/install-from-file  — install .skill archive
  //   POST   /v1/skills/install-from-npm   — install from npm/GitHub/local

  // List all skills — GET /v1/skills
  async listSkills(): Promise<SkillEntry[]> {
    const response = await fetch(`${this.baseUrl}/v1/skills`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list skills: ${response.statusText}`)
    }
    const data = await response.json()
    return (data.skills ?? []) as SkillEntry[]
  }

  // Toggle skill enabled state — PUT /v1/skills/{name}/enabled
  async toggleSkill(name: string, enabled: boolean): Promise<SkillEntry> {
    const response = await fetch(`${this.baseUrl}/v1/skills/${encodeURIComponent(name)}/enabled`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ enabled })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to toggle skill: ${text}`)
    }
    return response.json()
  }

  // Delete a custom skill — DELETE /v1/skills/{name}
  async deleteSkill(name: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to delete skill: ${text}`)
    }
  }

  // Install a .skill ZIP archive — POST /v1/skills/install-from-file
  async installSkillFromFile(filePath: string): Promise<{ success: boolean; skill_name: string }> {
    const response = await fetch(`${this.baseUrl}/v1/skills/install-from-file`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ path: filePath })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to install skill from file: ${text}`)
    }
    return response.json()
  }

  // Install from npm/GitHub/local path — POST /v1/skills/install-from-npm
  async installSkillFromNpm(source: string): Promise<{ success: boolean; skill_name: string }> {
    const response = await fetch(`${this.baseUrl}/v1/skills/install-from-npm`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ source })
    })
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      throw new Error(`Failed to install skill from npm: ${text}`)
    }
    return response.json()
  }

  // ============ Sub-Agents / MCP / Plugins / Commands / Remote API ============
  //
  // These features were "reserved, pending backend" in the KWorks era and
  // the new engine does not expose them over HTTP. We keep the method
  // surface so the Settings UI compiles, but they return empty data (reads)
  // or reject (writes) instead of hitting endpoints that no longer exist.
  // Each Settings panel already tolerates failures, so the UI shows empty
  // state rather than crashing.

  async listSubAgents(): Promise<{ settings: Record<string, unknown>; subAgents: SubAgentEntry[] }> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list sub-agents: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      settings: (data.settings ?? {}) as Record<string, unknown>,
      subAgents: (data.subAgents ?? []) as SubAgentEntry[],
    }
  }
  async updateSubAgentSettings(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents/settings`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to update sub-agent settings: ${response.statusText}`)
    }
    return response.json()
  }
  async createSubAgent(payload: Omit<SubAgentEntry, 'type' | 'source'>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to create sub-agent: ${response.statusText}`)
    }
    return response.json()
  }
  async updateSubAgent(id: string, payload: Partial<SubAgentEntry>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to update sub-agent: ${response.statusText}`)
    }
    return response.json()
  }
  async deleteSubAgent(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to delete sub-agent: ${response.statusText}`)
    }
  }
  async cloneSubAgent(id: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/sub-agents/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to clone sub-agent: ${response.statusText}`)
    }
    return response.json()
  }

  async getMcpConfig(): Promise<McpConfigResponse> {
    const response = await fetch(`${this.baseUrl}/v1/mcp/config`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get MCP config: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      mcp_servers: data.mcp_servers ?? {},
      mcpServers: data.mcpServers ?? data.mcp_servers ?? {},
      skills: data.skills ?? {}
    }
  }
  async saveMcpConfig(config: { mcp_servers: Record<string, McpServerConfigEntry> }): Promise<McpConfigResponse> {
    const response = await fetch(`${this.baseUrl}/v1/mcp/config`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ mcp_servers: config.mcp_servers })
    })
    if (!response.ok) {
      throw new Error(`Failed to save MCP config: ${response.statusText}`)
    }
    const data = await response.json()
    return {
      mcp_servers: data.mcp_servers ?? {},
      mcpServers: data.mcpServers ?? data.mcp_servers ?? {},
      skills: data.skills ?? {}
    }
  }

  async listPlugins(): Promise<PluginEntry[]> {
    const response = await fetch(`${this.baseUrl}/v1/plugins`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list plugins: ${response.statusText}`)
    }
    const data = await response.json()
    return (data.plugins ?? []) as PluginEntry[]
  }
  async togglePlugin(id: string, enabled: boolean): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/plugins/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ enabled })
    })
    if (!response.ok) {
      throw new Error(`Failed to toggle plugin: ${response.statusText}`)
    }
    return response.json()
  }
  async getPluginDiscover(): Promise<{ plugins: DiscoverPlugin[] }> {
    const response = await fetch(`${this.baseUrl}/v1/plugins/discover`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to discover plugins: ${response.statusText}`)
    }
    return response.json()
  }
  async installPlugin(id: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/plugins/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to install plugin: ${response.statusText}`)
    }
    return response.json()
  }
  async checkPluginUpdates(): Promise<{ updates: Array<{ id: string; latest: string }> }> {
    const response = await fetch(`${this.baseUrl}/v1/plugins/check-updates`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to check plugin updates: ${response.statusText}`)
    }
    return response.json()
  }

  async listCommands(): Promise<CommandEntry[]> {
    const response = await fetch(`${this.baseUrl}/v1/commands`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list commands: ${response.statusText}`)
    }
    const data = await response.json()
    return (data.commands ?? []) as CommandEntry[]
  }

  // 单条查询（后端无 GET /v1/commands/:id 端点，list 后前端 find）。
  // 用于输入框解析 /command 前缀时拿 content 展开为提示词。
  async getCommand(commandId: string): Promise<CommandEntry | null> {
    const commands = await this.listCommands()
    return commands.find((c) => c.id === commandId) ?? null
  }
  async createCommand(payload: Omit<CommandEntry, 'source'>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/commands`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to create command: ${response.statusText}`)
    }
    return response.json()
  }
  async updateCommand(id: string, payload: Partial<CommandEntry>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/commands/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to update command: ${response.statusText}`)
    }
    return response.json()
  }
  async deleteCommand(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/commands/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to delete command: ${response.statusText}`)
    }
  }

  async getRemoteConfig(): Promise<RemoteConfig> {
    return {
      remoteEnabled: false,
      remoteUrl: '',
      remoteToken: '',
      exposeEnabled: false,
      exposeToken: '',
      requireAuth: true,
      permissionLevel: 'readonly',
      sessionTimeout: 0
    }
  }
  async saveRemoteConfig(_config: Partial<RemoteConfig>): Promise<unknown> {
    // Phase 8: no-op — QiLin has no remote-control surface.
    return {}
  }
  async testRemoteConnection(_url: string, _token: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    return { ok: false, error: 'Remote control is not supported by the current engine' }
  }
  async listRemoteSessions(): Promise<RemoteSessionInfo[]> {
    return []
  }
}

// Singleton instance
let apiInstance: EngineAPI | null = null

export function getEngineAPI(port: number, token?: string): EngineAPI {
  if (!apiInstance || apiInstance.port !== port) {
    apiInstance = new EngineAPI(port, token)
  } else if (token) {
    apiInstance.setRuntimeToken(token)
  }
  return apiInstance
}

export function resetEngineAPI(): void {
  apiInstance = null
}

/** Read a File and return its contents as a base64 string (for attachment upload). */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
