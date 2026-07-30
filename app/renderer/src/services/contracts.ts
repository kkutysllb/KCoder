/**
 * Localized governed-graph contract types.
 *
 * These types are emitted by a governed multi-agent engine. QiLin does not
 * produce them, so at runtime the data stays null/empty. They are kept as
 * structural TypeScript interfaces so the renderer compiles and the
 * ExecutionView UI renders without errors.
 *
 * Shapes are simplified to plain interfaces (no zod schemas — the renderer
 * only consumes these as read-only projections, never validates or
 * constructs them).
 */

// ============ Engine Stream ============

export type EngineStreamChannel = 'public' | 'private' | 'diagnostic'

/**
 * A single event on the governed durable engine stream.
 *
 * KCoder only reads `kind`, `seq`, `branchId`, and `payload` (the rest is
 * carried through opaquely for debugging). The payload type varies by kind;
 * callers cast it to the expected shape (e.g. RoiSnapshot for roi.snapshot).
 */
export interface EngineStreamEvent {
  streamId: string
  seq: number
  timestamp: string
  scope?: unknown
  multiAgentRunId?: string
  branchId?: string
  agentRunId?: string
  kernelRunId?: string
  graph?: unknown
  channel: EngineStreamChannel
  kind: string
  payload: unknown
}

// ============ ROI (Return on Investment) Snapshots ============

export type RoiStatus = 'available' | 'incomplete' | 'unavailable'

/**
 * Engine efficiency metrics — attempt accounting for a branch or run.
 */
export interface EngineEfficiency {
  logicalAttempts: number
  physicalAttempts: number
  replayedAttempts: number
  suppressedAttempts: number
  progressPerCost?: number
  evidencePerCost?: number
  artifactPerCost?: number
  estimatedWasteAvoided: number
}

/**
 * ROI snapshot for a single parallel branch.
 */
export interface BranchRoiSnapshot {
  roiStatus: RoiStatus
  currency?: string
  incurredCost: number
  businessValue: number
  netValue?: number
  roiRatio?: number
  engineEfficiency: EngineEfficiency
  updatedAt: string
}

/**
 * Per-node attribution metrics (cost / value / attempts / latency).
 */
export interface GraphNodeAttributionMetrics {
  cost: number
  businessValue: number
  attempts: number
  retries: number
  suppressedAttempts: number
  avoidedCost: number
  latencyMs: number
}

/**
 * Per-edge attribution metrics (selection / traversal counts).
 */
export interface GraphEdgeAttributionMetrics {
  cost: number
  businessValue: number
  selected: number
  traversals: number
  rejected: number
}

/**
 * Full ROI snapshot for a run — top-level metrics plus per-node/edge/branch
 * breakdowns. KCoder's ExecutionView reads `byBranch` and `incurredCost` /
 * `businessValue` for the ROI panel.
 */
export interface RoiSnapshot {
  scope?: unknown
  revision: number
  roiStatus: RoiStatus
  currency?: string
  incurredCost: number
  businessValue: number
  netValue?: number
  roiRatio?: number
  engineEfficiency: EngineEfficiency
  graph?: unknown
  byNode?: Record<string, GraphNodeAttributionMetrics>
  byEdge?: Record<string, GraphEdgeAttributionMetrics>
  byBranch?: Record<string, BranchRoiSnapshot>
  fanOut?: number
  retryAmplification?: number
  suppressedPhysicalAttempts?: number
  avoidedCost?: number
  criticalPathLatencyMs?: number
  updatedAt: string
}
