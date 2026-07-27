import { describe, expect, it } from 'vitest'
import { dispatchRequest, startNodeHttpServer } from '@qiongqi/http'
import { InMemoryEventedV2WorkerRegistryStore, InMemoryMailboxStore, InMemoryMultiAgentRunStore } from '@qiongqi/adapter-storage'
import { EventedV2MultiAgentRuntime, EventedV2RemoteAgentScheduler, defaultManagerSpecialistGraph } from '@qiongqi/loop'
import { buildHarness, readJson } from './http-server-test-harness.js'

describe('HTTP observability', () => {
  it('adds a request id response header and reuses caller-provided ids', async () => {
    const h = buildHarness()

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/health', {
        headers: { 'x-request-id': 'req-caller-1' }
      })
    )

    expect(response.headers.get('x-request-id')).toBe('req-caller-1')
  })

  it('propagates traceparent and includes trace identifiers in access logs', async () => {
    const h = buildHarness()
    const logs: Array<{ traceparent?: string; traceId?: string; spanId?: string }> = []
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/health', {
        headers: { traceparent }
      }),
      {
        accessLog: (entry) => logs.push(entry)
      }
    )

    expect(response.headers.get('traceparent')).toBe(traceparent)
    expect(logs).toEqual([
      expect.objectContaining({
        traceparent,
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7'
      })
    ])
  })

  it('emits structured access logs without secret headers', async () => {
    const h = buildHarness()
    const logs: unknown[] = []

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/info', {
        headers: {
          authorization: 'Bearer tok-1',
          'x-request-id': 'req-log-1'
        }
      }),
      {
        accessLog: (entry) => logs.push(entry)
      }
    )

    expect(response.status).toBe(200)
    expect(logs).toEqual([
      expect.objectContaining({
        type: 'http_access',
        requestId: 'req-log-1',
        method: 'GET',
        path: '/v1/runtime/info',
        status: 200
      })
    ])
    expect(JSON.stringify(logs)).not.toContain('Bearer')
  })

  it('emits structured access logs from the Node HTTP server adapter', async () => {
    const h = buildHarness()
    const logs: unknown[] = []
    const handle = await startNodeHttpServer({
      router: h.router,
      host: '127.0.0.1',
      port: 0,
      accessLog: (entry) => logs.push(entry)
    })
    try {
      const response = await fetch(`http://${handle.host}:${handle.port}/health`, {
        headers: { 'x-request-id': 'req-node-1' }
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('x-request-id')).toBe('req-node-1')
      expect(logs).toEqual([
        expect.objectContaining({
          type: 'http_access',
          requestId: 'req-node-1',
          method: 'GET',
          path: '/health',
          status: 200
        })
      ])
    } finally {
      await handle.close()
    }
  })

  it('serves runtime metrics in Prometheus text format', async () => {
    const h = buildHarness()
    h.runtime.usageService.record('thr_metrics', {
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
      cachedTokens: 4,
      cacheHitTokens: 4,
      cacheMissTokens: 3,
      cacheHitRate: 4 / 7,
      turns: 1
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics?format=prometheus', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    const text = await response.text()
    expect(text).toContain('qiongqi_usage_total_tokens 10')
    expect(text).toContain('qiongqi_cache_hit_rate ')
    expect(text).toContain('qiongqi_a2a_tasks_total 0')
  })

  it('serves evented v2 timeline and metrics management projections when configured', async () => {
    const h = buildHarness()
    h.runtime.multiAgentRuntime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextHttpId(),
      nowIso: h.nowIso
    })
    const run = await h.runtime.multiAgentRuntime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Observe evented v2.'
    })

    const timelineResponse = await dispatchRequest(
      h.router,
      new Request(`http://localhost/v1/runtime/evented-v2/runs/${run.runId}/timeline`, {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const metricsResponse = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/evented-v2/metrics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(timelineResponse.status).toBe(200)
    expect(await readJson(timelineResponse)).toMatchObject({
      runId: run.runId,
      events: [{ seq: 0, type: 'run_started', agentId: 'manager' }]
    })
    expect(metricsResponse.status).toBe(200)
    expect(await readJson(metricsResponse)).toMatchObject({
      totalRuns: 1,
      byStatus: { running: 1 }
    })
  })

  it('returns unavailable for evented v2 management routes when the runtime is not configured', async () => {
    const h = buildHarness()

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/evented-v2/metrics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(503)
    expect(await readJson(response)).toMatchObject({ code: 'capability_unavailable' })
  })

  it('includes evented v2 metrics in Prometheus output when configured', async () => {
    const h = buildHarness()
    h.runtime.multiAgentRuntime = new EventedV2MultiAgentRuntime({
      runs: new InMemoryMultiAgentRunStore(),
      mailbox: new InMemoryMailboxStore(),
      graph: defaultManagerSpecialistGraph({ managerAgentId: 'manager', specialistAgentId: 'researcher' }),
      ids: nextHttpId(),
      nowIso: h.nowIso
    })
    await h.runtime.multiAgentRuntime.start({
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspaceKey: 'workspace_1',
      prompt: 'Observe evented v2.'
    })

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics?format=prometheus', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('qiongqi_evented_v2_runs_total{status="running"} 1')
    expect(text).toContain('qiongqi_evented_v2_outbox_pending 0')
    expect(text).toContain('qiongqi_evented_v2_agent_runs_total{status="running"} 1')
  })

  it('includes evented v2 remote scheduler supervision metrics', async () => {
    const h = buildHarness()
    const scheduler = new EventedV2RemoteAgentScheduler({
      workerId: 'worker_metrics',
      worker: {
        processNext: async ({ agentId }) => ({
          processed: agentId === 'researcher',
          messageId: agentId === 'researcher' ? 'msg_1' : undefined
        })
      },
      agentIds: ['researcher', 'writer'],
      intervalMs: 1000,
      nowIso: () => '2026-07-21T00:00:00.000Z'
    })
    h.runtime.multiAgentRemoteScheduler = scheduler
    await scheduler.flushOnce()

    const json = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const prometheus = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics?format=prometheus', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(json.status).toBe(200)
    expect(await readJson(json)).toMatchObject({
      eventedV2RemoteScheduler: {
        workerId: 'worker_metrics',
        status: 'stopped',
        health: 'stopped',
        agentsConfigured: 2,
        flushesTotal: 1,
        messagesProcessedTotal: 1,
        errorsTotal: 0
      }
    })
    expect(prometheus.status).toBe(200)
    const text = await prometheus.text()
    expect(text).toContain('qiongqi_evented_v2_remote_scheduler_running 0')
    expect(text).toContain('qiongqi_evented_v2_remote_scheduler_flushes_total 1')
    expect(text).toContain('qiongqi_evented_v2_remote_scheduler_messages_processed_total 1')
    expect(text).toContain('qiongqi_evented_v2_remote_scheduler_errors_total 0')
  })

  it('includes evented v2 worker registry metrics', async () => {
    const h = buildHarness()
    const workerRegistry = new InMemoryEventedV2WorkerRegistryStore()
    h.runtime.multiAgentWorkerRegistry = workerRegistry
    const now = Date.parse(h.nowIso())
    await workerRegistry.recordHeartbeat({
      workerId: 'worker_active',
      role: 'remote_agent',
      agentIds: ['researcher'],
      heartbeatAt: new Date(now).toISOString(),
      ttlMs: 60_000
    })
    await workerRegistry.recordHeartbeat({
      workerId: 'worker_expired',
      role: 'remote_agent',
      agentIds: ['writer'],
      heartbeatAt: new Date(now - 120_000).toISOString(),
      ttlMs: 60_000
    })

    const json = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )
    const prometheus = await dispatchRequest(
      h.router,
      new Request('http://localhost/v1/runtime/metrics?format=prometheus', {
        headers: { authorization: 'Bearer tok-1' }
      })
    )

    expect(json.status).toBe(200)
    expect(await readJson(json)).toMatchObject({
      eventedV2Workers: {
        total: 2,
        online: 1,
        expired: 1,
        byRole: {
          remote_agent: {
            total: 2,
            online: 1,
            expired: 1
          }
        }
      }
    })
    expect(prometheus.status).toBe(200)
    const text = await prometheus.text()
    expect(text).toContain('qiongqi_evented_v2_workers_total 2')
    expect(text).toContain('qiongqi_evented_v2_workers_online 1')
    expect(text).toContain('qiongqi_evented_v2_workers_expired 1')
    expect(text).toContain('qiongqi_evented_v2_workers_total{role="remote_agent"} 2')
  })
})

function nextHttpId(): (prefix: string) => string {
  let seq = 0
  return (prefix) => `${prefix}_${++seq}`
}
