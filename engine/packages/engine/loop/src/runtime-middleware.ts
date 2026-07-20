import type { BudgetState, EffectIntent, CommittedEffectRef, RecoveryState, RunIdentity, RunOutcome, RunStateV3 } from '@qiongqi/contracts'
import type { RuntimeNode } from './execution-graph.js'

export type RuntimeHook = 'beforeRun' | 'beforeNode' | 'afterNode' | 'afterRun' | 'onError' | (string & {})

export type MiddlewareCommand =
  | { type: 'set-middleware-state'; id: string; state: { version: number; data: unknown } }
  | { type: 'set-budget'; key: 'stepsUsed' | 'toolCallsUsed' | 'inputTokens' | 'outputTokens' | 'costUsd'; value: number }
  | { type: 'add-budget'; delta: Partial<BudgetState>; usageId?: string }
  | { type: 'set-node-data'; nodeId: string; value: unknown }
  | { type: 'set-task-revision'; revision: number }
  | { type: 'set-recovery'; recovery: RecoveryState }
  | { type: 'set-effects'; pendingEffects: EffectIntent[]; committedEffects: CommittedEffectRef[] }
  | { type: 'jump'; nodeId: string; condition: string; reason: string }
  | { type: 'terminate'; outcome: RunOutcome }
  | { type: 'suspend'; outcome: RunOutcome }
  | { type: 'retry'; reason: string }
  | { type: 'repair-history'; items: unknown[] }
  | { type: 'record-warning'; code: string; message: string }

export type MiddlewareContext = {
  readonly identity: RunIdentity
  readonly state: Readonly<RunStateV3>
  readonly node?: RuntimeNode
  readonly hook: RuntimeHook
  readonly error?: unknown
  readonly facts?: Readonly<Record<string, unknown>>
  readonly commands: readonly MiddlewareCommand[]
}

export type MiddlewareResult = {
  context?: MiddlewareContext
  commands?: MiddlewareCommand[]
  value?: unknown
}

export type RuntimeMiddleware = {
  id: string
  version: number
  hooks: RuntimeHook[]
  before?: string[]
  after?: string[]
  handle: (context: MiddlewareContext, next: (context: MiddlewareContext) => Promise<MiddlewareResult | undefined>) => Promise<MiddlewareResult | undefined> | MiddlewareResult | undefined
}
