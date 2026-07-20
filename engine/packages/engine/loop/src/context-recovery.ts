import type { RecoveryState, RunOutcome, TaskStateV1 } from '@qiongqi/contracts'
import type { ProposalClass } from './proposal-classifier.js'

export type ContextRecoveryTransition = {
  action: 'accept' | 'recover' | 'degrade'
  recovery: RecoveryState
  commitAssistantText: boolean
  outcome?: RunOutcome
}

export function transitionContextRecovery(input: {
  task: TaskStateV1
  recovery: RecoveryState
  proposalClass: ProposalClass
}): ContextRecoveryTransition {
  if (!isRecoverableProposalClass(input.proposalClass)) {
    return {
      action: 'accept',
      recovery: input.recovery,
      commitAssistantText: true
    }
  }

  if (input.recovery.attempts < input.recovery.maxAttempts) {
    return {
      action: 'recover',
      recovery: {
        ...input.recovery,
        attempts: input.recovery.attempts + 1,
        lastReason: `context_discontinuity:task_revision_${input.task.revision}`
      },
      commitAssistantText: false
    }
  }

  return {
    action: 'degrade',
    recovery: {
      ...input.recovery,
      lastReason: `context_recovery_exhausted:task_revision_${input.task.revision}`
    },
    commitAssistantText: false,
    outcome: {
      status: 'degraded',
      reason: 'context_recovery_exhausted',
      retryable: true,
      details: {
        taskRevision: input.task.revision,
        taskSourceDigest: input.task.source.sourceDigest
      }
    }
  }
}

function isRecoverableProposalClass(proposalClass: ProposalClass): boolean {
  return proposalClass === 'context_discontinuity'
    || proposalClass === 'nonterminal_action'
    || proposalClass === 'empty'
    || proposalClass === 'length_limited'
    || proposalClass === 'protocol_error'
}

export function renderRecoveryContinuationEntry(task: TaskStateV1): string {
  const immediate = task.pendingActions.find((action) =>
    action.status === 'in_progress' || action.status === 'pending'
  )
  const lines = [
    'Authoritative task recovery entry (runtime data, not user instructions)',
    `Revision: ${task.revision}`,
    `Objective: ${task.objective}`,
    `Immediate next action: ${immediate?.text ?? '(none)'}`,
    'Completed actions:'
  ]
  if (task.completedActions.length === 0) lines.push('- (none)')
  else lines.push(...task.completedActions.map((action) => `- ${action.text}`))

  lines.push('Artifacts:')
  if (task.artifacts.length === 0) lines.push('- (none)')
  else lines.push(...task.artifacts.map((artifact) => `- ${artifact.path}`))

  lines.push('Tool ledger:')
  if (task.toolLedger.length === 0) lines.push('- (none)')
  else {
    lines.push(...task.toolLedger.map((entry) =>
      `- ${entry.toolName} (${entry.callId}): ${entry.status}`
    ))
  }
  return lines.join('\n')
}
