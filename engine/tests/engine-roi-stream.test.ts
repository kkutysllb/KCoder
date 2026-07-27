import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { EngineStreamPublisher, EngineValueLedger } from '@qiongqi/loop'

describe('ROI stream projection', () => {
  it('emits a durable roi snapshot after value updates', async () => {
    const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'roi-stream' }
    const store = new InMemoryDurableEngineStore()
    const stream = new EngineStreamPublisher({ store, streamId: 'roi-stream', scope })
    const ledger = new EngineValueLedger({ store, scope, stream })
    await ledger.recordCost({ costId: 'cost', scope, amount: 1, currency: 'USD', source: 'model', incurredAt: '2026-07-26T00:00:00.000Z' })
    await ledger.recordValue({ valueId: 'value', scope, amount: 3, currency: 'USD', source: 'caller', confidence: 1, evidenceRefs: [], recordedAt: '2026-07-26T00:00:00.000Z' })
    const events = await store.readStream('roi-stream', 0, 10)
    expect(events.map((event) => event.kind)).toEqual(['roi.snapshot', 'roi.snapshot'])
    expect(events.at(-1)?.payload).toMatchObject({ roiStatus: 'available', roiRatio: 2 })
  })

  it('publishes graph-attributed ROI snapshots as cost and value arrive', async () => {
    const scope = { ownerId: 'owner', workspaceId: 'workspace', taskId: 'graph-roi-stream' }
    const graph = {
      graphId: 'graph-roi', graphRevision: 1, runId: 'graph-run', nodeId: 'agent-a', attemptId: 'attempt-a'
    }
    const store = new InMemoryDurableEngineStore()
    const stream = new EngineStreamPublisher({ store, streamId: 'graph-roi-stream', scope })
    const ledger = new EngineValueLedger({ store, scope, stream })
    const costSnapshot = await ledger.recordCost({
      costId: 'graph-cost', scope, amount: 2, currency: 'USD', source: 'model', graph,
      incurredAt: '2026-07-26T00:00:00.000Z'
    })
    const valueSnapshot = await ledger.recordValue({
      valueId: 'graph-value', scope, amount: 6, currency: 'USD', source: 'caller', confidence: 1,
      evidenceRefs: [], graph, recordedAt: '2026-07-26T00:00:01.000Z'
    })

    expect(costSnapshot).toMatchObject({ graph: { graphId: 'graph-roi', graphRevision: 1, runId: 'graph-run' } })
    expect(valueSnapshot).toMatchObject({
      roiRatio: 2,
      byNode: { 'agent-a': { cost: 2, businessValue: 6 } }
    })
    const events = await store.readStream('graph-roi-stream', 0, 10)
    expect(events.at(-1)?.payload).toMatchObject({ graph: { runId: 'graph-run' }, roiRatio: 2 })
  })
})
