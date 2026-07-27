import { describe, expect, it } from 'vitest'
import { QiongqiConfigSchema } from '@qiongqi/contracts'
import {
  createInMemoryTraceExporter,
  createOpenTelemetryRuntime,
  dispatchRequest
} from '@qiongqi/http'
import { buildHarness } from './http-server-test-harness.js'

describe('OpenTelemetry exporter', () => {
  it('parses optional OpenTelemetry config', () => {
    const parsed = QiongqiConfigSchema.parse({
      serve: {
        observability: {
          openTelemetry: {
            enabled: true,
            serviceName: 'qiongqi-test',
            exporter: 'otlp-http',
            endpoint: 'http://collector:4318/v1/traces',
            headers: {
              authorization: 'Bearer token'
            }
          }
        }
      }
    })

    expect(parsed.serve?.observability?.openTelemetry).toMatchObject({
      enabled: true,
      serviceName: 'qiongqi-test',
      exporter: 'otlp-http',
      endpoint: 'http://collector:4318/v1/traces'
    })
  })

  it('records HTTP server spans and honors incoming traceparent', async () => {
    const h = buildHarness()
    const exporter = createInMemoryTraceExporter()
    const otel = createOpenTelemetryRuntime({
      enabled: true,
      serviceName: 'qiongqi-test',
      exporter: 'memory',
      memoryExporter: exporter
    })
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

    const response = await dispatchRequest(
      h.router,
      new Request('http://localhost/health', {
        headers: { traceparent, 'x-request-id': 'req-otel-1' }
      }),
      { telemetry: otel }
    )
    await otel.forceFlush()

    expect(response.status).toBe(200)
    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('HTTP GET /health')
    expect(spans[0]?.spanContext().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(spans[0]?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'url.path': '/health',
      'http.response.status_code': 200,
      'qiongqi.request_id': 'req-otel-1'
    })
    await otel.shutdown()
  })

  it('records policy-safe graph correlation and numeric metrics', async () => {
    const exporter = createInMemoryTraceExporter()
    const otel = createOpenTelemetryRuntime({
      enabled: true,
      serviceName: 'qiongqi-test',
      exporter: 'memory',
      memoryExporter: exporter
    })
    const span = otel.startGraphSpan({
      name: 'graph node',
      attribution: {
        graphId: 'graph-1', graphRevision: 2, runId: 'run-1',
        nodeId: 'agent-a', edgeId: 'edge-a-b', attemptId: 'attempt-1'
      },
      metrics: { cost: 1.25, retries: 1, fanOut: 2, criticalPathLatencyMs: 1_500 }
    })

    otel.finishGraphSpan(span)
    await otel.forceFlush()

    const attributes = exporter.getFinishedSpans()[0]?.attributes
    expect(attributes).toMatchObject({
      'qiongqi.graph.id': 'graph-1',
      'qiongqi.graph.revision': 2,
      'qiongqi.graph.run_id': 'run-1',
      'qiongqi.graph.node_id': 'agent-a',
      'qiongqi.graph.edge_id': 'edge-a-b',
      'qiongqi.graph.attempt_id': 'attempt-1',
      'qiongqi.graph.cost': 1.25,
      'qiongqi.graph.retries': 1,
      'qiongqi.graph.fan_out': 2,
      'qiongqi.graph.critical_path_latency_ms': 1_500
    })
    expect(Object.keys(attributes ?? {})).not.toContain('qiongqi.graph.prompt')
    await otel.shutdown()
  })
})
