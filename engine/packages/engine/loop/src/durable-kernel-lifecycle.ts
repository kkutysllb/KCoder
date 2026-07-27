import {
  KernelCompletionPayloadSchema,
  KernelRunIdentitySchema,
  RunOutcomeSchema,
  type BudgetState,
  type KernelCompletionPayload,
  type KernelRunIdentity,
  type RunOutcome
} from '@qiongqi/contracts'
import {
  EngineOutboxIntentSchema,
  EngineRunRecordSchema,
  EngineStoreConflictError,
  type BudgetReservationRecord,
  type DurableEngineStore,
  type EngineRunRecord
} from '@qiongqi/ports'

export type DurableKernelLifecycleOptions = {
  store: DurableEngineStore
  nowIso?: () => string
}

export type ParentBudgetReservationInput = {
  scope: EngineRunRecord['scope']
  parentRunId: string
  childRunId: string
  reservationId: string
  requested: BudgetState
}

export type KernelCompletionInput = {
  scope: EngineRunRecord['scope']
  runId: string
  executionRef: KernelRunIdentity
  outcome: RunOutcome
  usage: BudgetState
  usageRefs: string[]
  artifactRefs: string[]
  reservationId?: string
  suspensionToken?: string
}

export class DurableKernelLifecycle {
  private readonly nowIso: () => string

  constructor(private readonly options: DurableKernelLifecycleOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async requestCancel(runId: string): Promise<EngineRunRecord> {
    const current = await this.requireRun(runId)
    if (isTerminal(current) || current.desiredState === 'cancelled') return current
    const next = EngineRunRecordSchema.parse({
      ...current,
      version: current.version + 1,
      desiredState: 'cancelled',
      updatedAt: this.nowIso()
    })
    const taskRevision = await this.taskRevision(current.scope)
    const result = await this.options.store.commit({
      scope: current.scope,
      runId,
      expectedRunVersion: current.version,
      expectedTaskRevision: taskRevision,
      runMutation: { type: 'put', record: next }
    })
    if (result.runVersion !== next.version) throw new EngineStoreConflictError('cancel commit returned an unexpected run version')
    return next
  }

  async checkCancellation(runId: string): Promise<RunOutcome | undefined> {
    const current = await this.requireRun(runId)
    if (current.desiredState !== 'cancelled' || isTerminal(current)) return undefined
    return { status: 'aborted', reason: 'user_aborted', retryable: false }
  }

  async reserveParentBudget(input: ParentBudgetReservationInput): Promise<BudgetReservationRecord> {
    const parent = await this.requireRun(input.parentRunId)
    if (parent.desiredState === 'cancelled' || isTerminal(parent)) {
      throw new EngineStoreConflictError(`parent run ${input.parentRunId} is no longer reservable`)
    }
    const now = this.nowIso()
    const record: BudgetReservationRecord = {
      reservationId: input.reservationId,
      scope: input.scope,
      parentRunId: input.parentRunId,
      childRunId: input.childRunId,
      status: 'reserved',
      reserved: input.requested,
      createdAt: now,
      updatedAt: now
    }
    const taskRevision = await this.taskRevision(parent.scope)
    await this.options.store.commit({
      scope: parent.scope,
      runId: parent.runId,
      expectedRunVersion: parent.version,
      expectedTaskRevision: taskRevision,
      budgetReservationMutations: [{ type: 'reserve', record }]
    })
    return record
  }

  async completeKernelRun(input: KernelCompletionInput): Promise<EngineRunRecord> {
    const current = await this.requireRun(input.runId)
    if (isTerminal(current)) return current
    const executionRef = KernelRunIdentitySchema.parse(input.executionRef)
    const requestedOutcome = RunOutcomeSchema.parse(input.outcome)
    const outcome = current.desiredState === 'cancelled'
      ? { status: 'aborted', reason: 'user_aborted', retryable: false } as const
      : requestedOutcome
    assertUsageWithinBudget(input.usage, current.budgetLimits)
    const status = persistedStatus(outcome)
    const isSuspended = outcome.status === 'suspended'
    const suspensionRevision = current.cursor.checkpointSeq + 1
    const next = EngineRunRecordSchema.parse({
      ...current,
      version: current.version + 1,
      status,
      outcome,
      budgets: input.usage,
      cursor: {
        ...current.cursor,
        ...(isSuspended ? { checkpointSeq: suspensionRevision } : {})
      },
      ...(isSuspended ? {
        suspension: {
          token: input.suspensionToken ?? `resume:${input.runId}:${suspensionRevision}`,
          reason: outcome.reason,
          revision: suspensionRevision,
          requestedAt: this.nowIso()
        }
      } : { suspension: undefined }),
      updatedAt: this.nowIso()
    })
    const taskRevision = await this.taskRevision(current.scope)
    if (isSuspended) {
      await this.options.store.commit({
        scope: current.scope,
        runId: current.runId,
        expectedRunVersion: current.version,
        expectedTaskRevision: taskRevision,
        runMutation: { type: 'put', record: next }
      })
      return next
    }
    const payload: KernelCompletionPayload = KernelCompletionPayloadSchema.parse({
      executionRef,
      outcome,
      usageRefs: input.usageRefs,
      artifactRefs: input.artifactRefs
    })
    const outbox = EngineOutboxIntentSchema.parse({
      workId: `agent_execution_completed:${input.runId}`,
      scope: input.scope,
      kind: 'agent_execution_completed',
      payloadRef: `engine://kernel/${input.runId}/completion`,
      status: 'pending',
      availableAt: this.nowIso(),
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      payload
    })
    await this.options.store.commit({
      scope: current.scope,
      runId: current.runId,
      expectedRunVersion: current.version,
      expectedTaskRevision: taskRevision,
      runMutation: { type: 'put', record: next },
      outboxIntents: [{ type: 'put', record: outbox }],
      ...(input.reservationId ? {
        budgetReservationMutations: [{ type: 'settle' as const, recordId: input.reservationId, actual: input.usage, updatedAt: this.nowIso() }]
      } : {})
    })
    return next
  }

  private async requireRun(runId: string): Promise<EngineRunRecord> {
    const run = await this.options.store.loadRun(runId)
    if (!run) throw new Error(`durable run not found: ${runId}`)
    return EngineRunRecordSchema.parse(run)
  }

  private async taskRevision(scope: EngineRunRecord['scope']): Promise<number> {
    return (await this.options.store.loadTask(scope))?.revision ?? 0
  }
}

const budgetKeys = ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const

function assertUsageWithinBudget(actual: BudgetState, reserved?: BudgetState): void {
  if (!reserved) return
  for (const key of budgetKeys) {
    if (actual[key] > reserved[key]) {
      throw new EngineStoreConflictError(`actual usage exceeds reserved budget: ${key}`)
    }
  }
}

function isTerminal(run: EngineRunRecord): boolean {
  return run.status === 'completed' || run.status === 'degraded' || run.status === 'failed' || run.status === 'aborted'
}

function persistedStatus(outcome: RunOutcome): EngineRunRecord['status'] {
  if (outcome.status === 'suspended') {
    if (outcome.reason === 'awaiting_user_input') return 'waiting_input'
    if (outcome.reason === 'required_action_missing') return 'waiting_effect_verification'
    return 'waiting_model_resolution'
  }
  return outcome.status
}
