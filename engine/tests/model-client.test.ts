import { describe, expect, it } from 'vitest'
import { DeepseekCompatModelClient } from '@qiongqi/adapter-model'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeCompactionItem,
  makeToolCallItem,
  makeToolResultItem,
  makeUserInputItem,
  makeUserItem
} from '@qiongqi/domain'
import type { ModelRequest, ModelStreamChunk } from '@qiongqi/ports'

function buildRequest(abortSignal: AbortSignal): ModelRequest {
  return {
    threadId: 'thr_1',
    turnId: 'turn_1',
    model: 'deepseek-chat',
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [
      {
        name: 'echo',
        description: 'Echo a string back to the model.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }
      }
    ],
    abortSignal
  }
}

function collectKinds(chunks: ModelStreamChunk[]): string[] {
  return chunks.map((chunk) => chunk.kind)
}

function sseStream(payloads: Array<Record<string, unknown> | '[DONE]'>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${payload === '[DONE]' ? payload : JSON.stringify(payload)}\n\n`))
      }
      controller.close()
    }
  })
}

describe('DeepseekCompatModelClient', () => {
  it('reports sanitized endpoint details when fetch fails', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('fetch failed')
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'sk-secret-zhipu',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl
    })

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(chunks[0]).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    })
    expect((chunks[0] as { message?: string }).message).toContain('endpointFormat=chat_completions')
    expect((chunks[0] as { message?: string }).message).not.toContain('sk-secret-zhipu')
  })

  it('uses request.model over client default model', async () => {
    const response = {
      id: 'r2',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'done'
          }
        }
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2
      }
    }
    const sentBodies: Array<{ model?: string }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.model).toBe('deepseek-v4-pro')
  })

  it('builds chat completions URLs for base URLs with and without version segments', async () => {
    const cases = [
      ['https://zenmux.ai/api', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v1', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v1/', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://zenmux.ai/api/v2', 'https://zenmux.ai/api/v2/chat/completions'],
      ['https://zenmux.ai/api/v1/chat/completions', 'https://zenmux.ai/api/v1/chat/completions'],
      ['https://api.deepseek.com/beta', 'https://api.deepseek.com/v1/chat/completions'],
      ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions']
    ]

    for (const [baseUrl, expectedUrl] of cases) {
      const sentUrls: string[] = []
      const fetchImpl: typeof fetch = async (url) => {
        sentUrls.push(String(url))
        return new Response(JSON.stringify({
          id: 'url',
          model: 'deepseek-chat',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      const client = new DeepseekCompatModelClient({
        baseUrl,
        apiKey: 'k',
        model: 'deepseek-chat',
        fetchImpl,
        nonStreaming: true
      })

      for await (const _chunk of client.stream(buildRequest(new AbortController().signal))) {
        // drain
      }

      expect(sentUrls[0]).toBe(expectedUrl)
    }
  })

  it('normalizes user-facing OpenAI-compatible protocol aliases to chat completions URLs', async () => {
    const cases = [
      ['openai_compatible', 'https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'],
      ['openai-compatible', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
      ['openai_chat_completions', 'https://api.minimax.io/v1/text/chatcompletion_v2', 'https://api.minimax.io/v1/chat/completions']
    ]

    for (const [endpointFormat, baseUrl, expectedUrl] of cases) {
      const sentUrls: string[] = []
      const fetchImpl: typeof fetch = async (url) => {
        sentUrls.push(String(url))
        return new Response(JSON.stringify({
          id: 'url',
          model: 'compat-model',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      const client = new DeepseekCompatModelClient({
        baseUrl,
        apiKey: 'k',
        model: 'compat-model',
        endpointFormat: endpointFormat as never,
        fetchImpl,
        nonStreaming: true
      })

      for await (const _chunk of client.stream(buildRequest(new AbortController().signal))) {
        // drain
      }

      expect(sentUrls[0]).toBe(expectedUrl)
    }
  })

  it('normalizes user-facing Anthropic-compatible protocol aliases to messages URLs', async () => {
    const cases = [
      ['anthropic_compatible', 'https://api.deepseek.com', 'https://api.deepseek.com/v1/messages'],
      ['anthropic-compatible', 'https://open.bigmodel.cn/api/anthropic', 'https://open.bigmodel.cn/api/anthropic/v1/messages'],
      ['anthropic_messages', 'https://api.minimax.io/v1/messages', 'https://api.minimax.io/v1/messages']
    ]

    for (const [endpointFormat, baseUrl, expectedUrl] of cases) {
      const sentUrls: string[] = []
      const fetchImpl: typeof fetch = async (url) => {
        sentUrls.push(String(url))
        return new Response(JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 }
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      const client = new DeepseekCompatModelClient({
        baseUrl,
        apiKey: 'k',
        model: 'compat-model',
        endpointFormat: endpointFormat as never,
        fetchImpl,
        nonStreaming: true
      })

      for await (const _chunk of client.stream(buildRequest(new AbortController().signal))) {
        // drain
      }

      expect(sentUrls[0]).toBe(expectedUrl)
    }
  })

  it('routes GLM 5.2 coding-plan models to BigModel/Z.ai coding endpoints', async () => {
    const cases = [
      [
        'chat_completions',
        'https://open.bigmodel.cn/api/paas/v4',
        'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
      ],
      [
        'openai_compatible',
        'https://api.z.ai/api/paas/v4',
        'https://api.z.ai/api/coding/paas/v4/chat/completions'
      ],
      [
        'anthropic_compatible',
        'https://open.bigmodel.cn/api/paas/v4',
        'https://open.bigmodel.cn/api/anthropic/v1/messages'
      ],
      [
        'anthropic_compatible',
        'https://api.z.ai/api/coding/paas/v4',
        'https://api.z.ai/api/anthropic/v1/messages'
      ]
    ]

    for (const [endpointFormat, baseUrl, expectedUrl] of cases) {
      const sentUrls: string[] = []
      const fetchImpl: typeof fetch = async (url) => {
        sentUrls.push(String(url))
        if (String(expectedUrl).endsWith('/messages')) {
          return new Response(JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'done' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 }
          }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        }
        return new Response(JSON.stringify({
          id: 'url',
          model: 'glm-5.2',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      const client = new DeepseekCompatModelClient({
        baseUrl,
        apiKey: 'k',
        model: 'glm-5.2',
        endpointFormat: endpointFormat as never,
        fetchImpl,
        nonStreaming: true
      })

      const request = buildRequest(new AbortController().signal)
      request.model = 'glm-5.2'
      for await (const _chunk of client.stream(request)) {
        // drain
      }

      expect(sentUrls[0]).toBe(expectedUrl)
    }
  })

  it('uses Z.ai thinking controls without synthetic reasoning history for GLM OpenAI-compatible requests', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; reasoning_effort?: unknown; thinking?: unknown; tools?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-no-reasoning-fields',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I inspected the project.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_ls',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_ls',
        toolName: 'echo',
        arguments: { text: 'list files' }
      }),
      makeToolResultItem({
        id: 'result_ls',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_ls',
        toolName: 'echo',
        output: 'package.json'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = sentBodies[0]
    expect(body?.reasoning_effort).toBe('high')
    expect(body?.thinking).toEqual({ type: 'enabled', clear_thinking: true })
    expect(JSON.stringify(body?.messages ?? [])).not.toContain('reasoning_content')
    expect(body?.tools?.[0]).toMatchObject({ type: 'function' })
  })

  it('enables Z.ai streaming tool calls for GLM tool requests', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(sseStream([
        { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
        '[DONE]'
      ]), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    expect(sentBodies[0]).toMatchObject({
      stream: true,
      tool_stream: true
    })
    expect(sentBodies[0]?.tools).toEqual([
      expect.objectContaining({ type: 'function' })
    ])
  })

  it('folds GLM tool-call history into internal system context to avoid Zhipu messages 1214 errors', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-tool-history',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.history = [
      makeToolCallItem({
        id: 'call_failed_bash',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_failed_bash',
        toolName: 'bash',
        arguments: { command: 'ls missing-file' }
      }),
      makeToolResultItem({
        id: 'result_failed_bash',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_failed_bash',
        toolName: 'bash',
        output: {
          command: 'ls missing-file',
          exit_code: 1,
          output: 'ls: missing-file: No such file or directory'
        },
        isError: true
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages.some((message) => message.role === 'tool')).toBe(false)
    expect(JSON.stringify(messages)).not.toContain('"tool_calls"')
    expect(JSON.stringify(messages)).not.toContain('Tool bash failed')
    expect(JSON.stringify(messages)).not.toContain('Arguments:')
    expect(messages.some((message) =>
      message.role === 'system' &&
      String(message.content).includes('<qiongqi_internal_tool_context>') &&
      String(message.content).includes('status: failed')
    )).toBe(true)
  })

  it('folds GLM tool history that is kept after compaction into internal system context', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-compacted-tool-history',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.history = [
      makeCompactionItem({
        id: 'compaction_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'Older tool work was summarized.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeToolResultItem({
        id: 'orphan_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_read',
        toolName: 'read',
        output: { path: 'README.md', content: 'earlier output' }
      }),
      makeToolCallItem({
        id: 'call_bash',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_bash',
        toolName: 'bash',
        arguments: { command: 'sed -n 1,20p README.md' }
      }),
      makeAssistantTextItem({
        id: 'bridge_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Checking the final file shape.',
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result_bash',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_bash',
        toolName: 'bash',
        output: {
          command: 'sed -n 1,20p README.md',
          exit_code: 0,
          output: '# README'
        }
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages.some((message) => message.role === 'tool')).toBe(false)
    expect(JSON.stringify(messages)).not.toContain('"tool_calls"')
    expect(String(messages[0]?.content)).toContain('Older tool work was summarized')
    expect(JSON.stringify(messages)).not.toContain('Tool bash returned')
    expect(JSON.stringify(messages)).not.toContain('Arguments:')
    expect(JSON.stringify(messages)).toContain('<qiongqi_internal_tool_context>')
    expect(JSON.stringify(messages)).toContain('assistant_preface:')
    expect(JSON.stringify(messages)).toContain('Checking the final file shape.')
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Continue the active task')
    })
    expect(String(messages.at(-1)?.content)).toContain('Do not ask the user what to do')
  })

  it('folds replay-shifted GLM user-input tool history without orphan assistant messages', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-replayed-user-input-tool-history',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.history = [
      makeCompactionItem({
        id: 'compaction_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'Earlier user request and tool work were summarized.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeAssistantTextItem({
        id: 'assistant_preface',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I need one decision before continuing.',
        status: 'completed'
      }),
      {
        ...makeUserInputItem({
          id: 'input_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          inputId: 'in_1',
          prompt: 'Input requested',
          questions: [
            {
              header: 'Choice',
              id: 'choice',
              question: 'Pick one',
              options: [{ label: 'A', description: 'Use A' }]
            }
          ]
        }),
        status: 'submitted' as const
      },
      makeToolCallItem({
        id: 'call_user_input',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_user_input',
        toolName: 'request_user_input',
        arguments: { questions: [{ id: 'choice', question: 'Pick one' }] }
      }),
      makeToolResultItem({
        id: 'result_user_input',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_user_input',
        toolName: 'request_user_input',
        output: {
          status: 'submitted',
          answers: [{ id: 'choice', label: 'A', value: 'A' }]
        }
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages.some((message) => message.role === 'assistant')).toBe(false)
    expect(JSON.stringify(messages)).not.toContain('"tool_calls"')
    expect(messages.some((message) => message.role === 'tool')).toBe(false)
    expect(String(messages[0]?.content)).toContain('<qiongqi_internal_tool_context>')
    expect(String(messages[0]?.content)).toContain('assistant_preface:')
    expect(String(messages[0]?.content)).toContain('I need one decision before continuing.')
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Continue the active task')
    })
    expect(String(messages.at(-1)?.content)).toContain('Do not ask the user what to do')
  })

  it('strips persisted legacy folded GLM tool history from assistant text before sending context', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-persisted-tool-leak',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.history = [
      makeAssistantTextItem({
        id: 'leaked_assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: [
          'I checked the repository.',
          '',
          'Tool bash returned.',
          'Arguments: {"command":"ls"}',
          'Result:',
          '```',
          '{"output":"README.md"}',
          '```',
          '',
          'The project has a README.'
        ].join('\n'),
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = JSON.stringify(sentBodies[0]?.messages ?? [])
    expect(body).toContain('I checked the repository.')
    expect(body).toContain('The project has a README.')
    expect(body).not.toContain('Tool bash returned')
    expect(body).not.toContain('Arguments:')
    expect(body).not.toContain('"command":"ls"')
    expect(body).not.toContain('"output":"README.md"')
  })

  it('folds mutable system history into the initial system message for GLM OpenAI-compatible requests', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'glm-system-normalized',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.modeInstruction = 'Use coding mode.'
    request.contextInstructions = ['Workspace: /tmp/project']
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'User wants the project analyzed. Keep inspected files in scope.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'user_after_compact', turnId: 'turn_2', threadId: 'thr_1', text: 'continue' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const systemMessages = messages.filter((message) => message.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(String(messages[0]?.content)).toContain('You are a helpful assistant.')
    expect(String(messages[0]?.content)).toContain('Use coding mode.')
    expect(String(messages[0]?.content)).toContain('Workspace: /tmp/project')
    expect(String(messages[0]?.content)).toContain('User wants the project analyzed')
    expect(messages[1]).toMatchObject({ role: 'user', content: 'continue' })
  })

  it('folds GLM messages by model id even when routed through an OpenAI-compatible proxy', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; reasoning_effort?: unknown; thinking?: unknown }> = []
    const response = {
      id: 'glm-proxy-system-normalized',
      model: 'glm-5.2',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://gateway.example/openai',
      apiKey: 'k',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.reasoningEffort = 'high'
    request.modeInstruction = 'Use office mode.'
    request.contextInstructions = ['Workspace: /tmp/project']
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'Earlier context should stay in scope.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'user_after_compact', turnId: 'turn_2', threadId: 'thr_1', text: 'continue' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = sentBodies[0]
    const messages = body?.messages ?? []
    const systemMessages = messages.filter((message) => message.role === 'system')
    expect(systemMessages).toHaveLength(1)
    expect(String(messages[0]?.content)).toContain('Use office mode.')
    expect(String(messages[0]?.content)).toContain('Earlier context should stay in scope.')
    expect(JSON.stringify(messages)).not.toContain('reasoning_content')
    expect(JSON.stringify(messages)).not.toContain('"type":"thinking"')
  })

  it('omits reasoning controls for GLM models that do not support them', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; reasoning_effort?: unknown; thinking?: unknown }> = []
    const response = {
      id: 'glm-legacy-no-reasoning-controls',
      model: 'glm-4-plus',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-4-plus',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-4-plus'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I inspected the project.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = sentBodies[0]
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('thinking')
    expect(JSON.stringify(body?.messages ?? [])).not.toContain('reasoning_content')
  })

  it('uses the Responses API format when selected', async () => {
    const sentUrls: string[] = []
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      sentUrls.push(String(url))
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify({
        id: 'resp_1',
        status: 'completed',
        output_text: 'done',
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/api/v1/chat/completions',
      apiKey: 'k',
      model: 'gpt-5-mini',
      endpointFormat: 'responses',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.maxTokens = 128
    request.responseFormat = 'json_object'
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    expect(sentUrls[0]).toBe('https://example.com/api/v1/responses')
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-chat',
      max_output_tokens: 128,
      text: { format: { type: 'json_object' } }
    })
    expect(sentBodies[0]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: 'You are a helpful assistant.' })
    ]))
    expect(sentBodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'echo',
        parameters: expect.objectContaining({ type: 'object' })
      })
    ])
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'done' },
      expect.objectContaining({ kind: 'usage', usage: expect.objectContaining({ promptTokens: 2, completionTokens: 3 }) }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

  it('uses the Anthropic Messages API format when selected', async () => {
    const sentUrls: string[] = []
    const sentBodies: Array<Record<string, unknown>> = []
    const sentHeaders: Array<Record<string, string>> = []
    const fetchImpl: typeof fetch = async (url, init) => {
      sentUrls.push(String(url))
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      sentHeaders.push(init?.headers as Record<string, string>)
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://claude.example',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(sentUrls[0]).toBe('https://claude.example/v1/messages')
    expect(sentHeaders[0]).toMatchObject({
      Authorization: 'Bearer anthropic-key',
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01'
    })
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-chat',
      max_tokens: 4096,
      system: 'You are a helpful assistant.',
      messages: [],
      tools: [{
        name: 'echo',
        description: 'Echo a string back to the model.',
        input_schema: expect.objectContaining({ type: 'object' })
      }]
    })
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'hello' },
      expect.objectContaining({ kind: 'usage', usage: expect.objectContaining({ promptTokens: 4, completionTokens: 2 }) }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

  it('round-trips completed reasoning as Anthropic thinking blocks', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I need to preserve this thought for the next request.',
        status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      { type: 'thinking', thinking: 'I need to preserve this thought for the next request.' },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('round-trips Anthropic thinking signatures when present', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.reasoningEffort = 'high'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'I need to preserve this thought for the next request.',
          status: 'completed'
        }),
        signature: 'sig_opaque'
      },
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'I need to preserve this thought for the next request.',
        signature: 'sig_opaque'
      },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('preserves prior Anthropic thinking even when the next request omits reasoning effort', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'I need to preserve this thought for the next request.',
          status: 'completed'
        }),
        signature: 'sig_opaque'
      },
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'I need to preserve this thought for the next request.',
        signature: 'sig_opaque'
      },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('does not auto-send Anthropic thinking blocks to compatible messages providers', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimax.io/v1/messages',
      apiKey: 'anthropic-compatible-key',
      model: 'MiniMax-M1',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M1'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Provider-compatible history reasoning must not become a thinking content block.',
          status: 'completed'
        }),
        signature: 'sig_opaque'
      },
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      { type: 'text', text: 'Here is the answer.' }
    ])
    expect(JSON.stringify(sentBodies[0]?.messages ?? [])).not.toContain('"type":"thinking"')
  })

  it('does not infer Anthropic thinking support from Claude-named models on compatible messages providers', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://gateway.example/v1/messages',
      apiKey: 'anthropic-compatible-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.reasoningEffort = 'high'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Compatible gateways may use Claude model names without accepting thinking blocks.',
          status: 'completed'
        }),
        signature: 'sig_opaque'
      },
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    expect(JSON.stringify(sentBodies[0]?.messages ?? [])).not.toContain('"type":"thinking"')
  })

  it('does not synthesize Anthropic thinking for unrelated assistant text when preserving prior thinking', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text_0',
        turnId: 'turn_0',
        threadId: 'thr_1',
        text: 'Earlier answer without thinking.',
        status: 'completed'
      }),
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_1',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'I need to preserve this thought for the next request.',
          status: 'completed'
        }),
        signature: 'sig_opaque'
      },
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessages = sentBodies[0]?.messages?.filter((message) => message.role === 'assistant') ?? []

    expect(assistantMessages[0]?.content).toEqual([
      { type: 'text', text: 'Earlier answer without thinking.' }
    ])
    expect(assistantMessages[1]?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'I need to preserve this thought for the next request.',
        signature: 'sig_opaque'
      },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('does not send synthetic Anthropic thinking blocks for blank reasoning placeholders', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('streams Responses API text and function calls', async () => {
    const fetchImpl: typeof fetch = async () => new Response(sseStream([
      { type: 'response.output_text.delta', delta: 'hi' },
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_echo', name: 'echo', arguments: '' }
      },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"text":"ok"}' },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_echo', name: 'echo', arguments: '{"text":"ok"}' }
      },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{ type: 'function_call', call_id: 'call_echo', name: 'echo', arguments: '{"text":"ok"}' }],
          usage: { input_tokens: 3, output_tokens: 4 }
        }
      }
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com',
      apiKey: 'k',
      model: 'gpt-5-mini',
      endpointFormat: 'responses',
      fetchImpl
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(collectKinds(chunks)).toEqual([
      'assistant_text_delta',
      'tool_call_delta',
      'tool_call_complete',
      'usage',
      'completed'
    ])
    expect(chunks.find((chunk) => chunk.kind === 'tool_call_complete')).toMatchObject({
      callId: 'call_echo',
      toolName: 'echo',
      arguments: { text: 'ok' }
    })
  })

  it('streams Anthropic Messages API text and tool calls', async () => {
    const fetchImpl: typeof fetch = async () => new Response(sseStream([
      {
        type: 'message_start',
        message: { usage: { input_tokens: 5, output_tokens: 1 } }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' }
      },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'echo', input: {} }
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"text":"ok"}' }
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' }
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(collectKinds(chunks)).toEqual([
      'assistant_text_delta',
      'tool_call_delta',
      'tool_call_complete',
      'usage',
      'completed'
    ])
    expect(chunks.find((chunk) => chunk.kind === 'tool_call_complete')).toMatchObject({
      callId: 'toolu_1',
      toolName: 'echo',
      arguments: { text: 'ok' }
    })
    expect(chunks.find((chunk) => chunk.kind === 'usage')).toMatchObject({
      usage: expect.objectContaining({ promptTokens: 5, completionTokens: 8, totalTokens: 13 })
    })
  })

  it('captures Anthropic streaming thinking signatures', async () => {
    const fetchImpl: typeof fetch = async () => new Response(sseStream([
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'step one' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig_stream' }
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_stop' }
    ]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl
    })
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(chunks.filter((chunk) => chunk.kind === 'assistant_reasoning_delta')).toEqual([
      { kind: 'assistant_reasoning_delta', text: 'step one' },
      { kind: 'assistant_reasoning_delta', text: '', signature: 'sig_stream' }
    ])
  })

  it('captures Anthropic redacted thinking blocks for round trip', async () => {
    const response = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'redacted_thinking', data: 'encrypted_blob' },
        { type: 'text', text: 'answer' }
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const chunks: ModelStreamChunk[] = []

    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { kind: 'assistant_reasoning_delta', text: '', signature: 'redacted:encrypted_blob' },
      { kind: 'assistant_text_delta', text: 'answer' },
      expect.objectContaining({ kind: 'usage' }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

  it('does not inject body.thinking on non-DeepSeek host (issue #26)', async () => {
    const response = {
      id: 'r3',
      model: 'deepseek-chat',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://openrouter.ai/api/v1',   // NOT api.deepseek.com
      apiKey: 'k',
      model: 'deepseek-v4-pro',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    // The DeepSeek-specific `thinking` protocol extension must not be sent
    // to third-party OpenAI-compat providers — they may reject it. See issue #26.
    expect(sentBodies[0]).not.toHaveProperty('thinking')
  })

  it('injects body.thinking on the official DeepSeek host (issue #26 regression guard)', async () => {
    const response = {
      id: 'r4',
      model: 'deepseek-chat',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-v4-pro',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    // On the official host, the `thinking` field must still be set for v4 models.
    expect(sentBodies[0]).toHaveProperty('thinking')
    expect((sentBodies[0] as { thinking: { type: string } }).thinking).toMatchObject({ type: 'enabled' })
  })

  it('sends per-request router controls when requested', async () => {
    const response = {
      id: 'router',
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '{"model":"deepseek-v4-pro","thinking":"max"}'
          }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const sentAccept: string[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      sentAccept.push(String((init?.headers as Record<string, string>).Accept ?? ''))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-flash'
    request.tools = []
    request.stream = false
    request.maxTokens = 96
    request.temperature = 0
    request.responseFormat = 'json_object'
    request.reasoningEffort = 'off'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentAccept[0]).toBe('application/json')
    expect(sentBodies[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      stream: false,
      max_tokens: 96,
      temperature: 0,
      response_format: { type: 'json_object' }
    })
    expect(sentBodies[0]).not.toHaveProperty('thinking')
  })

  it('uses MiniMax thinking schema when reasoning is enabled', async () => {
    const response = {
      id: 'minimax',
      model: 'MiniMax-M1',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'k',
      model: 'MiniMax-M1',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M1'
    request.reasoningEffort = 'high'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.reasoning_effort).toBe('high')
    expect(sentBodies[0]?.thinking).toEqual({ type: 'adaptive' })
  })

  it('enables MiniMax M3 official reasoning/tool-call split mode', async () => {
    const response = {
      id: 'minimax-m3',
      model: 'MiniMax-M3',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    expect(sentBodies[0]?.reasoning_split).toBe(true)
  })

  it('enables MiniMax M3 compatibility mode behind local vLLM', async () => {
    const response = {
      id: 'local-minimax-m3',
      model: 'MiniMax-M3',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
    }
    const sentBodies: Array<{ reasoning_split?: unknown; messages?: Array<Record<string, unknown>> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'http://127.0.0.1:8000/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => Array.isArray(message.tool_calls))
    expect(sentBodies[0]?.reasoning_split).toBe(true)
    expect(assistantMessage?.content).toBe('\u200b')
  })

  it('uses MiniMax disabled thinking schema when reasoning is disabled', async () => {
    const response = {
      id: 'minimax-off',
      model: 'MiniMax-M1',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: 'k',
      model: 'MiniMax-M1',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M1'
    request.reasoningEffort = 'off'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]).not.toHaveProperty('reasoning_effort')
    expect(sentBodies[0]?.thinking).toEqual({ type: 'disabled' })
  })

  it('requests usage in streaming responses', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })

    for await (const _chunk of client.stream(buildRequest(new AbortController().signal))) {
      // drain
    }

    expect(sentBodies[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true }
    })
  })

  it('keeps requiredToolName as loop metadata instead of sending provider tool_choice', async () => {
    const response = {
      id: 'required-tool-metadata',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.requiredToolName = 'echo'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]).toHaveProperty('tools')
    expect(sentBodies[0]).not.toHaveProperty('tool_choice')
  })

  it('passes the request abort signal to fetch', async () => {
    const controller = new AbortController()
    let seenSignal: AbortSignal | undefined
    const fetchImpl: typeof fetch = async (_url, init) => {
      seenSignal = init?.signal as AbortSignal | undefined
      return new Response(JSON.stringify({
        id: 'signal',
        model: 'deepseek-chat',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'done' } }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    for await (const _chunk of client.stream(buildRequest(controller.signal))) {
      // drain
    }
    expect(seenSignal).toBe(controller.signal)
  })

  it('strips DeepSeek thinking payload for Azure OpenAI-compatible endpoints', async () => {
    const response = {
      id: 'azure',
      model: 'gpt-4.1',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ]
    }
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.openai.azure.com/openai/deployments/demo',
      apiKey: 'k',
      model: 'gpt-4.1',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'gpt-4.1'
    request.reasoningEffort = 'high'
    for await (const _chunk of client.stream(request)) {
      // drain
    }
    expect(sentBodies[0]?.reasoning_effort).toBe('high')
    expect(sentBodies[0]).not.toHaveProperty('thinking')
  })

  it('parses a non-streaming JSON response into chunks', async () => {
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: 'I will run the tool.',
            reasoning_content: 'I should call echo.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'echo',
                  arguments: JSON.stringify({ text: 'hi' })
                }
              }
            ]
          }
        }
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
        total_tokens: 60,
        prompt_tokens_details: { cached_tokens: 30 }
      }
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const textChunk = chunks.find((c) => c.kind === 'assistant_text_delta')
    const reasoningChunk = chunks.find((c) => c.kind === 'assistant_reasoning_delta')
    const callChunk = chunks.find((c) => c.kind === 'tool_call_complete')
    const usageChunk = chunks.find((c) => c.kind === 'usage')
    const completionChunk = chunks.find((c) => c.kind === 'completed')
    expect(textChunk && textChunk.kind === 'assistant_text_delta' ? textChunk.text : '').toBe(
      'I will run the tool.'
    )
    expect(
      reasoningChunk && reasoningChunk.kind === 'assistant_reasoning_delta' ? reasoningChunk.text : ''
    ).toBe('I should call echo.')
    expect(
      callChunk && callChunk.kind === 'tool_call_complete' ? callChunk.arguments : {}
    ).toEqual({ text: 'hi' })
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitTokens : 0).toBe(30)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costUsd : 0).toBeGreaterThan(0)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costCny : 0).toBeGreaterThan(0)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheSavingsUsd : 0).toBeGreaterThan(0)
    expect(
      completionChunk && completionChunk.kind === 'completed' ? completionChunk.stopReason : ''
    ).toBe('tool_calls')
  })

  it('repairs fenced non-streaming tool arguments', async () => {
    const response = {
      id: 'repair',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_repair',
                type: 'function',
                function: {
                  name: 'echo',
                  arguments: '```json\n{"text":"repaired"}\n```'
                }
              }
            ]
          }
        }
      ]
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const callChunk = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(callChunk && callChunk.kind === 'tool_call_complete' ? callChunk.arguments : {})
      .toEqual({ text: 'repaired' })
  })

  it('prefers DeepSeek native prompt cache hit and miss counters', async () => {
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 10,
        total_tokens: 1010,
        prompt_cache_hit_tokens: 930,
        prompt_cache_miss_tokens: 70,
        prompt_tokens_details: { cached_tokens: 123 }
      }
    }
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const usageChunk = chunks.find((c) => c.kind === 'usage')
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitTokens : 0).toBe(930)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheMissTokens : 0).toBe(70)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.cacheHitRate : 0).toBeCloseTo(0.93)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costUsd : 0).toBeCloseTo(0.000015204)
    expect(usageChunk && usageChunk.kind === 'usage' ? usageChunk.usage.costCny : 0).toBeCloseTo(0.0001086)
  })

  it('sends tools in a canonical order for a stable cache prefix', async () => {
    const sentBodies: Array<{ tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.tools = [
      { name: 'zeta', description: 'z', inputSchema: { required: ['b'], properties: { b: { type: 'string' }, a: { type: 'number' } }, type: 'object' } },
      { name: 'alpha', description: 'a', inputSchema: { type: 'object', properties: { z: { type: 'string' }, a: { type: 'string' } } } }
    ]
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const sentBody = sentBodies[0]
    expect(sentBody?.tools?.map((tool) => tool.function?.name)).toEqual(['alpha', 'zeta'])
    expect(Object.keys((sentBody?.tools?.[1]?.function?.parameters as { properties?: Record<string, unknown> }).properties ?? {})).toEqual(['a', 'b'])
  })

  it('heals incomplete tool-call pairs before sending history upstream', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolResultItem({
        id: 'orphan_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_orphan',
        toolName: 'echo',
        output: 'orphan'
      }),
      makeToolCallItem({
        id: 'missing_result_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_missing',
        toolName: 'echo',
        arguments: { text: 'missing' }
      }),
      makeUserItem({ id: 'user_after_missing', turnId: 'turn_1', threadId: 'thr_1', text: 'continue' }),
      makeToolCallItem({
        id: 'valid_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_ok',
        toolName: 'echo',
        arguments: { text: 'ok' }
      }),
      makeToolResultItem({
        id: 'valid_result',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_ok',
        toolName: 'echo',
        output: 'ok'
      })
    ]
    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages.some((message) => message.tool_call_id === 'call_orphan')).toBe(false)
    expect(JSON.stringify(messages)).not.toContain('call_missing')
    expect(messages.some((message) => message.role === 'user' && message.content === 'continue')).toBe(true)
    expect(
      messages.some((message) =>
        Array.isArray(message.tool_calls) &&
        message.tool_calls.some((call: { id?: string }) => call.id === 'call_ok')
      )
    ).toBe(true)
    expect(messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_ok')).toBe(true)
  })

  it('groups completed multi-tool blocks into one assistant tool_calls message', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolCallItem({
        id: 'call_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        arguments: { text: 'b' }
      }),
      makeAssistantTextItem({
        id: 'assistant_bridge',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will run both checks.',
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      }),
      makeToolResultItem({
        id: 'result_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        output: 'b'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))
    const toolMessages = messages.filter((message) => message.role === 'tool')

    expect(assistantToolMessage).toMatchObject({
      role: 'assistant',
      content: 'I will run both checks.'
    })
    expect((assistantToolMessage?.tool_calls as Array<{ id?: string }> | undefined)?.map((call) => call.id))
      .toEqual(['call_a', 'call_b'])
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_a', 'call_b'])
  })

  it('preserves thinking reasoning_content for completed tool-call blocks', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolCallItem({
        id: 'call_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        arguments: { text: 'b' }
      }),
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_bridge',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I need to inspect the current changes before writing the commit message.',
        status: 'completed'
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      }),
      makeToolResultItem({
        id: 'result_b',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_b',
        toolName: 'echo',
        output: 'b'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))

    expect(assistantToolMessage?.reasoning_content).toBe(
      'I need to inspect the current changes before writing the commit message.'
    )
    // Tool-call-only assistant messages omit the content key entirely for
    // chat_completions (strict providers reject empty content, and a visible
    // placeholder would pollute the conversation the model sees).
    expect(!('content' in (assistantToolMessage ?? {}))).toBe(true)
    expect((assistantToolMessage?.tool_calls as Array<{ id?: string }> | undefined)?.map((call) => call.id))
      .toEqual(['call_a', 'call_b'])
    expect(messages.filter((message) => message.role === 'tool').map((message) => message.tool_call_id))
      .toEqual(['call_a', 'call_b'])
  })

  it('uses a single space for empty thinking reasoning_content', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_2',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantTextMessage = messages.find((message) => message.role === 'assistant' && message.content === 'Done.')
    const assistantToolMessage = messages.find((message) => Array.isArray(message.tool_calls))

    expect(assistantTextMessage?.reasoning_content).toBe(' ')
    expect(assistantToolMessage?.reasoning_content).toBe(' ')
    // Tool-call-only assistant: content key omitted entirely.
    expect(!('content' in (assistantToolMessage ?? {}))).toBe(true)
  })

  it('treats fixed DeepSeek v4 models as thinking producers without content-block thinking in chat completions', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; thinking?: unknown; reasoning_effort?: unknown }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const body = sentBodies[0]
    const assistantMessage = body?.messages?.find((message) => message.role === 'assistant')

    expect(body?.thinking).toEqual({ type: 'enabled' })
    expect(body?.reasoning_effort).toBeUndefined()
    expect(assistantMessage?.content).toBe('Done.')
    expect(assistantMessage?.reasoning_content).toBe(' ')
    expect(JSON.stringify(body?.messages ?? [])).not.toContain('"type":"thinking"')
  })

  it('round-trips blank DeepSeek v4 thinking placeholders as chat-completions reasoning_content', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; thinking?: unknown }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-v4-pro',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(sentBodies[0]?.thinking).toEqual({ type: 'enabled' })
    expect(assistantMessage?.content).toBe('Done.')
    expect(assistantMessage?.reasoning_content).toBe(' ')
    expect(JSON.stringify(sentBodies[0]?.messages ?? [])).not.toContain('"type":"thinking"')
  })

  it('round-trips signed DeepSeek v4 thinking in chat-completions reasoning_content', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>>; thinking?: unknown }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'k',
      model: 'deepseek-chat',
      endpointFormat: 'chat_completions',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-flash'
    request.reasoningEffort = 'high'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_before_call',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Need to inspect the uploaded archive first.',
          status: 'completed'
        }),
        signature: 'sig_deepseek_v4'
      },
      makeAssistantTextItem({
        id: 'assistant_text_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will inspect the archive.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'inspect archive' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'archive contents'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(sentBodies[0]?.thinking).toEqual({ type: 'enabled' })
    expect(assistantMessage?.content).toBe('I will inspect the archive.')
    expect(assistantMessage?.reasoning_content).toBe('Need to inspect the uploaded archive first.')
    expect(assistantMessage?.reasoning_signature).toBe('sig_deepseek_v4')
    expect((assistantMessage?.tool_calls as Array<{ id?: string }> | undefined)?.map((call) => call.id))
      .toEqual(['call_a'])
  })

  it('round-trips official DeepSeek thinking on Anthropic-compatible endpoints', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-pro',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.history = [
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I need to preserve this thought for the next request.',
        status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      { type: 'thinking', thinking: 'I need to preserve this thought for the next request.' },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('round-trips blank official DeepSeek thinking placeholders on Anthropic-compatible endpoints', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'deepseek-key',
      model: 'deepseek-v4-pro',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_text_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Here is the answer.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'Here is the answer.' }
    ])
  })

  it('preserves thinking reasoning_content that appears before tool calls', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantReasoningItem({
        id: 'assistant_reasoning_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I should inspect git status before answering.',
        status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'assistant_text_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will inspect the changes.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantToolMessage = sentBodies[0]?.messages?.find((message) => Array.isArray(message.tool_calls))
    const assistantMessages = sentBodies[0]?.messages?.filter((message) => message.role === 'assistant') ?? []

    expect(assistantMessages).toHaveLength(1)
    expect(assistantToolMessage?.content).toBe('I will inspect the changes.')
    expect(assistantToolMessage?.reasoning_content).toBe('I should inspect git status before answering.')
  })

  it('serializes signed Anthropic thinking before tool-use blocks', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-4-5',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-sonnet-4-5'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_before_call',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'I should inspect git status before answering.',
          status: 'completed'
        }),
        signature: 'sig_tool'
      },
      makeAssistantTextItem({
        id: 'assistant_text_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will inspect the changes.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'I should inspect git status before answering.',
        signature: 'sig_tool'
      },
      { type: 'text', text: 'I will inspect the changes.' },
      {
        type: 'tool_use',
        id: 'call_a',
        name: 'echo',
        input: { text: 'a' }
      }
    ])
  })

  it('round-trips signed Anthropic thinking even when thinking text is omitted', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-opus-4-7',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-opus-4-7'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_before_call',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: '',
          status: 'completed'
        }),
        signature: 'sig_omitted'
      },
      makeAssistantTextItem({
        id: 'assistant_text_before_call',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will inspect the changes.',
        status: 'completed'
      }),
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      {
        type: 'thinking',
        thinking: '',
        signature: 'sig_omitted'
      },
      { type: 'text', text: 'I will inspect the changes.' },
      {
        type: 'tool_use',
        id: 'call_a',
        name: 'echo',
        input: { text: 'a' }
      }
    ])
  })

  it('serializes signed Anthropic thinking before tool-use blocks when no assistant text was emitted', async () => {
    const sentBodies: Array<{ messages?: Array<{ role?: string; content?: unknown }> }> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'next' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 4, output_tokens: 2 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      model: 'claude-opus-4-7',
      endpointFormat: 'messages',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'claude-opus-4-7'
    request.history = [
      {
        ...makeAssistantReasoningItem({
          id: 'assistant_reasoning_before_call',
          turnId: 'turn_1',
          threadId: 'thr_1',
          text: 'Need to inspect the uploaded archive first.',
          status: 'completed'
        }),
        signature: 'sig_tool_only'
      },
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'inspect archive' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'archive contents'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const assistantMessage = sentBodies[0]?.messages?.find((message) => message.role === 'assistant')

    expect(assistantMessage?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'Need to inspect the uploaded archive first.',
        signature: 'sig_tool_only'
      },
      {
        type: 'tool_use',
        id: 'call_a',
        name: 'echo',
        input: { text: 'inspect archive' }
      }
    ])
  })

  it('coerces empty tool outputs to a single space on chat_completions endpoints', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: undefined
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantMessage = messages.find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls))
    const toolMessage = messages.find((message) => message.role === 'tool')

    // Strict providers (e.g. MiniMax error 2013 "chat content is empty") reject
    // empty content. The tool-call-only assistant message omits the content key
    // entirely (a visible placeholder would pollute the conversation), and the
    // empty tool result gets an unambiguous placeholder string.
    expect(!('content' in (assistantMessage ?? {}))).toBe(true)
    expect(toolMessage?.content).toBe('\u200b')
  })

  it('MiniMax coerces empty tool-call assistant content to a placeholder', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'MiniMax-M3',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimax.chat/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeToolCallItem({
        id: 'call_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        arguments: { text: 'a' }
      }),
      makeToolResultItem({
        id: 'result_a',
        turnId: 'turn_1',
        threadId: 'thr_1',
        callId: 'call_a',
        toolName: 'echo',
        output: 'a'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    const assistantMessage = messages.find((message) => message.role === 'assistant' && Array.isArray(message.tool_calls))
    // MiniMax rejects a missing/empty content field (error 2013); we supply a
    // non-empty invisible placeholder instead of a visible token the model can
    // echo back into the transcript.
    expect(assistantMessage?.content).toBe('\u200b')
  })

  it('MiniMax injects a user message when the request has only system messages', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'MiniMax-M3',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl,
      nonStreaming: true
    })
    // A request with no history — only the system prompt — simulates the
    // post-compaction state where everything folded into system messages.
    const request = buildRequest(new AbortController().signal)
    request.history = []

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    // MiniMax rejects a request with only system messages ("chat content is
    // empty"); the synthetic user message must also carry a clear resumption
    // instruction so post-compaction turns do not ask the user what to do.
    const user = messages.find((message) => message.role === 'user')
    expect(user?.content).toContain('Continue the active task')
    expect(user?.content).toContain('Do not ask the user what to do')
  })

  it('GLM injects a leading user message when the first conversational message is assistant (1214)', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'glm-4.6',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
      apiKey: 'k',
      model: 'glm-4.6',
      fetchImpl,
      nonStreaming: true
    })
    // Post-compaction: a system summary followed by an assistant turn with no
    // preceding user message — Zhipu GLM rejects this (error 1214).
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.history = [
      makeAssistantTextItem({
        id: 'assistant_first',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'I will help with that.',
        status: 'completed'
      })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    // After normalization there must be a user message before the first
    // assistant message so GLM accepts the conversation.
    const firstNonSystem = messages.find((message) => message.role !== 'system')
    expect(firstNonSystem?.role).toBe('user')
    expect(String(firstNonSystem?.content)).toContain('Continue the active task')
    expect(String(firstNonSystem?.content)).toContain('Do not ask the user what to do')
    expect(messages.some((message) => message.role === 'assistant')).toBe(true)
  })

  it('sends compaction summaries as mutable system messages', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'User wants the login feature finished. Keep the auth files in scope.',
        replacedTokens: 123,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'user_after_compact', turnId: 'turn_2', threadId: 'thr_1', text: 'continue' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(messages[0]).toMatchObject({ role: 'system', content: 'You are a helpful assistant.' })
    expect(messages[1]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('User wants the login feature finished')
    })
    expect(messages[2]).toMatchObject({ role: 'user', content: 'continue' })
  })

  it('preserves the latest compaction summary when applying history limits', async () => {
    const sentBodies: Array<{ messages?: Array<Record<string, unknown>> }> = []
    const response = {
      id: 'r1',
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'done' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      nonStreaming: true,
      historyLimit: 2
    })
    const request = buildRequest(new AbortController().signal)
    request.history = [
      makeCompactionItem({
        id: 'compact_1',
        turnId: 'turn_1',
        threadId: 'thr_1',
        summary: 'Keep original requirement beta.',
        replacedTokens: 50,
        pinnedConstraints: []
      }),
      makeUserItem({ id: 'old_1', turnId: 'turn_2', threadId: 'thr_1', text: 'old detail one' }),
      makeUserItem({ id: 'old_2', turnId: 'turn_3', threadId: 'thr_1', text: 'old detail two' }),
      makeUserItem({ id: 'latest', turnId: 'turn_4', threadId: 'thr_1', text: 'latest question' })
    ]

    for await (const _chunk of client.stream(request)) {
      // drain
    }

    const messages = sentBodies[0]?.messages ?? []
    expect(JSON.stringify(messages)).toContain('Keep original requirement beta')
    expect(JSON.stringify(messages)).not.toContain('old detail two')
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: 'latest question' })
  })

  it('reports an error when the HTTP response is not OK', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('upstream failure', { status: 500 })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    expect(chunks[0].kind).toBe('error')
  })

  it('parses streamed SSE events with tool call deltas', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hi\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }
    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(text).toBe('Hello world')
    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.callId : '').toBe('call_1')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.arguments : {}).toEqual({ text: 'hi' })
    expect(chunks.find((c) => c.kind === 'usage')).toBeDefined()
  })

  it('does not emit official MiniMax tool-call protocol content as assistant text while streaming tool calls', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"echo","arguments":"{\\"score\\":"}}],"content":"(tool call)]score\\"|\\"bias\\"|\\"name\\""}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"80}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl
    })

    const chunks = []
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(text).toBe('')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.arguments : {}).toEqual({ score: 80 })
    expect(chunks.find((c) => c.kind === 'completed')).toMatchObject({ stopReason: 'tool_calls' })
  })

  it('converts official MiniMax inline JSON tool-call text into a real tool call', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"(tool call bash: {\\"action\\":\\"run\\",\\"command\\":\\"cat /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/generate_radar_chart.md && echo === && cat /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/generate_bar_chart.md\\"}) name=\\"bash\\">"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl
    })

    const chunks = []
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(text).toBe('')
    expect(complete).toMatchObject({
      kind: 'tool_call_complete',
      toolName: 'bash',
      arguments: {
        action: 'run',
        command: expect.stringContaining('generate_radar_chart.md')
      }
    })
    expect(chunks.find((c) => c.kind === 'completed')).toMatchObject({ stopReason: 'tool_calls' })
  })

  it('converts official MiniMax inline action-tag tool-call text into a real tool call', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"(tool call ] <action>run][</action>]ls /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/ | sort]"}}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl
    })

    const chunks = []
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(false)
    expect(complete).toMatchObject({
      kind: 'tool_call_complete',
      toolName: 'bash',
      arguments: {
        action: 'run',
        command: 'ls /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/ | sort'
      }
    })
    expect(chunks.find((c) => c.kind === 'completed')).toMatchObject({ stopReason: 'tool_calls' })
  })

  it('converts official MiniMax inline invoke-command text into a real tool call', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"(tool call)[<invoke name=\\"bash\\">][<command>ls /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/ | sort</command>][</invoke>]"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl
    })

    const chunks = []
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(chunks.some((c) => c.kind === 'assistant_text_delta')).toBe(false)
    expect(complete).toMatchObject({
      kind: 'tool_call_complete',
      toolName: 'bash',
      arguments: {
        action: 'run',
        command: 'ls /Users/libing/.qiongqi/skills/builtin/finance/chart-visualization/references/ | sort'
      }
    })
    expect(chunks.find((c) => c.kind === 'completed')).toMatchObject({ stopReason: 'tool_calls' })
  })

  it('does not mistake MiniMax parameter names for tool names when parsing inline tool calls', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"(tool call)[<parameter name=\\"command\\">pwd]"}}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'k',
      model: 'MiniMax-M3',
      fetchImpl
    })

    const chunks = []
    const request = buildRequest(new AbortController().signal)
    request.model = 'MiniMax-M3'
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    expect(chunks.find((c) => c.kind === 'tool_call_complete')).toMatchObject({
      kind: 'tool_call_complete',
      toolName: 'bash',
      arguments: { command: 'pwd' }
    })
  })

  it('keeps reading streamed usage sent after finish_reason', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    const usage = chunks.find((c) => c.kind === 'usage')
    const completed = chunks.find((c) => c.kind === 'completed')
    expect(usage && usage.kind === 'usage' ? usage.usage.totalTokens : 0).toBe(10)
    expect(completed && completed.kind === 'completed' ? completed.stopReason : '').toBe('stop')
  })

  it('retries without stream usage options when a provider rejects them', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const encoder = new TextEncoder()
    const retryBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"retried"}}]}\n\n'))
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n'
          )
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (sentBodies.length === 1) {
        return new Response('unknown field stream_options.include_usage', { status: 400 })
      }
      return new Response(retryBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    const usage = chunks.find((c) => c.kind === 'usage')
    expect(sentBodies).toHaveLength(2)
    expect(sentBodies[0]).toHaveProperty('stream_options')
    expect(sentBodies[1]).not.toHaveProperty('stream_options')
    expect(text).toBe('retried')
    expect(usage && usage.kind === 'usage' ? usage.usage.totalTokens : 0).toBe(7)
  })

  it('retries without reasoning controls when Zhipu reports generic 1214 messages errors', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const encoder = new TextEncoder()
    const retryBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'))
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n'
          )
        )
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (sentBodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { code: '1214', message: 'messages 参数非法。请检查文档。' } }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(retryBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      fetchImpl
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    request.reasoningEffort = 'high'
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(sentBodies).toHaveLength(2)
    expect(sentBodies[0]).toHaveProperty('reasoning_effort')
    expect(sentBodies[0]).toHaveProperty('thinking')
    expect(sentBodies[1]).not.toHaveProperty('reasoning_effort')
    expect(sentBodies[1]).not.toHaveProperty('thinking')
    expect(text).toBe('ok')
  })

  it('retries generic Zhipu 1214 messages errors without stream usage metadata', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (sentBodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { code: '1214', message: 'messages 参数非法。请检查文档。' } }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response(sseStream([
        { choices: [{ delta: { content: 'retried' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
        '[DONE]'
      ]), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      model: 'glm-5.2',
      fetchImpl
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'glm-5.2'
    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => c.kind === 'assistant_text_delta')
      .map((c) => (c as { text: string }).text)
      .join('')
    expect(sentBodies).toHaveLength(2)
    expect(sentBodies[0]).toHaveProperty('stream_options')
    expect(sentBodies[1]).not.toHaveProperty('stream_options')
    expect(text).toBe('retried')
  })

  it('retries without message reasoning_content when an OpenAI-compatible provider rejects it', async () => {
    const sentBodies: Array<Record<string, unknown>> = []
    const response = {
      id: 'compat-retry-no-reasoning-content',
      model: 'deepseek-v4-pro',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok' }
        }
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }
    const fetchImpl: typeof fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (sentBodies.length === 1) {
        return new Response('reasoning_content is not allowed', { status: 400 })
      }
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'k',
      model: 'deepseek-v4-pro',
      fetchImpl,
      nonStreaming: true
    })
    const request = buildRequest(new AbortController().signal)
    request.model = 'deepseek-v4-pro'
    request.reasoningEffort = 'high'
    request.history = [
      makeAssistantReasoningItem({
        id: 'assistant_reasoning',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Think before answering.',
        status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'assistant_text',
        turnId: 'turn_1',
        threadId: 'thr_1',
        text: 'Done.',
        status: 'completed'
      })
    ]

    const chunks: ModelStreamChunk[] = []
    for await (const chunk of client.stream(request)) {
      chunks.push(chunk)
    }

    expect(sentBodies).toHaveLength(2)
    expect(sentBodies[0]).toHaveProperty('reasoning_effort')
    expect(JSON.stringify(sentBodies[0]?.messages ?? [])).toContain('reasoning_content')
    expect(sentBodies[1]).not.toHaveProperty('reasoning_effort')
    expect(sentBodies[1]).not.toHaveProperty('thinking')
    expect(JSON.stringify(sentBodies[1]?.messages ?? [])).not.toContain('reasoning_content')
    expect(chunks).toEqual([
      { kind: 'assistant_text_delta', text: 'ok' },
      expect.objectContaining({ kind: 'usage' }),
      { kind: 'completed', stopReason: 'stop' }
    ])
  })

  it('merges streamed tool-call deltas by index when the provider id arrives later', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_provider","function":{"arguments":"\\"late-id\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ]
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    const complete = chunks.find((c) => c.kind === 'tool_call_complete')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.callId : '').toBe('call_provider')
    expect(complete && complete.kind === 'tool_call_complete' ? complete.arguments : {}).toEqual({ text: 'late-id' })
  })

  it('fails a streamed response that goes idle without DONE', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      }
    })
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const client = new DeepseekCompatModelClient({
      baseUrl: 'https://example.com/beta',
      apiKey: 'k',
      model: 'deepseek-chat',
      fetchImpl,
      streamIdleTimeoutMs: 5
    })
    const chunks = []
    for await (const chunk of client.stream(buildRequest(new AbortController().signal))) {
      chunks.push(chunk)
    }

    expect(chunks.find((chunk) => chunk.kind === 'assistant_text_delta')).toMatchObject({
      text: 'partial'
    })
    expect(chunks.find((chunk) => chunk.kind === 'error')).toMatchObject({
      code: 'stream_idle_timeout'
    })
    expect(chunks.find((chunk) => chunk.kind === 'completed')).toBeUndefined()
  })
})
