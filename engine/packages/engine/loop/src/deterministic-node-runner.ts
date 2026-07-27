import type { GraphNodeV1, RunOutcome } from '@qiongqi/contracts'

export type GraphRuntimeView = {
  branchStatus: Record<string, 'queued' | 'running' | 'completed' | 'failed' | 'aborted'>
  retryCounters: Record<string, number>
  resolvedConditions: Record<string, string>
}

export type DeterministicNodeDecision =
  | { status: 'advance'; condition: string; payload?: unknown }
  | { status: 'wait'; reason: string }
  | { status: 'terminate'; outcome: RunOutcome }

export function decideDeterministicNode(
  node: GraphNodeV1,
  state: GraphRuntimeView
): DeterministicNodeDecision {
  switch (node.kind) {
    case 'handoff':
      return { status: 'advance', condition: 'accepted' }
    case 'tool': {
      const condition = state.resolvedConditions[node.id]
      return condition ? { status: 'advance', condition } : { status: 'wait', reason: `tool:${node.toolName}` }
    }
    case 'join':
      return node.requiredBranchIds.every((branchId) => state.branchStatus[branchId] === 'completed')
        ? { status: 'advance', condition: 'completed' }
        : { status: 'wait', reason: 'join' }
    case 'wait': {
      const condition = state.resolvedConditions[node.id]
      return condition ? { status: 'advance', condition } : { status: 'wait', reason: node.waitFor }
    }
    case 'retry': {
      const attempts = (state.retryCounters[node.id] ?? 0) + 1
      return {
        status: 'advance',
        condition: attempts <= node.maxAttempts ? 'retry' : 'exhausted',
        payload: { attempts, maxAttempts: node.maxAttempts }
      }
    }
    case 'terminate':
      return { status: 'terminate', outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }
    case 'agent':
    case 'judge':
      throw new Error(`${node.kind} is model-driven and cannot use the deterministic node runner`)
  }
}
