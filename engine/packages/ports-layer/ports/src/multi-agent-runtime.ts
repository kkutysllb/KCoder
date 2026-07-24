import type { EventedV2WorkerRecord, EventedV2WorkerRole, MailboxMessage, MultiAgentRun } from '@qiongqi/contracts'
import type { LeaseFence } from './runtime-kernel.js'

export type MailboxClaimOptions = {
  holderId: string
  ttlMs: number
}

export type MultiAgentRunUpdateOptions = {
  fence?: LeaseFence
  expectedVersion?: number
}

export interface MultiAgentRunStore {
  save(run: MultiAgentRun): Promise<void>
  load(runId: string): Promise<MultiAgentRun | undefined>
  update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options?: MultiAgentRunUpdateOptions
  ): Promise<MultiAgentRun>
  loadVersion?(runId: string): Promise<number | undefined>
  acquireLease?(runId: string, holderId: string, ttlMs: number): Promise<{
    acquired: boolean
    expiresAt?: string
    fence?: LeaseFence
  }>
  renewLease?(runId: string, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean>
  releaseLease?(runId: string, holderId: string, fence?: LeaseFence): Promise<void>
  listAll(): Promise<MultiAgentRun[]>
  listWithPendingOutbox(): Promise<MultiAgentRun[]>
  listByThread(threadId: string): Promise<MultiAgentRun[]>
  delete(runId: string): Promise<void>
}

export interface MailboxStore {
  enqueue(message: MailboxMessage): Promise<void>
  claimNext(agentId: string, options?: MailboxClaimOptions): Promise<MailboxMessage | undefined>
  complete(messageId: string, status?: 'completed' | 'failed' | 'aborted', fence?: MailboxMessage['claimLease']): Promise<void>
  listForRun(runId: string): Promise<MailboxMessage[]>
}

export type EventedV2WorkerHeartbeat = {
  workerId: string
  role: EventedV2WorkerRole
  agentIds: string[]
  heartbeatAt: string
  ttlMs: number
}

export type EventedV2WorkerRegistryListOptions = {
  nowIso?: string
}

export interface EventedV2WorkerRegistryStore {
  recordHeartbeat(heartbeat: EventedV2WorkerHeartbeat): Promise<EventedV2WorkerRecord>
  list(options?: EventedV2WorkerRegistryListOptions): Promise<EventedV2WorkerRecord[]>
}
