import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryCapabilityConfig } from '@qiongqi/contracts'
import { atomicWriteFile } from '@qiongqi/adapter-storage'
import {
  MemoryDiagnostics,
  MemoryRecord,
  type MemoryCreateRequest,
  type MemoryUpdateRequest
} from '@qiongqi/contracts'
import { rankMemoryRecords } from './retrieval.js'

export interface MemoryStore {
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord>
  delete(id: string): Promise<MemoryRecord>
  list(filter?: { workspace?: string; includeDeleted?: boolean; ownerUserId?: string }): Promise<MemoryRecord[]>
  retrieve(input: { query: string; workspace?: string; threadId?: string; limit: number; ownerUserId?: string }): Promise<MemoryRecord[]>
  diagnostics(): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void
}

export class FileMemoryStore implements MemoryStore {
  private lastInjectedIds: string[] = []

  constructor(
    private readonly options: {
      rootDir: string
      config: MemoryCapabilityConfig
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {}

  async create(input: MemoryCreateRequest): Promise<MemoryRecord> {
    await mkdir(this.options.rootDir, { recursive: true })
    const now = this.now()
    const parsed = MemoryRecord.parse({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ownerUserId: input.ownerUserId,
      content: input.content,
      scope: input.scope ?? 'workspace',
      workspace: input.workspace,
      project: input.project,
      sourceThreadId: input.sourceThreadId,
      sourceTurnId: input.sourceTurnId,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 1,
      createdAt: now,
      updatedAt: now
    })
    await this.write(parsed)
    return parsed
  }

  async update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord> {
    const current = await this.mustGet(id)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(patch.disabled === true ? { disabledAt: current.disabledAt ?? now } : {}),
      ...(patch.disabled === false ? { disabledAt: undefined } : {}),
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async delete(id: string): Promise<MemoryRecord> {
    const current = await this.mustGet(id)
    const now = this.now()
    const next = MemoryRecord.parse({
      ...current,
      deletedAt: current.deletedAt ?? now,
      updatedAt: now
    })
    await this.write(next)
    return next
  }

  async list(filter: { workspace?: string; includeDeleted?: boolean; ownerUserId?: string } = {}): Promise<MemoryRecord[]> {
    const records = await this.readAll()
    return records
      .filter((record) => !filter.ownerUserId || record.ownerUserId === filter.ownerUserId)
      .filter((record) => filter.includeDeleted || !record.deletedAt)
      .filter((record) => inScope(record, filter.workspace))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async retrieve(input: { query: string; workspace?: string; threadId?: string; limit: number; ownerUserId?: string }): Promise<MemoryRecord[]> {
    if (!this.options.config.enabled) return []
    return rankMemoryRecords({
      query: input.query,
      records: (await this.readAll()).filter((record) => !input.ownerUserId || record.ownerUserId === input.ownerUserId),
      workspace: input.workspace,
      threadId: input.threadId,
      ownerUserId: input.ownerUserId,
      limit: input.limit
    })
  }

  async diagnostics(): Promise<MemoryDiagnostics> {
    const records = await this.readAll()
    return {
      enabled: this.options.config.enabled,
      rootDir: this.options.rootDir,
      activeCount: records.filter((record) => !record.deletedAt && !record.disabledAt).length,
      tombstoneCount: records.filter((record) => Boolean(record.deletedAt)).length,
      lastInjectedIds: [...this.lastInjectedIds]
    }
  }

  setLastInjected(ids: string[]): void {
    this.lastInjectedIds = [...ids]
  }

  private async mustGet(id: string): Promise<MemoryRecord> {
    const record = (await this.readAll()).find((candidate) => candidate.id === id)
    if (!record) throw new Error(`memory not found: ${id}`)
    return record
  }

  private async readAll(): Promise<MemoryRecord[]> {
    await mkdir(this.options.rootDir, { recursive: true })
    const entries = await readdir(this.options.rootDir).catch(() => [])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(this.options.rootDir, entry), 'utf8')
        .then((text) => MemoryRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records.filter((record): record is MemoryRecord => Boolean(record))
  }

  private write(record: MemoryRecord): Promise<void> {
    return atomicWriteFile(
      join(this.options.rootDir, `${record.id}.json`),
      JSON.stringify(record, null, 2)
    )
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function inScope(record: MemoryRecord, workspace: string | undefined): boolean {
  if (record.scope === 'user') return true
  if (record.scope === 'workspace') return Boolean(workspace && record.workspace === workspace)
  if (record.scope === 'project') return Boolean(workspace && record.workspace === workspace)
  return false
}
