// StageBadge — 阶段徽章（参考 KStock StageBadge.tsx）。
//
// 显示 turn 当前所在阶段：planning / executing / reviewing / idle。
// 流式中带脉冲动画。

interface StageBadgeProps {
  stage?: string
  streaming?: boolean
}

const STAGE_LABELS: Record<string, string> = {
  planning: '规划中',
  executing: '执行中',
  reviewing: '审查中',
  idle: '待命',
  done: '已完成'
}

export function StageBadge({ stage, streaming }: StageBadgeProps) {
  if (!stage || stage === 'idle') return null

  const label = STAGE_LABELS[stage] ?? stage
  const colorClass =
    stage === 'planning' ? 'text-purple-400 bg-purple-400/10'
    : stage === 'executing' ? 'text-blue-400 bg-blue-400/10'
    : stage === 'reviewing' ? 'text-teal-400 bg-teal-400/10'
    : 'text-text-muted bg-bg-hover'

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium ${colorClass} ${
        streaming ? 'animate-pulse' : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${streaming ? 'animate-ping' : ''}`} />
      {label}
    </span>
  )
}
