import type { RunEventEnvelope } from '@qiongqi/contracts'

export type ProjectedRuntimeEvent = {
  kind: 'pipeline_stage' | 'turn_started' | 'turn_completed' | 'turn_failed' | 'tool_call_started' | 'tool_call_finished'
  seq: number
  timestamp: string
  threadId: string
  turnId?: string
  stage?: string
  label?: string
  details?: Record<string, unknown>
  status?: string
  message?: string
  code?: string
  toolName?: string
  callId?: string
}

export function projectRunEvent(event: RunEventEnvelope): ProjectedRuntimeEvent | undefined {
  const runtime = { mode: 'kernel_v3', run_id: event.runId, ...(typeof (event.payload as { reason?: unknown })?.reason === 'string' ? { outcome_reason: (event.payload as { reason: string }).reason } : {}) }
  const base = { seq: event.seq, timestamp: event.timestamp, threadId: event.threadId, ...(event.turnId ? { turnId: event.turnId } : {}) }
  if (event.eventType === 'node.started') return { ...base, kind: 'pipeline_stage', stage: 'pre_send', label: 'Kernel node started', details: { runtime } }
  if (event.eventType === 'node.completed') return { ...base, kind: 'pipeline_stage', stage: 'response_received', label: 'Kernel node completed', details: { runtime } }
  if (event.eventType === 'run.created' || event.eventType === 'run.resumed') return { ...base, kind: 'turn_started', status: 'running', details: { runtime } }
  if (event.eventType === 'run.completed') return { ...base, kind: 'turn_completed', status: 'completed', details: { runtime } }
  if (event.eventType === 'run.failed') return { ...base, kind: 'turn_failed', status: 'failed', message: 'kernel run failed', details: { runtime } }
  if (event.eventType === 'effect.prepared') return { ...base, kind: 'tool_call_started', callId: event.idempotencyKey, toolName: typeof (event.payload as { target?: unknown })?.target === 'string' ? (event.payload as { target: string }).target : undefined, details: { runtime } }
  if (event.eventType === 'effect.committed') return { ...base, kind: 'tool_call_finished', callId: event.idempotencyKey, details: { runtime } }
  return undefined
}
