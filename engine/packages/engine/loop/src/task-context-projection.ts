import { createHash } from 'node:crypto'
import type { TaskCheckpointV1, TaskStateV1 } from '@qiongqi/contracts'
import { renderTaskCheckpointData } from './task-checkpoint-projector-v1.js'

export function renderTaskStateProjection(task: TaskStateV1 | TaskCheckpointV1): string {
  if ('scope' in task) return renderTaskCheckpointData(task)
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
