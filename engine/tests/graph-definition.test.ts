import { describe, expect, it } from 'vitest'
import { GraphRevisionSchema, type AgentGraph } from '@qiongqi/contracts'
import { compileAgentGraph } from '@qiongqi/loop'

const publishedAt = '2026-07-26T00:00:00.000Z'

function graph(): AgentGraph {
  return {
    version: 1,
    graphId: 'review-flow',
    startNodeId: 'maker',
    nodes: [
      { id: 'maker', kind: 'agent', agentId: 'implementer', model: 'profile-a' },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [{ from: 'maker', to: 'done', condition: 'completed' }]
  }
}

describe('graph definition v1.1', () => {
  it('compiles equivalent AgentGraphs into the same immutable revision digest', () => {
    const first = compileAgentGraph(graph(), { revision: 1, publishedAt })
    const second = compileAgentGraph(structuredClone(graph()), { revision: 1, publishedAt })

    expect(first).toEqual(second)
    expect(first.graphDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(GraphRevisionSchema.parse(first)).toEqual(first)
  })

  it('maps legacy node.model to a policy reference and emits a deprecation diagnostic', () => {
    const revision = compileAgentGraph(graph(), { revision: 1, publishedAt })

    expect(revision.nodes[0]).toMatchObject({
      id: 'maker',
      modelPolicyRef: { policyId: 'profile-a', revision: 1 }
    })
    expect(revision.diagnostics).toContainEqual(expect.objectContaining({
      code: 'agent_node_model_deprecated',
      nodeId: 'maker'
    }))
    expect(revision.nodes[0]).not.toHaveProperty('model')
  })

  it('assigns stable unique edge identities without mutating caller input', () => {
    const input = graph()
    const before = structuredClone(input)
    const revision = compileAgentGraph(input, { revision: 2, publishedAt })

    expect(input).toEqual(before)
    expect(revision.edges).toHaveLength(1)
    expect(revision.edges[0]?.edgeId).toMatch(/^edge_[a-f0-9]{24}$/)
    expect(new Set(revision.edges.map((edge) => edge.edgeId)).size).toBe(revision.edges.length)
  })

  it('rejects duplicate conditional edges before publishing a revision', () => {
    const input = graph()
    input.edges.push({ from: 'maker', to: 'done', condition: 'completed' })

    expect(() => compileAgentGraph(input, { revision: 1, publishedAt })).toThrow(
      'AgentGraph duplicate edge condition: maker:completed'
    )
  })
})
