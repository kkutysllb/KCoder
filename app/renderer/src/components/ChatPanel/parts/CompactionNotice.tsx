import type { MessagePart } from '../../../stores/app-store'
import { useI18n } from '../../../i18n'
import { StreamingDots } from './icons'

interface CompactionNoticeProps {
  part: Extract<MessagePart, { type: 'compaction' }>
}

/**
 * 上下文压缩内联提示。
 *
 * - kind === 'started'：进行中 spinner
 * - kind === 'completed'：静态提示
 *
 * 注意：当前 QiLin 引擎未发 compaction 事件，本组件是预留渲染。
 * 引擎补发信号后前端零改动生效。
 */
export function CompactionNotice({ part }: CompactionNoticeProps) {
  const { t } = useI18n()
  if (part.kind === 'started') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#a855f7]/20 bg-[#a855f7]/5 text-xs text-[#a855f7]">
        <span className="shrink-0">♻️</span>
        <span className="font-medium">{t('chat.compaction.notice')}</span>
        <span className="text-[#a855f7]/60">
          <StreamingDots />
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-hover/30 text-xs text-text-muted">
      <span className="shrink-0">♻️</span>
      <span>{t('chat.compaction.completed')}</span>
    </div>
  )
}
