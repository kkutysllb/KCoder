import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '@qiongqi/adapter-storage'
import { InMemorySessionStore } from '@qiongqi/adapter-storage'
import { InMemoryThreadStore } from '@qiongqi/adapter-storage'
import {
  buildGoalLocalTools,
  CREATE_GOAL_TOOL_NAME,
  GET_GOAL_TOOL_NAME,
  UPDATE_GOAL_TOOL_NAME
} from '@qiongqi/adapter-tools'
import { LocalToolHost } from '@qiongqi/adapter-tools'
import type { ToolHostContext } from '@qiongqi/ports'
import { SequentialIdGenerator } from '@qiongqi/ports'
import { RuntimeEventRecorder } from '@qiongqi/services'
import { ThreadService } from '@qiongqi/services'

function buildService(): {
  service: ThreadService
  sessionStore: InMemorySessionStore
} {
  const bus = new InMemoryEventBus()
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const ids = new SequentialIdGenerator()
  let now = 1_700_000_000_000
  const nowIso = () => new Date((now += 1000)).toISOString()
  const events = new RuntimeEventRecorder({
    eventBus: bus,
    sessionStore,
    allocateSeq: (threadId) => bus.allocateSeq(threadId),
    nowIso
  })
  return {
    service: new ThreadService({ threadStore, sessionStore, events, ids, nowIso }),
    sessionStore
  }
}

function toolContext(threadId: string): ToolHostContext {
  return {
    threadId,
    turnId: 'turn_goal',
    workspace: '/tmp',
    approvalPolicy: 'on-request',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('goal local tools', () => {
  it('advertises get/create/update goal tools', async () => {
    const { service } = buildService()
    const host = new LocalToolHost({ tools: buildGoalLocalTools(service) })

    const names = (await host.listTools(toolContext('thr_goal'))).map((tool) => tool.name)

    expect(names).toContain(GET_GOAL_TOOL_NAME)
    expect(names).toContain(CREATE_GOAL_TOOL_NAME)
    expect(names).toContain(UPDATE_GOAL_TOOL_NAME)
  })

  it('lets the model mark an existing goal complete', async () => {
    const { service, sessionStore } = buildService()
    await service.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_goal', title: 'Goal thread' }
    )
    await service.setGoal('thr_goal', {
      objective: 'check the memory pressure',
      status: 'active',
      tokenBudget: 100
    })
    const host = new LocalToolHost({ tools: buildGoalLocalTools(service) })

    const result = await host.execute({
      callId: 'call_goal_complete',
      toolName: UPDATE_GOAL_TOOL_NAME,
      arguments: { status: 'complete' }
    }, toolContext('thr_goal'))

    expect(result.item.kind).toBe('tool_result')
    if (result.item.kind !== 'tool_result') return
    expect(result.item.isError).toBeFalsy()
    expect(result.item.output).toMatchObject({
      goal: { status: 'complete', objective: 'check the memory pressure' },
      remainingTokens: 100,
      completionBudgetReport: expect.any(String)
    })
    expect((await service.getGoal('thr_goal'))?.status).toBe('complete')
    const events = await sessionStore.loadEventsSince('thr_goal', 0)
    expect(events.some((event) => event.kind === 'goal_updated')).toBe(true)
  })

  it('rejects unsupported status updates and missing goals without mutating state', async () => {
    const { service } = buildService()
    await service.create(
      { workspace: '/tmp', model: 'deepseek-chat', mode: 'agent' },
      { id: 'thr_empty', title: 'Empty goal thread' }
    )
    const host = new LocalToolHost({ tools: buildGoalLocalTools(service) })

    const unsupported = await host.execute({
      callId: 'call_goal_pause',
      toolName: UPDATE_GOAL_TOOL_NAME,
      arguments: { status: 'paused' }
    }, toolContext('thr_empty'))
    const missing = await host.execute({
      callId: 'call_goal_missing',
      toolName: UPDATE_GOAL_TOOL_NAME,
      arguments: { status: 'complete' }
    }, toolContext('thr_empty'))

    expect(unsupported.item.kind).toBe('tool_result')
    expect(missing.item.kind).toBe('tool_result')
    if (unsupported.item.kind !== 'tool_result' || missing.item.kind !== 'tool_result') return
    expect(unsupported.item.isError).toBe(true)
    expect(missing.item.isError).toBe(true)
    expect(await service.getGoal('thr_empty')).toBeNull()
  })
})
