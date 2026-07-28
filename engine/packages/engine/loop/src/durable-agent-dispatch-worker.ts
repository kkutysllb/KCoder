import {
  KernelCancellationPayloadSchema,
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
import { canonicalDigest } from './execution-fingerprint.js'

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
  private draining: Promise<number> | undefined

  constructor(private readonly options: DurableAgentDispatchWorkerOptions) {
    this.workerId = options.workerId ?? 'qiongqi-local-kernel-worker'
    this.leaseTtlMs = options.leaseTtlMs ?? 30_000
  }

  notify(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.flushAvailable().catch((error) => this.options.onError?.(error))
    })
  }

  flushAvailable(limit = 1_000): Promise<number> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('dispatch flush limit must be a positive integer')
    if (this.draining) return this.draining
    const drain = (async () => {
      let processed = 0
      while (processed < limit && (await this.flushOnce()).processed) processed += 1
      return processed
    })()
    this.draining = drain
    void drain.finally(() => {
      if (this.draining === drain) this.draining = undefined
    }).catch(() => undefined)
    return drain
  }

  async flushOnce(): Promise<DurableAgentDispatchFlushResult> {
    const claim = await this.options.store.claimWork(
      this.workerId,
      ['agent_execution_requested', 'agent_execution_cancel_requested'],
      this.leaseTtlMs
    )
    if (!claim) return { processed: false }

    const cancellation = claim.kind === 'agent_execution_cancel_requested'
      ? KernelCancellationPayloadSchema.parse(claim.payload)
      : undefined
    const dispatch = cancellation ? undefined : KernelDispatchPayloadSchema.parse(claim.payload)
    const scope = cancellation?.executionRef.scope ?? dispatch!.identity.scope
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
      if (cancellation) {
        await this.options.executor.cancel(cancellation.executionRef)
      } else {
        const input = await this.executionInput(dispatch!)
        await this.options.executor.execute(input)
      }
      if (renewalError) throw renewalError
      if (!lease) throw new EngineStoreConflictError(`dispatch work claim lost: ${claim.workId}`)
      await this.options.store.commit({
        scope,
        runId: claim.workId,
        expectedRunVersion: 0,
        expectedTaskRevision: (await this.options.store.loadTask(scope))?.revision ?? 0,
        outboxIntents: [{
          type: 'complete',
          recordId: claim.workId,
          claim: lease,
          payload: cancellation ?? dispatch
        }]
      })
      return { processed: true, workId: claim.workId }
    } finally {
      clearTimer(timer)
    }
  }

  private async executionInput(payload: KernelDispatchPayload): Promise<PreparedAgentExecutionInput> {
    const identity = payload.identity
    const authoritative = await this.resolveAuthoritativeContext(payload)
    return {
      scope: authoritative.scope,
      multiAgentRunId: identity.multiAgentRunId,
      agentRunId: identity.agentRunId,
      agentId: identity.agentId,
      nodeId: identity.nodeId,
      parentRunId: identity.parentRunId,
      threadId: authoritative.threadId,
      turnId: authoritative.turnId,
      workspaceKey: authoritative.workspaceKey,
      requestedBudget: payload.requestedBudget,
      prompt: await this.resolvePrompt(payload.inputRef),
      executionRef: identity.executionRef,
      reservationId: payload.reservationId,
      role: payload.role,
      sharedEvidenceRefs: payload.sharedEvidenceRefs,
      ...authoritative.policies,
      ...(authoritative.graph ? { graph: authoritative.graph } : {})
    }
  }

  private async resolveAuthoritativeContext(payload: KernelDispatchPayload) {
    const identity = payload.identity
    const graphRun = await this.options.store.loadGraphRun(identity.multiAgentRunId)
    if (!graphRun) throw new EngineStoreConflictError(`durable GraphRun not found: ${identity.multiAgentRunId}`)
    const parentRun = await this.options.store.loadRun(identity.multiAgentRunId)
    if (!parentRun) throw new EngineStoreConflictError(`durable parent EngineRun not found: ${identity.multiAgentRunId}`)
    const eventedRun = graphRun.eventedV2Run
    if (!eventedRun || eventedRun.runId !== graphRun.runId
      || eventedRun.threadId !== graphRun.threadId
      || eventedRun.turnId !== graphRun.turnId
      || eventedRun.workspaceKey !== graphRun.workspaceKey
      || !sameValue(graphRun.scope, identity.scope)
      || !sameValue(parentRun.scope, graphRun.scope)
      || parentRun.multiAgentRunId !== graphRun.runId) {
      throw new EngineStoreConflictError('durable root records contradict Kernel dispatch identity')
    }

    const revision = await this.options.store.loadGraphRevision(graphRun.graphId, graphRun.graphRevision)
    if (!revision) {
      throw new EngineStoreConflictError(`pinned GraphRevision not found: ${graphRun.graphId}@${graphRun.graphRevision}`)
    }
    if (revision.graphId !== graphRun.graphId
      || revision.revision !== graphRun.graphRevision
      || revision.graphDigest !== graphRun.graphDigest) {
      throw new EngineStoreConflictError('pinned GraphRevision contradicts durable GraphRun')
    }
    const node = revision.nodes.find((candidate) => candidate.id === identity.nodeId)
    if (!node || (node.kind !== 'agent' && node.kind !== 'judge')) {
      throw new EngineStoreConflictError(`model-driven graph node not found: ${identity.nodeId}`)
    }
    const expectedAgentId = node.kind === 'judge' ? `judge:${node.id}` : node.agentId
    const agentRun = eventedRun.agentRuns.find((candidate) => candidate.agentRunId === identity.agentRunId)
    if (!agentRun
      || agentRun.agentId !== expectedAgentId
      || identity.agentId !== expectedAgentId
      || agentRun.nodeId !== node.id
      || !agentRun.executionRef
      || !sameValue(agentRun.executionRef, identity.executionRef)
      || payload.role !== node.kind) {
      throw new EngineStoreConflictError('durable AgentRun contradicts Kernel dispatch identity')
    }

    const authoritativeGraph = parentRun.graph ? {
      ...parentRun.graph,
      graphId: revision.graphId,
      graphRevision: revision.revision,
      graphDigest: revision.graphDigest,
      nodeId: node.id,
      attemptId: agentRun.agentRunId,
      ...(agentRun.branchId ? { branchId: agentRun.branchId } : {})
    } : undefined
    for (const candidate of [identity.graph, identity.executionRef.graph]) {
      if (candidate && !sameValue(candidate, authoritativeGraph)) {
        throw new EngineStoreConflictError('Kernel dispatch graph correlation contradicts durable graph facts')
      }
    }

    const policies = {
      ...(node.nodePolicyRef ? { nodePolicyRef: node.nodePolicyRef } : {}),
      ...(node.modelPolicyRef ? { modelPolicyRef: node.modelPolicyRef } : {}),
      ...(node.executionPolicyRef ? { executionPolicyRef: node.executionPolicyRef } : {})
    }
    if (payload.modelPolicyRef && !sameValue(payload.modelPolicyRef, node.modelPolicyRef)) {
      throw new EngineStoreConflictError('Kernel dispatch model policy contradicts pinned graph node')
    }
    if ('executionPolicyRef' in payload && payload.executionPolicyRef
      && !sameValue(payload.executionPolicyRef, node.executionPolicyRef)) {
      throw new EngineStoreConflictError('Kernel dispatch execution policy contradicts pinned graph node')
    }
    if (payload.schemaVersion === 3) {
      if (payload.threadId !== graphRun.threadId
        || payload.turnId !== graphRun.turnId
        || payload.workspaceKey !== graphRun.workspaceKey
        || (payload.nodePolicyRef && !sameValue(payload.nodePolicyRef, node.nodePolicyRef))) {
        throw new EngineStoreConflictError('Kernel dispatch context contradicts durable graph facts')
      }
    }

    return {
      scope: graphRun.scope,
      threadId: graphRun.threadId,
      turnId: graphRun.turnId,
      workspaceKey: graphRun.workspaceKey,
      graph: authoritativeGraph,
      policies
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

function sameValue(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right
  return canonicalDigest(left) === canonicalDigest(right)
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
