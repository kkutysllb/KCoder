import { describe, expect, it } from 'vitest'
import { decideLoopContinuation } from '@qiongqi/loop'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import type { BuildContext } from '@qiongqi/loop'
import type { StepResult } from '@qiongqi/loop'

// BuildContext has many required fields; cast through unknown to supply
// only the fields the pure decision function reads.
function mkCtx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    request: { messages: [] },
    model: 'm', modelCapabilities: {} as never, thread: {} as never, turn: {} as never,
    healedItems: [], activePlanContext: undefined, effectiveMode: 'agent',
    approvalPolicy: 'auto', planTurnActive: false, allowedToolNames: undefined,
    activeSkillIds: [], activeGoalInstruction: null, toolSpecs: [],
    toolProviderMetadata: new Map(), toolProviderKinds: new Map(), toolKinds: new Map(),
    toolCatalogDrift: {} as never, attachments: { imageAttachments: [], textFallbacks: [] },
    ...over
  } as unknown as BuildContext
}

function mkRan(over: Partial<Extract<StepResult, { kind: 'ran' }>> = {}): Extract<StepResult, { kind: 'ran' }> {
  return {
    kind: 'ran',
    text: '',
    textItemId: 'item_text',
    reasoning: '',
    reasoningItemId: 'item_reason',
    completedToolCalls: [],
    stopReason: 'stop',
    ...over
  }
}

describe('decideLoopContinuation', () => {
  it('stops when model returns no tool calls and no required tool', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop' }),
      ctx: mkCtx(),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('stop')
  })

  it('dispatches when tool calls are present', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({
        stopReason: 'tool_calls',
        completedToolCalls: [{ callId: 'c1', toolName: 'ls', arguments: {} }]
      }),
      ctx: mkCtx(),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('dispatch')
  })

  it('fails on error stop reason', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'error' }),
      ctx: mkCtx(),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('failed')
  })

  it('fails_with_error when a required tool is missing', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop', text: 'no tool' }),
      ctx: mkCtx({ request: { messages: [], requiredToolName: 'some_tool' } }),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('failed_with_error')
    if (decision.action === 'failed_with_error') {
      expect(decision.errorCode).toBe('required_tool_missing')
    }
  })

  it('continues an active goal after a no-tool stop', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop' }),
      ctx: mkCtx({ activeGoalInstruction: 'keep going' } as Partial<BuildContext>),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('continue')
  })

  it('continues when the model stop text is an action preamble rather than a terminal answer', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop', text: '我将先读取项目文件并继续深入分析。' }),
      ctx: mkCtx({
        request: { messages: [] },
        toolSpecs: [{ name: 'bash', description: 'Run shell commands', inputSchema: {} }]
      }),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('continue')
  })

  it('still stops for a terminal answer even when tools are available', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop', text: '分析完成：根因是配置缺失，已给出修复路径。' }),
      ctx: mkCtx({
        request: { messages: [] },
        toolSpecs: [{ name: 'bash', description: 'Run shell commands', inputSchema: {} }]
      }),
      ids: { next: () => 'x' } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('stop')
  })

  it('materializes plan text when requiredToolName is create_plan and text is present', () => {
    const decision = decideLoopContinuation({
      stepResult: mkRan({ stopReason: 'stop', text: '## Plan\nDo it.' }),
      ctx: mkCtx({
        request: { messages: [], requiredToolName: CREATE_PLAN_TOOL_NAME }
      }),
      ids: { next: (p) => `id_${p}` } as never,
      threadId: 't1',
      turnId: 'tu1'
    })
    expect(decision.action).toBe('materialize_plan')
    if (decision.action === 'materialize_plan') {
      expect(decision.planCall.toolName).toBe(CREATE_PLAN_TOOL_NAME)
    }
  })
})
