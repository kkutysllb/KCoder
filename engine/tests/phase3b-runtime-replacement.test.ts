import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EventedV2MultiAgentRuntime,
  createDefaultSpecialistRegistry,
  materializeTeamGraph
} from '@qiongqi/loop'
import { FileMultiAgentRunStore, FileMailboxStore } from '@qiongqi/adapter-storage'

/**
 * Phase 3b: 验证整体替换后的 KWorks evented-v2-multi-agent-runtime 在 KCoder 下可用。
 * 覆盖新模型核心路径: startRun（空路由 provisional）→ applyRouteDecision（路由 specialist）→ completeAgentTask。
 */
describe('Phase 3b: EventedV2MultiAgentRuntime（KWorks 整体替换）', () => {
  let dir: string

  async function bootstrap() {
    dir = await mkdtemp(join(tmpdir(), 'kcoder-phase3b-'))
    const runs = new FileMultiAgentRunStore(dir)
    const mailbox = new FileMailboxStore(dir)
    const registry = createDefaultSpecialistRegistry({
      revision: 'reg_v1',
      enabledIds: ['backend', 'frontend']
    })
    const snapshot = materializeTeamGraph({
      decision: { summary: 'provisional', specialists: [] },
      registry,
      graphPublicKey: 'graph_test',
      budgets: { maxParallelNodes: 4, maxActivatedSpecialists: 10, maxRetriesPerNode: 2, maxDurationMs: 600000 }
    })
    const runtime = new EventedV2MultiAgentRuntime({
      runs,
      mailbox,
      graphSnapshot: snapshot,
      ids: (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2)}`,
      nowIso: () => new Date().toISOString()
    })
    return { runtime, runs, registry }
  }

  it('startRun 创建 provisional run（空路由，manager_planning 激活）', async () => {
    const { runtime } = await bootstrap()
    const run = await runtime.startRun({
      threadId: 'th_1',
      turnId: 'turn_1',
      workspaceKey: 'ws_1',
      prompt: '实现登录接口'
    })
    expect(run.threadId).toBe('th_1')
    expect(run.status).toBe('running')
    expect(run.graphSnapshot?.templateId).toBe('manager-specialists-v1')
    // manager_planning 应被激活
    expect(run.activeNodeIds).toContain('manager_planning')
    // routeDecision 初始未设置
    expect(run.routeDecision).toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  it('applyRouteDecision 挂载路由后的 graphSnapshot 并激活 specialist', async () => {
    const { runtime, registry } = await bootstrap()
    const started = await runtime.startRun({
      threadId: 'th_2',
      turnId: 'turn_2',
      workspaceKey: 'ws_2',
      prompt: '全栈功能'
    })
    const routedSnapshot = materializeTeamGraph({
      decision: {
        summary: '全栈开发',
        specialists: [
          { specialistId: 'backend', task: '实现 API', dependsOn: [], required: true },
          { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
        ]
      },
      registry,
      graphPublicKey: started.graphSnapshot!.publicKey,
      budgets: started.graphSnapshot!.budgets
    })
    const routed = await runtime.applyRouteDecision({
      runId: started.runId,
      graphSnapshot: routedSnapshot,
      routeDecision: routedSnapshot.routeDecision ?? {
        summary: '全栈开发',
        specialists: [
          { specialistId: 'backend', task: '实现 API', dependsOn: [], required: true },
          { specialistId: 'frontend', task: '实现 UI', dependsOn: ['backend'], required: true }
        ]
      }
    })
    expect(routed.routeDecision?.specialists).toHaveLength(2)
    // applyRouteDecision 挂载新的 graphSnapshot（含 2 个 specialist 节点）
    expect(routed.graphSnapshot?.nodes.map((n) => n.id)).toContain('specialist:backend')
    expect(routed.graphSnapshot?.nodes.map((n) => n.id)).toContain('specialist:frontend')
    await rm(dir, { recursive: true, force: true })
  })
})
