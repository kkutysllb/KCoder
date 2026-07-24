import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
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
import { atomicWriteFile } from './atomic-write.js'
import { withFileLock } from './file-lock.js'

type RunLease = { holderId: string; expiresAt: string; epoch: number; token: string }

function safeSegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed !== value ||
    value.includes('/') ||
    value.includes('\\') ||
    basename(value) !== value
  ) {
    throw new Error(`Invalid ${label} path segment`)
  }
  return value
}

function isNoEntry(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'ENOENT'
}

async function readDirIfExists(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNoEntry(error)) return []
    throw error
  }
}

async function readRunFile(path: string): Promise<MultiAgentRun> {
  return MultiAgentRunSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function readMessageFile(path: string): Promise<MailboxMessage> {
  return MailboxMessageSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function readWorkerFile(path: string): Promise<EventedV2WorkerRecord> {
  return EventedV2WorkerRecordSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

export class FileEventedV2WorkerRegistryStore implements EventedV2WorkerRegistryStore {
  constructor(readonly rootDir: string) {}

  async recordHeartbeat(heartbeat: EventedV2WorkerHeartbeat): Promise<EventedV2WorkerRecord> {
    const workerId = safeSegment(heartbeat.workerId, 'workerId')
    return withFileLock(this.workerLockPath(workerId), async () => {
      const existing = await this.read(workerId).catch((error) => {
        if (isNoEntry(error)) return undefined
        throw error
      })
      const expiresAt = new Date(Date.parse(heartbeat.heartbeatAt) + Math.max(1, Math.floor(heartbeat.ttlMs))).toISOString()
      const record = EventedV2WorkerRecordSchema.parse({
        workerId,
        role: heartbeat.role,
        status: 'online',
        agentIds: [...heartbeat.agentIds],
        startedAt: existing?.startedAt ?? heartbeat.heartbeatAt,
        heartbeatAt: heartbeat.heartbeatAt,
        expiresAt,
        updatedAt: heartbeat.heartbeatAt
      })
      await atomicWriteFile(this.workerPath(workerId), JSON.stringify(record, null, 2))
      return record
    })
  }

  async list(options: EventedV2WorkerRegistryListOptions = {}): Promise<EventedV2WorkerRecord[]> {
    const now = options.nowIso ? Date.parse(options.nowIso) : Date.now()
    const dir = join(this.rootDir, 'evented-v2-workers')
    const entries = await readDirIfExists(dir)
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readWorkerFile(join(dir, safeSegment(entry, 'worker file')))))
    return records
      .map((record) => workerRecordWithComputedStatus(record, now))
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
  }

  private async read(workerId: string): Promise<EventedV2WorkerRecord> {
    return readWorkerFile(this.workerPath(workerId))
  }

  private workerPath(workerId: string): string {
    return join(this.rootDir, 'evented-v2-workers', `${safeSegment(workerId, 'workerId')}.json`)
  }

  private workerLockPath(workerId: string): string {
    return join(this.rootDir, 'evented-v2-worker-locks', `${safeSegment(workerId, 'workerId')}.json`)
  }
}

export class FileMultiAgentRunStore implements MultiAgentRunStore {
  constructor(readonly rootDir: string) {}

  async save(run: MultiAgentRun): Promise<void> {
    const parsed = MultiAgentRunSchema.parse(run)
    const runId = safeSegment(parsed.runId, 'runId')
    await withFileLock(this.runLockPath(runId), async () => {
      await this.saveParsed(parsed)
      if (await this.loadVersionUnlocked(runId) === undefined) await this.writeVersion(runId, 0)
    })
  }

  async update(
    runId: string,
    mutate: (current: MultiAgentRun) => MultiAgentRun | Promise<MultiAgentRun>,
    options: MultiAgentRunUpdateOptions = {}
  ): Promise<MultiAgentRun> {
    const safeRunId = safeSegment(runId, 'runId')
    return withFileLock(this.runLockPath(safeRunId), async () => {
      const current = (await this.findRunFiles(safeRunId))[0]?.run
      if (!current) throw new Error(`MultiAgentRun not found: ${safeRunId}`)
      await this.assertFence(safeRunId, options.fence)
      const currentVersion = await this.loadVersionUnlocked(safeRunId) ?? 0
      if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new Error(`MultiAgentRun version mismatch: expected ${options.expectedVersion}, got ${currentVersion}`)
      }
      const next = MultiAgentRunSchema.parse(await mutate(current))
      if (next.runId !== safeRunId) {
        throw new Error(`MultiAgentRun update cannot change runId: ${next.runId} !== ${safeRunId}`)
      }
      await this.saveParsed(next)
      await this.writeVersion(safeRunId, currentVersion + 1)
      return next
    })
  }

  async loadVersion(runId: string): Promise<number | undefined> {
    const safeRunId = safeSegment(runId, 'runId')
    return withFileLock(this.runLockPath(safeRunId), () => this.loadVersionUnlocked(safeRunId))
  }

  async acquireLease(runId: string, holderId: string, ttlMs: number): Promise<{ acquired: boolean; expiresAt?: string; fence?: LeaseFence }> {
    const safeRunId = safeSegment(runId, 'runId')
    safeSegment(holderId, 'holderId')
    return withFileLock(this.runLockPath(safeRunId), async () => {
      const current = await this.readLease(safeRunId)
      const now = Date.now()
      if (current && Date.parse(current.expiresAt) > now && current.holderId !== holderId) return { acquired: false }
      if (current && Date.parse(current.expiresAt) > now && current.holderId === holderId) {
        return { acquired: true, expiresAt: current.expiresAt, fence: leaseFence(current) }
      }
      const epoch = Math.max(current?.epoch ?? 0, await this.loadLeaseEpoch(safeRunId)) + 1
      const expiresAt = new Date(now + Math.max(1, Math.floor(ttlMs))).toISOString()
      const lease: RunLease = { holderId, expiresAt, epoch, token: randomUUID() }
      await atomicWriteFile(this.leasePath(safeRunId), JSON.stringify(lease))
      await atomicWriteFile(this.leaseEpochPath(safeRunId), String(epoch))
      return { acquired: true, expiresAt, fence: leaseFence(lease) }
    })
  }

  async renewLease(runId: string, holderId: string, fenceOrTtl: LeaseFence | number, ttlMs?: number): Promise<boolean> {
    const safeRunId = safeSegment(runId, 'runId')
    const fence = typeof fenceOrTtl === 'number' ? undefined : fenceOrTtl
    const effectiveTtl = typeof fenceOrTtl === 'number' ? fenceOrTtl : ttlMs
    if (effectiveTtl === undefined) return false
    return withFileLock(this.runLockPath(safeRunId), async () => {
      const current = await this.readLease(safeRunId)
      if (!current || current.holderId !== holderId || (fence && !sameFence(current, fence)) || Date.parse(current.expiresAt) <= Date.now()) return false
      const renewed: RunLease = {
        ...current,
        expiresAt: new Date(Date.now() + Math.max(1, Math.floor(effectiveTtl))).toISOString()
      }
      await atomicWriteFile(this.leasePath(safeRunId), JSON.stringify(renewed))
      return true
    })
  }

  async releaseLease(runId: string, holderId: string, fence?: LeaseFence): Promise<void> {
    const safeRunId = safeSegment(runId, 'runId')
    await withFileLock(this.runLockPath(safeRunId), async () => {
      const current = await this.readLease(safeRunId)
      if (current?.holderId === holderId && (!fence || sameFence(current, fence))) {
        await rm(this.leasePath(safeRunId), { force: true })
      }
    })
  }

  private async saveParsed(parsed: MultiAgentRun): Promise<void> {
    const threadId = safeSegment(parsed.threadId, 'threadId')
    const runId = safeSegment(parsed.runId, 'runId')
    const existingFiles = await this.findRunFiles(runId)
    await Promise.all(existingFiles
      .filter((existing) => existing.threadId !== threadId)
      .map((existing) => rm(existing.path, { force: true })))
    const dir = join(this.rootDir, 'multi-agent-runs', threadId)
    await atomicWriteFile(join(dir, `${runId}.json`), JSON.stringify(parsed, null, 2))
  }

  async load(runId: string): Promise<MultiAgentRun | undefined> {
    const safeRunId = safeSegment(runId, 'runId')
    return (await this.findRunFiles(safeRunId))[0]?.run
  }

  async listByThread(threadId: string): Promise<MultiAgentRun[]> {
    const safeThreadId = safeSegment(threadId, 'threadId')
    const dir = join(this.rootDir, 'multi-agent-runs', safeThreadId)
    const entries = await readDirIfExists(dir)
    const runs = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readRunFile(join(dir, safeSegment(entry, 'run file')))))
    return runs
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async listAll(): Promise<MultiAgentRun[]> {
    const root = join(this.rootDir, 'multi-agent-runs')
    const threadDirs = await readDirIfExists(root)
    const all: MultiAgentRun[] = []
    for (const threadDir of threadDirs) {
      all.push(...await this.listByThread(threadDir))
    }
    return all
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async listWithPendingOutbox(): Promise<MultiAgentRun[]> {
    return (await this.listAll())
      .filter((run) => run.outbox.some((intent) => intent.status === 'pending'))
  }

  async delete(runId: string): Promise<void> {
    const safeRunId = safeSegment(runId, 'runId')
    await withFileLock(this.runLockPath(safeRunId), async () => {
      const existingFiles = await this.findRunFiles(safeRunId)
      await Promise.all(existingFiles.map((existing) => rm(existing.path, { force: true })))
      await rm(this.versionPath(safeRunId), { force: true })
      await rm(this.leasePath(safeRunId), { force: true })
    })
  }

  private async findRunFiles(runId: string): Promise<Array<{ path: string, run: MultiAgentRun, threadId: string }>> {
    const safeRunId = safeSegment(runId, 'runId')
    const root = join(this.rootDir, 'multi-agent-runs')
    const threadDirs = await readDirIfExists(root)
    const runs: Array<{ path: string, run: MultiAgentRun, threadId: string }> = []
    for (const threadDir of threadDirs) {
      const threadId = safeSegment(threadDir, 'threadId')
      const path = join(root, threadId, `${safeRunId}.json`)
      try {
        runs.push({ path, run: await readRunFile(path), threadId })
      } catch (error) {
        if (isNoEntry(error)) continue
        throw error
      }
    }
    return runs
  }

  private runLockPath(runId: string): string {
    return join(this.rootDir, 'multi-agent-run-locks', `${safeSegment(runId, 'runId')}.json`)
  }

  private versionPath(runId: string): string {
    return join(this.rootDir, 'multi-agent-run-versions', `${safeSegment(runId, 'runId')}.json`)
  }

  private leasePath(runId: string): string {
    return join(this.rootDir, 'multi-agent-run-leases', `${safeSegment(runId, 'runId')}.json`)
  }

  private leaseEpochPath(runId: string): string {
    return join(this.rootDir, 'multi-agent-run-lease-epochs', `${safeSegment(runId, 'runId')}.json`)
  }

  private async loadVersionUnlocked(runId: string): Promise<number | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.versionPath(runId), 'utf8')) as unknown
      return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
    } catch (error) {
      if (isNoEntry(error)) return undefined
      throw error
    }
  }

  private async writeVersion(runId: string, version: number): Promise<void> {
    await atomicWriteFile(this.versionPath(runId), JSON.stringify(version))
  }

  private async readLease(runId: string): Promise<RunLease | undefined> {
    try {
      return JSON.parse(await readFile(this.leasePath(runId), 'utf8')) as RunLease
    } catch (error) {
      if (isNoEntry(error)) return undefined
      throw error
    }
  }

  private async loadLeaseEpoch(runId: string): Promise<number> {
    try {
      return Number.parseInt(await readFile(this.leaseEpochPath(runId), 'utf8'), 10) || 0
    } catch (error) {
      if (isNoEntry(error)) return 0
      throw error
    }
  }

  private async assertFence(runId: string, fence?: LeaseFence): Promise<void> {
    if (!fence) return
    const current = await this.readLease(runId)
    if (!current || Date.parse(current.expiresAt) <= Date.now() || !sameFence(current, fence)) {
      throw new Error('MultiAgentRun update rejected by stale lease fence')
    }
  }
}

export class FileMailboxStore implements MailboxStore {
  constructor(readonly rootDir: string, private readonly options: { nowMs?: () => number } = {}) {}

  async enqueue(message: MailboxMessage): Promise<void> {
    const parsed = MailboxMessageSchema.parse(message)
    await withFileLock(this.messageLockPath(parsed), async () => {
      const existing = await this.readMessage(parsed).catch((error) => {
        if (isNoEntry(error)) return undefined
        throw error
      })
      await this.write(existing ? preserveMailboxProgress(existing, parsed) : parsed)
    })
  }

  async claimNext(agentId: string, options?: MailboxClaimOptions): Promise<MailboxMessage | undefined> {
    return withFileLock(this.claimLockPath(agentId), async () => {
      const now = this.nowMs()
      const all = await this.listAll()
      const queued = all
        .filter((message) => message.toAgentId === agentId && claimableMailboxMessage(message, now))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!queued) return undefined
      return withFileLock(this.messageLockPath(queued), async () => {
        const current = await this.readMessage(queued)
        if (current.toAgentId !== agentId || !claimableMailboxMessage(current, now)) return undefined
        const claimLease = options ? nextClaimLease(current, options, now) : undefined
        const delivered = MailboxMessageSchema.parse({
          ...current,
          status: 'delivered',
          ...(claimLease ? { claimLease } : {}),
          updatedAt: new Date(now).toISOString()
        })
        await this.write(delivered)
        return delivered
      })
    })
  }

  async complete(messageId: string, status: 'completed' | 'failed' | 'aborted' = 'completed', fence?: MailboxMessage['claimLease']): Promise<void> {
    safeSegment(messageId, 'messageId')
    const all = await this.listAll()
    const current = all.find((message) => message.messageId === messageId)
    if (!current) return
    await withFileLock(this.messageLockPath(current), async () => {
      const latest = await this.readMessage(current).catch((error) => {
        if (isNoEntry(error)) return undefined
        throw error
      })
      if (!latest) return
      if (latest.status === status) return
      assertMailboxFence(latest, fence)
      const { claimLease: _claimLease, ...rest } = latest
      await this.write(MailboxMessageSchema.parse({ ...rest, status, updatedAt: new Date(this.nowMs()).toISOString() }))
    })
  }

  async listForRun(runId: string): Promise<MailboxMessage[]> {
    return (await this.listAll())
      .filter((message) => message.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  private async write(message: MailboxMessage): Promise<void> {
    const runId = safeSegment(message.runId, 'runId')
    const messageId = safeSegment(message.messageId, 'messageId')
    const dir = join(this.rootDir, 'mailbox', runId)
    await atomicWriteFile(join(dir, `${messageId}.json`), JSON.stringify(message, null, 2))
  }

  private async readMessage(message: MailboxMessage): Promise<MailboxMessage> {
    const runId = safeSegment(message.runId, 'runId')
    const messageId = safeSegment(message.messageId, 'messageId')
    return readMessageFile(join(this.rootDir, 'mailbox', runId, `${messageId}.json`))
  }

  private messageLockPath(message: MailboxMessage): string {
    const runId = safeSegment(message.runId, 'runId')
    const messageId = safeSegment(message.messageId, 'messageId')
    return join(this.rootDir, 'mailbox-message-locks', runId, `${messageId}.json`)
  }

  private async listAll(): Promise<MailboxMessage[]> {
    const mailboxRoot = join(this.rootDir, 'mailbox')
    const runDirs = await readDirIfExists(mailboxRoot)
    const all: MailboxMessage[] = []
    for (const runId of runDirs) {
      const safeRunId = safeSegment(runId, 'runId')
      const entries = await readDirIfExists(join(mailboxRoot, safeRunId))
      const messages = await Promise.all(entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readMessageFile(join(mailboxRoot, safeRunId, safeSegment(entry, 'message file')))))
      all.push(...messages)
    }
    return all
  }

  private claimLockPath(agentId: string): string {
    const digest = createHash('sha256').update(agentId).digest('hex')
    return join(this.rootDir, 'mailbox-claims', `${digest}.json`)
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

function workerRecordWithComputedStatus(record: EventedV2WorkerRecord, now: number): EventedV2WorkerRecord {
  return EventedV2WorkerRecordSchema.parse({
    ...record,
    status: Date.parse(record.expiresAt) <= now ? 'expired' : 'online'
  })
}

function nextClaimLease(message: MailboxMessage, options: MailboxClaimOptions, now: number): NonNullable<MailboxMessage['claimLease']> {
  return {
    holderId: options.holderId,
    expiresAt: new Date(now + Math.max(1, Math.floor(options.ttlMs))).toISOString(),
    epoch: (message.claimLease?.epoch ?? 0) + 1,
    token: randomUUID()
  }
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

function leaseFence(lease: RunLease): LeaseFence {
  return { holderId: lease.holderId, epoch: lease.epoch, token: lease.token }
}

function sameFence(lease: RunLease, fence: LeaseFence): boolean {
  return lease.holderId === fence.holderId && lease.epoch === fence.epoch && lease.token === fence.token
}
