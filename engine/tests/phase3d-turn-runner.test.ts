import { describe, expect, it } from 'vitest'
import {
  EventedV2TurnRunner,
  AgentNodeExecutor,
  createDefaultSpecialistRegistry,
  EventedV2MultiAgentRuntime,
  type ManagerRouteController
} from '@qiongqi/loop'
import { FileMultiAgentRunStore, FileMailboxStore } from '@qiongqi/adapter-storage'
import { RandomIdGenerator } from '@qiongqi/ports'
import type { AgentGraphSnapshot, ManagerRouteDecision, MultiAgentRun, Turn } from '@qiongqi/contracts'
import type { MultiAgentRunStore, ThreadStore, AgentTranscriptStore } from '@qiongqi/ports'
import type { TurnService } from '@qiongqi/services'

/**
 * Phase 3d: EventedV2TurnRunner 构造与基本契约验证。
 * 完整端到端（含 TurnService sessionStore）的集成测试留待 Phase 4 路由器联调时补；
 * 此处验证 runner 可构造、类型契约正确、runTurn 对非 evented_v2 turn 正确拒绝。
 */

/** 最小 mock TurnService（只实现 turn runner 依赖的 5 个方法的子集）。 */
function mockTurnService(turns: Map<string, Turn>): Pick<TurnService, 'getTurn' | 'getAbortController' | 'linkEventedV2Run' | 'applyItemOnce' | 'finishTurn'> {
  return {
    getTurn: async (threadId, turnId) => turns.get(`${threadId}/${turnId}`) ?? null,
    getAbortController: () => new AbortController().signal,
    linkEventedV2Run: async (threadId, turnId, runId) => {
      const t = turns.get(`${threadId}/${turnId}`)
      if (t) turns.set(`${threadId}/${turnId}`, { ...t, eventedV2RunId: runId })
      return runId
    },
    applyItemOnce: async () => true,
    finishTurn: async () => ({ status: 'completed' })
  }
}

function mockThreadStore(workspace: string): ThreadStore {
  return {
    get: async () => ({ id: 'th_1', workspace, model: 'm', mode: 'agent', turns: [] } as any),
    upsert: async () => {}
  } as ThreadStore
}

describe('Phase 3d: EventedV2TurnRunner', () => {
  it('可构造，依赖注入正确', async () => {
    const dir = `/tmp/kcoder-phase3d-construct-${Date.now()}`
    const runs = new FileMultiAgentRunStore(dir) as unknown as MultiAgentRunStore
    const mailbox = new FileMailboxStore(dir)
    const registry = createDefaultSpecialistRegistry({ revision: 'reg_v1', enabledIds: ['backend'] })
    const transcripts: AgentTranscriptStore = { load: async () => undefined, save: async () => {}, update: async () => { throw new Error('noop') } }
    const nodeExecutor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: '', userVisibleMessages: [] }),
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const runtimeFactory = (snapshot: AgentGraphSnapshot) => new EventedV2MultiAgentRuntime({
      runs, mailbox, graphSnapshot: snapshot,
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const runner = new EventedV2TurnRunner({
      threads: mockThreadStore(dir),
      turns: mockTurnService(new Map()),
      runs,
      runtimeFactory,
      registry,
      nodeExecutor,
      routeToolFactory: () => ({ toolName: 'route_specialists', submit: (d) => d, getDecision: () => undefined, requireDecision: () => { throw new Error('no decision') } }),
      ids: new RandomIdGenerator(),
      nowIso: () => '2026-07-25T00:00:00Z',
      graphBudgetFor: () => ({ beforeEffect: async () => {}, recordUsage: async () => {} })
    })
    expect(runner).toBeInstanceOf(EventedV2TurnRunner)
  })

  it('runTurn 对未分配 evented_v2 的 turn 抛错', async () => {
    const dir = `/tmp/kcoder-phase3d-reject-${Date.now()}`
    const runs = new FileMultiAgentRunStore(dir) as unknown as MultiAgentRunStore
    const mailbox = new FileMailboxStore(dir)
    const registry = createDefaultSpecialistRegistry({ revision: 'reg_v1', enabledIds: ['backend'] })
    const transcripts: AgentTranscriptStore = { load: async () => undefined, save: async () => {}, update: async () => { throw new Error('noop') } }
    const nodeExecutor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: '', userVisibleMessages: [] }),
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const runtimeFactory = (snapshot: AgentGraphSnapshot) => new EventedV2MultiAgentRuntime({
      runs, mailbox, graphSnapshot: snapshot,
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    // 一个 running 但 effectiveMode=kernel_v3 的 turn
    const turns = new Map<string, Turn>([
      ['th_1/turn_1', {
        id: 'turn_1', threadId: 'th_1', status: 'running', prompt: 'hi',
        createdAt: '2026-07-25T00:00:00Z',
        runtimeDecision: {
          preferredMode: 'kernel_v3', effectiveMode: 'kernel_v3', preference: 'standard',
          source: 'default', reasonCode: 'standard_execution', reason: 'test',
          rolloutStage: 'default', decidedAt: '2026-07-25T00:00:00Z'
        }
      } as Turn]
    ])
    const runner = new EventedV2TurnRunner({
      threads: mockThreadStore(dir),
      turns: mockTurnService(turns),
      runs,
      runtimeFactory,
      registry,
      nodeExecutor,
      routeToolFactory: () => ({ toolName: 'route_specialists', submit: (d) => d, getDecision: () => undefined, requireDecision: () => { throw new Error('no decision') } }),
      ids: new RandomIdGenerator(),
      nowIso: () => '2026-07-25T00:00:00Z',
      graphBudgetFor: () => ({ beforeEffect: async () => {}, recordUsage: async () => {} })
    })
    await expect(runner.runTurn('th_1', 'turn_1')).rejects.toThrow(/not assigned to evented_v2/)
  })

  it('runTurn 对缺失 runtimeCapabilitySnapshot 的 turn 抛错', async () => {
    const dir = `/tmp/kcoder-phase3d-nosnap-${Date.now()}`
    const runs = new FileMultiAgentRunStore(dir) as unknown as MultiAgentRunStore
    const mailbox = new FileMailboxStore(dir)
    const registry = createDefaultSpecialistRegistry({ revision: 'reg_v1', enabledIds: ['backend'] })
    const transcripts: AgentTranscriptStore = { load: async () => undefined, save: async () => {}, update: async () => { throw new Error('noop') } }
    const nodeExecutor = new AgentNodeExecutor({
      transcripts,
      executeNode: async () => ({ summary: '', userVisibleMessages: [] }),
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const runtimeFactory = (snapshot: AgentGraphSnapshot) => new EventedV2MultiAgentRuntime({
      runs, mailbox, graphSnapshot: snapshot,
      ids: (p: string) => `${p}_1`,
      nowIso: () => '2026-07-25T00:00:00Z'
    })
    const turns = new Map<string, Turn>([
      ['th_1/turn_1', {
        id: 'turn_1', threadId: 'th_1', status: 'running', prompt: 'hi',
        createdAt: '2026-07-25T00:00:00Z',
        runtimeDecision: {
          preferredMode: 'evented_v2', effectiveMode: 'evented_v2', preference: 'team',
          source: 'turn', reasonCode: 'explicit_team', reason: 'test',
          rolloutStage: 'default', decidedAt: '2026-07-25T00:00:00Z'
        }
        // 缺 runtimeCapabilitySnapshot
      } as Turn]
    ])
    const runner = new EventedV2TurnRunner({
      threads: mockThreadStore(dir),
      turns: mockTurnService(turns),
      runs,
      runtimeFactory,
      registry,
      nodeExecutor,
      routeToolFactory: () => ({ toolName: 'route_specialists', submit: (d) => d, getDecision: () => undefined, requireDecision: () => { throw new Error('no decision') } }),
      ids: new RandomIdGenerator(),
      nowIso: () => '2026-07-25T00:00:00Z',
      graphBudgetFor: () => ({ beforeEffect: async () => {}, recordUsage: async () => {} })
    })
    await expect(runner.runTurn('th_1', 'turn_1')).rejects.toThrow(/capability snapshot is missing/)
  })
})
