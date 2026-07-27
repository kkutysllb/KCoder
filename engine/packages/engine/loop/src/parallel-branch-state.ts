import { isDeepStrictEqual } from 'node:util'
import {
  JoinResultSchema,
  MultiAgentRunSchema,
  type DurableBranchRun,
  type JoinNode,
  type JoinResult,
  type MultiAgentRun,
  type ParallelNode
} from '@qiongqi/contracts'

type OpenBranchStatus = 'queued' | 'running' | 'suspended'
type TerminalBranchStatus = 'completed' | 'failed' | 'aborted'

export type BranchSettlement = {
  branchId: string
  status: TerminalBranchStatus
  output?: unknown
  error?: string
  usageRefs: string[]
  artifactRefs: string[]
  nowIso: string
}

export function spawnParallelBranches(
  run: MultiAgentRun,
  parallel: ParallelNode,
  nowIso: string
): MultiAgentRun {
  if (run.activeNodeId !== parallel.id) {
    throw new Error(`Parallel coordinator is not active: ${parallel.id}`)
  }
  const duplicate = parallel.branches.find((branch) => run.branches[branch.branchId] !== undefined)
  if (duplicate) throw new Error(`Durable branch already exists: ${duplicate.branchId}`)

  const branches = { ...run.branches }
  for (const branch of [...parallel.branches].sort((left, right) => left.branchId.localeCompare(right.branchId))) {
    branches[branch.branchId] = {
      branchId: branch.branchId,
      parallelNodeId: parallel.id,
      joinNodeId: parallel.joinNodeId,
      status: 'queued',
      activeNodeId: branch.startNodeId,
      agentRunIds: [],
      usageRefs: [],
      artifactRefs: [],
      updatedAt: nowIso
    }
  }
  return parseWithBranchProjections({
    ...run,
    activeNodeId: parallel.joinNodeId,
    branches,
    updatedAt: nowIso
  })
}

export function advanceBranch(
  run: MultiAgentRun,
  branchId: string,
  nextNodeId: string,
  nowIso: string,
  status: OpenBranchStatus = 'running'
): MultiAgentRun {
  const branch = requireBranch(run, branchId)
  if (isTerminal(branch.status)) throw new Error(`Durable branch is terminal: ${branchId}`)
  return parseWithBranchProjections({
    ...run,
    branches: {
      ...run.branches,
      [branchId]: {
        ...branch,
        status,
        activeNodeId: nextNodeId,
        startedAt: branch.startedAt ?? nowIso,
        updatedAt: nowIso
      }
    },
    updatedAt: nowIso
  })
}

export function settleBranch(run: MultiAgentRun, input: BranchSettlement): MultiAgentRun {
  const branch = requireBranch(run, input.branchId)
  if (isTerminal(branch.status)) {
    if (sameTerminalResult(branch, input)) return run
    throw new Error(`Durable branch terminal result conflicts: ${input.branchId}`)
  }
  const next: DurableBranchRun = {
    ...branch,
    status: input.status,
    activeNodeId: branch.joinNodeId,
    ...(input.output !== undefined ? { output: input.output } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    usageRefs: [...input.usageRefs],
    artifactRefs: [...input.artifactRefs],
    startedAt: branch.startedAt ?? input.nowIso,
    completedAt: input.nowIso,
    updatedAt: input.nowIso
  }
  return parseWithBranchProjections({
    ...run,
    branches: { ...run.branches, [input.branchId]: next },
    updatedAt: input.nowIso
  })
}

export function abortOpenBranches(run: MultiAgentRun, parallelNodeId: string, nowIso: string): MultiAgentRun {
  const branches: MultiAgentRun['branches'] = {}
  for (const [branchId, branch] of sortedEntries(run.branches)) {
    branches[branchId] = branch.parallelNodeId !== parallelNodeId || isTerminal(branch.status)
      ? branch
      : {
          ...branch,
          status: 'aborted',
          activeNodeId: branch.joinNodeId,
          startedAt: branch.startedAt ?? nowIso,
          completedAt: nowIso,
          updatedAt: nowIso
        }
  }
  return parseWithBranchProjections({ ...run, branches, updatedAt: nowIso })
}

export function joinReadiness(run: MultiAgentRun, join: JoinNode): 'waiting' | 'completed' | 'failed' {
  if (join.requiredBranchIds.length === 0) return 'waiting'
  const branches = join.requiredBranchIds.map((branchId) => requireJoinBranch(run, join, branchId))
  if (branches.some((branch) => !isTerminal(branch.status))) return 'waiting'
  return branches.every((branch) => branch.status === 'completed') ? 'completed' : 'failed'
}

export function buildJoinResult(run: MultiAgentRun, join: JoinNode): JoinResult {
  if (joinReadiness(run, join) === 'waiting') throw new Error(`Durable join is not ready: ${join.id}`)
  const selected = join.outputPolicy === 'selected'
    ? join.selectedBranchIds ?? []
    : join.requiredBranchIds.filter((branchId) =>
        join.outputPolicy === 'all' || requireJoinBranch(run, join, branchId).status === 'completed')
  const branches: JoinResult['branches'] = {}
  for (const branchId of [...selected].sort()) {
    const branch = requireJoinBranch(run, join, branchId)
    if (!isTerminal(branch.status)) throw new Error(`Durable join branch is not terminal: ${branchId}`)
    branches[branchId] = {
      status: branch.status,
      ...(branch.output !== undefined ? { output: branch.output } : {}),
      ...(branch.error !== undefined ? { error: branch.error } : {}),
      usageRefs: [...branch.usageRefs],
      artifactRefs: [...branch.artifactRefs],
      ...(branch.roiSnapshot ? { roiSnapshot: structuredClone(branch.roiSnapshot) } : {})
    }
  }
  return JoinResultSchema.parse({
    parallelNodeId: join.sourceParallelNodeId,
    joinNodeId: join.id,
    branches
  })
}

export function projectBranchStatus(
  branches: MultiAgentRun['branches']
): MultiAgentRun['branchStatus'] {
  const status: MultiAgentRun['branchStatus'] = {}
  for (const [branchId, branch] of sortedEntries(branches)) {
    status[branchId] = branch.status === 'suspended' ? 'running' : branch.status
  }
  return status
}

export function projectActiveNodeIds(run: MultiAgentRun): string[] {
  const active = new Set<string>([run.activeNodeId])
  for (const [, branch] of sortedEntries(run.branches)) {
    if (!isTerminal(branch.status)) active.add(branch.activeNodeId)
  }
  return [...active]
}

function parseWithBranchProjections(input: MultiAgentRun): MultiAgentRun {
  return MultiAgentRunSchema.parse({
    ...input,
    branchStatus: projectBranchStatus(input.branches)
  })
}

function requireBranch(run: MultiAgentRun, branchId: string): DurableBranchRun {
  const branch = run.branches[branchId]
  if (!branch) throw new Error(`Durable branch not found: ${branchId}`)
  return branch
}

function requireJoinBranch(run: MultiAgentRun, join: JoinNode, branchId: string): DurableBranchRun {
  const branch = requireBranch(run, branchId)
  if (branch.joinNodeId !== join.id || branch.parallelNodeId !== join.sourceParallelNodeId) {
    throw new Error(`Durable branch does not belong to join: ${branchId} -> ${join.id}`)
  }
  return branch
}

function isTerminal(status: DurableBranchRun['status']): status is TerminalBranchStatus {
  return status === 'completed' || status === 'failed' || status === 'aborted'
}

function sameTerminalResult(branch: DurableBranchRun, input: BranchSettlement): boolean {
  return branch.status === input.status
    && isDeepStrictEqual(branch.output, input.output)
    && branch.error === input.error
    && isDeepStrictEqual(branch.usageRefs, input.usageRefs)
    && isDeepStrictEqual(branch.artifactRefs, input.artifactRefs)
}

function sortedEntries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
}
