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
