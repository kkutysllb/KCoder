import { describe, expect, it } from 'vitest'
import { AgentNodeExecutor, type ManagerRouteController } from '@qiongqi/loop'
import { createDefaultSpecialistRegistry } from '@qiongqi/loop'
import type { AgentTranscript, AgentRun, ManagerRouteDecision, UsageSnapshot } from '@qiongqi/contracts'
import type { AgentTranscriptStore } from '@qiongqi/ports'

/** 最小内存 AgentTranscriptStore（测试用，实现 load/save/update）。 */
function mockTranscriptStore(): AgentTranscriptStore & { store: Map<string, AgentTranscript> } {
  const store = new Map<string, AgentTranscript>()
  return {
    store,
    load: async (ref) => store.get(ref),
    save: async (t) => { store.set(t.transcriptRef, t) },
    update: async (ref, mutate) => {
      const current = store.get(ref)
      if (!current) throw new Error(`transcript not found: ${ref}`)
      const next = mutate(current)
      store.set(ref, next)
      return next
    }
  }
}

function makeAgentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    agentRunId: 'run_1',
    agentId: 'backend',
    nodeId: 'specialist:backend',
    publicKey: 'pub_1',
    sequence: 1,
    role: 'specialist',
    phase: 'execution',
    transcriptRef: 'transcript_1',
    attempt: 1,
    status: 'running',
    startedAt: '2026-07-25T00:00:00Z',
    updatedAt: '2026-07-25T00:00:00Z',
    ...overrides
  }
}

describe('Phase 3c: AgentNodeExecutor', () => {
  it('execute 执行 specialist 节点，写入 transcript 并返回 summary', async () => {
    const transcripts = mockTranscriptStore()
    const events: unknown[] = []
    const executor = new AgentNodeExecutor({
      transcripts,
      executeNode: async (input) => ({
        summary: 'API 实现完成',
        userVisibleMessages: [
          { role: 'assistant', text: '我实现了登录接口', sourceRef: 'msg_1' }
        ]
      }),
      ids: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`,
      nowIso: () => '2026-07-25T00:00:00Z',
      recordAgentMessageEvent: async (e) => { events.push(e) }
    })
    const registry = createDefaultSpecialistRegistry({ revision: 'reg_v1', enabledIds: ['backend'] })
    const result = await executor.execute({
      threadId: 'th_1',
      turnId: 'turn_1',
      runId: 'mar_1',
      graphPublicKey: 'graph_1',
      agentRun: makeAgentRun(),
      specialist: registry.get('backend'),
      dependencyResults: new Map(),
      graphBudget: { beforeEffect: async () => {}, recordUsage: async () => {} },
      signal: new AbortController().signal
    })
    expect(result.summary).toBe('API 实现完成')
    expect(result.transcriptRef).toBe('transcript_1')
    expect(result.userVisibleMessages[0]?.text).toBe('我实现了登录接口')
    // transcript 写入了消息
    const transcript = transcripts.store.get('transcript_1')!
    expect(transcript.messages).toHaveLength(1)
    expect(transcript.messages[0]?.content).toBe('我实现了登录接口')
    // 触发了 agent_message_completed 事件
    expect(events).toHaveLength(1)
  })

  it('planning 阶段无 routeTool 时抛错', async () => {
    const transcripts = mockTranscriptStore()
    const executor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: '', userVisibleMessages: [] }),
      ids: (p) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    await expect(
      executor.execute({
        threadId: 'th_1',
        turnId: 'turn_1',
        runId: 'mar_1',
        graphPublicKey: 'graph_1',
        agentRun: makeAgentRun({ phase: 'planning', nodeId: 'manager_planning', agentId: 'manager', role: 'manager' }),
        dependencyResults: new Map(),
        graphBudget: { beforeEffect: async () => {}, recordUsage: async () => {} },
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/Manager Planning requires route_specialists/)
  })

  it('planning 阶段执行后返回 routeDecision', async () => {
    const transcripts = mockTranscriptStore()
    const decision: ManagerRouteDecision = {
      summary: '路由到 backend',
      specialists: [{ specialistId: 'backend', task: '实现 API', dependsOn: [], required: true }]
    }
    const routeTool: ManagerRouteController = {
      toolName: 'route_specialists',
      submit: (d) => d,
      getDecision: () => decision,
      requireDecision: () => decision
    }
    const executor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: '规划完成', userVisibleMessages: [] }),
      ids: (p) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const result = await executor.execute({
      threadId: 'th_1',
      turnId: 'turn_1',
      runId: 'mar_1',
      graphPublicKey: 'graph_1',
      agentRun: makeAgentRun({ phase: 'planning', nodeId: 'manager_planning', agentId: 'manager', role: 'manager' }),
      dependencyResults: new Map(),
      routeTool,
      graphBudget: { beforeEffect: async () => {}, recordUsage: async () => {} },
      signal: new AbortController().signal
    })
    expect(result.routeDecision?.specialists).toHaveLength(1)
    expect(result.routeDecision?.specialists[0]?.specialistId).toBe('backend')
  })

  it('记录 usage 到 graphBudget', async () => {
    const transcripts = mockTranscriptStore()
    const usage: UsageSnapshot = { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    let recorded: UsageSnapshot | undefined
    const executor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: 'done', usage, userVisibleMessages: [] }),
      ids: (p) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const registry = createDefaultSpecialistRegistry({ revision: 'reg_v1', enabledIds: ['backend'] })
    await executor.execute({
      threadId: 'th_1',
      turnId: 'turn_1',
      runId: 'mar_1',
      graphPublicKey: 'graph_1',
      agentRun: makeAgentRun(),
      specialist: registry.get('backend'),
      dependencyResults: new Map(),
      graphBudget: { beforeEffect: async () => {}, recordUsage: async (u) => { recorded = u } },
      signal: new AbortController().signal
    })
    expect(recorded).toEqual(usage)
  })
})
