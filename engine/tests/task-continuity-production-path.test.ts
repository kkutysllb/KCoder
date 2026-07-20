import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('kernel v3 production topology', () => {
  it('does not delegate the entire turn to classic orchestration', () => {
    const source = readFileSync(
      resolve('packages/http-layer/http/src/runtime-factory.ts'),
      'utf8'
    )

    expect(source).not.toContain(
      'delegate: (threadId, turnId) => classic.runTurn(threadId, turnId)'
    )
    expect(source).toContain('createKernelV3TurnRunner')
  })

  it('uses the production multi-node graph', async () => {
    const loop = await import('@qiongqi/loop')
    const productionKernelV3Graph = (
      loop as typeof loop & {
        productionKernelV3Graph?: () => { nodes: Array<{ id: string }> }
      }
    ).productionKernelV3Graph

    expect(productionKernelV3Graph).toBeTypeOf('function')
    expect(productionKernelV3Graph?.().nodes.map((node) => node.id)).toEqual([
      'prepare-turn',
      'restore-task',
      'build-context',
      'invoke-model',
      'normalize-proposal',
      'account-model',
      'evaluate',
      'commit-assistant',
      'materialize-proposal',
      'prepare-tools',
      'commit-tools',
      'project-progress',
      'govern-progress',
      'progress-checkpoint',
      'recover-context',
      'wait-user',
      'fail'
    ])
  })
})
