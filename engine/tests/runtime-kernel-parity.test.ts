import { expect, it } from 'vitest'
import { normalizeModelCompletion } from '@qiongqi/loop'

it('keeps classic-compatible user text and tool intent semantics', async () => {
  const result = await normalizeModelCompletion([
    { kind: 'assistant_text_delta', text: '完成。' },
    { kind: 'tool_call_complete', callId: 'c1', toolName: 'read', arguments: { path: 'a' } },
    { kind: 'completed', stopReason: 'tool_calls' }
  ])
  expect(result.text).toBe('完成。')
  expect(result.toolIntents.map((intent) => intent.toolName)).toEqual(['read'])
  expect(result.stopClass).toBe('tool_calls')
})
