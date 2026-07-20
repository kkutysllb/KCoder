import { describe, expect, it } from 'vitest'
import { normalizeModelCompletion } from '@qiongqi/loop'

describe('model protocol normalizer', () => {
  it('normalizes text and native tool frames', async () => {
    const result = await normalizeModelCompletion([
      { kind: 'assistant_text_delta', text: '先检查。' },
      { kind: 'tool_call_complete', callId: 'c1', toolName: 'bash', arguments: { command: 'pwd' } },
      { kind: 'completed', stopReason: 'tool_calls', provider: 'minimax', endpointFormat: 'chat_completions' }
    ])
    expect(result).toMatchObject({ stopClass: 'tool_calls', provider: 'minimax', text: '先检查。' })
    expect(result.toolIntents).toEqual([{ callId: 'c1', toolName: 'bash', arguments: { command: 'pwd' } }])
  })

  it('quarantines leaked protocol text instead of creating tool intents', async () => {
    const result = await normalizeModelCompletion([
      { kind: 'assistant_text_delta', text: '[tool call] ls /tmp' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    expect(result.integrity.leakedProtocolText).toBe(true)
    expect(result.toolIntents).toEqual([])
  })

  it('refuses partial or malformed tool frames', async () => {
    const result = await normalizeModelCompletion([
      { kind: 'tool_call_delta', callId: 'c1', toolName: 'bash', argumentsDelta: '{"command":' },
      { kind: 'completed', stopReason: 'tool_calls' }
    ])
    expect(result.integrity.malformedToolCall).toBe(true)
    expect(result.toolIntents).toEqual([])
  })

  it('preserves safety stop metadata', async () => {
    const result = await normalizeModelCompletion([
      { kind: 'completed', stopReason: 'stop', stopClass: 'safety', providerReason: 'content_filter', rawMetadata: { category: 'safety' } }
    ], { provider: 'minimax' })
    expect(result).toMatchObject({ stopClass: 'safety', providerReason: 'content_filter', rawMetadata: { category: 'safety' } })
  })
})
