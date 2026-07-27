import { describe, expect, it } from 'vitest'
import {
  defaultManagerSpecialistGraph,
  nextNodeForCondition,
  requireGraphNode,
  validateAgentGraph
} from '@qiongqi/loop'

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
})
