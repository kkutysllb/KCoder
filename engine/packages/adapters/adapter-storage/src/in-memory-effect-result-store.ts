import type { RunIdentity } from '@qiongqi/contracts'
import type { EffectResultStore, StoredEffectResult } from '@qiongqi/ports'
import { effectResultDigest } from './effect-result-digest.js'
import { runtimeScopeDigest } from './runtime-store-utils.js'

export class InMemoryEffectResultStore implements EffectResultStore {
  private readonly results = new Map<string, StoredEffectResult>()

  async load(
    identity: RunIdentity,
    idempotencyKey: string
  ): Promise<StoredEffectResult | undefined> {
    const stored = this.results.get(resultKey(identity, idempotencyKey))
    if (!stored) return undefined
    verifyDigest(stored.resultDigest, stored.result)
    return structuredClone(stored)
  }

  async save(
    identity: RunIdentity,
    idempotencyKey: string,
    resultDigest: string,
    result: unknown
  ): Promise<void> {
    verifyDigest(resultDigest, result)
    this.results.set(
      resultKey(identity, idempotencyKey),
      structuredClone({ resultDigest, result })
    )
  }
}

function resultKey(identity: RunIdentity, idempotencyKey: string): string {
  return `${runtimeScopeDigest(identity)}:${idempotencyKey}`
}

function verifyDigest(expected: string, result: unknown): void {
  if (effectResultDigest(result) !== expected) throw new Error('effect result digest mismatch')
}
