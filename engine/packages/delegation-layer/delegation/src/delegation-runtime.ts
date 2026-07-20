import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SubagentsCapabilityConfig, AgentCard } from '@qiongqi/contracts'
import { AgentCardSchema } from '@qiongqi/contracts'
import type { RuntimeEventRecorder } from '@qiongqi/services'
import type { UsageSnapshot } from '@qiongqi/contracts'
import type { PeerRegistry } from './peer-registry.js'

const ChildRunUsage = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cacheHitTokens: z.number().int().nonnegative().optional(),
  cacheMissTokens: z.number().int().nonnegative().optional(),
  cacheHitRate: z.number().min(0).max(1).nullable().optional(),
  turns: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().optional(),
  cacheSavingsUsd: z.number().nonnegative().optional(),
  cacheSavingsCny: z.number().nonnegative().optional(),
  tokenEconomySavingsTokens: z.number().int().nonnegative().optional(),
  tokenEconomySavingsUsd: z.number().nonnegative().optional(),
  tokenEconomySavingsCny: z.number().nonnegative().optional()
})

export const ChildRunRecord = z.object({
  id: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1),
  label: z.string().optional(),
  prompt: z.string().min(1),
  workspace: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
  summary: z.string().optional(),
  error: z.string().optional(),
  usage: ChildRunUsage.default({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ChildRunRecord = z.infer<typeof ChildRunRecord>

export type ChildRunExecutor = (input: {
  childId: string
  parentThreadId: string
  parentTurnId: string
  label?: string
  prompt: string
  workspace?: string
  model?: string
  signal: AbortSignal
}) => Promise<{ summary: string; usage?: ChildRunRecord['usage'] }>

export type ChildRunAggregate = {
  key: string
  label?: string
  model?: string
  runs: number
  completed: number
  failed: number
  aborted: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  costCny?: number
  averageTotalTokens: number
  averageCostUsd?: number
  averageCostCny?: number
}

export class FileDelegationStore {
  constructor(private readonly rootDir: string) {}

  private childRunDir(parentThreadId: string): string {
    return join(this.rootDir, parentThreadId, 'child-runs')
  }

  async upsert(record: ChildRunRecord): Promise<void> {
    const dir = this.childRunDir(record.parentThreadId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8')
  }

  async list(parentThreadId?: string): Promise<ChildRunRecord[]> {
    if (!parentThreadId) {
      // List all threads: scan top-level thread directories
      const threadDirs = await readdir(this.rootDir).catch(() => [])
      const all: ChildRunRecord[] = []
      for (const dir of threadDirs) {
        const records = await this.listForDir(dir)
        all.push(...records)
      }
      return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return this.listForDir(parentThreadId)
  }

  private async listForDir(threadId: string): Promise<ChildRunRecord[]> {
    const dir = this.childRunDir(threadId)
    const entries = await readdir(dir).catch(() => [] as string[])
    const records = await Promise.all(entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readFile(join(dir, entry), 'utf8')
        .then((text) => ChildRunRecord.parse(JSON.parse(text)))
        .catch(() => null)))
    return records
      .filter((record): record is ChildRunRecord => Boolean(record))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async deleteByThread(threadId: string): Promise<void> {
    await rm(this.childRunDir(threadId), { recursive: true, force: true })
  }
}

export class DelegationRuntime {
  private active = 0
  private childSeq = 0

  constructor(private readonly options: {
    config: SubagentsCapabilityConfig
    store: FileDelegationStore
    events?: RuntimeEventRecorder
    nowIso?: () => string
    idGenerator?: () => string
    executor?: ChildRunExecutor
    recordExternalUsage?: (threadId: string, usage: UsageSnapshot) => void
    /**
     * Stage 2: optional PeerRegistry. When supplied, every child run is
     * also registered as a local peer so it becomes addressable via
     * `invokePeer(childCardId, task)`. When omitted, behaviour is
     * unchanged from Stage 1 (pure in-process executor).
     */
    peerRegistry?: PeerRegistry
    /**
     * Stage 2: directory where child agent cards are persisted. When
     * `peerRegistry` is supplied, each child gets a card at
     * `<agentsDir>/<childId>/card.json`. Defaults to `<storeDir>/agents`.
     */
    agentsDir?: string
  }) {}

  async runChild(input: {
    parentThreadId: string
    parentTurnId: string
    label?: string
    prompt: string
    workspace?: string
    model?: string
    signal: AbortSignal
  }): Promise<ChildRunRecord> {
    if (!this.options.config.enabled) throw new Error('delegation is disabled by config')
    if (this.active >= this.options.config.maxParallel) throw new Error('delegation parallel budget exhausted')
    const existing = await this.options.store.list(input.parentThreadId)
    if (existing.length >= this.options.config.maxChildRuns) throw new Error('delegation child-run budget exhausted')
    const now = this.now()
    const id = this.options.idGenerator?.() ?? `child_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    let record = ChildRunRecord.parse({
      id,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      label: input.label,
      prompt: input.prompt,
      workspace: input.workspace,
      model: input.model,
      status: 'running',
      createdAt: now,
      updatedAt: now
    })
    await this.options.store.upsert(record)
    await this.recordChildEvent(record)
    this.active += 1

    try {
      // Stage 2: when a PeerRegistry is available, register the child
      // as a local peer and dispatch through invokePeer so the child
      // becomes addressable for cross-instance A2A calls.
      if (this.options.peerRegistry) {
        const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
        const cardId = `qiongqi:child:${id}`
        await this.publishChildCard(record, executor)
        const artifact = await this.options.peerRegistry.invokePeer(cardId, {
          prompt: input.prompt,
          ...(input.workspace ? { workspace: input.workspace } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.label ? { label: input.label } : {})
        }, input.signal)
        record = ChildRunRecord.parse({
          ...record,
          status: mapPeerStatus(artifact.status),
          ...(artifact.summary ? { summary: artifact.summary } : {}),
          ...(artifact.error ? { error: artifact.error } : {}),
          updatedAt: this.now()
        })
        await this.options.store.upsert(record)
        await this.recordChildEvent(record)
        return record
      }

      // Legacy path (no PeerRegistry): invoke the executor directly.
      const executor: ChildRunExecutor = this.options.executor ?? defaultExecutor
      const result = await executor({
        childId: id,
        parentThreadId: input.parentThreadId,
        parentTurnId: input.parentTurnId,
        ...(input.label ? { label: input.label } : {}),
        prompt: input.prompt,
        workspace: input.workspace,
        model: input.model,
        signal: input.signal
      })
      record = ChildRunRecord.parse({
        ...record,
        status: 'completed',
        summary: result.summary,
        usage: result.usage ?? record.usage,
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      this.recordExternalUsage(record)
      return record
    } catch (error) {
      record = ChildRunRecord.parse({
        ...record,
        status: input.signal.aborted ? 'aborted' : 'failed',
        error: errorMessage(error),
        updatedAt: this.now()
      })
      await this.options.store.upsert(record)
      await this.recordChildEvent(record)
      return record
    } finally {
      this.active -= 1
    }
  }

  /**
   * Stage 2: persist a minimal AgentCard for a child agent and register
   * it as a local peer. The card uses a synthetic URL (children are
   * in-process) but carries the child's label/model so discovery UIs
   * can render it.
   */
  private async publishChildCard(record: ChildRunRecord, executor: ChildRunExecutor): Promise<void> {
    const registry = this.options.peerRegistry
    if (!registry) return
    const cardId = `qiongqi:child:${record.id}`
    const agentsDir = this.options.agentsDir ?? join(this.storeDir(), 'agents')
    const cardDir = join(agentsDir, record.id)
    const card: AgentCard = AgentCardSchema.parse({
      id: cardId,
      // Children are in-process; use a synthetic URL. The A2A endpoint
      // is the parent's, so this URL is informational only.
      url: 'qiongqi://child/' + encodeURIComponent(record.id),
      name: record.label ?? `Child ${record.id}`,
      version: '0.1.0',
      skills: [],
      capabilities: {
        contractVersion: 1,
        model: {
          id: record.model ?? 'child',
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        },
        cli: {
          serve: { status: 'unavailable', enabled: false, available: false, reason: 'child agent' },
          run: { status: 'available', enabled: true, available: true },
          chat: { status: 'unavailable', enabled: false, available: false, reason: 'child agent' },
          exec: { status: 'unavailable', enabled: false, available: false, reason: 'child agent' }
        },
        mcp: { status: 'disabled', enabled: false, available: false, reason: 'child agent', configuredServers: 0, connectedServers: 0, toolCount: 0, search: { enabled: false, mode: 'auto', active: false, indexedToolCount: 0, advertisedToolCount: 0 } },
        web: { status: 'disabled', enabled: false, available: false, reason: 'child agent', fetch: { status: 'disabled', enabled: false, available: false, reason: 'child agent' }, search: { status: 'disabled', enabled: false, available: false, reason: 'child agent' } },
        skills: { status: 'disabled', enabled: false, available: false, reason: 'child agent', configuredRoots: 0, discoveredSkills: 0 },
        subagents: { status: 'disabled', enabled: false, available: false, reason: 'child agent', maxParallel: 0, maxChildRuns: 0 },
        attachments: { status: 'disabled', enabled: false, available: false, reason: 'child agent', maxImageBytes: 0, maxImageDimension: 0, allowedMimeTypes: [], textFallbackMaxBase64Bytes: 0, textFallbackMaxImageDimension: 0, textFallbackPreferredMimeType: 'image/webp' },
        memory: { status: 'disabled', enabled: false, available: false, reason: 'child agent', scopes: [], maxInjectedRecords: 0 }
      },
      model: {
        provider: 'qiongqi-child',
        defaultModel: record.model ?? 'default',
        endpointFormats: ['chat_completions']
      }
    })
    await mkdir(cardDir, { recursive: true })
    await writeFile(join(cardDir, 'card.json'), JSON.stringify(card, null, 2), 'utf8')
    // Register a local handle that re-invokes the executor. The handle
    // is intentionally minimal — full task routing will land in a later
    // stage when children get their own runtime loop.
    await registry.registerLocal({
      card,
      invoke: async (task, signal) => {
        const result = await executor({
          childId: record.id,
          parentThreadId: record.parentThreadId,
          parentTurnId: record.parentTurnId,
          label: record.label,
          prompt: task.prompt,
          workspace: task.workspace,
          model: task.model,
          signal
        })
        return {
          peerCardId: cardId,
          status: 'completed',
          summary: result.summary
        }
      }
    })
  }

  private storeDir(): string {
    // FileDelegationStore stores at rootDir; access via a cast since the
    // field is private. This is acceptable inside the same package.
    const store = this.options.store as unknown as { rootDir: string }
    return store.rootDir
  }

  async diagnostics(parentThreadId?: string): Promise<{
    enabled: boolean
    active: number
    childRuns: ChildRunRecord[]
    aggregates: ChildRunAggregate[]
  }> {
    const childRuns = await this.options.store.list(parentThreadId)
    return {
      enabled: this.options.config.enabled,
      active: this.active,
      childRuns,
      aggregates: aggregateChildRuns(childRuns)
    }
  }

  private async recordChildEvent(record: ChildRunRecord): Promise<void> {
    await this.options.events?.record({
      kind: record.status === 'completed' ? 'turn_completed' : record.status === 'failed' ? 'turn_failed' : record.status === 'aborted' ? 'turn_aborted' : 'turn_started',
      threadId: record.parentThreadId,
      turnId: record.parentTurnId,
      status: record.status,
      text: record.summary ?? record.error,
      child: {
        parentThreadId: record.parentThreadId,
        parentTurnId: record.parentTurnId,
        childId: record.id,
        childLabel: record.label,
        childStatus: record.status,
        childSeq: ++this.childSeq
      }
    })
  }

  private recordExternalUsage(record: ChildRunRecord): void {
    if (record.status !== 'completed') return
    const usage = toUsageSnapshot(record.usage)
    if (usage.totalTokens <= 0 && usage.costUsd === undefined && usage.costCny === undefined) return
    this.options.recordExternalUsage?.(record.parentThreadId, usage)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}

function toUsageSnapshot(usage: ChildRunRecord['usage']): UsageSnapshot {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedTokens: usage.cachedTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    cacheHitRate: usage.cacheHitRate ?? null,
    turns: usage.turns ?? 0,
    costUsd: usage.costUsd,
    costCny: usage.costCny,
    cacheSavingsUsd: usage.cacheSavingsUsd,
    cacheSavingsCny: usage.cacheSavingsCny,
    tokenEconomySavingsTokens: usage.tokenEconomySavingsTokens,
    tokenEconomySavingsUsd: usage.tokenEconomySavingsUsd,
    tokenEconomySavingsCny: usage.tokenEconomySavingsCny
  }
}

export function aggregateChildRuns(records: readonly ChildRunRecord[]): ChildRunAggregate[] {
  const buckets = new Map<string, ChildRunAggregate>()
  for (const record of records) {
    const label = record.label?.trim() || undefined
    const model = record.model?.trim() || undefined
    const key = `${label ?? 'unlabeled'}:${model ?? 'default'}`
    const bucket = buckets.get(key) ?? {
      key,
      ...(label ? { label } : {}),
      ...(model ? { model } : {}),
      runs: 0,
      completed: 0,
      failed: 0,
      aborted: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      averageTotalTokens: 0
    }
    bucket.runs += 1
    if (record.status === 'completed') bucket.completed += 1
    else if (record.status === 'failed') bucket.failed += 1
    else if (record.status === 'aborted') bucket.aborted += 1
    bucket.promptTokens += record.usage.promptTokens
    bucket.completionTokens += record.usage.completionTokens
    bucket.totalTokens += record.usage.totalTokens
    if (record.usage.costUsd !== undefined) bucket.costUsd = (bucket.costUsd ?? 0) + record.usage.costUsd
    if (record.usage.costCny !== undefined) bucket.costCny = (bucket.costCny ?? 0) + record.usage.costCny
    bucket.averageTotalTokens = bucket.runs > 0 ? bucket.totalTokens / bucket.runs : 0
    bucket.averageCostUsd = bucket.costUsd !== undefined && bucket.runs > 0 ? bucket.costUsd / bucket.runs : undefined
    bucket.averageCostCny = bucket.costCny !== undefined && bucket.runs > 0 ? bucket.costCny / bucket.runs : undefined
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) =>
    b.runs - a.runs ||
    b.totalTokens - a.totalTokens ||
    a.key.localeCompare(b.key)
  )
}

const defaultExecutor: ChildRunExecutor = async (input) => {
  return { summary: `Child result: ${input.prompt}` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Map PeerArtifact status to ChildRunRecord status. */
function mapPeerStatus(status: 'completed' | 'failed' | 'aborted'): ChildRunRecord['status'] {
  return status
}
