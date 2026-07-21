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
  id: string
  threadId: string
  status: string
}

export interface SSEEvent {
  type: string
  data: unknown
}

export class EngineAPI {
  private baseUrl: string
  private token: string

  constructor(port: number, token: string = '') {
    this.baseUrl = `http://127.0.0.1:${port}`
    this.token = token
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
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
    // First, create a turn
    const turnResponse = await fetch(`${this.baseUrl}/v1/threads/${threadId}/turns`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        items: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'text', text: content }]
          }
        ]
      })
    })

    if (!turnResponse.ok) {
      throw new Error(`Failed to send message: ${turnResponse.statusText}`)
    }

    const turn: TurnResponse = await turnResponse.json()

    // Subscribe to SSE events for this turn
    await this.subscribeToTurn(threadId, turn.id, onEvent)
  }

  // Subscribe to turn events via SSE
  private async subscribeToTurn(
    threadId: string,
    turnId: string,
    onEvent: (event: SSEEvent) => void
  ): Promise<void> {
    const url = `${this.baseUrl}/v1/threads/${threadId}/turns/${turnId}/events`

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url)

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onEvent({ type: 'message', data })

          // Check if turn is complete
          if (data.type === 'turn.completed' || data.status === 'completed') {
            eventSource.close()
            resolve()
          }
        } catch (e) {
          console.error('Failed to parse SSE event:', e)
        }
      }

      eventSource.onerror = (error) => {
        eventSource.close()
        reject(error)
      }

      // Timeout after 5 minutes
      setTimeout(() => {
        eventSource.close()
        resolve()
      }, 5 * 60 * 1000)
    })
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
  if (!apiInstance) {
    apiInstance = new EngineAPI(port, token)
  }
  return apiInstance
}

export function resetEngineAPI(): void {
  apiInstance = null
}
