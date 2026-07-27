// QiongQi Engine API Client
//
// Contract types are imported with `import type` from @qiongqi/contracts (the
// engine's foundation package). Type-only imports are erased at compile time,
// so the renderer's browser bundle never pulls in zod (the contracts package's
// only runtime dependency). Never import the `*Schema` value objects here —
// those would drag zod v4 into the bundle. If you need a type that lives only
// in @qiongqi/loop (e.g. the timeline projection), re-declare the minimal view
// shape locally rather than importing it, because @qiongqi/loop is not
// browser-safe (it pulls in node-only deps).
import type {
  EngineStreamEvent,
  BranchRoiSnapshot,
  RoiSnapshot
} from '@qiongqi/contracts'

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
//
// These view types are the renderer's projection of the engine's durable
// run timeline (GET /v1/runtime/evented-v2/runs/:runId/timeline) plus the
// governed engine stream (GET /v1/engine/streams/:streamId/subscribe).
//
// The engine's authoritative timeline shape (EventedV2RunTimeline) lives in
// @qiongqi/loop, which is NOT browser-safe, so we re-declare the minimal
// fields we consume here. The ROI / branch-attribution types ARE imported
// from @qiongqi/contracts (browser-safe, type-only).
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

    return new Promise<void>((resolve) => {
      let resolved = false
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
          onEvent({ kind, data })
          // Terminate once the current turn reaches a terminal state.
          if (
            kind === 'turn_completed' ||
            kind === 'turn_failed' ||
            kind === 'turn_aborted'
          ) {
            const eventTurnId = data.turnId as string | undefined
            if (!eventTurnId || eventTurnId === turnId) {
              finish()
            }
          }
        } catch (e) {
          console.error('[KCoder] Failed to parse SSE event:', e)
        }
      }

      (async () => {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: { ...this.headers, Accept: 'text/event-stream' },
            signal: controller.signal
          })
          if (!response.ok || !response.body) {
            console.error(`[KCoder] SSE stream failed: ${response.status}`)
            finish()
            return
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
        } catch (e) {
          if ((e as Error).name !== 'AbortError') {
            console.error('[KCoder] SSE stream error:', e)
          }
        } finally {
          finish()
        }
      })()

      // Safety timeout (10 minutes) in case the turn-terminal event is missed.
      setTimeout(finish, 10 * 60 * 1000)
    })
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
   *   id: <seq>\nevent: <kind>\ndata: <full EngineStreamEvent JSON>\n\n
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
