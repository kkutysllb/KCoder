import { describe, expect, it } from 'vitest'
import type { ModelClient, ModelRequest } from '@qiongqi/ports'
import { buildDefaultLocalTools } from '@qiongqi/adapter-tools'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

const policy = (allowedToolNames: string[]) => ({
  policyId: 'product.agent.office',
  revision: 1,
  skills: { allowedSkillIds: [], requiredSkillIds: [] },
  tools: { allowedToolNames }
})

describe('turn execution policy enforcement', () => {
  it('uses an exact empty tool allow-list without adding GUI state tools', async () => {
    let request: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(input) {
        request = input
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const harness = makeHarness(model, { tools: buildDefaultLocalTools() })
    await bootstrapThread(harness, {
      request: { prompt: 'read nothing', executionPolicy: policy([]) }
    })

    await harness.loop.runTurn(harness.threadId, harness.turnId)

    expect(request?.tools).toEqual([])
  })

  it('advertises only explicitly allowed tools', async () => {
    let request: ModelRequest | undefined
    const model: ModelClient = {
      provider: 'fake',
      model: 'fake',
      async *stream(input) {
        request = input
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
    const harness = makeHarness(model, { tools: buildDefaultLocalTools() })
    await bootstrapThread(harness, {
      request: { prompt: 'read one file', executionPolicy: policy(['read']) }
    })

    await harness.loop.runTurn(harness.threadId, harness.turnId)

    expect(request?.tools.map((tool) => tool.name)).toEqual(['read'])
  })
})
