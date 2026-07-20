import type { OrchestrationMode } from './turn-event-types.js'
import { normalizeOrchestrationMode } from './turn-event-types.js'

export type RuntimeMetricLabels = { mode: OrchestrationMode; provider?: string; reason?: string }
export type RuntimeMetric = { name: 'run_outcome' | 'recovery' | 'effect_deduplicated' | 'scope_violation' | 'middleware_duration_ms' | 'classic_fallback'; value: number; labels: RuntimeMetricLabels }

export class RuntimeRolloutMetrics {
  private readonly counters = new Map<string, RuntimeMetric>()

  increment(name: RuntimeMetric['name'], labels: RuntimeMetricLabels, value = 1): RuntimeMetric {
    const safeLabels = { mode: labels.mode, ...(labels.provider ? { provider: labels.provider.slice(0, 80) } : {}), ...(labels.reason ? { reason: labels.reason.slice(0, 120) } : {}) }
    const key = `${name}|${JSON.stringify(safeLabels)}`
    const current = this.counters.get(key)
    const metric = current ? { ...current, value: current.value + value } : { name, value, labels: safeLabels }
    this.counters.set(key, metric)
    return metric
  }

  snapshot(): RuntimeMetric[] { return [...this.counters.values()].map((metric) => ({ ...metric, labels: { ...metric.labels } })) }
}

export function resolveRuntimeRolloutMode(input: { configured?: unknown; enabled?: boolean; threadMetadata?: { orchestrationMode?: unknown } }): OrchestrationMode {
  const requested = input.threadMetadata?.orchestrationMode ?? input.configured
  const mode = normalizeOrchestrationMode(requested)
  if (mode === 'kernel_v3' && input.enabled !== true) return 'classic'
  return mode
}
