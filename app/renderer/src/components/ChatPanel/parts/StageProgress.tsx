import type { MessagePart } from '../../../stores/app-store'
import { useI18n } from '../../../i18n'

interface StageProgressProps {
  parts: MessagePart[]
  /** 消息整体是否仍在生成（决定是否显示进度条）*/
  isGenerating: boolean
}

type Stage = 'thinking' | 'executing' | 'replying' | null

/**
 * 阶段进度条 —— 前端推断，不依赖引擎 pipeline_stage 事件。
 *
 * 推断规则（按优先级）：
 * 1. 有 isStreaming:true 的 reasoning → thinking
 * 2. 有 status:running 的 tool_call → executing
 * 3. 消息 isGenerating 且最后一个 part 是 text → replying
 * 4. 否则 null（不显示）
 *
 * 全部完成后（!isGenerating）整条不渲染。
 */
export function StageProgress({ parts, isGenerating }: StageProgressProps) {
  const { t } = useI18n()
  if (!isGenerating) return null

  const stage = inferStage(parts)
  if (!stage) return null

  const stages: { key: Stage; label: string }[] = [
    { key: 'thinking', label: t('chat.stage.thinking') },
    { key: 'executing', label: t('chat.stage.executing') },
    { key: 'replying', label: t('chat.stage.replying') }
  ]
  const currentIndex = stages.findIndex((s) => s.key === stage)
  // thinking → 0, executing → 1, replying → 2

  return (
    <div className="flex items-center gap-1.5 py-1.5 mb-1">
      {stages.map((s, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <div className={`h-px w-4 ${done || active ? 'bg-[#3b82f6]/40' : 'bg-border-subtle'}`} />}
            <div
              className={`flex items-center gap-1 text-[11px] transition-colors ${
                active
                  ? 'text-[#3b82f6] font-medium'
                  : done
                  ? 'text-text-muted'
                  : 'text-text-muted/50'
              }`}
            >
              <span
                className={`flex items-center justify-center w-3.5 h-3.5 rounded-full border text-[8px] ${
                  active
                    ? 'border-[#3b82f6] bg-[#3b82f6]/10 animate-pulse'
                    : done
                    ? 'border-[#22c55e] text-[#22c55e]'
                    : 'border-border-strong'
                }`}
              >
                {done ? '✓' : ''}
              </span>
              <span>{s.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function inferStage(parts: MessagePart[]): Stage {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type === 'reasoning' && p.isStreaming === true) return 'thinking'
    if (p.type === 'tool_call' && p.status === 'running') return 'executing'
    // 最后一个 part 是 text → replying
    if (i === parts.length - 1 && p.type === 'text') return 'replying'
  }
  return null
}
