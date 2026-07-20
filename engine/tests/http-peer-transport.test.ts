import { describe, expect, it } from 'vitest'
import { HttpPeerTransport } from '@qiongqi/http'
import type { AgentCard } from '@qiongqi/contracts'
import { buildRuntimeCapabilityManifest } from '@qiongqi/contracts'
import { modelCapabilitiesForModel } from '@qiongqi/loop'

function card(overrides: Partial<AgentCard> = {}): AgentCard {
  return {
    id: 'peer-b',
    url: 'http://peer.example.test/base',
    name: 'Peer B',
    version: '0.1.0',
    skills: [],
    capabilities: buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fake-model')
    }),
    model: {
      provider: 'fake',
      defaultModel: 'fake-model',
      endpointFormats: ['chat_completions']
    },
    endpoints: {
      wellKnown: '/.well-known/agent-card.json',
      a2a: '/a2a',
      mcp: '/mcp'
    },
    ...overrides
  }
}

describe('HttpPeerTransport', () => {
  it('accepts legacy PeerArtifact responses', async () => {
    const transport = new HttpPeerTransport({
      fetchImpl: async () => new Response(JSON.stringify({
        peerCardId: 'peer-b',
        status: 'completed',
        summary: 'done'
      }), { status: 200 })
    })

    await expect(transport.invokeRemote(
      card(),
      { prompt: 'hello' },
      new AbortController().signal
    )).resolves.toMatchObject({
      peerCardId: 'peer-b',
      status: 'completed',
      summary: 'done'
    })
  })

  it('extracts the artifact from Stage 4 task responses', async () => {
    const transport = new HttpPeerTransport({
      fetchImpl: async () => new Response(JSON.stringify({
        task: {
          id: 'task-1',
          senderCardId: 'peer-a',
          prompt: 'hello',
          status: 'completed',
          createdAt: '2026-06-22T00:00:00.000Z',
          updatedAt: '2026-06-22T00:00:01.000Z'
        },
        artifact: {
          peerCardId: 'peer-b',
          status: 'completed',
          summary: 'stage 4 done'
        },
        artifacts: []
      }), { status: 200 })
    })

    await expect(transport.invokeRemote(
      card(),
      { prompt: 'hello' },
      new AbortController().signal
    )).resolves.toMatchObject({
      peerCardId: 'peer-b',
      status: 'completed',
      summary: 'stage 4 done'
    })
  })
})
