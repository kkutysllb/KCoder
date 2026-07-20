import { randomUUID } from 'node:crypto'
import {
  ModelProposalSchema,
  TaskStateV1Schema,
  type RunEventEnvelope,
  type RunIdentity,
  type RunOutcome,
  type RunStateV3
} from '@qiongqi/contracts'
import type { LeaseFence, RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { MiddlewareChain } from './middleware-chain.js'
import {
  outgoingEdges,
  validateExecutionGraph,
  type ExecutionGraph,
  type RuntimeNode
} from './execution-graph.js'
import type { MiddlewareCommand, RuntimeHook } from './runtime-middleware.js'
import { canonicalizeMiddlewareCommands } from './runtime-middleware-command-validator.js'
import type { RuntimeNodeHandler, RuntimeNodeResult } from './runtime-kernel-context.js'

export type RuntimeKernelOptions = {
  graph: ExecutionGraph
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  nowIso?: () => string
  leaseTtlMs?: number
  middleware?: MiddlewareChain
  nodes: Record<string, RuntimeNodeHandler>
  crashPoint?: (point: RuntimeKernelCrashPoint) => Promise<void> | void
}

export type RuntimeKernelCrashPoint =
  | 'after_node_completed'
  | 'after_node_middleware'
  | 'after_node_after_middleware_event'

type CompletedNodePayload = {
  nodeId: string
  stepIndex: number
  condition: string
  commands: MiddlewareCommand[]
  facts?: Record<string, unknown>
  value?: unknown
  outcome?: RunOutcome
}

type AfterMiddlewarePayload = {
  nodeId: string
  stepIndex: number
  commands: MiddlewareCommand[]
  outcome?: RunOutcome
}

type PendingAfterMiddleware = {
  node: RuntimeNode
  completed: CompletedNodePayload
}

class RuntimeKernelCrash extends Error {
  constructor(readonly original: unknown) {
    super('runtime kernel crash injection')
  }
}

class RuntimeLeaseLost extends Error {
  constructor(readonly terminalOutcome?: RunOutcome) {
    super('runtime lease unavailable')
  }
}

class RuntimeLeaseGuard {
  private readonly renewIntervalMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private renewInFlight: Promise<boolean> | undefined
  private stopped = false
  private lost = false

  constructor(
    private readonly leases: RunLeaseStore,
    private readonly identity: RunIdentity,
    private readonly holderId: string,
    private readonly ttlMs: number,
    private readonly fence?: LeaseFence
  ) {
    this.renewIntervalMs = Math.max(1, Math.floor(ttlMs / 3))
  }

  start(): void {
    this.schedule()
  }

  async assertHealthy(): Promise<void> {
    if (this.lost || this.stopped || !(await this.renew())) throw new RuntimeLeaseLost()
  }

  isLost(): boolean {
    return this.lost
  }

  getFence(): LeaseFence | undefined { return this.fence }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    // A provider may never resolve. Cleanup must remain bounded.
  }

  private schedule(): void {
    if (this.stopped || this.lost) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick()
    }, this.renewIntervalMs)
    const ownedTimer = this.timer as ReturnType<typeof setTimeout> & { unref?: () => void }
    ownedTimer.unref?.()
  }

  private async tick(): Promise<void> {
    const renewed = await this.renew()
    if (renewed) this.schedule()
  }

  private async renew(): Promise<boolean> {
    if (this.stopped || this.lost) return false
    if (this.renewInFlight) return this.renewInFlight
    const timeout = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), Math.max(1, Math.floor(this.ttlMs / 2)))
      ;(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()
    })
    const operation = Promise.race([
      Promise.resolve().then(() => this.fence
        ? this.leases.renew(this.identity, this.holderId, this.fence, this.ttlMs)
        : this.leases.renew(this.identity, this.holderId, this.ttlMs)),
      timeout
    ])
      .then((renewed) => {
        if (!renewed) this.lost = true
        return renewed
      })
      .catch(() => {
        this.lost = true
        return false
      })
    this.renewInFlight = operation
    try {
      return await operation
    } finally {
      if (this.renewInFlight === operation) this.renewInFlight = undefined
    }
  }
}

export class RuntimeKernel {
  private readonly options: Omit<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware' | 'crashPoint'> &
    Required<Pick<RuntimeKernelOptions, 'nowIso' | 'leaseTtlMs' | 'middleware'>> &
    Pick<RuntimeKernelOptions, 'crashPoint'>

  constructor(options: RuntimeKernelOptions) {
    validateExecutionGraph(options.graph)
    const ttlMs = options.leaseTtlMs ?? 30_000
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('leaseTtlMs must be a positive safe integer')
    this.options = {
      nowIso: () => new Date().toISOString(),
      leaseTtlMs: 30_000,
      middleware: new MiddlewareChain(),
      ...options
    }
  }

  async run(identity: RunIdentity): Promise<RunOutcome> {
    const { leases, snapshots, holderId } = this.options
    const lease = await leases.acquire(identity, holderId, this.options.leaseTtlMs)
    if (!lease.acquired) {
      return {
        status: 'failed',
        reason: 'runtime_error',
        retryable: true,
        details: { code: 'lease_unavailable' }
      }
    }
    const fence = lease.fence
    const leaseGuard = new RuntimeLeaseGuard(
      leases,
      identity,
      holderId,
      this.options.leaseTtlMs,
      fence
    )
    leaseGuard.start()

    try {
      let state = await snapshots.load(identity)
      if (!state) state = this.initialState(identity)
      this.assertStateIdentity(identity, state)
      await this.assertLeaseHealthy(leaseGuard, state)
      if (isTerminal(state)) {
        const checkpointSeq = state.cursor.checkpointSeq
        state = await this.replayAfterCheckpoint(identity, state, leaseGuard)
        if (state.cursor.checkpointSeq > checkpointSeq) {
          // afterRun is best-effort observability/cleanup only.
          // Production correctness must not depend on it.
          await this.options.middleware.run(
            'afterRun',
            this.middlewareContext(identity, state, 'afterRun')
          )
        }
        const outcome = outcomeFromTerminalState(state)
        const migrated = this.migrateTerminalGraphMetadata(state)
        if (migrated !== state || state.cursor.checkpointSeq > checkpointSeq) {
          await snapshots.save(migrated, fence)
        }
        return outcome
      }
      const graphCompatibility = this.graphCompatibility(state)
      if (graphCompatibility) return graphCompatibility

      const replayCheckpointSeq = state.cursor.checkpointSeq
      state = await this.replayAfterCheckpoint(identity, state, leaseGuard)
      if (isTerminal(state)) {
        if (state.cursor.checkpointSeq > replayCheckpointSeq) {
          await this.options.middleware.run(
            'afterRun',
            this.middlewareContext(identity, state, 'afterRun')
          )
        }
        state = this.migrateTerminalGraphMetadata(state)
        await snapshots.save(state, fence)
        return outcomeFromTerminalState(state)
      }

      state = this.migrateGraphState(state)
      await snapshots.save(state, fence)

      state = { ...state, status: 'running', updatedAt: this.options.nowIso() }
      await snapshots.save(state, fence)

      const beforeRun = await this.options.middleware.run(
        'beforeRun',
        this.middlewareContext(identity, state, 'beforeRun')
      )
      await this.assertLeaseHealthy(leaseGuard, state)
      const beforeRunCommands = canonicalizeMiddlewareCommands(beforeRun?.commands ?? [])
      const beforeRunOutcome = this.commandOutcome(beforeRunCommands)
      if (beforeRunOutcome) {
        state = this.withOutcome(this.applyCommands(state, beforeRunCommands), beforeRunOutcome)
        await snapshots.save(state, fence)
        return beforeRunOutcome
      }

      while (true) {
        const node = this.nodeFor(state.cursor.nodeId)
        await this.assertLeaseHealthy(leaseGuard, state)
        if (checkpointsBefore(node)) await snapshots.save(state, fence)

        const started = await this.recordEvent(identity, state, node.id, 'node.started', {
          nodeId: node.id,
          stepIndex: state.cursor.stepIndex
        }, fence)
        state = {
          ...state,
          cursor: { ...state.cursor, checkpointSeq: started.seq },
          updatedAt: this.options.nowIso()
        }

        const before = await this.options.middleware.run(
          'beforeNode',
          this.middlewareContext(identity, state, 'beforeNode', node)
        )
        await this.assertLeaseHealthy(leaseGuard, state)
        const beforeCommands = canonicalizeMiddlewareCommands(before?.commands ?? [])
        const beforeOutcome = this.commandOutcome(beforeCommands)
        if (beforeOutcome) {
          state = this.withOutcome(this.applyCommands(state, beforeCommands), beforeOutcome)
          await snapshots.save(state, fence)
          return beforeOutcome
        }

        const handler = this.options.nodes[node.id]
        if (!handler) throw new Error(`missing runtime node handler: ${node.id}`)
        const result = await handler({ identity, state, node, hook: 'beforeNode', leaseFence: fence })
        await this.assertLeaseHealthy(leaseGuard, state)
        const commands = canonicalizeMiddlewareCommands([
          ...beforeCommands,
          ...(result?.commands ?? [])
        ])
        this.applyCommands(state, commands)
        const condition = result?.condition ?? 'next'
        const outcome = result?.outcome
          ?? this.commandOutcome(commands)
          ?? (node.terminal
            ? { status: 'completed', reason: 'normal_stop', retryable: false } as const
            : undefined)
        const facts = result?.facts === undefined
          ? undefined
          : canonicalizeFacts(result.facts)
        const payload: CompletedNodePayload = {
          nodeId: node.id,
          stepIndex: state.cursor.stepIndex,
          condition,
          commands,
          ...(facts ? { facts } : {}),
          ...(result && 'value' in result ? { value: result.value } : {}),
          ...(outcome ? { outcome } : {})
        }
        const completed = await this.recordEvent(
          identity,
          state,
          node.id,
          'node.completed',
          payload,
          fence
        )
        await this.reachCrashPoint('after_node_completed')
        const committedPayload = parseCompletedNodePayload(completed.payload)
        state = this.reduceCompletedNode(state, node, committedPayload, completed.seq)
        state = await this.commitAfterMiddleware(identity, state, {
          node,
          completed: committedPayload
        }, leaseGuard)
        if (checkpointsAfter(node) || isTerminal(state)) await snapshots.save(state, fence)
        if (isTerminal(state)) {
          // Terminal outcomes are monotonic. Middleware may record diagnostics,
          // but cannot reopen or replace an already committed terminal result.
          await this.options.middleware.run(
            'afterRun',
            this.middlewareContext(identity, state, 'afterRun')
          )
          return outcomeFromTerminalState(state)
        }

      }
    } catch (error) {
      if (error instanceof RuntimeKernelCrash) throw error.original
      if (error instanceof RuntimeLeaseLost || leaseGuard.isLost() || isFenceError(error)) {
        if (error instanceof RuntimeLeaseLost && error.terminalOutcome) {
          return error.terminalOutcome
        }
        const persisted = await snapshots.load(identity)
        if (persisted && isTerminal(persisted)) return outcomeFromTerminalState(persisted)
        return leaseUnavailableOutcome()
      }
      const outcome: RunOutcome = {
        status: 'failed',
        reason: 'runtime_error',
        retryable: true,
        details: { message: error instanceof Error ? error.message : String(error) }
      }
      const state = await snapshots.load(identity)
      if (state) {
        await this.options.middleware.run(
          'onError',
          this.middlewareContext(identity, state, 'onError', undefined, undefined, error)
        )
      }
      if (state && !isTerminal(state)) {
        try { await snapshots.save(this.withOutcome(state, outcome), fence) } catch { /* lease loss makes this write intentionally best effort */ }
      }
      return state && isTerminal(state) ? outcomeFromTerminalState(state) : outcome
    } finally {
      await leaseGuard.stop()
      try { await leases.release(identity, holderId, fence) } catch { /* best effort cleanup */ }
    }
  }

  private initialState(identity: RunIdentity): RunStateV3 {
    const now = this.options.nowIso()
    return {
      version: 3,
      graphVersion: this.options.graph.version,
      runtimeMode: 'kernel_v3',
      ...identity,
      status: 'created',
      cursor: {
        stepIndex: 0,
        nodeId: this.options.graph.startNodeId,
        attempt: 0,
        checkpointSeq: 0
      },
      budgets: {
        stepsUsed: 0,
        toolCallsUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
      },
      recovery: { attempts: 0, maxAttempts: 1 },
      middleware: {},
      nodeData: {},
      taskRevision: 0,
      pendingEffects: [],
      committedEffects: [],
      createdAt: now,
      updatedAt: now
    }
  }

  private graphCompatibility(state: RunStateV3): RunOutcome | undefined {
    const targetVersion = this.options.graph.version
    if (state.graphVersion === targetVersion) return undefined
    if (
      state.graphVersion === 'kernel-v3-production-v1'
      && targetVersion === 'kernel-v3-production-v2'
    ) {
      return undefined
    }
    if (
      targetVersion === 'kernel-v3-production-v3'
      && (state.graphVersion === 'kernel-v3-production-v1'
        || state.graphVersion === 'kernel-v3-production-v2')
    ) {
      return undefined
    }
    return {
      status: 'failed',
      reason: 'runtime_error',
      retryable: false,
      details: {
        code: 'unsupported_graph_version',
        storedGraphVersion: state.graphVersion,
        runtimeGraphVersion: targetVersion
      }
    }
  }

  private migrateGraphState(state: RunStateV3): RunStateV3 {
    if (state.graphVersion === this.options.graph.version) return state
    if (
      state.graphVersion === 'kernel-v3-production-v2'
      && this.options.graph.version === 'kernel-v3-production-v3'
    ) {
      if (!proposalNeedsAccounting(state.cursor.nodeId)) {
        return { ...state, graphVersion: this.options.graph.version }
      }
      requireMigratableProposal(state, 'production graph v2')
      return {
        ...state,
        graphVersion: this.options.graph.version,
        cursor: { ...state.cursor, nodeId: 'account-model' },
        nodeData: state.cursor.nodeId === 'evaluate'
          ? state.nodeData
          : {
              ...state.nodeData,
              'v2-accounting-migration': {
                resumeNodeId: state.cursor.nodeId === 'commit-tools'
                  ? 'prepare-tools'
                  : state.cursor.nodeId,
                consumed: false
              }
            }
      }
    }
    if (
      state.graphVersion !== 'kernel-v3-production-v1'
      || (this.options.graph.version !== 'kernel-v3-production-v2'
        && this.options.graph.version !== 'kernel-v3-production-v3')
    ) {
      return state
    }
    const revalidatesProposal = state.cursor.nodeId === 'prepare-tools'
      || state.cursor.nodeId === 'commit-tools'
      || state.cursor.nodeId === 'commit-assistant'
    if (!revalidatesProposal) {
      if (
        this.options.graph.version === 'kernel-v3-production-v3'
        && proposalNeedsAccounting(state.cursor.nodeId)
      ) {
        requireMigratableProposal(state, 'production graph v1')
        return {
          ...state,
          graphVersion: this.options.graph.version,
          cursor: { ...state.cursor, nodeId: 'account-model' },
          nodeData: state.cursor.nodeId === 'evaluate'
            ? state.nodeData
            : {
                ...state.nodeData,
                'v1-accounting-migration': {
                  resumeNodeId: state.cursor.nodeId,
                  consumed: false
                }
              }
        }
      }
      return { ...state, graphVersion: this.options.graph.version }
    }
    const proposal = ModelProposalSchema.safeParse(state.nodeData['normalize-proposal'])
    const task = TaskStateV1Schema.safeParse(state.nodeData['restore-task'])
    const requiresToolProposal = state.cursor.nodeId !== 'commit-assistant'
    if (
      !proposal.success
      || !task.success
      || (requiresToolProposal && proposal.data.toolIntents.length === 0)
    ) {
      throw new Error(
        'production graph v1 tool snapshot is missing a normalized tool proposal or task state'
      )
    }
    const prepared = state.cursor.nodeId === 'commit-tools'
      ? preparedCallIds(state.nodeData['prepare-tools'])
      : []
    if (state.cursor.nodeId === 'commit-tools' && prepared.length === 0) {
      throw new Error('production graph v1 commit-tools snapshot is missing prepared calls')
    }
    return {
      ...state,
      graphVersion: this.options.graph.version,
      cursor: {
        ...state.cursor,
        nodeId: this.options.graph.version === 'kernel-v3-production-v3'
          ? 'account-model'
          : 'evaluate'
      },
      nodeData: prepared.length > 0
        ? {
            ...state.nodeData,
            'v1-proposal-migration': {
              sourceNodeId: state.cursor.nodeId,
              preparedCallIds: prepared,
              reconciled: false,
              abortFinishedAt: this.options.nowIso()
            }
          }
        : state.nodeData
    }
  }

  private migrateTerminalGraphMetadata(state: RunStateV3): RunStateV3 {
    if (
      state.graphVersion === 'kernel-v3-production-v1'
      && this.options.graph.version === 'kernel-v3-production-v2'
    ) {
      return { ...state, graphVersion: this.options.graph.version }
    }
    if (
      this.options.graph.version === 'kernel-v3-production-v3'
      && (state.graphVersion === 'kernel-v3-production-v1'
        || state.graphVersion === 'kernel-v3-production-v2')
    ) {
      return { ...state, graphVersion: this.options.graph.version }
    }
    return state
  }

  private async replayAfterCheckpoint(
    identity: RunIdentity,
    initial: RunStateV3,
    leaseGuard: RuntimeLeaseGuard
  ): Promise<RunStateV3> {
    let state = initial
    const initialCheckpointSeq = state.cursor.checkpointSeq
    const events = await this.options.events.listAfter(
      identity,
      Math.max(0, initialCheckpointSeq - 1)
    )
    let pending: PendingAfterMiddleware | undefined
    for (const event of events.sort((left, right) => left.seq - right.seq)) {
      this.assertEventIdentity(identity, event)
      if (event.seq < initialCheckpointSeq) continue
      if (event.seq === initialCheckpointSeq) {
        if (event.eventType === 'node.completed') {
          const completed = parseCompletedNodePayload(event.payload)
          pending = { node: this.nodeFor(completed.nodeId), completed }
        }
        continue
      }
      if (pending && event.eventType !== 'node.after_middleware') {
        state = await this.commitAfterMiddleware(identity, state, pending, leaseGuard)
        pending = undefined
      }
      if (event.eventType === 'node.started') {
        state = {
          ...state,
          cursor: {
            ...state.cursor,
            checkpointSeq: Math.max(state.cursor.checkpointSeq, event.seq)
          },
          updatedAt: event.timestamp
        }
        continue
      }
      if (event.eventType === 'node.completed') {
        const completed = parseCompletedNodePayload(event.payload)
        if (completed.nodeId !== state.cursor.nodeId) {
          throw new Error(
            `run event cursor mismatch: expected ${state.cursor.nodeId}, received ${completed.nodeId}`
          )
        }
        const node = this.nodeFor(completed.nodeId)
        state = this.reduceCompletedNode(state, node, completed, event.seq)
        pending = { node, completed }
        continue
      }
      if (event.eventType === 'node.after_middleware') {
        if (!pending) throw new Error('node.after_middleware has no matching completion')
        const after = parseAfterMiddlewarePayload(event.payload)
        assertAfterMiddlewareMatches(pending.completed, after)
        state = this.reduceAfterMiddleware(state, after, event.seq)
        pending = undefined
      }
    }
    if (pending) state = await this.commitAfterMiddleware(identity, state, pending, leaseGuard)
    return state
  }

  private async commitAfterMiddleware(
    identity: RunIdentity,
    state: RunStateV3,
    pending: PendingAfterMiddleware,
    leaseGuard: RuntimeLeaseGuard
  ): Promise<RunStateV3> {
    await this.assertLeaseHealthy(leaseGuard, state)
    const result = await this.options.middleware.run(
      'afterNode',
      this.middlewareContext(
        identity,
        state,
        'afterNode',
        pending.node,
        pending.completed.facts
      )
    )
    await this.assertLeaseHealthy(leaseGuard, state)
    const commands = canonicalizeMiddlewareCommands(result?.commands ?? [])
    this.applyCommands(state, commands)
    await this.reachCrashPoint('after_node_middleware')
    const payload = canonicalizeJsonObject({
      nodeId: pending.node.id,
      stepIndex: pending.completed.stepIndex,
      commands,
      ...(this.commandOutcome(commands) ? { outcome: this.commandOutcome(commands) } : {})
    }, 'node.after_middleware payload')
    const recorded = await this.recordEvent(
      identity,
      state,
      pending.node.id,
      'node.after_middleware',
      payload,
      leaseGuard.getFence()
    )
    const committed = parseAfterMiddlewarePayload(recorded.payload)
    assertAfterMiddlewareMatches(pending.completed, committed)
    const next = this.reduceAfterMiddleware(state, committed, recorded.seq)
    await this.reachCrashPoint('after_node_after_middleware_event')
    return next
  }

  private async assertLeaseHealthy(
    leaseGuard: RuntimeLeaseGuard,
    state: RunStateV3
  ): Promise<void> {
    try {
      await leaseGuard.assertHealthy()
    } catch (error) {
      if (error instanceof RuntimeLeaseLost && isTerminal(state)) {
        throw new RuntimeLeaseLost(outcomeFromTerminalState(state))
      }
      throw error
    }
  }

  private reduceAfterMiddleware(
    state: RunStateV3,
    payload: AfterMiddlewarePayload,
    checkpointSeq: number
  ): RunStateV3 {
    let next = state
    if (!isTerminal(next)) {
      next = this.applyCommands(next, payload.commands)
      const outcome = payload.outcome ?? this.commandOutcome(payload.commands)
      if (outcome) next = this.withOutcome(next, outcome)
    }
    if (!isTerminal(next)) {
      const control = this.middlewareControlTarget(payload.commands, next.cursor.nodeId)
      if (control) {
        this.nodeFor(control.nodeId)
        next = {
          ...next,
          cursor: {
            ...next.cursor,
            nodeId: control.nodeId,
            attempt: next.cursor.attempt + 1
          }
        }
      }
    }
    return {
      ...next,
      cursor: {
        ...next.cursor,
        checkpointSeq: Math.max(next.cursor.checkpointSeq, checkpointSeq)
      },
      updatedAt: this.options.nowIso()
    }
  }

  private middlewareControlTarget(
    commands: readonly MiddlewareCommand[],
    defaultNodeId: string
  ): { nodeId: string; reason: string } | undefined {
    const jump = [...commands].reverse().find(
      (command): command is Extract<MiddlewareCommand, { type: 'jump' }> => command.type === 'jump'
    )
    if (jump) return { nodeId: jump.nodeId, reason: jump.reason }

    const retry = [...commands].reverse().find(
      (command): command is Extract<MiddlewareCommand, { type: 'retry' }> => command.type === 'retry'
    )
    if (!retry) return undefined

    // A middleware retry is a LangGraph-style re-entry into the model path.
    // Production Kernel v3 names that boundary `build-context`; small custom
    // graphs without it retry the completed node itself.
    const promptNode = this.options.graph.nodes.find((node) => node.id === 'build-context')
    return { nodeId: promptNode?.id ?? defaultNodeId, reason: retry.reason }
  }

  private reduceCompletedNode(
    state: RunStateV3,
    node: RuntimeNode,
    payload: CompletedNodePayload,
    checkpointSeq: number
  ): RunStateV3 {
    let next = this.applyCommands(state, payload.commands)
    if ('value' in payload) {
      next = {
        ...next,
        nodeData: { ...next.nodeData, [node.id]: payload.value }
      }
    }
    if (payload.outcome) {
      return {
        ...this.withOutcome(next, payload.outcome),
        cursor: {
          ...next.cursor,
          checkpointSeq: Math.max(next.cursor.checkpointSeq, checkpointSeq)
        },
        updatedAt: this.options.nowIso()
      }
    }

    const jump = [...payload.commands].reverse().find((command) => command.type === 'jump')
    const edge = jump
      ? { to: jump.nodeId, loop: false }
      : outgoingEdges(this.options.graph, node.id, payload.condition)[0]
    if (!edge) throw new Error(`no graph edge for ${node.id} condition ${payload.condition}`)
    this.nodeFor(edge.to)
    return {
      ...next,
      status: 'running',
      cursor: {
        stepIndex: next.cursor.stepIndex + 1,
        nodeId: edge.to,
        attempt: edge.loop ? next.cursor.attempt + 1 : 0,
        checkpointSeq: Math.max(next.cursor.checkpointSeq, checkpointSeq)
      },
      updatedAt: this.options.nowIso()
    }
  }

  private middlewareContext(
    identity: RunIdentity,
    state: RunStateV3,
    hook: RuntimeHook,
    node?: RuntimeNode,
    facts?: Readonly<Record<string, unknown>>,
    error?: unknown
  ) {
    return { identity, state, node, hook, facts, error, commands: [] as const }
  }

  private applyCommands(
    state: RunStateV3,
    commands: readonly MiddlewareCommand[] | undefined
  ): RunStateV3 {
    let next = state
    let processedUsageIds: Set<string> | undefined
    for (const command of canonicalizeMiddlewareCommands(commands ?? [])) {
      if (command.type === 'set-middleware-state') {
        next = {
          ...next,
          middleware: { ...next.middleware, [command.id]: command.state }
        }
        if (command.id === 'budget-accounting') processedUsageIds = undefined
      }
      if (command.type === 'set-budget') {
        next = { ...next, budgets: { ...next.budgets, [command.key]: command.value } }
      }
      if (command.type === 'add-budget') {
        processedUsageIds ??= budgetUsageIdSet(next)
        next = addBudget(next, command, processedUsageIds)
      }
      if (command.type === 'set-node-data') {
        next = { ...next, nodeData: { ...next.nodeData, [command.nodeId]: command.value } }
      }
      if (command.type === 'set-task-revision') {
        if (command.revision < next.taskRevision) {
          throw new Error(
            `task revision cannot move backwards: ${next.taskRevision} -> ${command.revision}`
          )
        }
        next = { ...next, taskRevision: command.revision }
      }
      if (command.type === 'set-recovery') {
        next = { ...next, recovery: command.recovery }
      }
      if (command.type === 'set-effects') {
        next = {
          ...next,
          pendingEffects: command.pendingEffects,
          committedEffects: command.committedEffects
        }
      }
    }
    return next
  }

  private commandOutcome(commands: readonly MiddlewareCommand[] | undefined): RunOutcome | undefined {
    const command = commands?.find(
      (candidate) => candidate.type === 'terminate' || candidate.type === 'suspend'
    )
    return command?.type === 'terminate' || command?.type === 'suspend'
      ? command.outcome
      : undefined
  }

  private withOutcome(state: RunStateV3, outcome: RunOutcome): RunStateV3 {
    if (isTerminal(state)) return state
    return {
      ...state,
      status: outcome.status,
      outcome,
      updatedAt: this.options.nowIso()
    }
  }

  private nodeFor(nodeId: string): RuntimeNode {
    const node = this.options.graph.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`unknown graph node: ${nodeId}`)
    return node
  }

  private assertStateIdentity(identity: RunIdentity, state: RunStateV3): void {
    for (const field of identityFields) {
      if (state[field] !== identity[field]) {
        throw new Error(`run state identity mismatch: ${field}`)
      }
    }
  }

  private assertEventIdentity(identity: RunIdentity, event: RunEventEnvelope): void {
    for (const field of identityFields) {
      if (event[field] !== identity[field]) {
        throw new Error(`run event identity mismatch: ${field}`)
      }
    }
  }

  private async recordEvent(
    identity: RunIdentity,
    state: RunStateV3,
    nodeId: string,
    eventType: string,
    payload: unknown,
    fence?: LeaseFence
  ): Promise<RunEventEnvelope> {
    const existing = await this.options.events.listAfter(identity, 0)
    const seq = existing.reduce((max, event) => Math.max(max, event.seq), 0) + 1
    return this.options.events.append({
      eventId: randomUUID(),
      seq,
      ...identity,
      stepId: nodeId,
      nodeAttemptId: `${nodeId}:${state.cursor.attempt}`,
      eventType,
      payload,
      timestamp: this.options.nowIso()
    }, fence)
  }

  private async reachCrashPoint(point: RuntimeKernelCrashPoint): Promise<void> {
    if (!this.options.crashPoint) return
    try {
      await this.options.crashPoint(point)
    } catch (error) {
      throw new RuntimeKernelCrash(error)
    }
  }
}

const identityFields = [
  'ownerUserId',
  'workspaceKey',
  'threadId',
  'turnId',
  'runId'
] as const

function checkpointsBefore(node: RuntimeNode): boolean {
  return node.checkpoint === 'before' || node.checkpoint === 'both'
}

function checkpointsAfter(node: RuntimeNode): boolean {
  return node.checkpoint === 'after' || node.checkpoint === 'both'
}

function isTerminal(state: RunStateV3): boolean {
  return state.status === 'completed'
    || state.status === 'degraded'
    || state.status === 'failed'
    || state.status === 'aborted'
    || state.status === 'suspended'
}

function outcomeFromTerminalState(state: RunStateV3): RunOutcome {
  return state.outcome ?? {
    status: state.status as RunOutcome['status'],
    reason: 'runtime_error',
    retryable: false
  }
}

function leaseUnavailableOutcome(): RunOutcome {
  return {
    status: 'failed',
    reason: 'runtime_error',
    retryable: true,
    details: { code: 'lease_unavailable' }
  }
}

function isFenceError(error: unknown): boolean {
  return error instanceof Error && /lease fence|active lease fence|stale lease/i.test(error.message)
}

function preparedCallIds(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const calls = (value as { calls?: unknown }).calls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((call) => {
    if (!call || typeof call !== 'object') return []
    const callId = (call as { callId?: unknown }).callId
    return typeof callId === 'string' && callId ? [callId] : []
  })
}

function proposalNeedsAccounting(nodeId: string): boolean {
  return [
    'evaluate',
    'commit-assistant',
    'materialize-proposal',
    'prepare-tools',
    'commit-tools',
    'recover-context',
    'wait-user',
    'fail'
  ].includes(nodeId)
}

function requireMigratableProposal(state: RunStateV3, source: string): void {
  const proposal = ModelProposalSchema.safeParse(state.nodeData['normalize-proposal'])
  const task = TaskStateV1Schema.safeParse(state.nodeData['restore-task'])
  if (!proposal.success || !task.success) {
    throw new Error(`${source} snapshot is missing a normalized proposal or task state`)
  }
}

function parseCompletedNodePayload(value: unknown): CompletedNodePayload {
  if (!value || typeof value !== 'object') throw new Error('invalid node.completed payload')
  const record = value as Record<string, unknown>
  if (typeof record.nodeId !== 'string' || !record.nodeId) {
    throw new Error('invalid node.completed nodeId')
  }
  if (!Number.isInteger(record.stepIndex) || (record.stepIndex as number) < 0) {
    throw new Error('invalid node.completed stepIndex')
  }
  if (typeof record.condition !== 'string' || !record.condition) {
    throw new Error('invalid node.completed condition')
  }
  if (!Array.isArray(record.commands)) throw new Error('invalid node.completed commands')
  if (record.facts !== undefined && (!record.facts || typeof record.facts !== 'object' || Array.isArray(record.facts))) {
    throw new Error('invalid node.completed facts')
  }
  return {
    ...record,
    commands: canonicalizeMiddlewareCommands(record.commands)
  } as CompletedNodePayload
}

function parseAfterMiddlewarePayload(value: unknown): AfterMiddlewarePayload {
  if (!value || typeof value !== 'object') throw new Error('invalid node.after_middleware payload')
  const record = value as Record<string, unknown>
  if (typeof record.nodeId !== 'string' || !record.nodeId) {
    throw new Error('invalid node.after_middleware nodeId')
  }
  if (!Number.isInteger(record.stepIndex) || (record.stepIndex as number) < 0) {
    throw new Error('invalid node.after_middleware stepIndex')
  }
  if (!Array.isArray(record.commands)) throw new Error('invalid node.after_middleware commands')
  return {
    ...record,
    commands: canonicalizeMiddlewareCommands(record.commands)
  } as AfterMiddlewarePayload
}

function assertAfterMiddlewareMatches(
  completed: CompletedNodePayload,
  after: AfterMiddlewarePayload
): void {
  if (after.nodeId !== completed.nodeId || after.stepIndex !== completed.stepIndex) {
    throw new Error('node.after_middleware does not match node.completed')
  }
}

function canonicalizeFacts(facts: Record<string, unknown>): Record<string, unknown> {
  return canonicalizeJsonObject(facts, 'runtime node facts')
}

function canonicalizeJsonObject(
  value: Record<string, unknown>,
  label: string
): Record<string, unknown> {
  const serialized = JSON.stringify(value)
  const canonical = serialized === undefined ? {} : JSON.parse(serialized) as unknown
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new Error(`${label} must serialize to a JSON object`)
  }
  return canonical as Record<string, unknown>
}

const budgetKeys = [
  'stepsUsed',
  'toolCallsUsed',
  'inputTokens',
  'outputTokens',
  'costUsd'
] as const

function addBudget(
  state: RunStateV3,
  command: Extract<MiddlewareCommand, { type: 'add-budget' }>,
  processedUsageIds: Set<string>
): RunStateV3 {
  if (command.usageId && processedUsageIds.has(command.usageId)) return state

  const budgets = { ...state.budgets }
  for (const key of budgetKeys) {
    budgets[key] += command.delta[key] ?? 0
    if (key === 'costUsd') {
      if (!Number.isFinite(budgets[key])) throw new Error(`budget overflow: ${key}`)
    } else if (!Number.isSafeInteger(budgets[key])) {
      throw new Error(`unsafe budget total: ${key}`)
    }
  }
  if (!command.usageId) return { ...state, budgets }
  processedUsageIds.add(command.usageId)

  return {
    ...state,
    budgets,
    middleware: {
      ...state.middleware,
      'budget-accounting': {
        version: 1,
        data: { processedUsageIds: [...processedUsageIds].sort() }
      }
    }
  }
}

function budgetUsageIdSet(state: RunStateV3): Set<string> {
  const accounting = state.middleware['budget-accounting']
  if (!accounting) return new Set()
  if (accounting.version !== 1) {
    throw new Error(`unsupported budget-accounting middleware version: ${accounting.version}`)
  }
  const data = accounting.data
  if (!data || typeof data !== 'object' || !Array.isArray((data as { processedUsageIds?: unknown }).processedUsageIds)) {
    throw new Error('invalid budget-accounting middleware state')
  }
  const ids = (data as { processedUsageIds: unknown[] }).processedUsageIds
  if (!ids.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error('invalid budget-accounting usage ids')
  }
  return new Set(ids as string[])
}
