import { randomUUID } from 'node:crypto'
import type {
  EngineStreamChannel,
  EngineStreamEvent,
  EngineStreamReasoningPolicy,
  GraphCorrelationIdentity,
  TaskScope
} from '@qiongqi/contracts'
import type { DurableEngineStore } from '@qiongqi/ports'

export type EngineStreamPublisherOptions = {
  store: DurableEngineStore
  streamId: string
  scope: TaskScope
  runId?: string
  multiAgentRunId?: string
  branchId?: string
  agentRunId?: string
  kernelRunId?: string
  graph?: GraphCorrelationIdentity
  reasoning?: Partial<EngineStreamReasoningPolicy>
  flushMs?: number
  maxBatch?: number
  nowIso?: () => string
}

export type EngineStreamPublishInput = {
  channel: EngineStreamChannel
  kind: string
  payload: unknown
}

type Pending = {
  input: EngineStreamPublishInput
  resolve: (event: EngineStreamEvent | undefined) => void
  reject: (error: unknown) => void
}

const DEFAULT_REASONING_POLICY: EngineStreamReasoningPolicy = {
  collect: false,
  persist: false,
  subscribe: false,
  retain: false
}

/** Durable append/replay facade shared by model, tool and HTTP integrations. */
export class EngineStreamPublisher {
  private readonly policy: EngineStreamReasoningPolicy
  private readonly pending: Pending[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private flushing: Promise<void> = Promise.resolve()
  private highWater = 0
  private readonly nowIso: () => string

  constructor(private readonly options: EngineStreamPublisherOptions) {
    this.policy = { ...DEFAULT_REASONING_POLICY, ...options.reasoning }
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  publish(input: EngineStreamPublishInput): Promise<EngineStreamEvent | undefined> {
    if (this.isFiltered(input)) return Promise.resolve(undefined)
    return new Promise((resolve, reject) => {
      this.pending.push({ input, resolve, reject })
      if (this.pending.length >= (this.options.maxBatch ?? 32)) {
        void this.flush()
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = undefined
          void this.flush()
        }, this.options.flushMs ?? 20)
      }
    })
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    const run = this.flushing.catch(() => undefined).then(async () => {
      const batch = this.pending.splice(0)
      if (batch.length === 0) return
      try {
        const runId = this.options.runId ?? `stream:${this.options.streamId}`
        const [runRecord, task] = await Promise.all([
          this.options.store.loadRun(runId),
          this.options.store.loadTask(this.options.scope)
        ])
        const result = await this.options.store.commit({
          scope: this.options.scope,
          runId,
          expectedRunVersion: runRecord?.version ?? 0,
          expectedTaskRevision: task?.revision ?? 0,
          streamEvents: batch.map((pending) => ({
            type: 'append' as const,
            record: {
              streamId: this.options.streamId,
              timestamp: this.nowIso(),
              scope: this.options.scope,
              ...(this.options.multiAgentRunId ? { multiAgentRunId: this.options.multiAgentRunId } : {}),
              ...(this.options.branchId ? { branchId: this.options.branchId } : {}),
              ...(this.options.agentRunId ? { agentRunId: this.options.agentRunId } : {}),
              ...(this.options.kernelRunId ? { kernelRunId: this.options.kernelRunId } : {}),
              ...(this.options.graph ? { graph: this.options.graph } : {}),
              channel: pending.input.channel,
              kind: pending.input.kind,
              payload: pending.input.payload
            }
          }))
        })
        const beforeBatch = Math.max(0, result.streamHighWater - batch.length)
        const committed = await this.options.store.readStream(this.options.streamId, beforeBatch, batch.length)
        this.highWater = Math.max(this.highWater, result.streamHighWater, committed.at(-1)?.seq ?? 0)
        batch.forEach((pending, index) => pending.resolve(committed[index]))
      } catch (error) {
        batch.forEach((pending) => pending.reject(error))
        throw error
      }
    })
    this.flushing = run
    await run
  }

  async read(subscriberId: string, afterSeq: number, limit = 100): Promise<EngineStreamEvent[]> {
    if (!this.policy.subscribe && subscriberId.startsWith('private:')) return []
    return this.options.store.readStream(this.options.streamId, afterSeq, limit)
  }

  ack(subscriberId: string, throughSeq: number): Promise<void> {
    return this.options.store.ackStream(this.options.streamId, subscriberId, throughSeq)
  }

  private isFiltered(input: EngineStreamPublishInput): boolean {
    const reasoning = input.channel === 'private' || input.kind.toLowerCase().includes('reasoning')
    return reasoning && (!this.policy.collect || !this.policy.persist)
  }
}

export function dedupeEngineStreamEvents(events: readonly EngineStreamEvent[]): EngineStreamEvent[] {
  const seen = new Set<string>()
  return events.filter((event) => {
    const key = `${event.streamId}:${event.seq}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function newEngineStreamId(): string {
  return randomUUID()
}
