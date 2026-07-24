import { describe, expect, it } from 'vitest'
import {
  AgentGraphCapabilityConfig,
  RuntimeCapabilitySnapshotSchema,
  SubagentsCapabilityConfig,
  ManagerRouteDecisionSchema,
  AgentGraphSnapshotSchema
} from '@qiongqi/contracts'

describe('capabilities: agent graph + runtime snapshot', () => {
  it('AgentGraphCapabilityConfig parses a valid enabled config', () => {
    const parsed = AgentGraphCapabilityConfig.parse({
      enabled: true
    })
    expect(parsed.enabled).toBe(true)
    expect(parsed.maxParallelNodes).toBe(4)
    expect(parsed.maxActivatedSpecialists).toBe(10)
  })

  it('RuntimeCapabilitySnapshotSchema parses with subagents + agentGraph', () => {
    const parsed = RuntimeCapabilitySnapshotSchema.parse({
      revision: 'cap_abc123',
      subagents: { enabled: true, maxParallel: 4, maxChildRuns: 16 },
      agentGraph: {
        enabled: true,
        maxParallelNodes: 4,
        maxActivatedSpecialists: 10,
        maxRetriesPerNode: 2,
        maxDurationMs: 600000
      }
    })
    expect(parsed.revision).toBe('cap_abc123')
    expect(parsed.agentGraph.enabled).toBe(true)
  })

  it('SubagentsCapabilityConfig still parses (unchanged)', () => {
    const parsed = SubagentsCapabilityConfig.parse({
      enabled: true,
      maxParallel: 2,
      maxChildRuns: 8
    })
    expect(parsed.enabled).toBe(true)
  })
})

describe('multi-agent-runtime: route decision + graph snapshot', () => {
  it('ManagerRouteDecisionSchema parses empty specialists (manager 自答)', () => {
    const parsed = ManagerRouteDecisionSchema.parse({
      summary: '简单任务，manager 直接处理',
      specialists: []
    })
    expect(parsed.specialists).toHaveLength(0)
  })

  it('ManagerRouteDecisionSchema parses routed specialists with dependencies', () => {
    const parsed = ManagerRouteDecisionSchema.parse({
      summary: '全栈功能开发',
      specialists: [
        { specialistId: 'backend', task: '实现 API', dependsOn: [], required: true },
        { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
      ]
    })
    expect(parsed.specialists).toHaveLength(2)
    expect(parsed.specialists[1].dependsOn).toEqual(['backend'])
  })

  it('AgentGraphSnapshotSchema parses a valid team graph', () => {
    const parsed = AgentGraphSnapshotSchema.parse({
      version: 1,
      publicKey: 'graph_abc',
      templateId: 'manager-specialists-v1',
      registryRevision: 'reg_v1',
      startNodeId: 'manager_planning',
      nodes: [
        { id: 'manager_planning', kind: 'agent', agentId: 'manager', capabilities: ['routing'] },
        { id: 'join', kind: 'join', requiredBranchIds: [] },
        { id: 'manager_synthesis', kind: 'agent', agentId: 'manager', capabilities: ['synthesis'] }
      ],
      edges: [
        { from: 'manager_planning', to: 'join', condition: 'planned' },
        { from: 'join', to: 'manager_synthesis', condition: 'joined' }
      ],
      budgets: {
        maxParallelNodes: 4,
        maxActivatedSpecialists: 10,
        maxRetriesPerNode: 2,
        maxDurationMs: 600000
      }
    })
    expect(parsed.templateId).toBe('manager-specialists-v1')
    expect(parsed.nodes).toHaveLength(3)
  })
})
