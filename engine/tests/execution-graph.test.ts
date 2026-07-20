import { describe, expect, it } from 'vitest'
import { validateExecutionGraph, type ExecutionGraph } from '@qiongqi/loop'

function graph(overrides: Partial<ExecutionGraph> = {}): ExecutionGraph {
  return {
    version: 'test-v1',
    startNodeId: 'prepare',
    predicates: ['next'],
    nodes: [
      { id: 'prepare', kind: 'prepare', effect: 'pure', checkpoint: 'both' },
      { id: 'complete', kind: 'complete', effect: 'state', terminal: true, checkpoint: 'after' }
    ],
    edges: [{ from: 'prepare', to: 'complete', when: 'next' }],
    ...overrides
  }
}

describe('execution graph validation', () => {
  it('rejects duplicate nodes and unknown edge endpoints', () => {
    expect(() => validateExecutionGraph(graph({ nodes: [graph().nodes[0], graph().nodes[0]!] }))).toThrow('duplicate node')
    expect(() => validateExecutionGraph(graph({ edges: [{ from: 'missing', to: 'complete', when: 'next' }] }))).toThrow('unknown graph node')
  })

  it('requires loop edges for cycles and registered predicates', () => {
    expect(() => validateExecutionGraph(graph({ edges: [
      { from: 'prepare', to: 'complete', when: 'next' },
      { from: 'complete', to: 'prepare', when: 'next' }
    ] }))).toThrow('cycle')
    expect(() => validateExecutionGraph(graph({ edges: [{ from: 'prepare', to: 'complete', when: 'predicate:missing' }] }))).toThrow('predicate')
    expect(() => validateExecutionGraph(graph({ edges: [
      { from: 'prepare', to: 'complete', when: 'next' },
      { from: 'complete', to: 'prepare', when: 'next', loop: true }
    ] }))).not.toThrow()
  })
})
