import { describe, expect, it } from 'vitest'

import {
  parseVerifyEventedA2AOptions,
  resolveExternalPeerConfig,
  summarizeVerification
} from '../scripts/verify-evented-a2a.mjs'

describe('verify-evented-a2a script helpers', () => {
  it('defaults to deterministic local verification without an external peer', () => {
    const options = parseVerifyEventedA2AOptions([], {})

    expect(options).toMatchObject({
      host: '127.0.0.1',
      portA: 19160,
      portB: 19161,
      tokenA: 'qq-local-a',
      tokenB: 'qq-local-b',
      runExternalPeer: false
    })
    expect(options.dataDirA).toContain('qq-evented-a2a-a')
    expect(options.dataDirB).toContain('qq-evented-a2a-b')
  })

  it('parses explicit ports, data dirs, and external-peer opt-in', () => {
    const options = parseVerifyEventedA2AOptions([
      '--host', '0.0.0.0',
      '--port-a', '20100',
      '--port-b', '20101',
      '--data-dir-a', '/tmp/a',
      '--data-dir-b', '/tmp/b',
      '--external-peer'
    ], {})

    expect(options).toMatchObject({
      host: '0.0.0.0',
      portA: 20100,
      portB: 20101,
      dataDirA: '/tmp/a',
      dataDirB: '/tmp/b',
      runExternalPeer: true
    })
  })

  it('requires both URL and token for external peer verification', () => {
    expect(resolveExternalPeerConfig({
      QIONGQI_A2A_PEER_URL: 'https://agent.example.test'
    })).toEqual({
      ok: false,
      reason: 'set both QIONGQI_A2A_PEER_URL and QIONGQI_A2A_PEER_TOKEN'
    })

    expect(resolveExternalPeerConfig({
      QIONGQI_A2A_PEER_URL: 'https://agent.example.test',
      QIONGQI_A2A_PEER_TOKEN: 'secret-token'
    })).toEqual({
      ok: true,
      url: 'https://agent.example.test',
      token: 'secret-token'
    })
  })

  it('summarizes local and skipped external verification honestly', () => {
    expect(summarizeVerification({
      local: 'passed',
      external: 'skipped',
      externalReason: 'no peer configured'
    })).toContain('local evented A2A: passed')
    expect(summarizeVerification({
      local: 'passed',
      external: 'skipped',
      externalReason: 'no peer configured'
    })).toContain('external peer: skipped (no peer configured)')
  })
})
