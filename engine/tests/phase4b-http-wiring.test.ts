import { describe, expect, it } from 'vitest'
import { createPersistedDecisionTurnRouter } from '@qiongqi/http'
import { TurnRuntimeDecisionService } from '@qiongqi/services'
import type { RuntimeCapabilitySnapshot } from '@qiongqi/contracts'

function snapshot(): RuntimeCapabilitySnapshot {
  return {
    revision: 'cap_1',
    subagents: { enabled: false },
    agentGraph: { enabled: true, maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000, specialistRegistry: ['backend'] }
  }
}

/**
 * Phase 4b: 验证 createPersistedDecisionTurnRouter 持久化决策 + 派发逻辑。
 */
describe('Phase 4b: createPersistedDecisionTurnRouter', () => {
  it('standard 偏好 → 派发到 kernel_v3 runner', async () => {
    const threads: any[] = [{
      id: 'th_1', workspace: '/tmp', model: 'm', mode: 'agent',
      turns: [{ id: 'turn_1', threadId: 'th_1', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z' }]
    }]
    let kernelCalled = false
    let eventedCalled = false
    const decisionService = new TurnRuntimeDecisionService({
      threadStore: {
        get: async (id) => threads.find((t) => t.id === id),
        upsert: async (t) => { const i = threads.findIndex((x) => x.id === t.id); if (i >= 0) threads[i] = t }
      } as any,
      defaultPreference: 'standard',
      rolloutStage: 'default',
      capabilities: async () => snapshot(),
      preflight: async () => ({ available: true }),
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const router = createPersistedDecisionTurnRouter({
      turns: { getTurn: async (threadId, turnId) => threads[0]!.turns.find((t) => t.id === turnId) ?? null } as any,
      decisions: decisionService,
      loops: {
        kernelV3: { runTurn: async () => { kernelCalled = true; return 'completed' } },
        eventedV2: { runTurn: async () => { eventedCalled = true; return 'completed' } }
      }
    })
    const status = await router.runTurn('th_1', 'turn_1')
    expect(status).toBe('completed')
    expect(kernelCalled).toBe(true)
    expect(eventedCalled).toBe(false)
    // 决策被持久化到 turn
    const turn = threads[0]!.turns[0]
    expect(turn.runtimeDecision?.effectiveMode).toBe('kernel_v3')
  })

  it('team 偏好 + agentGraph 禁用 → fallback 派发到 kernel_v3', async () => {
    const threads: any[] = [{
      id: 'th_2', workspace: '/tmp', model: 'm', mode: 'agent',
      turns: [{ id: 'turn_2', threadId: 'th_2', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z', orchestrationPreference: 'team' }]
    }]
    let kernelCalled = false
    const decisionService = new TurnRuntimeDecisionService({
      threadStore: {
        get: async (id) => threads.find((t) => t.id === id),
        upsert: async (t) => { const i = threads.findIndex((x) => x.id === t.id); if (i >= 0) threads[i] = t }
      } as any,
      defaultPreference: 'standard',
      rolloutStage: 'default',
      capabilities: async () => ({ ...snapshot(), agentGraph: { enabled: false, maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000, specialistRegistry: [] } }),
      preflight: async () => ({ available: true }),
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const router = createPersistedDecisionTurnRouter({
      turns: { getTurn: async (threadId, turnId) => threads[0]!.turns.find((t) => t.id === turnId) ?? null } as any,
      decisions: decisionService,
      loops: {
        kernelV3: { runTurn: async () => { kernelCalled = true; return 'completed' } }
      }
    })
    await router.runTurn('th_2', 'turn_2')
    expect(kernelCalled).toBe(true) // fallback 到 kernel_v3
    const turn = threads[0]!.turns[0]
    expect(turn.runtimeDecision?.effectiveMode).toBe('kernel_v3')
    expect(turn.runtimeDecision?.fallbackReasonCode).toBe('agent_graph_disabled')
  })

  it('onResolved 回调收到解析的模式', async () => {
    const threads: any[] = [{
      id: 'th_3', workspace: '/tmp', model: 'm', mode: 'agent',
      turns: [{ id: 'turn_3', threadId: 'th_3', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z' }]
    }]
    const decisionService = new TurnRuntimeDecisionService({
      threadStore: {
        get: async (id) => threads.find((t) => t.id === id),
        upsert: async (t) => { const i = threads.findIndex((x) => x.id === t.id); if (i >= 0) threads[i] = t }
      } as any,
      defaultPreference: 'standard',
      rolloutStage: 'default',
      capabilities: async () => snapshot(),
      preflight: async () => ({ available: true }),
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    let resolvedMode: string | undefined
    const router = createPersistedDecisionTurnRouter({
      turns: { getTurn: async (threadId, turnId) => threads[0]!.turns.find((t) => t.id === turnId) ?? null } as any,
      decisions: decisionService,
      loops: { kernelV3: { runTurn: async () => 'completed' } },
      onResolved: async ({ mode }) => { resolvedMode = mode }
    })
    await router.runTurn('th_3', 'turn_3')
    expect(resolvedMode).toBe('kernel_v3')
  })
})
