import type { GraphRevision, WorkGraphEventRecord } from '@qiongqi/contracts'

export type WorkGraphProjection = {
  intended: { nodeIds: string[]; edgeIds: string[] }
  executed: {
    nodes: Record<string, { attempts: number; completed: number; failed: number }>
    edges: Record<string, { selected: number; traversed: number; rejected: number }>
  }
}

export function projectWorkGraph(
  revision: GraphRevision,
  events: readonly WorkGraphEventRecord[]
): WorkGraphProjection {
  const nodes: WorkGraphProjection['executed']['nodes'] = {}
  const edges: WorkGraphProjection['executed']['edges'] = {}
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    if (event.nodeId && ['node_started', 'node_completed', 'node_failed'].includes(event.kind)) {
      const current = nodes[event.nodeId] ?? { attempts: 0, completed: 0, failed: 0 }
      if (event.kind === 'node_started') current.attempts += 1
      if (event.kind === 'node_completed') current.completed += 1
      if (event.kind === 'node_failed') current.failed += 1
      nodes[event.nodeId] = current
    }
    if (event.edgeId && ['edge_selected', 'edge_traversed', 'edge_rejected'].includes(event.kind)) {
      const current = edges[event.edgeId] ?? { selected: 0, traversed: 0, rejected: 0 }
      if (event.kind === 'edge_selected') current.selected += 1
      if (event.kind === 'edge_traversed') current.traversed += 1
      if (event.kind === 'edge_rejected') current.rejected += 1
      edges[event.edgeId] = current
    }
  }
  return {
    intended: {
      nodeIds: revision.nodes.map((node) => node.id),
      edgeIds: revision.edges.map((edge) => edge.edgeId)
    },
    executed: { nodes, edges }
  }
}
