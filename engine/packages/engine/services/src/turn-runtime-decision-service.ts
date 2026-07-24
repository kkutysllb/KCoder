import {
  RuntimeCapabilitySnapshotSchema,
  RuntimeDecisionSchema,
  type OrchestrationPreference,
  type RuntimeCapabilitySnapshot,
  type RuntimeDecision,
  type StartTurnRequest
} from '@qiongqi/contracts'
import type { ThreadStore } from '@qiongqi/ports'

export type TurnRuntimeDecisionInput = {
  threadId: string
  turnId: string
  request: Pick<StartTurnRequest, 'orchestrationPreference' | 'collaborationPolicy'>
}

export type AgentGraphPreflight = {
  available: boolean
  reasonCode?: string
  reason?: string
}

export type TurnRuntimeDecisionServiceDeps = {
  threadStore: ThreadStore
  defaultPreference: OrchestrationPreference
  serverOverride?: RuntimeDecision['effectiveMode']
  rolloutStage: RuntimeDecision['rolloutStage']
  capabilities: () => Promise<RuntimeCapabilitySnapshot>
  preflight: (input: {
    threadId: string
    turnId: string
    snapshot: RuntimeCapabilitySnapshot
  }) => Promise<AgentGraphPreflight>
  nowIso: () => string
}

export class TurnRuntimeDecisionService {
  private readonly decisionQueues = new Map<string, Promise<void>>()

  constructor(private readonly deps: TurnRuntimeDecisionServiceDeps) {}

  async decide(input: TurnRuntimeDecisionInput): Promise<RuntimeDecision> {
    const key = `${input.threadId}:${input.turnId}`
    const previous = this.decisionQueues.get(key) ?? Promise.resolve()
    let result: RuntimeDecision | undefined
    const run = previous.catch(() => undefined).then(async () => {
      result = await this.decideSerialized(input)
    })
    const guard = run.then(() => undefined, () => undefined)
    this.decisionQueues.set(key, guard)
    try {
      await run
      if (!result) throw new Error(`runtime decision was not produced: ${input.turnId}`)
      return result
    } finally {
      if (this.decisionQueues.get(key) === guard) this.decisionQueues.delete(key)
    }
  }

  private async decideSerialized(input: TurnRuntimeDecisionInput): Promise<RuntimeDecision> {
    const currentThread = await this.deps.threadStore.get(input.threadId)
    const currentTurn = currentThread?.turns.find((turn) => turn.id === input.turnId)
    if (!currentThread || !currentTurn) {
      throw new Error(`turn not found: ${input.threadId}/${input.turnId}`)
    }
    if (currentTurn.runtimeDecision) return currentTurn.runtimeDecision

    const snapshot = RuntimeCapabilitySnapshotSchema.parse(await this.deps.capabilities())
    const normalized = normalizePreference(input.request, this.deps.defaultPreference)
    const preferredMode = normalized.preference === 'team' ? 'evented_v2' : 'kernel_v3'
    let effectiveMode: RuntimeDecision['effectiveMode'] = this.deps.serverOverride ?? preferredMode
    let fallback: Pick<RuntimeDecision, 'fallbackReasonCode' | 'fallbackReason'> = {}

    if (!this.deps.serverOverride && preferredMode === 'evented_v2') {
      const preflight = await this.preflight(input, snapshot)
      if (!preflight.available) {
        effectiveMode = 'kernel_v3'
        fallback = {
          fallbackReasonCode: preflight.reasonCode ?? 'agent_graph_unavailable',
          fallbackReason: preflight.reason ?? 'Team orchestration is unavailable before execution'
        }
      }
    }

    const source = this.deps.serverOverride ? 'server_override' : normalized.source
    const decision = RuntimeDecisionSchema.parse({
      preferredMode,
      effectiveMode,
      preference: normalized.preference,
      source,
      reasonCode: this.deps.serverOverride
        ? 'server_override'
        : normalized.preference === 'team'
          ? normalized.source === 'legacy' ? 'legacy_team' : 'explicit_team'
          : normalized.source === 'legacy' ? 'legacy_standard' : 'standard_execution',
      reason: this.deps.serverOverride
        ? `Server override selected ${this.deps.serverOverride}`
        : normalized.preference === 'team'
          ? 'Team orchestration selected'
          : 'Standard execution selected',
      ...fallback,
      rolloutStage: this.deps.rolloutStage,
      capabilityRevision: snapshot.revision,
      decidedAt: this.deps.nowIso()
    })

    const latestThread = await this.deps.threadStore.get(input.threadId)
    const latestTurn = latestThread?.turns.find((turn) => turn.id === input.turnId)
    if (!latestThread || !latestTurn) {
      throw new Error(`turn not found: ${input.threadId}/${input.turnId}`)
    }
    if (latestTurn.runtimeDecision) return latestTurn.runtimeDecision

    await this.deps.threadStore.upsert({
      ...latestThread,
      updatedAt: this.deps.nowIso(),
      turns: latestThread.turns.map((turn) => turn.id === input.turnId
        ? { ...turn, runtimeDecision: decision, runtimeCapabilitySnapshot: snapshot }
        : turn)
    })
    return decision
  }

  private async preflight(
    input: TurnRuntimeDecisionInput,
    snapshot: RuntimeCapabilitySnapshot
  ): Promise<AgentGraphPreflight> {
    if (!snapshot.agentGraph.enabled) {
      return {
        available: false,
        reasonCode: 'agent_graph_disabled',
        reason: 'AgentGraph capability is disabled'
      }
    }
    if (snapshot.agentGraph.specialistRegistry.length === 0) {
      return {
        available: false,
        reasonCode: 'specialist_registry_empty',
        reason: 'No Specialist is registered'
      }
    }
    return this.deps.preflight({
      threadId: input.threadId,
      turnId: input.turnId,
      snapshot
    })
  }
}

function normalizePreference(
  request: TurnRuntimeDecisionInput['request'],
  defaultPreference: OrchestrationPreference
): { preference: OrchestrationPreference; source: Exclude<RuntimeDecision['source'], 'server_override'> } {
  if (request.orchestrationPreference) {
    return { preference: request.orchestrationPreference, source: 'turn' }
  }
  if (request.collaborationPolicy) {
    return {
      preference: request.collaborationPolicy === 'auto' ? 'team' : 'standard',
      source: 'legacy'
    }
  }
  return { preference: defaultPreference, source: 'default' }
}
