import { describe, expect, it } from 'vitest'
import {
  compatibilityProfileForModel,
  modelCompatibilityWarnings
} from '@qiongqi/adapter-model'

describe('model provider compatibility profiles', () => {
  it('keeps DeepSeek official protocol as the native baseline', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      endpointFormat: 'chat_completions'
    })

    expect(profile.provider).toBe('deepseek')
    expect(profile.thinkingDialect).toBe('deepseek')
    expect(profile.toolCallProtocol).toBe('openai')
    expect(profile.requestFlags.deepseekThinking).toBe(true)
    expect(profile.requiresAssistantContentForToolCalls).toBe(false)
  })

  it('marks MiniMax M3 as requiring reasoning split and assistant content placeholders', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      endpointFormat: 'chat_completions'
    })

    expect(profile.provider).toBe('minimax')
    expect(profile.thinkingDialect).toBe('minimax')
    expect(profile.toolCallProtocol).toBe('openai')
    expect(profile.requestFlags.reasoningSplit).toBe(true)
    expect(profile.requiresAssistantContentForToolCalls).toBe(true)
  })

  it('does not show vLLM parser warnings for official MiniMax M3', () => {
    const warnings = modelCompatibilityWarnings({
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
      endpointFormat: 'chat_completions',
      supportsToolCalling: true
    })

    expect(warnings).toEqual([])
  })

  it('warns when local vLLM MiniMax M3 needs server-side tool parsers', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'MiniMax-M3',
      endpointFormat: 'chat_completions',
      supportsToolCalling: true
    })
    const warnings = modelCompatibilityWarnings({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'MiniMax-M3',
      endpointFormat: 'chat_completions',
      supportsToolCalling: true
    })

    expect(profile.provider).toBe('vllm')
    expect(profile.thinkingDialect).toBe('minimax')
    expect(profile.toolCallProtocol).toBe('server-parser-required')
    expect(profile.requestFlags.reasoningSplit).toBe(true)
    expect(warnings.join('\n')).toContain('--tool-call-parser minimax_m3')
    expect(warnings.join('\n')).toContain('--enable-auto-tool-choice')
  })

  it('does not show MiniMax parser warnings for local vLLM DeepSeek v4 flash', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'DeepSeek-v4-flash',
      endpointFormat: 'chat_completions',
      supportsToolCalling: true
    })
    const warnings = modelCompatibilityWarnings({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'DeepSeek-v4-flash',
      endpointFormat: 'chat_completions',
      supportsToolCalling: true
    })

    expect(profile.provider).toBe('vllm')
    expect(profile.requestFlags.reasoningSplit).toBe(false)
    expect(profile.toolCallProtocol).toBe('openai')
    expect(warnings).toEqual([])
  })

  it('does not apply MiniMax thinking dialect to unrelated local vLLM models', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'http://127.0.0.1:8000/v1',
      model: 'Qwen3-Coder',
      endpointFormat: 'chat_completions'
    })

    expect(profile.provider).toBe('vllm')
    expect(profile.thinkingDialect).toBe('none')
    expect(profile.requestFlags.reasoningSplit).toBe(false)
    expect(profile.toolCallProtocol).toBe('openai')
  })

  it('enables Z.ai/GLM tool stream and folds tool history', () => {
    const profile = compatibilityProfileForModel({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.2',
      endpointFormat: 'chat_completions'
    })

    expect(profile.provider).toBe('zai')
    expect(profile.thinkingDialect).toBe('zai')
    expect(profile.requestFlags.zaiToolStream).toBe(true)
    expect(profile.foldToolHistory).toBe(true)
  })
})
