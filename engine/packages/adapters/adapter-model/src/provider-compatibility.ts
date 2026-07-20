import type { ModelEndpointFormat } from '@qiongqi/contracts'
import { isDeepSeekHost } from './model-error-probe.js'

export type ProviderId =
  | 'deepseek'
  | 'minimax'
  | 'zai'
  | 'anthropic'
  | 'openai'
  | 'vllm'
  | 'generic'

export type ThinkingDialect = 'deepseek' | 'minimax' | 'zai' | 'anthropic' | 'none'
export type ToolCallProtocol = 'openai' | 'anthropic' | 'responses' | 'server-parser-required' | 'none'

export type ProviderCompatibilityProfile = {
  provider: ProviderId
  thinkingDialect: ThinkingDialect
  toolCallProtocol: ToolCallProtocol
  requestFlags: {
    deepseekThinking: boolean
    reasoningSplit: boolean
    zaiToolStream: boolean
  }
  foldToolHistory: boolean
  supportsReasoningEffort: boolean
  requiresAssistantContentForToolCalls: boolean
  requiresUserMessage: boolean
  requiresStrictAlternation: boolean
  warnings: string[]
}

export type CompatibilityInput = {
  baseUrl: string
  model?: string
  endpointFormat?: ModelEndpointFormat
  supportsToolCalling?: boolean
}

export function compatibilityProfileForModel(input: CompatibilityInput): ProviderCompatibilityProfile {
  const endpointFormat = input.endpointFormat ?? 'chat_completions'
  const model = input.model
  const provider = providerFor(input.baseUrl, model)
  const minimaxM3 = isMiniMaxM3Model(model) && (provider === 'minimax' || provider === 'vllm')
  const glmCoding = provider === 'zai' && isGlmCodingPlanModel(model)
  const glm = isGlmModel(model)
  const deepseekThinking = provider === 'deepseek' && isThinkingProducerModel(model)
  const vllmParserRequired = provider === 'vllm' && minimaxM3

  const profile: ProviderCompatibilityProfile = {
    provider,
    thinkingDialect: thinkingDialectForProvider(provider, endpointFormat, model),
    toolCallProtocol: toolCallProtocolFor(provider, endpointFormat, vllmParserRequired),
    requestFlags: {
      deepseekThinking,
      reasoningSplit: minimaxM3,
      zaiToolStream: glmCoding
    },
    foldToolHistory: glm,
    supportsReasoningEffort: provider !== 'zai' || !glm || glmCoding,
    requiresAssistantContentForToolCalls: provider === 'minimax' || minimaxM3,
    requiresUserMessage: provider === 'minimax' || minimaxM3,
    requiresStrictAlternation: provider === 'zai' || endpointFormat === 'messages',
    warnings: []
  }
  profile.warnings = modelCompatibilityWarnings(input)
  return profile
}

export function modelCompatibilityWarnings(input: CompatibilityInput): string[] {
  const provider = providerFor(input.baseUrl, input.model)
  const warnings: string[] = []
  if (
    provider === 'vllm' &&
    isMiniMaxM3Model(input.model) &&
    input.supportsToolCalling !== false
  ) {
    warnings.push(
      '仅当这个本地 OpenAI 兼容地址实际部署的是 MiniMax-M3 时，服务端必须使用 `--tool-call-parser minimax_m3 --reasoning-parser minimax_m3 --enable-auto-tool-choice --block-size 128`；官方 MiniMax-M3 API 不需要这些 vLLM 参数。'
    )
  }
  return warnings
}

export function providerFor(baseUrl: string, model: string | undefined): ProviderId {
  if (isDeepSeekHost(baseUrl)) return 'deepseek'
  if (isBigModelProvider(baseUrl)) return 'zai'
  if (isMiniMaxProvider(baseUrl, model)) {
    return isLocalOpenAiCompatibleHost(baseUrl) ? 'vllm' : 'minimax'
  }
  if (isAnthropicProvider(baseUrl)) return 'anthropic'
  if (isOpenAiProvider(baseUrl)) return 'openai'
  if (isLocalOpenAiCompatibleHost(baseUrl)) return 'vllm'

  // Model-name-based fallback: when the URL is a generic proxy/gateway
  // (e.g. OpenRouter, LiteLLM, local proxy), the model name is often the
  // only reliable signal of the underlying provider. This prevents the
  // engine from applying wrong compatibility flags.
  const modelHint = modelNameProviderHint(model)
  if (modelHint) return modelHint

  return 'generic'
}

/**
 * Deduce the provider from the model name when the endpoint URL is
 * generic (proxy/gateway/aggregator). Returns undefined when the model
 * name doesn't contain a recognisable provider prefix.
 *
 * Providers are only returned for model names that unambiguously
 * indicate a specific provider (e.g. "gpt-4o", "claude-sonnet-4-20250514",
 * "gemini-2.5-flash", "deepseek-chat", "glm-4-flash", "minimax-m3").
 * Ambiguous names (e.g. "my-fine-tune-v1") return undefined so the
 * caller falls through to `generic`.
 */
export function modelNameProviderHint(model: string | undefined): ProviderId | undefined {
  const normalized = normalizeModelId(model)
  if (!normalized) return undefined
  // DeepSeek is intentionally excluded here: its `thinking` flag depends on
  // the actual API host URL (api.deepseek.com), not just the model name.
  // A "deepseek-chat" model routed through a third-party proxy should not
  // receive DeepSeek-specific protocol extensions.
  if (/^gpt-|^o[0-9]+|^chatgpt|openai/i.test(normalized)) return 'openai'
  if (/^claude-|^anthropic/i.test(normalized)) return 'anthropic'
  if (/^gemini-|^palm-|^google/i.test(normalized)) return 'generic'
  if (/^glm-|^chatglm/i.test(normalized)) return 'zai'
  if (/^minimax/i.test(normalized)) return 'minimax'
  if (/^qwen|^qwq/i.test(normalized)) return 'generic'
  if (/^llama|^mistral|^mixtral|^codestral/i.test(normalized)) return 'generic'
  return undefined
}

export function normalizeModelId(model: string | undefined): string {
  return model?.trim().toLowerCase() ?? ''
}

export function isMiniMaxProvider(baseUrl: string, model: string | undefined): boolean {
  const normalizedModel = normalizeModelId(model)
  if (normalizedModel.includes('minimax')) return true
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host.includes('minimax') || host.includes('minimaxi')
  } catch {
    return /\bminimax\b|\bminimaxi\b/i.test(baseUrl)
  }
}

export function isMiniMaxM3Model(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  return normalized === 'minimax-m3' || normalized.startsWith('minimax-m3-')
}

export function isBigModelProvider(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'open.bigmodel.cn' || host === 'api.z.ai' || host.endsWith('.bigmodel.cn') || host.endsWith('.z.ai')
  } catch {
    return /\b(?:open\.bigmodel\.cn|api\.z\.ai)\b/i.test(baseUrl)
  }
}

export function isGlmCodingPlanModel(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  return normalized === 'glm-5.2' || normalized.startsWith('glm-5.2-') || normalized.startsWith('glm-5-')
}

export function isGlmModel(model: string | undefined): boolean {
  return normalizeModelId(model).startsWith('glm-')
}

export function isThinkingProducerModel(model: string | undefined): boolean {
  const normalized = normalizeModelId(model)
  if (!normalized) return false
  return normalized === 'deepseek-v4-pro' ||
    normalized === 'deepseek-v4-flash' ||
    normalized.includes('deepseek-reasoner') ||
    normalized.endsWith('/deepseek-v4-pro') ||
    normalized.endsWith('/deepseek-v4-flash')
}

export function isAnthropicProvider(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.anthropic.com' || host.endsWith('.anthropic.com')
  } catch {
    return /\banthropic\.com\b/i.test(baseUrl)
  }
}

function isOpenAiProvider(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.openai.com' || host.endsWith('.openai.com')
  } catch {
    return /\bopenai\.com\b/i.test(baseUrl)
  }
}

function isLocalOpenAiCompatibleHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local')
  } catch {
    return /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(baseUrl)
  }
}

function thinkingDialectForProvider(
  provider: ProviderId,
  endpointFormat: ModelEndpointFormat,
  model: string | undefined
): ThinkingDialect {
  if (provider === 'deepseek') return 'deepseek'
  if (provider === 'minimax' || (provider === 'vllm' && isMiniMaxProvider('', model))) return 'minimax'
  if (provider === 'zai') return 'zai'
  if (provider === 'anthropic' && endpointFormat === 'messages') return 'anthropic'
  return 'none'
}

function toolCallProtocolFor(
  provider: ProviderId,
  endpointFormat: ModelEndpointFormat,
  parserRequired: boolean
): ToolCallProtocol {
  if (parserRequired) return 'server-parser-required'
  if (endpointFormat === 'messages') return 'anthropic'
  if (endpointFormat === 'responses') return 'responses'
  if (provider === 'generic') return 'openai'
  return 'openai'
}
