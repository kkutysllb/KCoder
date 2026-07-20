import type {
  RunEventEnvelope,
  RunIdentity,
  RunStateV3
} from '@qiongqi/contracts'

export interface RunEventStore {
  append(event: RunEventEnvelope, fence?: LeaseFence): Promise<RunEventEnvelope>
  listAfter(identity: RunIdentity, seq: number): Promise<RunEventEnvelope[]>
}

export interface RunSnapshotStore {
  save(state: RunStateV3, fence?: LeaseFence): Promise<void>
  load(identity: RunIdentity): Promise<RunStateV3 | undefined>
}

export type LeaseFence = {
  readonly holderId: string
  readonly epoch: number
  readonly token: string
}

export interface RunLeaseStore {
  acquire(identity: RunIdentity, holderId: string, ttlMs: number): Promise<{
    acquired: boolean
    expiresAt?: string
    fence?: LeaseFence
  }>
  renew(identity: RunIdentity, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean>
  release(identity: RunIdentity, holderId: string, fence?: LeaseFence): Promise<void>
}
