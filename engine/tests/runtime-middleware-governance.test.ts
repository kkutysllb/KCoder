import { describe, expect, it } from 'vitest'
import { MiddlewareChain } from '@qiongqi/loop'
import { loopGovernorMiddleware } from '@qiongqi/loop'
import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'

const identity: RunIdentity = { ownerUserId: 'u', workspaceKey: 'w', threadId: 't', turnId: 'tu', runId: 'r' }
const baseState: RunStateV3 = {
  version: 3, graphVersion: 'g', runtimeMode: 'kernel_v3', ...identity, status: 'running',
  cursor: { stepIndex: 1, nodeId: 'project-progress', attempt: 1, checkpointSeq: 1 },
  budgets: { stepsUsed: 1, toolCallsUsed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  recovery: { attempts: 0, maxAttempts: 1 }, middleware: {}, nodeData: {}, taskRevision: 1,
  pendingEffects: [], committedEffects: [], createdAt: 'now', updatedAt: 'now'
}

describe('loop governor middleware persistence adapter', () => {
  it('writes governor state through a middleware command and emits a terminal outcome', async () => {
    const chain = new MiddlewareChain([loopGovernorMiddleware()])
    let state = baseState
    for (let index = 0; index < 3; index += 1) {
      const result = await chain.run('afterNode', {
        identity, state, hook: 'afterNode',
        node: { id: 'project-progress', kind: 'project_progress', effect: 'state' },
        facts: {
          progressLevel: 'none', progressDigest: 'none',
          observations: [{ callId: `c${index}`, toolName: 'read', effect: 'read', capabilityClass: 'fs', resourceKeys: ['a'], canonicalArgumentsDigest: 'same', resultDigest: `r${index}`, resultItemId: `i${index}`, artifactRefs: [], failed: false, replayed: false }]
        }, commands: []
      })
      const commands = result?.commands ?? []
      const stateCommand = commands.find((command) => command.type === 'set-middleware-state')
      expect(stateCommand?.type).toBe('set-middleware-state')
      if (stateCommand?.type === 'set-middleware-state') {
        state = { ...state, middleware: { ...state.middleware, [stateCommand.id]: stateCommand.state } }
      }
      if (commands.some((command) => command.type === 'terminate')) {
        expect(commands).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'terminate' })]))
        return
      }
    }
    throw new Error('expected governor termination')
  })
})
