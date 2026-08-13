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
import { adaptMessages } from '../../lib/messageAdapter'
import type { Message } from '../../stores/app-store'
import { useAppStore } from '../../stores/app-store'
import { UserBubble } from './UserBubble'
import { AssistantTurn } from './AssistantTurn'

/** ChatFeed 向外暴露的命令式接口（用于"回到底部"按钮）。 */
export interface ChatFeedHandle {
  /** 滚到底部。behavior 默认 auto，可传 smooth 平滑滚动。 */
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

interface ChatFeedProps {
  /** 旧 Message[]（store 中存储的格式）；内部会自动适配为新 ChatMessage[]。 */
  messages: Message[]
  /** 或者直接传新 ChatMessage[]（优先级高于 messages）。 */
  chatMessages?: ChatMessage[]
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
  /** 浮动面板是否展开——展开时给消息内容右侧加 padding，让消息不被 InfoPanel 遮住；
      ChatFeed 容器本身仍保持满宽（滚动条始终在窗口最右端）。 */
  panelOpen?: boolean
}

/** 距底部多少像素内算"贴底"（小于此阈值时启用流式跟随）。 */
const STICK_THRESHOLD_PX = 80

export const ChatFeed = forwardRef<ChatFeedHandle, ChatFeedProps>(
  function ChatFeed({
    messages,
    chatMessages,
    streamingId,
    autoScroll = true,
    showStage = true,
    showReasoning = true,
    showToolCalls = true,
    emptySlot,
    onAtBottomChange,
    onClarifyPick,
    editableUserMessageIds,
    editDisabled = false,
    onEditResend,
    selectedModel,
    branches,
    bottomInset = 160,
    panelOpen = false
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
    const adaptedMessages =
      chatMessages ??
      (messagesV2 && messagesV2.length > 0 ? messagesV2 : adaptMessages(messages))

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
        style={{ paddingBottom: bottomInset }}
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {/* 消息内容：mx-auto 居中。面板展开时右侧加 pr 让消息文本
            不被 InfoPanel 遮住；滚动条仍在 ChatFeed 容器（main 满宽）最右。
            PANEL_INSET 必须与 ChatPanel 中 Composer 的扣除值保持一致。 */}
        <div className={`max-w-4xl mx-auto py-8 space-y-8 ${panelOpen ? 'pl-6 pr-[380px]' : 'px-6'}`}>
          {adaptedMessages.map((m) =>
            m.role === 'user' ? (
              <UserBubble
                key={m.id}
                msg={m}
                canEdit={editableUserMessageIds?.has(m.id) ?? false}
                editDisabled={editDisabled}
                onEditResend={onEditResend}
              />
            ) : (
              <AssistantTurn
                key={m.id}
                msg={m}
                isStreaming={m.id === streamingId || m.isStreaming === true}
                showStage={showStage}
                showReasoning={showReasoning}
                showToolCalls={showToolCalls}
                onClarifyPick={onClarifyPick}
                branches={branches}
              />
            )
          )}
        </div>
      </div>
    )
  }
)
