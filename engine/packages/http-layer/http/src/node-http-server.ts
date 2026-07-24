import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { Router } from './router.js'
import { dispatchRequest, type DispatchRequestOptions } from './http-server.js'

export type NodeHttpServerHandle = {
  server: Server
  host: string
  port: number
  close(): Promise<void>
}

export async function startNodeHttpServer(input: {
  router: Router
  host: string
  port: number
  accessLog?: DispatchRequestOptions['accessLog']
  telemetry?: DispatchRequestOptions['telemetry']
  /**
   * Allowed CORS origins. When omitted, falls back to the
   * `CORS_ORIGINS` / `GATEWAY_CORS_ORIGINS` environment variable
   * (comma-separated). `['*']` allows any origin.
   */
  corsOrigins?: string[]
}): Promise<NodeHttpServerHandle> {
  const corsOrigins = input.corsOrigins ?? resolveCorsOriginsFromEnv()
  const server = createServer((request, response) => {
    void handleNodeRequest(input.router, request, response, { accessLog: input.accessLog, telemetry: input.telemetry, corsOrigins })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port
  return {
    server,
    host: input.host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}

async function handleNodeRequest(
  router: Router,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  options: DispatchRequestOptions & { corsOrigins?: string[] } = {}
): Promise<void> {
  const origin = incoming.headers.origin
  const allowedOrigin = resolveAllowedOrigin(origin, options.corsOrigins)

  // CORS preflight (OPTIONS) — short-circuit before route dispatch
  if (incoming.method === 'OPTIONS' && allowedOrigin) {
    outgoing.writeHead(204, {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Request-ID, X-Qiongqi-Client, X-CSRF-Token, Traceparent, Last-Event-ID',
      'access-control-allow-credentials': 'true',
      'access-control-max-age': '86400'
    })
    outgoing.end()
    return
  }

  try {
    const request = toFetchRequest(incoming)
    const response = await dispatchRequest(router, request, options)
    // Inject CORS headers into every cross-origin response
    if (allowedOrigin) {
      response.headers.set('access-control-allow-origin', allowedOrigin)
      response.headers.set('access-control-allow-credentials', 'true')
    }
    await writeFetchResponse(outgoing, response)
  } catch (error) {
    const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
    if (allowedOrigin) {
      headers['access-control-allow-origin'] = allowedOrigin
      headers['access-control-allow-credentials'] = 'true'
    }
    const body = JSON.stringify({
      code: 'internal_error',
      message: error instanceof Error ? error.message : String(error)
    })
    outgoing.writeHead(500, headers)
    outgoing.end(body)
  }
}

/**
 * Resolve the list of allowed CORS origins from environment variables.
 *
 * Reads `CORS_ORIGINS` or `GATEWAY_CORS_ORIGINS` (comma-separated).
 * The token `*` allows any origin. Returns `undefined` when neither
 * variable is set (CORS disabled).
 */
function resolveCorsOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] | undefined {
  const raw = env.GATEWAY_CORS_ORIGINS ?? env.CORS_ORIGINS
  if (!raw || !raw.trim()) return undefined
  if (raw.trim() === '*') return ['*']
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

/**
 * Given the request's `Origin` header and the configured origins,
 * return the origin value to send back in `Access-Control-Allow-Origin`,
 * or `undefined` when the origin is not allowed (or no Origin header).
 */
function resolveAllowedOrigin(
  origin: string | undefined,
  corsOrigins: string[] | undefined
): string | undefined {
  if (!origin) return undefined
  if (!corsOrigins || corsOrigins.length === 0) return undefined
  if (corsOrigins.includes('*')) return origin
  if (corsOrigins.includes(origin)) return origin
  return undefined
}

function toFetchRequest(incoming: IncomingMessage): Request {
  const method = incoming.method ?? 'GET'
  const host = incoming.headers.host ?? '127.0.0.1'
  const url = `http://${host}${incoming.url ?? '/'}`
  const headers = new Headers()
  for (const [key, raw] of Object.entries(incoming.headers)) {
    if (raw == null) continue
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value)
    } else {
      headers.set(key, raw)
    }
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers
  }
  if (hasBody) {
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status
  // Set-Cookie must be handled separately: Headers.forEach merges multiple
  // cookies into a comma-joined string, which breaks browser parsing.
  // getSetCookie() (Node.js undici extension) returns each cookie as a
  // separate array element so ServerResponse emits one Set-Cookie per cookie.
  const setCookies = (response.headers as Headers).getSetCookie?.() ?? []
  if (setCookies.length > 0) {
    outgoing.setHeader('set-cookie', setCookies)
  }
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    outgoing.setHeader(key, value)
  })
  if (!response.body) {
    outgoing.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) outgoing.write(Buffer.from(value))
    }
  } finally {
    outgoing.end()
    reader.releaseLock()
  }
}
