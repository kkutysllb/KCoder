// ChatFeed — 对话流聚合骨架（参考 KStock ChatFeed.tsx）。
//
// 职责：
//   1. user 右对齐气泡 + assistant 无气泡 turn 交替渲染
//   2. 滚动管理：流式时智能跟随底部，用户上滚 > 80px 时暂停跟随
//   3. 命令式 scrollToBottom（供"回到底部"按钮调用）
//   4. 空状态插槽（emptySlot）

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { ChatMessage } from '../../lib/chatMessage'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { UserBubble } from './UserBubble'
import { AssistantTurn } from './AssistantTurn'

/** ChatFeed 向外暴露的命令式接口（用于"回到底部"按钮）。 */
export interface ChatFeedHandle {
  /** 滚到底部。behavior 默认 auto，可传 smooth 平滑滚动。 */
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

interface ChatFeedProps {
  /** 流式中的 assistant turn id（高亮 + 滚动跟随）。 */
  streamingId?: string
  /** 是否启用自动滚动（流式跟随）。 */
  autoScroll?: boolean
  /** 是否显示阶段徽章。 */
  showStage?: boolean
  /** 是否显示思考流。 */
  showReasoning?: boolean
  /** 是否显示工具调用。 */
  showToolCalls?: boolean
  /** 空状态插槽。 */
  emptySlot?: ReactNode
  /** 贴底状态变化回调（true=在底部，false=用户上滚）。 */
  onAtBottomChange?: (atBottom: boolean) => void
  /** ask_clarification 选项被选中时回调。 */
  onClarifyPick?: (text: string, question?: string) => void
  /** 执行审批：批准被拦截的操作（confirm-before-change 模式）。 */
  onApprove?: (opId: string, toolName: string) => void
  /** 执行审批：拒绝被拦截的操作。 */
  onReject?: (opId: string, toolName: string) => void
  /** 计划批准：批准 present_plan 提交的计划并进入执行阶段。 */
  onPlanApprove?: (planId: string, title: string, planText: string) => void
  /** 计划批准：拒绝/要求修改计划。 */
  onPlanReject?: (planId: string, title: string) => void
  /** queue 模式下「立即执行」：出队最早一条并引导（打断当前 turn + 重发）。 */
  onExecuteQueued?: () => void
  /** 重新生成指定 assistant 回复（截断到其前一条 user 消息并重发）。 */
  onRegenerate?: (assistantMessageId: string) => void
  /** 可编辑的 user message IDs（由父级根据已完成 assistant turn 计算）。 */
  editableUserMessageIds?: ReadonlySet<string>
  /** 当前有 run 进行时锁定编辑入口。 */
  editDisabled?: boolean
  /** 编辑提交回调；业务层负责创建分支并重新生成。 */
  onEditResend?: (messageId: string, replacementText: string) => Promise<void>
  /** 当前选中的模型（用于 turn 元信息展示）。 */
  selectedModel?: string | null
  /** branches 状态（并行分支投影）。 */
  branches?: Record<string, unknown>
  /** 滚动容器底部预留空间（px）——悬浮 composer 会遮挡消息末尾，
      由父级动态测量 composer 高度后传入；默认 160 保持原行为。 */
  bottomInset?: number
}

/** 距底部多少像素内算"贴底"（小于此阈值时启用流式跟随）。 */
const STICK_THRESHOLD_PX = 80

/** queue 模式下「已排队」通知卡片：显示原文 + 「立即执行」按钮（引导最早一条）。 */
function QueuedNoticeCard({ content, onExecute }: { content: string; onExecute?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border-custom bg-bg-surface/50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-amber-400/90">{t('chat.queued')}</div>
        <div className="mt-0.5 truncate text-xs text-text-secondary" title={content}>{content}</div>
      </div>
      {onExecute && (
        <button
          onClick={onExecute}
          className="shrink-0 rounded-md bg-info px-3 py-1 text-xs font-medium text-white hover:bg-[#2563eb] transition-colors"
        >
          {t('chat.executeNow')}
        </button>
      )}
    </div>
  )
}

export const ChatFeed = forwardRef<ChatFeedHandle, ChatFeedProps>(
  function ChatFeed({
    streamingId,
    autoScroll = true,
    showStage = true,
    showReasoning = true,
    showToolCalls = true,
    emptySlot,
    onAtBottomChange,
    onClarifyPick,
    onApprove,
    onReject,
    onPlanApprove,
    onPlanReject,
    onExecuteQueued,
    onRegenerate,
    editableUserMessageIds,
    editDisabled = false,
    onEditResend,
    selectedModel,
    branches,
    bottomInset = 160
  }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const stickToBottom = useRef(true)
    const [atBottom, setAtBottom] = useState(true)

    // 优先使用 messages_v2（turn-based 新架构的权威数据源）；
    // 缺失时 fallback 到旧 messages（向后兼容，loadThread 等场景）。
    // 同时使用 chatMessages prop 作为显式覆盖入口（供测试或特殊场景）。
    // 注意：不用 useMemo（避免 React 18 严格模式下双渲染导致 useMemo 引用复用，
    // 阻碍新消息流入）。消息列表通常 < 100 条，ad-hoc 适配开销可忽略。
    const messagesV2 = useAppStore((s) => s.messages_v2)
    const panelOpen = useAppStore((s) => s.panelOpen)
    // 文件预览栏打开时，浮动面板已被其遮挡（不占位）→ 聊天不再为浮动面板让位，
    // 避免中间栏被双重挤压。仅在「浮动面板开 且 文件预览关」时才让位。
    const filePreviewOpen = useAppStore((s) => s.openTabs.length > 0 && !!s.activeTab)
    const reserveForPanel = panelOpen && !filePreviewOpen
    const adaptedMessages = messagesV2

    const computeAtBottom = useCallback((el: HTMLElement) => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      return distance < STICK_THRESHOLD_PX
    }, [])

    const handleScroll = useCallback(() => {
      const el = scrollRef.current
      if (!el) return
      const next = computeAtBottom(el)
      stickToBottom.current = next
      if (next !== atBottom) {
        setAtBottom(next)
        onAtBottomChange?.(next)
      }
    }, [atBottom, computeAtBottom, onAtBottomChange])

    // 滚到底部（外部命令式调用）
    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
      const el = scrollRef.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior })
      stickToBottom.current = true
      if (!atBottom) {
        setAtBottom(true)
        onAtBottomChange?.(true)
      }
    }, [atBottom, onAtBottomChange])

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom])

    // 消息变化时若贴底则滚动到底（流式跟随）
    useEffect(() => {
      const el = scrollRef.current
      if (!el) return
      if (!autoScroll) {
        const next = computeAtBottom(el)
        stickToBottom.current = next
        if (next !== atBottom) {
          setAtBottom(next)
          onAtBottomChange?.(next)
        }
        return
      }
      if (!stickToBottom.current) return
      el.scrollTop = el.scrollHeight
    }, [atBottom, autoScroll, computeAtBottom, adaptedMessages, onAtBottomChange])

    if (adaptedMessages.length === 0) {
      return (
        <div className="flex-1 h-full overflow-auto">
          {emptySlot}
        </div>
      )
    }

    return (
      <div
        className="flex-1 overflow-y-auto"
        // scrollbar-gutter: stable 常驻预留滚动条位，避免内容变高导致滚动条
        // 出现/消失时 max-w 内容左右晃动（子代理步骤 5s 增长时尤其明显）。
        style={{ paddingBottom: bottomInset, scrollbarGutter: 'stable' }}
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {/* 滚动条始终在本容器（满宽）最右端。
            面板展开时用一层 padding-right 预留右侧空间——注意这一层在
            max-w-4xl 之外，所以不会压窄文字（文字仍在 max-w-4xl 内自然宽度，
            只是在缩窄后的区域里居中，整体视觉左移）。 */}
        <div className={reserveForPanel ? 'pr-[360px]' : ''}>
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
          {adaptedMessages.map((m) =>
            m.role === 'user' ? (
              <UserBubble
                key={m.id}
                msg={m}
                canEdit={editableUserMessageIds?.has(m.id) ?? false}
                editDisabled={editDisabled}
                onEditResend={onEditResend}
              />
            ) : m.queued ? (
              <QueuedNoticeCard key={m.id} content={m.content ?? ''} onExecute={onExecuteQueued} />
            ) : (
              <AssistantTurn
                key={m.id}
                msg={m}
                isStreaming={m.id === streamingId || m.isStreaming === true}
                showStage={showStage}
                showReasoning={showReasoning}
                showToolCalls={showToolCalls}
                onClarifyPick={onClarifyPick}
                onRegenerate={onRegenerate}
                branches={branches}
                onApprove={onApprove}
                onReject={onReject}
                onPlanApprove={onPlanApprove}
                onPlanReject={onPlanReject}
              />
            )
          )}
        </div>
        </div>
      </div>
    )
  }
)
