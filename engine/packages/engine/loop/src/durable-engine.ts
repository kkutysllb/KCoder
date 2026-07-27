import { randomUUID } from 'node:crypto'
import type {
  AgentGraph,
  BudgetState,
  CostEntry,
  GraphCircuitState,
  GraphRevision,
  GraphRunRecord,
  HumanCheckpoint,
  KernelRunIdentity,
  KernelCompletionPayload,
  ModelSelectionPolicy,
  MultiAgentRun,
  RoiSnapshot,
  TaskScope,
  ValueEvent,
  WorkGraphEventRecord
} from '@qiongqi/contracts'
import { AgentGraphSchema, BudgetStateSchema, GraphRevisionSchema } from '@qiongqi/contracts'
import type { DurableEngineStore } from '@qiongqi/ports'
import type { TaskModelPolicyRecord } from '@qiongqi/ports'
import { createDurableEventedV2Stores } from './durable-graph-store-adapters.js'
import { DurableAgentDispatchWorker } from './durable-agent-dispatch-worker.js'
import { EngineStreamPublisher, type EngineStreamPublisherOptions } from './engine-stream-publisher.js'
import { EngineValueLedger } from './engine-value-ledger.js'
import type { AgentExecutionInput, AgentExecutor } from './kernel-agent-executor.js'
import { EventedV2MultiAgentRuntime } from './evented-v2-multi-agent-runtime.js'
import { GraphGovernor } from './graph-governor.js'
import type { ModelProfileRegistry } from './model-profile-registry.js'
import {
  RootRunAggregateCoordinator,
  type MigrateGraphOnlyRunInput,
  type RootRunAggregate
} from './root-run-aggregate.js'

export type DurableEngineOptions = {
  store: DurableEngineStore
  modelRegistry: ModelProfileRegistry
  kernelExecutor: AgentExecutor
  orchestrator?: Pick<EventedV2MultiAgentRuntime, 'start' | 'load'>
  ids?: (prefix: string) => string
  stream?: Omit<EngineStreamPublisherOptions, 'store' | 'streamId' | 'scope'>
  nowIso?: () => string
}

export type DurableEngineStartBase = {
  scope: TaskScope
  threadId: string
  turnId: string
  workspaceKey: string
  prompt: string
  modelPolicy: ModelSelectionPolicy
}

export type GovernedDurableEngineStartInput = DurableEngineStartBase & {
  graphRef: { graphId: string; revision: number }
  budgetLimits: BudgetState
}

export type CompatibilityDurableEngineStartInput = DurableEngineStartBase & {
  graphRef?: undefined
  budgetLimits?: undefined
}

export type DurableEngineStartInput = GovernedDurableEngineStartInput | CompatibilityDurableEngineStartInput

export type GraphRunInspection = GraphRunRecord & {
  workEvents: WorkGraphEventRecord[]
}

export type CheckpointResolution = {
  decision: 'allow' | 'deny'
  token?: string
  resolutionToken?: string
  graphRevision?: number
}

export class DurableEngine {
  private readonly streams = new Map<string, EngineStreamPublisher>()
  private readonly ledgers = new Map<string, EngineValueLedger>()
  private readonly dispatchWorker: DurableAgentDispatchWorker

  constructor(private readonly options: DurableEngineOptions) {
    this.dispatchWorker = new DurableAgentDispatchWorker({
      store: options.store,
      executor: options.kernelExecutor
    })
  }

  async start(input: DurableEngineStartInput): Promise<{ multiAgentRunId: string; streamId: string }> {
    if (input.graphRef && input.budgetLimits === undefined) {
      throw new Error('governed start requires budgetLimits')
    }
    if (input.graphRef) BudgetStateSchema.parse(input.budgetLimits)
    if (!input.graphRef && input.budgetLimits !== undefined) {
      throw new Error('budgetLimits requires graphRef')
    }
    const policy = await this.ensureTaskModelPolicy(input.scope, input.modelPolicy)
    const run = input.graphRef
      ? await this.startGovernedGraph(input, policy.revision)
      : await this.startCompatibilityGraph(input)
    const streamId = `stream:${run.runId}`
    this.publisher(streamId, input.scope)
    return { multiAgentRunId: run.runId, streamId }
  }

  async publishGraph(rawRevision: GraphRevision): Promise<void> {
    const revision = GraphRevisionSchema.parse(rawRevision)
    const current = await this.options.store.loadGraphRevision(revision.graphId, revision.revision)
    if (current && current.graphDigest === revision.graphDigest) return
    const scope = graphCatalogScope(revision.graphId)
    await this.options.store.commit({
      scope,
      runId: `graph-catalog:${revision.graphId}:${revision.revision}`,
      expectedRunVersion: 0,
      expectedTaskRevision: (await this.options.store.loadTask(scope))?.revision ?? 0,
      graphRevisionMutations: [{ type: 'put', record: revision }]
    })
  }

  async inspect(runId: string): Promise<GraphRunInspection> {
    const run = await this.options.store.loadGraphRun(runId)
    if (!run) throw new Error(`GraphRun not found: ${runId}`)
    const aggregate = await new RootRunAggregateCoordinator({
      store: this.options.store,
      nowIso: this.options.nowIso
    }).load(runId)
    return { ...aggregate.graphRun, workEvents: await this.listAllWorkEvents(runId) }
  }

  async migrateGraphOnlyRun(input: MigrateGraphOnlyRunInput): Promise<RootRunAggregate> {
    BudgetStateSchema.parse(input.budgetLimits)
    const aggregate = await new RootRunAggregateCoordinator({
      store: this.options.store,
      nowIso: this.options.nowIso
    }).migrateGraphOnly(input)
    if (!isRootTerminal(aggregate.engineRun.status)) {
      const pending = (await this.options.store.listOutboxIntents(aggregate.graphRun.scope))
        .some((intent) => intent.kind === 'agent_execution_requested' && intent.status === 'pending')
      if (pending) this.dispatchWorker.notify()
    }
    return aggregate
  }

  async resolveCheckpoint(checkpointId: string, resolution: CheckpointResolution): Promise<void> {
    const checkpoint = await this.requireCheckpoint(checkpointId)
    const token = resolution.resolutionToken ?? resolution.token
    if (!token) throw new Error('checkpoint resolution token is required')
    const governor = await this.governorFor(checkpoint.runId)
    await governor.resolveApproval({
      checkpointId,
      resolutionToken: token,
      graphRevision: resolution.graphRevision ?? checkpoint.graphRevision,
      decision: resolution.decision
    })
  }

  async setGraphCircuit(runId: string, state: GraphCircuitState): Promise<void> {
    await (await this.governorFor(runId)).setCircuitState(runId, state)
  }

  flushAgentDispatches(limit = 1_000): Promise<number> {
    return this.dispatchWorker.flushAvailable(limit)
  }

  async consumeKernelCompletion(input: {
    multiAgentRunId: string
    completion: KernelCompletionPayload | unknown
  }): Promise<MultiAgentRun> {
    const { runtime } = await this.runtimeForExistingRun(input.multiAgentRunId)
    return runtime.consumeKernelCompletion({ runId: input.multiAgentRunId, completion: input.completion })
  }

  async dispatchActiveAgent(input: {
    multiAgentRunId: string
    prompt: string
    requestedBudget: BudgetState
    sharedEvidenceRefs?: string[]
  }): Promise<MultiAgentRun> {
    BudgetStateSchema.parse(input.requestedBudget)
    const { aggregate, runtime } = await this.runtimeForExistingRun(input.multiAgentRunId)
    const graph = aggregate.engineRun.graph
    if (!graph) throw new Error(`governed root graph identity is unavailable: ${input.multiAgentRunId}`)
    const prepared = await runtime.dispatchActiveAgent({
      runId: input.multiAgentRunId,
      scope: aggregate.graphRun.scope,
      prompt: input.prompt,
      requestedBudget: input.requestedBudget,
      sharedEvidenceRefs: input.sharedEvidenceRefs,
      graph
    })
    this.dispatchWorker.notify()
    return prepared
  }

  async dispatchParallelAgents(input: {
    multiAgentRunId: string
    prompt: string
    requestedBudgets: Record<string, BudgetState>
    sharedEvidenceRefs?: string[]
  }): Promise<MultiAgentRun> {
    for (const budget of Object.values(input.requestedBudgets)) BudgetStateSchema.parse(budget)
    const { aggregate, runtime } = await this.runtimeForExistingRun(input.multiAgentRunId)
    const graph = aggregate.engineRun.graph
    if (!graph) throw new Error(`governed root graph identity is unavailable: ${input.multiAgentRunId}`)
    const prepared = await runtime.dispatchParallelAgents({
      runId: input.multiAgentRunId,
      scope: aggregate.graphRun.scope,
      prompt: input.prompt,
      requestedBudgets: input.requestedBudgets,
      sharedEvidenceRefs: input.sharedEvidenceRefs,
      graph
    })
    this.dispatchWorker.notify()
    return prepared
  }

  resume(executionRef: KernelRunIdentity, resolution?: unknown): Promise<void> {
    return this.options.kernelExecutor.resume(executionRef, resolution)
  }

  async cancel(multiAgentRunId: string): Promise<void> {
    const governed = await this.options.store.loadGraphRun(multiAgentRunId)
    if (governed) {
      const coordinator = new RootRunAggregateCoordinator({ store: this.options.store, nowIso: this.options.nowIso })
      const current = await coordinator.load(multiAgentRunId)
      if (isRootTerminal(current.engineRun.status)) return
      const lease = await this.options.store.acquireLease(
        multiAgentRunId,
        this.nextId('root_cancel'),
        30_000
      )
      if (!lease) throw new Error(`root run lease unavailable for cancellation: ${multiAgentRunId}`)
      try {
        const cancelling = await coordinator.requestCancel(multiAgentRunId, lease)
        for (const agentRun of cancelling.graphRun.eventedV2Run?.agentRuns ?? []) {
          if (agentRun.executionRef && !isAgentRunTerminal(agentRun.status)) {
            await this.options.kernelExecutor.cancel(agentRun.executionRef)
          }
        }
        await coordinator.finalizeCancel(multiAgentRunId, lease)
      } finally {
        await this.options.store.releaseLease(multiAgentRunId, lease)
      }
      return
    }
    const run = await this.options.orchestrator?.load(multiAgentRunId)
    for (const agentRun of run?.agentRuns ?? []) {
      if (agentRun.executionRef) await this.options.kernelExecutor.cancel(agentRun.executionRef)
    }
  }

  async subscribe(streamId: string, subscriberId: string, afterSeq: number, limit = 100) {
    const publisher = this.streams.get(streamId)
    if (publisher) return publisher.read(subscriberId, afterSeq, limit)
    return this.options.store.readStream(streamId, afterSeq, limit)
  }

  ack(streamId: string, subscriberId: string, throughSeq: number): Promise<void> {
    const publisher = this.streams.get(streamId)
    return publisher ? publisher.ack(subscriberId, throughSeq) : this.options.store.ackStream(streamId, subscriberId, throughSeq)
  }

  recordValue(value: ValueEvent): Promise<RoiSnapshot> {
    const ledger = this.valueLedger(value.scope, value.graph?.runId)
    return ledger.recordValue(value)
  }

  recordCost(cost: CostEntry): Promise<RoiSnapshot> {
    return this.valueLedger(cost.scope, cost.graph?.runId).recordCost(cost)
  }

  async setTaskModelPolicy(scope: TaskScope, revision: number, policy: ModelSelectionPolicy): Promise<void> {
    const current = await this.options.store.loadTaskModelPolicy(scope)
    if (current && revision !== current.revision + 1) throw new Error(`task model policy revision mismatch: expected ${current.revision + 1}`)
    if (!current && revision !== 1) throw new Error('task model policy revision mismatch: expected 1')
    const now = this.options.nowIso?.() ?? new Date().toISOString()
    await this.options.store.commit({
      scope,
      runId: policyCommitId(scope),
      expectedRunVersion: 0,
      expectedTaskRevision: (await this.options.store.loadTask(scope))?.revision ?? 0,
      expectedModelPolicyRevision: current?.revision ?? 0,
      taskModelPolicyMutation: {
        type: 'put',
        record: {
          scope,
          revision,
          policy,
          validatedProfileRefs: this.options.modelRegistry.validatePolicy(policy),
          createdAt: current?.createdAt ?? now,
          updatedAt: now
        }
      }
    })
  }

  getTaskModelPolicy(scope: TaskScope): Promise<TaskModelPolicyRecord | undefined> {
    return this.options.store.loadTaskModelPolicy(scope)
  }

  get kernelExecutor(): AgentExecutor {
    return this.options.kernelExecutor
  }

  private async startGovernedGraph(input: GovernedDurableEngineStartInput, policyRevision: number) {
    const graphRef = input.graphRef
    const revision = await this.options.store.loadGraphRevision(graphRef.graphId, graphRef.revision)
    if (!revision) throw new Error(`GraphRevision not found: ${graphRef.graphId}@${graphRef.revision}`)
    const runtime = this.runtimeFor(input.scope, revision, input.budgetLimits, policyRevision)
    const run = await runtime.start(input)
    const prepared = await runtime.dispatchActiveAgent({
      runId: run.runId,
      scope: input.scope,
      prompt: input.prompt,
      requestedBudget: input.budgetLimits,
      graph: {
        graphId: revision.graphId,
        graphRevision: revision.revision,
        graphDigest: revision.graphDigest,
        nodeId: run.activeNodeId,
        attemptId: run.runId,
        callerId: input.scope.ownerId,
        policyRevision
      }
    })
    this.dispatchWorker.notify()
    return prepared
  }

  private async startCompatibilityGraph(input: CompatibilityDurableEngineStartInput) {
    if (!this.options.orchestrator) throw new Error('legacy orchestrator is not configured; graphRef is required')
    return this.options.orchestrator.start(input)
  }

  private runtimeFor(
    scope: TaskScope,
    revision: GraphRevision,
    budgetLimits: BudgetState,
    policyRevision: number
  ): EventedV2MultiAgentRuntime {
    const coordinator = new RootRunAggregateCoordinator({ store: this.options.store, nowIso: this.options.nowIso })
    const durable = createDurableEventedV2Stores({
      store: this.options.store,
      scope,
      graphRevision: revision,
      rootAggregate: { coordinator, budgetLimits, policyRevision }
    })
    const governor = new GraphGovernor({
      store: this.options.store,
      graphRevision: revision,
      rootAggregate: coordinator,
      ids: (prefix) => this.nextId(prefix),
      nowIso: this.options.nowIso
    })
    return new EventedV2MultiAgentRuntime({
      ...durable,
      graph: graphRevisionToAgentGraph(revision),
      ids: (prefix) => this.nextId(prefix),
      nowIso: this.options.nowIso ?? (() => new Date().toISOString()),
      agentExecutor: this.options.kernelExecutor,
      dispatchPreparer: durable.runs,
      approvalGovernor: governor
    })
  }

  private async governorFor(runId: string): Promise<GraphGovernor> {
    const coordinator = new RootRunAggregateCoordinator({ store: this.options.store, nowIso: this.options.nowIso })
    const { graphRun: run } = await coordinator.load(runId)
    const revision = await this.options.store.loadGraphRevision(run.graphId, run.graphRevision)
    if (!revision || revision.graphDigest !== run.graphDigest) {
      throw new Error(`Pinned GraphRevision unavailable for run: ${runId}`)
    }
    return new GraphGovernor({
      store: this.options.store,
      graphRevision: revision,
      rootAggregate: coordinator,
      ids: (prefix) => this.nextId(prefix),
      nowIso: this.options.nowIso
    })
  }

  private async runtimeForExistingRun(runId: string): Promise<{
    aggregate: RootRunAggregate
    runtime: EventedV2MultiAgentRuntime
  }> {
    const coordinator = new RootRunAggregateCoordinator({ store: this.options.store, nowIso: this.options.nowIso })
    const aggregate = await coordinator.load(runId)
    const revision = await this.options.store.loadGraphRevision(
      aggregate.graphRun.graphId,
      aggregate.graphRun.graphRevision
    )
    if (!revision || revision.graphDigest !== aggregate.graphRun.graphDigest) {
      throw new Error(`Pinned GraphRevision unavailable for run: ${runId}`)
    }
    const budgetLimits = aggregate.engineRun.budgetLimits
    const policyRevision = aggregate.engineRun.graph?.policyRevision
    if (!budgetLimits || !policyRevision) {
      throw new Error(`governed root execution policy is unavailable: ${runId}`)
    }
    return {
      aggregate,
      runtime: this.runtimeFor(aggregate.graphRun.scope, revision, budgetLimits, policyRevision)
    }
  }

  private async requireCheckpoint(checkpointId: string): Promise<HumanCheckpoint> {
    const checkpoint = await this.options.store.loadHumanCheckpoint(checkpointId)
    if (!checkpoint) throw new Error(`HumanCheckpoint not found: ${checkpointId}`)
    return checkpoint
  }

  private async listAllWorkEvents(runId: string): Promise<WorkGraphEventRecord[]> {
    const events: WorkGraphEventRecord[] = []
    let afterSeq = 0
    while (true) {
      const page = await this.options.store.listWorkGraphEvents(runId, afterSeq, 1_000)
      events.push(...page)
      if (page.length < 1_000) return events
      afterSeq = page.at(-1)!.seq
    }
  }

  private async ensureTaskModelPolicy(scope: TaskScope, policy: ModelSelectionPolicy): Promise<TaskModelPolicyRecord> {
    const current = await this.getTaskModelPolicy(scope)
    if (!current) {
      await this.setTaskModelPolicy(scope, 1, policy)
    } else if (JSON.stringify(current.policy) !== JSON.stringify(policy)) {
      await this.setTaskModelPolicy(scope, current.revision + 1, policy)
    }
    const stored = await this.getTaskModelPolicy(scope)
    if (!stored) throw new Error('task model policy was not persisted')
    return stored
  }

  private nextId(prefix: string): string {
    return this.options.ids?.(prefix) ?? `${prefix}:${randomUUID()}`
  }

  private publisher(streamId: string, scope: TaskScope): EngineStreamPublisher {
    const existing = this.streams.get(streamId)
    if (existing) return existing
    const publisher = new EngineStreamPublisher({
      store: this.options.store,
      streamId,
      scope,
      ...this.options.stream
    })
    this.streams.set(streamId, publisher)
    return publisher
  }

  private valueLedger(scope: TaskScope, runId?: string): EngineValueLedger {
    const key = `${scopeKey(scope)}\u0000${runId ?? ''}`
    const existing = this.ledgers.get(key)
    if (existing) return existing
    const ledger = new EngineValueLedger({
      store: this.options.store,
      scope,
      stream: this.publisher(`stream:${runId ?? scope.taskId}`, scope)
    })
    this.ledgers.set(key, ledger)
    return ledger
  }
}

export function createEngine(options: DurableEngineOptions): DurableEngine {
  return new DurableEngine(options)
}

function scopeKey(scope: TaskScope): string {
  return `${scope.ownerId}\u0000${scope.workspaceId}\u0000${scope.taskId}`
}

function policyCommitId(scope: TaskScope): string {
  return `model-policy:${scope.ownerId}:${scope.workspaceId}:${scope.taskId}`
}

function graphCatalogScope(graphId: string): TaskScope {
  return { ownerId: 'qiongqi-engine', workspaceId: 'graph-catalog', taskId: graphId }
}

function graphRevisionToAgentGraph(revision: GraphRevision): AgentGraph {
  return AgentGraphSchema.parse({
    version: 1,
    graphId: revision.graphId,
    startNodeId: revision.startNodeId,
    nodes: revision.nodes.map(({ nodePolicyRef: _nodePolicyRef, ...node }) => node),
    edges: revision.edges.map(({ edgeId: _edgeId, edgePolicyRef: _edgePolicyRef, ...edge }) => edge)
  })
}

function isRootTerminal(status: NonNullable<Awaited<ReturnType<DurableEngineStore['loadRun']>>>['status']): boolean {
  return status === 'completed' || status === 'degraded' || status === 'failed' || status === 'aborted'
}

function isAgentRunTerminal(status: NonNullable<GraphRunRecord['eventedV2Run']>['agentRuns'][number]['status']): boolean {
  return status === 'completed' || status === 'degraded' || status === 'failed' || status === 'aborted'
}
