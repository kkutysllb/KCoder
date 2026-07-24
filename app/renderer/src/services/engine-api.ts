// QiongQi Engine API Client

export interface ThreadResponse {
  id: string
  createdAt: string
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

  // ============ Auth API (engine /api/v1/auth/*) ============

  async getSetupStatus(): Promise<AuthSetupStatus> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/setup-status`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get setup status: ${response.statusText}`)
    }
    return response.json()
  }

  async authInitialize(email: string, password: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/initialize`, {
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
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login/local`, {
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
    const response = await fetch(`${this.baseUrl}/api/v1/auth/register`, {
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
    const response = await fetch(`${this.baseUrl}/api/v1/auth/me`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Not authenticated: ${response.statusText}`)
    }
    const data = await response.json() as { user?: AuthUser } & AuthUser
    return data.user ?? data
  }

  async authLogout(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Logout failed: ${response.statusText}`)
    }
  }

  async authChangePassword(currentPassword: string, newPassword: string): Promise<AuthSessionResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/change-password`, {
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
  async createThread(): Promise<ThreadResponse> {
    const response = await fetch(`${this.baseUrl}/v1/threads`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({})
    })

    if (!response.ok) {
      throw new Error(`Failed to create thread: ${response.statusText}`)
    }

    return response.json()
  }

  // Send a message and get streaming response
  async sendMessage(
    threadId: string,
    content: string,
    onEvent: (event: SSEEvent) => void
  ): Promise<void> {
    // 创建 turn — 后端 StartTurnRequest 要求 { prompt: string }
    const turnResponse = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ prompt: content })
    })

    if (!turnResponse.ok) {
      const text = await turnResponse.text().catch(() => turnResponse.statusText)
      throw new Error(`Failed to send message: ${text}`)
    }

    const turn: TurnResponse = await turnResponse.json()

    // 订阅线程级 SSE 事件流（后端路径是 /v1/threads/:id/events，不是 /turns/:turnId/events）
    await this.subscribeToThread(threadId, turn.turnId, onEvent)
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

  // 列出模型 — GET /api/models
  async getModels(): Promise<{ models: ModelEntry[] }> {
    const response = await fetch(`${this.baseUrl}/api/models`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get models: ${response.statusText}`)
    }
    return response.json()
  }

  // 激活模型 — POST /api/models/:name/activate
  async activateModel(name: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/models/${encodeURIComponent(name)}/activate`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to activate model: ${response.statusText}`)
    }
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

  // ============ Skills API ============

  // List all skills
  async listSkills(): Promise<SkillEntry[]> {
    const response = await fetch(`${this.baseUrl}/api/skills`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list skills: ${response.statusText}`)
    }
    const data = await response.json()
    return data.skills ?? []
  }

  // Enable a skill
  async enableSkill(name: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}/register`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to enable skill: ${response.statusText}`)
    }
  }

  // Disable a skill
  async disableSkill(name: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}/unregister`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to disable skill: ${response.statusText}`)
    }
  }

  // Delete a user skill
  async deleteSkill(name: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to delete skill: ${response.statusText}`)
    }
  }

  // Create a new skill
  async createSkill(payload: { name: string; description: string; content?: string }): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/skills/create`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to create skill: ${response.statusText}`)
    }
    return response.json()
  }

  // Install a skill from source
  async installSkill(payload: { source: string; skillId?: string }): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/skills/install`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to install skill: ${response.statusText}`)
    }
    return response.json()
  }

  // Get marketplace index
  async getMarketplace(): Promise<MarketplaceIndex> {
    const response = await fetch(`${this.baseUrl}/api/skills-marketplace`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch marketplace: ${response.statusText}`)
    }
    return response.json()
  }

  // ============ Sub-Agents API (reserved, pending backend) ============

  // List all sub-agents
  async listSubAgents(): Promise<SubAgentEntry[]> {
    const response = await fetch(`${this.baseUrl}/api/subagents`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list sub-agents: ${response.statusText}`)
    }
    const data = await response.json()
    return data.agents ?? []
  }

  // Create a user sub-agent
  async createSubAgent(payload: Omit<SubAgentEntry, 'type' | 'source'>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/subagents`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to create sub-agent: ${response.statusText}`)
    }
    return response.json()
  }

  // Update a user sub-agent
  async updateSubAgent(id: string, payload: Partial<SubAgentEntry>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/subagents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to update sub-agent: ${response.statusText}`)
    }
    return response.json()
  }

  // Delete a user sub-agent
  async deleteSubAgent(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/subagents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to delete sub-agent: ${response.statusText}`)
    }
  }

  // Clone a builtin sub-agent as user agent
  async cloneSubAgent(id: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/subagents/${encodeURIComponent(id)}/clone`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to clone sub-agent: ${response.statusText}`)
    }
    return response.json()
  }

  // ============ MCP Servers API (engine routes exist: GET/PUT /api/mcp/config) ============

  // Get full MCP configuration
  async getMcpConfig(): Promise<McpConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/mcp/config`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get MCP config: ${response.statusText}`)
    }
    return response.json()
  }

  // Save full MCP configuration
  async saveMcpConfig(config: { mcp_servers: Record<string, McpServerConfigEntry> }): Promise<McpConfigResponse> {
    const response = await fetch(`${this.baseUrl}/api/mcp/config`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(config)
    })
    if (!response.ok) {
      throw new Error(`Failed to save MCP config: ${response.statusText}`)
    }
    return response.json()
  }

  // Get MCP server runtime diagnostics (from /api/runtime/diagnostics)
  async getMcpDiagnostics(): Promise<McpServerDiagnostic[]> {
    const response = await fetch(`${this.baseUrl}/api/runtime/diagnostics`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get MCP diagnostics: ${response.statusText}`)
    }
    const data = await response.json()
    return data.tools?.mcpServers ?? []
  }

  // ============ Plugins API (reserved, pending backend) ============

  // List installed plugins
  async listPlugins(): Promise<PluginEntry[]> {
    const response = await fetch(`${this.baseUrl}/api/plugins`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list plugins: ${response.statusText}`)
    }
    const data = await response.json()
    return data.plugins ?? []
  }

  // Toggle plugin enabled state
  async togglePlugin(id: string, enabled: boolean): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/plugins/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ enabled })
    })
    if (!response.ok) {
      throw new Error(`Failed to toggle plugin: ${response.statusText}`)
    }
    return response.json()
  }

  // Install a plugin from marketplace
  async installPlugin(id: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/plugins/install`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ id })
    })
    if (!response.ok) {
      throw new Error(`Failed to install plugin: ${response.statusText}`)
    }
    return response.json()
  }

  // Check for plugin updates
  async checkPluginUpdates(): Promise<{ updates: Array<{ id: string; latest: string }> }> {
    const response = await fetch(`${this.baseUrl}/api/plugins/check-update`, {
      method: 'POST',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to check plugin updates: ${response.statusText}`)
    }
    return response.json()
  }

  // ============ Commands API (reserved, pending backend) ============

  // List all commands (skill-registered + user .md commands)
  async listCommands(): Promise<CommandEntry[]> {
    const response = await fetch(`${this.baseUrl}/api/commands`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list commands: ${response.statusText}`)
    }
    const data = await response.json()
    return data.commands ?? []
  }

  // Create a user command (.md file)
  async createCommand(payload: Omit<CommandEntry, 'source'>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/commands`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to create command: ${response.statusText}`)
    }
    return response.json()
  }

  // Update a user command
  async updateCommand(id: string, payload: Partial<CommandEntry>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/commands/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      throw new Error(`Failed to update command: ${response.statusText}`)
    }
    return response.json()
  }

  // Delete a user command
  async deleteCommand(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/commands/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to delete command: ${response.statusText}`)
    }
  }

  // ============ Remote Control API (reserved, pending backend) ============

  // Get remote control configuration
  async getRemoteConfig(): Promise<RemoteConfig> {
    const response = await fetch(`${this.baseUrl}/api/remote/config`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to get remote config: ${response.statusText}`)
    }
    return response.json()
  }

  // Update remote control configuration
  async saveRemoteConfig(config: Partial<RemoteConfig>): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/remote/config`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(config)
    })
    if (!response.ok) {
      throw new Error(`Failed to save remote config: ${response.statusText}`)
    }
    return response.json()
  }

  // Test connectivity to a remote engine
  async testRemoteConnection(url: string, token: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/remote/test`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ url, token })
    })
    if (!response.ok) {
      throw new Error(`Failed to test remote connection: ${response.statusText}`)
    }
    return response.json()
  }

  // List connected remote sessions
  async listRemoteSessions(): Promise<RemoteSessionInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/remote/sessions`, {
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to list remote sessions: ${response.statusText}`)
    }
    const data = await response.json()
    return data.sessions ?? []
  }

  // Revoke a remote session
  async revokeRemoteSession(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/remote/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers
    })
    if (!response.ok) {
      throw new Error(`Failed to revoke remote session: ${response.statusText}`)
    }
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
