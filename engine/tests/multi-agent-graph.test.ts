import { describe, expect, it } from 'vitest'
import {
  defaultManagerSpecialistGraph,
  nextNodeForCondition,
  requireGraphNode,
  validateAgentGraph
} from '@qiongqi/loop'
import type { AgentGraph } from '@qiongqi/contracts'

function parallelGraph(): AgentGraph {
  return {
    version: 1,
    graphId: 'parallel_graph',
    startNodeId: 'fan_out',
    nodes: [
      {
        id: 'fan_out', kind: 'parallel', joinNodeId: 'join_all', failurePolicy: 'wait_all',
        branches: [
          { branchId: 'research', startNodeId: 'researcher' },
          { branchId: 'draft', startNodeId: 'writer' },
          { branchId: 'review', startNodeId: 'reviewer' }
        ]
      },
      { id: 'researcher', kind: 'agent', agentId: 'researcher' },
      { id: 'writer', kind: 'agent', agentId: 'writer' },
      { id: 'reviewer', kind: 'agent', agentId: 'reviewer' },
      {
        id: 'join_all', kind: 'join', sourceParallelNodeId: 'fan_out',
        requiredBranchIds: ['research', 'draft', 'review'], outputPolicy: 'all'
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
}

describe('multi-agent graph helpers', () => {
  it('creates a manager-to-specialist graph', () => {
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })

    expect(graph.startNodeId).toBe('manager')
    expect(graph.nodes.map((node) => node.kind)).toEqual(['agent', 'handoff', 'agent', 'terminate'])
    expect(validateAgentGraph(graph)).toBe(graph)
  })

  it('resolves nodes and conditional transitions', () => {
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })

    expect(requireGraphNode(graph, 'manager')).toMatchObject({ kind: 'agent', agentId: 'manager' })
    expect(nextNodeForCondition(graph, 'manager', 'handoff')).toBe('handoff_researcher')
    expect(nextNodeForCondition(graph, 'researcher', 'completed')).toBe('done')
  })

  it('rejects a graph whose edge points at a missing node', () => {
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    expect(() => validateAgentGraph({
      ...graph,
      edges: [...graph.edges, { from: 'manager', to: 'missing', condition: 'bad' }]
    })).toThrow('AgentGraph edge points to unknown node: manager -> missing')
  })

  it('rejects a default graph with duplicate node ids', () => {
    expect(() => defaultManagerSpecialistGraph({
      managerAgentId: 'manager',
      specialistAgentId: 'manager'
    })).toThrow('AgentGraph duplicate node id: manager')
  })

  it('rejects duplicate edge conditions from the same node', () => {
    const graph = defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' })
    expect(() => validateAgentGraph({
      ...graph,
      edges: [...graph.edges, { from: 'manager', to: 'done', condition: 'handoff' }]
    })).toThrow('AgentGraph duplicate edge condition: manager:handoff')
  })

  it('accepts colon-containing edge keys that are distinct pairs', () => {
    const graph = {
      version: 1 as const,
      graphId: 'colon_edge_conditions',
      startNodeId: 'a:b',
      nodes: [
        { id: 'a:b', kind: 'terminate' as const },
        { id: 'a', kind: 'terminate' as const },
        { id: 'target_c', kind: 'terminate' as const },
        { id: 'target_bc', kind: 'terminate' as const }
      ],
      edges: [
        { from: 'a:b', to: 'target_c', condition: 'c' },
        { from: 'a', to: 'target_bc', condition: 'b:c' }
      ]
    }

    expect(validateAgentGraph(graph)).toBe(graph)
  })

  it('accepts an explicit non-empty three-branch parallel group', () => {
    const graph = parallelGraph()
    expect(validateAgentGraph(graph)).toBe(graph)
  })

  it('rejects an empty join instead of completing vacuously', () => {
    const graph = parallelGraph()
    graph.nodes[4] = { id: 'join_all', kind: 'join', requiredBranchIds: [], outputPolicy: 'all' }

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph join requires branch ids: join_all')
  })

  it('rejects graph-wide duplicate branch identities', () => {
    const graph = parallelGraph()
    const parallel = graph.nodes[0]
    if (parallel?.kind !== 'parallel') throw new Error('fixture mismatch')
    parallel.branches[2] = { branchId: 'research', startNodeId: 'reviewer' }

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph duplicate branch id: research')
  })

  it('rejects a join whose required branch set differs from its parallel owner', () => {
    const graph = parallelGraph()
    const join = graph.nodes[4]
    if (join?.kind !== 'join') throw new Error('fixture mismatch')
    join.requiredBranchIds = ['research', 'draft']

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph join branch set mismatch: join_all')
  })

  it('rejects selected output outside the required branch set', () => {
    const graph = parallelGraph()
    const join = graph.nodes[4]
    if (join?.kind !== 'join') throw new Error('fixture mismatch')
    join.outputPolicy = 'selected'
    join.selectedBranchIds = ['missing']

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph selected join branch is not required: missing')
  })

  it('rejects a branch path that terminates before its declared join', () => {
    const graph = parallelGraph()
    graph.edges = graph.edges.map((edge) => edge.from === 'reviewer'
      ? { ...edge, to: 'done' }
      : edge)

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph branch does not reach join: review -> join_all')
  })

  it('rejects nested parallel before the owning join', () => {
    const graph = parallelGraph()
    graph.nodes.push({
      id: 'inner', kind: 'parallel', joinNodeId: 'join_all', failurePolicy: 'wait_all',
      branches: [
        { branchId: 'inner_a', startNodeId: 'writer' },
        { branchId: 'inner_b', startNodeId: 'reviewer' }
      ]
    })
    graph.edges = graph.edges.map((edge) => edge.from === 'researcher'
      ? { ...edge, to: 'inner' }
      : edge)

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph nested parallel is unsupported: inner')
  })

  it('rejects an edge that enters a join from outside its branch group', () => {
    const graph = parallelGraph()
    graph.nodes.push({ id: 'outsider', kind: 'agent', agentId: 'outsider' })
    graph.edges.push({ from: 'outsider', to: 'join_all', condition: 'completed' })

    expect(() => validateAgentGraph(graph)).toThrow('AgentGraph join has external entry: outsider -> join_all')
  })
})
