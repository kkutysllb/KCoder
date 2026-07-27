import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryCapabilityConfig } from '@qiongqi/contracts'
import { atomicWriteFile } from '@qiongqi/adapter-storage'
import {
  MemoryDiagnostics,
  MemoryCreateRequest as MemoryCreateRequestSchema,
  TaskSharedMemoryCreateRequestSchema,
  MemoryListQuerySchema,
  MemoryQuerySchema,
  MemoryRecord,
  type AgentPrivateMemoryCreateRequest,
  type LegacyMemoryCreateRequest,
  type MemoryListQuery,
  type MemoryQuery,
  type TaskSharedMemoryCreateRequest,
  type MemoryUpdateRequest
} from '@qiongqi/contracts'
import { rankMemoryRecords } from './retrieval.js'

export interface MemoryStore {
  create(input: LegacyMemoryCreateRequest | AgentPrivateMemoryCreateRequest): Promise<MemoryRecord>
  publishTaskShared(input: TaskSharedMemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord>
  delete(id: string): Promise<MemoryRecord>
  list(filter?: MemoryListInput): Promise<MemoryRecord[]>
  retrieve(input: MemoryQueryInput): Promise<MemoryRecord[]>
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

  async create(input: LegacyMemoryCreateRequest | AgentPrivateMemoryCreateRequest): Promise<MemoryRecord> {
    const request = MemoryCreateRequestSchema.parse(input)
    if (request.scope === 'task_shared') {
      throw new Error('task_shared records must be created through publishTaskMemory')
    }
    return this.createRecord(request)
  }

  async publishTaskShared(input: TaskSharedMemoryCreateRequest): Promise<MemoryRecord> {
    return this.createRecord(TaskSharedMemoryCreateRequestSchema.parse(input))
  }

  private async createRecord(input: unknown): Promise<MemoryRecord> {
    await mkdir(this.options.rootDir, { recursive: true })
    const now = this.now()
    const request = MemoryCreateRequestSchema.parse(input)
    const parsed = MemoryRecord.parse({
      id: this.options.idGenerator?.() ?? `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ...request,
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

  async list(filter: MemoryListInput = {}): Promise<MemoryRecord[]> {
    const query = normalizeListQuery(filter)
    const records = await this.readAll()
    return records
      .filter((record) => query.includeDeleted || !record.deletedAt)
      .filter((record) => inListScope(record, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async retrieve(input: MemoryQueryInput): Promise<MemoryRecord[]> {
    if (!this.options.config.enabled) return []
    const query = normalizeMemoryQuery(input)
    return rankMemoryRecords({
      memoryQuery: query,
      records: await this.readAll()
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

export type LegacyMemoryQueryInput = {
  query: string
  workspace?: string
  threadId?: string
  limit: number
  ownerUserId?: string
}

export type LegacyMemoryListInput = {
  workspace?: string
  includeDeleted?: boolean
  ownerUserId?: string
}

export type MemoryQueryInput = MemoryQuery | LegacyMemoryQueryInput
export type MemoryListInput = MemoryListQuery | LegacyMemoryListInput

function normalizeMemoryQuery(input: MemoryQueryInput): MemoryQuery {
  return MemoryQuerySchema.parse('namespace' in input ? input : { namespace: 'legacy', ...input })
}

function normalizeListQuery(input: MemoryListInput): MemoryListQuery {
  return MemoryListQuerySchema.parse('namespace' in input ? input : { namespace: 'legacy', ...input })
}

function inListScope(record: MemoryRecord, query: MemoryListQuery): boolean {
  if (query.namespace === 'task_shared') {
    return record.scope === 'task_shared' && sameTaskScope(record.taskScope, query.taskScope)
  }
  if (query.namespace === 'agent_private') {
    return record.scope === 'agent_private'
      && sameTaskScope(record.taskScope, query.taskScope)
      && record.agentId === query.agentId
      && record.agentRunId === query.agentRunId
  }
  if (record.scope === 'task_shared' || record.scope === 'agent_private') return false
  if (query.ownerUserId && record.ownerUserId !== query.ownerUserId) return false
  if (record.scope === 'user') return true
  return Boolean(query.workspace && record.workspace === query.workspace)
}

function sameTaskScope(
  left: { ownerId: string; workspaceId: string; taskId: string },
  right: { ownerId: string; workspaceId: string; taskId: string }
): boolean {
  return left.ownerId === right.ownerId
    && left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
}
