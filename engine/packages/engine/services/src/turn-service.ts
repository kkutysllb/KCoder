import { createHash } from 'node:crypto'
import {
  createTurnExecutionPolicySnapshot,
  GovernedTurnExecutionRequestSchema,
  GovernedTurnBindingSchema,
  type GovernedGraphRef,
  type OutputValidatorRef,
  type ThreadRecord,
  type TurnOutputValidationRecord
} from '@qiongqi/contracts'
import type { CompactRequest, CompactResponse, StartTurnRequest, StartTurnResponse, Turn, TurnStatus } from '@qiongqi/contracts'
import type { TurnItem } from '@qiongqi/contracts'
import type { SessionStore } from '@qiongqi/ports'
import type { ThreadStore } from '@qiongqi/ports'
import type { IdGenerator } from '@qiongqi/ports'
import type {
  TurnContextCompactor,
  TurnInflightTracker,
  TurnSteeringQueue,
  OutputValidatorRegistry
} from '@qiongqi/ports'
import { makeUserItem, makeErrorItem } from '@qiongqi/domain'
import { appendTurnItem, createTurnRecord, finishTurn, replaceTurnItem, startTurn as startTurnRecord } from '@qiongqi/domain'
import { touchThread } from '@qiongqi/domain'
import { deriveThreadTitle, isDefaultThreadTitle } from '@qiongqi/domain'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'

export type TurnServiceDeps = {
  threadStore: ThreadStore
  sessionStore: SessionStore
  events: RuntimeEventRecorder
  inflight: TurnInflightTracker
  steering: TurnSteeringQueue
  compactor: TurnContextCompactor
  ids: IdGenerator
  nowIso: () => string
  outputValidators?: OutputValidatorRegistry
}

/**
 * Turn service: owns the turn lifecycle (start, finish, abort, steer,
 * compact). The service is the only place that emits turn lifecycle
 * events; the agent loop calls into it instead of mutating state
 * directly.
 */
export class TurnService {
  private readonly deps: TurnServiceDeps
  private readonly inflightTurns = new Map<string, AbortController>()
  private readonly threadMutationQueues = new Map<string, Promise<void>>()
  private readonly itemCreationQueues = new Map<string, Promise<void>>()
  private readonly itemUpdateQueues = new Map<string, Promise<void>>()

  constructor(deps: TurnServiceDeps) {
    this.deps = deps
  }

  async startTurn(input: {
    threadId: string
    request: StartTurnRequest
  }): Promise<StartTurnResponse> {
    const thread = await this.deps.threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    const turnId = this.deps.ids.next('turn')
    const workModeId = input.request.workModeId ?? thread.workModeId ?? 'office'
    const turn = createTurnRecord({
      id: turnId,
      threadId: input.threadId,
      prompt: input.request.prompt,
      model: input.request.model,
      reasoningEffort: input.request.reasoningEffort,
      attachmentIds: input.request.attachmentIds ?? [],
      workModeId,
      explicitSkillIds: input.request.explicitSkillIds,
      ...(input.request.executionPolicy
        ? { executionPolicy: createTurnExecutionPolicySnapshot(input.request.executionPolicy) }
        : {}),
      ...(input.request.governedExecution
        ? { governedExecution: GovernedTurnExecutionRequestSchema.parse(input.request.governedExecution) }
        : {}),
      guiPlan: input.request.guiPlan,
      mode: input.request.mode
    })
    const userItem = makeUserItem({
      id: `item_${turnId}_user`,
      turnId,
      threadId: input.threadId,
      text: input.request.prompt,
      displayText: input.request.displayText,
      attachmentIds: input.request.attachmentIds ?? []
    })
    const controller = new AbortController()
    let titleUpdate: string | null = null
    await this.upsertThread(input.threadId, (current) => {
      const titlePatch = deriveFirstTurnTitlePatch(current, input.request.prompt)
      if (titlePatch.title) titleUpdate = titlePatch.title
      return {
        ...touchThread(current, this.deps.nowIso()),
        ...titlePatch,
        ...(input.request.approvalPolicy ? { approvalPolicy: input.request.approvalPolicy } : {}),
        ...(input.request.sandboxMode ? { sandboxMode: input.request.sandboxMode } : {}),
        status: 'running',
        turns: [...current.turns, startTurnRecord(appendTurnItem(turn, userItem))]
      }
    })
    if (titleUpdate) {
      await this.deps.events.record({
        kind: 'thread_updated',
        threadId: input.threadId,
        title: titleUpdate,
        status: 'running'
      })
    }
    await this.deps.sessionStore.appendItem(input.threadId, userItem)
    await this.deps.events.record({
      kind: 'turn_started',
      threadId: input.threadId,
      turnId
    })
    await this.deps.events.record({
      kind: 'item_created',
      threadId: input.threadId,
      turnId,
      itemId: userItem.id,
      item: userItem
    })
    this.inflightTurns.set(turnId, controller)
    this.deps.inflight.begin({
      id: turnId,
      kind: 'model',
      threadId: input.threadId,
      turnId
    })
    this.deps.steering.setTurn(turnId)
    return { threadId: input.threadId, turnId, userMessageItemId: userItem.id }
  }

  async steerTurn(input: { threadId: string; turnId: string; text: string }): Promise<void> {
    this.deps.steering.enqueue(input.turnId, input.text)
    await this.deps.events.record({
      kind: 'turn_steered',
      threadId: input.threadId,
      turnId: input.turnId,
      text: input.text
    })
  }

  async bindGovernedRun(input: {
    threadId: string
    turnId: string
    multiAgentRunId: string
    streamId: string
    graphRef: GovernedGraphRef
  }) {
    const existing = await this.getTurn(input.threadId, input.turnId)
    if (!existing) throw new Error(`turn not found: ${input.turnId}`)
    const binding = GovernedTurnBindingSchema.parse({
      multiAgentRunId: input.multiAgentRunId,
      streamId: input.streamId,
      graphRef: input.graphRef,
      boundAt: existing.governedBinding?.boundAt ?? this.deps.nowIso()
    })
    await this.upsertThread(input.threadId, (current) => ({
      ...current,
      turns: current.turns.map((turn) => {
        if (turn.id !== input.turnId) return turn
        if (!turn.governedExecution) throw new Error('turn has no governed execution request')
        if (!sameGraphRef(turn.governedExecution.graphRef, binding.graphRef)) {
          throw new Error('governed GraphRun binding contradicts the requested graph revision')
        }
        if (turn.governedBinding) {
          if (turn.governedBinding.multiAgentRunId !== binding.multiAgentRunId
            || turn.governedBinding.streamId !== binding.streamId
            || !sameGraphRef(turn.governedBinding.graphRef, binding.graphRef)) {
            throw new Error('turn is already bound to a different governed GraphRun')
          }
          return turn
        }
        return { ...turn, governedBinding: binding }
      })
    }))
    return binding
  }

  finishGovernedTurn(input: {
    threadId: string
    turnId: string
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
    error?: string
  }) {
    return this.finishTurn(input)
  }

  async interruptTurn(input: { threadId: string; turnId: string; discard?: boolean }): Promise<{ status: TurnStatus }> {
    const controller = this.inflightTurns.get(input.turnId)
    if (controller) controller.abort()
    this.deps.steering.clear(input.turnId)
    this.inflightTurns.delete(input.turnId)
    this.deps.inflight.end(input.turnId)
    await this.deps.events.record({
      kind: 'turn_aborted',
      threadId: input.threadId,
      turnId: input.turnId
    })
    if (input.discard) {
      await this.discardTurnItems(input.threadId, input.turnId)
    }
    await this.upsertThread(input.threadId, (current) => {
      const turn = current.turns.find((t) => t.id === input.turnId)
      if (!turn) return current
      const next = current.turns.map((t) =>
        t.id === input.turnId
          ? this.finalizeOpenItems(
              finishTurn(input.discard ? { ...t, items: this.keepUserItems(t.items) } : t, 'aborted'),
              'aborted'
            )
          : t
      )
      return { ...touchThread(current, this.deps.nowIso()), turns: next, status: 'idle' }
    })
    return { status: 'aborted' }
  }

  async compact(input: { threadId: string; turnId?: string; request: CompactRequest }): Promise<CompactResponse> {
    const thread = await this.deps.threadStore.get(input.threadId)
    if (!thread) throw new Error(`thread not found: ${input.threadId}`)
    const turnId = input.turnId ?? thread.turns[thread.turns.length - 1]?.id ?? this.deps.ids.next('turn')
    const items = await this.deps.sessionStore.loadItems(input.threadId)
    const history = items.filter((item) => !this.isSystemOnly(item))
    const prefix = {
      systemPrompt: '',
      tools: [],
      pinnedConstraints: ['user: preserve recent turns'],
      fewShots: [],
      fingerprint: 'compact',
      revision: 0
    }
    const result = this.deps.compactor.compact({
      threadId: input.threadId,
      turnId,
      history,
      prefix,
      budgetTokens: input.request.budgetTokens,
      reason: input.request.reason
    })
    if (result.replacedTokens > 0) {
      await this.appendItem(input.threadId, result.summaryItem)
    }
    await this.deps.events.record({
      kind: 'compaction_completed',
      threadId: input.threadId,
      turnId,
      itemId: result.summaryItem.id,
      summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
      replacedTokens: result.replacedTokens,
      pinnedConstraints: prefix.pinnedConstraints,
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
        ? { sourceDigest: result.summaryItem.sourceDigest }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
        ? { digestMarker: result.summaryItem.digestMarker }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
        ? { sourceItemIds: result.summaryItem.sourceItemIds }
        : {})
    })
    return {
      threadId: input.threadId,
      replacedTokens: result.replacedTokens,
      summary: result.summaryItem.kind === 'compaction' ? result.summaryItem.summary : '',
      pinnedConstraints: prefix.pinnedConstraints,
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceDigest
        ? { sourceDigest: result.summaryItem.sourceDigest }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.digestMarker
        ? { digestMarker: result.summaryItem.digestMarker }
        : {}),
      ...(result.summaryItem.kind === 'compaction' && result.summaryItem.sourceItemIds
        ? { sourceItemIds: result.summaryItem.sourceItemIds }
        : {})
    }
  }

  /**
   * Persist a final turn state (running -> completed/failed/aborted).
   * Called by the agent loop when a model stream finishes.
   */
  async finishTurn(input: {
    threadId: string
    turnId: string
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
    error?: string
  }): Promise<{ status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'> }> {
    let effectiveStatus = input.status
    let effectiveError = input.error
    let outputValidation: TurnOutputValidationRecord | undefined
    if (input.status === 'completed') {
      const validated = await this.validateTurnOutput(input.threadId, input.turnId)
      if (validated) {
        outputValidation = validated.record
        if (validated.status === 'failed') {
          effectiveStatus = 'failed'
          effectiveError = validated.error
        }
      }
    }
    this.inflightTurns.delete(input.turnId)
    this.deps.inflight.end(input.turnId)
    this.deps.steering.clear(input.turnId)
    let changed = false
    await this.upsertThread(input.threadId, (current) => {
      const next = current.turns.map((t) => {
        if (t.id !== input.turnId) return t
        if (t.status === 'completed' || t.status === 'failed' || t.status === 'aborted') {
          if (t.status !== effectiveStatus) {
            throw new Error(`turn terminal status contradicts governed projection: ${t.status} !== ${effectiveStatus}`)
          }
          return t
        }
        changed = true
        const finished = this.finalizeOpenItems(finishTurn(t, effectiveStatus), effectiveStatus)
        return {
          ...finished,
          ...(effectiveError ? { error: effectiveError } : {}),
          ...(outputValidation ? { outputValidation } : {})
        }
      })
      return { ...touchThread(current, this.deps.nowIso()), turns: next, status: 'idle' }
    })
    if (!changed) return { status: effectiveStatus }
    await this.deps.events.record({
      kind: effectiveStatus === 'completed' ? 'turn_completed' : effectiveStatus === 'aborted' ? 'turn_aborted' : 'turn_failed',
      threadId: input.threadId,
      turnId: input.turnId,
      ...(effectiveError ? { message: effectiveError } : {})
    })
    if (effectiveError) {
      await this.appendItem(input.threadId, makeErrorItem({
        id: `item_${input.turnId}_error`,
        turnId: input.turnId,
        threadId: input.threadId,
        message: effectiveError
      }))
    }
    return { status: effectiveStatus }
  }

  getAbortController(turnId: string): AbortSignal | undefined {
    return this.inflightTurns.get(turnId)?.signal
  }

  async getTurn(threadId: string, turnId: string): Promise<Turn | null> {
    const thread = await this.deps.threadStore.get(threadId)
    return thread?.turns.find((turn) => turn.id === turnId) ?? null
  }

  private async validateTurnOutput(
    threadId: string,
    turnId: string
  ): Promise<{
    status: 'completed' | 'failed'
    record: TurnOutputValidationRecord
    error?: string
  } | undefined> {
    const turn = await this.getTurn(threadId, turnId)
    const validatorRef = turn?.executionPolicy?.output?.validatorRef
    if (!turn || !validatorRef) return undefined
    if (turn.outputValidation) {
      return turn.outputValidation.status === 'accepted'
        ? { status: 'completed', record: turn.outputValidation }
        : {
            status: 'failed',
            record: turn.outputValidation,
            error: turn.outputValidation.reason ?? 'output validator rejected the turn output'
          }
    }

    const failure = (status: 'rejected' | 'error', reason: string) => ({
      status: 'failed' as const,
      error: `output validator failed: ${reason}`,
      record: {
        validatorRef,
        status,
        validatedAt: this.deps.nowIso(),
        reason
      } satisfies TurnOutputValidationRecord
    })
    const validator = this.deps.outputValidators?.resolve(validatorRef)
    if (!validator) return failure('error', `output validator unavailable: ${validatorRef.validatorId}`)
    if (!sameValidatorRef(validator.ref, validatorRef)) {
      return failure('error', `output validator identity mismatch: ${validatorRef.validatorId}`)
    }

    const assistantItems = turn.items.filter((item) => item.kind === 'assistant_text')
    const toolResultItems = turn.items.filter((item) => item.kind === 'tool_result')
    try {
      const verdict = await validator.validate({
        threadId,
        turnId,
        outputText: assistantItems.map((item) => item.text).join('\n\n'),
        assistantItemIds: assistantItems.map((item) => item.id),
        toolResultItemIds: toolResultItems.map((item) => item.id),
        itemRefs: [...assistantItems, ...toolResultItems].map((item) => `qiongqi-item:${item.id}`)
      })
      if (!verdict.ok) return failure('rejected', verdict.reason)
      return {
        status: 'completed',
        record: {
          validatorRef,
          status: 'accepted',
          validatedAt: this.deps.nowIso()
        }
      }
    } catch (error) {
      return failure('error', error instanceof Error ? error.message : String(error))
    }
  }

  async updateTurnMetadata(
    threadId: string,
    turnId: string,
    patch: Pick<
      Partial<Turn>,
      | 'activeSkillIds'
      | 'explicitSkillIds'
      | 'injectedMemoryIds'
      | 'skillInjectionBytes'
      | 'toolCatalogFingerprint'
      | 'toolCatalogToolCount'
      | 'toolCatalogDrift'
    >
  ): Promise<void> {
    await this.upsertThread(threadId, (current) => ({
      ...current,
      turns: current.turns.map((turn) =>
        turn.id === turnId
          ? {
              ...turn,
              ...(patch.activeSkillIds ? { activeSkillIds: [...patch.activeSkillIds] } : {}),
              ...(patch.explicitSkillIds ? { explicitSkillIds: [...patch.explicitSkillIds] } : {}),
              ...(patch.injectedMemoryIds ? { injectedMemoryIds: [...patch.injectedMemoryIds] } : {}),
              ...(patch.skillInjectionBytes !== undefined ? { skillInjectionBytes: patch.skillInjectionBytes } : {}),
              ...(patch.toolCatalogFingerprint ? { toolCatalogFingerprint: patch.toolCatalogFingerprint } : {}),
              ...(patch.toolCatalogToolCount !== undefined ? { toolCatalogToolCount: patch.toolCatalogToolCount } : {}),
              ...(patch.toolCatalogDrift !== undefined ? { toolCatalogDrift: patch.toolCatalogDrift } : {})
            }
          : turn
      )
    }))
  }

  /**
   * Apply a tool or assistant item to the current turn. The agent loop
   * calls this after each chunk so SSE consumers see live updates.
   */
  async applyItem(threadId: string, item: TurnItem): Promise<void> {
    await this.appendItem(threadId, item)
    await this.deps.events.record({
      kind: 'item_created',
      threadId,
      turnId: item.turnId,
      itemId: item.id,
      item
    })
  }

  /** Persist and announce a creation only when the stable item id is absent. */
  async applyItemOnce(threadId: string, item: TurnItem): Promise<boolean> {
    let createdInSession = false
    const previous = this.itemCreationQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      const persisted = await this.deps.sessionStore.appendItemOnce(threadId, item)
      createdInSession = persisted.created
      await this.projectItem(threadId, persisted.item)
      await this.deps.events.recordOnce({
        kind: 'item_created',
        threadId,
        turnId: persisted.item.turnId,
        itemId: persisted.item.id,
        item: persisted.item
      }, (event) => event.kind === 'item_created' && event.itemId === persisted.item.id)
    })
    const guard = run.then(() => undefined, () => undefined)
    this.itemCreationQueues.set(threadId, guard)
    try {
      await run
      return createdInSession
    } finally {
      if (this.itemCreationQueues.get(threadId) === guard) {
        this.itemCreationQueues.delete(threadId)
      }
    }
  }

  async updateItem(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<TurnItem | null> {
    const updatedInSession = await this.deps.sessionStore.updateItem(threadId, itemId, patch)
    const updatedItems: TurnItem[] = []
    await this.upsertThread(threadId, (current) => {
      const turns = current.turns.map((turn) => {
        const existing = turn.items.find((item) => item.id === itemId)
        if (!existing) return turn
        updatedItems[0] = { ...existing, ...patch } as TurnItem
        return replaceTurnItem(turn, itemId, patch)
      })
      return { ...current, turns }
    })
    const updated = updatedItems[0] ?? updatedInSession
    if (!updated) return null
    await this.deps.events.record({
      kind: 'item_updated',
      threadId,
      turnId: updated.turnId,
      itemId: updated.id,
      item: updated
    })
    return updated
  }

  async updateItemOnce(
    threadId: string,
    itemId: string,
    patch: Partial<TurnItem>
  ): Promise<{ item: TurnItem; updated: boolean } | null> {
    let outcome: { item: TurnItem; updated: boolean } | null | undefined
    const previous = this.itemUpdateQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      const persisted = await this.deps.sessionStore.updateItemOnce(threadId, itemId, patch)
      if (!persisted) {
        outcome = null
        return
      }
      await this.projectItem(threadId, persisted.item)
      const digest = canonicalItemDigest(persisted.item)
      await this.deps.events.recordOnce({
        kind: 'item_updated',
        threadId,
        turnId: persisted.item.turnId,
        itemId: persisted.item.id,
        item: persisted.item
      }, (event) => event.kind === 'item_updated'
        && event.itemId === persisted.item.id
        && canonicalItemDigest(event.item) === digest)
      outcome = persisted
    })
    const guard = run.then(() => undefined, () => undefined)
    this.itemUpdateQueues.set(threadId, guard)
    try {
      await run
      if (outcome === undefined) throw new Error('updateItemOnce completed without an outcome')
      return outcome
    } finally {
      if (this.itemUpdateQueues.get(threadId) === guard) {
        this.itemUpdateQueues.delete(threadId)
      }
    }
  }

  private async appendItem(threadId: string, item: TurnItem): Promise<void> {
    await this.deps.sessionStore.appendItem(threadId, item)
    await this.projectItem(threadId, item)
  }

  private async projectItem(threadId: string, item: TurnItem): Promise<void> {
    await this.upsertThread(threadId, (current) => {
      const turn = current.turns.find((t) => t.id === item.turnId)
      if (!turn) return current
      const nextTurn = appendTurnItem(turn, item)
      const turns = current.turns.map((t) => (t.id === item.turnId ? nextTurn : t))
      return { ...current, turns }
    })
  }

  private async upsertThread(
    threadId: string,
    mutator: (current: ThreadRecord) => ThreadRecord
  ): Promise<void> {
    const previous = this.threadMutationQueues.get(threadId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(async () => {
      const current = await this.deps.threadStore.get(threadId)
      if (!current) return
      const next = mutator(current)
      await this.deps.threadStore.upsert({ ...next, updatedAt: this.deps.nowIso() })
    })
    const guard = run.then(() => undefined, () => undefined)
    this.threadMutationQueues.set(threadId, guard)
    try {
      await run
    } finally {
      if (this.threadMutationQueues.get(threadId) === guard) {
        this.threadMutationQueues.delete(threadId)
      }
    }
  }

  private finalizeOpenItems(
    turn: Turn,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>
  ): Turn {
    const finishedAt = this.deps.nowIso()
    let changed = false
    const items = turn.items.map((item) => {
      const next = this.finalizeOpenItem(item, status, finishedAt)
      if (next !== item) changed = true
      return next
    })
    return changed ? { ...turn, items } : turn
  }

  private async discardTurnItems(threadId: string, turnId: string): Promise<void> {
    const items = await this.deps.sessionStore.loadItems(threadId)
    await this.deps.sessionStore.rewriteItems(
      threadId,
      items.filter((item) => item.turnId !== turnId || item.kind === 'user_message')
    )
  }

  private keepUserItems(items: TurnItem[]): TurnItem[] {
    return items.filter((item) => item.kind === 'user_message')
  }

  private finalizeOpenItem(
    item: TurnItem,
    status: Extract<TurnStatus, 'completed' | 'failed' | 'aborted'>,
    finishedAt: string
  ): TurnItem {
    if (item.status !== 'pending' && item.status !== 'running') return item
    if (item.kind === 'approval') {
      return { ...item, status: 'expired', finishedAt }
    }
    if (item.kind === 'user_input') {
      return { ...item, status: 'cancelled', finishedAt }
    }
    const itemStatus = status === 'completed' ? 'completed' : status
    return { ...item, status: itemStatus, finishedAt } as TurnItem
  }

  private isSystemOnly(item: TurnItem): boolean {
    return item.kind === 'compaction' || item.kind === 'error'
  }
}

function canonicalItemDigest(item: TurnItem): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(item))).digest('hex')
}

function sameValidatorRef(left: OutputValidatorRef, right: OutputValidatorRef): boolean {
  return left.validatorId === right.validatorId
    && left.revision === right.revision
    && left.digest === right.digest
}

function sameGraphRef(left: GovernedGraphRef, right: GovernedGraphRef): boolean {
  return left.graphId === right.graphId && left.revision === right.revision
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
  )
}

function deriveFirstTurnTitlePatch(thread: ThreadRecord, prompt: string): { title?: string } {
  if (thread.turns.length > 0 || !isDefaultThreadTitle(thread.title)) return {}
  const title = deriveThreadTitle(prompt)
  return title !== thread.title ? { title } : {}
}
