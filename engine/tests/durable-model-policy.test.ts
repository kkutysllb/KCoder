import { describe, expect, it } from 'vitest'
import { InMemoryDurableEngineStore } from '@qiongqi/adapter-storage'
import { createEngine, ModelProfileRegistry } from '@qiongqi/loop'
import type { ModelProvider } from '@qiongqi/ports'

const scope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }
const capabilities = {
  streaming: true, toolCalling: true, structuredOutput: true, reasoning: false,
  inputModalities: ['text'], outputModalities: ['text']
}

describe('durable task model policy', () => {
  it('loads the policy and validated profile revision after facade restart', async () => {
    const store = new InMemoryDurableEngineStore()
    const registry = new ModelProfileRegistry()
    registry.register({
      profileId: 'alpha', revision: 1, providerId: 'provider-a', modelId: 'alpha-1',
      endpointFormat: 'chat_completions', capabilities
    }, provider('provider-a'))
    const engineA = createEngine(engineOptions(store, registry))
    const engineB = createEngine(engineOptions(store, registry))

    await engineA.setTaskModelPolicy(scope, 1, { authorizedProfileIds: ['alpha'] })

    await expect(engineB.getTaskModelPolicy(scope)).resolves.toMatchObject({
      revision: 1,
      policy: { authorizedProfileIds: ['alpha'] },
      validatedProfileRefs: [{ profileId: 'alpha', revision: 1 }]
    })
  })
})

function engineOptions(store: InMemoryDurableEngineStore, modelRegistry: ModelProfileRegistry) {
  return {
    store,
    modelRegistry,
    kernelExecutor: { execute: async () => { throw new Error('unused') }, resume: async () => undefined, cancel: async () => undefined },
    orchestrator: { start: async () => { throw new Error('unused') }, load: async () => undefined }
  }
}

function provider(providerId: string): ModelProvider {
  return { providerId, capabilities: () => capabilities, async *stream() { yield { kind: 'completed' as const, stopReason: 'stop' } } }
}
