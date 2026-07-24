import { RuntimeInfoResponse } from '@qiongqi/contracts'
import { redactSecrets } from '@qiongqi/contracts'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export function runtimeInfoJsonResponse(runtime: ServerRuntime): JsonResponse {
  return jsonResponse(RuntimeInfoResponse.parse(runtime.info()))
}

export async function runtimeToolDiagnosticsJsonResponse(runtime: ServerRuntime): Promise<JsonResponse> {
  return jsonResponse(redactSecrets(await (runtime.toolDiagnostics?.() ?? {
    providers: [],
    mcpServers: [],
    webProviders: [],
    skills: {
      enabled: false,
      roots: [],
      skills: [],
      validationErrors: [],
      lastActivations: []
    },
    attachments: {
      enabled: false,
      rootDir: '',
      count: 0,
      totalBytes: 0
    },
    memory: {
      enabled: false,
      rootDir: '',
      activeCount: 0,
      tombstoneCount: 0,
      lastInjectedIds: []
    }
  })))
}

export async function runtimeMetricsJsonResponse(runtime: ServerRuntime): Promise<JsonResponse> {
  return jsonResponse(await buildRuntimeMetrics(runtime))
}

export async function runtimeMetricsResponse(request: Request, runtime: ServerRuntime): Promise<JsonResponse | Response> {
  const url = new URL(request.url)
  const wantsPrometheus = url.searchParams.get('format') === 'prometheus' ||
    request.headers.get('accept')?.includes('text/plain')
  const metrics = await buildRuntimeMetrics(runtime)
  if (!wantsPrometheus) return jsonResponse(metrics)
  return new Response(formatPrometheusMetrics(metrics), {
    status: 200,
    headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }
  })
}

async function buildRuntimeMetrics(runtime: ServerRuntime) {
  const usage = runtime.usageService.total()
  const tasks = await runtime.a2aTaskStore?.list().catch(() => []) ?? []
  const eventedV2 = runtime.multiAgentRuntime ? await runtime.multiAgentRuntime.metrics() : undefined
  const eventedV2Rollout = runtime.eventedV2Rollout?.snapshot()
  const eventedV2RemoteScheduler = runtime.multiAgentRemoteScheduler?.snapshot()
  const eventedV2Workers = runtime.multiAgentWorkerRegistry
    ? buildEventedV2WorkerRegistryMetrics(await runtime.multiAgentWorkerRegistry.list({ nowIso: runtime.nowIso() }))
    : undefined
  const byStatus: Record<string, number> = {}
  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1
  }
  const storage = await (runtime.storageDiagnostics?.() ?? {
    backend: 'unknown',
    available: true,
    degraded: false
  })
  return {
    service: 'qiongqi',
    generatedAt: runtime.nowIso(),
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      turns: usage.turns,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      ...(usage.costCny !== undefined ? { costCny: usage.costCny } : {})
    },
    cache: {
      cachedTokens: usage.cachedTokens,
      cacheHitTokens: usage.cacheHitTokens,
      cacheMissTokens: usage.cacheMissTokens,
      cacheHitRate: usage.cacheHitRate
    },
    a2a: {
      total: tasks.length,
      byStatus
    },
    ...(eventedV2 ? { eventedV2 } : {}),
    ...(eventedV2Rollout ? { eventedV2Rollout } : {}),
    ...(eventedV2RemoteScheduler ? { eventedV2RemoteScheduler } : {}),
    ...(eventedV2Workers ? { eventedV2Workers } : {}),
    storage
  }
}

function formatPrometheusMetrics(metrics: Awaited<ReturnType<typeof buildRuntimeMetrics>>): string {
  const lines = [
    '# HELP qiongqi_usage_total_tokens Total tokens observed by the runtime.',
    '# TYPE qiongqi_usage_total_tokens counter',
    `qiongqi_usage_total_tokens ${metrics.usage.totalTokens}`,
    '# HELP qiongqi_usage_prompt_tokens Prompt/input tokens observed by the runtime.',
    '# TYPE qiongqi_usage_prompt_tokens counter',
    `qiongqi_usage_prompt_tokens ${metrics.usage.promptTokens}`,
    '# HELP qiongqi_usage_completion_tokens Completion/output tokens observed by the runtime.',
    '# TYPE qiongqi_usage_completion_tokens counter',
    `qiongqi_usage_completion_tokens ${metrics.usage.completionTokens}`,
    '# HELP qiongqi_cache_hit_rate Runtime cache hit rate, or 0 when unknown.',
    '# TYPE qiongqi_cache_hit_rate gauge',
    `qiongqi_cache_hit_rate ${metrics.cache.cacheHitRate ?? 0}`,
    '# HELP qiongqi_a2a_tasks_total A2A tasks by status.',
    '# TYPE qiongqi_a2a_tasks_total gauge'
  ]
  const statuses = ['submitted', 'working', 'completed', 'failed', 'cancelled']
  for (const status of statuses) {
    lines.push(`qiongqi_a2a_tasks_total{status="${status}"} ${metrics.a2a.byStatus[status] ?? 0}`)
  }
  lines.push(`qiongqi_a2a_tasks_total ${metrics.a2a.total}`)
  if (metrics.eventedV2) {
    lines.push('# HELP qiongqi_evented_v2_runs_total Evented v2 multi-agent runs by status.')
    lines.push('# TYPE qiongqi_evented_v2_runs_total gauge')
    for (const status of labelKeys(['created', 'running', 'suspended', 'completed', 'failed', 'aborted'], metrics.eventedV2.byStatus)) {
      lines.push(`qiongqi_evented_v2_runs_total{status="${status}"} ${metrics.eventedV2.byStatus[status] ?? 0}`)
    }
    lines.push(`qiongqi_evented_v2_runs_total ${metrics.eventedV2.totalRuns}`)
    lines.push('# HELP qiongqi_evented_v2_outbox_pending Pending evented v2 outbox intents.')
    lines.push('# TYPE qiongqi_evented_v2_outbox_pending gauge')
    lines.push(`qiongqi_evented_v2_outbox_pending ${metrics.eventedV2.outbox.pending}`)
    lines.push('# HELP qiongqi_evented_v2_agent_runs_total Evented v2 agent runs by status.')
    lines.push('# TYPE qiongqi_evented_v2_agent_runs_total gauge')
    for (const status of labelKeys(['queued', 'running', 'completed', 'failed', 'aborted', 'suspended'], metrics.eventedV2.agentRuns.byStatus)) {
      lines.push(`qiongqi_evented_v2_agent_runs_total{status="${status}"} ${metrics.eventedV2.agentRuns.byStatus[status] ?? 0}`)
    }
    lines.push(`qiongqi_evented_v2_agent_runs_total ${metrics.eventedV2.agentRuns.total}`)
  }
  if (metrics.eventedV2Rollout) {
    lines.push('# HELP qiongqi_evented_v2_rollout_fallback_active Evented v2 rollout fallback circuit state.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_fallback_active gauge')
    lines.push(`qiongqi_evented_v2_rollout_fallback_active ${metrics.eventedV2Rollout.fallbackActive ? 1 : 0}`)
    lines.push('# HELP qiongqi_evented_v2_rollout_failure_rate Evented v2 rollout recent failure rate.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_failure_rate gauge')
    lines.push(`qiongqi_evented_v2_rollout_failure_rate ${metrics.eventedV2Rollout.failureRate}`)
    lines.push('# HELP qiongqi_evented_v2_rollout_recent_runs Evented v2 rollout recent runs tracked in the fallback window.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_recent_runs gauge')
    lines.push(`qiongqi_evented_v2_rollout_recent_runs ${metrics.eventedV2Rollout.total}`)
    lines.push('# HELP qiongqi_evented_v2_rollout_recent_failures Evented v2 rollout recent failed or aborted runs.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_recent_failures gauge')
    lines.push(`qiongqi_evented_v2_rollout_recent_failures ${metrics.eventedV2Rollout.failures}`)
    lines.push('# HELP qiongqi_evented_v2_rollout_consecutive_failures Evented v2 rollout consecutive failed or aborted runs.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_consecutive_failures gauge')
    lines.push(`qiongqi_evented_v2_rollout_consecutive_failures ${metrics.eventedV2Rollout.consecutiveFailures}`)
    lines.push('# HELP qiongqi_evented_v2_rollout_decisions_total Evented v2 rollout decisions by reason.')
    lines.push('# TYPE qiongqi_evented_v2_rollout_decisions_total counter')
    for (const [reason, value] of Object.entries(metrics.eventedV2Rollout.decisions).sort(([left], [right]) => left.localeCompare(right))) {
      lines.push(`qiongqi_evented_v2_rollout_decisions_total{reason="${reason}"} ${value ?? 0}`)
    }
  }
  if (metrics.eventedV2RemoteScheduler) {
    lines.push('# HELP qiongqi_evented_v2_remote_scheduler_running Evented v2 remote scheduler running state.')
    lines.push('# TYPE qiongqi_evented_v2_remote_scheduler_running gauge')
    lines.push(`qiongqi_evented_v2_remote_scheduler_running ${metrics.eventedV2RemoteScheduler.status === 'running' ? 1 : 0}`)
    lines.push('# HELP qiongqi_evented_v2_remote_scheduler_flushes_total Evented v2 remote scheduler flushes.')
    lines.push('# TYPE qiongqi_evented_v2_remote_scheduler_flushes_total counter')
    lines.push(`qiongqi_evented_v2_remote_scheduler_flushes_total ${metrics.eventedV2RemoteScheduler.flushesTotal}`)
    lines.push('# HELP qiongqi_evented_v2_remote_scheduler_messages_processed_total Evented v2 remote scheduler processed mailbox messages.')
    lines.push('# TYPE qiongqi_evented_v2_remote_scheduler_messages_processed_total counter')
    lines.push(`qiongqi_evented_v2_remote_scheduler_messages_processed_total ${metrics.eventedV2RemoteScheduler.messagesProcessedTotal}`)
    lines.push('# HELP qiongqi_evented_v2_remote_scheduler_errors_total Evented v2 remote scheduler polling errors.')
    lines.push('# TYPE qiongqi_evented_v2_remote_scheduler_errors_total counter')
    lines.push(`qiongqi_evented_v2_remote_scheduler_errors_total ${metrics.eventedV2RemoteScheduler.errorsTotal}`)
  }
  if (metrics.eventedV2Workers) {
    lines.push('# HELP qiongqi_evented_v2_workers_total Evented v2 registered workers.')
    lines.push('# TYPE qiongqi_evented_v2_workers_total gauge')
    lines.push(`qiongqi_evented_v2_workers_total ${metrics.eventedV2Workers.total}`)
    lines.push('# HELP qiongqi_evented_v2_workers_online Evented v2 online registered workers.')
    lines.push('# TYPE qiongqi_evented_v2_workers_online gauge')
    lines.push(`qiongqi_evented_v2_workers_online ${metrics.eventedV2Workers.online}`)
    lines.push('# HELP qiongqi_evented_v2_workers_expired Evented v2 expired registered workers.')
    lines.push('# TYPE qiongqi_evented_v2_workers_expired gauge')
    lines.push(`qiongqi_evented_v2_workers_expired ${metrics.eventedV2Workers.expired}`)
    for (const role of Object.keys(metrics.eventedV2Workers.byRole).sort()) {
      const counts = metrics.eventedV2Workers.byRole[role]!
      lines.push(`qiongqi_evented_v2_workers_total{role="${role}"} ${counts.total}`)
      lines.push(`qiongqi_evented_v2_workers_online{role="${role}"} ${counts.online}`)
      lines.push(`qiongqi_evented_v2_workers_expired{role="${role}"} ${counts.expired}`)
    }
  }
  lines.push('# HELP qiongqi_storage_degraded Storage degraded state, 1 when degraded.')
  lines.push('# TYPE qiongqi_storage_degraded gauge')
  lines.push(`qiongqi_storage_degraded ${metrics.storage.degraded ? 1 : 0}`)
  return `${lines.join('\n')}\n`
}

function buildEventedV2WorkerRegistryMetrics(workers: Awaited<ReturnType<NonNullable<ServerRuntime['multiAgentWorkerRegistry']>['list']>>) {
  const byRole: Record<string, { total: number, online: number, expired: number }> = {}
  for (const worker of workers) {
    const bucket = byRole[worker.role] ?? { total: 0, online: 0, expired: 0 }
    bucket.total += 1
    if (worker.status === 'online') bucket.online += 1
    if (worker.status === 'expired') bucket.expired += 1
    byRole[worker.role] = bucket
  }
  return {
    total: workers.length,
    online: workers.filter((worker) => worker.status === 'online').length,
    expired: workers.filter((worker) => worker.status === 'expired').length,
    byRole,
    workers
  }
}

function labelKeys(defaults: string[], counts: Record<string, number>): string[] {
  return [...new Set([...defaults, ...Object.keys(counts)])]
}
