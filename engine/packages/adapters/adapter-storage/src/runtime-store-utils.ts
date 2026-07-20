import { createHash } from 'node:crypto'
import { encodeScopeKey, type RunIdentity, type ScopeKey } from '@qiongqi/contracts'

export function runtimeScope(identity: RunIdentity): ScopeKey {
  return {
    ownerUserId: identity.ownerUserId,
    workspaceKey: identity.workspaceKey,
    threadId: identity.threadId,
    turnId: identity.turnId,
    runId: identity.runId,
    purpose: 'runtime'
  }
}

export function runtimeScopeDigest(identity: RunIdentity): string {
  return createHash('sha256').update(encodeScopeKey(runtimeScope(identity))).digest('hex')
}
