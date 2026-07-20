import { randomUUID } from 'node:crypto'
import {
  ModelProposalSchema,
  NormalizedModelCompletionSchema,
  type ModelProposal,
  type NormalizedModelCompletion
} from '@qiongqi/contracts'
import type { ModelStreamChunk } from '@qiongqi/ports'

export type ModelProtocolNormalizerOptions = {
  provider?: string
  model?: string
  endpointFormat?: 'chat_completions' | 'responses' | 'messages'
}

const LEAKED_PROTOCOL_MARKERS = [
  '<action>',
  '</action>',
  '<tool_call>',
  '</tool_call>',
  '(tool call)',
  '[tool call]',
  '<|tool|>',
  // Model-native protocol markers observed leaking from various providers
  // (OpenAI, Anthropic, vLLM, llama.cpp, GLM, MiniMax, Qwen, etc.)
  '<function_call>',
  '</function_call>',
  '<function_calls>',
  '</function_calls>',
  '<|function_call|>',
  '<|endoftext|>',
  '<|im_start|>',
  '<|im_end|>',
  '<|observation|>',
  '<|assistant|>',
  '<|user|>',
  '<|system|>',
  // GLM/ChatGLM bracket-style markers
  '[gMASK]',
  '[MASK]',
  '<|begin_of_sentence|>',
  '<|end_of_sentence|>',
  // Anthropic/Claude inline leaks
  '<antml:function_calls>',
  '</antml:function_calls>',
  '<antml:invoke>',
  '</antml:invoke>',
  '<antml:parameter>',
  '</antml:parameter>',
  // Open-source model (llama.cpp/vLLM/Ollama) function-calling protocol
  '<|python_tag|>',
  '<function=',
  '</function>',
  '<|start_header_id|>',
  '<|end_header_id|>',
  '<|eot_id|>',
]

function hasLeakedProtocolText(text: string): boolean {
  const lower = text.toLowerCase()
  return LEAKED_PROTOCOL_MARKERS.some((marker) => lower.includes(marker))
}

/**
 * Strip protocol markers from the accumulated text. This is a last-resort
 * sanitization that mirrors what {@link sanitizeModelText} does at the
 * per-chunk level. It runs in {@link normalizeModelCompletion} to ensure
 * that text accumulated across chunks is clean before the
 * {@link hasLeakedProtocolText} check.
 *
 * We do NOT import `sanitizeModelText` from `@qiongqi/adapter-model`
 * because this package (engine/loop) deliberately avoids a dependency on
 * the adapter layer.
 */
function stripProtocolMarkers(text: string): string {
  let out = text
  for (const marker of LEAKED_PROTOCOL_MARKERS) {
    // Split on the marker and rejoin; this handles both the marker and
    // its case-insensitive variants (the marker list is already lowercase).
    const parts = out.split(marker)
    if (parts.length > 1) out = parts.join('')
  }
  // Also strip `<action>`-style tags generically: any `<tagname>` or
  // `</tagname>` that matches a known protocol pattern.
  out = out.replace(/<\/?(?:action|tool_call|function_calls?|invoke|parameter|antml:[a-z_]+|python_tag)>/gi, '')
  out = out.replace(/<\|[^|>]*\|>/g, '')
  return out
}

function stopClassFor(chunk: Extract<ModelStreamChunk, { kind: 'completed' }>): NormalizedModelCompletion['stopClass'] {
  if (chunk.stopClass) return chunk.stopClass
  if (chunk.stopReason === 'tool_calls') return 'tool_calls'
  if (chunk.stopReason === 'length') return 'length'
  if (chunk.stopReason === 'error') return 'protocol_error'
  return 'normal'
}

export async function normalizeModelCompletion(
  input: AsyncIterable<ModelStreamChunk> | Iterable<ModelStreamChunk>,
  options: ModelProtocolNormalizerOptions = {}
): Promise<NormalizedModelCompletion> {
  let text = ''
  let reasoning = ''
  let completed: Extract<ModelStreamChunk, { kind: 'completed' }> | undefined
  let providerReason: string | undefined
  let rawMetadata: Record<string, unknown> | undefined
  let malformedToolCall = false
  const pending = new Map<string, { toolName?: string; arguments: string }>()
  const intents = new Map<string, { callId: string; toolName: string; arguments: Record<string, unknown> }>()

  for await (const chunk of input) {
    switch (chunk.kind) {
      case 'assistant_text_delta':
        text += chunk.text
        break
      case 'assistant_reasoning_delta':
        reasoning += chunk.text
        break
      case 'tool_call_delta': {
        const current = pending.get(chunk.callId) ?? { arguments: '' }
        if (chunk.toolName) current.toolName = chunk.toolName
        if (chunk.argumentsDelta) current.arguments += chunk.argumentsDelta
        pending.set(chunk.callId, current)
        break
      }
      case 'tool_call_complete':
        if (!chunk.callId || !chunk.toolName || !chunk.arguments || typeof chunk.arguments !== 'object' || Array.isArray(chunk.arguments)) {
          malformedToolCall = true
        } else {
          intents.set(chunk.callId, { callId: chunk.callId, toolName: chunk.toolName, arguments: chunk.arguments })
          pending.delete(chunk.callId)
        }
        break
      case 'completed':
        completed = chunk
        providerReason = chunk.providerReason
        rawMetadata = chunk.rawMetadata
        break
      case 'error':
        completed = { kind: 'completed', stopReason: 'error', stopClass: 'transport_error', providerReason: chunk.providerReason ?? chunk.code, rawMetadata: chunk.rawMetadata }
        providerReason = chunk.providerReason ?? chunk.code
        rawMetadata = chunk.rawMetadata
        break
      case 'usage':
        break
    }
  }

  for (const [callId, call] of pending) {
    try {
      const parsed = JSON.parse(call.arguments)
      if (!call.toolName || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid tool arguments')
      intents.set(callId, { callId, toolName: call.toolName, arguments: parsed as Record<string, unknown> })
    } catch {
      malformedToolCall = true
    }
  }
  const stop = completed ?? { kind: 'completed' as const, stopReason: 'stop' as const }
  const leakedProtocolText = hasLeakedProtocolText(text)
  // Strip protocol markers from the visible text so downstream consumers
  // (classifier, renderer, evaluator) see clean output. Only discard tool
  // intents when the tool calls themselves are structurally malformed;
  // leaked protocol text in the content channel is a cosmetic / rendering
  // issue and does not invalidate properly-parsed tool calls.
  const cleanText = leakedProtocolText ? stripProtocolMarkers(text) : text
  const integrity = {
    leakedProtocolText,
    malformedToolCall,
    completeToolCalls: pending.size === 0 && !malformedToolCall
  }
  const normalized = NormalizedModelCompletionSchema.parse({
    stopClass: stopClassFor(stop),
    providerReason,
    endpointFormat: stop.endpointFormat ?? options.endpointFormat,
    provider: stop.provider ?? options.provider,
    rawMetadata,
    integrity,
    text: cleanText,
    reasoning,
    toolIntents: malformedToolCall ? [] : [...intents.values()]
  })
  return normalized
}

export function makeModelProposal(completion: NormalizedModelCompletion, options: { model: string; proposalId?: string }): ModelProposal {
  return ModelProposalSchema.parse({ ...completion, proposalId: options.proposalId ?? randomUUID(), model: options.model })
}
