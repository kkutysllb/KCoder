import { describe, expect, it } from 'vitest'
import { AgentGraphSchema, GraphRevisionSchema, type AgentGraph } from '@qiongqi/contracts'
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
  it('preserves node policies for every public node kind and edge policies', () => {
    const nodePolicyRef = { policyId: 'node-policy', revision: 7 }
    const edgePolicyRef = { policyId: 'edge-policy', revision: 3 }
    const input = AgentGraphSchema.parse({
      version: 1,
      graphId: 'policy-complete-flow',
      startNodeId: 'fan-out',
      nodes: [
        {
          id: 'fan-out',
          kind: 'parallel',
          branches: [
            { branchId: 'left', startNodeId: 'agent' },
            { branchId: 'right', startNodeId: 'judge' }
          ],
          joinNodeId: 'join',
          nodePolicyRef
        },
        { id: 'agent', kind: 'agent', agentId: 'writer', nodePolicyRef },
        { id: 'judge', kind: 'judge', policy: 'quality', nodePolicyRef },
        {
          id: 'join',
          kind: 'join',
          sourceParallelNodeId: 'fan-out',
          requiredBranchIds: ['left', 'right'],
          nodePolicyRef
        },
        { id: 'handoff', kind: 'handoff', targetAgentId: 'reviewer', nodePolicyRef },
        { id: 'tool', kind: 'tool', toolName: 'lookup', nodePolicyRef },
        { id: 'wait', kind: 'wait', waitFor: 'approval', nodePolicyRef },
        { id: 'retry', kind: 'retry', maxAttempts: 2, nodePolicyRef },
        { id: 'done', kind: 'terminate', nodePolicyRef }
      ],
      edges: [
        { from: 'agent', to: 'join', condition: 'completed', edgePolicyRef },
        { from: 'judge', to: 'join', condition: 'completed', edgePolicyRef }
      ]
    })

    const revision = compileAgentGraph(input, { revision: 1, publishedAt })

    expect(revision.nodes).toHaveLength(9)
    for (const node of revision.nodes) expect(node.nodePolicyRef).toEqual(nodePolicyRef)
    expect(revision.edges[0]?.edgePolicyRef).toEqual(edgePolicyRef)
    expect(GraphRevisionSchema.parse(revision)).toEqual(revision)
  })

  it('includes policy revisions in the digest without changing logical edge identity', () => {
    const policyGraph = (revision: number) => AgentGraphSchema.parse({
      version: 1,
      graphId: 'policy-digest-flow',
      startNodeId: 'maker',
      nodes: [
        {
          id: 'maker',
          kind: 'agent',
          agentId: 'implementer',
          nodePolicyRef: { policyId: 'node-policy', revision }
        },
        { id: 'done', kind: 'terminate' }
      ],
      edges: [{
        from: 'maker',
        to: 'done',
        condition: 'completed',
        edgePolicyRef: { policyId: 'edge-policy', revision }
      }]
    })
    const first = compileAgentGraph(policyGraph(7), { revision: 1, publishedAt })
    const second = compileAgentGraph(policyGraph(8), { revision: 1, publishedAt })

    expect(first.graphDigest).not.toBe(second.graphDigest)
    expect(first.edges[0]?.edgeId).toBe(second.edges[0]?.edgeId)
  })

  it('compiles an explicit three-branch parallel group with a non-empty join', () => {
    const input: AgentGraph = {
      version: 1,
      graphId: 'parallel-review-flow',
      startNodeId: 'fan_out',
      nodes: [
        {
          id: 'fan_out',
          kind: 'parallel',
          branches: [
            { branchId: 'research', startNodeId: 'researcher' },
            { branchId: 'draft', startNodeId: 'writer' },
            { branchId: 'review', startNodeId: 'reviewer' }
          ],
          joinNodeId: 'join_all',
          failurePolicy: 'wait_all'
        },
        { id: 'researcher', kind: 'agent', agentId: 'researcher' },
        { id: 'writer', kind: 'agent', agentId: 'writer' },
        { id: 'reviewer', kind: 'agent', agentId: 'reviewer' },
        {
          id: 'join_all',
          kind: 'join',
          sourceParallelNodeId: 'fan_out',
          requiredBranchIds: ['research', 'draft', 'review'],
          outputPolicy: 'all'
        },
        { id: 'done', kind: 'terminate' }
      ],
      edges: [
        { from: 'researcher', to: 'join_all', condition: 'completed' },
        { from: 'writer', to: 'join_all', condition: 'completed' },
        { from: 'reviewer', to: 'join_all', condition: 'completed' },
        { from: 'join_all', to: 'done', condition: 'completed' }
      ]
    }

    const revision = compileAgentGraph(input, { revision: 1, publishedAt })

    expect(revision.nodes[0]).toEqual(input.nodes[0])
    expect(revision.nodes[4]).toEqual(input.nodes[4])
  })

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
