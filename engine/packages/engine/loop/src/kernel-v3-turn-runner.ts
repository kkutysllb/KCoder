import type { RunIdentity, RunOutcome } from '@qiongqi/contracts'
import type { RunEventStore, RunLeaseStore, RunSnapshotStore } from '@qiongqi/ports'
import { productionKernelV3Graph } from './kernel-v3-graph.js'
import { RuntimeKernel } from './runtime-kernel.js'
import type { RuntimeNodeHandler } from './runtime-kernel-context.js'
import { MiddlewareChain } from './middleware-chain.js'
import { budgetMiddleware } from './middleware/budget-middleware.js'
import { contextRecoveryMiddleware } from './middleware/context-recovery-middleware.js'
import { loopGovernorMiddleware } from './middleware/loop-governor-middleware.js'
import { safetyTerminationMiddleware } from './middleware/safety-termination-middleware.js'
import { terminalResponseMiddleware } from './middleware/terminal-response-middleware.js'

export type KernelV3TurnRunnerOptions = {
  snapshots: RunSnapshotStore
  events: RunEventStore
  leases: RunLeaseStore
  holderId: string
  identityForTurn: (threadId: string, turnId: string) => Promise<RunIdentity> | RunIdentity
  nodes: Record<string, RuntimeNodeHandler>
  finishTurn: (
    threadId: string,
    turnId: string,
    status: KernelV3TurnStatus,
    outcome: RunOutcome
  ) => Promise<void> | void
  nowIso?: () => string
  middleware?: MiddlewareChain
}

export type KernelV3TurnStatus = 'completed' | 'degraded' | 'suspended' | 'failed' | 'aborted'

export class KernelV3TurnRunner {
  constructor(private readonly options: KernelV3TurnRunnerOptions) {}

  /**
   * Expose the kernel-v3 internals so the governed-graph turn driver can run a
   * single-AgentRun Kernel execution for a governed agent node using the same
   * node handlers, stores, and middleware as a normal turn.
   */
  get internals(): {
    nodes: Record<string, RuntimeNodeHandler>
    snapshots: RunSnapshotStore
    events: RunEventStore
    leases: RunLeaseStore
    holderId: string
    middleware: MiddlewareChain
    identityForTurn: KernelV3TurnRunnerOptions['identityForTurn']
    finishTurn: KernelV3TurnRunnerOptions['finishTurn']
    nowIso?: () => string
  } {
    return {
      nodes: this.options.nodes,
      snapshots: this.options.snapshots,
      events: this.options.events,
      leases: this.options.leases,
      holderId: this.options.holderId,
      middleware: this.options.middleware ?? defaultKernelV3Middleware(),
      identityForTurn: this.options.identityForTurn,
      finishTurn: this.options.finishTurn,
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {})
    }
  }

  async runTurn(threadId: string, turnId: string): Promise<KernelV3TurnStatus> {
    const identity = await this.options.identityForTurn(threadId, turnId)
    const kernel = new RuntimeKernel({
      graph: productionKernelV3Graph(),
      snapshots: this.options.snapshots,
      events: this.options.events,
      leases: this.options.leases,
      holderId: this.options.holderId,
      nodes: this.options.nodes,
      middleware: this.options.middleware ?? defaultKernelV3Middleware(),
      ...(this.options.nowIso ? { nowIso: this.options.nowIso } : {})
    })
    const outcome = await kernel.run(identity)
    const status = legacyStatus(outcome)
    await this.options.finishTurn(threadId, turnId, status, outcome)
    return status
  }
}

export function defaultKernelV3Middleware(): MiddlewareChain {
  return new MiddlewareChain([
    budgetMiddleware({ maxSteps: 96, maxToolCalls: 256, maxTokens: 4_000_000 }),
    contextRecoveryMiddleware(),
    terminalResponseMiddleware(),
    safetyTerminationMiddleware(),
    loopGovernorMiddleware()
  ])
}

function legacyStatus(outcome: RunOutcome): KernelV3TurnStatus {
  if (outcome.status === 'completed') return 'completed'
  if (outcome.status === 'aborted') return 'aborted'
  if (outcome.status === 'degraded') return 'degraded'
  if (outcome.status === 'suspended') return 'suspended'
  return 'failed'
}
