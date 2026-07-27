import {
  AgentGraphSchema,
  type AgentGraph,
  type AgentGraphNode,
  type JoinNode,
  type ParallelBranch,
  type ParallelNode
} from '@qiongqi/contracts'

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
  const nodesById = new Map<string, AgentGraphNode>()
  for (const node of parsed.nodes) {
    if (nodeIds.has(node.id)) throw new Error(`AgentGraph duplicate node id: ${node.id}`)
    nodeIds.add(node.id)
    nodesById.set(node.id, node)
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
  validateParallelGroups(parsed, nodesById)
  return graph
}

function validateParallelGroups(graph: AgentGraph, nodesById: ReadonlyMap<string, AgentGraphNode>): void {
  const branchIds = new Set<string>()
  const parallelNodes = graph.nodes.filter((node): node is ParallelNode => node.kind === 'parallel')
  const joinNodes = graph.nodes.filter((node): node is JoinNode => node.kind === 'join')

  for (const join of joinNodes) validateJoinOutput(join)

  for (const parallel of parallelNodes) {
    for (const branch of parallel.branches) {
      if (branchIds.has(branch.branchId)) throw new Error(`AgentGraph duplicate branch id: ${branch.branchId}`)
      branchIds.add(branch.branchId)
      if (!nodesById.has(branch.startNodeId)) {
        throw new Error(`AgentGraph branch start node is unknown: ${branch.branchId} -> ${branch.startNodeId}`)
      }
    }

    const join = nodesById.get(parallel.joinNodeId)
    if (join?.kind !== 'join') throw new Error(`AgentGraph parallel join node is invalid: ${parallel.id} -> ${parallel.joinNodeId}`)
    if (join.sourceParallelNodeId !== parallel.id) {
      throw new Error(`AgentGraph join owner mismatch: ${join.id} -> ${parallel.id}`)
    }
    if (!sameStringSet(join.requiredBranchIds, parallel.branches.map((branch) => branch.branchId))) {
      throw new Error(`AgentGraph join branch set mismatch: ${join.id}`)
    }
    if (graph.edges.some((edge) => edge.from === parallel.id)) {
      throw new Error(`AgentGraph parallel node cannot use normal outgoing edges: ${parallel.id}`)
    }

    const groupNodeIds = new Set<string>()
    for (const branch of parallel.branches) {
      const reachable = branchPathToJoin(graph, nodesById, branch, join.id)
      for (const nodeId of reachable) groupNodeIds.add(nodeId)
    }
    const externalEntry = graph.edges.find((edge) => edge.to === join.id && !groupNodeIds.has(edge.from))
    if (externalEntry) {
      throw new Error(`AgentGraph join has external entry: ${externalEntry.from} -> ${join.id}`)
    }
  }

  for (const join of joinNodes) {
    if (join.requiredBranchIds.length === 0) throw new Error(`AgentGraph join requires branch ids: ${join.id}`)
    if (!join.sourceParallelNodeId || !parallelNodes.some((parallel) => parallel.id === join.sourceParallelNodeId)) {
      throw new Error(`AgentGraph join source parallel node is invalid: ${join.id}`)
    }
  }
}

function validateJoinOutput(join: JoinNode): void {
  if (join.requiredBranchIds.length === 0) throw new Error(`AgentGraph join requires branch ids: ${join.id}`)
  if (new Set(join.requiredBranchIds).size !== join.requiredBranchIds.length) {
    throw new Error(`AgentGraph join has duplicate branch ids: ${join.id}`)
  }
  if (join.outputPolicy === 'selected') {
    if (!join.selectedBranchIds?.length) throw new Error(`AgentGraph selected join requires branch ids: ${join.id}`)
    for (const branchId of join.selectedBranchIds) {
      if (!join.requiredBranchIds.includes(branchId)) {
        throw new Error(`AgentGraph selected join branch is not required: ${branchId}`)
      }
    }
    return
  }
  if (join.selectedBranchIds !== undefined) {
    throw new Error(`AgentGraph selected branch ids require selected output policy: ${join.id}`)
  }
}

function branchPathToJoin(
  graph: AgentGraph,
  nodesById: ReadonlyMap<string, AgentGraphNode>,
  branch: ParallelBranch,
  joinNodeId: string
): Set<string> {
  const visited = new Set<string>()
  const pending = [branch.startNodeId]
  let reachedJoin = false
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (nodeId === joinNodeId) {
      reachedJoin = true
      continue
    }
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    const node = nodesById.get(nodeId)
    if (!node) continue
    if (node.kind === 'parallel') throw new Error(`AgentGraph nested parallel is unsupported: ${node.id}`)
    if (node.kind === 'terminate') continue
    for (const edge of graph.edges) {
      if (edge.from === nodeId) pending.push(edge.to)
    }
  }
  if (!reachedJoin) throw new Error(`AgentGraph branch does not reach join: ${branch.branchId} -> ${joinNodeId}`)
  return visited
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const sortedRight = [...right].sort()
  return [...left].sort().every((value, index) => value === sortedRight[index])
}

export function parallelGroupForJoin(graph: AgentGraph, joinNodeId: string): ParallelNode | undefined {
  const join = graph.nodes.find((node): node is JoinNode => node.id === joinNodeId && node.kind === 'join')
  if (!join?.sourceParallelNodeId) return undefined
  return graph.nodes.find((node): node is ParallelNode => node.id === join.sourceParallelNodeId && node.kind === 'parallel')
}

export function branchForId(graph: AgentGraph, branchId: string): { parallel: ParallelNode; branch: ParallelBranch } | undefined {
  for (const node of graph.nodes) {
    if (node.kind !== 'parallel') continue
    const branch = node.branches.find((candidate) => candidate.branchId === branchId)
    if (branch) return { parallel: node, branch }
  }
  return undefined
}

export function requireGraphNode(graph: AgentGraph, nodeId: string): AgentGraphNode {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`AgentGraph node not found: ${nodeId}`)
  return node
}

export function nextNodeForCondition(graph: AgentGraph, nodeId: string, condition: string): string | undefined {
  return graph.edges.find((edge) => edge.from === nodeId && edge.condition === condition)?.to
}
