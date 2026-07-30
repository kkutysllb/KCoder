import type { MessagePart } from '../../../stores/app-store'
import type { BranchProjection, BranchStatus } from '../../../services/engine-api'
import { useI18n } from '../../../i18n'
import { ReasoningStream } from './ReasoningStream'
import { ToolCallCard } from './ToolCallCard'
import { ToolResultCard } from './ToolResultCard'

interface BranchGroupProps {
  parts: MessagePart[]
  branches: Record<string, BranchProjection>
  /** 渲染 approval part 的回调（审批卡片独立处理）*/
  renderApproval: (part: Extract<MessagePart, { type: 'approval' }>) => React.ReactNode
}

/**
 * 按 branchId 分组渲染 parts。
 *
 * - 无 branchId 的 part → 主线程，直接渲染（reasoning/tool_call/tool_result/compaction）
 * - 有 branchId 的 part → 按 branchId 聚合，带左侧色条 + 分支标签
 *
 * 当前场景（单线程，无 branchId part）退化为零开销直通。
 */
export function BranchGroup({ parts, branches, renderApproval }: BranchGroupProps) {
  // 检测是否有任何 part 带 branchId
  const hasBranches = parts.some((p) => 'branchId' in p && p.branchId)
  if (!hasBranches) {
    // 零开销直通：扁平渲染
    return (
      <div className="space-y-2">
        {parts.map((part, i) => (
          <PartDispatcher key={i} part={part} renderApproval={renderApproval} />
        ))}
      </div>
    )
  }

  // 分组：main 线程 + 每个 branchId 一组
  const main: MessagePart[] = []
  const groups: Record<string, MessagePart[]> = {}
  for (const p of parts) {
    const bid = 'branchId' in p ? p.branchId : undefined
    if (!bid) {
      main.push(p)
    } else {
      ;(groups[bid] ??= []).push(p)
    }
  }

  return (
    <div className="space-y-2">
      {main.length > 0 && (
        <div className="space-y-2">
          {main.map((part, i) => (
            <PartDispatcher key={i} part={part} renderApproval={renderApproval} />
          ))}
        </div>
      )}
      {Object.entries(groups).map(([bid, groupParts]) => (
        <BranchBlock
          key={bid}
          branchId={bid}
          parts={groupParts}
          projection={branches[bid]}
          renderApproval={renderApproval}
        />
      ))}
    </div>
  )
}

/** 单个分支块 */
function BranchBlock({
  branchId,
  parts,
  projection,
  renderApproval
}: {
  branchId: string
  parts: MessagePart[]
  projection?: BranchProjection
  renderApproval: (part: Extract<MessagePart, { type: 'approval' }>) => React.ReactNode
}) {
  const { t } = useI18n()
  const color = branchColor(branchId)
  const shortId = branchId.length > 8 ? branchId.slice(0, 8) : branchId
  const status = projection?.status

  return (
    <div className={`rounded-lg border-l-2 ${color.bar} pl-3 py-1 bg-bg-hover/20`}>
      <div className="flex items-center gap-2 text-[11px] text-text-muted mb-1">
        <span className={`font-medium ${color.text}`}>{t('chat.branch.label')} {shortId}</span>
        {status && <span>· {branchStatusLabel(status)}</span>}
      </div>
      <div className="space-y-2">
        {parts.map((part, i) => (
          <PartDispatcher key={i} part={part} renderApproval={renderApproval} />
        ))}
      </div>
    </div>
  )
}

/** 单个 part 的分发渲染 */
function PartDispatcher({
  part,
  renderApproval
}: {
  part: MessagePart
  renderApproval: (part: Extract<MessagePart, { type: 'approval' }>) => React.ReactNode
}) {
  switch (part.type) {
    case 'reasoning':
      return <ReasoningStream part={part} />
    case 'tool_call':
      return <ToolCallCard part={part} />
    case 'tool_result':
      return <ToolResultCard part={part} />
    case 'approval':
      return <>{renderApproval(part)}</>
    default:
      return null
  }
}

/** 分支配色：按 branchId hash 取 6 色循环 */
function branchColor(branchId: string): { bar: string; text: string } {
  const palette = [
    { bar: 'border-l-[#3b82f6]', text: 'text-[#3b82f6]' },
    { bar: 'border-l-[#a855f7]', text: 'text-[#a855f7]' },
    { bar: 'border-l-[#ec4899]', text: 'text-[#ec4899]' },
    { bar: 'border-l-[#f59e0b]', text: 'text-[#f59e0b]' },
    { bar: 'border-l-[#10b981]', text: 'text-[#10b981]' },
    { bar: 'border-l-[#06b6d4]', text: 'text-[#06b6d4]' }
  ]
  let hash = 0
  for (let i = 0; i < branchId.length; i++) {
    hash = (hash * 31 + branchId.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
}

function branchStatusLabel(status: BranchStatus): string {
  const map: Record<BranchStatus, string> = {
    queued: '排队中',
    running: '运行中',
    suspended: '已挂起',
    completed: '已完成',
    failed: '已失败',
    aborted: '已中止'
  }
  return map[status] ?? status
}
