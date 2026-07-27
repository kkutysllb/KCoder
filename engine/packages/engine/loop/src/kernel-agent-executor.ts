import {
  BudgetStateSchema,
  KernelRunIdentitySchema,
  type BudgetState,
  type GraphCorrelationIdentity,
  type KernelRunIdentity,
  type RunOutcome,
  type TaskScope
} from '@qiongqi/contracts'
import {
  EngineRunRecordSchema,
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineRunRecord
} from '@qiongqi/ports'
import { DurableKernelLifecycle } from './durable-kernel-lifecycle.js'

export type AgentExecutionInput = {
  scope: TaskScope
  multiAgentRunId: string
  agentRunId: string
  agentId: string
  nodeId: string
  parentRunId: string
  requestedBudget: BudgetState
  prompt: string
  role?: 'agent' | 'judge'
  sharedEvidenceRefs?: string[]
  modelPolicyRef?: { policyId: string; revision: number }
  graph?: GraphCorrelationIdentity
}

export type PreparedAgentExecutionInput = AgentExecutionInput & {
  executionRef: KernelRunIdentity
  reservationId: string
}

export type AgentDispatchPreparationInput = PreparedAgentExecutionInput & {
  inputRef: string
}

export interface AgentExecutor {
  execute(input: PreparedAgentExecutionInput): Promise<{ executionRef: KernelRunIdentity }>
  resume(executionRef: KernelRunIdentity, resolution?: unknown): Promise<void>
  cancel(executionRef: KernelRunIdentity): Promise<void>
}

export type KernelExecutionResult = {
  outcome: RunOutcome
  usage: BudgetState
  usageRefs: string[]
  artifactRefs: string[]
}

export type KernelResumeInput = {
  token: string
  revision: number
  resolution?: unknown
}

export type KernelAgentExecutorOptions = {
  store: DurableEngineStore
  lifecycle?: DurableKernelLifecycle
  ids: (prefix: string) => string
  nowIso?: () => string
  startKernel: (input: PreparedAgentExecutionInput) => Promise<KernelExecutionResult>
  resumeKernel?: (input: {
    executionRef: KernelRunIdentity
    suspension: NonNullable<EngineRunRecord['suspension']>
    resolution: unknown
  }) => Promise<KernelExecutionResult>
}

/** Starts one isolated Kernel child and reports completion only through the durable outbox. */
export class KernelAgentExecutor implements AgentExecutor {
  private readonly lifecycle: DurableKernelLifecycle
  private readonly nowIso: () => string

  constructor(private readonly options: KernelAgentExecutorOptions) {
    this.lifecycle = options.lifecycle ?? new DurableKernelLifecycle({ store: options.store, nowIso: options.nowIso })
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async execute(input: PreparedAgentExecutionInput): Promise<{ executionRef: KernelRunIdentity }> {
    const executionRef = KernelRunIdentitySchema.parse(input.executionRef)
    assertPreparedExecution(input, executionRef)
    const existing = await this.options.store.loadRun(executionRef.kernelRunId)
    await this.requirePreparedReservation(input, Boolean(existing && isTerminal(existing)))
    if (existing) {
      assertExecutionRefMatchesRun(executionRef, existing)
      assertPreparedChildMatches(input, existing)
      if (isTerminal(existing) || isWaiting(existing)) return { executionRef }
      await this.startAndComplete(input, executionRef)
      return { executionRef }
    }
    const now = this.nowIso()
    const child = EngineRunRecordSchema.parse({
      runId: executionRef.kernelRunId,
      scope: input.scope,
      multiAgentRunId: input.multiAgentRunId,
      agentRunId: input.agentRunId,
      kernelRunId: executionRef.kernelRunId,
      ...(input.graph ? { graph: input.graph } : {}),
      version: 1,
      status: 'created',
      desiredState: 'running',
      cursor: { nodeId: input.nodeId, stepIndex: 0, checkpointSeq: 0 },
      parentRef: { kind: 'agent', runId: input.agentRunId },
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      budgetLimits: input.requestedBudget,
      createdAt: now,
      updatedAt: now
    })
    await this.options.store.commit({
      scope: input.scope,
      runId: executionRef.kernelRunId,
      expectedRunVersion: 0,
      expectedTaskRevision: (await this.options.store.loadTask(input.scope))?.revision ?? 0,
      runMutation: { type: 'put', record: child }
    })
    await this.startAndComplete(input, executionRef)
    return { executionRef }
  }

  async resume(executionRefInput: KernelRunIdentity, resolutionInput?: unknown): Promise<void> {
    if (!this.options.resumeKernel) throw new Error('Kernel resume handler is not configured')
    const executionRef = KernelRunIdentitySchema.parse(executionRefInput)
    const resolution = parseResumeInput(resolutionInput)
    const run = await this.requireRun(executionRef.kernelRunId)
    if (!isWaiting(run) || !run.suspension || run.desiredState === 'cancelled') {
      throw new Error('Kernel run is not waiting or its suspension token was consumed')
    }
    assertExecutionRefMatchesRun(executionRef, run)
    if (run.suspension.revision !== resolution.revision) throw new Error('Kernel suspension revision mismatch')
    if (run.suspension.token !== resolution.token) throw new Error('Kernel suspension token mismatch')

    const suspension = run.suspension
    const { outcome: _outcome, suspension: _suspension, ...rest } = run
    const resumed = EngineRunRecordSchema.parse({
      ...rest,
      version: run.version + 1,
      status: 'running',
      updatedAt: this.nowIso()
    })
    await this.options.store.commit({
      scope: run.scope,
      runId: run.runId,
      expectedRunVersion: run.version,
      expectedTaskRevision: (await this.options.store.loadTask(run.scope))?.revision ?? 0,
      runMutation: { type: 'put', record: resumed }
    })

    let result: KernelExecutionResult
    try {
      result = await this.options.resumeKernel({
        executionRef,
        suspension,
        resolution: resolution.resolution
      })
    } catch (error) {
      result = failedExecutionResult(error, run.budgets)
    }
    await this.completeExecutionResult(run.scope, executionRef, result)
  }

  async cancel(executionRef: KernelRunIdentity): Promise<void> {
    await this.lifecycle.requestCancel(executionRef.kernelRunId)
  }

  private async startAndComplete(input: PreparedAgentExecutionInput, executionRef: KernelRunIdentity): Promise<void> {
    let result: KernelExecutionResult
    try {
      result = await this.options.startKernel({ ...input, executionRef })
    } catch (error) {
      result = failedExecutionResult(error, zeroBudget())
    }
    await this.completeExecutionResult(input.scope, executionRef, result, input.reservationId)
  }

  private async completeExecutionResult(
    scope: TaskScope,
    executionRef: KernelRunIdentity,
    result: KernelExecutionResult,
    reservationId = `reservation:${executionRef.kernelRunId}`
  ): Promise<void> {
    await this.lifecycle.completeKernelRun({
      scope,
      runId: executionRef.kernelRunId,
      executionRef,
      outcome: result.outcome,
      usage: BudgetStateSchema.parse(result.usage),
      usageRefs: result.usageRefs,
      artifactRefs: result.artifactRefs,
      reservationId,
      ...(result.outcome.status === 'suspended' ? { suspensionToken: this.options.ids('resume_token') } : {})
    })
  }

  private async requireRun(runId: string): Promise<EngineRunRecord> {
    const run = await this.options.store.loadRun(runId)
    if (!run) throw new Error(`Kernel run not found: ${runId}`)
    return run
  }

  private async requirePreparedReservation(
    input: PreparedAgentExecutionInput,
    allowSettled: boolean
  ): Promise<void> {
    const reservations = await this.options.store.loadBudgetReservations(input.parentRunId)
    const reservation = reservations.find((candidate) => candidate.reservationId === input.reservationId)
    if (!reservation) throw new EngineStoreConflictError(`prepared reservation not found: ${input.reservationId}`)
    if (reservation.parentRunId !== input.parentRunId
      || reservation.childRunId !== input.executionRef.kernelRunId
      || (reservation.status !== 'reserved' && !(allowSettled && reservation.status === 'settled'))
      || !sameScope(reservation.scope, input.scope)
      || !sameBudget(reservation.reserved, input.requestedBudget)) {
      throw new EngineStoreConflictError('prepared reservation contradicts Kernel dispatch identity or budget')
    }
  }
}

function isWaiting(run: EngineRunRecord): boolean {
  return run.status === 'waiting_input'
    || run.status === 'waiting_model_resolution'
    || run.status === 'waiting_effect_verification'
}

function parseResumeInput(input: unknown): KernelResumeInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Kernel resume input is required')
  const record = input as Record<string, unknown>
  if (typeof record.token !== 'string' || !record.token.trim()) throw new Error('Kernel suspension token is required')
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) {
    throw new Error('Kernel suspension revision must be a non-negative integer')
  }
  return {
    token: record.token,
    revision: record.revision as number,
    resolution: record.resolution
  }
}

function assertExecutionRefMatchesRun(executionRef: KernelRunIdentity, run: EngineRunRecord): void {
  if (
    executionRef.parentKind !== 'agent'
    || executionRef.kernelRunId !== run.kernelRunId
    || executionRef.multiAgentRunId !== run.multiAgentRunId
    || executionRef.agentRunId !== run.agentRunId
    || executionRef.scope.ownerId !== run.scope.ownerId
    || executionRef.scope.workspaceId !== run.scope.workspaceId
    || executionRef.scope.taskId !== run.scope.taskId
  ) {
    throw new EngineStoreConflictError('Kernel execution identity does not match durable run')
  }
}

function assertPreparedExecution(input: PreparedAgentExecutionInput, executionRef: KernelRunIdentity): void {
  if (input.reservationId !== `reservation:${executionRef.kernelRunId}`
    || input.parentRunId !== input.multiAgentRunId
    || executionRef.parentKind !== 'agent'
    || executionRef.multiAgentRunId !== input.multiAgentRunId
    || executionRef.agentRunId !== input.agentRunId
    || executionRef.parentRunId !== input.agentRunId
    || !sameScope(executionRef.scope, input.scope)
    || JSON.stringify(input.graph) !== JSON.stringify(executionRef.graph)) {
    throw new EngineStoreConflictError('prepared Kernel execution identity is inconsistent')
  }
}

function assertPreparedChildMatches(input: PreparedAgentExecutionInput, run: EngineRunRecord): void {
  if (run.parentRef?.kind !== 'agent'
    || run.parentRef.runId !== input.agentRunId
    || !sameBudget(run.budgetLimits ?? zeroBudget(), input.requestedBudget)
    || JSON.stringify(run.graph) !== JSON.stringify(input.graph)) {
    throw new EngineStoreConflictError('durable Kernel child contradicts prepared dispatch')
  }
}

function sameScope(left: TaskScope, right: TaskScope): boolean {
  return left.ownerId === right.ownerId
    && left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
}

const budgetKeys = ['stepsUsed', 'toolCallsUsed', 'inputTokens', 'outputTokens', 'costUsd'] as const

function sameBudget(left: BudgetState, right: BudgetState): boolean {
  return budgetKeys.every((key) => left[key] === right[key])
}

function isTerminal(run: EngineRunRecord): boolean {
  return run.status === 'completed'
    || run.status === 'degraded'
    || run.status === 'failed'
    || run.status === 'aborted'
}

function failedExecutionResult(error: unknown, usage: BudgetState): KernelExecutionResult {
  return {
    outcome: {
      status: 'failed',
      reason: 'runtime_error',
      retryable: true,
      details: { message: error instanceof Error ? error.message : String(error) }
    },
    usage,
    usageRefs: [],
    artifactRefs: []
  }
}

function zeroBudget(): BudgetState {
  return { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}
