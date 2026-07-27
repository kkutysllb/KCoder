import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import type {
  TurnExecutionView,
  AgentGraphNodeView,
  AgentExecutionView,
  ExecutionStatus,
  BranchProjection,
  BranchStatus
} from '../../services/engine-api'
import type { RoiSnapshot, BranchRoiSnapshot } from '@qiongqi/contracts'

/**
 * 执行投影视图 — 渲染 run timeline 投影 + engine stream 增量。
 * evented_v2: manager-specialist DAG（nodes/edges/handoffs）+ v1.1.2 并行分支泳道 + ROI 面板
 * kernel_v3: delegation 树
 */
export function ExecutionView() {
  const { t } = useI18n()
  const turnExecution = useAppStore((s) => s.turnExecution)
  const branches = useAppStore((s) => s.branches)
  const roiSnapshot = useAppStore((s) => s.roiSnapshot)

  if (!turnExecution) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-muted">
        {t('execution.waiting')}
      </div>
    )
  }

  if (!turnExecution.available) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-muted p-4 text-center">
        {t('execution.unavailable')}
      </div>
    )
  }

  const { status, decision, agents } = turnExecution

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: 状态 + 编排模式 */}
      <div className="px-4 py-3 border-b border-border-custom shrink-0">
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          <span className="text-xs font-medium text-text-primary">{statusLabel(status, t)}</span>
          <span className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
            {decision.effectiveMode}
          </span>
        </div>
        <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">{decision.reason}</p>
        {decision.fallbackReason && (
          <p className="text-[11px] text-[#f59e0b] mt-1 leading-relaxed">⚠ {decision.fallbackReason}</p>
        )}
      </div>

      {/* Body: DAG / delegation + 并行分支 + ROI + agent 列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* DAG 或 delegation 树 */}
        {turnExecution.mode === 'evented_v2' ? (
          <DagGraph
            nodes={turnExecution.graph.nodes}
            edges={turnExecution.graph.edges}
            handoffs={turnExecution.graph.handoffs}
            activeAgentKeys={turnExecution.graph.activeAgentKeys}
          />
        ) : turnExecution.mode === 'kernel_v3' ? (
          <DelegationTree
            roots={turnExecution.delegation.roots}
            edges={turnExecution.delegation.edges}
            agents={agents}
          />
        ) : null}

        {/* v1.1.2 持久化并行分支泳道（仅在有分支数据时渲染） */}
        {Object.keys(branches).length > 0 && (
          <BranchLanes branches={branches} />
        )}

        {/* v1.1.2 ROI 面板（仅有 ROI 快照时渲染） */}
        {roiSnapshot && <RoiPanel roi={roiSnapshot} />}

        {/* Agent 执行详情 */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
            {t('execution.agents')} ({agents.length})
          </h3>
          {agents.map((agent) => (
            <AgentDetailCard key={agent.key} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ DAG 图（evented_v2）============

function DagGraph({
  nodes,
  edges,
  handoffs,
  activeAgentKeys
}: {
  nodes: AgentGraphNodeView[]
  edges: Array<{ from: string; to: string; condition?: string }>
  handoffs: Array<{ from: string; to: string; status: ExecutionStatus }>
  activeAgentKeys: string[]
}) {
  const { t } = useI18n()
  // 按 role + phase 分层布局
  const managers = nodes.filter((n) => n.role === 'manager')
  const specialists = nodes.filter((n) => n.role === 'specialist')
  const planningManagers = managers.filter((n) => n.phase === 'planning')
  const synthesisManagers = managers.filter((n) => n.phase === 'synthesis')

  const renderNode = (node: AgentGraphNodeView) => {
    const isActive = activeAgentKeys.includes(node.agentKey)
    return (
      <div
        key={node.key}
        className={`relative rounded-lg border px-3 py-2 transition-all ${
          isActive ? 'border-[#3b82f6] bg-[#3b82f6]/10 shadow-lg shadow-[#3b82f6]/20' :
          node.status === 'completed' ? 'border-[#22c55e]/40 bg-[#22c55e]/5' :
          node.status === 'failed' ? 'border-[#ef4444]/40 bg-[#ef4444]/5' :
          'border-border-custom bg-bg-input'
        }`}
      >
        <div className="flex items-center gap-1.5">
          {node.role === 'manager' ? <ManagerIcon /> : <SpecialistIcon />}
          <span className="text-xs font-medium text-text-primary">{node.name}</span>
          {isActive && (
            <span className="ml-auto flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-[#3b82f6] animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-1 rounded-full bg-[#3b82f6] animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-[#3b82f6] animate-bounce" />
            </span>
          )}
        </div>
        {node.phase && (
          <span className="text-[9px] text-text-muted mt-0.5 block">{node.phase}</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('execution.graph')}</h3>
      <div className="rounded-xl border border-border-subtle bg-bg-surface p-4 space-y-3">
        {/* Planning manager */}
        {planningManagers.length > 0 && (
          <div className="flex justify-center">{planningManagers.map(renderNode)}</div>
        )}
        {/* 箭头 */}
        {planningManagers.length > 0 && specialists.length > 0 && <DownArrow label="dispatch" />}
        {/* Specialists（并行）*/}
        {specialists.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {specialists.map(renderNode)}
          </div>
        )}
        {/* 箭头 */}
        {(specialists.length > 0 || planningManagers.length > 0) && synthesisManagers.length > 0 && (
          <DownArrow label="join" />
        )}
        {/* Synthesis manager */}
        {synthesisManagers.length > 0 && (
          <div className="flex justify-center">{synthesisManagers.map(renderNode)}</div>
        )}
        {/* 无节点 */}
        {nodes.length === 0 && (
          <p className="text-xs text-text-muted text-center py-2">{t('execution.noNodes')}</p>
        )}
      </div>
      {/* Handoffs */}
      {handoffs.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] text-text-muted">{t('execution.handoffs')}</span>
          {handoffs.map((h, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="font-mono">{h.from}</span>
              <span>→</span>
              <span className="font-mono">{h.to}</span>
              <HandoffStatusBadge status={h.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ Delegation 树（kernel_v3）============

function DelegationTree({
  roots,
  edges,
  agents
}: {
  roots: string[]
  edges: Array<{ from: string; to: string }>
  agents: AgentExecutionView[]
}) {
  const { t } = useI18n()
  const agentMap = new Map(agents.map((a) => [a.key, a]))

  const renderNode = (key: string, depth = 0) => {
    const agent = agentMap.get(key)
    const children = edges.filter((e) => e.from === key).map((e) => e.to)
    return (
      <div key={key} style={{ marginLeft: depth * 16 }}>
        <div className="flex items-center gap-1.5 py-1">
          <StatusDot status={agent?.status ?? 'queued'} />
          <span className="text-xs text-text-primary">{agent?.name ?? key}</span>
          {agent?.role && (
            <span className="text-[9px] px-1 rounded bg-bg-hover text-text-muted">{agent.role}</span>
          )}
        </div>
        {children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('execution.delegation')}</h3>
      <div className="rounded-xl border border-border-subtle bg-bg-surface p-3">
        {roots.length > 0 ? roots.map((r) => renderNode(r)) : (
          <p className="text-xs text-text-muted text-center py-2">{t('execution.noNodes')}</p>
        )}
      </div>
    </div>
  )
}

// ============ v1.1.2 并行分支泳道 ============

/**
 * 渲染持久化并行分支（来自 engine stream branch.* 事件 + timeline 快照）。
 * 每个分支一列：branchId + 状态徽章 + late-result/fail_fast 标记 + 分支 ROI。
 */
function BranchLanes({ branches }: { branches: Record<string, BranchProjection> }) {
  const { t } = useI18n()
  const list = Object.values(branches).sort((a, b) => a.branchId.localeCompare(b.branchId))

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
        {t('execution.branches')} ({list.length})
      </h3>
      <div className="grid grid-cols-1 gap-2">
        {list.map((branch) => (
          <div
            key={branch.branchId}
            className={`rounded-lg border px-3 py-2 ${
              branch.status === 'running' ? 'border-[#3b82f6]/40 bg-[#3b82f6]/5' :
              branch.status === 'completed' ? 'border-[#22c55e]/40 bg-[#22c55e]/5' :
              branch.status === 'failed' ? 'border-[#ef4444]/40 bg-[#ef4444]/5' :
              branch.status === 'aborted' ? 'border-[#f59e0b]/40 bg-[#f59e0b]/5' :
              'border-border-custom bg-bg-input'
            }`}
          >
            <div className="flex items-center gap-2">
              <BranchStatusDot status={branch.status} />
              <span className="text-xs font-mono text-text-primary truncate flex-1">{branch.branchId}</span>
              <BranchStatusBadge status={branch.status} />
            </div>
            {/* Agent keys active in this branch */}
            {branch.agentKeys.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {branch.agentKeys.map((k) => (
                  <span key={k} className="text-[9px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted font-mono">{k}</span>
                ))}
              </div>
            )}
            {/* Late result / fail_fast markers */}
            <div className="flex gap-2 mt-1">
              {branch.lateResult && (
                <span className="text-[9px] text-[#f59e0b]" title={t('execution.lateResult')}>
                  ◆ {t('execution.lateResult')}
                </span>
              )}
              {branch.failFastCancelled && (
                <span className="text-[9px] text-[#ef4444]" title={t('execution.failFast')}>
                  ✕ {t('execution.failFast')}
                </span>
              )}
            </div>
            {/* Per-branch ROI */}
            {branch.roiSnapshot && (
              <div className="flex gap-3 mt-1 text-[9px] text-text-muted">
                <span>{t('execution.cost')}: {branch.roiSnapshot.incurredCost}</span>
                <span>{t('execution.value')}: {branch.roiSnapshot.businessValue}</span>
                {branch.roiSnapshot.roiRatio != null && (
                  <span>ROI: {branch.roiSnapshot.roiRatio.toFixed(2)}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function BranchStatusDot({ status }: { status: BranchStatus }) {
  const cls = status === 'running' || status === 'suspended' ? 'bg-[#3b82f6] animate-pulse'
    : status === 'completed' ? 'bg-[#22c55e]'
    : status === 'failed' ? 'bg-[#ef4444]'
    : status === 'aborted' ? 'bg-[#f59e0b]'
    : 'bg-gray-500'
  return <span className={`w-2 h-2 rounded-full ${cls} shrink-0`} />
}

function BranchStatusBadge({ status }: { status: BranchStatus }) {
  const { t } = useI18n()
  const map: Record<BranchStatus, string> = {
    queued: t('execution.branch.queued'),
    running: t('execution.branch.running'),
    suspended: t('execution.branch.running'), // engine hides suspended as running
    completed: t('execution.branch.completed'),
    failed: t('execution.branch.failed'),
    aborted: t('execution.branch.aborted')
  }
  const cls = status === 'running' || status === 'suspended' ? 'text-[#3b82f6]'
    : status === 'completed' ? 'text-[#22c55e]'
    : status === 'failed' ? 'text-[#ef4444]'
    : status === 'aborted' ? 'text-[#f59e0b]'
    : 'text-text-muted'
  return <span className={`text-[10px] font-medium ${cls}`}>{map[status]}</span>
}

// ============ v1.1.2 ROI 面板 ============

/**
 * 渲染顶层 ROI 快照（来自 roi.snapshot engine stream 事件）。
 * 展示 fan-out / retry 放大 / 关键路径延迟 / ROI 比，以及 byBranch 明细。
 */
function RoiPanel({ roi }: { roi: RoiSnapshot }) {
  const { t } = useI18n()
  const byBranch = roi.byBranch ?? {}
  const branchEntries = Object.entries(byBranch) as Array<[string, BranchRoiSnapshot]>

  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('execution.roi')}</h3>
      <div className="rounded-xl border border-border-subtle bg-bg-surface p-3 space-y-2">
        {/* 顶层 ROI 指标 */}
        <div className="grid grid-cols-2 gap-2">
          <RoiMetric label={t('execution.cost')} value={fmtNum(roi.incurredCost)} />
          <RoiMetric label={t('execution.value')} value={fmtNum(roi.businessValue)} />
          {roi.netValue != null && <RoiMetric label={t('execution.netValue')} value={fmtNum(roi.netValue)} />}
          {roi.roiRatio != null && (
            <RoiMetric
              label="ROI"
              value={roi.roiRatio.toFixed(2)}
              highlight={roi.roiRatio >= 1 ? 'positive' : 'negative'}
            />
          )}
          {roi.fanOut != null && <RoiMetric label={t('execution.fanOut')} value={String(roi.fanOut)} />}
          {roi.retryAmplification != null && (
            <RoiMetric label={t('execution.retryAmplification')} value={roi.retryAmplification.toFixed(2)} />
          )}
          {roi.criticalPathLatencyMs != null && (
            <RoiMetric
              label={t('execution.criticalPath')}
              value={`${(roi.criticalPathLatencyMs / 1000).toFixed(1)}s`}
            />
          )}
        </div>

        {/* 引擎效率（logical vs physical attempts） */}
        {roi.engineEfficiency && (
          <div className="flex gap-3 text-[10px] text-text-muted pt-1 border-t border-border-subtle">
            <span>{t('execution.logical')}: {roi.engineEfficiency.logicalAttempts}</span>
            <span>{t('execution.physical')}: {roi.engineEfficiency.physicalAttempts}</span>
            {roi.engineEfficiency.suppressedAttempts > 0 && (
              <span>{t('execution.suppressed')}: {roi.engineEfficiency.suppressedAttempts}</span>
            )}
          </div>
        )}

        {/* byBranch 明细表 */}
        {branchEntries.length > 0 && (
          <div className="pt-1 border-t border-border-subtle">
            <p className="text-[10px] text-text-muted mb-1">{t('execution.byBranch')}</p>
            <div className="space-y-0.5">
              {branchEntries.map(([bid, snap]) => (
                <div key={bid} className="flex items-center gap-2 text-[10px]">
                  <span className="font-mono text-text-secondary truncate flex-1">{bid}</span>
                  <span className="text-text-muted">{t('execution.cost')}: {fmtNum(snap.incurredCost)}</span>
                  <span className="text-text-muted">{t('execution.value')}: {fmtNum(snap.businessValue)}</span>
                  {snap.roiRatio != null && (
                    <span className={snap.roiRatio >= 1 ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
                      {snap.roiRatio.toFixed(2)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RoiMetric({
  label,
  value,
  highlight
}: {
  label: string
  value: string
  highlight?: 'positive' | 'negative'
}) {
  const cls = highlight === 'positive' ? 'text-[#22c55e]'
    : highlight === 'negative' ? 'text-[#ef4444]'
    : 'text-text-primary'
  return (
    <div className="rounded-md bg-bg-input px-2 py-1.5">
      <p className="text-[9px] text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-xs font-medium font-mono ${cls}`}>{value}</p>
    </div>
  )
}

function fmtNum(n: number | undefined | null): string {
  if (n == null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// ============ Agent 详情卡片 ============

function AgentDetailCard({ agent }: { agent: AgentExecutionView }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = agent.toolRuns.length > 0 || agent.messages.length > 0 || agent.usage

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface overflow-hidden">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasDetails ? 'hover:bg-bg-hover/50' : ''} transition-colors`}
      >
        <StatusDot status={agent.status} />
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{agent.name}</span>
        <span className="text-[9px] px-1 rounded bg-bg-hover text-text-muted">{agent.role}</span>
        {agent.phase && <span className="text-[9px] text-text-muted">{agent.phase}</span>}
        {agent.durationMs != null && (
          <span className="text-[10px] text-text-muted">{(agent.durationMs / 1000).toFixed(1)}s</span>
        )}
        {hasDetails && (
          <svg className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="px-3 pb-2 space-y-1.5 border-t border-border-subtle pt-2">
          {agent.task && <p className="text-[11px] text-text-muted">{agent.task}</p>}
          {agent.summary && <p className="text-[11px] text-text-secondary">{agent.summary}</p>}
          {agent.toolRuns.length > 0 && (
            <div className="space-y-0.5">
              {agent.toolRuns.map((tr) => (
                <div key={tr.key} className="flex items-center gap-1.5 text-[11px]">
                  <StatusDot status={tr.status} small />
                  <span className="text-text-secondary font-mono">{tr.toolName}</span>
                </div>
              ))}
            </div>
          )}
          {agent.usage && (
            <div className="flex gap-3 text-[10px] text-text-muted">
              <span>↑ {agent.usage.promptTokens}</span>
              <span>↓ {agent.usage.completionTokens}</span>
              <span>Σ {agent.usage.totalTokens}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============ 辅助组件 ============

function StatusDot({ status, small }: { status: ExecutionStatus; small?: boolean }) {
  const cls = status === 'running' ? 'bg-[#3b82f6] animate-pulse'
    : status === 'completed' ? 'bg-[#22c55e]'
    : status === 'failed' ? 'bg-[#ef4444]'
    : status === 'aborted' ? 'bg-[#f59e0b]'
    : 'bg-gray-500'
  const size = small ? 'w-1.5 h-1.5' : 'w-2 h-2'
  return <span className={`${size} rounded-full ${cls} shrink-0`} />
}

function HandoffStatusBadge({ status }: { status: ExecutionStatus }) {
  const cls = status === 'completed' ? 'text-[#22c55e]' : status === 'failed' ? 'text-[#ef4444]' : 'text-text-muted'
  return <span className={`text-[10px] ${cls}`}>{status}</span>
}

function DownArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center -my-1">
      {label && <span className="text-[9px] text-text-muted mb-0.5">{label}</span>}
      <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>
  )
}

function ManagerIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[#3b82f6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25h4.5M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25h-4.5m4.5 0h1.5m-1.5 0v-2.625a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H9.75v.75h.75v-.75zm0 0V9m0 0H9.75M10.5 9h.75" />
    </svg>
  )
}

function SpecialistIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[#8b8b90]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-23.369A2.499 2.499 0 0015.75 6c0 .466.151.897.407 1.248m-5.108-3.369a2.499 2.499 0 00-3.357 3.357M6.75 12a4.5 4.5 0 118.881 1.052" />
    </svg>
  )
}

function statusLabel(status: ExecutionStatus, t: (k: string) => string): string {
  const map: Record<ExecutionStatus, string> = {
    queued: t('execution.status.queued'),
    running: t('execution.status.running'),
    completed: t('execution.status.completed'),
    failed: t('execution.status.failed'),
    aborted: t('execution.status.aborted')
  }
  return map[status] ?? status
}
