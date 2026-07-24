import type {
  AgentExecutionView,
  AgentGraphEdge,
  AgentGraphSnapshot,
  AgentRun,
  ChildRunRecord,
  EventedV2TurnExecutionView,
  ExecutionStatus,
  MultiAgentRun,
  RuntimeDecision,
  RuntimeDecisionView,
  Turn,
  UserFacingUsage
} from '@qiongqi/contracts'
import type { AgentTranscriptStore } from '@qiongqi/ports'
import {
  sanitizeTranscript,
  sanitizeTurnExecution,
  sanitizeUserFacingError,
  type TurnExecutionSanitizerOptions
} from './turn-execution-sanitizer.js'

export interface EventedV2ExecutionAdapterContract {
  project(input: {
    turn: Turn
    run: MultiAgentRun
    childRuns: ChildRunRecord[]
  }): Promise<EventedV2TurnExecutionView>
}

export type EventedV2ExecutionAdapterDeps = {
  transcripts: Pick<AgentTranscriptStore, 'load'>
  sanitizerOptions: TurnExecutionSanitizerOptions
}

type PublicAgentRun = AgentRun & Required<Pick<AgentRun,
  'publicKey' | 'sequence' | 'role' | 'phase' | 'transcriptRef'>>

export class EventedV2ExecutionAdapter implements EventedV2ExecutionAdapterContract {
  constructor(private readonly deps: EventedV2ExecutionAdapterDeps) {}

  async project(input: {
    turn: Turn
    run: MultiAgentRun
    childRuns: ChildRunRecord[]
  }): Promise<EventedV2TurnExecutionView> {
    if (input.turn.threadId !== input.run.threadId || input.turn.id !== input.run.turnId) {
      throw new Error('AgentGraph run does not belong to turn')
    }
    if (input.turn.eventedV2RunId !== input.run.runId) {
      throw new Error('AgentGraph run is not linked to turn')
    }
    if (input.turn.runtimeDecision?.effectiveMode !== 'evented_v2') {
      throw new Error('evented_v2 projection requires a persisted evented_v2 decision')
    }
    const snapshot = input.run.graphSnapshot
    if (!snapshot) throw new Error('AgentGraph snapshot is missing')

    const agentRuns = input.run.agentRuns.filter(hasPublicMetadata)
    const nodeRunById = new Map(agentRuns.map((agentRun) => [agentRun.nodeId, agentRun]))
    const nestedChildren = input.childRuns
      .filter((child) =>
        child.parentThreadId === input.turn.threadId &&
        child.parentTurnId === input.turn.id &&
        child.scope.kind === 'graph_node' &&
        child.scope.graphPublicKey === snapshot.publicKey &&
        nodeRunByIdHasPublicKey(nodeRunById, child.scope.ownerAgentPublicKey) &&
        child.publicKey !== undefined &&
        child.sequence !== undefined)
      .sort(byPublicSequence)

    const agents = (await Promise.all([
      ...agentRuns.map((agentRun) => this.projectAgentRun(input, snapshot, agentRun)),
      ...nestedChildren.map((child) => this.projectNestedChild(child))
    ])).sort((left, right) => left.sequence - right.sequence || left.key.localeCompare(right.key))
    const graphNodes = agentRuns
      .sort((left, right) => left.sequence - right.sequence || left.publicKey.localeCompare(right.publicKey))
      .map((agentRun) => {
        const graphNode = snapshot.nodes.find((node) => node.id === agentRun.nodeId)
        return {
          key: agentRun.publicKey,
          agentKey: agentRun.publicKey,
          role: agentRun.role,
          phase: agentRun.phase,
          name: graphNode?.kind === 'agent' && graphNode.label
            ? graphNode.label
            : agentRun.role === 'manager' ? 'Manager' : 'Specialist',
          status: mapAgentStatus(agentRun.status),
          required: agentRun.role === 'manager' ? true : agentRun.required ?? true,
          childAgentKeys: nestedChildren
            .filter((child) => child.scope.kind === 'graph_node' &&
              child.scope.ownerAgentPublicKey === agentRun.publicKey)
            .map((child) => child.publicKey!)
        }
      })
    const edges = publicGraphEdges(snapshot, nodeRunById)
    const graphNodeByKey = new Map(graphNodes.map((node) => [node.key, node]))
    const handoffs = edges
      .filter((edge) =>
        graphNodeByKey.get(edge.from)?.role === 'manager' &&
        graphNodeByKey.get(edge.to)?.role === 'specialist')
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        status: graphNodeByKey.get(edge.to)!.status
      }))
    const projected = sanitizeTurnExecution({
      version: 1,
      available: true,
      revision: 'sha256:unrevisioned',
      mode: 'evented_v2',
      status: mapRunStatus(input.run.status),
      decision: publicDecision(input.turn.runtimeDecision),
      agents,
      graph: {
        key: snapshot.publicKey,
        templateId: snapshot.templateId,
        nodes: graphNodes,
        edges,
        handoffs,
        activeAgentKeys: input.run.activeNodeIds
          .map((nodeId) => nodeRunById.get(nodeId)?.publicKey)
          .filter((key): key is string => key !== undefined),
        warnings: input.run.warnings
      }
    }, this.deps.sanitizerOptions)

    if (!projected.available || projected.mode !== 'evented_v2') {
      throw new Error('evented_v2 projection produced an invalid mode')
    }
    return projected
  }

  private async projectAgentRun(
    input: { turn: Turn; run: MultiAgentRun },
    snapshot: AgentGraphSnapshot,
    agentRun: PublicAgentRun
  ): Promise<AgentExecutionView> {
    const transcript = await this.deps.transcripts.load(agentRun.transcriptRef)
    const transcriptMatches = transcript &&
      transcript.threadId === input.turn.threadId &&
      transcript.turnId === input.turn.id &&
      transcript.ownerPublicKey === agentRun.publicKey
      ? transcript
      : undefined
    const content = transcriptMatches
      ? sanitizeTranscript(transcriptMatches, this.deps.sanitizerOptions)
      : { messages: [], reasoning: [], toolRuns: [] }
    const graphNode = snapshot.nodes.find((node) => node.id === agentRun.nodeId)
    const pending = !transcriptMatches
    return {
      key: agentRun.publicKey,
      sequence: agentRun.sequence,
      role: agentRun.role,
      phase: agentRun.phase,
      name: graphNode?.kind === 'agent' && graphNode.label
        ? graphNode.label
        : agentRun.role === 'manager' ? 'Manager' : 'Specialist',
      ...(agentRun.task ? { task: agentRun.task } : {}),
      status: mapAgentStatus(agentRun.status),
      startedAt: agentRun.startedAt,
      ...(agentRun.completedAt ? { completedAt: agentRun.completedAt } : {}),
      ...(agentRun.completedAt
        ? { durationMs: durationBetween(agentRun.startedAt, agentRun.completedAt) }
        : {}),
      ...(agentRun.usage ? { usage: publicUsage(agentRun.usage) } : {}),
      ...content,
      ...(pending
        ? {
            summary: '等待同步',
            error: { code: 'execution_data_pending', message: '执行详情仍在同步' }
          }
        : agentRun.summary !== undefined
          ? { summary: agentRun.summary }
          : {}),
      ...(!pending && agentRun.status === 'failed' && agentRun.error
        ? { error: sanitizeUserFacingError(agentRun.error) }
        : {}),
      retries: retryViews(agentRun)
    }
  }

  private async projectNestedChild(child: ChildRunRecord): Promise<AgentExecutionView> {
    const transcript = child.transcriptRef
      ? await this.deps.transcripts.load(child.transcriptRef)
      : undefined
    const transcriptMatches = transcript &&
      transcript.threadId === child.parentThreadId &&
      transcript.turnId === child.parentTurnId &&
      transcript.ownerPublicKey === child.publicKey
      ? transcript
      : undefined
    const content = transcriptMatches
      ? sanitizeTranscript(transcriptMatches, this.deps.sanitizerOptions)
      : { messages: [], reasoning: [], toolRuns: [] }
    const pending = Boolean(child.transcriptRef) && !transcriptMatches
    const ownerKey = child.scope.kind === 'graph_node'
      ? child.scope.ownerAgentPublicKey
      : undefined
    return {
      key: child.publicKey!,
      ...(ownerKey ? { parentKey: ownerKey } : {}),
      sequence: child.sequence!,
      role: 'child',
      name: child.label?.trim() || 'Child Agent',
      task: child.prompt,
      status: child.status,
      startedAt: child.createdAt,
      ...(isTerminal(child.status) ? { completedAt: child.updatedAt } : {}),
      durationMs: durationBetween(child.createdAt, child.updatedAt),
      usage: publicUsage(child.usage),
      ...content,
      ...(pending
        ? {
            summary: '等待同步',
            error: { code: 'execution_data_pending', message: '执行详情仍在同步' }
          }
        : child.summary !== undefined
          ? { summary: child.summary }
          : {}),
      ...(!pending && child.status === 'failed' && child.error
        ? { error: sanitizeUserFacingError(child.error) }
        : {}),
      retries: []
    }
  }
}

function hasPublicMetadata(agentRun: AgentRun): agentRun is PublicAgentRun {
  return agentRun.publicKey !== undefined &&
    agentRun.sequence !== undefined &&
    agentRun.role !== undefined &&
    agentRun.phase !== undefined &&
    agentRun.transcriptRef !== undefined
}

function nodeRunByIdHasPublicKey(
  nodeRunById: ReadonlyMap<string, PublicAgentRun>,
  publicKey: string
): boolean {
  return [...nodeRunById.values()].some((agentRun) => agentRun.publicKey === publicKey)
}

function publicGraphEdges(
  snapshot: AgentGraphSnapshot,
  nodeRunById: ReadonlyMap<string, PublicAgentRun>
): Array<{ from: string; to: string; condition?: string }> {
  const outgoing = new Map<string, AgentGraphEdge[]>()
  const agentNodeIds = new Set(snapshot.nodes
    .filter((node) => node.kind === 'agent')
    .map((node) => node.id))
  for (const edge of snapshot.edges) {
    const entries = outgoing.get(edge.from) ?? []
    entries.push(edge)
    outgoing.set(edge.from, entries)
  }
  const projected: Array<{ from: string; to: string; condition?: string }> = []
  const seen = new Set<string>()
  for (const [sourceNodeId, sourceRun] of nodeRunById) {
    const visit = (nodeId: string, condition: string | undefined, visited: ReadonlySet<string>): void => {
      if (visited.has(nodeId)) return
      const targetRun = nodeRunById.get(nodeId)
      if (targetRun) {
        const normalizedCondition = normalizeCondition(condition)
        const key = `${sourceRun.publicKey}:${targetRun.publicKey}:${normalizedCondition ?? ''}`
        if (!seen.has(key)) {
          seen.add(key)
          projected.push({
            from: sourceRun.publicKey,
            to: targetRun.publicKey,
            ...(normalizedCondition ? { condition: normalizedCondition } : {})
          })
        }
        return
      }
      if (agentNodeIds.has(nodeId)) return
      const nextVisited = new Set(visited).add(nodeId)
      for (const edge of outgoing.get(nodeId) ?? []) {
        visit(edge.to, edge.condition, nextVisited)
      }
    }
    for (const edge of outgoing.get(sourceNodeId) ?? []) {
      visit(edge.to, edge.condition, new Set([sourceNodeId]))
    }
  }
  return projected
}

function normalizeCondition(condition: string | undefined): string | undefined {
  if (!condition) return undefined
  const separator = condition.indexOf(':')
  return separator < 0 ? condition : condition.slice(0, separator)
}

function retryViews(agentRun: PublicAgentRun): AgentExecutionView['retries'] {
  if (agentRun.attempt <= 1) return []
  return Array.from({ length: agentRun.attempt }, (_, index) => {
    const attempt = index + 1
    const current = attempt === agentRun.attempt
    return {
      attempt,
      status: current ? mapAgentStatus(agentRun.status) : 'failed',
      ...(current && agentRun.completedAt ? { completedAt: agentRun.completedAt } : {}),
      ...(!current && agentRun.error ? { error: sanitizeUserFacingError(agentRun.error) } : {})
    }
  })
}

function publicDecision(decision: RuntimeDecision): RuntimeDecisionView {
  return {
    preferredMode: decision.preferredMode,
    effectiveMode: decision.effectiveMode,
    preference: decision.preference,
    source: decision.source,
    reasonCode: decision.reasonCode,
    reason: decision.reason,
    ...(decision.fallbackReasonCode ? { fallbackReasonCode: decision.fallbackReasonCode } : {}),
    ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
    rolloutStage: decision.rolloutStage,
    decidedAt: decision.decidedAt
  }
}

function publicUsage(usage: {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd?: number
  costCny?: number
}): UserFacingUsage {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {})
  }
}

function mapRunStatus(status: MultiAgentRun['status']): ExecutionStatus {
  if (status === 'created') return 'queued'
  if (status === 'suspended') return 'running'
  return status
}

function mapAgentStatus(status: AgentRun['status']): ExecutionStatus {
  return status === 'suspended' ? 'running' : status
}

function byPublicSequence(left: ChildRunRecord, right: ChildRunRecord): number {
  return left.sequence! - right.sequence! || left.publicKey!.localeCompare(right.publicKey!)
}

function durationBetween(startedAt: string, completedAt: string): number {
  const duration = Date.parse(completedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

function isTerminal(status: ExecutionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}
