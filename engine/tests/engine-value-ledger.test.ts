import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { EngineValueLedger } from '@qiongqi/loop'

const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'task-roi' }

describe('engine value ledger', () => {
  it('computes same-currency business ROI and remains idempotent by stable ids', async () => {
    const store = new InMemoryDurableEngineStore()
    const ledger = new EngineValueLedger({ store, scope })
    const cost = {
      costId: 'cost-1', scope, amount: 2, currency: 'USD', source: 'model', incurredAt: '2026-07-26T00:00:00.000Z'
    }
    await ledger.recordCost(cost)
    await ledger.recordCost(cost)
    const snapshot = await ledger.recordValue({
      valueId: 'value-1', scope, amount: 10, currency: 'USD', source: 'caller', confidence: 0.9,
      evidenceRefs: [], recordedAt: '2026-07-26T00:00:01.000Z'
    })
    expect(snapshot).toMatchObject({
      roiStatus: 'available', incurredCost: 2, businessValue: 10, netValue: 8, roiRatio: 4
    })
    expect(await store.listCosts(scope)).toHaveLength(1)
  })

  it('keeps missing value, zero cost and currency mismatch out of business ROI', async () => {
    const store = new InMemoryDurableEngineStore()
    const missing = new EngineValueLedger({ store, scope: { ...scope, taskId: 'missing' } })
    await missing.recordCost({ costId: 'cost', scope: { ...scope, taskId: 'missing' }, amount: 1, currency: 'USD', source: 'model', incurredAt: '2026-07-26T00:00:00.000Z' })
    expect((await missing.snapshot()).roiStatus).toBe('incomplete')

    const mismatch = new EngineValueLedger({ store, scope: { ...scope, taskId: 'mismatch' } })
    await mismatch.recordCost({ costId: 'cost', scope: { ...scope, taskId: 'mismatch' }, amount: 0, currency: 'USD', source: 'model', incurredAt: '2026-07-26T00:00:00.000Z' })
    const snapshot = await mismatch.recordValue({ valueId: 'value', scope: { ...scope, taskId: 'mismatch' }, amount: 2, currency: 'CNY', source: 'caller', confidence: 1, evidenceRefs: [], recordedAt: '2026-07-26T00:00:00.000Z' })
    expect(snapshot.roiStatus).toBe('unavailable')
    expect(snapshot.netValue).toBeUndefined()
  })
})
