import type { TurnStepEvent } from './turn-event-types.js'

/** Kind of a phase in the linear loop sequence. */
export type LoopPhaseKind =
  | 'build-prompt'
  | 'run-model'
  | 'decide'
  | 'evaluate'
  | 'dispatch-tools'
  | 'materialize-plan'
  | 'record-error'

/** Declarative phase: pure data; the runner dispatches execution on `kind`. */
export interface LoopPhase {
  kind: LoopPhaseKind
  /** A phase whose decision can end the turn. */
  terminal?: boolean
  /** Retry budget for this phase (evaluate/recover only). */
  maxRetries?: number
}

/** Declarative loop plan: ordered phases for one turn. */
export interface LoopPlan {
  version: 1
  phases: LoopPhase[]
  /** Turn-level budget. */
  budget?: { maxSteps?: number; maxCostUsd?: number }
  /** Global termination conditions. */
  termination?: { stopReasons?: string[] }
}

/**
 * LoopRun: one turn's serialisable run instance. This IS TurnStateV2 —
 * the single persisted shape, exported under both names. `LoopRun` is the
 * conceptual name; `TurnStateV2` is the persistence-schema name (see
 * turn-event-types.ts).
 */
export interface LoopRun {
  version: 2
  threadId: string
  turnId: string
  stepIndex: number
  phaseCursor: number
  events: TurnStepEvent[]
  items: unknown[]
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'retried'
  startedAt: string
  updatedAt: string
}

/**
 * Default plan: behaviour-equivalent to the existing runOrchestratorStep
 * flow, plus one evaluate retry for truncation/error tolerance.
 */
export function defaultLoopPlan(): LoopPlan {
  return {
    version: 1,
    phases: [
      { kind: 'build-prompt' },
      { kind: 'run-model' },
      { kind: 'decide', terminal: true },
      { kind: 'evaluate', maxRetries: 1 },
      { kind: 'dispatch-tools' }
    ],
    budget: { maxSteps: 300 }
  }
}
