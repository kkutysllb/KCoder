import { context, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { ConsoleSpanExporter, InMemorySpanExporter, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  GraphAttributionSchema,
  type GraphAttribution,
  type OpenTelemetryConfig
} from '@qiongqi/contracts'

export type OpenTelemetryExporterKind = 'otlp-http' | 'console' | 'memory' | 'none'

export type OpenTelemetryRuntimeOptions = Omit<OpenTelemetryConfig, 'exporter'> & {
  exporter?: OpenTelemetryExporterKind
  memoryExporter?: InMemorySpanExporter
}

export type OpenTelemetryRuntime = {
  enabled: boolean
  tracerName: string
  startHttpSpan(input: {
    method: string
    path: string
    url: string
    headers: Headers
    requestId: string
  }): { span?: Span; context: ReturnType<typeof context.active> }
  startGraphSpan(input: {
    name: string
    attribution: GraphAttribution
    metrics?: GraphTraceMetrics
  }): Span | undefined
  finishSpan(span: Span | undefined, input: { status: number; error?: unknown }): void
  finishGraphSpan(span: Span | undefined, error?: unknown): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

export type GraphTraceMetrics = Partial<{
  cost: number
  retries: number
  fanOut: number
  avoidedCost: number
  criticalPathLatencyMs: number
}>

export function createInMemoryTraceExporter(): InMemorySpanExporter {
  return new InMemorySpanExporter()
}

export function createOpenTelemetryRuntime(
  options: OpenTelemetryRuntimeOptions | undefined
): OpenTelemetryRuntime {
  if (!options?.enabled || options.exporter === 'none') return disabledTelemetry()
  const exporter = createExporter(options)
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  })
  const serviceName = options.serviceName ?? 'qiongqi'
  const tracerName = serviceName
  const tracer = provider.getTracer(tracerName)
  const traceContextPropagator = new W3CTraceContextPropagator()
  return {
    enabled: true,
    tracerName,
    startHttpSpan(input) {
      const carrier: Record<string, string> = {}
      input.headers.forEach((value, key) => {
        carrier[key] = value
      })
      const parentContext = traceContextPropagator.extract(context.active(), carrier, {
        get(source, key) {
          return source[key]
        },
        keys(source) {
          return Object.keys(source)
        }
      })
      const span = tracer.startSpan(
        `HTTP ${input.method.toUpperCase()} ${input.path}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'service.name': serviceName,
            'http.request.method': input.method.toUpperCase(),
            'url.full': input.url,
            'url.path': input.path,
            'qiongqi.request_id': input.requestId
          }
        },
        parentContext
      )
      return { span, context: trace.setSpan(parentContext, span) }
    },
    startGraphSpan(input) {
      const attribution = GraphAttributionSchema.parse(input.attribution)
      const metrics = parseGraphTraceMetrics(input.metrics)
      return tracer.startSpan(input.name, {
        kind: SpanKind.INTERNAL,
        attributes: {
          'service.name': serviceName,
          'qiongqi.graph.id': attribution.graphId,
          'qiongqi.graph.revision': attribution.graphRevision,
          'qiongqi.graph.run_id': attribution.runId,
          ...(attribution.nodeId ? { 'qiongqi.graph.node_id': attribution.nodeId } : {}),
          ...(attribution.edgeId ? { 'qiongqi.graph.edge_id': attribution.edgeId } : {}),
          ...(attribution.attemptId ? { 'qiongqi.graph.attempt_id': attribution.attemptId } : {}),
          ...(metrics.cost !== undefined ? { 'qiongqi.graph.cost': metrics.cost } : {}),
          ...(metrics.retries !== undefined ? { 'qiongqi.graph.retries': metrics.retries } : {}),
          ...(metrics.fanOut !== undefined ? { 'qiongqi.graph.fan_out': metrics.fanOut } : {}),
          ...(metrics.avoidedCost !== undefined ? { 'qiongqi.graph.avoided_cost': metrics.avoidedCost } : {}),
          ...(metrics.criticalPathLatencyMs !== undefined
            ? { 'qiongqi.graph.critical_path_latency_ms': metrics.criticalPathLatencyMs }
            : {})
        }
      })
    },
    finishSpan(span, input) {
      if (!span) return
      span.setAttribute('http.response.status_code', input.status)
      if (input.error) {
        span.recordException(input.error instanceof Error ? input.error : new Error(String(input.error)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: input.error instanceof Error ? input.error.message : String(input.error) })
      } else if (input.status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR })
      }
      span.end()
    },
    finishGraphSpan(span, error) {
      if (!span) return
      if (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)))
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
      }
      span.end()
    },
    async forceFlush() {
      await provider.forceFlush()
    },
    async shutdown() {
      await provider.forceFlush()
      await provider.shutdown()
    }
  }
}

function createExporter(options: OpenTelemetryRuntimeOptions): SpanExporter {
  switch (options.exporter ?? 'otlp-http') {
    case 'memory':
      return options.memoryExporter ?? createInMemoryTraceExporter()
    case 'console':
      return new ConsoleSpanExporter()
    case 'otlp-http':
      return new OTLPTraceExporter({
        ...(options.endpoint ? { url: options.endpoint } : {}),
        ...(options.headers ? { headers: options.headers } : {})
      })
    case 'none':
      return createInMemoryTraceExporter()
  }
}

function disabledTelemetry(): OpenTelemetryRuntime {
  return {
    enabled: false,
    tracerName: 'qiongqi',
    startHttpSpan() {
      return { context: context.active() }
    },
    startGraphSpan() {
      return undefined
    },
    finishSpan() {},
    finishGraphSpan() {},
    async forceFlush() {},
    async shutdown() {}
  }
}

function parseGraphTraceMetrics(metrics: GraphTraceMetrics | undefined): GraphTraceMetrics {
  if (!metrics) return {}
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`graph trace metric ${name} must be a nonnegative finite number`)
  }
  return metrics
}
