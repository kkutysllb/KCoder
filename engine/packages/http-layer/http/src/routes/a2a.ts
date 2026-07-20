import { PeerArtifactSchema, PeerTaskSchema } from '@qiongqi/contracts'
import { mapItemsToArtifacts } from '@qiongqi/contracts'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ServerRuntime } from './server-runtime.js'
import { A2ATaskRecord, type A2ATaskRecord as A2ATaskRecordType } from '../a2a-task-model.js'
import type { FileA2ATaskStore } from '../a2a-task-store.js'

/**
 * Stage 4: A2A (Agent-to-Agent) protocol endpoints.
 *
 * Upgraded from the Stage-2 single POST /a2a to a proper A2A task
 * lifecycle. Tasks are tracked in a {@link FileA2ATaskStore} so status
 * can be queried after the initial HTTP connection closes.
 *
 * ## Endpoints
 *
 * - `POST /a2a/tasks` — submit a task, start one turn, return 202 + task
 * - `GET /a2a/tasks/{id}` — query task status
 * - `POST /a2a/tasks/{id}/cancel` — cancel the task and abort its turn
 * - `GET /a2a/tasks/{id}/artifacts` — retrieve mapped turn artifacts
 * - `GET /a2a/tasks/{id}/subscribe` — stream task progress
 */

/**
 * POST /a2a/tasks — submit a peer task and start one turn.
 *
 * Creates a {@link A2ATaskRecord}, starts the backing thread/turn, and
 * completes it in the background. The legacy `/a2a` alias uses
 * {@link a2aCreateTaskSync} to preserve the Stage-2 synchronous artifact
 * response shape for existing peer transports.
 */
export async function a2aCreateTask(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  request: Request
): Promise<JsonResponse> {
  return a2aSubmitTask(runtime, store, request, { waitForCompletion: false })
}

export async function a2aCreateTaskSync(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  request: Request
): Promise<JsonResponse> {
  return a2aSubmitTask(runtime, store, request, { waitForCompletion: true })
}

async function a2aSubmitTask(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  request: Request,
  options: { waitForCompletion: boolean }
): Promise<JsonResponse> {
  const body = await readJsonBody(request)
  if (!body.ok) {
    return { status: 400, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'invalid request body' }) }
  }
  const parsedTask = PeerTaskSchema.safeParse(body.value)
  if (!parsedTask.success) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'invalid peer task', issues: parsedTask.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    }
  }
  const task = parsedTask.data
  if (!runtime.runTurn) {
    return { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'turn execution unavailable' }) }
  }

  const id = `a2a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  let record: A2ATaskRecordType = A2ATaskRecord.parse({
    id,
    senderCardId: 'unknown',
    prompt: task.prompt,
    workspace: task.workspace,
    model: task.model,
    status: 'submitted',
    createdAt: now,
    updatedAt: now
  })
  await store.upsert(record)

  try {
    record = A2ATaskRecord.parse({ ...record, status: 'working', updatedAt: new Date().toISOString() })
    await store.upsert(record)

    const thread = await runtime.threadService.create({
      title: task.label ?? `A2A task: ${task.prompt.slice(0, 60)}`,
      workspace: task.workspace ?? '~',
      model: task.model ?? runtime.info().model ?? 'default',
      mode: 'agent',
      approvalPolicy: runtime.info().approvalPolicy ?? 'auto',
      sandboxMode: runtime.info().sandboxMode
    })
    const started = await runtime.turnService.startTurn({
      threadId: thread.id,
      request: { prompt: task.prompt, model: task.model, mode: 'agent' }
    })
    record = A2ATaskRecord.parse({
      ...record,
      threadId: thread.id,
      turnId: started.turnId,
      updatedAt: new Date().toISOString()
    })
    await store.upsert(record)

    const completion = completeA2ATask(runtime, store, record)
    if (!options.waitForCompletion) {
      void completion
      return jsonResponse({ task: record }, 202)
    }
    return await completion
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record = A2ATaskRecord.parse({ ...record, status: 'failed', error: message, updatedAt: new Date().toISOString() })
    await store.upsert(record).catch(() => {})
    return { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ task: record, error: message }) }
  }
}

async function completeA2ATask(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  record: A2ATaskRecordType
): Promise<JsonResponse> {
  try {
    if (!record.threadId || !record.turnId) {
      throw new Error('A2A task is missing thread or turn')
    }
    const status = await runtime.runTurn(record.threadId, record.turnId)
    const items = await runtime.sessionStore.loadItems(record.threadId)
    const turnItems = items.filter((item) => item.turnId === record.turnId)
    const summary = turnItems
      .filter((item): item is Extract<typeof turnItems[0], { kind: 'assistant_text' }> => item.kind === 'assistant_text')
      .map((item) => item.text.trim()).filter(Boolean).join('\n\n').trim() || undefined
    const errorItem = turnItems.find(
      (item): item is Extract<typeof turnItems[0], { kind: 'error' }> => item.kind === 'error'
    )

    const latest = await store.get(record.id)
    if (latest?.status === 'cancelled') {
      const artifact = PeerArtifactSchema.parse({
        peerCardId: runtime.agentCard?.id ?? 'unknown',
        status: 'aborted',
        error: 'A2A task cancelled'
      })
      return jsonResponse({ task: latest, artifact, artifacts: mapItemsToArtifacts(items) })
    }

    record = A2ATaskRecord.parse({
      ...record,
      status: status === 'completed' ? 'completed' : 'failed',
      ...(summary ? { summary } : {}),
      ...(errorItem ? { error: errorItem.message } : {}),
      updatedAt: new Date().toISOString()
    })
    await store.upsert(record)

    // Map items to A2A artifacts.
    const artifacts = mapItemsToArtifacts(items)
    const artifact = PeerArtifactSchema.parse({
      peerCardId: runtime.agentCard?.id ?? 'unknown',
      status,
      ...(summary ? { summary } : {}),
      ...(errorItem ? { error: errorItem.message } : {})
    })
    return jsonResponse({ task: record, artifact, artifacts })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    record = A2ATaskRecord.parse({ ...record, status: 'failed', error: message, updatedAt: new Date().toISOString() })
    await store.upsert(record).catch(() => {})
    return { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ task: record, error: message }) }
  }
}

/**
 * GET /a2a/tasks/{id} — query a task by id.
 */
export async function a2aGetTask(
  store: FileA2ATaskStore,
  taskId: string
): Promise<JsonResponse> {
  const record = await store.get(taskId)
  if (!record) {
    return { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'task not found' }) }
  }
  return jsonResponse(record)
}

/**
 * POST /a2a/tasks/{id}/cancel — cancel a pending or working task.
 */
export async function a2aCancelTask(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  taskId: string
): Promise<JsonResponse> {
  const record = await store.get(taskId)
  if (!record) {
    return { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'task not found' }) }
  }
  if (record.status === 'completed' || record.status === 'failed') {
    return { status: 409, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'task already terminal', status: record.status }) }
  }
  if (record.threadId && record.turnId) {
    await runtime.cancelA2ATaskTurn?.({ threadId: record.threadId, turnId: record.turnId })
  }
  const updated = A2ATaskRecord.parse({ ...record, status: 'cancelled', updatedAt: new Date().toISOString() })
  await store.upsert(updated)
  return jsonResponse(updated)
}

/**
 * GET /a2a/tasks/{id}/artifacts — load turn items from the task's thread.
 */
export async function a2aGetArtifacts(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  taskId: string
): Promise<JsonResponse> {
  const record = await store.get(taskId)
  if (!record) {
    return { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'task not found' }) }
  }
  if (!record.threadId) {
    return { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ error: 'task has no thread' }) }
  }
  const items = await runtime.sessionStore.loadItems(record.threadId)
  const artifacts = mapItemsToArtifacts(items)
  return jsonResponse({ taskId, threadId: record.threadId, artifacts })
}

/**
 * GET /a2a/tasks/{id}/subscribe — SSE event stream for task progress.
 *
 * Subscribes to the runtime event bus for the task's thread and
 * streams turn events as SSE. If the task is already completed,
 * immediately sends the final state and closes.
 */
export function a2aSubscribeTask(
  runtime: ServerRuntime,
  store: FileA2ATaskStore,
  taskId: string,
  request: Request
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const record = await store.get(taskId)
      if (!record) {
        send({ error: 'task not found' })
        controller.close()
        return
      }

      // If already terminal, send final state and close.
      if (record.status === 'completed' || record.status === 'failed' || record.status === 'cancelled') {
        send({ task: record })
        send({ event: 'done' })
        controller.close()
        return
      }

      // Subscribe to runtime events for the task's thread.
      if (record.threadId) {
        const unsubscribe = runtime.eventBus.subscribe(record.threadId, (event) => {
          send({ event })
        })
        // Poll for status changes (simplified — full async would need a callback).
        const interval = setInterval(async () => {
          const updated = await store.get(taskId)
          if (updated && (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'cancelled')) {
            send({ task: updated })
            send({ event: 'done' })
            clearInterval(interval)
            unsubscribe()
            controller.close()
          }
        }, 1000)
        // Clean up on abort.
        request.signal?.addEventListener('abort', () => {
          clearInterval(interval)
          unsubscribe()
          controller.close()
        })
      } else {
        send({ task: record })
        send({ event: 'done' })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive'
    }
  })
}
