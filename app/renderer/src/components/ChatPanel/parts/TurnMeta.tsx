import type { MessagePart, Message } from '../../../stores/app-store'

interface TurnMetaProps {
  message: Message
  /** 从 store.selectedModel 传入，作为 usage.model 缺失时的兜底 */
  fallbackModel?: string | null
}

/**
 * turn 完成时的元信息条。
 *
 * 在消息底部显示：模型 · 输入 N · 输出 M tokens · 耗时 Ks
 * 仅在消息非 streaming 时渲染。usage 可能有多条（分支场景），这里取最后一条汇总。
 */
export function TurnMeta({ message, fallbackModel }: TurnMetaProps) {
  if (message.isStreaming) return null

  const parts = message.parts ?? []
  // 取最后一条 usage part 作为该 turn 的用量
  let usage: Extract<MessagePart, { type: 'usage' }> | null = null
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'usage') {
      usage = parts[i] as Extract<MessagePart, { type: 'usage' }>
      break
    }
  }
  if (!usage) return null

  const model = usage.model ?? fallbackModel ?? undefined
  // 估算耗时：消息创建时间到最后一个 part 的时间戳（优先用 tool_call/reasoning 的 completedAt）
  const lastTs = pickLastTimestamp(parts)
  const durationSec = lastTs ? Math.max(1, Math.round((lastTs - message.timestamp) / 1000)) : null

  return (
    <div className="flex items-center gap-2 text-[11px] text-text-muted mt-1.5 pt-1.5 border-t border-border-subtle">
      {model && <span className="font-mono">{model}</span>}
      <span>·</span>
      <span>输入 {usage.promptTokens}</span>
      <span>·</span>
      <span>输出 {usage.completionTokens}</span>
      {durationSec !== null && (
        <>
          <span>·</span>
          <span>{durationSec}s</span>
        </>
      )}
    </div>
  )
}

function pickLastTimestamp(parts: MessagePart[]): number | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type === 'tool_call' && p.completedAt) return p.completedAt
    if (p.type === 'reasoning' && p.completedAt) return p.completedAt
  }
  return null
}
