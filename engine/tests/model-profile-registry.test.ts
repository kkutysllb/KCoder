import { describe, expect, it } from 'vitest'
import { ModelProfileRegistry } from '@qiongqi/loop'
import type { ModelProvider } from '@qiongqi/ports'

const capabilities = { streaming: true, toolCalling: true, structuredOutput: true, reasoning: false, inputModalities: ['text'], outputModalities: ['text'] }
const provider = (providerId: string): ModelProvider => ({
  providerId,
  capabilities: () => capabilities,
  async *stream() { yield { kind: 'completed', stopReason: 'stop' } }
})

describe('model-neutral profile registry', () => {
  it('routes only caller-authorized profiles and supports task-time switching', () => {
    const registry = new ModelProfileRegistry()
    registry.register({ profileId: 'alpha', revision: 1, providerId: 'provider-a', modelId: 'alpha-1', endpointFormat: 'chat_completions', capabilities }, provider('provider-a'))
    registry.register({ profileId: 'beta', revision: 3, providerId: 'provider-b', modelId: 'beta-3', endpointFormat: 'messages', capabilities }, provider('provider-b'))
    expect(registry.resolve({ authorizedProfileIds: ['alpha', 'beta'], preferredProfileId: 'beta' }).profileRef).toEqual({ profileId: 'beta', revision: 3 })
    expect(registry.resolve({ authorizedProfileIds: ['alpha', 'beta'], preferredProfileId: 'alpha' }).profileRef).toEqual({ profileId: 'alpha', revision: 1 })
    expect(() => registry.resolve({ authorizedProfileIds: ['alpha'], preferredProfileId: 'beta' })).toThrow('not authorized')
  })

  it('strictly rejects missing capabilities and degrade records exact differences', () => {
    const registry = new ModelProfileRegistry()
    registry.register({ profileId: 'text-only', revision: 1, providerId: 'provider', modelId: 'text', endpointFormat: 'chat_completions', capabilities: { ...capabilities, toolCalling: false } }, provider('provider'))
    expect(() => registry.resolve({ authorizedProfileIds: ['text-only'], capabilityMode: 'strict' }, { toolCalling: true })).toThrow('no authorized')
    expect(registry.resolve({ authorizedProfileIds: ['text-only'], capabilityMode: 'degrade' }, { toolCalling: true })).toMatchObject({ degraded: true, differences: ['toolCalling'] })
  })

  it('keeps prepared attempts pinned to an exact profile revision', () => {
    const registry = new ModelProfileRegistry()
    registry.register({ profileId: 'alpha', revision: 1, providerId: 'provider-v1', modelId: 'alpha-1', endpointFormat: 'chat_completions', capabilities }, provider('provider-v1'))
    const prepared = registry.resolve({ authorizedProfileIds: ['alpha'] })

    registry.register({ profileId: 'alpha', revision: 2, providerId: 'provider-v2', modelId: 'alpha-2', endpointFormat: 'responses', capabilities }, provider('provider-v2'))

    expect(registry.resolve({ authorizedProfileIds: ['alpha'] }).profileRef).toEqual({ profileId: 'alpha', revision: 2 })
    expect(registry.provider(prepared.profileRef).providerId).toBe('provider-v1')
  })
})
