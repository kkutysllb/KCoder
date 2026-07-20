import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalToolHost, buildDefaultLocalTools } from '@qiongqi/adapter-tools'
import { CREATE_PLAN_TOOL_NAME } from '@qiongqi/adapter-tools'
import { GET_GOAL_TOOL_NAME, UPDATE_GOAL_TOOL_NAME } from '@qiongqi/adapter-tools'
import { makeCompactionItem } from '@qiongqi/domain'
import type { ModelRequest, ModelStreamChunk } from '@qiongqi/ports'
import {
  bootstrapThread,
  makeHarness
} from './loop-test-harness.js'

describe('ContinuationPolicy', () => {
  it('recovers once from an empty stop response before accepting completion', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'empty-stop-runner',
      model: 'empty-stop-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Recovered final answer.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(2)
  })

  it('continues after a non-terminal action preamble until the model actually uses tools', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'preamble-runner',
      model: 'preamble-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield { kind: 'assistant_text_delta', text: '我将先读取当前目录并继续分析。' }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        if (calls === 2) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_pwd',
            toolName: 'pwd',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: '分析完成。' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { toolStorm: { enabled: false } })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(3)
  })

  it('continues after an apology that only promises to resume unfinished work', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'resume-promise-runner',
      model: 'resume-promise-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'assistant_text_delta',
            text: '抱歉，我刚才误以为任务已切换上下文，没有继续往下推进。我现在立刻继续完成图表生成、Markdown 报告和 HTML 看板。'
          }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        if (calls === 2) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_pwd_resume',
            toolName: 'pwd',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'assistant_text_delta', text: '图表、Markdown 报告和 HTML 看板已生成完成。' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { toolStorm: { enabled: false } })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(3)
  })

  it('recovers from an empty terminal response after tool execution', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'post-tool-empty-runner',
      model: 'post-tool-empty-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_pwd',
            toolName: 'pwd',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        if (calls === 2) {
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        yield { kind: 'assistant_text_delta', text: 'Final answer after tool output.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { toolStorm: { enabled: false } })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const texts = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_text')
      .map((item) => item.kind === 'assistant_text' ? item.text : '')

    expect(status).toBe('completed')
    expect(calls).toBe(3)
    expect(texts).toContain('Final answer after tool output.')
  })

  it('materializes a fallback final answer when post-tool empty recovery is exhausted', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'post-tool-empty-exhausted-runner',
      model: 'post-tool-empty-exhausted-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_pwd',
            toolName: 'pwd',
            arguments: {}
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }, { toolStorm: { enabled: false } })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)
    const fallback = items.find(
      (item) => item.kind === 'assistant_text' && item.text.includes('工具已经执行完成，但模型没有生成最终答复')
    )

    expect(status).toBe('completed')
    expect(calls).toBe(3)
    expect(fallback).toBeDefined()
  })

  it('recovers from a post-compaction context-loss clarification without leaving it as completed output', async () => {
    let calls = 0
    const h = makeHarness({
      provider: 'context-loss-runner',
      model: 'context-loss-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'assistant_text_delta',
            text: '对话上下文已被压缩，我无法还原您最后一条请求的原文。请问您接下来想做什么？'
          }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        yield { kind: 'assistant_text_delta', text: '修复完成：我已继续处理 QiongQi 的上下文恢复链路。' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h, { request: { prompt: '继续' } })
    await h.turns.applyItem(
      h.threadId,
      makeCompactionItem({
        id: 'compaction_recoverable',
        turnId: h.turnId,
        threadId: h.threadId,
        replacedTokens: 900,
        pinnedConstraints: ['所有 qiongqi 核心修复都要同步到 /Users/libing/kk_Projects/QiongQi'],
        summary: [
          'Task resumption state:',
          '- Active objective: 继续修复 QiongQi classic loop 上下文压缩后丢失真实任务的问题',
          '- Current state: 已经定位到 evaluator 会把上下文丢失式反问当作普通 stop',
          '- Next actions:',
          '  - 写 RED 测试并实现恢复保护',
          '- Do not ask the user what to do unless this summary explicitly says user input is required or the next action is blocked.'
        ].join('\n')
      })
    )

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const texts = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_text')
      .map((item) => item.kind === 'assistant_text' ? { id: item.id, text: item.text, status: item.status } : null)
      .filter(Boolean)

    expect(status).toBe('completed')
    expect(calls).toBe(2)
    expect(texts).toContainEqual({
      id: expect.any(String),
      text: '对话上下文已被压缩，我无法还原您最后一条请求的原文。请问您接下来想做什么？',
      status: 'failed'
    })
    expect(texts).toContainEqual({
      id: expect.any(String),
      text: '修复完成：我已继续处理 QiongQi 的上下文恢复链路。',
      status: 'completed'
    })
  })

  it('fails a classic turn that exceeds its loop step budget', async () => {
    const h = makeHarness({
      provider: 'runaway-runner',
      model: 'runaway-runner',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        yield {
          kind: 'tool_call_complete',
          callId: `call_pwd_${Math.random()}`,
          toolName: 'pwd',
          arguments: {}
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }, {
      loopBudget: { maxSteps: 3 },
      toolStorm: { enabled: false }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('failed')
    expect(items.some((item) => item.kind === 'error' && item.code === 'loop_budget_exceeded')).toBe(true)
  })

  it('keeps running past the legacy eight-step ceiling until the model stops', async () => {
    let calls = 0
    const h = makeHarness(
      {
        provider: 'long-runner',
        model: 'long-runner',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls <= 9) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_ls_${calls}`,
              toolName: 'ls',
              arguments: { path: '.' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'done' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: buildDefaultLocalTools(), toolStorm: { enabled: false } }
    )
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)
    const items = await h.sessionStore.loadItems(h.threadId)

    expect(status).toBe('completed')
    expect(calls).toBe(10)
    expect(items.some((item) => item.kind === 'assistant_text' && item.text === 'done')).toBe(true)
  })

  it('continues an active goal after no-tool model turns until update_goal completes it', async () => {
    let h: ReturnType<typeof makeHarness>
    const goalTools = [
      LocalToolHost.defineTool({
        name: GET_GOAL_TOOL_NAME,
        description: 'Get goal',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (_args, context) => ({ output: { goal: await h.threads.getGoal(context.threadId) } })
      }),
      LocalToolHost.defineTool({
        name: UPDATE_GOAL_TOOL_NAME,
        description: 'Update goal',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['complete', 'blocked'] }
          },
          required: ['status'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const status = args.status
          if (status !== 'complete' && status !== 'blocked') {
            return { output: { error: 'invalid status' }, isError: true }
          }
          const goal = await h.threads.setGoal(context.threadId, { status })
          return { output: { goal } }
        }
      })
    ]
    let calls = 0
    h = makeHarness(
      {
        provider: 'goal-continuation',
        model: 'goal-continuation',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield { kind: 'assistant_text_delta', text: 'Draft ready.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 2) {
            yield { kind: 'assistant_text_delta', text: 'Still working.' }
            yield { kind: 'completed', stopReason: 'stop' }
            return
          }
          if (calls === 3) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_complete_goal',
              toolName: UPDATE_GOAL_TOOL_NAME,
              arguments: { status: 'complete' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Goal complete.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      { tools: [...buildDefaultLocalTools(), ...goalTools] }
    )
    await bootstrapThread(h, { request: { prompt: 'write a benchmark note' } })
    await h.threads.setGoal(h.threadId, {
      objective: 'write a benchmark note',
      status: 'active'
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(calls).toBe(4)
    expect((await h.threads.getGoal(h.threadId))?.status).toBe('complete')
    const texts = (await h.sessionStore.loadItems(h.threadId))
      .filter((item) => item.kind === 'assistant_text')
      .map((item) => item.kind === 'assistant_text' ? item.text : '')
    expect(texts).toEqual(['Draft ready.', 'Still working.', 'Goal complete.'])
  })

  it('uses persisted GUI plan context to advertise and execute create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-'))
    const observedToolLists: string[][] = []
    const observedRequiredToolNames: Array<string | undefined> = []
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedToolLists.push(request.tools.map((tool) => tool.name))
            observedRequiredToolNames.push(request.requiredToolName)
            if (observedToolLists.length === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_plan',
                toolName: CREATE_PLAN_TOOL_NAME,
                arguments: {
                  markdown: '# Generated plan',
                  operation: 'draft',
                  source_request: 'Add auth'
                }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.qiongqisdd/plan/auth.md',
            planId: `${workspace}:.qiongqisdd/plan/auth.md`,
            sourceRequest: 'Add auth',
            title: 'Auth'
          }
        }
      })
      const status = await h.loop.runTurn(h.threadId, h.turnId)
      expect(status).toBe('completed')
      expect(observedToolLists[0]).toContain(CREATE_PLAN_TOOL_NAME)
      expect(observedRequiredToolNames.slice(0, 2)).toEqual([CREATE_PLAN_TOOL_NAME, undefined])
      await expect(readFile(join(workspace, '.qiongqisdd/plan/auth.md'), 'utf8')).resolves.toBe('# Generated plan')
      const turn = await h.turns.getTurn(h.threadId, h.turnId)
      expect(turn?.guiPlan?.relativePath).toBe('.qiongqisdd/plan/auth.md')
      const items = await h.sessionStore.loadItems(h.threadId)
      const result = items.find((item) => item.kind === 'tool_result' && item.callId === 'call_plan')
      expect(result).toBeDefined()
      if (result?.kind === 'tool_result') {
        expect(result.toolName).toBe(CREATE_PLAN_TOOL_NAME)
        expect(result.output).toMatchObject({
          relative_path: '.qiongqisdd/plan/auth.md',
          workspace_root: workspace,
          operation: 'draft'
        })
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text when a GUI plan turn misses create_plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-missing-tool-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.qiongqisdd/plan/auth.md',
            planId: `${workspace}:.qiongqisdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)

      expect(status).toBe('completed')
      await expect(readFile(join(workspace, '.qiongqisdd/plan/auth.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth.'
      )
      expect(items.some((item) =>
        item.kind === 'tool_result' &&
        item.toolName === CREATE_PLAN_TOOL_NAME &&
        item.isError !== true
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('materializes assistant plan text for plan-mode turns without a reserved context', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-free-form-text-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'assistant_text_delta', text: '## Plan\nPolish the sidebar footer.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan sidebar footer polish',
          mode: 'plan'
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const planResult = items.find((item) =>
        item.kind === 'tool_result' && item.toolName === CREATE_PLAN_TOOL_NAME
      )

      expect(status).toBe('completed')
      expect(planResult?.kind === 'tool_result' && planResult.isError).not.toBe(true)
      expect(
        planResult?.kind === 'tool_result' &&
        (planResult.output as { relative_path?: string }).relative_path
      ).toBe('.qiongqisdd/plan/plan-sidebar-footer-polish.md')
      await expect(readFile(join(workspace, '.qiongqisdd/plan/plan-sidebar-footer-polish.md'), 'utf8')).resolves.toBe(
        '## Plan\nPolish the sidebar footer.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('fails GUI plan turns only when neither create_plan nor plan text is returned', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-empty-'))
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(): AsyncIterable<ModelStreamChunk> {
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.qiongqisdd/plan/auth.md',
            planId: `${workspace}:.qiongqisdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)
      const items = await h.sessionStore.loadItems(h.threadId)
      const events = await h.sessionStore.loadEventsSince(h.threadId, 0)

      expect(status).toBe('failed')
      expect(items.some((item) =>
        item.kind === 'error' && item.code === 'required_tool_missing'
      )).toBe(true)
      expect(events.some((event) =>
        event.kind === 'error' && event.code === 'required_tool_missing'
      )).toBe(true)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('keeps requiring create_plan after unrelated tool calls in a GUI plan turn', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-loop-plan-other-tool-'))
    const observedRequiredToolNames: Array<string | undefined> = []
    let calls = 0
    try {
      const h = makeHarness(
        {
          provider: 'planner',
          model: 'planner',
          async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
            observedRequiredToolNames.push(request.requiredToolName)
            calls += 1
            if (calls === 1) {
              yield {
                kind: 'tool_call_complete',
                callId: 'call_echo',
                toolName: 'echo',
                arguments: { text: 'not a plan' }
              }
              yield { kind: 'completed', stopReason: 'tool_calls' }
              return
            }
            yield { kind: 'assistant_text_delta', text: '## Plan\nImplement auth after checking context.\n' }
            yield { kind: 'completed', stopReason: 'stop' }
          }
        },
        { tools: buildDefaultLocalTools() }
      )
      await bootstrapThread(h, {
        workspace,
        request: {
          prompt: 'Plan auth',
          guiPlan: {
            operation: 'draft',
            workspaceRoot: workspace,
            relativePath: '.qiongqisdd/plan/auth.md',
            planId: `${workspace}:.qiongqisdd/plan/auth.md`,
            sourceRequest: 'Add auth'
          }
        }
      })

      const status = await h.loop.runTurn(h.threadId, h.turnId)

      expect(status).toBe('completed')
      expect(observedRequiredToolNames).toEqual([CREATE_PLAN_TOOL_NAME, CREATE_PLAN_TOOL_NAME, undefined])
      await expect(readFile(join(workspace, '.qiongqisdd/plan/auth.md'), 'utf8')).resolves.toBe(
        '## Plan\nImplement auth after checking context.'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
