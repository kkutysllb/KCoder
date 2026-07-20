import type { TurnItem } from '@qiongqi/contracts'

// ---------------------------------------------------------------------------
// Stage 3: Turn event types (compatible with classic + evented orchestrator)
// ---------------------------------------------------------------------------

/**
 * Event-driven turn lifecycle events (Stage 3).
 *
 * Each event represents one discrete step inside a turn. The
 * eventing orchestrator publishes these so peer components
 * (PromptBuilder, ModelStepRunner, ContinuationPolicy,
 * ToolCallCoordinator) can subscribe independently.
 *
 * The classic orchestrator (`TurnOrchestrator`) does NOT emit
 * these — it calls the same components imperatively. The event
 * format is designed so an event log can act as a replayable
 * record (crash recovery via event sourcing).
 */
export type TurnStepEvent =
  | { kind: 'step:start'; stepIndex: number }
  | { kind: 'step:steering'; steeringCount: number }
  | { kind: 'prompt:built'; requestId: string; promptTokens: number }
  | {
      kind: 'model:ran'
      stopReason: string
      toolCalls?: Array<{ callId: string; toolName: string }>
      text?: string
      usage?: { inputTokens: number; outputTokens: number }
    }
  | {
      kind: 'decision'
      action: 'stop' | 'continue' | 'dispatch' | 'materialize_plan' | 'failed' | 'failed_with_error'
      errorCode?: string
      errorMessage?: string
    }
  | {
      kind: 'tools:dispatched'
      callCount: number
      aborted: boolean
    }
  | { kind: 'step:retry'; reason: string; attempt: number }
  | { kind: 'step:end'; status: 'completed' | 'failed' | 'aborted' | 'retried' }
  | { kind: 'turn:failed'; error: string }

/**
 * Serializable state of one turn inside the event-driven orchestrator.
 *
 * Stored at `<dataDir>/threads/<threadId>/turns/<turnId>/state.json`
 * for crash recovery. The classic orchestrator does NOT write this —
 * it only appears when `orchestrationMode === 'evented'`.
 */
export interface TurnStateV1 {
  /** Schema version for forward compatibility. */
  version: 1
  threadId: string
  turnId: string
  /** Last completed step index (resume point). */
  stepIndex: number
  /** Accumulated step events (event-sourcing log). */
  events: TurnStepEvent[]
  /** Items produced by the turn so far. */
  items: TurnItem[]
  /** Turn-level metadata. */
  status: 'running' | 'completed' | 'failed' | 'aborted'
  startedAt: string
  updatedAt: string
}

/**
 * Serialisation contract for turn state persistence.
 *
 * Implemented by the file system adapter; swapped in tests
 * for in-memory verification without touching disk. Operates on
 * {@link TurnStateV2} (alias of `LoopRun`); persisted v1 blobs are
 * upgraded transparently on load.
 */
import type { LoopRun } from './loop-plan.js'

export interface TurnStateSerializer {
  /** Persist current turn state (create or update). */
  save(state: LoopRun): Promise<void>
  /** Load a previously persisted state, or undefined. */
  load(threadId: string, turnId: string): Promise<LoopRun | undefined>
  /** Remove persisted state (e.g. after turn completion). */
  delete(threadId: string, turnId: string): Promise<void>
  /** List all turn states for a thread. */
  list(threadId: string): Promise<LoopRun[]>
}

/**
 * Orchestration mode (Stage 3.4 dual-run strategy).
 *
 * - `kernel_v3` — the durable kernel loop used by the production runtime
 *   factory by default.
 * - `classic` — the existing imperative `TurnOrchestrator` (explicit
 *   compatibility fallback, battle-tested, no behaviour change).
 * - `evented` — the Stage-3 event-driven orchestrator with
 *   `TurnState` persistence and crash recovery.
 *
 * The generic normalizer retains classic as its legacy fallback; production
 * default selection is handled by `orchestrationModeForRuntimeOptions`.
 */
export const ORCHESTRATION_MODES = ['classic', 'evented', 'evented_v2', 'kernel_v3'] as const
export type OrchestrationMode = (typeof ORCHESTRATION_MODES)[number]

/** Normalize legacy configuration while retaining classic as the safe fallback. */
export function normalizeOrchestrationMode(value: unknown): OrchestrationMode {
  if (value === 'kernel_v3') return 'kernel_v3'
  if (value === 'evented' || value === 'evented_v2') return 'evented_v2'
  return 'classic'
}

// Re-exported from loop-plan.ts so persistence code and consumers reference
// a single shape under its persistence-schema name. `LoopRun` is the
// conceptual name; `TurnStateV2` is the evolved `TurnStateV1` schema.
export type { LoopRun as TurnStateV2 } from './loop-plan.js'
