import { describe, expect, it } from 'vitest'
import { MiddlewareChain, loopGovernorMiddleware } from '@qiongqi/loop'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
const baseState: RunStateV3 = {
  version: 3, graphVersion: 'g', runtimeMode: 'kernel_v3', ...identity, status: 'running',
  cursor: { stepIndex: 1, nodeId: 'project-progress', attempt: 1, checkpointSeq: 1 },
  budgets: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, nodeData: {}, taskRevision: 1,
  pendingEffects: [], committedEffects: [], createdAt: 'now', updatedAt: 'now'
}

describe('Kernel v3 no-progress outcome', () => {
  it.each([
    { label: 'fresh repeated observations', replayed: false },
    { label: 'durably replayed observations', replayed: true }
  ])('degrades with no_progress after $label', async ({ replayed }) => {
    const chain = new MiddlewareChain([loopGovernorMiddleware()])
    let state = baseState
    for (let index = 0; index < 4; index += 1) {
      const result = await chain.run('afterNode', {
        identity,
        state,
        hook: 'afterNode',
        node: { id: 'project-progress', kind: 'project_progress', effect: 'state' },
        facts: {
          progressLevel: 'none',
          progressDigest: 'unchanged',
          observations: [{
            callId: `call-${index}`, toolName: 'read', effect: 'read', capabilityClass: 'fs', resourceKeys: ['a'],
            canonicalArgumentsDigest: 'same', resultDigest: `result-${index}`, resultItemId: `item-${index}`,
            artifactRefs: [], failed: false, replayed
          }]
        },
        commands: []
      })
      const commands = result?.commands ?? []
      const stateCommand = commands.find((command) => command.type === 'set-middleware-state')
      if (stateCommand?.type === 'set-middleware-state') {
        state = { ...state, middleware: { ...state.middleware, [stateCommand.id]: stateCommand.state } }
      }
      const terminal = commands.find((command) => command.type === 'terminate')
      if (terminal?.type === 'terminate') {
        expect(terminal.outcome).toMatchObject({ status: 'degraded', reason: 'no_progress', retryable: false })
        return
      }
    }
    throw new Error('expected no-progress termination')
  })
})
