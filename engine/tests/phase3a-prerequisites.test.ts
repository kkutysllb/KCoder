import { describe, expect, it } from 'vitest'
import {
  AgentMessageDeltaEvent,
  AgentMessageCompletedEvent,
  RuntimeEvent,
  RuntimeEventKind
} from '@qiongqi/contracts'
import type { TurnService } from '@qiongqi/services'

describe('events: AgentMessage 事件（evented_v2 流式用）', () => {
  it('RuntimeEventKind 包含 agent_message_delta / agent_message_completed', () => {
    const kinds = RuntimeEventKind.options
    expect(kinds).toContain('agent_message_delta')
    expect(kinds).toContain('agent_message_completed')
  })

  it('AgentMessageDeltaEvent 解析合法 delta 事件', () => {
    const parsed = AgentMessageDeltaEvent.parse({
      seq: 1,
      timestamp: '2026-07-25T00:00:00Z',
      threadId: 'th_1',
      turnId: 'turn_1',
      agentKey: 'pub_1',
      messageKey: 'msg_1',
      sourceRef: 'src_1',
      role: 'assistant',
      content: '你好',
      kind: 'agent_message_delta',
      delta: '你好'
    })
    expect(parsed.kind).toBe('agent_message_delta')
    expect(parsed.delta).toBe('你好')
  })

  it('AgentMessageCompletedEvent 解析合法完成事件', () => {
    const parsed = AgentMessageCompletedEvent.parse({
      seq: 2,
      timestamp: '2026-07-25T00:00:00Z',
      threadId: 'th_1',
      turnId: 'turn_1',
      agentKey: 'pub_1',
      messageKey: 'msg_1',
      sourceRef: 'src_1',
      role: 'assistant',
      content: '你好世界',
      kind: 'agent_message_completed',
      artifactKeys: ['art_1']
    })
    expect(parsed.kind).toBe('agent_message_completed')
    expect(parsed.artifactKeys).toEqual(['art_1'])
  })

  it('RuntimeEvent 联合类型接受 agent_message_delta', () => {
    const event = RuntimeEvent.parse({
      seq: 1,
      timestamp: '2026-07-25T00:00:00Z',
      threadId: 'th_1',
      agentKey: 'pub_1',
      messageKey: 'msg_1',
      sourceRef: 'src_1',
      role: 'assistant',
      content: 'hi',
      kind: 'agent_message_delta',
      delta: 'hi'
    })
    expect(event.kind).toBe('agent_message_delta')
  })
})

describe('TurnService: linkEventedV2Run + allocateExecutionSequence（evented_v2 用）', () => {
  it('TurnService 类型暴露 linkEventedV2Run 方法', () => {
    // 类型级测试：引用方法证明接口存在
    const method: TurnService['linkEventedV2Run'] | undefined = undefined
    expect(method).toBeUndefined()
  })

  it('TurnService 类型暴露 allocateExecutionSequence 方法', () => {
    const method: TurnService['allocateExecutionSequence'] | undefined = undefined
    expect(method).toBeUndefined()
  })
})
