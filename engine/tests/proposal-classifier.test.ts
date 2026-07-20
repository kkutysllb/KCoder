import { describe, expect, it } from 'vitest'
import type { ModelProposal, TaskStateV1 } from '@qiongqi/contracts'
import { classifyProposal } from '@qiongqi/loop'

describe('classifyProposal', () => {
  it('uses normalized integrity metadata before visible text', () => {
    expect(classifyProposal({
      proposal: proposal({
        text: '(tool call) bash',
        integrity: {
          leakedProtocolText: true,
          malformedToolCall: false,
          completeToolCalls: true
        }
      }),
      task
    })).toBe('protocol_error')
  })

  it('keeps valid native tool intents when protocol markers leaked in the text channel', () => {
    expect(classifyProposal({
      proposal: proposal({
        stopClass: 'tool_calls',
        text: '(tool call) bash',
        integrity: {
          leakedProtocolText: true,
          malformedToolCall: false,
          completeToolCalls: true
        },
        toolIntents: [{ callId: 'c1', toolName: 'bash', arguments: { command: 'pwd' } }]
      }),
      task
    })).toBe('tool_intents')
  })

  it.each([
    '对话内容已经不在我的可见范围，请重新描述你要我完成的工作。',
    '我现在无法接续之前的任务。请告诉我下一步应该做什么。',
    '抱歉，我刚才误以为任务已切换上下文，没有继续往下推进。我现在立刻继续完成图表生成、Markdown 报告和 HTML 看板。',
    'I cannot see the earlier task anymore. Tell me what I should continue with.',
    'What should I continue with?'
  ])('classifies task discontinuity without requiring one fixed phrase: %s', (text) => {
    expect(classifyProposal({ proposal: proposal({ text }), task })).toBe('context_discontinuity')
  })

  it('classifies action preambles with pending work as non-terminal', () => {
    expect(classifyProposal({
      proposal: proposal({ text: '我现在立刻继续完成图表生成、Markdown 报告和 HTML 看板。' }),
      task
    })).toBe('nonterminal_action')
  })

  it('keeps an ordinary domain clarification as final text', () => {
    expect(classifyProposal({
      proposal: proposal({ text: '请补充你希望分析的行业和时间范围。' }),
      task
    })).toBe('final_text')
  })

  it('classifies native tool intents before text completion', () => {
    expect(classifyProposal({
      proposal: proposal({
        stopClass: 'tool_calls',
        toolIntents: [{ callId: 'c1', toolName: 'bash', arguments: { command: 'pwd' } }]
      }),
      task
    })).toBe('tool_intents')
  })
})

const task = {
  version: 1,
  identity: {
    ownerUserId: 'owner-1',
    workspaceKey: '/workspace-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    runId: 'run-1'
  },
  revision: 2,
  source: {
    objectiveItemId: 'user-1',
    sourceItemIds: ['user-1'],
    sourceDigest: 'source-1'
  },
  objective: '完成行业分析报告',
  constraints: [],
  completedActions: [],
  pendingActions: [{
    id: 'next-1',
    text: '生成报告',
    status: 'pending',
    evidenceItemIds: []
  }],
  activeSkillIds: [],
  artifacts: [],
  toolLedger: [],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z'
} satisfies TaskStateV1

function proposal(overrides: Partial<ModelProposal> = {}): ModelProposal {
  return {
    proposalId: 'proposal-1',
    model: 'minimax-m3',
    stopClass: 'normal',
    integrity: {
      leakedProtocolText: false,
      malformedToolCall: false,
      completeToolCalls: true
    },
    text: 'done',
    reasoning: '',
    toolIntents: [],
    ...overrides
  }
}
