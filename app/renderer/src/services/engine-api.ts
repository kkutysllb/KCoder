// QiongQi Engine API Client

export interface ThreadResponse {
  id: string
  createdAt: string
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
