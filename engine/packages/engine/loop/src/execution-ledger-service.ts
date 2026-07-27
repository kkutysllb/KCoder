import {
  ExecutionLedgerEntrySchema,
  type ExecutionLedgerEntry,
  type ImmutableProfileRef,
  type ModelExecutionLedgerEntry,
  type ModelPricing,
  type TaskScope,
  type UsageSnapshot,
  type ToolExecutionLedgerEntry
} from '@qiongqi/contracts'
import type { DurableEngineStore, ToolReplayDescriptor } from '@qiongqi/ports'

export interface ExecutionLedgerServiceOptions {
  store: DurableEngineStore
  nowIso?: () => string
}

export interface PrepareToolLedgerInput {
  scope: TaskScope
  runId: string
  kernelRunId: string
  operationId: string
  taskRevision: number
  descriptor: ToolReplayDescriptor
  noProgressCount?: number
}

export type ToolLedgerPreparation =
  | { action: 'execute'; entry: ToolExecutionLedgerEntry }
  | { action: 'replay'; entry: ToolExecutionLedgerEntry; previous: ToolExecutionLedgerEntry }
  | { action: 'suppress'; entry: ToolExecutionLedgerEntry; previous: ToolExecutionLedgerEntry }
  | { action: 'verify'; entry: ToolExecutionLedgerEntry; previous: ToolExecutionLedgerEntry }

export interface PrepareModelLedgerInput {
  scope: TaskScope
  runId: string
  kernelRunId: string
  operationId: string
  logicalRequestKey: string
  requestFingerprint: string
  taskRevision: number
  contextRevision: number
  strategyRevision: number
  strategyDigest: string
  profileRef: ImmutableProfileRef
  capabilities?: string[]
  pricing?: ModelPricing
  routeReason?: string
}

export type ModelLedgerPreparation =
  | { action: 'execute'; entry: ModelExecutionLedgerEntry }
  | { action: 'replay'; entry: ModelExecutionLedgerEntry; previous: ModelExecutionLedgerEntry }
  | { action: 'resolution-required'; previous: ModelExecutionLedgerEntry; reason: string }

export class ExecutionLedgerService {
  private readonly nowIso: () => string
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: ExecutionLedgerServiceOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async prepareModel(input: PrepareModelLedgerInput): Promise<ModelLedgerPreparation> {
    return this.exclusive(async () => {
      const previous = newestModelEntry(await this.options.store.findLedger({
        scope: input.scope,
        kind: 'model',
        logicalRequestKey: input.logicalRequestKey
      }))

      if (previous && ['completed', 'replayed'].includes(previous.status)) {
        if (previous.requestFingerprint !== input.requestFingerprint) {
          return {
            action: 'resolution-required',
            previous,
            reason: 'logical request key resolved to a different physical request fingerprint'
          }
        }
        if (!previous.resultRef) {
          return {
            action: 'resolution-required',
            previous,
            reason: 'completed model attempt has no durable result reference'
          }
        }
        const entry = this.modelEntry(input, 'replayed', previous.resultRef, previous.usage)
        await this.appendModel(input, entry)
        return { action: 'replay', entry, previous }
      }

      if (previous && ['prepared', 'running', 'uncertain'].includes(previous.status)) {
        return {
          action: 'resolution-required',
          previous,
          reason: `model attempt ${previous.operationId} is ${previous.status}`
        }
      }

      const entry = this.modelEntry(input, 'prepared')
      await this.appendModel(input, entry)
      return { action: 'execute', entry }
    })
  }

  async markModelRunning(input: {
    runId: string
    entry: ModelExecutionLedgerEntry
  }): Promise<ModelExecutionLedgerEntry> {
    return this.updateModel(input.runId, input.entry, 'running')
  }

  async completeModel(input: {
    runId: string
    entry: ModelExecutionLedgerEntry
    resultRef: string
    usage?: UsageSnapshot
  }): Promise<ModelExecutionLedgerEntry> {
    return this.updateModel(input.runId, input.entry, 'completed', input.resultRef, input.usage)
  }

  async markModelUncertain(input: {
    runId: string
    entry: ModelExecutionLedgerEntry
  }): Promise<ModelExecutionLedgerEntry> {
    return this.updateModel(input.runId, input.entry, 'uncertain')
  }

  async prepareTool(input: PrepareToolLedgerInput): Promise<ToolLedgerPreparation> {
    return this.exclusive(async () => {
      const exact = newestReplayable(await this.options.store.findLedger({
        scope: input.scope,
        kind: 'tool',
        exactFingerprint: input.descriptor.exactFingerprint
      }))
      const semantic = exact ?? newestReplayable(await this.options.store.findLedger({
        scope: input.scope,
        kind: 'tool',
        semanticKey: input.descriptor.semanticKey
      }))
      const previous = exact ?? semantic

      if (previous?.resultRef) {
        if (input.descriptor.effectPolicy === 'safe'
          && recordsEqual(previous.preconditionVersions, input.descriptor.preconditionVersions)) {
          const status = exact ? 'replayed' as const : 'suppressed' as const
          const entry = this.entry(input, status, previous.resultRef, previous.observedPostconditions)
          await this.append(input, entry)
          return { action: exact ? 'replay' : 'suppress', entry, previous }
        }
        if (input.descriptor.effectPolicy === 'idempotent-with-key' && exact) {
          const entry = this.entry(input, 'replayed', previous.resultRef, previous.observedPostconditions)
          await this.append(input, entry)
          return { action: 'replay', entry, previous }
        }
        if (input.descriptor.effectPolicy === 'verify-before-replay') {
          const entry = this.entry(input, 'prepared')
          await this.append(input, entry)
          return { action: 'verify', entry, previous }
        }
      }

      const entry = this.entry(input, 'prepared')
      await this.append(input, entry)
      return { action: 'execute', entry }
    })
  }

  async completeTool(input: {
    runId: string
    entry: ToolExecutionLedgerEntry
    resultRef: string
    observedPostconditions: Record<string, string>
  }): Promise<ToolExecutionLedgerEntry> {
    const completed = ExecutionLedgerEntrySchema.parse({
      ...input.entry,
      status: 'completed',
      resultRef: input.resultRef,
      observedPostconditions: input.observedPostconditions,
      updatedAt: this.nowIso()
    }) as ToolExecutionLedgerEntry
    await this.put(input.runId, completed)
    return completed
  }

  async suppressVerified(input: {
    runId: string
    entry: ToolExecutionLedgerEntry
    previous: ToolExecutionLedgerEntry
    observedPostconditions: Record<string, string>
  }): Promise<ToolExecutionLedgerEntry> {
    if (!input.previous.resultRef) throw new Error('verified replay has no prior resultRef')
    const suppressed = ExecutionLedgerEntrySchema.parse({
      ...input.entry,
      status: 'suppressed',
      resultRef: input.previous.resultRef,
      replayValidity: 'valid',
      observedPostconditions: input.observedPostconditions,
      updatedAt: this.nowIso()
    }) as ToolExecutionLedgerEntry
    await this.put(input.runId, suppressed)
    return suppressed
  }

  private entry(
    input: PrepareToolLedgerInput,
    status: ToolExecutionLedgerEntry['status'],
    resultRef?: string,
    observedPostconditions: Record<string, string> = {}
  ): ToolExecutionLedgerEntry {
    const now = this.nowIso()
    return ExecutionLedgerEntrySchema.parse({
      kind: 'tool',
      operationId: input.operationId,
      scope: input.scope,
      kernelRunId: input.kernelRunId,
      exactFingerprint: input.descriptor.exactFingerprint,
      semanticKey: input.descriptor.semanticKey,
      preconditionVersions: input.descriptor.preconditionVersions,
      observedPostconditions,
      effectPolicy: input.descriptor.effectPolicy,
      replayValidity: status === 'replayed' || status === 'suppressed' ? 'valid' : 'unknown',
      status,
      ...(resultRef ? { resultRef } : {}),
      noProgressCount: input.noProgressCount ?? 0,
      createdAt: now,
      updatedAt: now
    }) as ToolExecutionLedgerEntry
  }

  private modelEntry(
    input: PrepareModelLedgerInput,
    status: ModelExecutionLedgerEntry['status'],
    resultRef?: string,
    usage?: UsageSnapshot
  ): ModelExecutionLedgerEntry {
    const now = this.nowIso()
    return ExecutionLedgerEntrySchema.parse({
      kind: 'model',
      operationId: input.operationId,
      scope: input.scope,
      kernelRunId: input.kernelRunId,
      logicalRequestKey: input.logicalRequestKey,
      requestFingerprint: input.requestFingerprint,
      taskRevision: input.taskRevision,
      contextRevision: input.contextRevision,
      strategyRevision: input.strategyRevision,
      strategyDigest: input.strategyDigest,
      profileRef: input.profileRef,
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      ...(input.pricing ? { pricing: input.pricing } : {}),
      ...(input.routeReason ? { routeReason: input.routeReason } : {}),
      status,
      ...(resultRef ? { resultRef } : {}),
      ...(usage ? { usage } : {}),
      createdAt: now,
      updatedAt: now
    }) as ModelExecutionLedgerEntry
  }

  private async updateModel(
    runId: string,
    entry: ModelExecutionLedgerEntry,
    status: ModelExecutionLedgerEntry['status'],
    resultRef?: string,
    usage?: UsageSnapshot
  ): Promise<ModelExecutionLedgerEntry> {
    const updated = ExecutionLedgerEntrySchema.parse({
      ...entry,
      status,
      ...(resultRef ? { resultRef } : {}),
      ...(usage ? { usage } : {}),
      updatedAt: this.nowIso()
    }) as ModelExecutionLedgerEntry
    await this.put(runId, updated)
    return updated
  }

  private async appendModel(input: PrepareModelLedgerInput, entry: ModelExecutionLedgerEntry): Promise<void> {
    const versions = await this.versions(input.scope, input.runId)
    await this.options.store.commit({
      scope: input.scope,
      runId: input.runId,
      ...versions,
      ledgerMutations: [{ type: 'append', record: entry }]
    })
  }

  private async append(input: PrepareToolLedgerInput, entry: ToolExecutionLedgerEntry): Promise<void> {
    const versions = await this.versions(input.scope, input.runId)
    await this.options.store.commit({
      scope: input.scope,
      runId: input.runId,
      ...versions,
      ledgerMutations: [{ type: 'append', record: entry }]
    })
  }

  private async put(runId: string, entry: ExecutionLedgerEntry): Promise<void> {
    const versions = await this.versions(entry.scope, runId)
    await this.options.store.commit({
      scope: entry.scope,
      runId,
      ...versions,
      ledgerMutations: [{ type: 'put', record: entry }]
    })
  }

  private async versions(scope: TaskScope, runId: string) {
    const [run, task] = await Promise.all([
      this.options.store.loadRun(runId),
      this.options.store.loadTask(scope)
    ])
    return {
      expectedRunVersion: run?.version ?? 0,
      expectedTaskRevision: task?.revision ?? 0
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function newestReplayable(entries: readonly import('@qiongqi/contracts').ExecutionLedgerEntry[]): ToolExecutionLedgerEntry | undefined {
  return [...entries]
    .filter((entry): entry is ToolExecutionLedgerEntry => entry.kind === 'tool'
      && ['completed', 'replayed', 'suppressed'].includes(entry.status)
      && Boolean(entry.resultRef))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function newestModelEntry(entries: readonly import('@qiongqi/contracts').ExecutionLedgerEntry[]): ModelExecutionLedgerEntry | undefined {
  return [...entries]
    .filter((entry): entry is ModelExecutionLedgerEntry => entry.kind === 'model')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

function recordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}
