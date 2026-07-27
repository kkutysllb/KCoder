import {
  CostEntrySchema,
  GraphAttributionQuerySchema,
  RoiSnapshotSchema,
  type CostEntry,
  type ExecutionLedgerEntry,
  type GraphAttributionQuery,
  type GraphEdgeAttributionMetrics,
  type GraphNodeAttributionMetrics,
  type GraphRevision,
  type GraphRunRecord,
  type RoiSnapshot,
  type TaskScope,
  type ValueEvent,
  type WorkGraphEventRecord,
  ValueEventSchema
} from '@qiongqi/contracts'
import type { DurableEngineStore, EngineStreamSink } from '@qiongqi/ports'

export type EngineValueLedgerOptions = {
  store: DurableEngineStore
  scope: TaskScope
  stream?: EngineStreamSink
  nowIso?: () => string
}

/** Durable cost/value projection. Business ROI and operational efficiency remain separate. */
export class EngineValueLedger {
  private readonly nowIso: () => string

  constructor(private readonly options: EngineValueLedgerOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async recordCost(record: CostEntry): Promise<RoiSnapshot> {
    const cost = CostEntrySchema.parse(record)
    await this.options.store.commit({
      scope: this.options.scope,
      runId: `roi:${this.options.scope.taskId}`,
      expectedRunVersion: (await this.options.store.loadRun(`roi:${this.options.scope.taskId}`))?.version ?? 0,
      expectedTaskRevision: (await this.options.store.loadTask(this.options.scope))?.revision ?? 0,
      costMutations: [{ type: 'append', record: cost }]
    })
    return this.snapshotAndPublish(cost.graph ? graphQuery(cost.graph) : undefined)
  }

  async recordValue(record: ValueEvent): Promise<RoiSnapshot> {
    const value = ValueEventSchema.parse(record)
    await this.options.store.commit({
      scope: this.options.scope,
      runId: `roi:${this.options.scope.taskId}`,
      expectedRunVersion: (await this.options.store.loadRun(`roi:${this.options.scope.taskId}`))?.version ?? 0,
      expectedTaskRevision: (await this.options.store.loadTask(this.options.scope))?.revision ?? 0,
      valueMutations: [{ type: 'append', record: value }]
    })
    return this.snapshotAndPublish(value.graph ? graphQuery(value.graph) : undefined)
  }

  async snapshot(rawQuery?: GraphAttributionQuery): Promise<RoiSnapshot> {
    const query = rawQuery ? GraphAttributionQuerySchema.parse(rawQuery) : undefined
    const [allCosts, allValues, allLedger, allGraphRuns, graphRevision] = await Promise.all([
      this.options.store.listCosts(this.options.scope),
      this.options.store.listValues(this.options.scope),
      this.options.store.findLedger({ scope: this.options.scope }),
      query ? this.options.store.listGraphRuns(this.options.scope) : Promise.resolve([]),
      query ? this.options.store.loadGraphRevision(query.graphId, query.graphRevision) : Promise.resolve(undefined)
    ])
    const graphRuns = query
      ? allGraphRuns.filter((run) => matchesGraphRun(run, query))
      : []
    const workEvents = query
      ? (await Promise.all(graphRuns.map((run) => this.listAllWorkEvents(run.runId)))).flat()
      : []
    const runAttemptIds = new Set(workEvents.map((event) => event.attemptId))
    const costs = query ? allCosts.filter((entry) => matchesAttribution(entry.graph, query)) : allCosts
    const values = query ? allValues.filter((entry) => matchesAttribution(entry.graph, query)) : allValues
    const ledger = query
      ? allLedger.filter((entry) => matchesLedgerAttribution(entry, query, runAttemptIds))
      : allLedger
    const costCurrencies = new Set(costs.map((entry) => entry.currency))
    const valueCurrencies = new Set(values.map((entry) => entry.currency))
    const currency = costCurrencies.size === 1 ? [...costCurrencies][0] : undefined
    const sameCurrency = Boolean(currency) && valueCurrencies.size <= 1
      && (values.length === 0 || valueCurrencies.has(currency!))
    const incurredCost = currency ? costs.filter((entry) => entry.currency === currency).reduce((sum, entry) => sum + entry.amount, 0) : 0
    const businessValue = currency ? values.filter((entry) => entry.currency === currency).reduce((sum, entry) => sum + entry.amount, 0) : 0
    const physicalAttempts = ledger.filter((entry) => entry.status === 'completed' || entry.status === 'failed' || entry.status === 'uncertain').length
    const replayedAttempts = ledger.filter((entry) => entry.status === 'replayed').length
    const suppressedAttempts = ledger.filter((entry) => entry.status === 'suppressed').length
    const roiStatus = costs.length === 0 || !sameCurrency
      ? 'unavailable'
      : values.length === 0
        ? 'incomplete'
        : 'available'
    const graphMetrics = query
      ? projectGraphMetrics({ graphRevision, graphRuns, workEvents, costs, values, ledger, currency })
      : undefined
    return RoiSnapshotSchema.parse({
      scope: this.options.scope,
      revision: costs.length + values.length + ledger.length
        + (query ? workEvents.length + graphRuns.length : 0),
      roiStatus,
      ...(currency ? { currency } : {}),
      incurredCost,
      businessValue,
      ...(roiStatus === 'available' && incurredCost > 0
        ? { netValue: businessValue - incurredCost, roiRatio: (businessValue - incurredCost) / incurredCost }
        : {}),
      engineEfficiency: {
        logicalAttempts: ledger.length,
        physicalAttempts,
        replayedAttempts,
        suppressedAttempts,
        estimatedWasteAvoided: graphMetrics?.avoidedCost ?? 0,
        ...(incurredCost > 0 ? { progressPerCost: 0, evidencePerCost: 0, artifactPerCost: 0 } : {})
      },
      ...(query && graphMetrics ? { graph: query, ...graphMetrics } : {}),
      updatedAt: this.nowIso()
    })
  }

  private async listAllWorkEvents(runId: string): Promise<WorkGraphEventRecord[]> {
    const records: WorkGraphEventRecord[] = []
    let afterSeq = 0
    while (true) {
      const page = await this.options.store.listWorkGraphEvents(runId, afterSeq, 1_000)
      records.push(...page)
      if (page.length < 1_000) return records
      afterSeq = page.at(-1)!.seq
    }
  }

  private async snapshotAndPublish(query?: GraphAttributionQuery): Promise<RoiSnapshot> {
    const snapshot = await this.snapshot(query)
    await this.options.stream?.publish({ channel: 'public', kind: 'roi.snapshot', payload: snapshot })
    return snapshot
  }
}

type GraphMetricProjectionInput = {
  graphRevision?: GraphRevision
  graphRuns: GraphRunRecord[]
  workEvents: WorkGraphEventRecord[]
  costs: CostEntry[]
  values: ValueEvent[]
  ledger: ExecutionLedgerEntry[]
  currency?: string
}

type GraphMetricProjection = {
  byNode: Record<string, GraphNodeAttributionMetrics>
  byEdge: Record<string, GraphEdgeAttributionMetrics>
  fanOut: number
  retryAmplification: number
  suppressedPhysicalAttempts: number
  avoidedCost: number
  criticalPathLatencyMs: number
}

function projectGraphMetrics(input: GraphMetricProjectionInput): GraphMetricProjection {
  const byNode: Record<string, GraphNodeAttributionMetrics> = {}
  const byEdge: Record<string, GraphEdgeAttributionMetrics> = {}
  for (const node of input.graphRevision?.nodes ?? []) byNode[node.id] = emptyNodeMetrics()
  for (const edge of input.graphRevision?.edges ?? []) byEdge[edge.edgeId] = emptyEdgeMetrics()

  const nodeRunKeys = new Set<string>()
  const nodeRuns = new Map<string, Set<string>>()
  const starts = new Map<string, WorkGraphEventRecord>()
  const fanOutGroups = new Map<string, Set<string>>()
  const durationsByRun = new Map<string, Map<string, number>>()
  const traversedEdgesByRun = new Map<string, Set<string>>()
  const edgeFrom = new Map((input.graphRevision?.edges ?? []).map((edge) => [edge.edgeId, edge.from]))
  let physicalNodeAttempts = 0
  for (const event of [...input.workEvents].sort((left, right) => left.seq - right.seq)) {
    if (event.nodeId && event.kind === 'node_started') {
      const metrics = byNode[event.nodeId] ?? emptyNodeMetrics()
      metrics.attempts += 1
      byNode[event.nodeId] = metrics
      physicalNodeAttempts += 1
      nodeRunKeys.add(`${event.runId}\u0000${event.nodeId}`)
      const runIds = nodeRuns.get(event.nodeId) ?? new Set<string>()
      runIds.add(event.runId)
      nodeRuns.set(event.nodeId, runIds)
      starts.set(attemptKey(event), event)
    }
    if (event.nodeId && ['node_completed', 'node_failed', 'node_cancelled'].includes(event.kind)) {
      const started = starts.get(attemptKey(event))
      if (started) {
        const duration = elapsedMs(started.timestamp, event.timestamp)
        const metrics = byNode[event.nodeId] ?? emptyNodeMetrics()
        metrics.latencyMs += duration
        byNode[event.nodeId] = metrics
        const durations = durationsByRun.get(event.runId) ?? new Map<string, number>()
        durations.set(event.nodeId, (durations.get(event.nodeId) ?? 0) + duration)
        durationsByRun.set(event.runId, durations)
        starts.delete(attemptKey(event))
      }
    }
    if (event.edgeId && ['edge_selected', 'edge_traversed', 'edge_rejected'].includes(event.kind)) {
      const metrics = byEdge[event.edgeId] ?? emptyEdgeMetrics()
      if (event.kind === 'edge_selected') metrics.selected += 1
      if (event.kind === 'edge_traversed') {
        metrics.traversals += 1
        const traversed = traversedEdgesByRun.get(event.runId) ?? new Set<string>()
        traversed.add(event.edgeId)
        traversedEdgesByRun.set(event.runId, traversed)
        const from = edgeFrom.get(event.edgeId) ?? event.nodeId
        if (from) {
          const key = `${event.runId}\u0000${from}`
          const edges = fanOutGroups.get(key) ?? new Set<string>()
          edges.add(event.edgeId)
          fanOutGroups.set(key, edges)
        }
      }
      if (event.kind === 'edge_rejected') metrics.rejected += 1
      byEdge[event.edgeId] = metrics
    }
  }

  for (const [nodeId, metrics] of Object.entries(byNode)) {
    metrics.retries = Math.max(0, metrics.attempts - (nodeRuns.get(nodeId)?.size ?? 0))
  }
  for (const cost of input.costs) {
    if (cost.graph?.nodeId) {
      const metrics = byNode[cost.graph.nodeId] ?? emptyNodeMetrics()
      metrics.cost += cost.amount
      byNode[cost.graph.nodeId] = metrics
    }
    if (cost.graph?.edgeId) {
      const metrics = byEdge[cost.graph.edgeId] ?? emptyEdgeMetrics()
      metrics.cost += cost.amount
      byEdge[cost.graph.edgeId] = metrics
    }
  }
  for (const value of input.values) {
    if (value.graph?.nodeId) {
      const metrics = byNode[value.graph.nodeId] ?? emptyNodeMetrics()
      metrics.businessValue += value.amount
      byNode[value.graph.nodeId] = metrics
    }
    if (value.graph?.edgeId) {
      const metrics = byEdge[value.graph.edgeId] ?? emptyEdgeMetrics()
      metrics.businessValue += value.amount
      byEdge[value.graph.edgeId] = metrics
    }
  }

  let suppressedPhysicalAttempts = 0
  let avoidedCost = 0
  for (const entry of input.ledger) {
    if (entry.status !== 'replayed' && entry.status !== 'suppressed') continue
    suppressedPhysicalAttempts += 1
    const entryAvoidedCost = avoidedModelCost(entry, input.currency)
    avoidedCost += entryAvoidedCost
    if (entry.graph?.nodeId) {
      const metrics = byNode[entry.graph.nodeId] ?? emptyNodeMetrics()
      metrics.suppressedAttempts += 1
      metrics.avoidedCost += entryAvoidedCost
      byNode[entry.graph.nodeId] = metrics
    }
  }

  const baselineAttempts = nodeRunKeys.size
  return {
    byNode,
    byEdge,
    fanOut: Math.max(0, ...[...fanOutGroups.values()].map((edges) => edges.size)),
    retryAmplification: baselineAttempts > 0 ? physicalNodeAttempts / baselineAttempts : 0,
    suppressedPhysicalAttempts,
    avoidedCost,
    criticalPathLatencyMs: criticalPathLatency(input.graphRevision, durationsByRun, traversedEdgesByRun)
  }
}

function matchesGraphRun(run: GraphRunRecord, query: GraphAttributionQuery): boolean {
  return run.graphId === query.graphId
    && run.graphRevision === query.graphRevision
    && (query.runId === undefined || run.runId === query.runId)
}

function graphQuery(graph: NonNullable<CostEntry['graph']>): GraphAttributionQuery {
  return { graphId: graph.graphId, graphRevision: graph.graphRevision, runId: graph.runId }
}

function matchesAttribution(
  graph: CostEntry['graph'] | ValueEvent['graph'],
  query: GraphAttributionQuery
): boolean {
  return graph?.graphId === query.graphId
    && graph.graphRevision === query.graphRevision
    && (query.runId === undefined || graph.runId === query.runId)
}

function matchesLedgerAttribution(
  entry: ExecutionLedgerEntry,
  query: GraphAttributionQuery,
  runAttemptIds: ReadonlySet<string>
): boolean {
  return entry.graph?.graphId === query.graphId
    && entry.graph.graphRevision === query.graphRevision
    && (query.runId === undefined || runAttemptIds.has(entry.graph.attemptId))
}

function emptyNodeMetrics(): GraphNodeAttributionMetrics {
  return { cost: 0, businessValue: 0, attempts: 0, retries: 0, suppressedAttempts: 0, avoidedCost: 0, latencyMs: 0 }
}

function emptyEdgeMetrics(): GraphEdgeAttributionMetrics {
  return { cost: 0, businessValue: 0, selected: 0, traversals: 0, rejected: 0 }
}

function attemptKey(event: WorkGraphEventRecord): string {
  return `${event.runId}\u0000${event.nodeId ?? ''}\u0000${event.attemptId}`
}

function elapsedMs(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

function criticalPathLatency(
  revision: GraphRevision | undefined,
  durationsByRun: ReadonlyMap<string, ReadonlyMap<string, number>>,
  traversedEdgesByRun: ReadonlyMap<string, ReadonlySet<string>>
): number {
  let longest = 0
  for (const [runId, durations] of durationsByRun) {
    if (!revision) {
      longest = Math.max(longest, ...durations.values())
      continue
    }
    const traversed = traversedEdgesByRun.get(runId) ?? new Set<string>()
    const adjacency = new Map<string, Set<string>>()
    for (const edge of revision.edges) {
      if (!traversed.has(edge.edgeId)) continue
      const targets = adjacency.get(edge.from) ?? new Set<string>()
      targets.add(edge.to)
      adjacency.set(edge.from, targets)
    }
    const memo = new Map<string, number>()
    const visiting = new Set<string>()
    const visit = (nodeId: string): number => {
      const cached = memo.get(nodeId)
      if (cached !== undefined) return cached
      visiting.add(nodeId)
      let downstream = 0
      for (const target of adjacency.get(nodeId) ?? []) {
        if (!visiting.has(target)) downstream = Math.max(downstream, visit(target))
      }
      visiting.delete(nodeId)
      const total = (durations.get(nodeId) ?? 0) + downstream
      memo.set(nodeId, total)
      return total
    }
    const nodes = new Set([...durations.keys(), ...adjacency.keys()])
    for (const nodeId of nodes) longest = Math.max(longest, visit(nodeId))
  }
  return longest
}

function avoidedModelCost(entry: ExecutionLedgerEntry, currency?: string): number {
  if (entry.kind !== 'model' || !entry.usage) return 0
  if (currency === 'USD') return entry.usage.costUsd ?? 0
  if (currency === 'CNY') return entry.usage.costCny ?? 0
  return 0
}
