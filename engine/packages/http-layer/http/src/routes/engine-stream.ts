import type { DurableEngineStore } from '@qiongqi/ports'

const DEFAULT_POLL_MS = 250
const DEFAULT_PAGE_SIZE = 100
const DEFAULT_QUEUE_BOUND = 256

export function buildEngineStreamResponse(input: {
  request: Request
  store: DurableEngineStore
  streamId: string
  subscriberId: string
  allowPrivate?: boolean
  pollMs?: number
  pageSize?: number
  queueBound?: number
}): Response {
  const url = new URL(input.request.url)
  const queryCursor = parseCursor(url.searchParams.get('after_seq'))
  const headerCursor = parseCursor(input.request.headers.get('Last-Event-ID'))
  let cursor = queryCursor ?? headerCursor ?? 0
  const encoder = new TextEncoder()
  let closed = false
  let cancelPoll: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        cancelPoll?.()
        try { controller.close() } catch { /* already closed */ }
      }
      input.request.signal.addEventListener('abort', close, { once: true })

      void (async () => {
        try {
          while (!closed) {
            const events = await input.store.readStream(
              input.streamId,
              cursor,
              input.pageSize ?? DEFAULT_PAGE_SIZE
            )
            for (const event of events) {
              cursor = Math.max(cursor, event.seq)
              if (event.channel === 'private' && !input.allowPrivate) continue
              if ((controller.desiredSize ?? 1) < -(input.queueBound ?? DEFAULT_QUEUE_BOUND)) {
                close()
                return
              }
              controller.enqueue(encoder.encode(encodeEngineSseEvent(event)))
            }
            if (events.length > 0) continue
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, input.pollMs ?? DEFAULT_POLL_MS)
              cancelPoll = () => {
                clearTimeout(timer)
                resolve()
              }
            })
          }
        } catch (error) {
          if (!closed) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : String(error)
            })}\n\n`))
          }
          close()
        }
      })()
    },
    cancel() {
      closed = true
      cancelPoll?.()
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-qiongqi-subscriber-id': input.subscriberId
    }
  })
}

function encodeEngineSseEvent(event: { seq: number; kind: string } & Record<string, unknown>): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

function parseCursor(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}
