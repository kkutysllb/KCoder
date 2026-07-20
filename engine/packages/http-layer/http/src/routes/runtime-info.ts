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
  lines.push('# HELP qiongqi_storage_degraded Storage degraded state, 1 when degraded.')
  lines.push('# TYPE qiongqi_storage_degraded gauge')
  lines.push(`qiongqi_storage_degraded ${metrics.storage.degraded ? 1 : 0}`)
  return `${lines.join('\n')}\n`
}
