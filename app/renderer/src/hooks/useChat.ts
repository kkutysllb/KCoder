import { useCallback, useRef } from 'react'
import { useAppStore } from '../stores/app-store'
import { useI18n } from '../i18n'
import {
  getEngineAPI,
  type SSEEvent,
  type ApprovalRequest,
  type UserInputRequest
} from '../services/engine-api'
import { reduceSseEvent, type SseEventKind } from '../lib/turnReducer'
import type { ChatMessage, ToolCall } from '../lib/chatMessage'
import { isInternalOnlyText, sanitizeAssistantText } from '../lib/chatMessage'
import { getGeneralPrefs } from '../lib/generalPrefs'

/**
 * 任务完成时播放短促提示音（Web Audio API，无外部资源依赖）。
 *频率 880Hz 正弦波，300ms 指数衰减。
 */
function playNotificationSound(): void {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
    osc.onended = () => ctx.close()
  } catch {
    // AudioContext 可能不可用或被浏览器策略阻止
  }
}

/**
 * 任务完成时发送桌面通知 + 提示音（仅在窗口失焦时触发）。
 */
function notifyTurnCompletion(): void {
  // 窗口在前台时不打扰用户
  if (document.hasFocus() && !document.hidden) return

  const prefs = getGeneralPrefs()
  const isZh = prefs.language === 'zh-CN'
  const title = 'KCoder'
  const body = isZh ? '任务已完成' : 'Task completed'

  if (prefs.taskNotification && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') new Notification(title, { body })
      })
    }
  }

  if (prefs.notificationSound) {
    playNotificationSound()
  }
}

export function useChat() {
  const { t } = useI18n()
  // sendMessage 的自引用 ref（queue 模式递归发送用，避免 useCallback 循环依赖）
  const sendMessageRef = useRef<((text: string, attachmentIds?: string[]) => Promise<void>) | null>(null)
  // 已批准的操作 id（confirm-before-change 审批卡点「批准」后暂存，
  // 随下一条消息（批准指令）发给网关一次性放行对应 (tool,args) 调用）
  const approvedOpsRef = useRef<string[]>([])
  // turn 序号：打断重发（steer / approve 重发）会并发存在多个 turn 的
  // finally 清理逻辑，用单调递增序号保证只有「最新」turn 才执行收尾
  // （setGenerating(false) / 通知 / 清批准 id），避免旧 turn 踩掉新 turn。
  const turnSeqRef = useRef(0)

  const {
    enginePort,
    threadId,
    messages_v2,
    isGenerating,
    setThreadId,
    addChatMessage,
    addPendingApproval,
    resolvePendingApproval,
    addPendingUserInput,
    resolvePendingUserInput,
    setGenerating,
    setEngineStatus,
    clearMessages,
    setThreadGoal,
    setThreadTodos,
    // turn-based API
    applyTurnUpdate,
    setChatMessagesV2
  } = useAppStore()

  // rAF 批处理：流式 delta 高频到达时，每帧合并为一次 store 写入，
  // 避免逐 token setState 导致整 feed 重渲染（长会话/高 token 速率下的卡顿源）。
  // pendingStateRef 线程化同一消息的 in-flight 状态，保证连续 delta 不读到 store 旧值。
  const pendingStateRef = useRef<Partial<ChatMessage> | null>(null)
  const pendingIdRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)

  /** 立即落地 pending 状态到 store（清空缓冲）。 */
  const flushPending = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (pendingStateRef.current) {
      applyTurnUpdate(pendingIdRef.current!, pendingStateRef.current)
      pendingStateRef.current = null
    }
  }, [applyTurnUpdate])

  /**
   * turn-based SSE 处理：调 turnReducer 纯函数产出 partial state，
   * 再 applyTurnUpdate 回写到 messages_v2。同时同步旧 messages.content。
   *
   * 这是 useChat 接入 turnReducer 的核心入口。所有可被 reducer 理解的事件
   * （text_delta / reasoning_delta / tool_call_* / usage / turn_completed 等）
   * 都走这条路径；剩余事件（approval / user_input / goal / todos / branch 等
   * 涉及 store 其他状态的）仍走旧 switch 分支。
   */
  const turnUpdate = useCallback(
    (assistantMessageId: string, kind: SseEventKind, data: Record<string, unknown> | undefined) => {
      const isTerminal = kind === 'turn_completed' || kind === 'turn_failed'

      // 取 reducer 输入状态：优先用同一消息的 in-flight 状态（连续 delta 时不读 store 旧值）
      let base: Partial<ChatMessage>
      if (pendingIdRef.current === assistantMessageId && pendingStateRef.current) {
        base = pendingStateRef.current
      } else {
        base =
          useAppStore.getState().messages_v2.find((m) => m.id === assistantMessageId) ?? {}
        pendingIdRef.current = assistantMessageId
      }
      const next = reduceSseEvent(base, kind, data, Date.now())
      if (next !== base) {
        pendingStateRef.current = next
      }

      if (isTerminal) {
        // 终端事件立即落地（不等下一帧，保证 turn 终态及时）
        flushPending()
      } else if (pendingStateRef.current && rafRef.current === null) {
        // 安排下一帧合并 flush
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          if (pendingStateRef.current) {
            applyTurnUpdate(pendingIdRef.current!, pendingStateRef.current)
            pendingStateRef.current = null
          }
        })
      }

      // turn 完成且携带文件变更 → 累加未读变更数（状态栏 badge）
      if (kind === 'turn_completed') {
        const fc = data?.fileChanges as { files?: unknown[] } | undefined
        const count = Array.isArray(fc?.files) ? fc.files.length : 0
        if (count > 0) {
          useAppStore.getState().addUnreadChanges(count)
        }
      }
    },
    [applyTurnUpdate, flushPending]
  )

  const abortRef = useRef<AbortController | null>(null)

  // Initialize connection and check health
  const checkConnection = useCallback(async () => {
    const api = getEngineAPI(enginePort)
    const healthy = await api.health()
    setEngineStatus(healthy ? 'connected' : 'error')
    return healthy
  }, [enginePort, setEngineStatus])


  /**
   * 处理后端 SSE 事件（按 RuntimeEventKind 分发）。
   * 富内容写入 message.parts，文本同时同步到 content（向后兼容）。
   */
  const handleSseEvent = useCallback(
    (assistantMessageId: string, event: SSEEvent) => {
      const { kind, data } = event

      // ── 可被 turnReducer 处理的事件（文本/推理/工具/用量/结束） ──
      // 这 12 个 kind 直接走 reducer 纯函数路径
      const reducerKinds: ReadonlySet<SseEventKind> = new Set([
        'assistant_text_delta',
        'assistant_reasoning_delta',
        'tool_call_started',
        'tool_call_finished',
        'tool_call_args_updated',
        'subagent_started',
        'subagent_step',
        'subagent_completed',
        'subagent_failed',
        'usage',
        'turn_completed',
        'turn_failed',
        'error',
        'text_delta',
        'reasoning_delta'
      ])
      if (reducerKinds.has(kind as SseEventKind)) {
        // usage 同时累加到会话总量（保持原行为）
        if (kind === 'usage' && data?.usage) {
          const usage = data.usage as Record<string, unknown>
          useAppStore.getState().addSessionUsage({
            promptTokens: (usage.promptTokens as number) ?? 0,
            completionTokens: (usage.completionTokens as number) ?? 0,
            totalTokens: (usage.totalTokens as number) ?? 0
          })
        }
        turnUpdate(assistantMessageId, kind as SseEventKind, data)
        return
      }

      // ── item_* 事件（携带完整 TurnItem，兼容老协议） ──
      // 这类事件 reducer 也能处理，但需要把 item 包装成 reducer 期望的格式
      if (kind === 'item_created' || kind === 'item_updated' || kind === 'item_completed') {
        const item = data.item as Record<string, unknown> | undefined
        if (item) {
          // 让 reducer 通过 reduceItemEvent 处理
          turnUpdate(assistantMessageId, kind as SseEventKind, data)
        }
        return
      }

      // ── 剩余事件（涉及 store 其他状态：审批/输入/goal/todos/branch/compaction） ──
      // 这些保留旧逻辑，不走 reducer
      switch (kind) {
        case 'approval_requested': {
          const approvalId = (data.approvalId as string) ?? ''
          const toolName = (data.toolName as string) ?? 'tool'
          const summary = (data.summary as string) ?? undefined
          const status = (data.status as ApprovalRequest['status']) ?? 'pending'
          const branchId = (data.branchId as string) ?? undefined
          if (approvalId) {
            // 审批作为特殊 tool_call 写入 turn 状态
            turnUpdate(assistantMessageId, 'tool_call_started', {
              callId: approvalId,
              toolName,
              summary,
              args: { approvalId, status, branchId }
            })
            if (status === 'pending') {
              addPendingApproval({ approvalId, toolName, summary, status })
            }
          }
          break
        }
        case 'approval_resolved': {
          const approvalId = (data.approvalId as string) ?? ''
          const status = (data.status as ApprovalRequest['status']) ?? 'allowed'
          if (approvalId) {
            // 更新审批 tool_call 状态
            turnUpdate(assistantMessageId, 'tool_call_finished', {
              callId: approvalId,
              isError: status === 'denied' || status === 'expired',
              summary: status
            })
            resolvePendingApproval(approvalId)
          }
          break
        }

        case 'user_input_requested': {
          const inputId = (data.inputId as string) ?? ''
          if (inputId) {
            const req: UserInputRequest = {
              inputId,
              prompt: (data.prompt as string) ?? undefined,
              status: 'pending',
              questions: (data.questions as UserInputRequest['questions']) ?? undefined
            }
            addPendingUserInput(req)
          }
          break
        }
        case 'user_input_resolved': {
          const inputId = (data.inputId as string) ?? ''
          if (inputId) resolvePendingUserInput(inputId)
          break
        }

        case 'goal_updated': {
          const goal = data.goal as import('../services/engine-api').ThreadGoal | undefined
          if (goal) setThreadGoal(goal)
          break
        }
        case 'goal_cleared': {
          setThreadGoal(null)
          break
        }
        case 'todos_updated': {
          const todos = data.todos as import('../services/engine-api').ThreadTodoList | undefined
          if (todos) setThreadTodos(todos)
          break
        }
        case 'todos_cleared': {
          setThreadTodos(null)
          break
        }

        case 'compaction_started':
        case 'compaction_completed': {
          // 写入 turn 状态（status = compacted）
          turnUpdate(assistantMessageId, kind as SseEventKind, data)
          break
        }

        case 'turn_started':
        case 'turn_aborted':
        case 'heartbeat':
        case 'pipeline_stage':
        case 'tool_call_ready':
        case 'tool_result_upload_wait':
        case 'tool_storm_suppressed':
        case 'tool_catalog_changed':
        case 'thread_created':
        case 'thread_updated':
        case 'turn_steered':
        case 'agent_message_delta':
        case 'agent_message_completed':
          // 这些事件暂不渲染（后续迭代），静默忽略
          break
      }
    },
    [turnUpdate, addPendingApproval, resolvePendingApproval, addPendingUserInput, resolvePendingUserInput, setThreadGoal, setThreadTodos]
  )


  // Send a message
  const sendMessage = useCallback(
    async (content: string, attachmentIds?: string[], options?: { forceCompact?: boolean; displayContent?: string }) => {
      // 读 store 的实时 isGenerating（而非闭包旧值）：steer/approve 在
      // stopGeneration 后紧接着 sendMessage 时，闭包里的 isGenerating 还是 true。
      if (!content.trim() || useAppStore.getState().isGenerating) return
      // 递增 turn 序号：本 turn 的 finally 只在本序号仍是最新时才执行收尾。
      turnSeqRef.current += 1
      const seq = turnSeqRef.current

      const api = getEngineAPI(enginePort)

      // ── /command 前缀解析（前端展开）──
      // 输入 /my-cmd args 时，查 commands.json 拿 content 展开为提示词发给 agent。
      // 失败则原样发送，不阻断。保留 QiLin 原生 /skill-name 激活（RESERVED 排除）。
      let finalContent = content.trim()
      if (finalContent.startsWith('/')) {
        const cmdId = finalContent.slice(1).split(/\s+/)[0]
        // 排除 QiLin 保留的 slash 控制命令（skill 激活等）
        const RESERVED = ['bootstrap', 'goal', 'help', 'memory', 'models', 'new', 'status']
        if (cmdId && !RESERVED.includes(cmdId)) {
          try {
            const cmd = await api.getCommand(cmdId)
            if (cmd && cmd.content) {
              // $ARGUMENTS 占位符代为 /cmd 后面的参数
              const args = finalContent.slice(1 + cmdId.length).trim()
              finalContent = cmd.content.replace(/\$ARGUMENTS/g, args)
            }
          } catch (e) {
            console.error('[KCoder] Failed to resolve command:', e)
            // 失败则原样发送，不阻断
          }
        }
      }

      // Add user message（显示用户原始输入，不显示展开后的 content）
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        createdAt: Date.now(),
        // 显示与发送分离：批准计划等场景发送完整上下文但用户消息保持简洁
        content: (options?.displayContent ?? content).trim()
      }
      addChatMessage(userMessage)

      // Create thread if needed
      let currentThreadId = threadId
      if (!currentThreadId) {
        try {
          // 读取窄条选择状态（调用时取最新值，避免依赖数组膨胀）
          const { workspacePath, selectedModel, pendingNewBranch } = useAppStore.getState()

          // 若用户在窄条里输入了新分支名，先创建并检出（git checkout -b）
          if (workspacePath && pendingNewBranch) {
            try {
              await api.createBranch(workspacePath, pendingNewBranch)
            } catch (e) {
              console.error('Failed to create branch:', e)
              // 分支创建失败不阻塞任务，继续用当前分支
            }
          }

          const thread = await api.createThread({
            workspace: workspacePath ?? undefined,
            model: selectedModel ?? undefined,
            workModeId: 'coding'
          })
          currentThreadId = thread.id
          setThreadId(currentThreadId)
          // 新线程已创建 → 触发侧边栏历史列表刷新（否则新任务要到重启才出现）
          useAppStore.getState().bumpThreadListVersion()
          // 编码任务（绑定 workspace）默认展开浮动面板；普通对话（无 workspace）收起
          useAppStore.getState().setPanelOpen(!!workspacePath)
        } catch (error) {
          console.error('Failed to create thread:', error)
          setEngineStatus('error')
          return
        }
      }

      // Add placeholder for assistant response
      const assistantMessageId = `assistant-${Date.now()}`
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        createdAt: Date.now(),
        text: '',
        status: 'streaming',
        isStreaming: true
      }
      addChatMessage(assistantMessage)
      setGenerating(true)

      try {
        // Governed graph: every turn is driven through the durable governed-graph
        // execution plane. sendMessage now returns turnId immediately (SSE
        // subscription is fire-and-forget), so activeTurnId is set BEFORE the
        // turn completes — this makes the stop button functional.
        // ── 执行层防线2b：turn 看门狗 ──────────────────────────────
        // langgraph 队列/流任一环节黑盒卡死（僵尸 run 排队、引擎进程死亡、
        // 模型连接挂起）时，SSE 永远等不到终止事件 → isGenerating 永久卡死。
        // 看门狗：240s 无任何事件 → 判死，标 error、解除 await、解锁 UI。
        // 正常长工具（构建/测试）一般 <4 分钟；误杀可重发，卡死不可接受。
        const WATCHDOG_MS = 240_000
        let lastActivity = Date.now()
        const watchdogTimer = setInterval(() => {
          if (turnSeqRef.current !== seq) {
            clearInterval(watchdogTimer)
            return
          }
          if (Date.now() - lastActivity > WATCHDOG_MS) {
            clearInterval(watchdogTimer)
            turnUpdate(assistantMessageId, 'error', { message: t('chat.turnUnresponsive') })
            api.abortCurrentTurnWait()
          }
        }, 10_000)

        const turnId = await api.sendMessage(currentThreadId, finalContent, (event: SSEEvent) => {
          lastActivity = Date.now() // 任何事件刷新看门狗
          handleSseEvent(assistantMessageId, event)
        }, attachmentIds, useAppStore.getState().selectedModel ?? undefined, useAppStore.getState().reasoningMode || undefined, {
          // 执行权限模式（引擎 PermissionMiddleware 拦截）；审批通过的操作 id
          // 随本轮放行（一次性）
          permissionMode: useAppStore.getState().permissionMode,
          approvedOps: approvedOpsRef.current.length > 0 ? [...approvedOpsRef.current] : undefined,
          // 手动压缩 turn：引擎绕过自动阈值强制压缩
          forceCompact: options?.forceCompact
        })

        // 立即设置 activeTurnId — 停止按钮和 steer 依赖它
        useAppStore.getState().setActiveTurnId(turnId)

        // 等待 turn 完成 — subscribeToThread 的 promise 在收到终端事件时 resolve
        await api.waitForTurnCompletion()
        clearInterval(watchdogTimer)
      } catch (error) {
        console.error('Failed to send message:', error)
        turnUpdate(assistantMessageId, 'error', { message: '无法连接到引擎，请检查引擎状态后重试。' })
      } finally {
        // 只有「最新」turn 才执行收尾：打断重发（steer/approve）会短暂并存
        // 旧 turn（待 turn_aborted 收尾）与新 turn，旧 turn 的 finally 不得
        // 清掉新 turn 的 isGenerating / 批准 id / 触发通知。
        if (turnSeqRef.current !== seq) return

        // 本轮已消费的批准 id 清空（一次性放行语义）
        approvedOpsRef.current = []
        setGenerating(false)
        // turn 完成 → 触发侧边栏刷新（更新标题 / updatedAt / 排序）
        useAppStore.getState().bumpThreadListVersion()
        // 任务完成通知（窗口失焦时触发桌面通知 + 提示音）
        notifyTurnCompletion()

        // queue 交互模式：turn 完成后检查排队消息，自动发送下一条
        const nextQueued = useAppStore.getState().dequeueMessage()
        if (nextQueued) {
          // 延迟调用避免在 finally 中递归 sendMessage（依赖 useCallback 引用）
          setTimeout(() => {
            const s = useAppStore.getState()
            if (!s.isGenerating) {
              sendMessageRef.current?.(nextQueued)
            }
          }, 100)
        }
      }
    },
    [enginePort, threadId, addChatMessage, setThreadId, setGenerating, setEngineStatus, handleSseEvent]
  )

  // 加载历史会话
  const loadThread = useCallback(
    async (loadThreadId: string) => {
      const api = getEngineAPI(enginePort)
      try {
        const thread = (await api.getThread(loadThreadId)) as {
          turns?: Array<{ items?: Array<Record<string, unknown>> }>
        }
        console.log('[loadThread]', loadThreadId, 'turns=', thread.turns?.length, 'items=', thread.turns?.[0]?.items?.length, thread)
        clearMessages()
        setThreadId(loadThreadId)

        const genId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const itemTs = (item: Record<string, unknown>) =>
          Date.parse((item.createdAt as string) ?? '') || Date.now()

        // 重建 turn-based 消息列表。LangGraph 的扁平 message 列表里，一次用户提问对应
        // 连续的 AIMessage（含 tool_calls / reasoning）+ ToolMessage（tool_result）+ 最终
        // AIMessage。这里把它们合并成「一个 user + 一个 assistant turn」，并在
        // tool_result 出现时按 callId 回填 toolCalls 的 status/output，避免历史消息
        // 的工具调用与思考内容缺失（否则渲染层会出现空洞）。
        const v2: ChatMessage[] = []
        let curAssistant: ChatMessage | null = null

        const flushAssistant = () => {
          const cur = curAssistant
          if (!cur) return
          // 历史线程已结束：把仍处于 running 的 toolCalls 收尾为 completed
          const toolCalls = cur.toolCalls?.map((tc) =>
            tc.status === 'running' ? { ...tc, status: 'completed' as const } : tc
          )
          v2.push(toolCalls ? { ...cur, toolCalls } : cur)
          curAssistant = null
        }

        for (const turn of thread.turns ?? []) {
          for (const item of turn.items ?? []) {
            const role = (item.role as string) ?? ''
            const kind = (item.kind as string) ?? ''

            // ── 用户消息：切分 assistant turn ──
            if (role === 'user' || kind === 'user_message') {
              flushAssistant()
              v2.push({
                id: (item.id as string) ?? genId(),
                role: 'user',
                createdAt: itemTs(item),
                content: (item.text as string) ?? ''
              })
              continue
            }

            // ── assistant 正文（可能附 toolCalls / reasoning）──
            if (kind === 'assistant_text') {
              const rawText = (item.text as string) ?? ''
              // 纯 internal（<memory> 等）整条丢弃；否则剥掉内部块保留正文
              if (isInternalOnlyText(rawText)) continue
              const cleanText = sanitizeAssistantText(rawText)

              // 确保当前 assistant turn 存在（用局部变量收窄，避免闭包类型收窄失效）
              let cur: ChatMessage
              if (!curAssistant) {
                cur = {
                  id: (item.id as string) ?? genId(),
                  role: 'assistant',
                  createdAt: itemTs(item),
                  text: cleanText || '',
                  status: 'done'
                }
              } else {
                cur = cleanText
                  ? { ...curAssistant, text: `${curAssistant.text ?? ''}${cleanText}` }
                  : curAssistant
              }

              // reasoning（后端已从 additional_kwargs.reasoning_content 提取）
              const reasoningText = (item.reasoning as string) ?? ''
              if (reasoningText) {
                cur = {
                  ...cur,
                  reasoning: {
                    text: reasoningText,
                    startedAt: cur.createdAt,
                    endedAt: cur.createdAt
                  }
                }
              }

              // 工具调用（后端字段名 toolName）
              const rawToolCalls = (item.toolCalls as Array<Record<string, unknown>>) ?? []
              if (rawToolCalls.length > 0) {
                const calls: ToolCall[] = rawToolCalls.map((tc) => ({
                  id: (tc.id as string) ?? genId(),
                  name: (tc.toolName as string) ?? (tc.name as string) ?? 'tool',
                  args: tc.args as Record<string, unknown> | undefined,
                  status: 'running' as const
                }))
                cur = { ...cur, toolCalls: [...(cur.toolCalls ?? []), ...calls] }
              }

              curAssistant = cur
              continue
            }

            // ── 工具结果：按 callId 回填到当前 assistant turn ──
            if (kind === 'tool_result') {
              const current: ChatMessage | null = curAssistant
              const callId = (item.callId as string) ?? ''
              const output = (item.output as string) ?? ''
              if (current && callId) {
                curAssistant = {
                  ...current,
                  toolCalls: (current.toolCalls ?? []).map((tc) =>
                    tc.id === callId
                      ? { ...tc, status: 'completed' as const, output: output || undefined }
                      : tc
                  )
                }
              }
              continue
            }
          }
        }
        flushAssistant()

        // 直接写 turn-based 消息列表（保留 reasoning/toolCalls），
        // 同时由 store 反向同步旧 messages（双写）。
        setChatMessagesV2(v2)
      } catch (error) {
        console.error('Failed to load thread:', error)
      }
    },
    [enginePort, clearMessages, setThreadId, setChatMessagesV2]
  )

  // Start a new chat
  const newChat = useCallback(() => {
    clearMessages()
  }, [clearMessages])

  /**
   * 编辑历史 user 消息并重发。
   *
   * gateway 当前不支持"从某条消息重新生成"（branch from message），所以采用
   * "撤回 + 重发"策略：
   *   1. 从 messages_v2 中找到被编辑的 user message 的位置
   *   2. 删除该消息及之后的所有消息（user 视角是"撤回"）
   *   3. 用编辑后的文本调 sendMessage 重新发送
   *
   * 注意：引擎侧 thread 的 turns 历史不会被删除（gateway 无 API），但前端
   * 视图会被重置——用户看到的是"重发后的新对话流"。引擎历史仅在 loadThread
   * 重新加载时再次出现。如果未来 gateway 支持 delete_turn 或 branch_from_message，
   * 可以改用更优雅的方案。
   */
  const editAndResend = useCallback(
    async (messageId: string, replacementText: string) => {
      if (!replacementText.trim() || isGenerating) return

      // 1. 找到 message 在 messages_v2 中的索引
      const state = useAppStore.getState()
      const idx = state.messages_v2.findIndex((m) => m.id === messageId)
      if (idx < 0) {
        throw new Error(`Message ${messageId} not found`)
      }
      const targetMsg = state.messages_v2[idx]
      if (targetMsg.role !== 'user') {
        throw new Error('Only user messages can be edited')
      }

      // 2. 截断：保留 [0, idx)，删除 [idx, end]
      const keptMessages = state.messages_v2.slice(0, idx)
      useAppStore.setState({ messages_v2: keptMessages })

      // 3. 重发——直接调 sendMessage，让它把新的 user message 加进去并启动 turn
      await sendMessage(replacementText)
    },
    [isGenerating, sendMessage]
  )

  // 重新生成指定 assistant 回复：找到其前一条 user 消息，截断后用原文重发。
  // 复用 editAndResend（同样是前端截断 + 重发；引擎侧不支持 branch-from-message）。
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      if (isGenerating) return
      const state = useAppStore.getState()
      const idx = state.messages_v2.findIndex((m) => m.id === assistantMessageId)
      if (idx < 0) return
      for (let i = idx - 1; i >= 0; i--) {
        const m = state.messages_v2[i]
        if (m.role === 'user') {
          const text = m.text ?? m.content ?? ''
          if (text.trim()) await editAndResend(m.id, text)
          return
        }
      }
    },
    [isGenerating, editAndResend]
  )

  // 解决审批请求（允许/拒绝）
  const resolveApproval = useCallback(async (approvalId: string, decision: 'allow' | 'deny', reason?: string) => {
    const api = getEngineAPI(enginePort)
    try {
      await api.decideApproval(approvalId, decision, reason)
      // v1.1.2: 从并发 Map 移除该审批（旧的单值指针由 store 自动重指）。
      resolvePendingApproval(approvalId)
    } catch (e) {
      console.error('[useChat] Failed to resolve approval:', e)
    }
  }, [enginePort, resolvePendingApproval])

  // 提交结构化输入
  const submitUserInput = useCallback(async (inputId: string, answers: Array<{ id: string; label: string; value: string }>) => {
    const api = getEngineAPI(enginePort)
    try {
      await api.resolveUserInput(inputId, answers)
      resolvePendingUserInput(inputId)
    } catch (e) {
      console.error('[useChat] Failed to submit user input:', e)
    }
  }, [enginePort, resolvePendingUserInput])

  // 取消结构化输入
  const cancelUserInput = useCallback(async (inputId: string) => {
    const api = getEngineAPI(enginePort)
    try {
      await api.cancelUserInput(inputId)
      resolvePendingUserInput(inputId)
    } catch (e) {
      console.error('[useChat] Failed to cancel user input:', e)
    }
  }, [enginePort, resolvePendingUserInput])

  // 停止当前 turn（中断 agent 执行）
  const stopGeneration = useCallback(async () => {
    const state = useAppStore.getState()
    if (!state.threadId || !state.activeTurnId) return
    const api = getEngineAPI(enginePort)
    try {
      await api.interruptTurn(state.threadId, state.activeTurnId)
    } catch (e) {
      console.error('[useChat] Failed to stop generation:', e)
    }
    setGenerating(false)
  }, [enginePort, setGenerating])

  // 追加指令到正在运行的 turn（steer）。
  // 方案 A「打断重发」：先中断当前 turn，再以 steer 文本发起新 turn。
  // 复用 stopGeneration（后端 cancel + turn_aborted）+ sendMessage（新 turn 订阅）。
  const steer = useCallback(async (text: string) => {
    const state = useAppStore.getState()
    if (!state.threadId || !state.activeTurnId || !text.trim()) return
    await stopGeneration()
    await sendMessage(text)
  }, [stopGeneration, sendMessage])

  // queue 模式下「立即执行」：出队最早一条并立即引导（打断当前 turn + 重发该条）。
  const executeQueuedNow = useCallback(async () => {
    const text = useAppStore.getState().dequeueMessage()
    if (!text) return
    await steer(text)
  }, [steer])

  // 手动压缩上下文
  /**
   * 手动压缩上下文：以「强制压缩 turn」实现——发送系统指令 + forceCompact，
   * 引擎 SummarizationMiddleware 绕过自动阈值压缩，custom 事件回传
   * compaction_completed（前端渲染压缩提示）。运行中不打断（先停止再压缩）。
   */
  const compactContext = useCallback(async (opts?: { reason?: string; budgetTokens?: number }) => {
    if (useAppStore.getState().isGenerating) return
    const prompt =
      '[系统指令] 压缩当前对话上下文。请只简短确认压缩结果（移除了多少条历史消息、保留了最近多少条），不要调用任何工具、不要开始新任务。'
    await sendMessage(prompt, undefined, { forceCompact: true })
  }, [sendMessage])

  // 绑定 sendMessage 到 ref（queue 模式递归发送用）
  sendMessageRef.current = sendMessage

  /**
   * 审批通过（confirm-before-change 模式的审批卡「批准」）。
   * 把批准 id 存入 ref（随下一条消息发给网关一次性放行），再以批准指令
   * 发起新 turn —— 模型会重新发起同一 (tool,args)，hash 匹配即放行。
   */
  const approveOperation = useCallback(async (opId: string, toolName: string) => {
    if (approvedOpsRef.current.includes(opId)) return
    approvedOpsRef.current = [...approvedOpsRef.current, opId]
    await sendMessage(`[已批准] 请继续执行刚才被暂停的操作（审批 id: ${opId}，工具: ${toolName}）。`)
  }, [sendMessage])

  /** 审批拒绝：发普通拒绝指令，模型停止/改道。 */
  const rejectOperation = useCallback(async (opId: string, toolName: string) => {
    await sendMessage(`[已拒绝] 用户拒绝了刚才的操作（审批 id: ${opId}，工具: ${toolName}）。请停止该操作，如需替代方案先说明。`)
  }, [sendMessage])

  /**
   * 计划批准（plan-mode 的 present_plan 出口）。
   * 1) 把权限模式切到 auto-edit（计划级信任代替逐操作审批）；
   * 2) 以「批准指令 + 计划原文」发起新 turn —— 新 turn 的 configurable 携带
   *    permission_mode=auto-edit，模型按计划执行。
   */
  const approvePlan = useCallback(async (planId: string, title: string, planText: string) => {
    useAppStore.getState().setPermissionMode('auto-edit')
    const prompt = `<approved_plan id="${planId}">\n${planText}\n</approved_plan>\n\n用户已批准该计划，现在进入执行阶段。请严格按照计划逐步实现，并完成 Verification 中的验证。`
    // 完整计划只发给引擎；聊天气泡显示一句话（避免巨型用户消息）
    await sendMessage(prompt, undefined, {
      displayContent: `✓ ${t('plan.approvedSent', { title })}`
    })
  }, [sendMessage, t])

  /** 计划拒绝：保持在 plan-mode，告知模型调整计划后重新 present_plan。 */
  const rejectPlan = useCallback(async (planId: string, title: string) => {
    await sendMessage(`[计划未批准] 用户拒绝了计划「${title}」（id: ${planId}）。请说明调整方向或重新分析后再次调用 present_plan 提交新计划。`)
  }, [sendMessage])

  /** 交付卡「追加到 CHANGELOG」：让 agent 把条目写入项目根 CHANGELOG.md（去重）。 */
  const writeChangelog = useCallback(async (entry: string) => {
    const instruction =
      '请把下面这条变更记录追加到项目根的 CHANGELOG.md 的 [Unreleased] 小节（' +
      '文件不存在则创建，格式为 "- <条目>"）。先 read_file 检查现有内容：若已存在' +
      '内容相同或高度相似的条目，跳过不重复追加，直接说明「已存在，跳过」。\n\n' +
      entry +
      '\n\n写入后确认内容正确并简短说明结果。'
    await sendMessage(instruction)
  }, [sendMessage])

    return {
    messages_v2,
    isGenerating,
    threadId,
    sendMessage,
    editAndResend,
    regenerate,
    stopGeneration,
    steer,
    executeQueuedNow,
    compactContext,
    newChat,
    loadThread,
    checkConnection,
    resolveApproval,
    submitUserInput,
    cancelUserInput,
    approveOperation,
    rejectOperation,
    approvePlan,
    rejectPlan,
    writeChangelog
  }
}

// 注：handleItemEvent 已被 turnReducer 的 reduceItemEvent 取代（在 turnReducer.ts 中）。
// 旧 item 协议（item_created/item_updated/item_completed）现在走 turnUpdate 路径。
