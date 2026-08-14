import { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import { useChat } from '../../hooks/useChat'
import { ChatFeed, type ChatFeedHandle } from './ChatFeed'
import { CommandInput } from '../CommandInput'
import { WelcomeScreen } from '../WelcomeScreen'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getGeneralPref } from '../../lib/generalPrefs'
import { StatusBar } from '../StatusBar'

export function ChatPanel() {
  const { messages_v2, isGenerating, sendMessage, editAndResend, regenerate, stopGeneration, steer } = useChat()
  const feedRef = useRef<ChatFeedHandle>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const branches = useAppStore((s) => s.branches)
  // 浮动面板展开时：ChatFeed 内部用预留层左移避让（滚动条仍满宽最右）；
  // Composer 也需左移（中心左移半个面板宽 + 宽度扣面板宽），否则会钻到面板下方。
  // 文件预览栏打开时浮动面板已被遮挡 → 不再让位（避免中间栏双重挤压）。
  const panelOpen = useAppStore((s) => s.panelOpen)
  const filePreviewOpen = useAppStore((s) => s.openTabs.length > 0 && !!s.activeTab)
  const panelShift = panelOpen && !filePreviewOpen
  const [atBottom, setAtBottom] = useAtBottomState()
  const { t } = useI18n()

  // 悬浮 composer 会遮挡消息末尾：动态测量其高度作为 ChatFeed 的底部
  // 预留空间（含 bottom-4 间距与 20px 视觉呼吸间距）。textarea 多行、
  // 目录选择条、附件预览出现时高度变化都会被 ResizeObserver 捕获。
  const [composerInset, setComposerInset] = useState(160)
  const hasMessages = messages_v2.length > 0
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    const update = () => {
      setComposerInset(Math.max(160, el.offsetHeight + 16 + 20))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasMessages])

  // 读取「显示思考过程」偏好（用户在常规设置中切换）
  const showThinking = getGeneralPref('showThinking')

  // ask_clarification 用户选择后，把答案作为新消息发送（QiLin middleware 已
  // 通过 Command(goto=END) 结束当前 turn，用户回复就是下一个 turn 的输入）
  const handleClarifyPick = useCallback((text: string) => {
    sendMessage(text)
  }, [sendMessage])

  // queue 交互模式：用户在 turn 运行中输入的消息入队，turn 完成后自动发送
  const handleQueue = useCallback((text: string) => {
    useAppStore.getState().enqueueMessage(text)
    useAppStore.getState().addChatMessage({
      id: crypto.randomUUID(),
      role: 'system',
      createdAt: Date.now(),
      content: t('chat.queued'),
      status: 'done'
    })
  }, [t])

  // 可编辑的 user message IDs：每条 user 消息后紧跟一个已完成（或不存在）
  // 的 assistant turn——只要下一条 assistant turn 不是 streaming 就允许编辑。
  // 简化策略：当 isGenerating=false 时所有 user 消息都可编辑。
  const editableUserMessageIds = useMemo(() => {
    if (isGenerating) return new Set<string>()
    const ids = new Set<string>()
    for (const m of messages_v2) {
      if (m.role === 'user') ids.add(m.id)
    }
    return ids
  }, [messages_v2, isGenerating])

  return (
    <div className="relative flex flex-1 min-h-0 flex-col h-full">
      {/* Messages area — ChatFeed 优先读 messages_v2，缺失时 fallback 到 messages。
          空消息时通过 emptySlot 渲染 WelcomeScreen（WelcomeScreen 内部自带 CommandInput）。 */}
      <ChatFeed
        ref={feedRef}
        streamingId={hasMessages && isGenerating ? messages_v2[messages_v2.length - 1].id : undefined}
        showReasoning={showThinking}
        selectedModel={selectedModel}
        branches={branches}
        editDisabled={isGenerating}
        editableUserMessageIds={editableUserMessageIds}
        onEditResend={editAndResend}
        onRegenerate={regenerate}
        onClarifyPick={handleClarifyPick}
        onAtBottomChange={setAtBottom}
        bottomInset={composerInset}
        emptySlot={<WelcomeScreen onSend={sendMessage} disabled={isGenerating} />}
      />

      {/* Composer（悬浮底部）— 只在有消息时显示（空状态由 WelcomeScreen 提供）。
          参考 KStock composer-dock：悬浮圆角卡片 + blur + focus 青绿边框。
          isGenerating 时主输入框仍可输入（Enter 触发 steer 追加指令）。
          浮动面板展开时，Composer 宽度需扣除面板宽度（PANEL_INSET），
          否则 Composer 会被 InfoPanel 遮住右侧。
          bottom-4 → 44px：底部 StatusBar 占 28px + 16px 视觉间距。 */}
      {hasMessages && (
        <div
          ref={composerRef}
          className="absolute -translate-x-1/2 z-10 transition-[left,width] duration-200 ease-out"
          style={{
            bottom: 44,
            left: panelShift ? 'calc(50% - 180px)' : '50%',
            width: `min(900px, calc(100% - 32px${panelShift ? ' - 360px' : ''}))`
          }}
        >
          {/* 回到底部浮动按钮：悬浮在 composer 正上方（KStock 设计） */}
          {!atBottom && (
            <button
              type="button"
              onClick={() => feedRef.current?.scrollToBottom('smooth')}
              aria-label={t('chat.scrollToBottom')}
              title={t('chat.scrollToBottom')}
              className="scroll-to-bottom-button absolute left-1/2 -top-11 -translate-x-1/2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          )}
          <CommandInput
            onSend={sendMessage}
            isGenerating={isGenerating}
            onStop={stopGeneration}
            onSteer={steer}
            onQueue={handleQueue}
          />
        </div>
      )}

      {/* 底部状态栏：engine 状态 + workspace + 右侧 toggle 按钮组
          （变更聚合抽屉 / 文件预览右抽屉）。h-7，固定占 28px。 */}
      <StatusBar />
    </div>
  )
}

/** 简单的 atBottom 状态 hook（避免 ChatPanel 重渲染传播到 ChatFeed 内部）。 */
function useAtBottomState() {
  return useState(true)
}
