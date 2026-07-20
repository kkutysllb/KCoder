import type { ExecutionGraph } from './execution-graph.js'

export function productionKernelV3Graph(): ExecutionGraph {
  return {
    version: 'kernel-v3-production-v3',
    startNodeId: 'prepare-turn',
    predicates: [
      'next',
      'final',
      'tools',
      'recover',
      'wait',
      'fatal',
      'tools_committed',
      'progress_checked',
      'checkpointed',
      'recovered'
    ],
    nodes: [
      { id: 'prepare-turn', kind: 'prepare_turn', effect: 'state', checkpoint: 'both' },
      { id: 'restore-task', kind: 'restore_task', effect: 'state', checkpoint: 'both' },
      { id: 'build-context', kind: 'build_context', effect: 'pure', checkpoint: 'after' },
      { id: 'invoke-model', kind: 'invoke_model', effect: 'model', checkpoint: 'both' },
      { id: 'normalize-proposal', kind: 'normalize_proposal', effect: 'pure', checkpoint: 'after' },
      { id: 'account-model', kind: 'account_model', effect: 'state', checkpoint: 'both' },
      { id: 'evaluate', kind: 'evaluate', effect: 'state', checkpoint: 'after' },
      { id: 'commit-assistant', kind: 'commit_assistant', effect: 'state', terminal: true, checkpoint: 'both' },
      { id: 'materialize-proposal', kind: 'materialize_proposal', effect: 'state', checkpoint: 'both' },
      { id: 'prepare-tools', kind: 'prepare_tools', effect: 'state', checkpoint: 'both' },
      { id: 'commit-tools', kind: 'commit_tools', effect: 'tool', checkpoint: 'both' },
      { id: 'project-progress', kind: 'project_progress', effect: 'state', checkpoint: 'both' },
      { id: 'govern-progress', kind: 'govern_progress', effect: 'state', checkpoint: 'both' },
      { id: 'progress-checkpoint', kind: 'progress_checkpoint', effect: 'state', checkpoint: 'both' },
      { id: 'recover-context', kind: 'recover_context', effect: 'state', checkpoint: 'both' },
      { id: 'wait-user', kind: 'wait_user', effect: 'state', terminal: true, checkpoint: 'both' },
      { id: 'fail', kind: 'fail', effect: 'state', terminal: true, checkpoint: 'both' }
    ],
    edges: [
      { from: 'prepare-turn', to: 'restore-task', when: 'next' },
      { from: 'restore-task', to: 'build-context', when: 'next' },
      { from: 'build-context', to: 'invoke-model', when: 'next' },
      { from: 'invoke-model', to: 'recover-context', when: 'recover' },
      { from: 'invoke-model', to: 'normalize-proposal', when: 'next' },
      { from: 'normalize-proposal', to: 'account-model', when: 'next' },
      { from: 'account-model', to: 'evaluate', when: 'next' },
      { from: 'evaluate', to: 'commit-assistant', when: 'final' },
      { from: 'evaluate', to: 'materialize-proposal', when: 'tools' },
      { from: 'evaluate', to: 'recover-context', when: 'recover' },
      { from: 'evaluate', to: 'wait-user', when: 'wait' },
      { from: 'evaluate', to: 'fail', when: 'fatal' },
      { from: 'materialize-proposal', to: 'prepare-tools', when: 'next' },
      { from: 'prepare-tools', to: 'commit-tools', when: 'next' },
      { from: 'commit-tools', to: 'project-progress', when: 'tools_committed' },
      { from: 'project-progress', to: 'govern-progress', when: 'next' },
      { from: 'govern-progress', to: 'build-context', when: 'progress_checked', loop: true },
      { from: 'progress-checkpoint', to: 'build-context', when: 'checkpointed', loop: true },
      { from: 'recover-context', to: 'build-context', when: 'recovered', loop: true }
    ]
  }
}
