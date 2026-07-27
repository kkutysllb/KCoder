import { describe, expect, it } from 'vitest'
import {
  canonicalDigest,
  modelLogicalRequestKey,
  modelRequestFingerprint,
  progressFingerprint,
  strategyDigest,
  toolExactFingerprint
} from '@qiongqi/loop'

const scope = { ownerId: 'owner-1', workspaceId: 'workspace-1', taskId: 'task-1' }

function tool(callId: string, args: Record<string, unknown>) {
  return {
    scope,
    call: { callId, toolName: 'read_file', arguments: args },
    resourceVersions: { repository: 'rev-1' }
  }
}

describe('execution fingerprints', () => {
  it('ignores callId and object key order for exact tool fingerprints', () => {
    expect(toolExactFingerprint(tool('call-1', { path: 'a', line: 2 })))
      .toBe(toolExactFingerprint(tool('call-2', { line: 2, path: 'a' })))
  })

  it('changes tool fingerprints across task or resource-version boundaries', () => {
    const base = tool('call-1', { path: 'a' })
    expect(toolExactFingerprint({ ...base, scope: { ...scope, taskId: 'task-2' } }))
      .not.toBe(toolExactFingerprint(base))
    expect(toolExactFingerprint({ ...base, resourceVersions: { repository: 'rev-2' } }))
      .not.toBe(toolExactFingerprint(base))
  })

  it('sorts object keys, preserves array order, and rejects undefined', () => {
    expect(canonicalDigest({ b: 2, a: { y: true, x: false } }))
      .toBe(canonicalDigest({ a: { x: false, y: true }, b: 2 }))
    expect(canonicalDigest({ values: ['a', 'b'] })).not.toBe(canonicalDigest({ values: ['b', 'a'] }))
    expect(() => canonicalDigest({ invalid: undefined })).toThrow(/undefined/)
  })

  it('separates logical model identity from immutable physical request identity', () => {
    const logical = {
      scope,
      kernelRunId: 'kernel-1',
      taskRevision: 3,
      contextRevision: 2,
      strategyDigest: 'strategy-1'
    }
    expect(modelLogicalRequestKey(logical)).toBe(modelLogicalRequestKey({ ...logical }))
    expect(modelLogicalRequestKey({ ...logical, contextRevision: 3 })).not.toBe(modelLogicalRequestKey(logical))

    const request = { logical, profileRef: { profileId: 'primary', revision: 1 }, request: { messages: ['hello'] } }
    expect(modelRequestFingerprint({ ...request, profileRef: { profileId: 'primary', revision: 2 } }))
      .not.toBe(modelRequestFingerprint(request))
  })

  it('fingerprints progress and strategy content rather than revision counters', () => {
    const progress = {
      taskRevision: 1,
      evidenceDigests: ['evidence-1'],
      artifactDigests: [],
      decisionDigests: [],
      resourceDigests: { repository: 'rev-1' },
      attemptedStrategyDigests: ['strategy-0']
    }
    expect(progressFingerprint({ ...progress, resourceDigests: { repository: 'rev-2' } }))
      .not.toBe(progressFingerprint(progress))
    expect(strategyDigest({ strategy: { action: 'inspect', target: 'src' }, correctionFacts: ['avoid repeat'] }))
      .toBe(strategyDigest({
        strategy: { target: 'src', action: 'inspect' },
        correctionFacts: ['avoid repeat'],
        strategyRevision: 99
      }))
  })
})
