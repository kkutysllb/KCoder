import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '@qiongqi/ports'
import type { TurnItem } from '@qiongqi/contracts'
import { emptyUsageSnapshot, type UsageSnapshot } from '@qiongqi/contracts'
import { isToolResultBridgeItem, repairModelHistoryItems } from '@qiongqi/domain'
import { repairToolArguments } from './tool-argument-repair.js'
import { sanitizeModelText } from './special-tokens.js'
import { InlineReasoningExtractor } from './inline-reasoning-extractor.js'
import { isDeepSeekHost, probeDeepSeekReachable } from './model-error-probe.js'
import {
  compatibilityProfileForModel,
  isBigModelProvider,
  isGlmCodingPlanModel,
  isThinkingProducerModel
} from './provider-compatibility.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  type ModelEndpointFormat
} from '@qiongqi/contracts'
import {
  defaultPricingProvider,
  type PricingProvider
} from './pricing/index.js'

/**
 * Configuration for the provider-agnostic model compatibility client.
 *
 * Chat completions remains the default, while custom providers can opt
 * into OpenAI Responses or Anthropic Messages request/response shapes.
 *
 * Stage 1.3 renamed this type from `DeepseekCompatConfig` — the client
 * works with any OpenAI-compatible endpoint, so the name now reflects
 * that generality. The old name is re-exported as an alias for
 * backward compatibility.
 */
export type ModelCompatConfig = {
  baseUrl: string
  apiKey: string
  model: string
  /** Compatible request/response protocol to use for custom providers. */
  endpointFormat?: ModelEndpointFormat
  /** Optional extra headers, e.g. project or session ids. */
  headers?: Record<string, string>
  /** HTTP fetch implementation. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
  /** Maximum number of messages to send. Defaults to the entire history. */
  historyLimit?: number
  /** When true, the client requests a non-streaming response. */
  nonStreaming?: boolean
  /** Maximum idle time between streaming chunks before the turn fails. */
  streamIdleTimeoutMs?: number
  /**
   * Pricing provider for cost and cache-savings estimation. When
   * omitted, the client uses the built-in default composite provider,
   * which includes DeepSeek pricing. Pass a custom
   * {@link PricingProvider} (or {@link CompositePricingProvider}) to
   * support additional model vendors.
   */
  pricingProvider?: PricingProvider
}

/**
 * Backward-compatibility alias. Prefer `ModelCompatConfig` in new code.
 *
 * @deprecated since stage 1.3 — use `ModelCompatConfig` instead.
 */
export type DeepseekCompatConfig = ModelCompatConfig

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ChatMessageContentPart[] | null
  name?: string
  tool_call_id?: string
  reasoning_content?: string
  reasoning_signature?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'thinking'; thinking: string; signature?: string }

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type AnthropicImageSource = Extract<AnthropicContentBlock, { type: 'image' }>['source']

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type ChatCompletionResponse = {
  id: string
  model: string
  choices: {
    index: number
    finish_reason: string
    message: ChatMessage & {
      tool_calls?: {
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_eval_count?: number
    eval_count?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

type ResponsesApiResponse = {
  id?: string
  status?: string
  output_text?: string
  output?: Array<Record<string, unknown>>
  usage?: Record<string, unknown>
  error?: { message?: string; type?: string } | null
  incomplete_details?: { reason?: string } | null
}

type AnthropicMessageResponse = {
  id?: string
  type?: string
  role?: string
  content?: Array<Record<string, unknown>>
  stop_reason?: string | null
  usage?: Record<string, unknown>
}

type ModelStopReason = Extract<ModelStreamChunk, { kind: 'completed' }>['stopReason']
type PendingToolCall = {
  index?: number
  name?: string
  arguments: string
}
type InlineToolCallState = {
  buffer: string
  nextId: number
}
type StreamReadResult =
  | { kind: 'chunk'; value?: Uint8Array; done: boolean }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 180_000
const DEFAULT_MESSAGES_MAX_TOKENS = 4096
const REDACTED_THINKING_SIGNATURE_PREFIX = 'redacted:'
const STRICT_PROVIDER_EMPTY_CONTENT_PLACEHOLDER = '\u200b'
const ACTIVE_TASK_CONTINUATION_MESSAGE = [
  'Continue the active task from the conversation summary and recent context above.',
  'Use the latest unresolved next action as your immediate next step.',
  'Do not ask the user what to do unless the summary explicitly says user input is required or the task is blocked.'
].join(' ')

/**
 * Provider-agnostic model compatibility client.
 *
 * This adapter focuses on the streaming chat completions shape used
 * by OpenAI-compatible providers (DeepSeek, OpenAI, vLLM, etc.). It
 * supports tool calls, cache hit/miss counters (when the provider
 * reports them), and abort-signal cancellation. The client is
 * deliberately small so the rest of the runtime can be built around
 * the `ModelClient` port.
 *
 * Renamed from `DeepseekCompatModelClient` in stage 1.3 — the client
 * works with any OpenAI-compatible endpoint, so the name now reflects
 * that generality. The old name is re-exported as an alias for
 * backward compatibility.
 */
export class ModelCompatClient implements ModelClient {
  readonly provider = 'deepseek-compat'
  readonly model: string

  private readonly config: ModelCompatConfig
  private readonly fetchImpl: typeof fetch
  private readonly pricingProvider: PricingProvider

  constructor(config: ModelCompatConfig) {
    this.config = config
    this.model = config.model
    this.fetchImpl = config.fetchImpl ?? fetch
    this.pricingProvider = config.pricingProvider ?? defaultPricingProvider
  }

  /**
   * Streams the model response for a turn. Each yielded chunk is one
   * of the kinds defined by `ModelStreamChunk`. The stream respects
   * the request's `abortSignal` between chunks.
   */
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
    const endpointFormat = this.endpointFormat()
    const stream = request.stream ?? !this.config.nonStreaming
    const body = this.buildRequestBody(request, stream)
    const requestModel = typeof body.model === 'string' ? body.model : request.model?.trim() || this.config.model
    const url = buildModelEndpointUrl(this.config.baseUrl, endpointFormat, requestModel)
    const headers = this.buildHeaders(stream, endpointFormat)
    const result = await this.postChatCompletion(url, headers, body, request.abortSignal, endpointFormat)
    if (result.kind === 'error') {
      yield { kind: 'error', message: result.message }
      return
    }
    let response = result.response
    if (!response.ok) {
      let retryBody = body
      let stripStreamUsage = false
      let stripReasoning = false
      let finalErrorText = ''
      // Retry on 400/422 for both chat_completions and messages (Anthropic)
      // formats. The messages path was previously excluded, so GLM/MiniMax
      // on the Anthropic-compatible endpoint got zero retry on 400/1214.
      while (endpointFormat === 'chat_completions' || endpointFormat === 'messages') {
        let text: string
        if (stripStreamUsage || stripReasoning) {
          const retry = await this.postChatCompletion(url, headers, retryBody, request.abortSignal, endpointFormat)
          if (retry.kind === 'error') {
            yield { kind: 'error', message: retry.message }
            return
          }
          response = retry.response
          if (response.ok) break
          text = await response.text()
        } else {
          text = await response.text()
        }
        finalErrorText = text
        if (
          !stripStreamUsage &&
          shouldRetryWithoutStreamUsage(response.status, text, retryBody)
        ) {
          stripStreamUsage = true
          retryBody = this.buildRequestBody(request, stream, {
            includeStreamUsage: false,
            ...(stripReasoning ? { includeReasoning: false } : {})
          })
          continue
        }
        if (
          !stripReasoning &&
          shouldRetryWithoutReasoningFields(response.status, text, retryBody)
        ) {
          stripReasoning = true
          retryBody = this.buildRequestBody(request, stream, {
            ...(stripStreamUsage ? { includeStreamUsage: false } : {}),
            includeReasoning: false
          })
          continue
        }
        const retryClassified = await this.classifyHttpError(response.status, text)
        diagnoseRejectedRequest(url, retryBody, response.status, text)
        yield {
          kind: 'error',
          message: retryClassified.message,
          code: retryClassified.code
        }
        return
      }
      if (!response.ok) {
        if (!finalErrorText) {
          finalErrorText = await response.text()
        }
        diagnoseRejectedRequest(url, retryBody, response.status, finalErrorText)
        const classified = await this.classifyHttpError(response.status, finalErrorText)
        yield {
          kind: 'error',
          message: classified.message,
          code: classified.code
        }
        return
      }
    }
    if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
      const json = (await response.json()) as ChatCompletionResponse
      yield* this.materializeNonStreaming(json, endpointFormat)
      return
    }
    if (!response.body) {
      yield { kind: 'error', message: 'model response had no body' }
      return
    }
    yield* this.streamSse(response.body, request.abortSignal, endpointFormat)
  }

  private endpointFormat(): ModelEndpointFormat {
    return normalizeModelEndpointFormat(this.config.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT)
  }

  private async postChatCompletion(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal,
    endpointFormat: ModelEndpointFormat
  ): Promise<{ kind: 'response'; response: Response } | { kind: 'error'; message: string }> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
      })
      return { kind: 'response', response }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        kind: 'error',
        message: `model request failed for ${sanitizeEndpointUrl(url)} (endpointFormat=${endpointFormat}): ${message}`
      }
    }
  }

  private buildHeaders(stream: boolean, endpointFormat: ModelEndpointFormat): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: stream ? 'text/event-stream' : 'application/json'
    }
    if (this.config.apiKey) {
      if (endpointFormat === 'messages') {
        headers.Authorization = `Bearer ${this.config.apiKey}`
        headers['x-api-key'] = this.config.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers.Authorization = `Bearer ${this.config.apiKey}`
      }
    }
    return { ...headers, ...(this.config.headers ?? {}) }
  }

  private async classifyHttpError(status: number, text: string): Promise<{ message: string; code: string }> {
    const body = text.slice(0, 500)
    if (status === 429) {
      return {
        message: `model request was rate limited (HTTP 429): ${body}`,
        code: 'rate_limited'
      }
    }
    if (status >= 500 && isDeepSeekHost(this.config.baseUrl)) {
      const probe = await probeDeepSeekReachable({
        baseUrl: this.config.baseUrl,
        fetchImpl: this.fetchImpl
      })
      return {
        message: `model request failed with DeepSeek HTTP ${status}: ${body} ${probe.message}`,
        code: probe.reachable ? `deepseek_http_${status}` : 'deepseek_unreachable'
      }
    }
    return {
      message: `model request failed with status ${status}: ${body}`,
      code: `http_${status}`
    }
  }

  private buildRequestBody(
    request: ModelRequest,
    stream: boolean,
    options: { includeStreamUsage?: boolean; includeReasoning?: boolean } = {}
  ): Record<string, unknown> {
    const requestModel = request.model?.trim()
    const model = requestModel || this.config.model
    const endpointFormat = this.endpointFormat()
    const includeReasoning = options.includeReasoning !== false
    const messages = this.collectMessages(request, model, endpointFormat, { includeReasoning })
    const compatibility = compatibilityProfileForModel({
      baseUrl: this.config.baseUrl,
      model,
      endpointFormat
    })
    if (endpointFormat === 'responses') {
      return this.buildResponsesRequestBody(request, model, messages, stream)
    }
    if (endpointFormat === 'messages') {
      return this.buildAnthropicMessagesRequestBody(request, model, messages, stream)
    }
    const body: Record<string, unknown> = {
      model,
      stream,
      messages
    }
    // Final defense: ensure no message reaches the wire with empty content.
    // Strict providers (MiniMax error 2013 "chat content is empty") reject
    // null/empty/whitespace/empty-array content. sanitizeEmptyMessageContent
    // already ran in collectMessages, but we re-run here as a belt-and-braces
    // guard against any transformation between collect and build.
    const finalMessages = sanitizeEmptyMessageContent(messages, this.config.baseUrl, model)
    body.messages = finalMessages
    // Diagnostic: surface any message that STILL looks empty after sanitization
    // (should never happen, but if it does we want to know the exact shape).
    diagnoseEmptyContent(finalMessages, this.config.baseUrl)
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' }
    }
    if (stream && options.includeStreamUsage !== false) {
      body.stream_options = { include_usage: true }
    }
    const thinkingDialect = requestThinkingDialect(compatibility.thinkingDialect)
    if (includeReasoning && compatibility.supportsReasoningEffort) {
      applyReasoningEffort(body, request.reasoningEffort, { thinkingDialect })
    }
    if (
      includeReasoning &&
      compatibility.requestFlags.deepseekThinking &&
      !Object.prototype.hasOwnProperty.call(body, 'thinking') &&
      isThinkingProducerModel(model)
    ) {
      body.thinking = { type: 'enabled' }
    }
    if (compatibility.requestFlags.reasoningSplit) {
      // MiniMax M3's official OpenAI-compatible API documents
      // `reasoning_split: true` as the way to split reasoning from visible
      // content. Without it, compatible gateways can leak model-native
      // reasoning/tool-call protocol text into `delta.content`.
      body.reasoning_split = true
    }
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
      if (stream && compatibility.requestFlags.zaiToolStream) {
        body.tool_stream = true
      }
    }
    return body
  }

  private buildResponsesRequestBody(
    request: ModelRequest,
    model: string,
    messages: ChatMessage[],
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      stream,
      input: messagesToResponsesInput(messages)
    }
    if (request.maxTokens !== undefined) {
      body.max_output_tokens = request.maxTokens
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.responseFormat === 'json_object') {
      body.text = { format: { type: 'json_object' } }
    }
    const reasoning = responsesReasoningForEffort(request.reasoningEffort)
    if (reasoning) body.reasoning = reasoning
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }))
    }
    return body
  }

  private buildAnthropicMessagesRequestBody(
    request: ModelRequest,
    model: string,
    messages: ChatMessage[],
    stream: boolean
  ): Record<string, unknown> {
    const converted = messagesToAnthropic(messages, {
      includeBlankThinkingPlaceholders: isDeepSeekHost(this.config.baseUrl)
    })
    const body: Record<string, unknown> = {
      model,
      stream,
      max_tokens: request.maxTokens ?? DEFAULT_MESSAGES_MAX_TOKENS,
      messages: converted.messages
    }
    if (converted.system) body.system = converted.system
    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP
    }
    if (request.responseFormat === 'json_object') {
      body.system = [converted.system, 'Return a valid JSON object only.']
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .join('\n\n')
    }
    const tools = normalizeToolSpecs(request.tools)
    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }))
    }
    return body
  }

  private collectMessages(
    request: ModelRequest,
    model: string,
    endpointFormat: ModelEndpointFormat,
    options: { includeReasoning?: boolean } = {}
  ): ChatMessage[] {
    const out: ChatMessage[] = []
    const compatibility = compatibilityProfileForModel({
      baseUrl: this.config.baseUrl,
      model,
      endpointFormat
    })
    if (request.systemPrompt) {
      out.push({ role: 'system', content: request.systemPrompt })
    }
    if (request.modeInstruction) {
      out.push({ role: 'system', content: request.modeInstruction })
    }
    for (const instruction of request.contextInstructions ?? []) {
      if (instruction.trim()) out.push({ role: 'system', content: instruction })
    }
    const windowSize = this.config.historyLimit
    const history = windowSize
      ? limitHistoryPreservingCompaction(request.history, windowSize)
      : request.history
    const repairedItems = repairModelHistoryItems([...request.prefix, ...history])
    const includeReasoning = options.includeReasoning !== false
    const thinkingMode = includeReasoning && (
      endpointFormat === 'messages'
        ? supportsMessagesThinkingBlocks(this.config.baseUrl) &&
          (isThinkingMode(request.reasoningEffort) || hasAssistantReasoning(repairedItems))
        : !compatibility.foldToolHistory &&
          requiresReasoningRoundTrip(request.reasoningEffort, model, this.config.baseUrl)
    )
    out.push(...this.itemsToMessages(
      repairedItems,
      thinkingMode,
      { foldToolHistory: compatibility.foldToolHistory }
    ))
    if (request.attachments?.length) {
      attachImagesToLatestUserMessage(out, request.attachments)
    }
    if (request.attachmentTextFallbacks?.length) {
      attachTextFallbacksToLatestUserMessage(out, request.attachmentTextFallbacks)
    }
    const healed = normalizeThinkingAssistantMessages(healToolMessagePairs(out), thinkingMode)
    // All endpoint formats can hit providers that reject empty content
    // (MiniMax error 2013 "chat content is empty"). Previously this only ran
    // for chat_completions, leaving the messages/responses paths unprotected.
    // messagesToAnthropic silently drops empty-block messages, which breaks
    // user/assistant alternation (Zhipu 1214). Sanitizing here ensures every
    // path gets a non-empty content shape before provider-specific conversion.
    const sanitized = sanitizeEmptyMessageContent(healed, this.config.baseUrl, model)
    // MiniMax (chat_completions/responses) rejects a request that contains
    // only system messages ("chat content is empty"). After aggressive
    // compaction the conversation can be folded into a single system summary
    // with no user/assistant turn. Inject a minimal user message so the model
    // has content to respond to. The Anthropic messages path manages its own
    // system/messages split and tolerates an empty messages array, so skip it
    // there to avoid altering that shape.
    const withUser =
      endpointFormat === 'messages'
        ? sanitized
        : ensureUserMessagePresent(sanitized)
    return compatibility.foldToolHistory
      ? normalizeGlmMessages(withUser)
      : withUser
  }

  private itemsToMessages(
    items: TurnItem[],
    thinkingMode: boolean,
    options: { foldToolHistory?: boolean } = {}
  ): ChatMessage[] {
    const out: ChatMessage[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (isBridgeItemBeforeToolCall(items, index)) {
        continue
      }
      if (thinkingMode && item?.kind === 'assistant_reasoning') {
        const next = items[index + 1]
        if (next?.kind === 'assistant_text' && next.turnId === item.turnId) {
          out.push({
            role: 'assistant',
            content: next.text,
            reasoning_content: reasoningContentOrSpace(item.text),
            ...(item.signature ? { reasoning_signature: item.signature } : {})
          })
          index += 1
        }
        continue
      }
      if (item?.kind === 'tool_call') {
        const block = this.toolCallBlockToMessages(items, index, thinkingMode, options)
        if (block) {
          out.push(...block.messages)
          index = block.nextIndex - 1
        }
        continue
      }
      if (item?.kind === 'tool_result') continue
      const message = this.itemToMessage(item, thinkingMode, options)
      if (message) out.push(message)
    }
    return out
  }

  private toolCallBlockToMessages(
    items: TurnItem[],
    startIndex: number,
    thinkingMode: boolean,
    options: { foldToolHistory?: boolean } = {}
  ): { messages: ChatMessage[]; nextIndex: number } | null {
    const calls: Extract<TurnItem, { kind: 'tool_call' }>[] = []
    let index = startIndex
    while (index < items.length && items[index]?.kind === 'tool_call') {
      calls.push(items[index] as Extract<TurnItem, { kind: 'tool_call' }>)
      index += 1
    }
    if (calls.length === 0) return null

    const turnId = calls[0]?.turnId ?? ''
    const expectedCallIds = new Set(calls.map((call) => call.callId))
    const seenResultIds = new Set<string>()
    const resultMessages: ChatMessage[] = []
    const resultItems: Extract<TurnItem, { kind: 'tool_result' }>[] = []
    const assistantText: string[] = []
    const reasoningText: string[] = []
    let bridgeIndex = startIndex - 1
    while (bridgeIndex >= 0) {
      const item = items[bridgeIndex]
      if (!item || !isPreToolCallBridgeItem(item, turnId)) break
      if (item.kind === 'assistant_text' && item.text.trim()) {
        assistantText.unshift(item.text)
      } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
        reasoningText.unshift(item.text)
      }
      bridgeIndex -= 1
    }
    let sawResult = false
    while (index < items.length) {
      const item = items[index]
      if (!item) break
      if (item.kind === 'tool_result') {
        sawResult = true
        if (expectedCallIds.has(item.callId) && !seenResultIds.has(item.callId)) {
          seenResultIds.add(item.callId)
          resultItems.push(item)
          resultMessages.push(this.toolResultToMessage(item))
        }
        index += 1
        continue
      }
      if (isToolResultBridgeItem(item, { turnId, sawResult })) {
        if (!sawResult) {
          if (item.kind === 'assistant_text' && item.text.trim()) {
            assistantText.push(item.text)
          } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
            reasoningText.push(item.text)
          }
        }
        index += 1
        continue
      }
      break
    }

    if (![...expectedCallIds].every((callId) => seenResultIds.has(callId))) {
      return null
    }
    if (options.foldToolHistory) {
      return {
        messages: [
          {
            role: 'system',
            content: formatFoldedToolHistoryMessage(calls, resultItems, assistantText)
          }
        ],
        nextIndex: index
      }
    }
    return {
      messages: [
        {
          role: 'assistant',
          content: assistantText.length > 0 ? assistantText.join('\n') : '',
          ...(thinkingMode ? { reasoning_content: reasoningContentOrSpace(reasoningText.join('\n')) } : {}),
          ...(thinkingMode ? reasoningSignatureFromItems(items, bridgeIndex + 1, startIndex, turnId) : {}),
          tool_calls: calls.map((call) => this.toolCallToWire(call))
        },
        ...resultMessages
      ],
      nextIndex: index
    }
  }

  private toolCallToWire(item: Extract<TurnItem, { kind: 'tool_call' }>): NonNullable<ChatMessage['tool_calls']>[number] {
    return {
      id: item.callId,
      type: 'function',
      function: { name: item.toolName, arguments: JSON.stringify(item.arguments) }
    }
  }

  private toolResultToMessage(item: Extract<TurnItem, { kind: 'tool_result' }>): ChatMessage {
    return {
      role: 'tool',
      content: toolResultContent(item.output),
      tool_call_id: item.callId
    }
  }

  private itemToMessage(
    item: TurnItem,
    thinkingMode: boolean,
    options: { foldToolHistory?: boolean } = {}
  ): ChatMessage | null {
    switch (item.kind) {
      case 'user_message':
        return { role: 'user', content: item.text }
      case 'assistant_text':
        return {
          role: 'assistant',
          content: options.foldToolHistory ? stripLegacyFoldedToolHistory(item.text) : item.text,
          ...(thinkingMode ? { reasoning_content: ' ' } : {})
        }
      case 'assistant_reasoning':
        return null
      case 'tool_call':
        return {
          role: 'assistant',
          content: '',
          ...(thinkingMode ? { reasoning_content: ' ' } : {}),
          tool_calls: [this.toolCallToWire(item)]
        }
      case 'tool_result':
        return this.toolResultToMessage(item)
      case 'compaction':
        return item.replacedTokens > 0
          ? { role: 'system', content: `Conversation summary from earlier turns:\n${item.summary}` }
          : null
      case 'review':
        return item.status === 'completed' && item.reviewText?.trim()
          ? { role: 'system', content: `Code review result from an earlier turn:\n${item.reviewText}` }
          : null
      case 'approval':
      case 'user_input':
      case 'runtime_progress':
      case 'error':
        return null
    }
  }

  private async *streamSse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    endpointFormat: ModelEndpointFormat
  ): AsyncIterable<ModelStreamChunk> {
    const decoder = new TextDecoder('utf-8')
    const reader = body.getReader()
    let buffer = ''
    const pendingArguments = new Map<string, PendingToolCall>()
    const pendingByIndex = new Map<number, string>()
    const completedToolCalls = new Set<string>()
    const inlineToolCallState: InlineToolCallState = { buffer: '', nextId: 1 }
    let usage: UsageSnapshot | null = null
    let textAccumulator = ''
    let reasoningAccumulator = ''
    let stopReason: ModelStopReason = 'stop'
    let finishReason: string | null = null
    let sawDone = false
    const idleTimeoutMs = normalizeStreamIdleTimeoutMs(this.config.streamIdleTimeoutMs)
    const reasoningExtractor = new InlineReasoningExtractor()
    try {
      while (!signal.aborted) {
        const read = await readStreamChunk(reader, signal, idleTimeoutMs)
        if (read.kind === 'timeout') {
          yield {
            kind: 'error',
            message: `model stream stalled for ${idleTimeoutMs}ms without data`,
            code: 'stream_idle_timeout'
          }
          return
        }
        if (read.kind === 'aborted') break
        if (read.kind === 'error') {
          yield { kind: 'error', message: read.message, code: 'stream_read_error' }
          return
        }
        const { value, done } = read
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const dataLines = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('')
          if (!dataLines) continue
          if (dataLines === '[DONE]') {
            finishReason = finishReason ?? 'stop'
            sawDone = true
            break
          }
          let payload: unknown
          try {
            payload = JSON.parse(dataLines)
          } catch {
            continue
          }
          const result = this.consumeStreamPayload(
            payload as Record<string, unknown>,
            pendingArguments,
            pendingByIndex,
            completedToolCalls,
            textAccumulator,
            reasoningAccumulator,
            endpointFormat,
            reasoningExtractor,
            inlineToolCallState
          )
          textAccumulator = result.text
          reasoningAccumulator = result.reasoning
          if (result.usage) usage = mergeUsageSnapshots(usage, result.usage)
          if (result.finishReason && finishReason !== 'tool_calls') finishReason = result.finishReason
          for (const chunk of result.chunks) yield chunk
        }
        if (sawDone) break
      }
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // The stream may already be released; ignore.
      }
    }
    if (signal.aborted) {
      yield { kind: 'error', message: 'request was aborted' }
      return
    }
    // Flush any trailing state from the inline-reasoning extractor (e.g. an
    // unclosed opener whose reasoning accumulated to stream end).
    const flushed = reasoningExtractor.flush()
    if (flushed.text) {
      const cleaned = sanitizeModelText(flushed.text)
      if (cleaned) {
        textAccumulator += cleaned
        yield { kind: 'assistant_text_delta', text: cleaned }
      }
    }
    if (flushed.reasoning) {
      reasoningAccumulator += flushed.reasoning
      yield { kind: 'assistant_reasoning_delta', text: flushed.reasoning }
    }
    // Safety net: finalize any tool calls still pending after stream end.
    // This handles models that never send an explicit finish_reason or
    // close the stream without a [DONE] sentinel.
    if (pendingArguments.size > 0) {
      for (const [callId, value] of pendingArguments) {
        if (!value.name) continue
        const args = this.parseToolArguments(value.arguments)
        yield {
          kind: 'tool_call_complete',
          callId,
          toolName: value.name,
          arguments: args
        }
      }
      pendingArguments.clear()
      finishReason = 'tool_calls'
    }
    if (usage) yield { kind: 'usage', usage }
    stopReason = ((): ModelStopReason => {
      switch (finishReason) {
        case 'tool_calls':
          return 'tool_calls'
        case 'length':
          return 'length'
        case 'error':
          return 'error'
        default:
          return 'stop'
      }
    })()
    yield { kind: 'completed', stopReason }
  }

  private consumeStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string,
    endpointFormat: ModelEndpointFormat,
    reasoningExtractor: InlineReasoningExtractor,
    inlineToolCallState: InlineToolCallState
  ): {
    chunks: ModelStreamChunk[]
    text: string
    reasoning: string
    finishReason: string | null
    usage: UsageSnapshot | null
  } {
    if (endpointFormat === 'responses') {
      return this.consumeResponsesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        textAccumulator,
        reasoningAccumulator
      )
    }
    if (endpointFormat === 'messages') {
      return this.consumeAnthropicMessagesStreamPayload(
        payload,
        pendingArguments,
        pendingByIndex,
        completedToolCalls,
        textAccumulator,
        reasoningAccumulator
      )
    }
    const chunks: ModelStreamChunk[] = []
    let text = textAccumulator
    let reasoning = reasoningAccumulator
    let finishReason: string | null = null
    let usage: UsageSnapshot | null = null
    const choice = (payload.choices as Record<string, unknown>[] | undefined)?.[0]
    if (choice && typeof choice === 'object') {
      const delta = choice.delta as Record<string, unknown> | undefined
      if (delta && typeof delta === 'object') {
        const toolCalls = delta.tool_calls as
          | {
              index?: number
              id?: string
              function?: { name?: string; arguments?: string }
            }[]
          | undefined
        const suppressContentForToolCall = Array.isArray(toolCalls) || pendingArguments.size > 0
        const content = delta.content
        if (typeof content === 'string' && content.length > 0 && !suppressContentForToolCall) {
          const inlineToolCall = consumeInlineToolCallContent(content, inlineToolCallState)
          if (inlineToolCall.consumed) {
            if (inlineToolCall.call) {
              chunks.push({
                kind: 'tool_call_complete',
                callId: inlineToolCall.call.callId,
                toolName: inlineToolCall.call.toolName,
                arguments: inlineToolCall.call.arguments
              })
              finishReason = 'tool_calls'
            }
          }
          const visibleContent = inlineToolCall.consumed ? inlineToolCall.visibleText : content
          if (!visibleContent) {
            // The chunk was entirely model-native tool-call protocol.
          } else {
          // Extract inline reasoning tags (e.g. MiniMax <mm:think>) across
          // chunk boundaries before sanitizing the visible text. This routes
          // inlined thinking to the same `assistant_reasoning_delta` channel
          // as dedicated `reasoning_content` fields, so all models converge on
          // the same reasoning UI without per-model frontend adaptation.
          const extracted = reasoningExtractor.push(visibleContent)
          if (extracted.reasoning) {
            reasoning += extracted.reasoning
            chunks.push({ kind: 'assistant_reasoning_delta', text: extracted.reasoning })
          }
          if (extracted.text) {
            const cleaned = sanitizeModelText(extracted.text)
            if (cleaned) {
              text += cleaned
              chunks.push({ kind: 'assistant_text_delta', text: cleaned })
            }
          }
          }
        }
        const reasoningContent = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
          reasoning += reasoningContent
          chunks.push({ kind: 'assistant_reasoning_delta', text: reasoningContent })
        }
        if (Array.isArray(toolCalls)) {
          for (const call of toolCalls) {
            const id = resolveToolCallDeltaId(call, pendingArguments)
            const existing = pendingArguments.get(id) ?? { index: numericIndex(call.index), name: undefined, arguments: '' }
            const resolvedIndex = numericIndex(call.index)
            if (resolvedIndex !== undefined) existing.index = resolvedIndex
            if (call.function?.name) existing.name = call.function.name
            if (typeof call.function?.arguments === 'string') {
              existing.arguments += call.function.arguments
              chunks.push({
                kind: 'tool_call_delta',
                callId: id,
                toolName: existing.name,
                argumentsDelta: call.function.arguments
              })
            }
            pendingArguments.set(id, existing)
          }
        }
      }
      if (typeof choice.finish_reason === 'string' && finishReason !== 'tool_calls') {
        finishReason = choice.finish_reason
      }
    }
    const usagePayload = payload.usage as Record<string, unknown> | undefined
    if (usagePayload) {
      usage = this.mapUsage(usagePayload)
    }
    // Finalize pending tool calls whenever a finish_reason is received.
    // Many models (Qwen, GLM, MiMo, open-source via vLLM/Ollama) send
    // finish_reason='stop' even when tool calls are present. Waiting for
    // an explicit 'tool_calls' finish_reason loses those calls.
    if (finishReason && pendingArguments.size > 0) {
      for (const [callId, value] of pendingArguments) {
        if (!value.name) continue
        const args = this.parseToolArguments(value.arguments)
        chunks.push({
          kind: 'tool_call_complete',
          callId,
          toolName: value.name,
          arguments: args
        })
      }
      pendingArguments.clear()
      // Ensure downstream sees the correct finish reason when tool calls
      // were actually present, regardless of what the provider reported.
      finishReason = 'tool_calls'
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private consumeResponsesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string
  ): {
    chunks: ModelStreamChunk[]
    text: string
    reasoning: string
    finishReason: string | null
    usage: UsageSnapshot | null
  } {
    const chunks: ModelStreamChunk[] = []
    let text = textAccumulator
    let reasoning = reasoningAccumulator
    let finishReason: string | null = null
    let usage: UsageSnapshot | null = null
    const type = recordString(payload, 'type')

    const outputIndex = numericIndex(payload.output_index)
    const item = recordValue(payload, 'item') ?? recordValue(payload, 'output_item')
    if (item) {
      const itemType = recordString(item, 'type')
      if (itemType === 'function_call' || itemType === 'custom_tool_call') {
        const callId = recordString(item, 'call_id') || recordString(item, 'id') || indexFallbackCallId(outputIndex, pendingArguments)
        const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
        if (outputIndex !== undefined) {
          existing.index = outputIndex
          pendingByIndex.set(outputIndex, callId)
        }
        const name = recordString(item, 'name')
        if (name) existing.name = name
        const initialArguments = recordString(item, 'arguments') || recordString(item, 'input')
        if (initialArguments && !existing.arguments) existing.arguments = initialArguments
        pendingArguments.set(callId, existing)
        if (type === 'response.output_item.done' && existing.name) {
          chunks.push({
            kind: 'tool_call_complete',
            callId,
            toolName: existing.name,
            arguments: this.parseToolArguments(existing.arguments || '{}')
          })
          completedToolCalls.add(callId)
          pendingArguments.delete(callId)
        }
      }
    }

    if (type === 'response.output_text.delta') {
      const delta = recordString(payload, 'delta')
      if (delta) {
        const cleaned = sanitizeModelText(delta)
        if (cleaned) {
          text += cleaned
          chunks.push({ kind: 'assistant_text_delta', text: cleaned })
        }
      }
    } else if (
      type === 'response.reasoning_text.delta' ||
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning.delta'
    ) {
      const delta = recordString(payload, 'delta')
      if (delta) {
        reasoning += delta
        chunks.push({ kind: 'assistant_reasoning_delta', text: delta })
      }
    } else if (type === 'response.function_call_arguments.delta') {
      const callId = responseStreamCallId(payload, pendingArguments, pendingByIndex)
      const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
      const delta = recordString(payload, 'delta')
      if (outputIndex !== undefined) {
        existing.index = outputIndex
        pendingByIndex.set(outputIndex, callId)
      }
      if (delta) {
        existing.arguments += delta
        chunks.push({
          kind: 'tool_call_delta',
          callId,
          toolName: existing.name,
          argumentsDelta: delta
        })
      }
      pendingArguments.set(callId, existing)
    } else if (type === 'response.function_call_arguments.done') {
      const callId = responseStreamCallId(payload, pendingArguments, pendingByIndex)
      const existing = pendingArguments.get(callId) ?? { index: outputIndex, name: undefined, arguments: '' }
      const args = recordString(payload, 'arguments')
      if (args) existing.arguments = args
      if (existing.name) {
        pendingArguments.set(callId, existing)
      } else {
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'response.completed') {
      const response = recordValue(payload, 'response') as ResponsesApiResponse | null
      const materialized = this.materializeResponsesOutput(response ?? (payload as ResponsesApiResponse), {
        skipText: Boolean(text),
        pendingArguments,
        completedToolCalls
      })
      chunks.push(...materialized.chunks)
      if (materialized.usage) usage = materialized.usage
      finishReason = materialized.finishReason
    } else if (type === 'response.failed' || type === 'error') {
      const message = responseErrorMessage(payload)
      chunks.push({ kind: 'error', message, code: 'response_stream_error' })
      finishReason = 'error'
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private consumeAnthropicMessagesStreamPayload(
    payload: Record<string, unknown>,
    pendingArguments: Map<string, PendingToolCall>,
    pendingByIndex: Map<number, string>,
    completedToolCalls: Set<string>,
    textAccumulator: string,
    reasoningAccumulator: string
  ): {
    chunks: ModelStreamChunk[]
    text: string
    reasoning: string
    finishReason: string | null
    usage: UsageSnapshot | null
  } {
    const chunks: ModelStreamChunk[] = []
    let text = textAccumulator
    let reasoning = reasoningAccumulator
    let finishReason: string | null = null
    let usage: UsageSnapshot | null = null
    const type = recordString(payload, 'type')
    const index = numericIndex(payload.index)

    if (type === 'message_start') {
      const message = recordValue(payload, 'message')
      const usagePayload = message ? recordValue(message, 'usage') : null
      if (usagePayload) usage = this.mapUsage(usagePayload)
    } else if (type === 'content_block_start') {
      const block = recordValue(payload, 'content_block')
      const blockType = block ? recordString(block, 'type') : ''
      if (block && blockType === 'redacted_thinking') {
        const data = recordString(block, 'data')
        if (data) {
          chunks.push({
            kind: 'assistant_reasoning_delta',
            text: '',
            signature: `${REDACTED_THINKING_SIGNATURE_PREFIX}${data}`
          })
        }
      } else if (block && blockType === 'tool_use') {
        const callId = recordString(block, 'id') || indexFallbackCallId(index, pendingArguments)
        const existing = pendingArguments.get(callId) ?? { index, name: undefined, arguments: '' }
        if (index !== undefined) {
          existing.index = index
          pendingByIndex.set(index, callId)
        }
        const name = recordString(block, 'name')
        if (name) existing.name = name
        const input = recordValue(block, 'input')
        if (input && Object.keys(input).length > 0) existing.arguments = JSON.stringify(input)
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'content_block_delta') {
      const delta = recordValue(payload, 'delta')
      const deltaType = delta ? recordString(delta, 'type') : ''
      if (deltaType === 'text_delta') {
        const value = recordString(delta, 'text')
        if (value) {
          const cleaned = sanitizeModelText(value)
          if (cleaned) {
            text += cleaned
            chunks.push({ kind: 'assistant_text_delta', text: cleaned })
          }
        }
      } else if (deltaType === 'thinking_delta') {
        const value = recordString(delta, 'thinking')
        if (value) {
          reasoning += value
          chunks.push({ kind: 'assistant_reasoning_delta', text: value })
        }
      } else if (deltaType === 'signature_delta') {
        const signature = recordString(delta, 'signature')
        if (signature) {
          chunks.push({ kind: 'assistant_reasoning_delta', text: '', signature })
        }
      } else if (deltaType === 'input_json_delta') {
        const callId = anthropicStreamCallId(index, pendingArguments, pendingByIndex)
        const existing = pendingArguments.get(callId) ?? { index, name: undefined, arguments: '' }
        const value = recordString(delta, 'partial_json')
        if (index !== undefined) {
          existing.index = index
          pendingByIndex.set(index, callId)
        }
        if (value) {
          existing.arguments += value
          chunks.push({
            kind: 'tool_call_delta',
            callId,
            toolName: existing.name,
            argumentsDelta: value
          })
        }
        pendingArguments.set(callId, existing)
      }
    } else if (type === 'content_block_stop') {
      const callId = index === undefined ? undefined : pendingByIndex.get(index)
      const pending = callId ? pendingArguments.get(callId) : undefined
      if (callId && pending?.name) {
        chunks.push({
          kind: 'tool_call_complete',
          callId,
          toolName: pending.name,
          arguments: this.parseToolArguments(pending.arguments || '{}')
        })
        completedToolCalls.add(callId)
        pendingArguments.delete(callId)
        if (index !== undefined) pendingByIndex.delete(index)
      }
    } else if (type === 'message_delta') {
      const delta = recordValue(payload, 'delta')
      const stopReason = delta ? recordString(delta, 'stop_reason') : ''
      const mappedStopReason = anthropicStopReason(stopReason)
      if (mappedStopReason) finishReason = mappedStopReason
      const usagePayload = recordValue(payload, 'usage')
      if (usagePayload) usage = this.mapUsage(usagePayload)
    } else if (type === 'message_stop') {
      finishReason = finishReason ?? 'stop'
    } else if (type === 'error') {
      chunks.push({ kind: 'error', message: responseErrorMessage(payload), code: 'messages_stream_error' })
      finishReason = 'error'
    }
    return { chunks, text, reasoning, finishReason, usage }
  }

  private *materializeNonStreaming(
    payload: ChatCompletionResponse,
    endpointFormat: ModelEndpointFormat
  ): Generator<ModelStreamChunk> {
    if (endpointFormat === 'responses') {
      yield* this.materializeResponsesNonStreaming(payload as unknown as ResponsesApiResponse)
      return
    }
    if (endpointFormat === 'messages') {
      yield* this.materializeAnthropicMessagesNonStreaming(payload as unknown as AnthropicMessageResponse)
      return
    }
    const choice = payload.choices?.[0]
    if (!choice) {
      yield { kind: 'error', message: 'model response contained no choices' }
      return
    }
    const text = typeof choice.message?.content === 'string' ? choice.message.content : ''
    const reasoning = reasoningFromMessage(choice.message)
    if (reasoning) {
      yield { kind: 'assistant_reasoning_delta', text: reasoning }
    }
    if (text) {
      const cleaned = sanitizeModelText(text)
      if (cleaned) yield { kind: 'assistant_text_delta', text: cleaned }
    }
    const hasToolCalls = Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0
    if (hasToolCalls) {
      for (const call of choice.message!.tool_calls!) {
        const args = this.parseToolArguments(call.function?.arguments ?? '{}')
        yield {
          kind: 'tool_call_complete',
          callId: call.id,
          toolName: call.function.name,
          arguments: args
        }
      }
    }
    if (payload.usage) {
      yield { kind: 'usage', usage: this.mapUsage(payload.usage) }
    }
    // Derive stop reason: when tool calls are present, always report
    // 'tool_calls' regardless of the provider's finish_reason value.
    let stopReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop'
    if (hasToolCalls || choice.finish_reason === 'tool_calls') stopReason = 'tool_calls'
    else if (choice.finish_reason === 'length') stopReason = 'length'
    else if (choice.finish_reason === 'error') stopReason = 'error'
    yield { kind: 'completed', stopReason }
  }

  private *materializeResponsesNonStreaming(
    payload: ResponsesApiResponse
  ): Generator<ModelStreamChunk> {
    if (payload.error?.message) {
      yield { kind: 'error', message: payload.error.message, code: payload.error.type }
      return
    }
    const materialized = this.materializeResponsesOutput(payload)
    yield* materialized.chunks
    if (materialized.usage) {
      yield { kind: 'usage', usage: materialized.usage }
    }
    yield { kind: 'completed', stopReason: materialized.finishReason }
  }

  private materializeResponsesOutput(
    payload: ResponsesApiResponse,
    options: {
      skipText?: boolean
      pendingArguments?: Map<string, PendingToolCall>
      completedToolCalls?: Set<string>
    } = {}
  ): {
    chunks: ModelStreamChunk[]
    finishReason: ModelStopReason
    usage: UsageSnapshot | null
  } {
    const chunks: ModelStreamChunk[] = []
    let sawToolCall = (options.completedToolCalls?.size ?? 0) > 0
    if (!options.skipText) {
      const outputText = typeof payload.output_text === 'string'
        ? payload.output_text
        : responsesOutputText(payload.output)
      if (outputText) {
        const cleaned = sanitizeModelText(outputText)
        if (cleaned) chunks.push({ kind: 'assistant_text_delta', text: cleaned })
      }
    }
    for (const item of payload.output ?? []) {
      const itemType = recordString(item, 'type')
      if (itemType !== 'function_call' && itemType !== 'custom_tool_call') continue
      const callId = recordString(item, 'call_id') || recordString(item, 'id')
      const toolName = recordString(item, 'name')
      if (!callId || !toolName) continue
      if (options.completedToolCalls?.has(callId)) continue
      sawToolCall = true
      const argsRaw = recordString(item, 'arguments') || recordString(item, 'input') || '{}'
      if (options.pendingArguments?.has(callId)) {
        options.pendingArguments.delete(callId)
      }
      chunks.push({
        kind: 'tool_call_complete',
        callId,
        toolName,
        arguments: this.parseToolArguments(argsRaw)
      })
    }
    const usage = payload.usage ? this.mapUsage(payload.usage) : null
    let finishReason: ModelStopReason = sawToolCall ? 'tool_calls' : 'stop'
    if (payload.status === 'incomplete') {
      finishReason = payload.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'error'
    } else if (payload.status === 'failed') {
      finishReason = 'error'
    }
    return { chunks, finishReason, usage }
  }

  private *materializeAnthropicMessagesNonStreaming(
    payload: AnthropicMessageResponse
  ): Generator<ModelStreamChunk> {
    let sawToolCall = false
    for (const block of payload.content ?? []) {
      const type = recordString(block, 'type')
      if (type === 'text') {
        const text = recordString(block, 'text')
        if (text) {
          const cleaned = sanitizeModelText(text)
          if (cleaned) yield { kind: 'assistant_text_delta', text: cleaned }
        }
      } else if (type === 'thinking') {
        const thinking = recordString(block, 'thinking')
        const signature = recordString(block, 'signature')
        if (thinking || signature) {
          yield {
            kind: 'assistant_reasoning_delta',
            text: thinking,
            ...(signature ? { signature } : {})
          }
        }
      } else if (type === 'redacted_thinking') {
        const data = recordString(block, 'data')
        if (data) {
          yield {
            kind: 'assistant_reasoning_delta',
            text: '',
            signature: `${REDACTED_THINKING_SIGNATURE_PREFIX}${data}`
          }
        }
      } else if (type === 'tool_use') {
        const callId = recordString(block, 'id')
        const toolName = recordString(block, 'name')
        const input = recordValue(block, 'input') ?? {}
        if (callId && toolName) {
          sawToolCall = true
          yield {
            kind: 'tool_call_complete',
            callId,
            toolName,
            arguments: input
          }
        }
      }
    }
    if (payload.usage) {
      yield { kind: 'usage', usage: this.mapUsage(payload.usage) }
    }
    yield { kind: 'completed', stopReason: anthropicStopReason(payload.stop_reason) ?? (sawToolCall ? 'tool_calls' : 'stop') }
  }

  private mapUsage(usage: Record<string, unknown>): UsageSnapshot {
    const promptTokens = Number(usage.prompt_tokens ?? usage.prompt_eval_count ?? usage.input_tokens ?? 0) || 0
    const completionTokens = Number(usage.completion_tokens ?? usage.eval_count ?? usage.output_tokens ?? 0) || 0
    const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0
    const promptDetails = usage.prompt_tokens_details as
      | { cached_tokens?: number }
      | undefined
    const nativeHit = Number(usage.prompt_cache_hit_tokens ?? 0) || 0
    const nativeMiss = Number(usage.prompt_cache_miss_tokens ?? 0) || 0
    const hasNativeCache = nativeHit > 0 || nativeMiss > 0
    const cachedTokens = Number(promptDetails?.cached_tokens ?? 0) || 0
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0) || 0
    const cacheHit = hasNativeCache ? nativeHit : (cachedTokens > 0 ? cachedTokens : cacheRead)
    const cacheMiss = hasNativeCache ? nativeMiss : Math.max(promptTokens - cacheHit, 0)
    const cacheTotal = cacheHit + cacheMiss
    const cacheHitRate = cacheTotal === 0 ? null : cacheHit / cacheTotal
    const estimatedCost = this.pricingProvider.estimateCost({
      model: this.config.model,
      providerHost: this.config.baseUrl,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      outputTokens: completionTokens
    })
    const estimatedSavings = this.pricingProvider.estimateCacheSavings({
      model: this.config.model,
      providerHost: this.config.baseUrl,
      cacheHitTokens: cacheHit
    })
    const reportedCostUsd = Number(usage.cost_usd ?? usage.costUsd)
    const reportedCostCny = Number(usage.cost_cny ?? usage.costCny)
    return {
      ...emptyUsageSnapshot(),
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cacheHit || cachedTokens || cacheRead || 0,
      cacheHitTokens: cacheHit,
      cacheMissTokens: cacheMiss,
      cacheHitRate,
      turns: 1,
      costUsd: Number.isFinite(reportedCostUsd) ? reportedCostUsd : estimatedCost?.costUsd,
      costCny: Number.isFinite(reportedCostCny) ? reportedCostCny : estimatedCost?.costCny,
      cacheSavingsUsd: estimatedSavings?.cacheSavingsUsd,
      cacheSavingsCny: estimatedSavings?.cacheSavingsCny
    }
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    return repairToolArguments(raw).arguments
  }
}

function normalizeToolSpecs(tools: ModelToolSpec[]): ModelToolSpec[] {
  return [...tools]
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: canonicalizeSchema(tool.inputSchema)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function messagesToResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'tool') {
      if (message.tool_call_id) {
        input.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: chatContentToPlainText(message.content)
        })
      }
      continue
    }
    const content = chatContentToResponsesContent(message.content)
    if (content !== undefined && !(Array.isArray(content) && content.length === 0)) {
      input.push({
        role: message.role,
        content
      })
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: 'function_call',
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
        status: 'completed'
      })
    }
  }
  return input
}

function messagesToAnthropic(
  messages: ChatMessage[],
  options: { includeBlankThinkingPlaceholders?: boolean } = {}
): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = []
  const out: AnthropicMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      const text = chatContentToPlainText(message.content).trim()
      if (text) system.push(text)
      continue
    }
    if (message.role === 'tool') {
      if (!message.tool_call_id) continue
      out.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: chatContentToPlainText(message.content)
        }]
      })
      continue
    }
    const content = chatContentToAnthropicContent(message.content)
    const blocks = Array.isArray(content)
      ? [...content]
      : content.trim()
        ? [{ type: 'text' as const, text: content }]
        : []
    const redactedThinking = anthropicRedactedThinkingFromReasoningSignature(
      message.reasoning_signature
    )
    const thinking = anthropicThinkingFromReasoningContent(
      message.reasoning_content,
      message.reasoning_signature,
      { includeBlankThinkingPlaceholder: options.includeBlankThinkingPlaceholders }
    )
    if (message.role === 'assistant' && redactedThinking) {
      blocks.unshift(redactedThinking)
    }
    if (message.role === 'assistant' && thinking) {
      blocks.unshift(thinking)
    }
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: repairToolArguments(call.function.arguments).arguments
      })
    }
    if (blocks.length > 0) {
      out.push({ role: message.role, content: blocks })
      continue
    }
    // Empty user/assistant message: previously silently dropped, which breaks
    // the strict user/assistant alternation that Anthropic (and Zhipu's
    // Anthropic-compatible endpoint, error 1214) requires. Insert a minimal
    // placeholder text block so the message survives and alternation holds.
    // This mirrors normalizeThinkingAssistantMessages' ' ' placeholder strategy.
    if (message.role === 'user' || message.role === 'assistant') {
      out.push({ role: message.role, content: [{ type: 'text', text: ' ' }] })
    }
  }
  // Merge consecutive same-role messages (e.g. multiple tool_result user
  // messages) into one. Anthropic allows batched tool_result blocks in a
  // single user message, and Zhipu's compatible endpoint is stricter about
  // alternation — merging guarantees no two adjacent messages share a role.
  const merged = mergeConsecutiveSameRoleMessages(out)
  return { system: system.join('\n\n'), messages: merged }
}

function mergeConsecutiveSameRoleMessages(
  messages: AnthropicMessage[]
): AnthropicMessage[] {
  // Only merge consecutive USER messages — this handles the common case of
  // multiple tool_result blocks (one per tool call) that were emitted as
  // separate user messages. Anthropic allows batched tool_result blocks in
  // a single user message, and Zhipu's compatible endpoint is stricter about
  // alternation. Assistant messages are NOT merged: each represents a distinct
  // model turn and merging would corrupt thinking/text/tool_use block ordering.
  const result: AnthropicMessage[] = []
  for (const message of messages) {
    const prev = result[result.length - 1]
    if (
      prev &&
      prev.role === 'user' &&
      message.role === 'user' &&
      Array.isArray(prev.content) &&
      Array.isArray(message.content)
    ) {
      prev.content = [...prev.content, ...message.content]
    } else {
      result.push({ ...message })
    }
  }
  return result
}

function anthropicThinkingFromReasoningContent(
  reasoningContent: string | undefined,
  signature: string | undefined,
  options: { includeBlankThinkingPlaceholder?: boolean } = {}
): Extract<AnthropicContentBlock, { type: 'thinking' }> | null {
  if (signature?.startsWith(REDACTED_THINKING_SIGNATURE_PREFIX)) return null
  const hasSignature = typeof signature === 'string' && signature.length > 0
  const hasReasoningContent = typeof reasoningContent === 'string'
  if (!hasSignature && !reasoningContent?.trim() && !(options.includeBlankThinkingPlaceholder && hasReasoningContent)) {
    return null
  }
  return {
    type: 'thinking',
    thinking: reasoningContent?.trim() ? reasoningContent : '',
    ...(signature ? { signature } : {})
  }
}

function anthropicRedactedThinkingFromReasoningSignature(
  signature: string | undefined
): Extract<AnthropicContentBlock, { type: 'redacted_thinking' }> | null {
  if (!signature?.startsWith(REDACTED_THINKING_SIGNATURE_PREFIX)) return null
  const data = signature.slice(REDACTED_THINKING_SIGNATURE_PREFIX.length)
  return data ? { type: 'redacted_thinking', data } : null
}

function chatContentToResponsesContent(
  content: ChatMessage['content']
): string | Array<Record<string, unknown>> | undefined {
  if (content === null || content === undefined) return undefined
  if (typeof content === 'string') return content
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text })
    } else if (part.type === 'image_url') {
      parts.push({ type: 'input_image', image_url: part.image_url.url })
    }
  }
  return parts
}

function chatContentToAnthropicContent(content: ChatMessage['content']): string | AnthropicContentBlock[] {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  const parts: AnthropicContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) parts.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'thinking') {
      parts.push({
        type: 'thinking',
        thinking: part.thinking,
        ...(part.signature ? { signature: part.signature } : {})
      })
      continue
    }
    const image = anthropicImageSource(part.image_url.url)
    if (image) parts.push({ type: 'image', source: image })
  }
  return parts
}

function anthropicImageSource(value: string): AnthropicImageSource | null {
  const data = parseDataUri(value)
  if (data) {
    return {
      type: 'base64',
      media_type: data.mimeType,
      data: data.base64
    }
  }
  if (/^https?:\/\//i.test(value)) {
    return { type: 'url', url: value }
  }
  return null
}

function parseDataUri(value: string): { mimeType: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(value)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

function chatContentToPlainText(content: ChatMessage['content']): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return part.text
    if (part.type === 'thinking') return part.thinking
    return `[image: ${part.image_url.url}]`
  }).join('\n')
}

function responsesReasoningForEffort(effort: string | undefined): Record<string, unknown> | null {
  const normalized = effort?.trim().toLowerCase()
  switch (normalized) {
    case 'low':
    case 'minimal':
      return { effort: 'low' }
    case 'medium':
    case 'mid':
      return { effort: 'medium' }
    case 'high':
    case 'max':
    case 'maximum':
    case 'xhigh':
      return { effort: 'high' }
    default:
      return null
  }
}

function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat, model?: string): string {
  const path = modelEndpointPath(endpointFormat)
  const normalized = normalizeProviderBaseUrl(baseUrl.trim().replace(/\/+$/, ''), endpointFormat, model)
  if (!normalized) return `/v1/${path}`
  if (normalized.toLowerCase().endsWith(`/${path}`)) return normalized
  const withoutEndpoint = stripKnownEndpointPath(normalized)
  const lastSegment = withoutEndpoint.split('/').pop()?.toLowerCase() ?? ''
  if (lastSegment === 'beta') {
    return `${withoutEndpoint.slice(0, -'/beta'.length)}/v1/${path}`
  }
  if (/^v\d+$/.test(lastSegment)) {
    return `${withoutEndpoint}/${path}`
  }
  return `${withoutEndpoint}/v1/${path}`
}

function normalizeProviderBaseUrl(baseUrl: string, endpointFormat: ModelEndpointFormat, model?: string): string {
  if (!baseUrl || !isBigModelProvider(baseUrl) || !isGlmCodingPlanModel(model)) {
    return baseUrl
  }
  if (endpointFormat === 'messages') {
    return replaceBigModelApiPath(baseUrl, 'anthropic')
  }
  if (endpointFormat === 'chat_completions') {
    return replaceBigModelApiPath(baseUrl, 'coding/paas/v4')
  }
  return baseUrl
}

function replaceBigModelApiPath(baseUrl: string, targetApiPath: string): string {
  try {
    const url = new URL(baseUrl)
    const path = url.pathname.replace(/\/+$/, '')
    const match = path.match(/^(.*\/api)(?:\/(?:coding\/paas\/v4|paas\/v4|anthropic))?(?:\/(?:v\d+\/)?(?:chat\/completions|messages|responses|text\/chatcompletion_v2|text\/chatcompletion_pro))?$/i)
    if (!match) return baseUrl
    url.pathname = `${match[1]}/${targetApiPath}`
    return url.toString().replace(/\/+$/, '')
  } catch {
    return baseUrl
      .replace(/\/+$/, '')
      .replace(
        /(\/api)(?:\/(?:coding\/paas\/v4|paas\/v4|anthropic))?(?:\/(?:v\d+\/)?(?:chat\/completions|messages|responses|text\/chatcompletion_v2|text\/chatcompletion_pro))?$/i,
        `$1/${targetApiPath}`
      )
  }
}

function sanitizeEndpointUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url.replace(/\/\/[^/@\s]+@/, '//')
  }
}

function supportsAnthropicThinkingBlocks(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.anthropic.com' || host.endsWith('.anthropic.com')
  } catch {
    return /\banthropic\.com\b/i.test(baseUrl)
  }
}

function supportsMessagesThinkingBlocks(baseUrl: string): boolean {
  return supportsAnthropicThinkingBlocks(baseUrl) || isDeepSeekHost(baseUrl)
}

function stripKnownEndpointPath(baseUrl: string): string {
  const lower = baseUrl.toLowerCase()
  for (const path of [
    'chat/completions',
    'text/chatcompletion_v2',
    'text/chatcompletion_pro',
    'responses',
    'messages'
  ]) {
    if (lower.endsWith(`/${path}`)) {
      return baseUrl.slice(0, -path.length).replace(/\/+$/, '')
    }
  }
  return baseUrl
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return buildModelEndpointUrl(baseUrl, 'chat_completions')
}

function responsesOutputText(output: ResponsesApiResponse['output']): string {
  const parts: string[] = []
  for (const item of output ?? []) {
    if (recordString(item, 'type') !== 'message') continue
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const type = recordString(record, 'type')
      if (type === 'output_text' || type === 'text') {
        const text = recordString(record, 'text')
        if (text) parts.push(text)
      }
    }
  }
  return parts.join('')
}

function responseStreamCallId(
  payload: Record<string, unknown>,
  pendingArguments: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>
): string {
  const explicit = recordString(payload, 'call_id')
  if (explicit) return explicit
  const itemId = recordString(payload, 'item_id')
  if (itemId && pendingArguments.has(itemId)) return itemId
  const index = numericIndex(payload.output_index)
  if (index !== undefined) {
    return pendingByIndex.get(index) ?? indexFallbackCallId(index, pendingArguments)
  }
  if (pendingArguments.size === 1) return [...pendingArguments.keys()][0]
  return indexFallbackCallId(undefined, pendingArguments)
}

function anthropicStreamCallId(
  index: number | undefined,
  pendingArguments: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>
): string {
  if (index !== undefined) {
    return pendingByIndex.get(index) ?? indexFallbackCallId(index, pendingArguments)
  }
  if (pendingArguments.size === 1) return [...pendingArguments.keys()][0]
  return indexFallbackCallId(undefined, pendingArguments)
}

function indexFallbackCallId(index: number | undefined, pendingArguments: Map<string, PendingToolCall>): string {
  return index === undefined ? `call_${pendingArguments.size + 1}` : `call_${index + 1}`
}

function responseErrorMessage(payload: Record<string, unknown>): string {
  const error = recordValue(payload, 'error') ?? recordValue(recordValue(payload, 'response'), 'error')
  const message = error ? recordString(error, 'message') : ''
  return message || recordString(payload, 'message') || 'model stream reported an error'
}

function anthropicStopReason(value: unknown): ModelStopReason | undefined {
  if (typeof value !== 'string') return undefined
  switch (value) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    default:
      return undefined
  }
}

function recordValue(value: unknown, key?: string): Record<string, unknown> | null {
  const target = key === undefined
    ? value
    : value && typeof value === 'object'
      ? (value as Record<string, unknown>)[key]
      : null
  return target && typeof target === 'object' && !Array.isArray(target)
    ? target as Record<string, unknown>
    : null
}

function recordString(value: unknown, key: string): string {
  const target = value && typeof value === 'object'
    ? (value as Record<string, unknown>)[key]
    : undefined
  return typeof target === 'string' ? target : ''
}

function mergeUsageSnapshots(current: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  if (!current) return next
  const promptTokens = next.promptTokens || current.promptTokens
  const completionTokens = Math.max(next.completionTokens, current.completionTokens)
  const totalTokens = next.totalTokens > 0 && next.promptTokens > 0
    ? next.totalTokens
    : promptTokens + completionTokens
  return {
    ...current,
    ...next,
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens: Math.max(current.cachedTokens ?? 0, next.cachedTokens ?? 0),
    cacheHitTokens: Math.max(current.cacheHitTokens ?? 0, next.cacheHitTokens ?? 0),
    cacheMissTokens: Math.max(current.cacheMissTokens ?? 0, next.cacheMissTokens ?? 0),
    cacheHitRate: next.cacheHitRate ?? current.cacheHitRate,
    costUsd: next.costUsd ?? current.costUsd,
    costCny: next.costCny ?? current.costCny,
    cacheSavingsUsd: next.cacheSavingsUsd ?? current.cacheSavingsUsd,
    cacheSavingsCny: next.cacheSavingsCny ?? current.cacheSavingsCny
  }
}

function applyReasoningEffort(
  body: Record<string, unknown>,
  effort: string | undefined,
  options: { thinkingDialect?: ThinkingDialect } = {}
): void {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return
  const thinkingDialect = options.thinkingDialect ?? 'none'
  switch (normalized) {
    case 'off':
    case 'disabled':
    case 'none':
    case 'false':
      applyThinking(body, thinkingDialect, false)
      break
    case 'low':
    case 'minimal':
    case 'medium':
    case 'mid':
    case 'high':
      body.reasoning_effort = 'high'
      applyThinking(body, thinkingDialect, true)
      break
    case 'max':
    case 'maximum':
    case 'xhigh':
      body.reasoning_effort = 'max'
      applyThinking(body, thinkingDialect, true)
      break
  }
}

type ThinkingDialect = 'deepseek' | 'minimax' | 'zai' | 'none'

function requestThinkingDialect(dialect: string): ThinkingDialect {
  return dialect === 'deepseek' || dialect === 'minimax' || dialect === 'zai'
    ? dialect
    : 'none'
}

function applyThinking(
  body: Record<string, unknown>,
  dialect: ThinkingDialect,
  enabled: boolean
): void {
  switch (dialect) {
    case 'deepseek':
      body.thinking = { type: enabled ? 'enabled' : 'disabled' }
      break
    case 'minimax':
      body.thinking = { type: enabled ? 'adaptive' : 'disabled' }
      break
    case 'zai':
      body.thinking = enabled ? { type: 'enabled', clear_thinking: true } : { type: 'disabled' }
      break
    case 'none':
      break
  }
}

function shouldRetryWithoutStreamUsage(
  status: number,
  text: string,
  body: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false
  if (!Object.prototype.hasOwnProperty.call(body, 'stream_options')) return false
  if (/\b(stream_options|include_usage)\b/i.test(text)) return true
  return !hasReasoningControlField(body) && isGenericZhipuMessages1214Error(text)
}

function shouldRetryWithoutReasoningFields(
  status: number,
  text: string,
  body: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 422) return false
  if (!hasReasoningControlField(body)) return false
  return /\b(reasoning_effort|reasoning_content|thinking|reasoning)\b/i.test(text) ||
    isGenericZhipuMessages1214Error(text)
}

function hasReasoningControlField(body: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(body, 'reasoning_effort') ||
    Object.prototype.hasOwnProperty.call(body, 'thinking')
}

function isGenericZhipuMessages1214Error(text: string): boolean {
  return /\b1214\b/.test(text) && /messages/i.test(text) && /参数非法|invalid/i.test(text)
}

function isThinkingMode(effort: string | undefined): boolean {
  const normalized = effort?.trim().toLowerCase()
  if (!normalized) return false
  return !['off', 'disabled', 'none', 'false'].includes(normalized)
}

function hasAssistantReasoning(items: readonly TurnItem[]): boolean {
  return items.some((item) => item.kind === 'assistant_reasoning')
}

function requiresReasoningRoundTrip(
  effort: string | undefined,
  model: string | undefined,
  baseUrl: string
): boolean {
  // Thinking-mode round trip is a DeepSeek-specific protocol extension.
  // OpenAI-compat providers (OpenRouter, llama.cpp, etc.) may reject
  // or misinterpret the `thinking` field, so we only auto-enable it
  // on the official DeepSeek host. User-selected reasoningEffort still
  // forces the path (opt-in). See issue #26.
  return isThinkingMode(effort) || (isDeepSeekHost(baseUrl) && isThinkingProducerModel(model))
}

function reasoningContentOrSpace(text: string): string {
  return text.trim() ? text : ' '
}

/**
 * Some strict OpenAI-compatible providers (notably MiniMax, error 2013
 * "chat content is empty") reject any message whose `content` is null,
 * undefined, or an empty/whitespace-only string. The chat_completions path
 * legitimately produces empty content in two cases:
 *   - an assistant message that only carries tool_calls (no preamble text)
 *   - a tool-result message whose output was empty
 *
 * Both are valid OpenAI chat-completions shapes, but to stay compatible with
 * strict providers we coerce empty/null content to a short non-whitespace
 * placeholder. We deliberately avoid a bare space because some providers trim
 * content before the emptiness check. Messages with real content are left
 * untouched.
 */
function sanitizeEmptyMessageContent(messages: ChatMessage[], baseUrl?: string, model?: string): ChatMessage[] {
  // Some providers (notably MiniMax, error 2013 "chat content is empty") reject
  // a missing/empty content field on assistant messages even when tool_calls
  // are present. For those providers we must supply a placeholder. For others,
  // the OpenAI-spec-compliant shape (omit content) is preferred because a
  // visible placeholder can pollute the conversation the model sees.
  const requireAssistantContent = compatibilityProfileForModel({
    baseUrl: baseUrl ?? '',
    model
  }).requiresAssistantContentForToolCalls
  return messages.map((message) => {
    if (!isEmptyContent(message.content)) return message
    if (message.role === 'assistant') {
      if (requireAssistantContent) {
        // Strict provider: supply a minimal non-whitespace placeholder that is
        // not visible if the model echoes conversation history. MiniMax M3 can
        // otherwise leak a visible placeholder like "(tool call)" into content.
        return { ...message, content: STRICT_PROVIDER_EMPTY_CONTENT_PLACEHOLDER }
      }
      // Spec-compliant: omit the content key entirely. Most providers accept an
      // assistant message carrying only tool_calls with content omitted.
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(message)) {
        if (key !== 'content') sanitized[key] = value
      }
      return sanitized as unknown as ChatMessage
    }
    if (message.role === 'tool') {
      // Tool messages require a non-empty content string; use a placeholder
      // that is invisible if the model echoes conversation history.
      return { ...message, content: STRICT_PROVIDER_EMPTY_CONTENT_PLACEHOLDER }
    }
    // user/system should never reach here with empty content; leave as-is so
    // any upstream bug surfaces instead of being masked.
    return message
  })
}

function isEmptyContent(content: unknown): boolean {
  if (content === null || content === undefined) return true
  if (typeof content === 'string') return content.trim().length === 0
  if (Array.isArray(content)) {
    // An array is "empty" if it has no parts, or all parts are empty text.
    if (content.length === 0) return true
    return content.every((part) => {
      if (part && typeof part === 'object' && 'type' in part && part.type === 'text') {
        return typeof (part as { text?: unknown }).text === 'string'
          && (part as { text: string }).text.trim().length === 0
      }
      return false
    })
  }
  return false
}

/**
 * Diagnostic helper: logs any message that still has empty content AFTER
 * sanitization, plus a compact dump of the whole messages array. Runs on every
 * chat_completions request so we can pinpoint which message shape triggers
 * strict-provider 2013 errors. If this logs, sanitization missed a case.
 */
function diagnoseEmptyContent(messages: ChatMessage[], baseUrl: string): void {
  const offenders = messages
    .map((message, index) => ({ index, message }))
    .filter((entry) => {
      const msg = entry.message as ChatMessage & { content?: unknown }
      // After sanitization, assistant tool-call messages carry a placeholder
      // ('(tool call)') so they should never be empty. Any message that is
      // STILL empty here means sanitization missed a case.
      return isEmptyContent(msg.content)
    })
  if (offenders.length === 0) return
  // eslint-disable-next-line no-console
  console.warn(
    `[diagnoseEmptyContent] ${offenders.length} empty-content message(s) STILL PRESENT after sanitization for ${baseUrl}:`,
    JSON.stringify(
      messages.map((m, i) => ({
        i,
        role: m.role,
        content: m.content,
        contentType: Array.isArray(m.content) ? 'array' : typeof m.content,
        hasContentKey: 'content' in m,
        hasToolCalls: Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
        reasoningContent: (m as ChatMessage & { reasoning_content?: unknown }).reasoning_content
      })),
      null,
      0
    )
  )
}

/**
 * Diagnostic helper: when a provider rejects a request with a content/shape
 * error (e.g. MiniMax 2013 "chat content is empty"), dump the full request
 * body so we can see exactly what was sent. Only fires for bad-request-style
 * rejections to avoid noise on normal errors (auth, rate limit, etc.).
 */
function diagnoseRejectedRequest(
  url: string,
  body: Record<string, unknown>,
  status: number,
  errorText: string
): void {
  if (status !== 400 && !/content is empty|empty.*content|2013/i.test(errorText)) return
  const messages = Array.isArray(body.messages) ? body.messages : []
  // eslint-disable-next-line no-console
  console.warn(
    `[diagnoseRejectedRequest] ${status} from ${sanitizeEndpointUrl(url)} — provider rejected request body:`,
    '\nerror:', errorText.slice(0, 500),
    '\nmessage overview (i/role/empty/len/hasToolCalls):',
    messages.map((m: Record<string, unknown>, i: number) => {
      const c = m.content
      const len = typeof c === 'string' ? c.length : Array.isArray(c) ? JSON.stringify(c).length : -1
      const empty = c == null || (typeof c === 'string' && c.trim() === '') || (Array.isArray(c) && c.length === 0)
      return { i, role: m.role, empty, len, hasToolCalls: Array.isArray(m.tool_calls) && m.tool_calls.length > 0 }
    }),
    '\nempty messages full detail:',
    JSON.stringify(
      messages
        .map((m: Record<string, unknown>, i: number) => ({ i, m }))
        .filter((e) => {
          const c = e.m.content
          return c == null || (typeof c === 'string' && c.trim() === '') || (Array.isArray(c) && c.length === 0)
        }),
      null,
      0
    ),
    '\nbody keys:', Object.keys(body)
  )
}

function toolResultContent(output: unknown): string {
  if (typeof output === 'string') return output
  return JSON.stringify(output) ?? ''
}

function formatFoldedToolHistoryMessage(
  calls: Extract<TurnItem, { kind: 'tool_call' }>[],
  results: Extract<TurnItem, { kind: 'tool_result' }>[],
  assistantText: string[]
): string {
  const sections: string[] = []
  const intro = assistantText.map((text) => text.trim()).filter(Boolean).join('\n')
  sections.push('<qiongqi_internal_tool_context>')
  sections.push('purpose: historical tool result for model context only')
  sections.push('instruction: do not quote, summarize, or repeat this block in the user-facing answer')
  if (intro) sections.push(['assistant_preface:', intro].join('\n'))
  for (const call of calls) {
    const result = results.find((item) => item.callId === call.callId)
    const status = result?.isError ? 'failed' : 'returned'
    const args = JSON.stringify(call.arguments) ?? '{}'
    const output = result ? toolResultContent(result.output) : ''
    sections.push([
      'tool_result:',
      `tool: ${call.toolName}`,
      `call_id: ${call.callId}`,
      `status: ${status}`,
      `arguments_json: ${args}`,
      output ? `result:\n${output}` : 'result:'
    ].join('\n'))
  }
  sections.push('</qiongqi_internal_tool_context>')
  return sections.join('\n\n')
}

function stripLegacyFoldedToolHistory(text: string): string {
  if (!text.includes('Tool ') || !text.includes('Arguments:') || !text.includes('Result:')) return text
  const lines = text.split('\n')
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const next = lines[index + 1] ?? ''
    if (isLegacyFoldedToolHeader(line) && next.trimStart().startsWith('Arguments:')) {
      index += 2
      if ((lines[index] ?? '').trim() === 'Result:') {
        index += 1
        if ((lines[index] ?? '').trim() === '```') {
          index += 1
          while (index < lines.length && (lines[index] ?? '').trim() !== '```') {
            index += 1
          }
          if (index < lines.length) index += 1
        } else {
          while (index < lines.length) {
            const current = lines[index] ?? ''
            const following = lines[index + 1] ?? ''
            if (!current.trim()) break
            if (isLegacyFoldedToolHeader(current) && following.trimStart().startsWith('Arguments:')) break
            index += 1
          }
        }
      }
      while (index < lines.length && !(lines[index] ?? '').trim()) {
        index += 1
      }
      if (out.length > 0 && out[out.length - 1]?.trim() && index < lines.length) {
        out.push('')
      }
      continue
    }
    out.push(line)
    index += 1
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isLegacyFoldedToolHeader(line: string): boolean {
  return /^Tool [A-Za-z0-9_.-]+ (returned|failed)\.$/.test(line.trim())
}

function reasoningFromMessage(message: ChatCompletionResponse['choices'][number]['message'] | undefined): string {
  if (!message) return ''
  const value = message.reasoning_content ??
    (message as ChatMessage & { reasoning?: unknown }).reasoning
  return typeof value === 'string' ? value : ''
}

function reasoningSignatureFromItems(
  items: TurnItem[],
  fromInclusive: number,
  toExclusive: number,
  turnId: string
): Pick<ChatMessage, 'reasoning_signature'> {
  for (let index = fromInclusive; index < toExclusive; index += 1) {
    const item = items[index]
    if (item?.kind === 'assistant_reasoning' && item.turnId === turnId && item.signature) {
      return { reasoning_signature: item.signature }
    }
  }
  return {}
}

function isPreToolCallBridgeItem(item: TurnItem, turnId: string): boolean {
  if (item.turnId !== turnId) return false
  return item.kind === 'assistant_reasoning' ||
    item.kind === 'assistant_text' ||
    item.kind === 'approval' ||
    item.kind === 'user_input' ||
    item.kind === 'error'
}

function isBridgeItemBeforeToolCall(items: TurnItem[], index: number): boolean {
  const item = items[index]
  if (!item || (item.kind !== 'assistant_reasoning' && item.kind !== 'assistant_text')) {
    return false
  }
  let cursor = index + 1
  while (cursor < items.length) {
    const next = items[cursor]
    if (!next) return false
    if (isPreToolCallBridgeItem(next, item.turnId)) {
      cursor += 1
      continue
    }
    return next.kind === 'tool_call' && next.turnId === item.turnId
  }
  return false
}

function normalizeThinkingAssistantMessages(
  messages: ChatMessage[],
  thinkingMode: boolean
): ChatMessage[] {
  if (!thinkingMode) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const next = { ...message }
    if (next.content == null) next.content = ''
    if (
      !Object.prototype.hasOwnProperty.call(next, 'reasoning_content') ||
      next.reasoning_content == null ||
      !next.reasoning_content.trim()
    ) {
      next.reasoning_content = ' '
    }
    return next
  })
}

type InlineToolCallParseResult = {
  toolName: string
  arguments: Record<string, unknown>
}

function consumeInlineToolCallContent(
  content: string,
  state: InlineToolCallState
): {
  consumed: boolean
  visibleText: string
  call?: { callId: string; toolName: string; arguments: Record<string, unknown> }
} {
  const combined = state.buffer ? `${state.buffer}${content}` : content
  const markerIndex = inlineToolCallMarkerIndex(combined)
  if (markerIndex < 0) {
    return { consumed: false, visibleText: content }
  }
  const visibleText = state.buffer ? '' : combined.slice(0, markerIndex)
  const protocolText = combined.slice(markerIndex)
  const parsed = parseInlineToolCallProtocol(protocolText)
  if (!parsed) {
    state.buffer = protocolText.slice(-32_768)
    return { consumed: true, visibleText }
  }
  state.buffer = ''
  const callId = `call_inline_${state.nextId++}`
  return {
    consumed: true,
    visibleText,
    call: {
      callId,
      toolName: parsed.toolName,
      arguments: parsed.arguments
    }
  }
}

function inlineToolCallMarkerIndex(text: string): number {
  const markers = [
    /\(\s*tool\s+call\b/i,
    /<function_calls>/i,
    /<tool_call\b/i,
    /<invoke\s+name=/i,
    /<action>\s*\w+/i,
    /\[<invoke\s+name=/i,
    /\[<parameter\s+name=/i
  ]
  let index = -1
  for (const marker of markers) {
    const match = marker.exec(text)
    if (!match) continue
    index = index < 0 ? match.index : Math.min(index, match.index)
  }
  return index
}

function parseInlineToolCallProtocol(text: string): InlineToolCallParseResult | null {
  const json = extractFirstBalancedJsonObject(text)
  const explicitToolName = toolNameFromInlineToolCall(text)
  if (json) {
    const repaired = repairToolArguments(json).arguments
    if (Object.keys(repaired).length > 0) {
      return {
        toolName: explicitToolName ?? 'bash',
        arguments: repaired
      }
    }
  }

  const actionMatch = text.match(/<action>\s*([a-zA-Z0-9_-]+)\s*(?:\]\[)?<\/action>\]?\s*([\s\S]*)/i)
  if (actionMatch?.[1]) {
    const command = cleanInlineToolCommand(actionMatch[2] ?? '')
    if (command) {
      return {
        toolName: explicitToolName ?? 'bash',
        arguments: { action: actionMatch[1], command }
      }
    }
  }

  const commandMatch = text.match(/\[?<command>([\s\S]*?)(?:<\/command>\]?|\[<\/command>\]|$)/i)
  if (commandMatch?.[1]) {
    const command = cleanInlineToolCommand(commandMatch[1])
    if (command) {
      return {
        toolName: explicitToolName ?? 'bash',
        arguments: { action: 'run', command }
      }
    }
  }

  const bracketParameterMatch = text.match(/\[<parameter\s+name="([^"]+)">([\s\S]*?)(?:\]\s*(?:\[|$)|$)/i)
  if (bracketParameterMatch?.[1]) {
    const value = cleanInlineToolCommand(bracketParameterMatch[2] ?? '')
    if (value) {
      return {
        toolName: explicitToolName ?? 'bash',
        arguments: { [bracketParameterMatch[1]]: value }
      }
    }
  }

  return null
}

function toolNameFromInlineToolCall(text: string): string | undefined {
  return text.match(/\(\s*tool\s+call\s+([a-zA-Z0-9_.-]+)\s*:/i)?.[1] ??
    text.match(/\[?<invoke\s+name="([^"]+)">\]?/i)?.[1]
}

function extractFirstBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (char === '\\') {
        escape = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function cleanInlineToolCommand(value: string): string {
  return value
    .replace(/\[<\/(?:action|command|parameter|invoke|tool_call|function_calls)>\]/gi, '')
    .replace(/<\/(?:action|command|parameter|invoke|tool_call|function_calls)>/gi, '')
    .replace(/<\]minimax\[>/gi, '')
    .replace(/\]\s*$/g, '')
    .trim()
}

/**
 * Ensure the request has at least one non-system message. Some providers
 * (notably MiniMax, error 2013 "chat content is empty") reject a request that
 * contains ONLY system messages with no user/assistant turn to respond to.
 * This happens after aggressive compaction folds the conversation into a
 * single system summary and the recent tail is absent (e.g. a tool-call loop
 * resumed with only the summary). Inject a minimal user message so the model
 * has content to respond to.
 */
function ensureUserMessagePresent(messages: ChatMessage[]): ChatMessage[] {
  const hasNonSystem = messages.some((m) => m.role !== 'system')
  if (hasNonSystem) return messages
  return [...messages, { role: 'user', content: ACTIVE_TASK_CONTINUATION_MESSAGE } as ChatMessage]
}

function normalizeGlmMessages(messages: ChatMessage[]): ChatMessage[] {
  const systemContent: string[] = []
  const nonSystemMessages: ChatMessage[] = []

  for (const message of messages) {
    if (message.role !== 'system') {
      nonSystemMessages.push(message)
      continue
    }
    const content = chatMessageTextContent(message.content).trim()
    if (content) systemContent.push(content)
  }

  if (systemContent.length === 0) return nonSystemMessages
  const systemMessage: ChatMessage = {
    role: 'system',
    content: systemContent.join('\n\n')
  }
  if (nonSystemMessages.length === 0) {
    return [
      systemMessage,
      { role: 'user', content: ACTIVE_TASK_CONTINUATION_MESSAGE }
    ]
  }
  // Zhipu GLM rejects (error 1214 "messages 参数非法") when the first
  // conversational message is not a user message — e.g. after compaction
  // folds history into a system summary whose following tail starts with an
  // assistant turn. Insert a minimal user message to lead the conversation.
  if (nonSystemMessages[0]?.role !== 'user') {
    return [systemMessage, { role: 'user', content: ACTIVE_TASK_CONTINUATION_MESSAGE }, ...nonSystemMessages]
  }
  return [systemMessage, ...nonSystemMessages]
}

function chatMessageTextContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is Extract<ChatMessageContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function canonicalizeSchema(value: unknown): Record<string, unknown> {
  const canonical = canonicalize(value)
  return canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? canonical as Record<string, unknown>
    : {}
}

function normalizeStreamIdleTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(value)) return DEFAULT_STREAM_IDLE_TIMEOUT_MS
  return Math.max(0, Math.floor(value))
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number
): Promise<StreamReadResult> {
  if (signal.aborted) return { kind: 'aborted' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cleanupAbort: (() => void) | undefined
  const readPromise = reader.read()
    .then((result): StreamReadResult => ({ kind: 'chunk', ...result }))
    .catch((error): StreamReadResult => {
      if (signal.aborted) return { kind: 'aborted' }
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', message: `model stream read failed: ${message}` }
    })
  const abortPromise = new Promise<StreamReadResult>((resolve) => {
    const onAbort = (): void => resolve({ kind: 'aborted' })
    if (signal.aborted) {
      resolve({ kind: 'aborted' })
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanupAbort = () => signal.removeEventListener('abort', onAbort)
  })
  const candidates: Array<Promise<StreamReadResult>> = [readPromise, abortPromise]
  if (idleTimeoutMs > 0) {
    candidates.push(new Promise<StreamReadResult>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: 'timeout' }), idleTimeoutMs)
    }))
  }
  const result = await Promise.race(candidates)
  if (timeout) clearTimeout(timeout)
  cleanupAbort?.()
  if (result.kind === 'timeout') {
    try {
      await reader.cancel('model stream idle timeout')
    } catch {
      // Best-effort cancellation; the caller will surface the timeout.
    }
  }
  return result
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key])
  }
  return out
}

function resolveToolCallDeltaId(
  call: { index?: number; id?: string },
  pending: Map<string, PendingToolCall>
): string {
  const index = numericIndex(call.index)
  const existingByIndex = findPendingToolCallIdByIndex(pending, index)
  if (call.id) {
    if (existingByIndex && existingByIndex !== call.id) {
      const existing = pending.get(existingByIndex)
      if (existing) {
        pending.delete(existingByIndex)
        pending.set(call.id, existing)
      }
    }
    return call.id
  }
  return existingByIndex ?? `call_${pending.size + 1}`
}

function findPendingToolCallIdByIndex(
  pending: Map<string, PendingToolCall>,
  index: number | undefined
): string | undefined {
  if (index === undefined) return undefined
  for (const [callId, value] of pending) {
    if (value.index === index) return callId
  }
  return undefined
}

function numericIndex(index: unknown): number | undefined {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0
    ? index
    : undefined
}

function healToolMessagePairs(messages: ChatMessage[]): ChatMessage[] {
  const healed: ChatMessage[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role === 'tool') {
      continue
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const expectedIds = new Set(message.tool_calls.map((call) => call.id))
      const toolResults: ChatMessage[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        const toolResult = messages[j]
        if (toolResult.tool_call_id && expectedIds.has(toolResult.tool_call_id)) {
          toolResults.push(toolResult)
        }
        j += 1
      }
      const seenIds = new Set(toolResults.map((toolResult) => toolResult.tool_call_id))
      if ([...expectedIds].every((id) => seenIds.has(id))) {
        healed.push(message, ...toolResults)
      }
      i = j - 1
      continue
    }
    healed.push(message)
  }
  return healed
}

function attachImagesToLatestUserMessage(
  messages: ChatMessage[],
  attachments: NonNullable<ModelRequest['attachments']>
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const parts: ChatMessageContentPart[] = []
    if (typeof message.content === 'string' && message.content) {
      parts.push({ type: 'text', text: message.content })
    }
    for (const attachment of attachments) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
        }
      })
    }
    message.content = parts
    return
  }
}

function attachTextFallbacksToLatestUserMessage(
  messages: ChatMessage[],
  attachments: NonNullable<ModelRequest['attachmentTextFallbacks']>
): void {
  const text = attachments.map(formatAttachmentTextFallback).join('\n\n')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = message.content ? `${message.content}\n\n${text}` : text
      return
    }
    if (Array.isArray(message.content)) {
      message.content.push({ type: 'text', text })
      return
    }
    message.content = text
    return
  }
}

function formatAttachmentTextFallback(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  const isImage = attachment.mimeType.toLowerCase().startsWith('image/')
  // Non-image files and image fallbacks with no inlined bytes surface as a
  // metadata-only block; the model reads the file content via tools/artifacts.
  if (!isImage || !attachment.dataBase64) {
    return [
      '[Attached file]',
      `Name: ${attachment.name}`,
      `MIME: ${attachment.mimeType}`,
      `Bytes: ${attachment.byteSize}`,
      '[/Attached file]'
    ].join('\n')
  }
  return [
    '[Attached image as base64 text]',
    `Name: ${attachment.name}`,
    `MIME: ${attachment.mimeType}`,
    `Dimensions: ${formatAttachmentDimensions(attachment)}`,
    `Bytes: ${attachment.byteSize}`,
    'Base64:',
    '```base64',
    attachment.dataBase64,
    '```',
    '[/Attached image]'
  ].join('\n')
}

function formatAttachmentDimensions(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  return attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : 'unknown'
}

function limitHistoryPreservingCompaction(history: TurnItem[], windowSize: number): TurnItem[] {
  if (history.length <= windowSize) return history
  const windowStart = history.length - windowSize
  const limited = history.slice(windowStart)
  if (limited.some((item) => item.kind === 'compaction' && item.replacedTokens > 0)) {
    return limited
  }
  for (let index = windowStart - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind !== 'compaction' || item.replacedTokens === 0) continue
    return windowSize <= 1 ? [item] : [item, ...history.slice(-(windowSize - 1))]
  }
  return limited
}

/**
 * Backward-compatibility alias. Prefer `ModelCompatClient` in new code.
 *
 * @deprecated since stage 1.3 — use `ModelCompatClient` instead.
 */
export const DeepseekCompatModelClient = ModelCompatClient
