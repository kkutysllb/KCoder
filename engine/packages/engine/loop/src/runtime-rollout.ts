import type { OrchestrationMode } from './turn-event-types.js'
import { normalizeOrchestrationMode } from './turn-event-types.js'

export type RuntimeMetricLabels = { mode: OrchestrationMode; provider?: string; reason?: string }
export type RuntimeMetric = { name: 'run_outcome' | 'recovery' | 'effect_deduplicated' | 'scope_violation' | 'middleware_duration_ms' | 'classic_fallback' | 'evented_v2_rollout'; value: number; labels: RuntimeMetricLabels }
export type EventedV2RolloutStage = 'off' | 'shadow' | 'canary' | 'default'
export type EventedV2FallbackReason = 'failure_rate' | 'consecutive_failures' | 'forced'
export type EventedV2RunOutcome = 'completed' | 'failed' | 'aborted'
export type EventedV2AutoFallbackPolicy = {
  enabled?: boolean
  windowSize?: number
  minRuns?: number
  failureRateThreshold?: number
  consecutiveFailures?: number
  cooldownMs?: number
}
export type EventedV2RolloutPolicy = {
  stage?: EventedV2RolloutStage
  canaryPercent?: number
  shadowSamplePercent?: number
  fallbackMode?: Extract<OrchestrationMode, 'classic' | 'kernel_v3'>
  autoFallback?: EventedV2AutoFallbackPolicy
}
export type EventedV2RolloutDecision = {
  stage: EventedV2RolloutStage
  primaryMode: OrchestrationMode
  shadowMode?: Extract<OrchestrationMode, 'evented_v2'>
  fallbackMode: Extract<OrchestrationMode, 'classic' | 'kernel_v3'>
  reason: 'off' | 'shadow' | 'shadow_not_sampled' | 'canary_selected' | 'canary_not_selected' | 'default' | 'auto_fallback'
  fallbackReason?: EventedV2FallbackReason
}
export type EventedV2RolloutSnapshot = {
  stage: EventedV2RolloutStage
  fallbackActive: boolean
  fallbackReason?: EventedV2FallbackReason
  fallbackUntilMs?: number
  windowSize: number
  total: number
  failures: number
  failureRate: number
  consecutiveFailures: number
  decisions: Partial<Record<EventedV2RolloutDecision['reason'], number>>
}

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

export function resolveEventedV2RolloutMode(input: {
  policy?: EventedV2RolloutPolicy
  threadId?: string
  forcedFallback?: { active: boolean; reason?: EventedV2FallbackReason }
}): EventedV2RolloutDecision {
  const fallbackMode = input.policy?.fallbackMode ?? 'kernel_v3'
  const stage = input.policy?.stage ?? 'off'
  if (input.forcedFallback?.active) {
    return {
      stage,
      primaryMode: fallbackMode,
      fallbackMode,
      reason: 'auto_fallback',
      fallbackReason: input.forcedFallback.reason ?? 'forced'
    }
  }
  if (stage === 'default') {
    return { stage, primaryMode: 'evented_v2', fallbackMode, reason: 'default' }
  }
  if (stage === 'shadow') {
    const percent = clampPercent(input.policy?.shadowSamplePercent ?? 100)
    if (stablePercent(input.threadId ?? '') >= percent) {
      return {
        stage,
        primaryMode: fallbackMode,
        fallbackMode,
        reason: 'shadow_not_sampled'
      }
    }
    return {
      stage,
      primaryMode: fallbackMode,
      shadowMode: 'evented_v2',
      fallbackMode,
      reason: 'shadow'
    }
  }
  if (stage === 'canary') {
    const percent = clampPercent(input.policy?.canaryPercent ?? 0)
    const selected = stablePercent(input.threadId ?? '') < percent
    return {
      stage,
      primaryMode: selected ? 'evented_v2' : fallbackMode,
      fallbackMode,
      reason: selected ? 'canary_selected' : 'canary_not_selected'
    }
  }
  return { stage: 'off', primaryMode: fallbackMode, fallbackMode, reason: 'off' }
}

export class EventedV2RolloutController {
  private readonly outcomes: EventedV2RunOutcome[] = []
  private readonly decisions = new Map<EventedV2RolloutDecision['reason'], number>()
  private fallbackUntilMs = 0
  private fallbackReason: EventedV2FallbackReason | undefined

  constructor(private readonly options: {
    policy?: EventedV2RolloutPolicy
    nowMs?: () => number
  } = {}) {}

  decide(input: { threadId?: string } = {}): EventedV2RolloutDecision {
    const now = this.nowMs()
    const active = this.fallbackUntilMs > now
    if (!active) this.fallbackReason = undefined
    return resolveEventedV2RolloutMode({
      policy: this.options.policy,
      threadId: input.threadId,
      forcedFallback: active
        ? { active: true, reason: this.fallbackReason ?? 'forced' }
        : undefined
    })
  }

  recordOutcome(outcome: EventedV2RunOutcome): EventedV2RolloutSnapshot {
    const policy = normalizedAutoFallbackPolicy(this.options.policy?.autoFallback)
    this.outcomes.push(outcome)
    while (this.outcomes.length > policy.windowSize) this.outcomes.shift()
    if (policy.enabled) {
      const snapshot = this.snapshot()
      const reason = fallbackReasonForSnapshot(snapshot, policy)
      if (reason) {
        this.fallbackUntilMs = this.nowMs() + policy.cooldownMs
        this.fallbackReason = reason
      }
    }
    return this.snapshot()
  }

  recordDecision(decision: EventedV2RolloutDecision): EventedV2RolloutSnapshot {
    this.decisions.set(decision.reason, (this.decisions.get(decision.reason) ?? 0) + 1)
    return this.snapshot()
  }

  snapshot(): EventedV2RolloutSnapshot {
    const now = this.nowMs()
    const failures = this.outcomes.filter(isFailureOutcome).length
    const total = this.outcomes.length
    const fallbackActive = this.fallbackUntilMs > now
    return {
      stage: this.options.policy?.stage ?? 'off',
      fallbackActive,
      ...(fallbackActive && this.fallbackReason ? { fallbackReason: this.fallbackReason } : {}),
      ...(fallbackActive ? { fallbackUntilMs: this.fallbackUntilMs } : {}),
      windowSize: normalizedAutoFallbackPolicy(this.options.policy?.autoFallback).windowSize,
      total,
      failures,
      failureRate: total > 0 ? failures / total : 0,
      consecutiveFailures: countConsecutiveFailures(this.outcomes),
      decisions: Object.fromEntries([...this.decisions.entries()].sort(([left], [right]) => left.localeCompare(right)))
    }
  }

  private nowMs(): number {
    return this.options.nowMs?.() ?? Date.now()
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.floor(value)))
}

function stablePercent(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 100
}

function normalizedAutoFallbackPolicy(policy: EventedV2AutoFallbackPolicy | undefined): Required<EventedV2AutoFallbackPolicy> {
  const windowSize = clampInt(policy?.windowSize ?? 20, 1, 1000)
  return {
    enabled: policy?.enabled === true,
    windowSize,
    minRuns: clampInt(policy?.minRuns ?? Math.min(5, windowSize), 1, windowSize),
    failureRateThreshold: clampRatio(policy?.failureRateThreshold ?? 0.5),
    consecutiveFailures: clampInt(policy?.consecutiveFailures ?? 3, 1, windowSize),
    cooldownMs: clampInt(policy?.cooldownMs ?? 60_000, 1, 86_400_000)
  }
}

function fallbackReasonForSnapshot(
  snapshot: Pick<EventedV2RolloutSnapshot, 'total' | 'failureRate' | 'consecutiveFailures'>,
  policy: Required<EventedV2AutoFallbackPolicy>
): EventedV2FallbackReason | undefined {
  if (snapshot.total < policy.minRuns) return undefined
  if (snapshot.failureRate >= policy.failureRateThreshold) return 'failure_rate'
  if (snapshot.consecutiveFailures >= policy.consecutiveFailures) return 'consecutive_failures'
  return undefined
}

function isFailureOutcome(outcome: EventedV2RunOutcome): boolean {
  return outcome === 'failed' || outcome === 'aborted'
}

function countConsecutiveFailures(outcomes: EventedV2RunOutcome[]): number {
  let count = 0
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (!isFailureOutcome(outcomes[index]!)) break
    count += 1
  }
  return count
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}
