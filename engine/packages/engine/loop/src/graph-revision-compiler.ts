import {
  GraphRevisionSchema,
  type AgentGraph,
  type AgentGraphNode,
  type GraphDiagnostic,
  type GraphNodeV1,
  type GraphRevision
} from '@qiongqi/contracts'
import { canonicalDigest } from './execution-fingerprint.js'
import { validateAgentGraph } from './multi-agent-graph.js'

export type CompileAgentGraphInput = {
  revision: number
  publishedAt: string
}

export function compileAgentGraph(graphInput: AgentGraph, input: CompileAgentGraphInput): GraphRevision {
  const graph = validateAgentGraph(structuredClone(graphInput))
  const diagnostics: GraphDiagnostic[] = []
  const nodes = graph.nodes.map((node) => compileNode(node, diagnostics))
  const edges = graph.edges.map((edge) => ({
    edgeId: `edge_${canonicalDigest({
      kind: 'graph_edge_v1',
      graphId: graph.graphId,
      from: edge.from,
      to: edge.to,
      condition: edge.condition
    }).slice(0, 24)}`,
    from: edge.from,
    to: edge.to,
    condition: edge.condition
  }))
  const definition = {
    schemaVersion: 1 as const,
    graphId: graph.graphId,
    revision: input.revision,
    startNodeId: graph.startNodeId,
    nodes,
    edges
  }
  return GraphRevisionSchema.parse({
    ...definition,
    graphDigest: canonicalDigest({ kind: 'graph_revision_v1', ...definition }),
    publishedAt: input.publishedAt,
    diagnostics
  })
}

function compileNode(node: AgentGraphNode, diagnostics: GraphDiagnostic[]): GraphNodeV1 {
  if (node.kind !== 'agent') return structuredClone(node)
  const { model, ...rest } = node
  if (!model) return rest
  diagnostics.push({
    code: 'agent_node_model_deprecated',
    nodeId: node.id,
    message: 'AgentNode.model is deprecated; use modelPolicyRef'
  })
  return {
    ...rest,
    modelPolicyRef: { policyId: model, revision: 1 }
  }
}
