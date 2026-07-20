import type { Router } from './router.js'
import type { JsonResponse } from './response.js'
import { jsonResponse } from './response.js'
import type { OpenTelemetryRuntime } from './telemetry.js'

export type HttpServerOptions = {
  router: Router
}

export type HttpAccessLogEntry = {
  type: 'http_access'
  requestId: string
  traceparent?: string
  traceId?: string
  spanId?: string
  method: string
  path: string
  status: number
  durationMs: number
}

export type DispatchRequestOptions = {
  accessLog?: (entry: HttpAccessLogEntry) => void
  idGenerator?: () => string
  telemetry?: OpenTelemetryRuntime
}

function toResponse(response: Response | JsonResponse, observability?: {
  requestId?: string
  traceparent?: string
}): Response {
  if (response instanceof Response) {
    if (observability?.requestId && !response.headers.has('x-request-id')) {
      response.headers.set('x-request-id', observability.requestId)
    }
    if (observability?.traceparent && !response.headers.has('traceparent')) {
      response.headers.set('traceparent', observability.traceparent)
    }
    return response
  }
  const headers = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  if (observability?.requestId) headers.set('x-request-id', observability.requestId)
  if (observability?.traceparent) headers.set('traceparent', observability.traceparent)
  return new Response(response.body, {
    status: response.status,
    headers
  })
}

function parseTraceparent(value: string | null): {
  traceparent: string
  traceId: string
  spanId: string
} | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(?:-.*)?$/i.exec(trimmed)
  if (!match) return undefined
  const traceId = match[2].toLowerCase()
  const spanId = match[3].toLowerCase()
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined
  return {
    traceparent: `${match[1].toLowerCase()}-${traceId}-${spanId}-${match[4].toLowerCase()}`,
    traceId,
    spanId
  }
}

export async function dispatchRequest(
  router: Router,
  request: Request,
  options: DispatchRequestOptions = {}
): Promise<Response> {
  const url = new URL(request.url)
  const startedAt = Date.now()
  const requestId = request.headers.get('x-request-id')?.trim() ||
    options.idGenerator?.() ||
    `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const trace = parseTraceparent(request.headers.get('traceparent'))
  const observability = { requestId, traceparent: trace?.traceparent }
  const match = router.match(request.method, url.pathname)
  const telemetrySpan = options.telemetry?.startHttpSpan({
    method: request.method.toUpperCase(),
    path: url.pathname,
    url: request.url,
    headers: request.headers,
    requestId
  })
  let response: Response
  try {
    if (!match) {
      response = toResponse(jsonResponse(
        { code: 'not_found', message: 'route not found' },
        404
      ), observability)
    } else {
      response = toResponse(await match.handler(request, { params: match.params }), observability)
    }
    options.telemetry?.finishSpan(telemetrySpan?.span, { status: response.status })
  } catch (error) {
    options.telemetry?.finishSpan(telemetrySpan?.span, { status: 500, error })
    throw error
  }
  options.accessLog?.({
    type: 'http_access',
    requestId,
    traceparent: trace?.traceparent,
    traceId: trace?.traceId,
    spanId: trace?.spanId,
    method: request.method.toUpperCase(),
    path: url.pathname,
    status: response.status,
    durationMs: Date.now() - startedAt
  })
  return response
}
