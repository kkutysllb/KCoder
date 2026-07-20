import { describe, expect, it } from 'vitest'
import { ModelProposalRunner } from '@qiongqi/loop'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'

const request = { threadId: 't', turnId: 'tu', model: 'minimax-m3', prefix: [], history: [], tools: [], abortSignal: new AbortController().signal } as ModelRequest

describe('ModelProposalRunner', () => {
  it('emits provisional deltas but returns only a normalized proposal', async () => {
    const seen: string[] = []
    const client: ModelClient = {
      provider: 'minimax', model: 'minimax-m3',
      async *stream() {
        yield { kind: 'assistant_text_delta', text: 'done' }
        yield { kind: 'tool_call_complete', callId: 'c1', toolName: 'bash', arguments: { command: 'pwd' } }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }
    const proposal = await new ModelProposalRunner({ client, onDelta: (chunk) => seen.push(chunk.kind) }).run(request)
    expect(seen).toEqual(['assistant_text_delta', 'tool_call_complete', 'completed'])
    expect(proposal.model).toBe('minimax-m3')
    expect(proposal.toolIntents).toHaveLength(1)
  })
})
