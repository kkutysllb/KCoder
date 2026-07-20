import type { RunIdentity } from '@qiongqi/contracts'

export type StoredEffectResult = {
  resultDigest: string
  result: unknown
}

export interface EffectResultStore {
  load(identity: RunIdentity, idempotencyKey: string): Promise<StoredEffectResult | undefined>
  save(
    identity: RunIdentity,
    idempotencyKey: string,
    resultDigest: string,
    result: unknown
  ): Promise<void>
}
