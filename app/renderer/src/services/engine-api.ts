// QiongQi Engine API Client

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

// ============ Turn Execution Projection types ============
// 对齐 engine/packages/foundation/contracts/src/turn-execution.ts

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

export interface AgentExecutionView {
  key: string
  parentKey?: string
  sequence: number
  role: 'root' | 'child' | 'manager' | 'specialist'
  phase?: 'planning' | 'execution' | 'synthesis'
  name: string
  task?: string
  status: ExecutionStatus
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

export interface AgentGraphNodeView {
  key: string
  agentKey: string
  role: 'manager' | 'specialist'
  phase?: 'planning' | 'execution' | 'synthesis'
  name: string
  status: ExecutionStatus
  required: boolean
  childAgentKeys: string[]
  parallelGroup?: string
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

export interface AgentGraphExecutionView {
  key: string
  templateId: string
  nodes: AgentGraphNodeView[]
  edges: AgentGraphEdgeView[]
  handoffs: AgentGraphHandoffView[]
  activeAgentKeys: string[]
  warnings: string[]
}

export interface DelegationTreeView {
  roots: string[]
  edges: Array<{ from: string; to: string }>
}

/** TurnExecutionView — GET /v1/threads/:id/turns/:turnId/execution 返回。 */
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
  checkedAt: string
}

/** BranchListResponse — GET /v1/workspace/branches?path= 返回的分支列表。 */
export interface BranchListResponse {
  path: string
  branches: string[]
  current: string | null
}

/** ProjectEntry — GET /api/projects 返回的已注册项目。 */
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
  async sendMessage(
    threadId: string,
    content: string,
    onEvent: (event: SSEEvent) => void,
    orchestrationPreference?: 'standard' | 'team'
  ): Promise<string> {
    // 创建 turn — 后端 StartTurnRequest 要求 { prompt: string, orchestrationPreference? }
    const turnResponse = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        prompt: content,
        ...(orchestrationPreference ? { orchestrationPreference } : {})
      })
    })

    if (!turnResponse.ok) {
      const text = await turnResponse.text().catch(() => turnResponse.statusText)
      throw new Error(`Failed to send message: ${text}`)
    }

    const turn: TurnResponse = await turnResponse.json()

    // 订阅线程级 SSE 事件流（后端路径是 /v1/threads/:id/events，不是 /turns/:turnId/events）
    await this.subscribeToThread(threadId, turn.turnId, onEvent)
    return turn.turnId
  }

  // 订阅线程事件流 — 后端发具名事件（event: <kind>），必须用 addEventListener 按 kind 监听
  private subscribeToThread(
    threadId: string,
    turnId: string,
    onEvent: (event: SSEEvent) => void
  ): Promise<void> {
    const url = `${this.baseUrl}/v1/threads/${threadId}/events`

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url)
      let resolved = false

      const finish = () => {
        if (resolved) return
        resolved = true
        eventSource.close()
        resolve()
      }

      // 后端用 event: <kind> 发送具名事件；onmessage 只收到无 event: 字段的消息。
      // 用一个通用监听器捕获所有事件类型：浏览器 EventSource 不支持通配符，
      // 但 SSE 帧 data 行含完整 JSON（含 kind 字段），所以监听常见 kind + message 兜底。
      const handlePayload = (raw: string) => {
        try {
          const data = JSON.parse(raw) as Record<string, unknown>
          const kind = (data.kind as string) || 'message'
          onEvent({ kind, data })

          // turn 终止事件
          if (
            kind === 'turn_completed' ||
            kind === 'turn_failed' ||
            kind === 'turn_aborted'
          ) {
            // 确认是当前 turn（turnId 在事件 payload 的 turnId 字段）
            const eventTurnId = data.turnId as string | undefined
            if (!eventTurnId || eventTurnId === turnId) {
              finish()
            }
          }
        } catch (e) {
          console.error('[KCoder] Failed to parse SSE event:', e)
        }
      }

      // 注册后端所有可能的事件 kind（EventSource 需要显式 addEventListener 每种具名事件）
      const RUNTIME_EVENT_KINDS = [
        'thread_created', 'thread_updated',
        'turn_started', 'turn_completed', 'turn_failed', 'turn_aborted', 'turn_steered',
        'item_created', 'item_updated', 'item_completed',
        'assistant_text_delta', 'assistant_reasoning_delta',
        'tool_call_ready', 'tool_result_upload_wait', 'tool_storm_suppressed',
        'tool_catalog_changed', 'tool_call_started', 'tool_call_finished',
        'approval_requested', 'approval_resolved',
        'user_input_requested', 'user_input_resolved',
        'compaction_started', 'compaction_completed',
        'goal_updated', 'goal_cleared',
        'todos_updated', 'todos_cleared',
        'pipeline_stage',
        'agent_message_delta', 'agent_message_completed',
        'usage', 'error', 'heartbeat'
      ]

      for (const kind of RUNTIME_EVENT_KINDS) {
        eventSource.addEventListener(kind, (ev: MessageEvent) => handlePayload(ev.data))
      }
      // 兜底：无 event: 字段的消息
      eventSource.onmessage = (ev) => handlePayload(ev.data)

      eventSource.onerror = () => {
        if (resolved) return
        resolved = true
        eventSource.close()
        // EventSource 在连接正常关闭时也会触发 onerror；用 resolve 而非 reject 避免误报
        resolve()
      }

      // 超时保底（10 分钟）
      setTimeout(finish, 10 * 60 * 1000)
    })
  }

  // ============ Approval / User Input API ============

  // Get turn execution projection.
  //
  // The new QiongQi engine no longer exposes a per-turn execution projection
  // endpoint (the old `/v1/threads/:id/turns/:turnId/execution` route is gone).
  // The richer DAG/graph view now lives behind the governed durable stream
  // (`/v1/engine/streams/:streamId/subscribe`), which is a separate adaptation
  // tracked for a later phase. For now we return an `available: false`
  // projection so the polling loop in useChat terminates cleanly and
  // ExecutionView renders its "unavailable" state instead of erroring.
  async getTurnExecution(_threadId: string, _turnId: string): Promise<TurnExecutionView> {
    return {
      version: 1,
      available: false,
      revision: '0',
      reason: 'execution projection is not available in the current engine'
    }
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
  async listThreads(): Promise<{ threads: ThreadSummary[] }> {
    const response = await fetch(`${this.baseUrl}/v1/threads?limit=200`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list threads: ${response.statusText}`)
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

  // 在指定目录新建分支（不切换检出）。
  //
  // No dedicated endpoint in the new engine. This is a no-op stub so the
  // command input's "new branch" affordance does not throw; branch creation
  // should move to a product-side git helper in a later phase.
  async createBranch(path: string, name: string, _base?: string): Promise<{ path: string; branch: string }> {
    console.warn('[KCoder] createBranch is not supported by the current engine; skipping', { path, name })
    return { path, branch: name }
  }

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

  // ============ Models API (product-side, over IPC) ============
  //
  // The new engine exposes no HTTP model CRUD. Model configuration is owned
  // by the product and driven through the engine's UserDataStore via IPC
  // (window.kcoder.models). These methods forward to the renderer-side
  // models service so existing call sites (SettingsPanel, CommandInput) keep
  // working unchanged.

  async getModels(): Promise<{ models: ModelEntry[] }> {
    const { getModels: list } = await import('./models')
    return list()
  }

  async activateModel(name: string): Promise<void> {
    const { activateModel: activate } = await import('./models')
    return activate(name)
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
    return save(name, {
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
        (payload.supports_tool_calling as boolean) ?? undefined
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
  // The new engine exposes only GET /v1/skills (list). The register/
  // unregister/delete/create mutations used by the old KWorks compat layer
  // are gone; skill authoring now goes through the /v1/skills/drafts/*
  // pipeline. KCoder's Settings UI still calls the mutation methods below,
  // so we keep the surface but make the unsupported ones reject with a clear
  // message. Wiring the drafts pipeline into the UI is tracked separately.

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

  // Enable a skill — not supported by the new engine (no register endpoint).
  async enableSkill(name: string): Promise<void> {
    throw new Error(
      `Skill enable/register is not supported by the current engine (drafts pipeline not wired). Requested: ${name}`
    )
  }

  // Disable a skill — not supported by the new engine (no unregister endpoint).
  async disableSkill(name: string): Promise<void> {
    throw new Error(
      `Skill disable/unregister is not supported by the current engine (drafts pipeline not wired). Requested: ${name}`
    )
  }

  // Delete a user skill — not supported by the new engine.
  async deleteSkill(name: string): Promise<void> {
    throw new Error(`Skill delete is not supported by the current engine. Requested: ${name}`)
  }

  // Create a new skill — not supported via this endpoint in the new engine
  // (use the /v1/skills/drafts pipeline instead).
  async createSkill(payload: { name: string; description: string; content?: string }): Promise<unknown> {
    throw new Error(
      `Skill create is not supported by the current engine (drafts pipeline not wired). Requested: ${payload.name}`
    )
  }

  // ============ Sub-Agents / MCP / Plugins / Commands / Remote API ============
  //
  // These features were "reserved, pending backend" in the KWorks era and
  // the new engine does not expose them over HTTP. We keep the method
  // surface so the Settings UI compiles, but they return empty data (reads)
  // or reject (writes) instead of hitting endpoints that no longer exist.
  // Each Settings panel already tolerates failures, so the UI shows empty
  // state rather than crashing.

  async listSubAgents(): Promise<SubAgentEntry[]> {
    return []
  }
  async createSubAgent(_payload: Omit<SubAgentEntry, 'type' | 'source'>): Promise<unknown> {
    throw new Error('Sub-agent management is not supported by the current engine')
  }
  async updateSubAgent(_id: string, _payload: Partial<SubAgentEntry>): Promise<unknown> {
    throw new Error('Sub-agent management is not supported by the current engine')
  }
  async deleteSubAgent(_id: string): Promise<void> {
    throw new Error('Sub-agent management is not supported by the current engine')
  }
  async cloneSubAgent(_id: string): Promise<unknown> {
    throw new Error('Sub-agent management is not supported by the current engine')
  }

  async getMcpConfig(): Promise<McpConfigResponse> {
    return { mcp_servers: {}, mcpServers: {}, skills: {} }
  }
  async saveMcpConfig(_config: { mcp_servers: Record<string, McpServerConfigEntry> }): Promise<McpConfigResponse> {
    throw new Error('MCP configuration management is not supported by the current engine')
  }

  async listPlugins(): Promise<PluginEntry[]> {
    return []
  }
  async togglePlugin(_id: string, _enabled: boolean): Promise<unknown> {
    throw new Error('Plugin management is not supported by the current engine')
  }
  async getPluginDiscover(): Promise<{ plugins: DiscoverPlugin[] }> {
    return { plugins: [] }
  }
  async installPlugin(_id: string): Promise<unknown> {
    throw new Error('Plugin management is not supported by the current engine')
  }
  async checkPluginUpdates(): Promise<{ updates: Array<{ id: string; latest: string }> }> {
    return { updates: [] }
  }

  async listCommands(): Promise<CommandEntry[]> {
    return []
  }
  async createCommand(_payload: Omit<CommandEntry, 'source'>): Promise<unknown> {
    throw new Error('Command management is not supported by the current engine')
  }
  async updateCommand(_id: string, _payload: Partial<CommandEntry>): Promise<unknown> {
    throw new Error('Command management is not supported by the current engine')
  }
  async deleteCommand(_id: string): Promise<void> {
    throw new Error('Command management is not supported by the current engine')
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
    throw new Error('Remote control is not supported by the current engine')
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
