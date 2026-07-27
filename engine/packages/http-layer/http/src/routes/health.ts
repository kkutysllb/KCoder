import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime, StorageDiagnostics } from './server-runtime.js'

/** Build the `GET /health` response. The endpoint is unauthenticated. */
export function healthJsonResponse(): JsonResponse {
  return jsonResponse({ status: 'ok', service: 'qiongqi', mode: 'serve' })
}

export async function readinessJsonResponse(runtime: ServerRuntime): Promise<JsonResponse> {
  const storage = await resolveStorageDiagnostics(runtime)
  const graphs = runtime.graphReadiness ? aggregateGraphReadiness(await runtime.graphReadiness()) : undefined
  const status = storage.degraded || !storage.available || (graphs && !graphs.ready) ? 'degraded' : 'ready'
  return jsonResponse({
    status,
    service: 'qiongqi',
    mode: 'serve',
    checks: {
      storage,
      ...(graphs ? { graphs } : {})
    }
  })
}

function aggregateGraphReadiness(reports: Awaited<ReturnType<NonNullable<ServerRuntime['graphReadiness']>>>) {
  const order = ['draft', 'observe', 'assisted', 'autonomous'] as const
  const byLevel: Partial<Record<(typeof order)[number], number>> = {}
  for (const report of reports) byLevel[report.level] = (byLevel[report.level] ?? 0) + 1
  const minimumLevel = reports.length === 0
    ? 'draft'
    : order.find((level) => reports.some((report) => report.level === level)) ?? 'draft'
  return {
    ready: reports.length > 0 && reports.every((report) => report.ready),
    total: reports.length,
    minimumLevel,
    byLevel
  }
}

async function resolveStorageDiagnostics(runtime: ServerRuntime): Promise<StorageDiagnostics> {
  return await (runtime.storageDiagnostics?.() ?? {
    backend: 'unknown',
    available: true,
    degraded: false
  })
}
