export type RuntimeNodeCheckpoint = 'before' | 'after' | 'both' | 'none'

export type RuntimeNode = {
  id: string
  kind: string
  effect: 'pure' | 'model' | 'tool' | 'state' | string
  checkpoint?: RuntimeNodeCheckpoint
  terminal?: boolean
}

export type RuntimeEdge = {
  from: string
  to: string
  when: string
  loop?: boolean
}

export type ExecutionGraph = {
  version: string
  startNodeId: string
  predicates: string[]
  nodes: RuntimeNode[]
  edges: RuntimeEdge[]
}

function cycleError(graph: ExecutionGraph): string | undefined {
  const adjacency = new Map<string, RuntimeEdge[]>()
  for (const node of graph.nodes) adjacency.set(node.id, [])
  for (const edge of graph.edges) adjacency.get(edge.from)?.push(edge)

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stackNodes: string[] = []
  const stackEdges: RuntimeEdge[] = []

  const visit = (nodeId: string): string | undefined => {
    visiting.add(nodeId)
    stackNodes.push(nodeId)
    for (const edge of adjacency.get(nodeId) ?? []) {
      if (visiting.has(edge.to)) {
        const index = stackNodes.lastIndexOf(edge.to)
        const cycleEdges = stackEdges.slice(index).concat(edge)
        if (!cycleEdges.some((candidate) => candidate.loop)) {
          return `graph cycle requires loop edge: ${cycleEdges.map((candidate) => `${candidate.from}->${candidate.to}`).join(', ')}`
        }
        continue
      }
      if (!visited.has(edge.to)) {
        stackEdges.push(edge)
        const error = visit(edge.to)
        stackEdges.pop()
        if (error) return error
      }
    }
    stackNodes.pop()
    visiting.delete(nodeId)
    visited.add(nodeId)
    return undefined
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      const error = visit(node.id)
      if (error) return error
    }
  }
  return undefined
}

export function validateExecutionGraph(input: ExecutionGraph): ExecutionGraph {
  if (!input || typeof input !== 'object') throw new Error('execution graph must be an object')
  if (!input.version?.trim()) throw new Error('graph version is required')
  const ids = new Set<string>()
  for (const node of input.nodes ?? []) {
    if (!node.id?.trim()) throw new Error('graph node id is required')
    if (ids.has(node.id)) throw new Error(`duplicate node: ${node.id}`)
    ids.add(node.id)
  }
  if (!ids.has(input.startNodeId)) throw new Error(`unknown graph node: ${input.startNodeId}`)
  const predicates = new Set(input.predicates ?? [])
  for (const edge of input.edges ?? []) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`unknown graph node in edge: ${edge.from}->${edge.to}`)
    if (!edge.when?.trim()) throw new Error('graph edge predicate is required')
    const predicate = edge.when.startsWith('predicate:') ? edge.when.slice('predicate:'.length) : edge.when
    if (!predicates.has(predicate)) throw new Error(`unregistered predicate: ${predicate}`)
  }
  const error = cycleError(input)
  if (error) throw new Error(error)
  return input
}

export function outgoingEdges(graph: ExecutionGraph, nodeId: string, condition: string): RuntimeEdge[] {
  return graph.edges.filter((edge) => edge.from === nodeId && (edge.when === condition || edge.when === `predicate:${condition}`))
}
