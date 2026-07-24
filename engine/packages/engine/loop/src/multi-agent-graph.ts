import { AgentGraphSchema, type AgentGraph, type AgentGraphNode } from '@qiongqi/contracts'

export function defaultManagerSpecialistGraph(input: {
  managerAgentId: string
  specialistAgentId: string
}): AgentGraph {
  const specialistNodeId = input.specialistAgentId
  const graph = AgentGraphSchema.parse({
    version: 1,
    graphId: `manager_to_${input.specialistAgentId}`,
    startNodeId: 'manager',
    nodes: [
      { id: 'manager', kind: 'agent', agentId: input.managerAgentId, label: 'Manager' },
      { id: `handoff_${input.specialistAgentId}`, kind: 'handoff', targetAgentId: input.specialistAgentId },
      { id: specialistNodeId, kind: 'agent', agentId: input.specialistAgentId, label: input.specialistAgentId },
      { id: 'done', kind: 'terminate' }
    ],
    edges: [
      { from: 'manager', to: `handoff_${input.specialistAgentId}`, condition: 'handoff' },
      { from: `handoff_${input.specialistAgentId}`, to: specialistNodeId, condition: 'accepted' },
      { from: specialistNodeId, to: 'done', condition: 'completed' }
    ]
  })
  return validateAgentGraph(graph)
}

export function validateAgentGraph(graph: AgentGraph): AgentGraph {
  const parsed = AgentGraphSchema.parse(graph)
  const nodeIds = new Set<string>()
  for (const node of parsed.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`AgentGraph duplicate node id: ${node.id}`)
    nodeIds.add(node.id)
  }
  if (!nodeIds.has(parsed.startNodeId)) throw new Error(`AgentGraph startNodeId is unknown: ${parsed.startNodeId}`)
  const edgeConditionsBySource = new Map<string, Set<string>>()
  for (const edge of parsed.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`AgentGraph edge points to unknown node: ${edge.from} -> ${edge.to}`)
    }
    const edgeConditions = edgeConditionsBySource.get(edge.from) ?? new Set<string>()
    if (edgeConditions.has(edge.condition)) {
      throw new Error(`AgentGraph duplicate edge condition: ${edge.from}:${edge.condition}`)
    }
    edgeConditions.add(edge.condition)
    edgeConditionsBySource.set(edge.from, edgeConditions)
  }
  return graph
}

export function requireGraphNode(graph: AgentGraph, nodeId: string): AgentGraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`AgentGraph node not found: ${nodeId}`)
  return node
}

export function nextNodeForCondition(graph: AgentGraph, nodeId: string, condition: string): string | undefined {
  return graph.edges.find((edge) => edge.from === nodeId && edge.condition === condition)?.to
}
