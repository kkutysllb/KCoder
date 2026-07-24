import {
  AgentGraphSnapshotSchema,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentGraphSnapshot,
  type ManagerRouteDecision
} from '@qiongqi/contracts'
import type { SpecialistRegistryContract } from './specialist-registry.js'

/**
 * Team 图模板标识。manager-specialists-v1 = manager_planning → specialists → join → manager_synthesis。
 * 来源：KWorks evented-v2-graph-template.ts（TEAM_GRAPH_TEMPLATE_ID）。
 */
export const TEAM_GRAPH_TEMPLATE_ID = 'manager-specialists-v1'

/**
 * 把 manager 路由决策实例化为不可变的 AgentGraphSnapshot DAG。
 * - 空 specialists：manager_planning 直连 join（manager 自答路径）
 * - 有 specialists：planning 扇出到无依赖的 specialist，有依赖的从依赖节点接入，全部连 join，join 连 synthesis
 * - join 的 requiredBranchIds 只含 required 的 specialist
 * 来源：KWorks materializeTeamGraph（忠实移植）。
 */
export function materializeTeamGraph(input: {
  decision: ManagerRouteDecision
  registry: SpecialistRegistryContract
  graphPublicKey: string
  budgets: AgentGraphSnapshot['budgets']
}): AgentGraphSnapshot {
  const decision = input.registry.validateRoute(input.decision, {
    maxActivatedSpecialists: input.budgets.maxActivatedSpecialists
  })
  const specialistNodes: AgentGraphNode[] = decision.specialists.map((specialist) => {
    const definition = input.registry.get(specialist.specialistId)
    if (!definition) throw new Error(`unknown specialist: ${specialist.specialistId}`)
    return {
      id: specialistNodeId(specialist.specialistId),
      kind: 'agent',
      agentId: specialist.specialistId,
      label: definition.name,
      capabilities: [...definition.capabilities]
    }
  })
  const nodes: AgentGraphNode[] = [
    {
      id: 'manager_planning',
      kind: 'agent',
      agentId: 'manager',
      label: 'Manager Planning',
      capabilities: ['routing']
    },
    ...specialistNodes,
    {
      id: 'join',
      kind: 'join',
      requiredBranchIds: decision.specialists
        .filter((specialist) => specialist.required)
        .map((specialist) => specialistNodeId(specialist.specialistId))
    },
    {
      id: 'manager_synthesis',
      kind: 'agent',
      agentId: 'manager',
      label: 'Manager Synthesis',
      capabilities: ['synthesis']
    }
  ]
  const edges: AgentGraphEdge[] = []

  if (decision.specialists.length === 0) {
    edges.push({ from: 'manager_planning', to: 'join', condition: 'planned' })
  } else {
    for (const specialist of decision.specialists) {
      const nodeId = specialistNodeId(specialist.specialistId)
      if (specialist.dependsOn.length === 0) {
        edges.push({
          from: 'manager_planning',
          to: nodeId,
          condition: `activated:${specialist.specialistId}`
        })
      } else {
        for (const dependency of specialist.dependsOn) {
          edges.push({
            from: specialistNodeId(dependency),
            to: nodeId,
            condition: `dependency:${specialist.specialistId}`
          })
        }
      }
      edges.push({ from: nodeId, to: 'join', condition: 'completed' })
    }
  }
  edges.push({ from: 'join', to: 'manager_synthesis', condition: 'joined' })

  return AgentGraphSnapshotSchema.parse({
    version: 1,
    publicKey: input.graphPublicKey,
    templateId: TEAM_GRAPH_TEMPLATE_ID,
    registryRevision: input.registry.revision,
    startNodeId: 'manager_planning',
    nodes,
    edges,
    budgets: input.budgets
  })
}

function specialistNodeId(specialistId: string): string {
  return `specialist:${specialistId}`
}
