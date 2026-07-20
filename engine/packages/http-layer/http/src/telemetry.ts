import { context, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { ConsoleSpanExporter, InMemorySpanExporter, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { OpenTelemetryConfig } from '@qiongqi/contracts'

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
  finishSpan(span: Span | undefined, input: { status: number; error?: unknown }): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

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
    finishSpan() {},
    async forceFlush() {},
    async shutdown() {}
  }
}
