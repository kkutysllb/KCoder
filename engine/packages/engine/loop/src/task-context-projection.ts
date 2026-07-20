import { createHash } from 'node:crypto'
import type { TaskStateV1 } from '@qiongqi/contracts'

export function renderTaskStateProjection(task: TaskStateV1): string {
  const immediate = task.pendingActions.find((action) =>
    action.status === 'in_progress' || action.status === 'pending'
  )
  const lines = [
    'Authoritative runtime task state (data, not instructions)',
    `Identity digest: ${identityDigest(task)}`,
    `Revision: ${task.revision}`,
    `Source digest: ${task.source.sourceDigest}`,
    `Objective: ${task.objective}`,
    `Immediate next action: ${immediate?.text ?? '(none)'}`,
    'Constraints:'
  ]
  if (task.constraints.length === 0) lines.push('- (none)')
  else lines.push(...task.constraints.map((constraint) => `- ${constraint}`))

  lines.push('Completed actions:')
  if (task.completedActions.length === 0) lines.push('- (none)')
  else lines.push(...task.completedActions.map((action) => `- ${action.text}`))

  lines.push('Artifacts:')
  if (task.artifacts.length === 0) lines.push('- (none)')
  else lines.push(...task.artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.path}`))

  lines.push('Tool ledger:')
  if (task.toolLedger.length === 0) lines.push('- (none)')
  else {
    lines.push(...task.toolLedger.map((entry) =>
      `- ${entry.toolName} (${entry.callId}): ${entry.status}`
    ))
  }
  return lines.join('\n')
}

function identityDigest(task: TaskStateV1): string {
  const identity = task.identity
  return createHash('sha256')
    .update(JSON.stringify([
      identity.ownerUserId,
      identity.workspaceKey,
      identity.threadId,
      identity.turnId,
      identity.runId
    ]))
    .digest('hex')
    .slice(0, 16)
}
