import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RunIdentity } from '@qiongqi/contracts'
import type { EffectResultStore, StoredEffectResult } from '@qiongqi/ports'
import { atomicWriteFile } from './atomic-write.js'
import { effectResultDigest } from './effect-result-digest.js'

function runScopeDir(identity: RunIdentity): string {
  return join(identity.threadId, identity.turnId, identity.runId)
}

export class FileEffectResultStore implements EffectResultStore {
  public readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
  }

  async load(
    identity: RunIdentity,
    idempotencyKey: string
  ): Promise<StoredEffectResult | undefined> {
    try {
      const parsed = JSON.parse(
        await readFile(this.resultPath(identity, idempotencyKey), 'utf8')
      ) as StoredEffectResult
      if (!parsed || typeof parsed.resultDigest !== 'string' || !parsed.resultDigest) {
        throw new Error('invalid persisted effect result')
      }
      verifyDigest(parsed.resultDigest, parsed.result)
      return parsed
    } catch (error) {
      if ((error as { code?: string })?.code === 'ENOENT') return undefined
      throw error
    }
  }

  async save(
    identity: RunIdentity,
    idempotencyKey: string,
    resultDigest: string,
    result: unknown
  ): Promise<void> {
    verifyDigest(resultDigest, result)
    await atomicWriteFile(
      this.resultPath(identity, idempotencyKey),
      JSON.stringify({ resultDigest, result })
    )
  }

  resultPath(identity: RunIdentity, idempotencyKey: string): string {
    return join(
      this.rootDir,
      runScopeDir(identity),
      'effect-results',
      `${createHash('sha256').update(idempotencyKey).digest('hex')}.json`
    )
  }
}

function verifyDigest(expected: string, result: unknown): void {
  if (effectResultDigest(result) !== expected) throw new Error('effect result digest mismatch')
}
