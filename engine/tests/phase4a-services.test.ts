import { describe, expect, it } from 'vitest'
import {
  TurnRuntimeDecisionService,
  TurnExecutionProjectionService,
  KernelV3ExecutionAdapter,
  EventedV2ExecutionAdapter,
  ExecutionRevisionNotifier,
  sanitizeTurnExecution,
  sanitizeUserFacingError,
  stableJson
} from '@qiongqi/services'
import type { RuntimeCapabilitySnapshot, RuntimeDecision } from '@qiongqi/contracts'

function snapshot(overrides: Partial<RuntimeCapabilitySnapshot> = {}): RuntimeCapabilitySnapshot {
  return {
    revision: 'cap_1',
    subagents: { enabled: false },
    agentGraph: { enabled: true, maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000, specialistRegistry: ['backend', 'frontend'] },
    ...overrides
  }
}

describe('Phase 4a: services 包移植验证', () => {
  describe('TurnRuntimeDecisionService', () => {
    it('team 偏好 + preflight 通过 → effectiveMode evented_v2', async () => {
      const threads: any[] = [{
        id: 'th_1', workspace: '/tmp', model: 'm', mode: 'agent',
        turns: [{ id: 'turn_1', threadId: 'th_1', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z', orchestrationPreference: 'team' }]
      }]
      const svc = new TurnRuntimeDecisionService({
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
      const decision = await svc.decide({ threadId: 'th_1', turnId: 'turn_1', request: { orchestrationPreference: 'team' } })
      expect(decision.effectiveMode).toBe('evented_v2')
      expect(decision.preference).toBe('team')
      expect(decision.source).toBe('turn')
    })

    it('team 偏好 + agentGraph 禁用 → fallback kernel_v3', async () => {
      const threads: any[] = [{
        id: 'th_2', workspace: '/tmp', model: 'm', mode: 'agent',
        turns: [{ id: 'turn_2', threadId: 'th_2', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z', orchestrationPreference: 'team' }]
      }]
      const svc = new TurnRuntimeDecisionService({
        threadStore: {
          get: async (id) => threads.find((t) => t.id === id),
          upsert: async (t) => { const i = threads.findIndex((x) => x.id === t.id); if (i >= 0) threads[i] = t }
        } as any,
        defaultPreference: 'standard',
        rolloutStage: 'default',
        capabilities: async () => snapshot({ agentGraph: { enabled: false, maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000, specialistRegistry: [] } }),
        preflight: async () => ({ available: true }),
        nowIso: () => '2026-07-25T00:00:00Z'
      })
      const decision = await svc.decide({ threadId: 'th_2', turnId: 'turn_2', request: { orchestrationPreference: 'team' } })
      expect(decision.effectiveMode).toBe('kernel_v3')
      expect(decision.fallbackReasonCode).toBe('agent_graph_disabled')
    })

    it('standard 偏好（默认）→ effectiveMode kernel_v3', async () => {
      const threads: any[] = [{
        id: 'th_3', workspace: '/tmp', model: 'm', mode: 'agent',
        turns: [{ id: 'turn_3', threadId: 'th_3', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z' }]
      }]
      const svc = new TurnRuntimeDecisionService({
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
      const decision = await svc.decide({ threadId: 'th_3', turnId: 'turn_3', request: {} })
      expect(decision.effectiveMode).toBe('kernel_v3')
      expect(decision.source).toBe('default')
    })

    it('幂等：已决策的 turn 返回既有 decision', async () => {
      const existing: RuntimeDecision = {
        preferredMode: 'kernel_v3', effectiveMode: 'kernel_v3', preference: 'standard',
        source: 'default', reasonCode: 'standard_execution', reason: 'cached',
        rolloutStage: 'default', decidedAt: '2026-07-25T00:00:00Z'
      }
      const threads: any[] = [{
        id: 'th_4', workspace: '/tmp', model: 'm', mode: 'agent',
        turns: [{ id: 'turn_4', threadId: 'th_4', status: 'running', prompt: 'hi', createdAt: '2026-07-25T00:00:00Z', runtimeDecision: existing }]
      }]
      let upsertCount = 0
      const svc = new TurnRuntimeDecisionService({
        threadStore: {
          get: async (id) => threads.find((t) => t.id === id),
          upsert: async () => { upsertCount++ }
        } as any,
        defaultPreference: 'standard',
        rolloutStage: 'default',
        capabilities: async () => snapshot(),
        preflight: async () => ({ available: true }),
        nowIso: () => '2026-07-25T00:00:00Z'
      })
      const decision = await svc.decide({ threadId: 'th_4', turnId: 'turn_4', request: { orchestrationPreference: 'team' } })
      expect(decision).toEqual(existing) // 返回既有，不重新决策
      expect(upsertCount).toBe(0) // 没有再次持久化
    })
  })

  describe('sanitizer', () => {
    it('sanitizeUserFacingError 白名单 code 透传', () => {
      const e = sanitizeUserFacingError({ code: 'tool_failed', message: '工具失败' })
      expect(e.code).toBe('tool_failed')
      expect(e.message).toBe('工具失败')
    })

    it('sanitizeUserFacingError 非白名单 code 降级为 execution_failed', () => {
      const e = sanitizeUserFacingError({ code: 'internal_leak', message: 'apiKey=sk-xxx' })
      expect(e.code).toBe('execution_failed')
      expect(e.message).toBe('执行失败') // 非白名单不透传 message
    })

    it('sanitizeTurnExecution 透传 unavailable 视图', () => {
      const view = sanitizeTurnExecution({ version: 1, available: false, revision: 'legacy:0', reason: 'legacy_turn' })
      expect(view.available).toBe(false)
    })

    it('stableJson 生成稳定序列化（键排序）', () => {
      expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }))
    })
  })

  describe('adapters + projection 可构造', () => {
    it('KernelV3ExecutionAdapter / EventedV2ExecutionAdapter / ProjectionService 可构造', () => {
      const transcripts = { load: async () => undefined } as any
      const sanitizerOptions = { maxInlineToolResultBytes: 65536, redactPatterns: [] }
      const kernel = new KernelV3ExecutionAdapter({ transcripts, sanitizerOptions })
      const eventedV2 = new EventedV2ExecutionAdapter({ transcripts, sanitizerOptions })
      const projection = new TurnExecutionProjectionService({
        threads: { get: async () => undefined } as any,
        runs: { load: async () => undefined } as any,
        delegation: { list: async () => [] } as any,
        kernel,
        eventedV2
      })
      expect(kernel).toBeInstanceOf(KernelV3ExecutionAdapter)
      expect(eventedV2).toBeInstanceOf(EventedV2ExecutionAdapter)
      expect(projection).toBeInstanceOf(TurnExecutionProjectionService)
    })

    it('ProjectionService.get 对无 turn 返回 TurnExecutionNotFound', async () => {
      const transcripts = { load: async () => undefined } as any
      const sanitizerOptions = { maxInlineToolResultBytes: 65536, redactPatterns: [] }
      const projection = new TurnExecutionProjectionService({
        threads: { get: async () => ({ id: 'th', turns: [] } as any) } as any,
        runs: { load: async () => undefined } as any,
        delegation: { list: async () => [] } as any,
        kernel: new KernelV3ExecutionAdapter({ transcripts, sanitizerOptions }),
        eventedV2: new EventedV2ExecutionAdapter({ transcripts, sanitizerOptions })
      })
      await expect(projection.get({ threadId: 'th', turnId: 'missing' })).rejects.toThrow(/not found/)
    })
  })

  describe('ExecutionRevisionNotifier', () => {
    it('notify 对 sha256 修订调用 record，重复则跳过', async () => {
      const recorded: string[] = []
      const projection = {
        get: async () => ({ available: true, revision: 'sha256:abc' } as any)
      } as any
      const notifier = new ExecutionRevisionNotifier({ projection, record: async (e) => { recorded.push(e.revision) } })
      await notifier.notify({ threadId: 'th', turnId: 'turn' })
      await notifier.notify({ threadId: 'th', turnId: 'turn' }) // 相同 revision，跳过
      expect(recorded).toEqual(['sha256:abc'])
    })
  })
})
