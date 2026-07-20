import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime, StorageDiagnostics } from './server-runtime.js'

/** Build the `GET /health` response. The endpoint is unauthenticated. */
export function healthJsonResponse(): JsonResponse {
  return jsonResponse({ status: 'ok', service: 'qiongqi', mode: 'serve' })
}

export async function readinessJsonResponse(runtime: ServerRuntime): Promise<JsonResponse> {
  const storage = await resolveStorageDiagnostics(runtime)
  const status = storage.degraded || !storage.available ? 'degraded' : 'ready'
  return jsonResponse({
    status,
    service: 'qiongqi',
    mode: 'serve',
    checks: {
      storage
    }
  })
}

async function resolveStorageDiagnostics(runtime: ServerRuntime): Promise<StorageDiagnostics> {
  return await (runtime.storageDiagnostics?.() ?? {
    backend: 'unknown',
    available: true,
    degraded: false
  })
}
