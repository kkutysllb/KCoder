import { expect, it } from 'vitest'
import { normalizeModelCompletion } from '@qiongqi/loop'

it('normalizes offline provider profiles without live calls', async () => {
  for (const profile of [
    { provider: 'deepseek', endpointFormat: 'chat_completions' as const },
    { provider: 'minimax', endpointFormat: 'chat_completions' as const },
    { provider: 'kimi', endpointFormat: 'chat_completions' as const },
    { provider: 'vllm', endpointFormat: 'chat_completions' as const },
    { provider: 'openrouter', endpointFormat: 'chat_completions' as const }
  ]) {
    const result = await normalizeModelCompletion([{ kind: 'completed', stopReason: 'stop' }], profile)
    expect(result.provider).toBe(profile.provider)
    expect(result.endpointFormat).toBe(profile.endpointFormat)
  }
})
