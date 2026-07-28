import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '@qiongqi/contracts'
import { replayRuntimeEvents } from '@qiongqi/domain'
import { createQiongqiServeRuntime } from '@qiongqi/http'

describe('kernel_v3 production live streaming', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists an assistant delta before provider completion and converges on one final item', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'qiongqi-kernel-stream-'))
    const encoder = new TextEncoder()
    let releaseProvider!: () => void
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    let providerStarted!: () => void
    const providerRequestStarted = new Promise<void>((resolve) => {
      providerStarted = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      providerStarted()
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"choices":[{"delta":{"content":"live "},"finish_reason":null}]}\n\n'
          ))
          await providerReleased
          controller.enqueue(encoder.encode(
            'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":null}]}\n\n'
          ))
          controller.enqueue(encoder.encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
          ))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }))

    const runtime = await createQiongqiServeRuntime({
      host: '127.0.0.1',
      port: 0,
      dataDir,
      runtimeToken: 'tok',
      apiKey: 'test-key',
      baseUrl: 'http://model.test/v1',
      endpointFormat: 'chat_completions',
      model: 'test-model',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      tokenEconomyMode: false,
      insecure: true,
      orchestrationMode: 'kernel_v3'
    })
    try {
      const thread = await runtime.threadService.create({
        title: 'Streaming',
        workspace: dataDir,
        model: 'test-model',
        mode: 'agent',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access'
      })
      const started = await runtime.turnService.startTurn({
        threadId: thread.id,
        request: { prompt: 'stream the answer' }
      })
      const observed: RuntimeEvent[] = []
      const firstDelta = new Promise<RuntimeEvent>((resolve) => {
        runtime.eventBus.subscribe(thread.id, (event) => {
          observed.push(event)
          if (event.kind === 'assistant_text_delta') resolve(event)
        })
      })

      const running = Promise.resolve(runtime.runTurn(thread.id, started.turnId))
      await providerRequestStarted
      const streamedBeforeCompletion = await Promise.race([
        firstDelta,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 300))
      ])
      releaseProvider()
      await expect(running).resolves.toBe('completed')

      expect(streamedBeforeCompletion).toMatchObject({
        kind: 'assistant_text_delta',
        threadId: thread.id,
        turnId: started.turnId,
        item: expect.objectContaining({
          kind: 'assistant_text',
          text: 'live ',
          status: 'running'
        })
      })
      const persisted = await runtime.sessionStore.loadEventsSince(thread.id, 0)
      const textDeltas = persisted.filter((event) => event.kind === 'assistant_text_delta')
      expect(textDeltas.map((event) => event.item.text)).toEqual(['live ', 'answer'])
      expect(new Set(textDeltas.map((event) => event.itemId))).toEqual(
        new Set([streamedBeforeCompletion?.itemId])
      )
      const final = persisted.find((event) =>
        event.kind === 'item_created'
        && event.itemId === streamedBeforeCompletion?.itemId
        && event.item.kind === 'assistant_text'
      )
      expect(final).toMatchObject({
        item: expect.objectContaining({ text: 'live answer', status: 'completed' })
      })
      const projection = replayRuntimeEvents(persisted)
      expect(projection.items.filter((item) => item.kind === 'assistant_text')).toEqual([
        expect.objectContaining({
          id: streamedBeforeCompletion?.itemId,
          text: 'live answer',
          status: 'completed'
        })
      ])
      expect(observed.some((event) => event.kind === 'assistant_text_delta')).toBe(true)
    } finally {
      releaseProvider()
      await runtime.shutdown?.()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
