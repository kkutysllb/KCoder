import type { RunIdentity, RunStateV3 } from '@qiongqi/contracts'
import type { LeaseFence } from '@qiongqi/ports'
import type { RuntimeNode } from './execution-graph.js'
import type { MiddlewareCommand, RuntimeHook } from './runtime-middleware.js'

export type RuntimeNodeContext = {
  readonly identity: RunIdentity
  readonly state: Readonly<RunStateV3>
  readonly node: RuntimeNode
  readonly hook: RuntimeHook
  readonly leaseFence?: LeaseFence
}

export type RuntimeNodeResult = {
  condition?: string
  outcome?: RunStateV3['outcome']
  commands?: MiddlewareCommand[]
  facts?: Record<string, unknown>
  value?: unknown
}

export type RuntimeNodeHandler = (context: RuntimeNodeContext) => Promise<RuntimeNodeResult | undefined> | RuntimeNodeResult | undefined
