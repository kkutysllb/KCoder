import type { ImmutablePrefix } from '@qiongqi/cache'
import type { RunIdentity, TaskStateV1, TurnItem } from '@qiongqi/contracts'
import type { SessionStore, TaskStatePreparedRevision, TaskStateStore } from '@qiongqi/ports'
import { ContextCompactor, type CompactionMode } from './context-compactor.js'
import { renderTaskStateProjection } from './task-context-projection.js'

export type CompactionTransactionEvent = {
  phase: 'prepared'
  identity: RunIdentity
  taskRevision: number
  itemId: string
}

export type CompactionTransactionOptions = {
  taskStates: TaskStateStore
  sessionStore: SessionStore
  compactor: ContextCompactor
  nowIso: () => string
  recordEvent?: (event: CompactionTransactionEvent) => Promise<void>
}

export type CompactionTransactionInput = {
  identity: RunIdentity
  taskState: TaskStateV1
  history: TurnItem[]
  prefix: ImmutablePrefix
  budgetTokens?: number
  keepRecent?: number
  mode?: CompactionMode
  reason?: string
  frozenMessageCount?: number
  summarize?: (heuristicSummary: string) => Promise<string | undefined>
}

export type CompactionTransactionResult = {
  next: TurnItem[]
  summaryItem: Extract<TurnItem, { kind: 'compaction' }>
  replacedTokens: number
  taskState: TaskStateV1
}

export class CompactionTransaction {
  constructor(private readonly options: CompactionTransactionOptions) {}

  async compact(input: CompactionTransactionInput): Promise<CompactionTransactionResult> {
    assertIdentity(input.identity, input.taskState)
    assertHistoryScope(input.identity, input.history)
    const active = await this.options.taskStates.load(input.identity)
    if (!active || active.revision !== input.taskState.revision) {
      throw new Error(
        `task revision conflict before compaction: expected ${input.taskState.revision}, found ${active?.revision ?? 0}`
      )
    }

    const base = this.options.compactor.compact(compactorInput(input))
    if (base.summaryItem.kind !== 'compaction') {
      throw new Error('compactor returned a non-compaction item')
    }
    if (base.replacedTokens === 0) {
      return {
        next: base.next,
        summaryItem: base.summaryItem,
        replacedTokens: 0,
        taskState: input.taskState
      }
    }

    const modelSummary = input.summarize
      ? await input.summarize(base.summaryItem.summary)
      : base.summaryItem.summary
    const projectedTask: TaskStateV1 = {
      ...input.taskState,
      revision: input.taskState.revision + 1,
      updatedAt: this.options.nowIso()
    }
    const summaryOverride = `${(modelSummary ?? base.summaryItem.summary).trim()}\n\n${renderTaskStateProjection(projectedTask)}`
    const compacted = this.options.compactor.compact({
      ...compactorInput(input),
      summaryOverride
    })
    if (compacted.summaryItem.kind !== 'compaction' || !compacted.summaryItem.sourceDigest) {
      throw new Error('compaction source digest unavailable')
    }
    const sourceDigest = compacted.summaryItem.sourceDigest
    const sourceItemIds = compacted.summaryItem.sourceItemIds ?? []
    if (sourceItemIds.length === 0) throw new Error('compaction source items unavailable')

    const summaryItem: Extract<TurnItem, { kind: 'compaction' }> = {
      ...compacted.summaryItem,
      taskRevision: projectedTask.revision,
      taskSourceDigest: projectedTask.source.sourceDigest
    }
    const taskState: TaskStateV1 = {
      ...projectedTask,
      compaction: {
        itemId: summaryItem.id,
        taskRevision: projectedTask.revision,
        sourceDigest,
        sourceItemIds,
        replacedTokens: compacted.replacedTokens
      }
    }
    const next = compacted.next.map((item) =>
      item.id === summaryItem.id ? summaryItem : item
    )

    const originalItems = await this.options.sessionStore.loadItems(input.identity.threadId)
    let prepared: TaskStatePreparedRevision | undefined
    let appended = false
    try {
      prepared = await this.options.taskStates.prepare(taskState, input.taskState.revision)
      await this.options.recordEvent?.({
        phase: 'prepared',
        identity: input.identity,
        taskRevision: taskState.revision,
        itemId: summaryItem.id
      })
      await this.options.sessionStore.appendItem(input.identity.threadId, summaryItem)
      appended = true
      await this.options.taskStates.commit(prepared)
    } catch (error) {
      if (appended) {
        await this.options.sessionStore.rewriteItems(input.identity.threadId, originalItems)
      }
      if (prepared) await this.options.taskStates.abort(prepared).catch(() => undefined)
      throw error
    }

    return {
      next,
      summaryItem,
      replacedTokens: compacted.replacedTokens,
      taskState
    }
  }
}

function compactorInput(input: CompactionTransactionInput) {
  return {
    threadId: input.identity.threadId,
    turnId: input.identity.turnId,
    history: input.history,
    prefix: input.prefix,
    ...(input.budgetTokens !== undefined ? { budgetTokens: input.budgetTokens } : {}),
    ...(input.keepRecent !== undefined ? { keepRecent: input.keepRecent } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.frozenMessageCount !== undefined
      ? { frozenMessageCount: input.frozenMessageCount }
      : {})
  }
}

function assertIdentity(identity: RunIdentity, task: TaskStateV1): void {
  for (const field of identityFields) {
    if (identity[field] !== task.identity[field]) {
      throw new Error(`compaction task identity mismatch: ${field}`)
    }
  }
}

function assertHistoryScope(identity: RunIdentity, history: readonly TurnItem[]): void {
  if (history.some((item) => item.threadId !== identity.threadId)) {
    throw new Error('compaction history scope mismatch')
  }
}

const identityFields = [
  'ownerUserId',
  'workspaceKey',
  'threadId',
  'turnId',
  'runId'
] as const
