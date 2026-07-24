import {
  EventedV2WorkerRecordSchema,
  MailboxMessageSchema,
  MultiAgentRunSchema,
  type EventedV2WorkerRecord,
  type MailboxMessage,
  type MultiAgentRun
} from '@qiongqi/contracts'
import type {
  EventedV2WorkerHeartbeat,
  EventedV2WorkerRegistryListOptions,
  EventedV2WorkerRegistryStore,
  LeaseFence,
  MailboxClaimOptions,
  MailboxStore,
  MultiAgentRunStore,
  MultiAgentRunUpdateOptions
} from '@qiongqi/ports'
import { randomUUID } from 'node:crypto'

type RunLease = { holderId: string; expiresAt: number; epoch: number; token: string }

export class InMemoryEventedV2WorkerRegistryStore implements EventedV2WorkerRegistryStore {
  private readonly workers = new Map<string, EventedV2WorkerRecord>()

  async recordHeartbeat(heartbeat: EventedV2WorkerHeartbeat): Promise<EventedV2WorkerRecord> {
    const existing = this.workers.get(heartbeat.workerId)
    const expiresAt = new Date(Date.parse(heartbeat.heartbeatAt) + Math.max(1, Math.floor(heartbeat.ttlMs))).toISOString()
    const record = EventedV2WorkerRecordSchema.parse({
      workerId: heartbeat.workerId,
      role: heartbeat.role,
      status: 'online',
      agentIds: [...heartbeat.agentIds],
      startedAt: existing?.startedAt ?? heartbeat.heartbeatAt,
      heartbeatAt: heartbeat.heartbeatAt,
      expiresAt,
      updatedAt: heartbeat.heartbeatAt
    })
    this.workers.set(record.workerId, record)
    return record
  }

  async list(options: EventedV2WorkerRegistryListOptions = {}): Promise<EventedV2WorkerRecord[]> {
    const now = options.nowIso ? Date.parse(options.nowIso) : Date.now()
    return [...this.workers.values()]
      .map((record) => workerRecordWithComputedStatus(record, now))
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
  }
}

export class InMemoryMultiAgentRunStore implements MultiAgentRunStore {
  private readonly runs = new Map<string, MultiAgentRun>()
  private readonly runLocks = new Map<string, Promise<void>>()
  private readonly versions = new Map<string, number>()
  private readonly leases = new Map<string, RunLease>()
  private readonly leaseEpochs = new Map<string, number>()

  async save(run: MultiAgentRun): Promise<void> {
    const parsed = MultiAgentRunSchema.parse(run)
    await this.withRunLock(parsed.runId, async () => {
      this.runs.set(parsed.runId, parsed)
      if (!this.versions.has(parsed.runId)) this.versions.set(parsed.runId, 0)
    })
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    return this.runs.get(runId)
  }

  async update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    return this.withRunLock(runId, async () => {
      const current = this.runs.get(runId)
      if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
      this.assertFence(runId, options.fence)
      const currentVersion = this.versions.get(runId) ?? 0
      if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new Error(`MultiAgentRun version mismatch: expected ${options.expectedVersion}, got ${currentVersion}`)
      }
      const next = MultiAgentRunSchema.parse(await mutate(current))
      if (next.runId !== runId) throw new Error(`MultiAgentRun update cannot change runId: ${next.runId} !== ${runId}`)
      this.runs.set(runId, next)
      this.versions.set(runId, currentVersion + 1)
      return next
    })
  }

  async loadVersion(runId: string): Promise<number | undefined> {
    return this.runs.has(runId) ? (this.versions.get(runId) ?? 0) : undefined
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string; fence?: LeaseFence }> {
    return this.withRunLock(runId, async () => {
      const now = Date.now()
      const current = this.leases.get(runId)
      if (current && current.expiresAt > now && current.holderId !== holderId) return { acquired: false }
      if (current && current.expiresAt > now && current.holderId === holderId) {
        return { acquired: true, expiresAt: new Date(current.expiresAt).toISOString(), fence: leaseFence(current) }
      }
      const epoch = (this.leaseEpochs.get(runId) ?? current?.epoch ?? 0) + 1
      const expiresAt = now + Math.max(1, Math.floor(ttlMs))
      const lease: RunLease = { holderId, expiresAt, epoch, token: randomUUID() }
      this.leaseEpochs.set(runId, epoch)
      this.leases.set(runId, lease)
      return { acquired: true, expiresAt: new Date(expiresAt).toISOString(), fence: leaseFence(lease) }
    })
  }

  async renewLease(runId: string, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean> {
    return this.withRunLock(runId, async () => {
      const current = this.leases.get(runId)
      const fence = typeof fenceOrTtl === 'number' ? undefined : fenceOrTtl
      const effectiveTtl = typeof fenceOrTtl === 'number' ? fenceOrTtl : ttlMs
      if (!current || !effectiveTtl || current.holderId !== holderId || (fence && !sameFence(current, fence)) || current.expiresAt <= Date.now()) {
        return false
      }
      current.expiresAt = Date.now() + Math.max(1, Math.floor(effectiveTtl))
      return true
    })
  }

  async releaseLease(runId: string, holderId: string, fence?: LeaseFence): Promise<void> {
    await this.withRunLock(runId, async () => {
      const current = this.leases.get(runId)
      if (current?.holderId === holderId && (!fence || sameFence(current, fence))) this.leases.delete(runId)
    })
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async listAll(): Promise<MultiAgentRun[]> {
    return [...this.runs.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async listWithPendingOutbox(): Promise<MultiAgentRun[]> {
    return [...this.runs.values()]
      .filter((run) => run.outbox.some((intent) => intent.status === 'pending'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async delete(runId: string): Promise<void> {
    await this.withRunLock(runId, async () => {
      this.runs.delete(runId)
      this.versions.delete(runId)
      this.leases.delete(runId)
    })
  }

  private assertFence(runId: string, fence?: LeaseFence): void {
    if (!fence) return
    const current = this.leases.get(runId)
    if (!current || current.expiresAt <= Date.now() || !sameFence(current, fence)) {
      throw new Error('MultiAgentRun update rejected by stale lease fence')
    }
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous
      .catch(() => undefined)
      .then(() => gate)
    this.runLocks.set(runId, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.runLocks.get(runId) === current) this.runLocks.delete(runId)
    }
  }
}

function leaseFence(lease: RunLease): LeaseFence {
  return { holderId: lease.holderId, epoch: lease.epoch, token: lease.token }
}

function sameFence(lease: RunLease, fence: LeaseFence): boolean {
  return lease.holderId === fence.holderId && lease.epoch === fence.epoch && lease.token === fence.token
}

function workerRecordWithComputedStatus(record: EventedV2WorkerRecord, now: number): EventedV2WorkerRecord {
  return EventedV2WorkerRecordSchema.parse({
    ...record,
    status: Date.parse(record.expiresAt) <= now ? 'expired' : 'online'
  })
}

export class InMemoryMailboxStore implements MailboxStore {
  private readonly messages = new Map<string, MailboxMessage>()
  private readonly claimEpochs = new Map<string, number>()

  constructor(private readonly options: { nowMs?: () => number } = {}) {}

  async enqueue(message: MailboxMessage): Promise<void> {
    const parsed = MailboxMessageSchema.parse(message)
    const existing = this.messages.get(parsed.messageId)
    if (existing) {
      this.messages.set(parsed.messageId, preserveMailboxProgress(existing, parsed))
      return
    }
    this.messages.set(parsed.messageId, parsed)
  }

  async claimNext(agentId: string, options?: MailboxClaimOptions): Promise<MailboxMessage | undefined> {
    const now = this.nowMs()
    const queued = [...this.messages.values()]
      .filter((message) => message.toAgentId === agentId && claimableMailboxMessage(message, now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (!queued) return undefined
    const claimLease = options ? this.nextClaimLease(queued.messageId, options, now) : undefined
    const delivered = MailboxMessageSchema.parse({
      ...queued,
      status: 'delivered',
      ...(claimLease ? { claimLease } : {}),
      updatedAt: new Date(now).toISOString()
    })
    this.messages.set(delivered.messageId, delivered)
    return delivered
  }

  async complete(messageId: string, status: 'completed' | 'failed' | 'aborted' = 'completed', fence?: MailboxMessage['claimLease']): Promise<void> {
    const current = this.messages.get(messageId)
    if (!current) return
    if (current.status === status) return
    assertMailboxFence(current, fence)
    const { claimLease: _claimLease, ...rest } = current
    this.messages.set(messageId, MailboxMessageSchema.parse({ ...rest, status, updatedAt: new Date(this.nowMs()).toISOString() }))
  }

  async listForRun(runId: string): Promise<MailboxMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private nextClaimLease(messageId: string, options: MailboxClaimOptions, now: number): NonNullable<MailboxMessage['claimLease']> {
    const epoch = (this.claimEpochs.get(messageId) ?? 0) + 1
    this.claimEpochs.set(messageId, epoch)
    return {
      holderId: options.holderId,
      expiresAt: new Date(now + Math.max(1, Math.floor(options.ttlMs))).toISOString(),
      epoch,
      token: randomUUID()
    }
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now()
  }
}

function preserveMailboxProgress(existing: MailboxMessage, incoming: MailboxMessage): MailboxMessage {
  if (mailboxStatusRank(existing.status) >= mailboxStatusRank(incoming.status)) return existing
  return incoming
}

function mailboxStatusRank(status: MailboxMessage['status']): number {
  return {
    queued: 0,
    delivered: 1,
    failed: 1,
    aborted: 1,
    completed: 2
  }[status]
}

function claimableMailboxMessage(message: MailboxMessage, now: number): boolean {
  if (message.status === 'queued') return true
  return message.status === 'delivered' && Boolean(message.claimLease) && Date.parse(message.claimLease!.expiresAt) <= now
}

function assertMailboxFence(message: MailboxMessage, fence: MailboxMessage['claimLease'] | undefined): void {
  if (!fence) return
  const current = message.claimLease
  if (
    !current ||
    current.holderId !== fence.holderId ||
    current.epoch !== fence.epoch ||
    current.token !== fence.token
  ) {
    throw new Error('Mailbox complete rejected by stale mailbox claim')
  }
}
