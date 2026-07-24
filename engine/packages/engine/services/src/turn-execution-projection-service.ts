import { createHash } from 'node:crypto'
import {
  TurnExecutionViewSchema,
  type TurnExecutionView
} from '@qiongqi/contracts'
import type {
  DelegationRunStore,
  MultiAgentRunStore,
  ThreadStore
} from '@qiongqi/ports'
import type { EventedV2ExecutionAdapterContract } from './evented-v2-execution-adapter.js'
import {
  projectRootAgent,
  type KernelV3ExecutionAdapterContract
} from './kernel-v3-execution-adapter.js'
import { sanitizeTurnExecution } from './turn-execution-sanitizer.js'

export type TurnExecutionProjectionServiceDeps = {
  threads: Pick<ThreadStore, 'get'>
  runs: Pick<MultiAgentRunStore, 'load'>
  delegation: Pick<DelegationRunStore, 'list'>
  kernel: KernelV3ExecutionAdapterContract
  eventedV2: EventedV2ExecutionAdapterContract
}

export interface TurnExecutionProjectionServiceContract {
  get(input: { threadId: string; turnId: string }): Promise<TurnExecutionView>
}

export class TurnExecutionNotFound extends Error {
  constructor() {
    super('Turn execution not found')
    this.name = 'TurnExecutionNotFound'
  }
}

export class TurnExecutionProjectionService implements TurnExecutionProjectionServiceContract {
  constructor(private readonly deps: TurnExecutionProjectionServiceDeps) {}

  async get(input: { threadId: string; turnId: string }): Promise<TurnExecutionView> {
    const thread = await this.deps.threads.get(input.threadId)
    if (!thread) throw new TurnExecutionNotFound()
    const turn = thread.turns.find((candidate) => candidate.id === input.turnId)
    if (!turn) throw new TurnExecutionNotFound()
    const decision = turn.runtimeDecision
    if (!decision) {
      return {
        version: 1,
        available: false,
        revision: 'legacy:0',
        reason: turn.collaborationPolicy || turn.orchestrationPreference
          ? 'legacy_mode'
          : 'legacy_turn'
      }
    }

    let projected: TurnExecutionView
    if (decision.effectiveMode === 'kernel_v3') {
      const childRuns = await this.deps.delegation.list(thread.id)
      projected = await this.deps.kernel.project({ thread, turn, childRuns })
    } else if (decision.effectiveMode === 'evented_v2') {
      if (!turn.eventedV2RunId) return unavailableNotRecorded()
      const run = await this.deps.runs.load(turn.eventedV2RunId)
      if (!run || run.threadId !== thread.id || run.turnId !== turn.id) return unavailableNotRecorded()
      const childRuns = await this.deps.delegation.list(thread.id)
      projected = await this.deps.eventedV2.project({ turn, run, childRuns })
    } else {
      projected = sanitizeTurnExecution({
        version: 1,
        available: true,
        revision: 'sha256:unrevisioned',
        mode: 'classic',
        status: turn.status,
        decision: {
          preferredMode: decision.preferredMode,
          effectiveMode: decision.effectiveMode,
          preference: decision.preference,
          source: decision.source,
          reasonCode: decision.reasonCode,
          reason: decision.reason,
          ...(decision.fallbackReasonCode
            ? { fallbackReasonCode: decision.fallbackReasonCode }
            : {}),
          ...(decision.fallbackReason ? { fallbackReason: decision.fallbackReason } : {}),
          rolloutStage: decision.rolloutStage,
          decidedAt: decision.decidedAt
        },
        agents: [projectRootAgent(turn, `root:${turn.id}`)],
        compatibility: { reason: decision.reason }
      })
    }

    const sanitized = sanitizeTurnExecution(projected)
    if (!sanitized.available) return sanitized
    return withDurableRevision(sanitized)
  }
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function withDurableRevision(view: Exclude<TurnExecutionView, { available: false }>): TurnExecutionView {
  const { revision: _revision, ...withoutRevision } = view
  const revision = `sha256:${createHash('sha256')
    .update(stableJson(withoutRevision))
    .digest('hex')}`
  return TurnExecutionViewSchema.parse({ ...view, revision })
}

function unavailableNotRecorded(): TurnExecutionView {
  return {
    version: 1,
    available: false,
    revision: 'legacy:0',
    reason: 'not_recorded'
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
  )
}
