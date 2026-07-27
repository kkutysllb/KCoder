import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { EngineStreamPublisher } from '@qiongqi/loop'
import { buildEngineStreamResponse } from '@qiongqi/http'

describe('durable engine stream HTTP', () => {
  it('replays durable events as SSE using Last-Event-ID', async () => {
    const store = new InMemoryDurableEngineStore()
    const publisher = new EngineStreamPublisher({
      store,
      streamId: 'stream-http',
      scope: { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task' }
    })
    await publisher.publish({ channel: 'public', kind: 'model.text.delta', payload: { text: 'hello' } })
    const controller = new AbortController()
    const response = buildEngineStreamResponse({
      request: new Request('http://engine.test/v1/engine/streams/stream-http/subscribe', {
        headers: { 'Last-Event-ID': '0' },
        signal: controller.signal
      }),
      store,
      streamId: 'stream-http',
      subscriberId: 'consumer-http',
      pollMs: 5
    })
    const reader = response.body!.getReader()
    const first = await reader.read()
    controller.abort()
    const body = new TextDecoder().decode(first.value)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toContain('id: 1')
    expect(body).toContain('model.text.delta')
  })
})
