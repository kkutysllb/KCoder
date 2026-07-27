export type DuplicateDecision =
  | { action: 'execute' }
  | { action: 'replay'; resultRef: string }
  | { action: 'suppress_semantic'; resultRef: string }
  | { action: 'replay_and_require_strategy_change'; nextStrategyRevision: number }
  | { action: 'checkpoint_and_converge' }
  | { action: 'degrade_no_progress' }

export interface DuplicateDecisionInput {
  duplicateCount: number
  strategyChanged: boolean
  progressChanged: boolean
  currentStrategyRevision?: number
  exactResultRef?: string
  semanticResultRef?: string
}

export type DuplicateCounterEvent = 'duplicate' | 'resume' | 'graph_retry'

export interface NextDuplicateCountInput {
  current: number
  event: DuplicateCounterEvent
  progressChanged: boolean
}

export function decideDuplicateAction(input: DuplicateDecisionInput): DuplicateDecision {
  requireCount(input.duplicateCount, 'duplicateCount')
  if (input.progressChanged || input.duplicateCount === 0) return { action: 'execute' }

  if (input.duplicateCount === 1) {
    if (input.exactResultRef) return { action: 'replay', resultRef: input.exactResultRef }
    if (input.semanticResultRef) return { action: 'suppress_semantic', resultRef: input.semanticResultRef }
    return { action: 'checkpoint_and_converge' }
  }

  if (input.duplicateCount === 2) {
    if (input.strategyChanged) return { action: 'execute' }
    const currentRevision = input.currentStrategyRevision ?? 1
    requireCount(currentRevision, 'currentStrategyRevision')
    return {
      action: 'replay_and_require_strategy_change',
      nextStrategyRevision: currentRevision + 1
    }
  }

  if (input.duplicateCount === 3) return { action: 'checkpoint_and_converge' }
  return { action: 'degrade_no_progress' }
}

export function nextDuplicateCount(input: NextDuplicateCountInput): number {
  requireCount(input.current, 'current')
  if (input.progressChanged || input.event === 'graph_retry') return 0
  if (input.event === 'resume') return input.current
  return input.current + 1
}

function requireCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative integer`)
}
