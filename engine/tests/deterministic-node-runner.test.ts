import { describe, expect, it } from 'vitest'
import type { GraphNodeV1 } from '@qiongqi/contracts'
import { decideDeterministicNode } from '@qiongqi/loop'

describe('deterministic graph nodes', () => {
  it.each([
    [{ id: 'handoff', kind: 'handoff', targetAgentId: 'agent-b' }, { status: 'advance', condition: 'accepted' }],
    [{ id: 'tool', kind: 'tool', toolName: 'read' }, { status: 'wait', reason: 'tool:read' }],
    [{ id: 'join', kind: 'join', requiredBranchIds: ['a'] }, { status: 'advance', condition: 'completed' }],
    [{ id: 'wait', kind: 'wait', waitFor: 'approval' }, { status: 'wait', reason: 'approval' }],
    [{ id: 'retry', kind: 'retry', maxAttempts: 1 }, {
      status: 'advance', condition: 'retry', payload: { attempts: 1, maxAttempts: 1 }
    }],
    [{ id: 'done', kind: 'terminate' }, {
      status: 'terminate', outcome: { status: 'completed', reason: 'normal_stop', retryable: false }
    }]
  ] as const)('decides %s without a model executor', (node, expected) => {
    const result = decideDeterministicNode(node as GraphNodeV1, {
      branchStatus: { a: 'completed' },
      retryCounters: { retry: 0 },
      resolvedConditions: {}
    })
    expect(result).toEqual(expected)
  })

  it('uses the externally resolved tool condition without model inference', () => {
    expect(decideDeterministicNode(
      { id: 'tool', kind: 'tool', toolName: 'read' },
      { branchStatus: {}, retryCounters: {}, resolvedConditions: { tool: 'completed' } }
    )).toEqual({ status: 'advance', condition: 'completed' })
  })
})
