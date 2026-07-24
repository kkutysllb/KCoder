import { describe, expect, it } from 'vitest'
import {
  AgentGraphCapabilityConfig,
  RuntimeCapabilitySnapshotSchema,
  SubagentsCapabilityConfig,
  ManagerRouteDecisionSchema,
  AgentGraphSnapshotSchema,
  AgentRunSchema,
  MultiAgentRunSchema,
  OrchestrationPreferenceSchema,
  CollaborationPolicySchema,
  RuntimeDecisionSchema,
  TurnSchema,
  StartTurnRequest
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

describe('multi-agent-runtime: extended AgentRun + MultiAgentRun', () => {
  it('AgentRunSchema accepts manager planning run with new fields', () => {
    const parsed = AgentRunSchema.parse({
      agentRunId: 'run_1',
      agentId: 'manager',
      nodeId: 'manager_planning',
      publicKey: 'pub_1',
      sequence: 1,
      role: 'manager',
      phase: 'planning',
      transcriptRef: 'transcript_1',
      attempt: 1,
      required: true,
      status: 'running',
      startedAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.role).toBe('manager')
    expect(parsed.phase).toBe('planning')
    expect(parsed.attempt).toBe(1)
  })

  it('AgentRunSchema still accepts minimal run (backward compat)', () => {
    const parsed = AgentRunSchema.parse({
      agentRunId: 'run_2',
      agentId: 'specialist_backend',
      nodeId: 'specialist:backend',
      status: 'queued',
      startedAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.attempt).toBe(1) // default
    expect(parsed.role).toBeUndefined()
  })

  it('MultiAgentRunSchema accepts run with graphSnapshot and routeDecision', () => {
    const parsed = MultiAgentRunSchema.parse({
      version: 1,
      runId: 'mar_1',
      threadId: 'th_1',
      turnId: 'turn_1',
      workspaceKey: 'ws_1',
      status: 'running',
      graphId: 'graph_1',
      activeNodeId: 'manager_planning',
      activeNodeIds: ['manager_planning'],
      runnableNodeIds: ['manager_planning'],
      graphSnapshot: {
        version: 1,
        publicKey: 'graph_1',
        templateId: 'manager-specialists-v1',
        registryRevision: 'reg_v1',
        startNodeId: 'manager_planning',
        nodes: [
          { id: 'manager_planning', kind: 'agent', agentId: 'manager', capabilities: ['routing'] }
        ],
        edges: [],
        budgets: {
          maxParallelNodes: 4,
          maxActivatedSpecialists: 10,
          maxRetriesPerNode: 2,
          maxDurationMs: 600000
        }
      },
      routeDecision: { summary: '测试', specialists: [] },
      nextPublicSequence: 2,
      warnings: [],
      budgets: {},
      createdAt: '2026-07-24T00:00:00Z',
      updatedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.graphSnapshot?.templateId).toBe('manager-specialists-v1')
    expect(parsed.routeDecision?.specialists).toHaveLength(0)
    expect(parsed.activeNodeIds).toEqual(['manager_planning'])
  })
})

describe('turns: orchestration types + extended Turn/StartTurnRequest', () => {
  it('OrchestrationPreference accepts standard and team', () => {
    expect(OrchestrationPreferenceSchema.parse('standard')).toBe('standard')
    expect(OrchestrationPreferenceSchema.parse('team')).toBe('team')
  })

  it('CollaborationPolicy accepts single and auto', () => {
    expect(CollaborationPolicySchema.parse('single')).toBe('single')
    expect(CollaborationPolicySchema.parse('auto')).toBe('auto')
  })

  it('RuntimeDecisionSchema parses a kernel_v3 decision', () => {
    const parsed = RuntimeDecisionSchema.parse({
      preferredMode: 'kernel_v3',
      effectiveMode: 'kernel_v3',
      preference: 'standard',
      source: 'default',
      reasonCode: 'standard_execution',
      reason: '默认单 agent 模式',
      rolloutStage: 'default',
      decidedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.effectiveMode).toBe('kernel_v3')
  })

  it('RuntimeDecisionSchema parses an evented_v2 decision with fallback', () => {
    const parsed = RuntimeDecisionSchema.parse({
      preferredMode: 'evented_v2',
      effectiveMode: 'evented_v2',
      preference: 'team',
      source: 'turn',
      reasonCode: 'explicit_team',
      reason: '用户显式选择团队模式',
      rolloutStage: 'default',
      decidedAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.effectiveMode).toBe('evented_v2')
  })

  it('TurnSchema accepts turn with orchestration fields', () => {
    const parsed = TurnSchema.parse({
      id: 'turn_1',
      threadId: 'th_1',
      status: 'running',
      prompt: '实现一个登录接口',
      orchestrationPreference: 'team',
      runtimeDecision: {
        preferredMode: 'evented_v2',
        effectiveMode: 'evented_v2',
        preference: 'team',
        source: 'turn',
        reasonCode: 'explicit_team',
        reason: '用户选择团队',
        rolloutStage: 'default',
        decidedAt: '2026-07-24T00:00:00Z'
      },
      nextExecutionSequence: 3,
      eventedV2RunId: 'mar_1',
      createdAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.orchestrationPreference).toBe('team')
    expect(parsed.eventedV2RunId).toBe('mar_1')
  })

  it('TurnSchema still accepts minimal turn (backward compat)', () => {
    const parsed = TurnSchema.parse({
      id: 'turn_2',
      threadId: 'th_1',
      status: 'queued',
      prompt: '你好',
      createdAt: '2026-07-24T00:00:00Z'
    })
    expect(parsed.orchestrationPreference).toBeUndefined()
    expect(parsed.runtimeDecision).toBeUndefined()
  })

  it('StartTurnRequest accepts orchestrationPreference team', () => {
    const parsed = StartTurnRequest.parse({
      prompt: '实现全栈功能',
      orchestrationPreference: 'team'
    })
    expect(parsed.orchestrationPreference).toBe('team')
  })

  it('StartTurnRequest rejects conflicting orchestrationPreference + collaborationPolicy', () => {
    const result = StartTurnRequest.safeParse({
      prompt: 'test',
      orchestrationPreference: 'standard',
      collaborationPolicy: 'auto' // auto → team, conflicts with standard
    })
    expect(result.success).toBe(false)
  })
})
