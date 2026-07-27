import {
  KernelDispatchPayloadSchema,
  type KernelDispatchPayload,
  type WorkGraphEventRecord
} from '@qiongqi/contracts'
import {
  EngineStoreConflictError,
  type DurableEngineStore,
  type EngineLease
} from '@qiongqi/ports'
import type { AgentExecutor, PreparedAgentExecutionInput } from './kernel-agent-executor.js'

export type DurableAgentDispatchWorkerOptions = {
  store: DurableEngineStore
  executor: AgentExecutor
  workerId?: string
  leaseTtlMs?: number
  onError?: (error: unknown) => void
  setInterval?: (callback: () => void, intervalMs: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export type DurableAgentDispatchFlushResult = {
  processed: boolean
  workId?: string
}

/** Consumes prepared Agent-to-Kernel intents through one fenced local/remote path. */
export class DurableAgentDispatchWorker {
  private readonly workerId: string
  private readonly leaseTtlMs: number
  private scheduled = false

  constructor(private readonly options: DurableAgentDispatchWorkerOptions) {
    this.workerId = options.workerId ?? 'qiongqi-local-kernel-worker'
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000
  }

  notify(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flushOnce().catch((error) => this.options.onError?.(error))
    })
  }

  async flushOnce(): Promise<DurableAgentDispatchFlushResult> {
    const claim = await this.options.store.claimWork(
      this.workerId,
      ['agent_execution_requested'],
      this.leaseTtlMs
    )
    if (!claim) return { processed: false }

    const payload = KernelDispatchPayloadSchema.parse(claim.payload)
    let lease: EngineLease | undefined = claim.lease
    let renewalError: unknown
    let renewalInProgress = false
    const renew = () => {
      if (renewalInProgress || !lease) return
      renewalInProgress = true
      void this.options.store.renewWorkClaim(claim.workId, lease, this.leaseTtlMs)
        .then((renewed) => {
          if (!renewed) renewalError = new EngineStoreConflictError(`dispatch work claim lost: ${claim.workId}`)
          lease = renewed
        })
        .catch((error) => {
          renewalError = error
          lease = undefined
        })
        .finally(() => { renewalInProgress = false })
    }
    const setTimer = this.options.setInterval ?? ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs))
    const clearTimer = this.options.clearInterval ?? ((timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>))
    const timer = setTimer(renew, Math.max(1, Math.floor(this.leaseTtlMs / 3)))
    if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') timer.unref()

    try {
      const input = await this.executionInput(payload)
      await this.options.executor.execute(input)
      if (renewalError) throw renewalError
      if (!lease) throw new EngineStoreConflictError(`dispatch work claim lost: ${claim.workId}`)
      await this.options.store.commit({
        scope: payload.identity.scope,
        runId: claim.workId,
        expectedRunVersion: 0,
        expectedTaskRevision: (await this.options.store.loadTask(payload.identity.scope))?.revision ?? 0,
        outboxIntents: [{
          type: 'complete',
          recordId: claim.workId,
          claim: lease,
          payload
        }]
      })
      return { processed: true, workId: claim.workId }
    } finally {
      clearTimer(timer)
    }
  }

  private async executionInput(payload: KernelDispatchPayload): Promise<PreparedAgentExecutionInput> {
    const identity = payload.identity
    return {
      scope: identity.scope,
      multiAgentRunId: identity.multiAgentRunId,
      agentRunId: identity.agentRunId,
      agentId: identity.agentId,
      nodeId: identity.nodeId,
      parentRunId: identity.parentRunId,
      requestedBudget: payload.requestedBudget,
      prompt: await this.resolvePrompt(payload.inputRef),
      executionRef: identity.executionRef,
      reservationId: payload.reservationId,
      role: payload.role,
      sharedEvidenceRefs: payload.sharedEvidenceRefs,
      ...(payload.modelPolicyRef ? { modelPolicyRef: payload.modelPolicyRef } : {}),
      ...(identity.graph ? { graph: identity.graph } : {})
    }
  }

  private async resolvePrompt(inputRef: string): Promise<string> {
    const match = /^graph-run:\/\/([^/]+)\/events\/([^/]+)\/prompt$/.exec(inputRef)
    if (!match) throw new EngineStoreConflictError(`unsupported Kernel dispatch inputRef: ${inputRef}`)
    const runId = decodeURIComponent(match[1]!)
    const eventId = decodeURIComponent(match[2]!)
    let afterSeq = 0
    while (true) {
      const page = await this.options.store.listWorkGraphEvents(runId, afterSeq, 1_000)
      const event = page.find((candidate) => candidate.eventId === eventId)
      if (event) return promptFromEvent(event)
      if (page.length < 1_000) break
      afterSeq = page.at(-1)!.seq
    }
    throw new EngineStoreConflictError(`Kernel dispatch input event not found: ${inputRef}`)
  }
}

function promptFromEvent(event: WorkGraphEventRecord): string {
  const payload = event.payload
  if (!payload || typeof payload !== 'object' || !('event' in payload)) {
    throw new EngineStoreConflictError(`Kernel dispatch event has no evented_v2 payload: ${event.eventId}`)
  }
  const sourceEvent = payload.event
  if (!sourceEvent || typeof sourceEvent !== 'object' || !('payload' in sourceEvent)) {
    throw new EngineStoreConflictError(`Kernel dispatch event has no source payload: ${event.eventId}`)
  }
  const sourcePayload = sourceEvent.payload
  if (!sourcePayload || typeof sourcePayload !== 'object' || !('prompt' in sourcePayload)
    || typeof sourcePayload.prompt !== 'string' || !sourcePayload.prompt.trim()) {
    throw new EngineStoreConflictError(`Kernel dispatch event has no prompt: ${event.eventId}`)
  }
  return sourcePayload.prompt
}
