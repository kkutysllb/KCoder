import type { TurnItem } from '@qiongqi/contracts'

export type TurnInflightRecord = {
  id: string
  kind: 'model' | 'tool'
  threadId: string
  turnId?: string
  callId?: string
  startedAt?: number
}

export interface TurnInflightTracker {
  begin(record: TurnInflightRecord): unknown
  end(id: string): unknown
}

export interface TurnSteeringQueue {
  setTurn(turnId: string | null): void
  enqueue(turnId: string, text: string): void
  clear(turnId?: string): void
}

export interface TurnContextCompactor {
  compact(input: {
    threadId: string
    turnId: string
    history: TurnItem[]
    prefix: {
      systemPrompt: string
      tools: never[]
      pinnedConstraints: string[]
      fewShots: never[]
      fingerprint: string
      revision: number
    }
    budgetTokens?: number
    reason?: string
  }): {
    summaryItem: TurnItem
    replacedTokens: number
  }
}
