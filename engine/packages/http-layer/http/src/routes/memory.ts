import { MemoryCreateRequest, MemoryUpdateRequest } from '@qiongqi/contracts'
import type { MemoryStore } from '@qiongqi/memory'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'

export async function listMemories(store: MemoryStore | undefined, request: Request, ownerUserId?: string): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const url = new URL(request.url)
  return jsonResponse({
    memories: await store.list({
      workspace: url.searchParams.get('workspace') ?? undefined,
      includeDeleted: url.searchParams.get('include_deleted') === 'true',
      ownerUserId
    })
  })
}

export async function createMemory(store: MemoryStore | undefined, request: Request, ownerUserId?: string): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryCreateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory create body', parsed.error.issues)
  return jsonResponse({ memory: await store.create({ ...parsed.data, ownerUserId }) }, 201)
}

export async function updateMemory(store: MemoryStore | undefined, id: string, request: Request, ownerUserId?: string): Promise<JsonResponse | Response> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = MemoryUpdateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid memory update body', parsed.error.issues)
  try {
    if (ownerUserId && !(await ownsMemory(store, id, ownerUserId))) return ERRORS.notFound(`memory not found: ${id}`)
    return jsonResponse({ memory: await store.update(id, parsed.data) })
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

export async function deleteMemory(store: MemoryStore | undefined, id: string, ownerUserId?: string): Promise<JsonResponse> {
  if (!store) return ERRORS.unavailable('memory store is unavailable')
  try {
    if (ownerUserId && !(await ownsMemory(store, id, ownerUserId))) return ERRORS.notFound(`memory not found: ${id}`)
    return jsonResponse({ memory: await store.delete(id) })
  } catch (error) {
    return ERRORS.notFound(errorMessage(error))
  }
}

export async function memoryDiagnostics(store: MemoryStore | undefined): Promise<JsonResponse> {
  if (!store) return jsonResponse({ enabled: false, rootDir: '', activeCount: 0, tombstoneCount: 0, lastInjectedIds: [] })
  return jsonResponse(await store.diagnostics())
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function ownsMemory(store: MemoryStore, id: string, ownerUserId: string): Promise<boolean> {
  const memories = await store.list({ includeDeleted: true, ownerUserId })
  return memories.some((memory) => memory.id === id)
}
