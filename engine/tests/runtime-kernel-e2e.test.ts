import { expect, it } from 'vitest'
import { InMemoryRunEventStore, InMemoryRunStateStore } from '@qiongqi/adapter-storage'
import { RuntimeKernel, type ExecutionGraph } from '@qiongqi/loop'

it('runs an offline kernel graph end to end', async () => {
  const graph: ExecutionGraph = { version: 'e2e', startNodeId: 'start', predicates: ['next'], nodes: [{ id: 'start', kind: 'start', effect: 'pure' }, { id: 'done', kind: 'done', effect: 'state', terminal: true }], edges: [{ from: 'start', to: 'done', when: 'next' }] }
  const identity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
  const store = new InMemoryRunStateStore()
  const outcome = await new RuntimeKernel({ graph, snapshots: store, events: new InMemoryRunEventStore(), leases: store, holderId: 'e2e', nodes: { start: () => ({ condition: 'next' }), done: () => ({ outcome: { status: 'completed', reason: 'normal_stop', retryable: false } }) } }).run(identity)
  expect(outcome).toMatchObject({ status: 'completed', reason: 'normal_stop' })
})
