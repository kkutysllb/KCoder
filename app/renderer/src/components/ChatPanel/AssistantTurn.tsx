// AssistantTurn — AI turn 编排器（参考 KStock AssistantTurn.tsx）。
//
// Claude/ChatGPT 风格无气泡布局，从上到下按语义分区：
//   1. 阶段徽章（无工具调用时）
//   2. ReasoningBlock（思考流，默认折叠）
//   3. SubagentGroup[]（子代理活动）
//   4. ToolActivitySummary（工具调用摘要，折叠式）
//   5. 正文 text（markdown）
//   6. ClarificationCard（如有交互式澄清，替换 fallback 正文）
//   7. 错误信息

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, HumanInputPayload } from '../../lib/chatMessage'
import { isInternalOnlyText, sanitizeAssistantText } from '../../lib/chatMessage'
import { CodeBlock } from '../CodeBlock'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { StageBadge } from './StageBadge'
import { ReasoningBlock } from './ReasoningBlock'
import { SubagentGroup } from './SubagentGroup'
import { ToolActivitySummary } from './ToolActivitySummary'
import { ClarificationCard } from './ClarificationCard'
import { ArtifactBar } from './ArtifactBar'
import { FileChangeCard } from './FileChangeCard'
import { StreamingDots } from './parts/icons'

interface AssistantTurnProps {
  msg: ChatMessage
  isStreaming?: boolean
  showStage?: boolean
  showReasoning?: boolean
  showToolCalls?: boolean
  /** ask_clarification 选项被选中时回调。 */
  onClarifyPick?: (text: string, question?: string) => void
  /** 重新生成本条 assistant 回复。 */
  onRegenerate?: (assistantMessageId: string) => void
  /** branches 状态（并行分支投影）。 */
  branches?: Record<string, unknown>
}

/**
 * 检测 turn 是否携带交互式澄清（ask_clarification）。
 * 如果是，用 ClarificationCard 替换 fallback 正文。
 */
function detectClarification(msg: ChatMessage): {
  payload?: HumanInputPayload
  isInteractive: boolean
} {
  // SSE 翻译层 (sse.py) 从 ToolMessage.artifact 中提取 human_input payload，
  // 在 tool_call_finished 事件中传递。当 toolCalls 里有 name === 'ask_clarification'
  // 且 status === 'completed' 时触发 ClarificationCard 渲染。
  const call = msg.toolCalls?.find(
    (c) => c.name === 'ask_clarification' && c.status === 'completed'
  )
  if (!call) return { isInteractive: false }
  const payload = call.artifact as HumanInputPayload | undefined
  if (!payload || payload.kind !== 'human_input_request') {
    return { isInteractive: false }
  }
  return {
    payload,
    isInteractive:
      payload.input_mode === 'choice_with_other' ||
      payload.input_mode === 'form' ||
      payload.input_mode === 'free_text'
  }
}

export function AssistantTurn({
  msg,
  isStreaming,
  showStage = true,
  showReasoning = true,
  showToolCalls = true,
  onClarifyPick,
  onRegenerate
}: AssistantTurnProps) {
  const streaming = isStreaming ?? msg.status === 'streaming'

  // 文件链接点击 → 打开全局预览右栏（三分栏第三栏，App.tsx 挂载）
  const openFilePreview = useAppStore((s) => s.openFilePreview)
  const { t } = useI18n()

  // 兜底净化：剥掉 QiLin 注入的 <memory> 等内部块（防止 SSE 流式或
  // loadThread 路径漏过滤时直接渲染给用户）。
  const displayText = useMemo(
    () => (isInternalOnlyText(msg.text) ? '' : sanitizeAssistantText(msg.text)),
    [msg.text]
  )

  // 澄清检测
  const { payload: clarifyPayload, isInteractive: hasInteractiveClarification } = useMemo(
    () => detectClarification(msg),
    [msg]
  )
  const visibleToolCalls = useMemo(
    () => msg.toolCalls?.filter((c) => c.name !== 'ask_clarification') ?? [],
    [msg.toolCalls]
  )

  const hasToolActivity = showToolCalls && visibleToolCalls.length > 0
  const showTurnHeader = (showStage && !hasToolActivity) || msg.status === 'compacted'

  const hasContent =
    (displayText && displayText.length > 0) ||
    (showReasoning && msg.reasoning) ||
    (showToolCalls && msg.toolCalls && msg.toolCalls.length > 0) ||
    (msg.subagents && msg.subagents.length > 0) ||
    hasInteractiveClarification

  return (
    <article aria-label="助手消息" className="group">
      {/* turn 容器：去掉左侧 28px K 头像后，文字直接铺满 */}
      <div className="min-w-0">
        {/* 1. 阶段徽章 / compaction 通知 */}
        {showTurnHeader && (
          <div className="flex items-center gap-2 mb-2">
            {showStage && !hasToolActivity && (
              <StageBadge stage={msg.stage} streaming={streaming} />
            )}
            {msg.status === 'compacted' && (
              <span
                className="text-[10px] text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded"
                title="引擎已压缩历史上下文"
              >
                上下文已压缩
              </span>
            )}
          </div>
        )}

        {/* 2. 思考流（默认折叠） */}
        {showReasoning && msg.reasoning && (
          <ReasoningBlock
            reasoning={msg.reasoning}
            streaming={streaming}
            thinkingMs={msg.thinkingMs}
          />
        )}

        {/* 3. 子代理活动 */}
        {msg.subagents?.map((task) => (
          <SubagentGroup key={task.taskId} task={task} showToolCalls={showToolCalls} />
        ))}

        {/* 4. 工具调用摘要 */}
        {showToolCalls && (
          <ToolActivitySummary calls={visibleToolCalls} streaming={streaming} />
        )}

        {/* 4.5 产出文件（present_files 工具调用的文件卡片）*/}
        <ArtifactBar msg={msg} />

        {/* 4.6 workspace 文件变更（turn 结束时 gateway 计算并附带）*/}
        {msg.fileChanges && <FileChangeCard changes={msg.fileChanges} />}

        {/* 5. 正文 / 澄清卡片 */}
        {hasInteractiveClarification && clarifyPayload && onClarifyPick ? (
          <ClarificationCard
            payload={clarifyPayload}
            onPick={(text) => onClarifyPick(text, clarifyPayload.question)}
          />
        ) : (
          displayText && (
            <div className="turn-text markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // 链接：workspace 虚拟路径 → 预览右栏；http(s) → 新窗口打开
                  a({ href, children, ...props }) {
                    const h = href || ''
                    if (h.startsWith('/mnt/user-data/')) {
                      return (
                        <a
                          href={h}
                          onClick={(e) => {
                            e.preventDefault()
                            openFilePreview(h)
                          }}
                          title="在预览面板中打开该文件"
                          {...props}
                        >
                          {children}
                        </a>
                      )
                    }
                    return (
                      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                        {children}
                      </a>
                    )
                  },
                  // 代码块：fallback 到 inline 样式（CodeBlock 组件已存在但对单行 token 适配差）
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    const codeString = String(children).replace(/\n$/, '')
                    if (match) {
                      return <CodeBlock language={match[1]} code={codeString} />
                    }
                    return (
                      <code
                        className=""
                        {...props}
                      >
                        {children}
                      </code>
                    )
                  }
                }}
              >
                {displayText}
              </ReactMarkdown>
              {streaming && (
                <span className="inline-block ml-1 align-middle" aria-hidden="true">
                  <span className="inline-block w-1.5 h-3 bg-[#3b82f6] animate-pulse" />
                </span>
              )}
            </div>
          )
        )}

        {/* 空内容 streaming 占位 */}
        {!hasContent && streaming && (
          <div className="flex items-center gap-2 pt-1 text-text-muted">
            <StreamingDots />
            <span className="text-xs">正在启动…</span>
          </div>
        )}

        {/* 错误 */}
        {msg.error && (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-red-300">{msg.error}</span>
          </div>
        )}

        {/* 操作栏：重新生成（非流式、有正文、未出错时显示） */}
        {!streaming && hasContent && !msg.error && onRegenerate && (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onRegenerate(msg.id)}
              title={t('chat.regenerate')}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M19.6 9.348A8 8 0 106.32 6.876L4 9.348m0 0V4.356M4 9.348h4.992" />
              </svg>
              {t('chat.regenerate')}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
