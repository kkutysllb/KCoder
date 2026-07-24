import { createHash, randomUUID } from 'node:crypto'
import {
  MailboxMessageSchema,
  MultiAgentRunSchema,
  TaskEnvelopeSchema,
  type AgentGraphSnapshot,
  type AgentGraph,
  type AgentRun,
  type MailboxMessage,
  type ManagerRouteDecision,
  type MultiAgentOutboxIntent,
  type MultiAgentRun,
  type PeerArtifact,
  type PeerTask,
  type UsageSnapshot
} from '@qiongqi/contracts'
import type {
  EventedV2WorkerRegistryStore,
  LeaseFence,
  MailboxStore,
  MultiAgentRunStore,
  MultiAgentRunUpdateOptions
} from '@qiongqi/ports'
import { nextNodeForCondition, requireGraphNode, validateAgentGraph } from './multi-agent-graph.js'
import {
  buildEventedV2RunMetrics,
  buildEventedV2RunTimeline,
  type EventedV2RunMetrics,
  type EventedV2RunTimeline
} from './evented-v2-observability.js'

export type AgentLifecycleEvent = {
  threadId: string
  turnId: string
  runId: string
  stage: 'agent_spawn' | 'agent_complete' | 'agent_handoff'
  agentId: string
  nodeId?: string
  prompt?: string
  status?: string
  summary?: string
  targetAgentId?: string
}

export type EventedV2MultiAgentRuntimeOptions = {
  runs: MultiAgentRunStore
  mailbox: MailboxStore
  graph?: AgentGraph
  graphSnapshot?: AgentGraphSnapshot
  ids: (prefix: string) => string
  nowIso: () => string
  leaseHolderId?: string
  leaseTtlMs?: number
  /** Optional callback invoked when an agent lifecycle event occurs.
   * Used by the HTTP layer to emit pipeline_stage SSE events so the
   * frontend can visualise multi-agent activity. */
  onAgentLifecycle?: (event: AgentLifecycleEvent) => void
}

export type EventedV2OutboxReconcilerFlushResult = {
  runIds: string[]
  runsFlushed: number
  startedAt: string
  finishedAt: string
}

export type EventedV2OutboxReconcilerOptions = {
  runtime: Pick<EventedV2MultiAgentRuntime, 'flushAllPendingOutbox'>
  intervalMs: number
  nowIso: () => string
  onFlush?: (result: EventedV2OutboxReconcilerFlushResult) => void
  onError?: (error: unknown) => void
  setInterval?: (callback: () => void | Promise<void>, intervalMs: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export type EventedV2AgentTaskResult = {
  condition?: string
  summary?: string
}

export type EventedV2AgentTaskContext = {
  message: MailboxMessage
}

export type EventedV2AgentWorkerOptions = {
  runtime: Pick<EventedV2MultiAgentRuntime, 'completeAgentTask'>
  mailbox: MailboxStore
  workerId?: string
  leaseTtlMs?: number
}

export type EventedV2AgentWorkerProcessResult = {
  processed: boolean
  runId?: string
  messageId?: string
}

export type EventedV2PeerInvoker = {
  invokePeer(cardId: string, task: PeerTask, signal: AbortSignal): Promise<PeerArtifact>
}

export type EventedV2RemoteAgentCompensationPolicy = {
  statusConditions?: Partial<Record<PeerArtifact['status'], string>>
}

export type EventedV2RemoteAgentWorkerOptions = {
  runtime: Pick<EventedV2MultiAgentRuntime, 'completeAgentTask'>
  mailbox: MailboxStore
  runs?: Pick<MultiAgentRunStore, 'load'>
  peerInvoker: EventedV2PeerInvoker
  agentPeers: Record<string, string>
  compensationPolicy?: EventedV2RemoteAgentCompensationPolicy
  workerId?: string
  leaseTtlMs?: number
  timeoutMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (timer: unknown) => void
}

export type EventedV2RemoteAgentWorkerProcessResult = EventedV2AgentWorkerProcessResult & {
  peerCardId?: string
  peerStatus?: PeerArtifact['status']
}

export type EventedV2RemoteAgentSchedulerFlushResult = {
  agentIds: string[]
  agentsChecked: number
  messagesProcessed: number
  messageIds: string[]
  startedAt: string
  finishedAt: string
}

export type EventedV2RemoteAgentSchedulerSnapshot = {
  workerId: string
  status: 'running' | 'stopped'
  health: 'healthy' | 'degraded' | 'stopped'
  agentIds: string[]
  agentsConfigured: number
  flushesTotal: number
  messagesProcessedTotal: number
  errorsTotal: number
  consecutiveErrors: number
  lastMessageIds: string[]
  lastFlushStartedAt?: string
  lastFlushFinishedAt?: string
  lastHeartbeatAt?: string
}

export type EventedV2RemoteAgentSchedulerOptions = {
  workerId?: string
  workerRegistry?: EventedV2WorkerRegistryStore
  heartbeatTtlMs?: number
  worker: Pick<EventedV2RemoteAgentWorker, 'processNext'>
  agentIds: string[]
  intervalMs: number
  nowIso: () => string
  onFlush?: (result: EventedV2RemoteAgentSchedulerFlushResult) => void
  onError?: (error: unknown) => void
  setInterval?: (callback: () => void | Promise<void>, intervalMs: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export class EventedV2AgentWorker {
  constructor(private readonly options: EventedV2AgentWorkerOptions) {}

  async processNext(input: {
    agentId: string
    handler: (context: EventedV2AgentTaskContext) => Promise<EventedV2AgentTaskResult>
  }): Promise<EventedV2AgentWorkerProcessResult> {
    const message = await this.options.mailbox.claimNext(input.agentId, mailboxClaimOptions({
      workerId: this.options.workerId,
      leaseTtlMs: this.options.leaseTtlMs
    }))
    if (!message) return { processed: false }
    const result = await input.handler({ message })
    await this.options.runtime.completeAgentTask({
      runId: message.runId,
      agentId: input.agentId,
      condition: result.condition ?? 'completed',
      summary: result.summary,
      mailboxCompletion: {
        messageId: message.messageId,
        status: 'completed',
        fence: message.claimLease
      }
    })
    return { processed: true, runId: message.runId, messageId: message.messageId }
  }
}

export class EventedV2RemoteAgentWorker {
  constructor(private readonly options: EventedV2RemoteAgentWorkerOptions) {}

  async processNext(input: {
    agentId: string
    signal?: AbortSignal
  }): Promise<EventedV2RemoteAgentWorkerProcessResult> {
    const message = await this.options.mailbox.claimNext(input.agentId, mailboxClaimOptions({
      workerId: this.options.workerId,
      leaseTtlMs: this.options.leaseTtlMs
    }))
    if (!message) return { processed: false }
    const peerCardId = this.options.agentPeers[input.agentId]
    if (!peerCardId) throw new Error(`No peer binding configured for evented_v2 agent: ${input.agentId}`)
    const run = await this.options.runs?.load(message.runId)
    const invocation = remoteInvocationSignal({
      signal: input.signal,
      timeoutMs: this.options.timeoutMs,
      setTimeout: this.options.setTimeout,
      clearTimeout: this.options.clearTimeout
    })
    const task: PeerTask = {
      prompt: promptFromMailboxMessage(message),
      ...(run?.workspaceKey ? { workspace: run.workspaceKey } : {}),
      label: `evented_v2:${input.agentId}`
    }
    let artifact: PeerArtifact
    try {
      artifact = await this.options.peerInvoker.invokePeer(peerCardId, task, invocation.signal)
    } catch (error) {
      if (!isAbortLikeError(error, invocation.signal)) throw error
      artifact = abortedPeerArtifact(peerCardId, error, invocation.signal)
    } finally {
      invocation.cleanup()
    }
    await this.options.runtime.completeAgentTask({
      runId: message.runId,
      agentId: input.agentId,
      condition: conditionFromPeerArtifact(artifact, this.options.compensationPolicy),
      status: artifact.status,
      summary: artifact.summary ?? artifact.error,
      error: artifact.error,
      peerArtifact: artifact,
      mailboxCompletion: {
        messageId: message.messageId,
        status: artifact.status,
        fence: message.claimLease
      }
    })
    return {
      processed: true,
      runId: message.runId,
      messageId: message.messageId,
      peerCardId,
      peerStatus: artifact.status
    }
  }
}

export class EventedV2RemoteAgentScheduler {
  private timer: unknown
  private inFlight: Promise<EventedV2RemoteAgentSchedulerFlushResult> | undefined
  private flushesTotal = 0
  private messagesProcessedTotal = 0
  private errorsTotal = 0
  private consecutiveErrors = 0
  private lastMessageIds: string[] = []
  private lastFlushStartedAt: string | undefined
  private lastFlushFinishedAt: string | undefined
  private lastHeartbeatAt: string | undefined

  constructor(private readonly options: EventedV2RemoteAgentSchedulerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error(`EventedV2RemoteAgentScheduler intervalMs must be positive: ${options.intervalMs}`)
    }
    if (options.heartbeatTtlMs !== undefined && (!Number.isFinite(options.heartbeatTtlMs) || options.heartbeatTtlMs <= 0)) {
      throw new Error(`EventedV2RemoteAgentScheduler heartbeatTtlMs must be positive: ${options.heartbeatTtlMs}`)
    }
  }

  start(): void {
    if (this.timer) return
    const setTimer = this.options.setInterval ?? setInterval
    this.timer = setTimer(() => {
      return this.flushOnce()
        .then(() => undefined)
        .catch((error) => this.options.onError?.(error))
    }, this.options.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    if (this.options.clearInterval) {
      this.options.clearInterval(this.timer)
    } else {
      clearInterval(this.timer as ReturnType<typeof setInterval>)
    }
    this.timer = undefined
  }

  isRunning(): boolean {
    return Boolean(this.timer)
  }

  snapshot(): EventedV2RemoteAgentSchedulerSnapshot {
    const status = this.isRunning() ? 'running' : 'stopped'
    return {
      workerId: this.options.workerId ?? 'evented_v2_remote_scheduler',
      status,
      health: status === 'stopped' ? 'stopped' : this.consecutiveErrors > 0 ? 'degraded' : 'healthy',
      agentIds: [...this.options.agentIds],
      agentsConfigured: this.options.agentIds.length,
      flushesTotal: this.flushesTotal,
      messagesProcessedTotal: this.messagesProcessedTotal,
      errorsTotal: this.errorsTotal,
      consecutiveErrors: this.consecutiveErrors,
      lastMessageIds: [...this.lastMessageIds],
      ...(this.lastFlushStartedAt !== undefined ? { lastFlushStartedAt: this.lastFlushStartedAt } : {}),
      ...(this.lastFlushFinishedAt !== undefined ? { lastFlushFinishedAt: this.lastFlushFinishedAt } : {}),
      ...(this.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: this.lastHeartbeatAt } : {})
    }
  }

  async flushOnce(): Promise<EventedV2RemoteAgentSchedulerFlushResult> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.flushUnlocked()
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  private async flushUnlocked(): Promise<EventedV2RemoteAgentSchedulerFlushResult> {
    const startedAt = this.options.nowIso()
    this.lastFlushStartedAt = startedAt
    const messageIds: string[] = []
    let messagesProcessed = 0
    let errors = 0
    for (const agentId of this.options.agentIds) {
      try {
        const result = await this.options.worker.processNext({ agentId })
        if (result.processed) {
          messagesProcessed += 1
          if (result.messageId) messageIds.push(result.messageId)
        }
      } catch (error) {
        errors += 1
        this.errorsTotal += 1
        this.options.onError?.(error)
      }
    }
    const finishedAt = this.options.nowIso()
    this.flushesTotal += 1
    this.messagesProcessedTotal += messagesProcessed
    this.consecutiveErrors = errors > 0 ? this.consecutiveErrors + errors : 0
    this.lastMessageIds = [...messageIds]
    this.lastFlushFinishedAt = finishedAt
    this.lastHeartbeatAt = finishedAt
    await this.recordWorkerHeartbeat(finishedAt)
    const result = {
      agentIds: [...this.options.agentIds],
      agentsChecked: this.options.agentIds.length,
      messagesProcessed,
      messageIds,
      startedAt,
      finishedAt
    }
    this.options.onFlush?.(result)
    return result
  }

  private async recordWorkerHeartbeat(heartbeatAt: string): Promise<void> {
    if (!this.options.workerRegistry) return
    try {
      await this.options.workerRegistry.recordHeartbeat({
        workerId: this.options.workerId ?? 'evented_v2_remote_scheduler',
        role: 'remote_agent',
        agentIds: [...this.options.agentIds],
        heartbeatAt,
        ttlMs: this.options.heartbeatTtlMs ?? Math.max(this.options.intervalMs * 3, 1)
      })
    } catch (error) {
      this.errorsTotal += 1
      this.consecutiveErrors += 1
      this.options.onError?.(error)
    }
  }
}

export class EventedV2OutboxReconciler {
  private timer: unknown
  private inFlight: Promise<EventedV2OutboxReconcilerFlushResult> | undefined

  constructor(private readonly options: EventedV2OutboxReconcilerOptions) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new Error(`EventedV2OutboxReconciler intervalMs must be positive: ${options.intervalMs}`)
    }
  }

  start(): void {
    if (this.timer) return
    const setTimer = this.options.setInterval ?? setInterval
    this.timer = setTimer(() => {
      void this.flushOnce().catch((error) => this.options.onError?.(error))
    }, this.options.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    if (this.options.clearInterval) {
      this.options.clearInterval(this.timer)
    } else {
      clearInterval(this.timer as ReturnType<typeof setInterval>)
    }
    this.timer = undefined
  }

  isRunning(): boolean {
    return Boolean(this.timer)
  }

  async flushOnce(): Promise<EventedV2OutboxReconcilerFlushResult> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.flushUnlocked()
      .finally(() => {
        this.inFlight = undefined
      })
    return this.inFlight
  }

  private async flushUnlocked(): Promise<EventedV2OutboxReconcilerFlushResult> {
    const startedAt = this.options.nowIso()
    const runs = await this.options.runtime.flushAllPendingOutbox()
    const result = {
      runIds: runs.map((run) => run.runId),
      runsFlushed: runs.length,
      startedAt,
      finishedAt: this.options.nowIso()
    }
    this.options.onFlush?.(result)
    return result
  }
}

export class EventedV2MultiAgentRuntime {
  private readonly graph: AgentGraph
  private readonly graphSnapshot: AgentGraphSnapshot | undefined
  private readonly runLocks = new Map<string, Promise<void>>()
  private readonly leaseHolderId: string

  constructor(private readonly options: EventedV2MultiAgentRuntimeOptions) {
    if (options.graphSnapshot) {
      this.graphSnapshot = options.graphSnapshot
      this.graph = validateAgentGraph({
        version: 1,
        graphId: options.graphSnapshot.publicKey,
        startNodeId: options.graphSnapshot.startNodeId,
        nodes: options.graphSnapshot.nodes,
        edges: options.graphSnapshot.edges
      })
    } else if (options.graph) {
      this.graph = validateAgentGraph(options.graph)
    } else {
      throw new Error('EventedV2MultiAgentRuntime requires graph or graphSnapshot')
    }
    this.leaseHolderId = options.leaseHolderId ?? `evented_v2:${randomUUID()}`
  }

  async start(input: {
    threadId: string
    turnId: string
    workspaceKey: string
    prompt: string
    routeDecision?: ManagerRouteDecision
  }): Promise<MultiAgentRun> {
    if (this.graphSnapshot) return this.startTeamRun(input)
    const now = this.options.nowIso()
    const startNode = requireGraphNode(this.graph, this.graph.startNodeId)
    if (startNode.kind !== 'agent') throw new Error(`AgentGraph start node must be agent: ${startNode.id}`)
    const run = MultiAgentRunSchema.parse({
      version: 1,
      runId: this.options.ids('mar'),
      threadId: input.threadId,
      turnId: input.turnId,
      workspaceKey: input.workspaceKey,
      status: 'running',
      graphId: this.graph.graphId,
      activeNodeId: startNode.id,
      activeAgentStack: [startNode.agentId],
      branchStatus: {},
      agentRuns: [{
        agentRunId: this.options.ids('agent_run'),
        agentId: startNode.agentId,
        nodeId: startNode.id,
        status: 'running',
        startedAt: now,
        updatedAt: now
      }],
      events: [{
        eventId: this.options.ids('mae'),
        type: 'run_started',
        nodeId: startNode.id,
        agentId: startNode.agentId,
        payload: { prompt: input.prompt },
        timestamp: now
      }],
      retryCounters: {},
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: now,
      updatedAt: now
    })
    await this.options.runs.save(run)
    this.options.onAgentLifecycle?.({
      threadId: input.threadId,
      turnId: input.turnId,
      runId: run.runId,
      stage: 'agent_spawn',
      agentId: startNode.agentId,
      nodeId: startNode.id,
      prompt: input.prompt
    })
    return run
  }

  async startRun(input: {
    threadId: string
    turnId: string
    workspaceKey: string
    prompt: string
    routeDecision?: ManagerRouteDecision
  }): Promise<MultiAgentRun> {
    return this.start(input)
  }

  private async startTeamRun(input: {
    threadId: string
    turnId: string
    workspaceKey: string
    prompt: string
    routeDecision?: ManagerRouteDecision
  }): Promise<MultiAgentRun> {
    const graphSnapshot = this.requireTeamGraphSnapshot()
    const now = this.options.nowIso()
    const startNode = requireGraphNode(this.graph, graphSnapshot.startNodeId)
    if (startNode.kind !== 'agent' || startNode.id !== 'manager_planning') {
      throw new Error(`team graph start node must be manager_planning: ${startNode.id}`)
    }
    const specialistNodeIds = (input.routeDecision?.specialists ?? [])
      .map((specialist) => `specialist:${specialist.specialistId}`)
    const run = MultiAgentRunSchema.parse({
      version: 1,
      runId: this.options.ids('mar'),
      threadId: input.threadId,
      turnId: input.turnId,
      workspaceKey: input.workspaceKey,
      status: 'running',
      graphId: graphSnapshot.publicKey,
      graphSnapshot,
      ...(input.routeDecision ? { routeDecision: input.routeDecision } : {}),
      activeNodeId: startNode.id,
      activeNodeIds: [startNode.id],
      runnableNodeIds: [],
      activeAgentStack: [startNode.agentId],
      branchStatus: Object.fromEntries(specialistNodeIds.map((nodeId) => [nodeId, 'queued'])),
      agentRuns: [this.createTeamAgentRun({
        nodeId: startNode.id,
        agentId: startNode.agentId,
        sequence: 1,
        now
      })],
      events: [{
        eventId: this.options.ids('mae'),
        type: 'run_started',
        nodeId: startNode.id,
        agentId: startNode.agentId,
        payload: { prompt: input.prompt },
        timestamp: now
      }],
      retryCounters: {},
      nextPublicSequence: 2,
      warnings: [],
      budgets: { stepsUsed: 0, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      createdAt: now,
      updatedAt: now
    })
    await this.options.runs.save(run)
    this.emitAgentSpawn(run, startNode.agentId, startNode.id, input.prompt)
    return run
  }

  async applyRouteDecision(input: {
    runId: string
    graphSnapshot: AgentGraphSnapshot
    routeDecision: ManagerRouteDecision
  }): Promise<MultiAgentRun> {
    return this.withRunLock(input.runId, () => this.withRunMutationLease(input.runId, async (fence) =>
      this.options.runs.update(input.runId, (current) => {
        if (current.routeDecision) {
          if (JSON.stringify(current.routeDecision) !== JSON.stringify(input.routeDecision)) {
            throw new Error(`MultiAgentRun route decision is immutable: ${input.runId}`)
          }
          return current
        }
        if (current.graphSnapshot?.publicKey !== input.graphSnapshot.publicKey) {
          throw new Error(`MultiAgentRun graph public key cannot change: ${input.runId}`)
        }
        const branchStatus = Object.fromEntries(input.routeDecision.specialists.map((specialist) => [
          `specialist:${specialist.specialistId}`,
          'queued'
        ]))
        return MultiAgentRunSchema.parse({
          ...current,
          graphId: input.graphSnapshot.publicKey,
          graphSnapshot: input.graphSnapshot,
          routeDecision: input.routeDecision,
          branchStatus,
          updatedAt: this.options.nowIso()
        })
      }, updateOptions(fence))))
  }

  async handoff(input: {
    runId: string
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }): Promise<MultiAgentRun> {
    return this.withRunLock(input.runId, () =>
      this.withRunMutationLease(input.runId, (fence) => this.handoffUnlocked(input, fence)))
  }

  private async handoffUnlocked(input: {
    runId: string
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }, fence?: LeaseFence): Promise<MultiAgentRun> {
    const next = await this.options.runs.update(
      input.runId,
      (current) => this.applyHandoff(current, input),
      updateOptions(fence)
    )
    this.options.onAgentLifecycle?.({
      threadId: next.threadId,
      turnId: next.turnId,
      runId: input.runId,
      stage: 'agent_handoff',
      agentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      prompt: input.prompt
    })
    return this.flushPendingOutboxUnlocked(next.runId, fence)
  }

  private applyHandoff(current: MultiAgentRun, input: {
    runId: string
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }): MultiAgentRun {
    if (current.graphId !== this.graph.graphId) {
      throw new Error(`MultiAgentRun graph mismatch: ${current.graphId} !== ${this.graph.graphId}`)
    }
    const idempotencyKey = handoffIdempotencyKey({
      graphId: current.graphId,
      runId: current.runId,
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      prompt: input.prompt
    })
    const envelopeId = `env_${idempotencyKey}`
    const activeNode = requireGraphNode(this.graph, current.activeNodeId)
    const activeStackAgentId = current.activeAgentStack.at(-1)
    if (
      activeNode.kind === 'agent' &&
      activeNode.agentId === input.targetAgentId &&
      activeStackAgentId === input.targetAgentId
    ) {
      const deliveredEventExists = current.events.some((event) =>
        event.type === 'handoff_delivered' &&
        event.agentId === input.targetAgentId &&
        event.envelopeId === envelopeId
      )
      if (deliveredEventExists) {
        const run = MultiAgentRunSchema.parse(current)
        return this.ensureHandoffOutboxIntent(run, input, envelopeId)
      }
    }
    if (activeNode.kind !== 'agent') throw new Error(`Handoff active node must be agent: ${activeNode.id}`)
    if (activeNode.agentId !== input.sourceAgentId) {
      throw new Error(`Handoff source mismatch: ${activeNode.agentId} !== ${input.sourceAgentId}`)
    }
    if (activeStackAgentId !== input.sourceAgentId) {
      throw new Error(`Handoff source stack mismatch: ${activeStackAgentId ?? '<empty>'} !== ${input.sourceAgentId}`)
    }
    const handoffNodeId = nextNodeForCondition(this.graph, activeNode.id, 'handoff')
    if (!handoffNodeId) throw new Error(`No handoff edge from node: ${activeNode.id}`)
    const handoffNode = requireGraphNode(this.graph, handoffNodeId)
    if (handoffNode.kind !== 'handoff') throw new Error(`Expected handoff node: ${handoffNodeId}`)
    if (handoffNode.targetAgentId !== input.targetAgentId) {
      throw new Error(`Handoff target mismatch: ${handoffNode.targetAgentId} !== ${input.targetAgentId}`)
    }
    const targetNodeId = nextNodeForCondition(this.graph, handoffNode.id, 'accepted')
    if (!targetNodeId) throw new Error(`No accepted edge from handoff node: ${handoffNode.id}`)
    const targetNode = requireGraphNode(this.graph, targetNodeId)
    if (targetNode.kind !== 'agent') throw new Error(`Handoff target node must be agent: ${targetNodeId}`)
    if (targetNode.agentId !== input.targetAgentId) {
      throw new Error(`Handoff accepted target mismatch: ${targetNode.agentId} !== ${input.targetAgentId}`)
    }
    const now = this.options.nowIso()
    const hasTargetAgentRun = current.agentRuns.some((agentRun) =>
      agentRun.agentId === targetNode.agentId && agentRun.nodeId === targetNode.id
    )
    const hasHandoffRequestedEvent = current.events.some((event) =>
      event.type === 'handoff_requested' &&
      event.nodeId === handoffNode.id &&
      event.agentId === input.sourceAgentId &&
      event.envelopeId === envelopeId
    )
    const hasHandoffDeliveredEvent = current.events.some((event) =>
      event.type === 'handoff_delivered' &&
      event.nodeId === targetNode.id &&
      event.agentId === targetNode.agentId &&
      event.envelopeId === envelopeId
    )
    const next = MultiAgentRunSchema.parse({
      ...current,
      activeNodeId: targetNode.id,
      activeAgentStack: [...current.activeAgentStack, targetNode.agentId],
      agentRuns: hasTargetAgentRun ? current.agentRuns : [...current.agentRuns, {
        agentRunId: this.options.ids('agent_run'),
        agentId: targetNode.agentId,
        nodeId: targetNode.id,
        status: 'queued',
        startedAt: now,
        updatedAt: now
      }],
      events: [
        ...current.events,
        ...(hasHandoffRequestedEvent ? [] : [{
          eventId: this.options.ids('mae'),
          type: 'handoff_requested',
          nodeId: handoffNode.id,
          agentId: input.sourceAgentId,
          envelopeId,
          timestamp: now
        }]),
        ...(hasHandoffDeliveredEvent ? [] : [{
          eventId: this.options.ids('mae'),
          type: 'handoff_delivered',
          nodeId: targetNode.id,
          agentId: targetNode.agentId,
          envelopeId,
          timestamp: now
        }])
      ],
      updatedAt: now
    })
    return this.ensureHandoffOutboxIntent(next, input, envelopeId)
  }

  private createHandoffMessage(run: MultiAgentRun, input: {
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }, envelopeId: string): MailboxMessage {
    const now = this.options.nowIso()
    const envelope = TaskEnvelopeSchema.parse({
      envelopeId,
      kind: 'handoff',
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      threadId: run.threadId,
      turnId: run.turnId,
      parentRunId: run.runId,
      payload: { prompt: input.prompt },
      createdAt: now
    })
    return MailboxMessageSchema.parse({
      messageId: `msg_${envelopeId.replace(/^env_/, '')}`,
      envelopeId: envelope.envelopeId,
      runId: run.runId,
      fromAgentId: input.sourceAgentId,
      toAgentId: input.targetAgentId,
      status: 'queued',
      payload: envelope.payload,
      createdAt: now,
      updatedAt: now
    })
  }

  private ensureHandoffOutboxIntent(run: MultiAgentRun, input: {
    sourceAgentId: string
    targetAgentId: string
    prompt: string
  }, envelopeId: string): MultiAgentRun {
    const existing = run.outbox.find((intent) => intent.kind === 'mailbox_enqueue' && intent.message.envelopeId === envelopeId)
    if (existing) return MultiAgentRunSchema.parse(run)
    const now = this.options.nowIso()
    const message = this.createHandoffMessage(run, input, envelopeId)
    const intent: MultiAgentOutboxIntent = {
      outboxId: `outbox_${envelopeId.replace(/^env_/, '')}`,
      kind: 'mailbox_enqueue',
      status: 'pending',
      message,
      createdAt: now,
      updatedAt: now
    }
    return MultiAgentRunSchema.parse({
      ...run,
      outbox: [...run.outbox, intent],
      updatedAt: now
    })
  }

  async flushPendingOutbox(runId: string): Promise<MultiAgentRun> {
    return this.withRunLock(runId, () =>
      this.withRunMutationLease(runId, (fence) => this.flushPendingOutboxUnlocked(runId, fence)))
  }

  async completeAgentTask(input: {
    runId: string
    agentId: string
    condition?: string
    status?: 'completed' | 'failed' | 'aborted'
    summary?: string
    usage?: UsageSnapshot
    error?: string
    peerArtifact?: PeerArtifact
    mailboxCompletion?: {
      messageId: string
      status: 'completed' | 'failed' | 'aborted'
      fence?: MailboxMessage['claimLease']
    }
  }): Promise<MultiAgentRun> {
    if (this.graphSnapshot) return this.completeTeamAgentTask(input)
    return this.withRunLock(input.runId, () =>
      this.withRunMutationLease(input.runId, async (fence) => {
        const next = await this.options.runs.update(input.runId, (current) => {
          const activeNode = requireGraphNode(this.graph, current.activeNodeId)
          if (activeNode.kind !== 'agent') throw new Error(`Active node must be agent to complete task: ${activeNode.id}`)
          if (activeNode.agentId !== input.agentId) {
            throw new Error(`Agent task completion mismatch: ${activeNode.agentId} !== ${input.agentId}`)
          }
          const now = this.options.nowIso()
          const condition = input.condition ?? 'completed'
          const status = input.status ?? agentRunStatusFromCondition(condition)
          const nextNodeId = nextNodeForCondition(this.graph, activeNode.id, condition)
          if (!nextNodeId) throw new Error(`No ${condition} edge from node: ${activeNode.id}`)
          const agentRunIndex = latestAgentRunIndex(current, input.agentId, activeNode.id)
          const withCompletedAgent = MultiAgentRunSchema.parse({
            ...current,
            agentRuns: current.agentRuns.map((agentRun, index) =>
              index === agentRunIndex
                ? {
                    ...agentRun,
                    status,
                    summary: input.summary ?? agentRun.summary,
                    ...(input.usage !== undefined ? { usage: input.usage } : {}),
                    ...(input.error !== undefined ? { error: input.error } : {}),
                    ...(input.peerArtifact !== undefined ? { peerArtifact: input.peerArtifact } : {}),
                    completedAt: agentRun.completedAt ?? now,
                    updatedAt: now
                  }
                : agentRun
            ),
            events: [...current.events, {
              eventId: this.options.ids('mae'),
              type: 'node_completed',
              nodeId: activeNode.id,
              agentId: input.agentId,
              payload: {
                condition,
                summary: input.summary,
                ...(input.error !== undefined ? { error: input.error } : {}),
                ...(input.peerArtifact !== undefined ? { peerArtifact: input.peerArtifact } : {}),
                ...(input.mailboxCompletion !== undefined ? { messageId: input.mailboxCompletion.messageId } : {})
              },
              timestamp: now
            }],
            updatedAt: now
          })
          const advanced = this.enterGraphNode(withCompletedAgent, nextNodeId)
          return input.mailboxCompletion
            ? this.ensureMailboxCompleteOutboxIntent(advanced, input.mailboxCompletion)
            : advanced
        }, updateOptions(fence))
        const condition = input.condition ?? 'completed'
        const status = input.status ?? agentRunStatusFromCondition(condition)
        this.options.onAgentLifecycle?.({
          threadId: next.threadId,
          turnId: next.turnId,
          runId: input.runId,
          stage: 'agent_complete',
          agentId: input.agentId,
          status,
          summary: input.summary
        })
        return input.mailboxCompletion ? this.flushPendingOutboxUnlocked(next.runId, fence) : next
      }))
  }

  private async completeTeamAgentTask(input: {
    runId: string
    agentId: string
    condition?: string
    status?: 'completed' | 'failed' | 'aborted'
    summary?: string
    usage?: UsageSnapshot
    error?: string
    peerArtifact?: PeerArtifact
    mailboxCompletion?: {
      messageId: string
      status: 'completed' | 'failed' | 'aborted'
      fence?: MailboxMessage['claimLease']
    }
  }): Promise<MultiAgentRun> {
    return this.withRunLock(input.runId, () =>
      this.withRunMutationLease(input.runId, async (fence) => {
        const next = await this.options.runs.update(input.runId, (current) => {
          const advanced = this.applyTeamAgentCompletion(current, input)
          return input.mailboxCompletion
            ? this.ensureMailboxCompleteOutboxIntent(advanced, input.mailboxCompletion)
            : advanced
        }, updateOptions(fence))
        const status = input.status ?? agentRunStatusFromCondition(input.condition ?? 'completed')
        this.options.onAgentLifecycle?.({
          threadId: next.threadId,
          turnId: next.turnId,
          runId: input.runId,
          stage: 'agent_complete',
          agentId: input.agentId,
          status,
          summary: input.summary
        })
        return input.mailboxCompletion ? this.flushPendingOutboxUnlocked(next.runId, fence) : next
      }))
  }

  async allocatePublicSequence(runId: string): Promise<number> {
    let allocated: number | undefined
    await this.withRunLock(runId, () => this.withRunMutationLease(runId, async (fence) => {
      await this.options.runs.update(runId, (current) => {
        allocated = current.nextPublicSequence
        return MultiAgentRunSchema.parse({
          ...current,
          nextPublicSequence: current.nextPublicSequence + 1,
          updatedAt: this.options.nowIso()
        })
      }, updateOptions(fence))
    }))
    if (allocated === undefined) throw new Error(`MultiAgentRun sequence allocation failed: ${runId}`)
    return allocated
  }

  async abortRun(runId: string, reason?: string): Promise<MultiAgentRun> {
    return this.withRunLock(runId, () => this.withRunMutationLease(runId, async (fence) =>
      this.options.runs.update(runId, (current) => {
        if (isRunTerminal(current.status)) return current
        const now = this.options.nowIso()
        const activeNodeIds = new Set(current.activeNodeIds)
        return MultiAgentRunSchema.parse({
          ...current,
          status: 'aborted',
          activeNodeIds: [],
          runnableNodeIds: [],
          branchStatus: Object.fromEntries(Object.entries(current.branchStatus).map(([nodeId, status]) => [
            nodeId,
            status === 'running' || status === 'queued' ? 'aborted' : status
          ])),
          agentRuns: current.agentRuns.map((agentRun) => activeNodeIds.has(agentRun.nodeId)
            ? { ...agentRun, status: 'aborted', error: reason, completedAt: now, updatedAt: now }
            : agentRun),
          events: [...current.events, {
            eventId: this.options.ids('mae'),
            type: 'run_failed',
            payload: { status: 'aborted', reason },
            timestamp: now
          }],
          updatedAt: now
        })
      }, updateOptions(fence))))
  }

  async completeExternalNode(input: {
    runId: string
    nodeId: string
    condition: string
    payload?: Record<string, unknown>
  }): Promise<MultiAgentRun> {
    return this.withRunLock(input.runId, () => this.withRunMutationLease(input.runId, async (fence) =>
      this.options.runs.update(input.runId, (current) => {
      const activeNode = requireGraphNode(this.graph, current.activeNodeId)
      if (activeNode.id !== input.nodeId) {
        throw new Error(`External node completion mismatch: ${activeNode.id} !== ${input.nodeId}`)
      }
      if (!['wait', 'tool', 'judge'].includes(activeNode.kind)) {
        throw new Error(`Active node is not externally completable: ${activeNode.id}`)
      }
      const nextNodeId = nextNodeForCondition(this.graph, activeNode.id, input.condition)
      if (!nextNodeId) throw new Error(`No ${input.condition} edge from node: ${activeNode.id}`)
      const now = this.options.nowIso()
      const withCompletedNode = MultiAgentRunSchema.parse({
        ...current,
        events: [...current.events, {
          eventId: this.options.ids('mae'),
          type: 'node_completed',
          nodeId: activeNode.id,
          payload: { condition: input.condition, ...input.payload },
          timestamp: now
        }],
        updatedAt: now
      })
      return this.enterGraphNode(withCompletedNode, nextNodeId)
    }, updateOptions(fence))))
  }

  async flushAllPendingOutbox(): Promise<MultiAgentRun[]> {
    const pending = await this.options.runs.listWithPendingOutbox()
    const flushed: MultiAgentRun[] = []
    for (const run of pending) {
      flushed.push(await this.flushPendingOutbox(run.runId))
    }
    return flushed
  }

  private async flushPendingOutboxUnlocked(runId: string, fence?: LeaseFence): Promise<MultiAgentRun> {
    const current = await this.options.runs.load(runId)
    if (!current) throw new Error(`MultiAgentRun not found: ${runId}`)
    let latest = MultiAgentRunSchema.parse(current)
    for (const intent of latest.outbox.filter((candidate) => candidate.status === 'pending')) {
      if (intent.kind === 'mailbox_enqueue') await this.options.mailbox.enqueue(intent.message)
      if (intent.kind === 'mailbox_complete') await this.options.mailbox.complete(intent.messageId, intent.mailboxStatus, intent.claimLease)
      latest = await this.options.runs.update(
        runId,
        (run) => this.markOutboxPublished(run, intent.outboxId),
        updateOptions(fence)
      )
    }
    return latest
  }

  private markOutboxPublished(run: MultiAgentRun, outboxId: string): MultiAgentRun {
    const now = this.options.nowIso()
    return MultiAgentRunSchema.parse({
      ...run,
      outbox: run.outbox.map((intent) => intent.outboxId === outboxId
        ? { ...intent, status: 'published', updatedAt: now, publishedAt: intent.publishedAt ?? now }
        : intent),
      updatedAt: now
    })
  }

  private ensureMailboxCompleteOutboxIntent(run: MultiAgentRun, completion: {
    messageId: string
    status: 'completed' | 'failed' | 'aborted'
    fence?: MailboxMessage['claimLease']
  }): MultiAgentRun {
    const existing = run.outbox.find((intent) => intent.kind === 'mailbox_complete' && intent.messageId === completion.messageId)
    if (existing) return MultiAgentRunSchema.parse(run)
    const now = this.options.nowIso()
    const intent: MultiAgentOutboxIntent = {
      outboxId: `outbox_complete_${completion.messageId}`,
      kind: 'mailbox_complete',
      status: 'pending',
      messageId: completion.messageId,
      mailboxStatus: completion.status,
      ...(completion.fence !== undefined ? { claimLease: completion.fence } : {}),
      createdAt: now,
      updatedAt: now
    }
    return MultiAgentRunSchema.parse({
      ...run,
      outbox: [...run.outbox, intent],
      updatedAt: now
    })
  }

  private applyTeamAgentCompletion(current: MultiAgentRun, input: {
    agentId: string
    condition?: string
    status?: 'completed' | 'failed' | 'aborted'
    summary?: string
    usage?: UsageSnapshot
    error?: string
    peerArtifact?: PeerArtifact
  }): MultiAgentRun {
    const graphSnapshot = this.requireTeamGraphSnapshot()
    if (current.graphSnapshot?.publicKey !== graphSnapshot.publicKey) {
      throw new Error(`MultiAgentRun graph snapshot mismatch: ${current.graphId}`)
    }
    if (isRunTerminal(current.status)) return current
    const nodeId = current.activeNodeIds.find((candidate) => {
      const node = requireGraphNode(this.graph, candidate)
      return node.kind === 'agent' && node.agentId === input.agentId
    })
    if (!nodeId) throw new Error(`Active AgentRun not found for completion: ${input.agentId}`)
    const agentRunIndex = latestAgentRunIndex(current, input.agentId, nodeId)
    const agentRun = current.agentRuns[agentRunIndex]
    if (!agentRun) throw new Error(`AgentRun not found for completion: ${input.agentId}/${nodeId}`)
    const now = this.options.nowIso()
    const status = input.status ?? agentRunStatusFromCondition(input.condition ?? 'completed')
    const completed = MultiAgentRunSchema.parse({
      ...current,
      activeNodeIds: current.activeNodeIds.filter((candidate) => candidate !== nodeId),
      agentRuns: current.agentRuns.map((candidate, index) => index === agentRunIndex
        ? {
            ...candidate,
            status,
            summary: input.summary ?? candidate.summary,
            ...(input.usage !== undefined ? { usage: input.usage } : {}),
            ...(input.error !== undefined ? { error: input.error } : {}),
            ...(input.peerArtifact !== undefined ? { peerArtifact: input.peerArtifact } : {}),
            completedAt: now,
            updatedAt: now
          }
        : candidate),
      events: [...current.events, {
        eventId: this.options.ids('mae'),
        type: 'node_completed',
        nodeId,
        agentId: input.agentId,
        payload: { status, summary: input.summary, error: input.error },
        timestamp: now
      }],
      updatedAt: now
    })

    if (nodeId === 'manager_planning') {
      return status === 'completed'
        ? this.advanceTeamRun(completed)
        : this.finishTeamRun(completed, status === 'aborted' ? 'aborted' : 'failed', input.error)
    }
    if (nodeId === 'manager_synthesis') {
      return status === 'completed'
        ? this.finishTeamRun(completed, 'completed')
        : this.finishTeamRun(completed, status === 'aborted' ? 'aborted' : 'failed', input.error)
    }

    const specialist = current.routeDecision?.specialists.find((candidate) =>
      `specialist:${candidate.specialistId}` === nodeId)
    if (!specialist) throw new Error(`Route decision missing specialist node: ${nodeId}`)
    if (status !== 'completed' && agentRun.attempt <= graphSnapshot.budgets.maxRetriesPerNode) {
      const retriedAgentRuns = completed.agentRuns.map((candidate, index) => {
        if (index !== agentRunIndex) return candidate
        const { completedAt: _completedAt, ...retryable } = candidate
        return {
          ...retryable,
          status: 'running' as const,
          attempt: candidate.attempt + 1,
          updatedAt: now
        }
      })
      return MultiAgentRunSchema.parse({
        ...completed,
        activeNodeId: nodeId,
        activeNodeIds: [...completed.activeNodeIds, nodeId],
        branchStatus: { ...completed.branchStatus, [nodeId]: 'running' },
        agentRuns: retriedAgentRuns,
        retryCounters: { ...completed.retryCounters, [nodeId]: agentRun.attempt },
        events: [...completed.events, {
          eventId: this.options.ids('mae'),
          type: 'node_started',
          nodeId,
          agentId: input.agentId,
          payload: { retry: true, attempt: agentRun.attempt + 1 },
          timestamp: now
        }],
        updatedAt: now
      })
    }

    const terminalBranch = MultiAgentRunSchema.parse({
      ...completed,
      branchStatus: { ...completed.branchStatus, [nodeId]: status },
      warnings: status !== 'completed' && !specialist.required
        ? appendUnique(completed.warnings, `Optional specialist ${specialist.specialistId} did not complete`)
        : completed.warnings
    })
    if (status !== 'completed' && specialist.required) {
      return this.finishTeamRun(terminalBranch, 'failed', input.error)
    }
    return this.advanceTeamRun(terminalBranch)
  }

  private advanceTeamRun(run: MultiAgentRun): MultiAgentRun {
    const snapshot = this.requireTeamGraphSnapshot()
    const decision = run.routeDecision
    if (!decision) throw new Error(`MultiAgentRun route decision missing: ${run.runId}`)
    let next = MultiAgentRunSchema.parse(run)

    // A specialist whose dependency terminated unsuccessfully cannot run.
    let changed = true
    while (changed) {
      changed = false
      for (const specialist of decision.specialists) {
        const nodeId = `specialist:${specialist.specialistId}`
        if (next.branchStatus[nodeId] !== 'queued') continue
        const blocked = specialist.dependsOn.some((dependency) => {
          const status = next.branchStatus[`specialist:${dependency}`]
          return status === 'failed' || status === 'aborted'
        })
        if (!blocked) continue
        changed = true
        next = MultiAgentRunSchema.parse({
          ...next,
          branchStatus: { ...next.branchStatus, [nodeId]: 'failed' },
          warnings: specialist.required
            ? next.warnings
            : appendUnique(next.warnings, `Optional specialist ${specialist.specialistId} did not complete`)
        })
        if (specialist.required) {
          return this.finishTeamRun(next, 'failed', `Required specialist ${specialist.specialistId} was blocked`)
        }
      }
    }

    const activeSpecialists = next.activeNodeIds.filter((nodeId) => nodeId.startsWith('specialist:'))
    const ready = decision.specialists
      .map((specialist) => ({ specialist, nodeId: `specialist:${specialist.specialistId}` }))
      .filter(({ specialist, nodeId }) =>
        next.branchStatus[nodeId] === 'queued' &&
        specialist.dependsOn.every((dependency) => next.branchStatus[`specialist:${dependency}`] === 'completed'))
      .map(({ nodeId }) => nodeId)
    const available = Math.max(0, snapshot.budgets.maxParallelNodes - activeSpecialists.length)
    const toStart = ready.slice(0, available)
    const runnableNodeIds = ready.slice(available)
    next = MultiAgentRunSchema.parse({ ...next, runnableNodeIds })
    for (const nodeId of toStart) next = this.startTeamAgentNode(next, nodeId)

    const specialistsTerminal = decision.specialists.every((specialist) => {
      const status = next.branchStatus[`specialist:${specialist.specialistId}`]
      return status === 'completed' || status === 'failed' || status === 'aborted'
    })
    const activeAfterStart = next.activeNodeIds.some((nodeId) => nodeId.startsWith('specialist:'))
    if (specialistsTerminal && !activeAfterStart && next.runnableNodeIds.length === 0) {
      return this.startTeamAgentNode(this.completeTeamJoin(next), 'manager_synthesis')
    }
    const firstActive = next.activeNodeIds[0]
    return MultiAgentRunSchema.parse({
      ...next,
      status: 'running',
      activeNodeId: firstActive ?? next.activeNodeId
    })
  }

  private startTeamAgentNode(run: MultiAgentRun, nodeId: string): MultiAgentRun {
    if (run.activeNodeIds.includes(nodeId)) return run
    const existing = run.agentRuns.find((agentRun) => agentRun.nodeId === nodeId)
    if (existing) return run
    const node = requireGraphNode(this.graph, nodeId)
    if (node.kind !== 'agent') throw new Error(`team runnable node must be agent: ${nodeId}`)
    const now = this.options.nowIso()
    const sequence = run.nextPublicSequence
    const agentRun = this.createTeamAgentRun({ nodeId, agentId: node.agentId, sequence, now, run })
    const activeNodeIds = [...run.activeNodeIds, nodeId]
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'running',
      activeNodeId: activeNodeIds[0] ?? nodeId,
      activeNodeIds,
      runnableNodeIds: run.runnableNodeIds.filter((candidate) => candidate !== nodeId),
      activeAgentStack: [...run.activeAgentStack, node.agentId],
      branchStatus: nodeId.startsWith('specialist:')
        ? { ...run.branchStatus, [nodeId]: 'running' }
        : run.branchStatus,
      agentRuns: [...run.agentRuns, agentRun],
      nextPublicSequence: sequence + 1,
      events: [...run.events, {
        eventId: this.options.ids('mae'),
        type: 'node_started',
        nodeId,
        agentId: node.agentId,
        timestamp: now
      }],
      updatedAt: now
    })
  }

  private completeTeamJoin(run: MultiAgentRun): MultiAgentRun {
    const alreadyCompleted = run.events.some((event) =>
      event.type === 'node_completed' && event.nodeId === 'join')
    if (alreadyCompleted) return run
    const now = this.options.nowIso()
    return MultiAgentRunSchema.parse({
      ...run,
      activeNodeId: 'join',
      events: [
        ...run.events,
        {
          eventId: this.options.ids('mae'),
          type: 'node_started',
          nodeId: 'join',
          timestamp: now
        },
        {
          eventId: this.options.ids('mae'),
          type: 'node_completed',
          nodeId: 'join',
          payload: { warnings: run.warnings },
          timestamp: now
        }
      ],
      updatedAt: now
    })
  }

  private createTeamAgentRun(input: {
    nodeId: string
    agentId: string
    sequence: number
    now: string
    run?: MultiAgentRun
  }): AgentRun {
    const specialist = input.run?.routeDecision?.specialists.find((candidate) =>
      `specialist:${candidate.specialistId}` === input.nodeId)
    const role = input.nodeId.startsWith('manager_') ? 'manager' : 'specialist'
    const phase = input.nodeId === 'manager_planning'
      ? 'planning'
      : input.nodeId === 'manager_synthesis'
        ? 'synthesis'
        : 'execution'
    return {
      agentRunId: this.options.ids('agent_run'),
      agentId: input.agentId,
      nodeId: input.nodeId,
      publicKey: this.options.ids('agent'),
      sequence: input.sequence,
      role,
      phase,
      transcriptRef: this.options.ids('transcript'),
      attempt: 1,
      ...(specialist ? { task: specialist.task, required: specialist.required } : {}),
      status: 'running',
      startedAt: input.now,
      updatedAt: input.now
    }
  }

  private finishTeamRun(
    run: MultiAgentRun,
    status: 'completed' | 'failed' | 'aborted',
    error?: string
  ): MultiAgentRun {
    if (run.status === status && isRunTerminal(run.status)) return run
    const now = this.options.nowIso()
    const activeNodeIds = new Set(run.activeNodeIds)
    const abortRemaining = status !== 'completed'
    return MultiAgentRunSchema.parse({
      ...run,
      status,
      activeNodeIds: [],
      runnableNodeIds: [],
      branchStatus: abortRemaining
        ? Object.fromEntries(Object.entries(run.branchStatus).map(([nodeId, branchStatus]) => [
            nodeId,
            branchStatus === 'queued' || branchStatus === 'running' ? 'aborted' : branchStatus
          ]))
        : run.branchStatus,
      agentRuns: abortRemaining
        ? run.agentRuns.map((agentRun) => activeNodeIds.has(agentRun.nodeId)
          ? {
              ...agentRun,
              status: 'aborted',
              ...(error !== undefined ? { error } : {}),
              completedAt: now,
              updatedAt: now
            }
          : agentRun)
        : run.agentRuns,
      events: [...run.events, {
        eventId: this.options.ids('mae'),
        type: status === 'completed' ? 'run_completed' : 'run_failed',
        payload: status === 'completed' ? undefined : { status, error },
        timestamp: now
      }],
      updatedAt: now
    })
  }

  private requireTeamGraphSnapshot(): AgentGraphSnapshot {
    if (!this.graphSnapshot) throw new Error('team graph snapshot is not configured')
    return this.graphSnapshot
  }

  private emitAgentSpawn(run: MultiAgentRun, agentId: string, nodeId: string, prompt?: string): void {
    this.options.onAgentLifecycle?.({
      threadId: run.threadId,
      turnId: run.turnId,
      runId: run.runId,
      stage: 'agent_spawn',
      agentId,
      nodeId,
      prompt
    })
  }

  private enterGraphNode(run: MultiAgentRun, nodeId: string): MultiAgentRun {
    const node = requireGraphNode(this.graph, nodeId)
    const now = this.options.nowIso()
    if (node.kind === 'terminate') {
      const hasRunCompleted = run.events.some((event) => event.type === 'run_completed')
      return MultiAgentRunSchema.parse({
        ...run,
        status: 'completed',
        activeNodeId: node.id,
        events: [
          ...run.events,
          ...(hasRunCompleted ? [] : [{
            eventId: this.options.ids('mae'),
            type: 'run_completed',
            nodeId: node.id,
            timestamp: now
          }])
        ],
        updatedAt: now
      })
    }
    if (node.kind === 'agent') {
      const hasActiveAgentRun = run.agentRuns.some((agentRun) =>
        agentRun.agentId === node.agentId &&
        agentRun.nodeId === node.id &&
        ['queued', 'running'].includes(agentRun.status)
      )
      return MultiAgentRunSchema.parse({
        ...run,
        status: 'running',
        activeNodeId: node.id,
        activeAgentStack: [...run.activeAgentStack, node.agentId],
        agentRuns: hasActiveAgentRun ? run.agentRuns : [...run.agentRuns, {
          agentRunId: this.options.ids('agent_run'),
          agentId: node.agentId,
          nodeId: node.id,
          status: 'queued',
          startedAt: now,
          updatedAt: now
        }],
        updatedAt: now
      })
    }
    if (node.kind === 'join') {
      const ready = node.requiredBranchIds.every((branchId) => run.branchStatus[branchId] === 'completed')
      if (ready) {
        const nextNodeId = nextNodeForCondition(this.graph, node.id, 'completed') ?? nextNodeForCondition(this.graph, node.id, 'joined')
        if (nextNodeId) {
          return this.enterGraphNode(MultiAgentRunSchema.parse({
            ...run,
            activeNodeId: node.id,
            events: [
              ...run.events,
              {
                eventId: this.options.ids('mae'),
                type: 'node_started',
                nodeId: node.id,
                timestamp: now
              },
              {
                eventId: this.options.ids('mae'),
                type: 'node_completed',
                nodeId: node.id,
                payload: { condition: 'completed' },
                timestamp: now
              }
            ],
            updatedAt: now
          }), nextNodeId)
        }
      }
    }
    if (node.kind === 'retry') {
      const attempts = (run.retryCounters[node.id] ?? 0) + 1
      const condition = attempts <= node.maxAttempts ? 'retry' : 'exhausted'
      const nextNodeId = nextNodeForCondition(this.graph, node.id, condition)
      if (nextNodeId) {
        return this.enterGraphNode(MultiAgentRunSchema.parse({
          ...run,
          activeNodeId: node.id,
          retryCounters: { ...run.retryCounters, [node.id]: attempts },
          events: [
            ...run.events,
            {
              eventId: this.options.ids('mae'),
              type: 'node_started',
              nodeId: node.id,
              timestamp: now
            },
            {
              eventId: this.options.ids('mae'),
              type: 'node_completed',
              nodeId: node.id,
              payload: { condition, attempts, maxAttempts: node.maxAttempts },
              timestamp: now
            }
          ],
          updatedAt: now
        }), nextNodeId)
      }
    }
    return MultiAgentRunSchema.parse({
      ...run,
      status: 'suspended',
      activeNodeId: node.id,
      events: [...run.events, {
        eventId: this.options.ids('mae'),
        type: 'node_started',
        nodeId: node.id,
        timestamp: now
      }],
      updatedAt: now
    })
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous
      .catch(() => undefined)
      .then(() => gate)
    this.runLocks.set(runId, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.runLocks.get(runId) === current) this.runLocks.delete(runId)
    }
  }

  private async withRunMutationLease<T>(runId: string, operation: (fence?: LeaseFence) => Promise<T>): Promise<T> {
    if (!this.options.runs.acquireLease || !this.options.runs.releaseLease) return operation()
    const holderId = this.leaseHolderId
    const ttlMs = this.options.leaseTtlMs ?? 30_000
    const lease = await this.acquireRunMutationLease(runId, holderId, ttlMs)
    if (!lease.acquired || !lease.fence) throw new Error(`MultiAgentRun lease unavailable: ${runId}`)
    try {
      return await operation(lease.fence)
    } finally {
      await this.options.runs.releaseLease(runId, holderId, lease.fence)
    }
  }

  private async acquireRunMutationLease(runId: string, holderId: string, ttlMs: number): Promise<{
    acquired: boolean
    expiresAt?: string
    fence?: LeaseFence
  }> {
    if (!this.options.runs.acquireLease) return { acquired: true }
    const deadline = Date.now() + ttlMs
    for (;;) {
      const lease = await this.options.runs.acquireLease(runId, holderId, ttlMs)
      if (lease.acquired) return lease
      if (Date.now() >= deadline) return lease
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  async trace(runId: string): Promise<string[]> {
    const run = await this.options.runs.load(runId)
    if (!run) throw new Error(`MultiAgentRun not found: ${runId}`)
    return run.events.map((event) => `${event.type}:${event.agentId ?? event.nodeId ?? 'runtime'}`)
  }

  async timeline(runId: string): Promise<EventedV2RunTimeline> {
    const run = await this.options.runs.load(runId)
    if (!run) throw new Error(`MultiAgentRun not found: ${runId}`)
    return buildEventedV2RunTimeline(run)
  }

  async metrics(): Promise<EventedV2RunMetrics> {
    return buildEventedV2RunMetrics(await this.options.runs.listAll())
  }
}

function updateOptions(fence: LeaseFence | undefined): MultiAgentRunUpdateOptions | undefined {
  return fence ? { fence } : undefined
}

function promptFromMailboxMessage(message: MailboxMessage): string {
  const prompt = message.payload.prompt
  return typeof prompt === 'string' && prompt.trim() ? prompt : JSON.stringify(message.payload)
}

function conditionFromPeerArtifact(
  artifact: PeerArtifact,
  compensationPolicy?: EventedV2RemoteAgentCompensationPolicy
): string {
  const mappedCondition = compensationPolicy?.statusConditions?.[artifact.status]
  if (mappedCondition) return mappedCondition
  return {
    completed: 'completed',
    failed: 'failed',
    aborted: 'aborted'
  }[artifact.status]
}

function abortedPeerArtifact(peerCardId: string, error: unknown, signal: AbortSignal): PeerArtifact {
  return {
    peerCardId,
    status: 'aborted',
    error: errorMessage(signal.reason ?? error)
  }
}

function remoteInvocationSignal(input: {
  signal?: AbortSignal
  timeoutMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (timer: unknown) => void
}): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  let timer: unknown
  const setTimer = input.setTimeout ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = input.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const abortFromParent = () => {
    controller.abort(input.signal?.reason ?? new Error('evented_v2 remote agent task aborted'))
  }
  if (input.signal?.aborted) {
    abortFromParent()
  } else {
    input.signal?.addEventListener('abort', abortFromParent, { once: true })
  }
  if (input.timeoutMs !== undefined && input.timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimer(() => {
      controller.abort(new Error(`evented_v2 remote agent task timed out after ${input.timeoutMs}ms`))
    }, input.timeoutMs)
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer !== undefined) clearTimer(timer)
      input.signal?.removeEventListener('abort', abortFromParent)
    }
  }
}

function mailboxClaimOptions(input: {
  workerId?: string
  leaseTtlMs?: number
}): { holderId: string; ttlMs: number } | undefined {
  if (!input.workerId || input.leaseTtlMs === undefined) return undefined
  return { holderId: input.workerId, ttlMs: input.leaseTtlMs }
}

function isAbortLikeError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  return error instanceof Error && error.name === 'AbortError'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function agentRunStatusFromCondition(condition: string): 'completed' | 'failed' | 'aborted' {
  if (condition === 'failed') return 'failed'
  if (condition === 'aborted') return 'aborted'
  return 'completed'
}

function appendUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value]
}

function isRunTerminal(status: MultiAgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

function latestAgentRunIndex(run: MultiAgentRun, agentId: string, nodeId: string): number {
  for (let index = run.agentRuns.length - 1; index >= 0; index -= 1) {
    const agentRun = run.agentRuns[index]
    if (agentRun?.agentId === agentId && agentRun.nodeId === nodeId) return index
  }
  throw new Error(`AgentRun not found for completion: ${agentId}/${nodeId}`)
}

function handoffIdempotencyKey(input: {
  graphId: string
  runId: string
  sourceAgentId: string
  targetAgentId: string
  prompt: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      input.graphId,
      input.runId,
      input.sourceAgentId,
      input.targetAgentId,
      input.prompt
    ]))
    .digest('hex')
    .slice(0, 32)
}
