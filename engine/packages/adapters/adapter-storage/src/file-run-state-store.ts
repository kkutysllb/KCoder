import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { RunStateV3Schema, type RunIdentity, type RunStateV3 } from '@qiongqi/contracts'
import type { LeaseFence, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { atomicWriteFile } from './atomic-write.js'
import { withFileLock } from './file-lock.js'
import { runtimeScopeDigest } from './runtime-store-utils.js'

type Lease = { holderId: string; expiresAt: string; epoch: number; token: string }

export type FileRunStateStoreOptions = { requireFence?: boolean }

export class FileRunStateStore implements RunSnapshotStore, RunLeaseStore {
  public readonly rootDir: string
  private readonly requireFence: boolean

  constructor(rootDir: string, options: FileRunStateStoreOptions = {}) {
    this.rootDir = resolve(rootDir)
    this.requireFence = options.requireFence ?? false
  }

  async save(state: RunStateV3, fence?: LeaseFence): Promise<void> {
    const parsed = RunStateV3Schema.parse(state)
    await this.withLock(this.leasePath(parsed), async () => {
      await this.assertFence(parsed, fence)
      await atomicWriteFile(this.snapshotPath(parsed), JSON.stringify(parsed, null, 2))
    })
  }

  async load(identity: RunIdentity): Promise<RunStateV3 | undefined> {
    try {
      const raw = await readFile(this.snapshotPath(identity), 'utf8')
      return RunStateV3Schema.parse(JSON.parse(raw))
    } catch {
      return undefined
    }
  }

  async writeRawSnapshot(identity: RunIdentity, contents: string): Promise<void> {
    const path = this.snapshotPath(identity)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }

  async acquire(identity: RunIdentity, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string; fence?: LeaseFence }> {
    const path = this.leasePath(identity)
    return this.withLock(path, async () => {
      const current = await this.readLease(path)
      const now = Date.now()
      if (current && Date.parse(current.expiresAt) > now && current.holderId !== holderId) return { acquired: false }
      if (current && Date.parse(current.expiresAt) > now && current.holderId === holderId) {
        return { acquired: true, expiresAt: current.expiresAt, fence: this.toFence(current) }
      }
      const epoch = Math.max(current?.epoch ?? 0, await this.readEpoch(identity)) + 1
      const expiresAt = new Date(now + Math.max(1, Math.floor(ttlMs))).toISOString()
      const lease: Lease = { holderId, expiresAt, epoch, token: randomUUID() }
      await atomicWriteFile(path, JSON.stringify(lease))
      await atomicWriteFile(this.epochPath(identity), String(epoch))
      return { acquired: true, expiresAt, fence: this.toFence(lease) }
    })
  }

  async renew(identity: RunIdentity, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean> {
    const fence = typeof fenceOrTtl === 'number' ? undefined : fenceOrTtl
    const effectiveTtl = typeof fenceOrTtl === 'number' ? fenceOrTtl : ttlMs
    if (effectiveTtl === undefined) return false
    const path = this.leasePath(identity)
    return this.withLock(path, async () => {
      const current = await this.readLease(path)
      if (!current || current.holderId !== holderId || (fence && !sameFence(current, fence)) || Date.parse(current.expiresAt) <= Date.now()) return false
      const renewed: Lease = { ...current, expiresAt: new Date(Date.now() + Math.max(1, Math.floor(effectiveTtl))).toISOString() }
      await atomicWriteFile(path, JSON.stringify(renewed))
      return true
    })
  }

  async release(identity: RunIdentity, holderId: string, fence?: LeaseFence): Promise<void> {
    const path = this.leasePath(identity)
    await this.withLock(path, async () => {
      const current = await this.readLease(path)
      if (current?.holderId === holderId && (!fence || sameFence(current, fence))) await rm(path, { force: true })
    })
  }

  private async assertFence(state: RunStateV3, fence?: LeaseFence): Promise<void> {
    if (!fence && !this.requireFence) return
    if (!fence) throw new Error('runtime snapshot write requires an active lease fence')
    const current = await this.readLease(this.leasePath(state))
    if (!current || Date.parse(current.expiresAt) <= Date.now() || current.holderId !== fence.holderId || !sameFence(current, fence)) {
      throw new Error('runtime snapshot write rejected by stale lease fence')
    }
  }

  private toFence(lease: Lease): LeaseFence { return { holderId: lease.holderId, epoch: lease.epoch, token: lease.token } }
  private scopeDigest(identity: RunIdentity): string { return runtimeScopeDigest(identity) }
  private snapshotPath(identity: RunIdentity): string { return join(this.rootDir, 'snapshots', `${this.scopeDigest(identity)}.json`) }
  private leasePath(identity: RunIdentity): string { return join(this.rootDir, 'leases', `${this.scopeDigest(identity)}.json`) }
  private epochPath(identity: RunIdentity): string { return join(this.rootDir, 'epochs', `${this.scopeDigest(identity)}.json`) }

  private async readEpoch(identity: RunIdentity): Promise<number> {
    try { return Number.parseInt(await readFile(this.epochPath(identity), 'utf8'), 10) || 0 } catch { return 0 }
  }
  private async readLease(path: string): Promise<Lease | undefined> {
    try { return JSON.parse(await readFile(path, 'utf8')) as Lease } catch { return undefined }
  }
  private async withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    return withFileLock(path, operation)
  }
}

function sameFence(lease: Lease, fence: LeaseFence): boolean { return lease.epoch === fence.epoch && lease.token === fence.token && lease.holderId === fence.holderId }
