import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isTerminalState, trySetTerminalState } from '@qiongqi/delegation'
import { FileA2ATaskStore } from '@qiongqi/http'
import type { A2ATaskRecord } from '@qiongqi/http'

describe('terminal state guard', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qiongqi-terminal-state-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('identifies terminal states', () => {
    expect(isTerminalState('completed')).toBe(true)
    expect(isTerminalState('failed')).toBe(true)
    expect(isTerminalState('cancelled')).toBe(true)
    expect(isTerminalState('working')).toBe(false)
  })

  it('accepts non-terminal to terminal transitions', () => {
    const current = { status: 'working', value: 1 }
    const next = { status: 'completed', value: 2 }

    expect(trySetTerminalState(current, next)).toEqual({
      accepted: true,
      record: next
    })
  })

  it('rejects terminal overwrites by a different terminal state', () => {
    const current = { status: 'completed', summary: 'done' }
    const next = { status: 'cancelled', error: 'late cancel' }

    expect(trySetTerminalState(current, next)).toEqual({
      accepted: false,
      record: current
    })
  })

  it('allows idempotent same-terminal updates', () => {
    const current = { status: 'failed', error: 'first' }
    const next = { status: 'failed', error: 'first', updatedAt: 'later' }

    expect(trySetTerminalState(current, next)).toEqual({
      accepted: true,
      record: next
    })
  })

  it('preserves terminal A2A task records from late racing updates', async () => {
    const store = new FileA2ATaskStore(dir)
    const completed = task({ status: 'completed', summary: 'done' })
    await store.upsert(completed)
    await store.upsert(task({ status: 'cancelled', error: 'late cancel', updatedAt: '2026-06-22T00:00:01.000Z' }))

    expect(await store.get('task_1')).toMatchObject({
      status: 'completed',
      summary: 'done'
    })
  })

  it('does not let failed A2A task records become completed later', async () => {
    const store = new FileA2ATaskStore(dir)
    await store.upsert(task({ status: 'failed', error: 'boom' }))
    await store.upsert(task({ status: 'completed', summary: 'late success', updatedAt: '2026-06-22T00:00:01.000Z' }))

    expect(await store.get('task_1')).toMatchObject({
      status: 'failed',
      error: 'boom'
    })
  })
})

function task(overrides: Partial<A2ATaskRecord>): A2ATaskRecord {
  return {
    id: 'task_1',
    senderCardId: 'sender',
    prompt: 'do work',
    status: 'working',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides
  }
}
