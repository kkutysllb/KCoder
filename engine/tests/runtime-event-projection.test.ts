import { expect, it } from 'vitest'
import { projectRunEvent } from '@qiongqi/loop'
import type { RunEventEnvelope } from '@qiongqi/contracts'

const base: RunEventEnvelope = { eventId: 'e1', seq: 1, ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r', eventType: 'node.completed', payload: { reason: 'normal_stop' }, timestamp: '2026-07-15T00:00:00.000Z' }

it('projects kernel events to additive SSE-compatible runtime events', () => {
  const projected = projectRunEvent(base)
  expect(projected).toMatchObject({ kind: 'pipeline_stage', seq: 1, details: { runtime: { mode: 'kernel_v3', run_id: 'r', outcome_reason: 'normal_stop' } } })
  expect(JSON.stringify(projected)).not.toContain('arguments')
})
