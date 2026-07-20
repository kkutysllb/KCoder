import { RunStateV3Schema, encodeScopeKey, type RunIdentity, type RunStateV3 } from '@qiongqi/contracts'
import type { LeaseFence, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { randomUUID } from 'node:crypto'

type Lease = { holderId: string; expiresAt: number; epoch: number; token: string }

function stateKey(state: RunStateV3): string {
  return encodeScopeKey({
    ownerUserId: state.ownerUserId,
    workspaceKey: state.workspaceKey,
    threadId: state.threadId,
    turnId: state.turnId,
    runId: state.runId,
    purpose: 'runtime'
  })
}

function identityKey(identity: RunIdentity): string {
  return encodeScopeKey({ ...identity, purpose: 'runtime' })
}

export class InMemoryRunStateStore implements RunSnapshotStore, RunLeaseStore {
  private readonly snapshots = new Map<string, RunStateV3>()
  private readonly leases = new Map<string, Lease>()
  private readonly epochs = new Map<string, number>()
  private readonly queues = new Map<string, Promise<unknown>>()

  async save(state: RunStateV3, fence?: LeaseFence): Promise<void> {
    await this.serial(stateKey(state), async () => {
      const parsed = RunStateV3Schema.parse(state)
      this.assertFence(parsed, fence)
      this.snapshots.set(stateKey(parsed), structuredClone(parsed))
    })
  }

  async load(identity: RunIdentity): Promise<RunStateV3 | undefined> {
    const state = this.snapshots.get(identityKey(identity))
    return state ? structuredClone(state) : undefined
  }

  async acquire(identity: RunIdentity, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string; fence?: LeaseFence }> {
    return this.serial(identityKey(identity), async () => {
    const leaseKey = identityKey(identity)
    const now = Date.now()
    const current = this.leases.get(leaseKey)
    if (current && current.expiresAt > now && current.holderId !== holderId) return { acquired: false }
    if (current && current.expiresAt > now && current.holderId === holderId) return { acquired: true, expiresAt: new Date(current.expiresAt).toISOString(), fence: this.fence(current) }
    const epoch = (this.epochs.get(leaseKey) ?? current?.epoch ?? 0) + 1
    const expiresAt = now + Math.max(1, Math.floor(ttlMs))
    const lease = { holderId, expiresAt, epoch, token: randomUUID() }
    this.epochs.set(leaseKey, epoch)
    this.leases.set(leaseKey, lease)
    return { acquired: true, expiresAt: new Date(expiresAt).toISOString(), fence: this.fence(lease) }
    })
  }

  async renew(identity: RunIdentity, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean> {
    return this.serial(identityKey(identity), async () => {
    const current = this.leases.get(identityKey(identity))
    const fence = typeof fenceOrTtl === 'number' ? undefined : fenceOrTtl
    const effectiveTtl = typeof fenceOrTtl === 'number' ? fenceOrTtl : ttlMs
    if (!current || !effectiveTtl || current.holderId !== holderId || (fence && !sameFence(current, fence)) || current.expiresAt <= Date.now()) return false
    current.expiresAt = Date.now() + Math.max(1, Math.floor(effectiveTtl))
    return true
    })
  }

  async release(identity: RunIdentity, holderId: string, fence?: LeaseFence): Promise<void> {
    await this.serial(identityKey(identity), async () => {
    const key = identityKey(identity)
    const current = this.leases.get(key)
    if (current?.holderId === holderId && (!fence || sameFence(current, fence))) this.leases.delete(key)
    })
  }

  private assertFence(state: RunStateV3, fence?: LeaseFence): void {
    if (!fence) return
    const current = this.leases.get(stateKey(state))
    if (!current || current.expiresAt <= Date.now() || !sameFence(current, fence)) throw new Error('runtime snapshot write rejected by stale lease fence')
  }
  private fence(lease: Lease): LeaseFence { return { holderId: lease.holderId, epoch: lease.epoch, token: lease.token } }
  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    const settled = current.then(() => undefined, () => undefined)
    this.queues.set(key, settled)
    try { return await current } finally { if (this.queues.get(key) === settled) this.queues.delete(key) }
  }
}

function sameFence(lease: Lease, fence: LeaseFence): boolean { return lease.holderId === fence.holderId && lease.epoch === fence.epoch && lease.token === fence.token }
