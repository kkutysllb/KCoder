import { useCallback, useRef } from 'react'
import { useAppStore, type Message, type MessagePart } from '../stores/app-store'
import {
  getEngineAPI,
  type SSEEvent,
  type ApprovalRequest,
  type UserInputRequest
} from '../services/engine-api'
import type { EngineStreamEvent, RoiSnapshot } from '../services/contracts'
import { reduceSseEvent, type SseEventKind } from '../lib/turnReducer'
import type { ChatMessage } from '../lib/chatMessage'
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
  // sendMessage 的自引用 ref（queue 模式递归发送用，避免 useCallback 循环依赖）
  const sendMessageRef = useRef<((text: string, attachmentIds?: string[]) => Promise<void>) | null>(null)

  const {
    enginePort,
    threadId,
    messages,
    isGenerating,
    setThreadId,
    addMessage,
    updateMessage,
    addPendingApproval,
    resolvePendingApproval,
    addPendingUserInput,
    resolvePendingUserInput,
    setGenerating,
    setEngineStatus,
    clearMessages,
    upsertBranch,
    settleBranch,
    setBranches,
    setRoiSnapshot,
    setThreadGoal,
    setThreadTodos,
    // 新 turn-based API
    applyTurnUpdate,
    setChatMessages
  } = useAppStore()

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
      // 从 store 拿当前消息作为 reducer 输入状态
      const currentMsg = useAppStore.getState().messages_v2.find((m) => m.id === assistantMessageId)
      const state: Partial<ChatMessage> = currentMsg ?? {}
      const next = reduceSseEvent(state, kind, data, Date.now())
      // 只在有变化时回写（reducer 返回原对象表示无变化）
      if (next !== state) {
        applyTurnUpdate(assistantMessageId, next)
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
    [applyTurnUpdate]
  )

  const abortRef = useRef<AbortController | null>(null)
  // Abort controller for the engine-stream subscription (separate from the
  // thread SSE so cancelling one does not tear down the other).
  const engineStreamAbortRef = useRef<AbortController | null>(null)

  // Initialize connection and check health
  const checkConnection = useCallback(async () => {
    const api = getEngineAPI(enginePort)
    const healthy = await api.health()
    setEngineStatus(healthy ? 'connected' : 'error')
    return healthy
  }, [enginePort, setEngineStatus])

  /**
   * 处理 governed durable engine stream 事件（v1.1.2 并行分支 + ROI）。
   *
   * These events come from GET /v1/engine/streams/:streamId/subscribe (NOT the
   * thread SSE). The kind is a free-form string with conventional values:
   * branch.spawned / branch.started / branch.completed / branch.failed /
   * branch.cancelled / branch.late.result / join.waiting / join.completed /
   * run.cancelled / roi.snapshot. Each carries an optional top-level branchId
   * and a payload; roi.snapshot's payload is a RoiSnapshot (with byBranch).
   */
  const handleEngineStreamEvent = useCallback(
    (event: EngineStreamEvent) => {
      const { kind, branchId, payload } = event
      const p = (payload ?? {}) as Record<string, unknown>

      // —— 分支生命周期 ——
      if (kind === 'branch.spawned' && branchId) {
        upsertBranch(branchId, {
          status: 'queued',
          parallelNodeId: p.parallelNodeId as string | undefined,
          joinNodeId: p.joinNodeId as string | undefined
        })
        return
      }
      if (kind === 'branch.started' && branchId) {
        upsertBranch(branchId, { status: 'running' })
        return
      }
      if (kind === 'branch.completed' && branchId) {
        settleBranch(branchId, 'completed')
        return
      }
      if (kind === 'branch.failed' && branchId) {
        settleBranch(branchId, 'failed')
        return
      }
      if (kind === 'branch.cancelled' && branchId) {
        // fail_fast cancellation: the branch was aborted because a sibling failed.
        settleBranch(branchId, 'aborted')
        upsertBranch(branchId, { failFastCancelled: true })
        return
      }
      if (kind === 'branch.late.result' && branchId) {
        // A result arrived after the branch was already terminal — audit only.
        upsertBranch(branchId, { lateResult: true })
        return
      }

      // —— Join ——
      if (kind === 'join.waiting') {
        // All branches must settle before the join proceeds; nothing to store
        // here beyond what branch.* events already track.
        return
      }
      if (kind === 'join.completed') {
        // Join resolved; the run continues past the join node. Branches remain
        // in the projection for historical visibility.
        return
      }

      // —— Run 级 ——
      if (kind === 'run.cancelled') {
        // The whole run was cancelled (e.g. user interrupt). Mark all open
        // branches aborted.
        const branches = useAppStore.getState().branches
        for (const bid of Object.keys(branches)) {
          const st = branches[bid].status
          if (st === 'queued' || st === 'running' || st === 'suspended') {
            settleBranch(bid, 'aborted')
          }
        }
        return
      }

      // —— ROI 快照 ——
      if (kind === 'roi.snapshot' && p && typeof p === 'object') {
        // payload is a RoiSnapshot; store it at the top level. Per-branch ROI
        // (byBranch) is also projected into the branch records.
        setRoiSnapshot(p as unknown as RoiSnapshot)
        const byBranch = (p as { byBranch?: Record<string, unknown> }).byBranch
        if (byBranch && typeof byBranch === 'object') {
          for (const [bid, snap] of Object.entries(byBranch)) {
            if (snap && typeof snap === 'object') {
              upsertBranch(bid, { roiSnapshot: snap as never })
            }
          }
        }
        return
      }
      // Unknown kinds are ignored (forward-compatible — the engine may emit
      // new diagnostic kinds we do not yet render).
    },
    [upsertBranch, settleBranch, setRoiSnapshot]
  )

  /**
   * 订阅当前 turn 对应 run 的 governed engine stream，接收并行分支 + ROI 增量。
   * streamId = `stream:${runId}`，runId = `run_${threadId}_${turnId}`（引擎约定）。
   *
   * Seeds the branch projection from a one-shot timeline snapshot first (so the
   * UI shows the current state immediately), then subscribes for live updates.
   */
  const subscribeEngineProjection = useCallback(
    async (threadId: string, turnId: string) => {
      const api = getEngineAPI(enginePort)
      const runId = api.runIdForTurn(threadId, turnId)
      const streamId = api.streamIdForRun(runId)

      // Tear down any previous subscription.
      engineStreamAbortRef.current?.abort()
      const controller = new AbortController()
      engineStreamAbortRef.current = controller

      // Seed from timeline snapshot (best-effort — the run may not be recorded
      // yet on the very first poll; the stream will deliver the initial state).
      try {
        const timeline = await api.getRunTimeline(runId)
        if (timeline) {
          const branches: Record<string, import('../services/engine-api').BranchProjection> = {}
          for (const [bid, status] of Object.entries(timeline.branchStatus)) {
            branches[bid] = {
              branchId: bid,
              status,
              agentKeys: timeline.agentRuns
                .filter((ar) => ar.branchId === bid)
                .map((ar) => ar.agentId)
            }
          }
          setBranches(branches)
          if (timeline.roiSnapshot) setRoiSnapshot(timeline.roiSnapshot)
        }
      } catch {
        // Timeline not available yet — the stream will carry the initial state.
      }

      // Subscribe for live branch/ROI updates until the run terminates.
      void api.subscribeEngineStream(
        streamId,
        (evt) => handleEngineStreamEvent(evt),
        {
          signal: controller.signal,
          shouldStop: (evt) => evt.kind === 'run.cancelled'
        }
      )
    },
    [enginePort, handleEngineStreamEvent, setBranches, setRoiSnapshot]
  )

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

  // 轮询执行投影视图（SSE 流期间每 1.5s 拉一次 DAG 进度）+ governed graph 治理状态
  const pollExecution = useCallback(async (threadId: string, turnId: string) => {
    const api = getEngineAPI(enginePort)
    const poll = async () => {
      try {
        const view = await api.getTurnExecution(threadId, turnId)
        useAppStore.getState().setTurnExecution(view)
        // 同时拉 governed graph 运行检查（circuit 状态、active nodes、budgets）
        const runId = api.runIdForTurn(threadId, turnId)
        api.inspectGraphRun(runId).then((inspection) => {
          useAppStore.getState().setGraphRunInspection(inspection)
        }).catch(() => { /* governed engine 未配置时静默 */ })
        // running/queued 状态继续轮询；completed/failed/aborted 停止
        if (view.available && (view.status === 'running' || view.status === 'queued')) {
          setTimeout(poll, 1500)
        }
      } catch {
        // 投影暂不可用（legacy turn / not recorded）— 静默停止
      }
    }
    // 首次延迟 500ms（让后端投影初始化）
    setTimeout(poll, 500)
  }, [enginePort])

  // Send a message
  const sendMessage = useCallback(
    async (content: string, attachmentIds?: string[]) => {
      if (!content.trim() || isGenerating) return

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
      // 同时写入旧 messages（向后兼容）和 messages_v2（turn-based）
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now()
      }
      addMessage(userMessage)

      // Create thread if needed
      let currentThreadId = threadId
      if (!currentThreadId) {
        try {
          // 读取窄条选择状态（调用时取最新值，避免依赖数组膨胀）
          const { workspacePath, selectedModel, pendingNewBranch } = useAppStore.getState()

          // 若用户在窄条里输入了新分支名，先创建（不切换检出）
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
        } catch (error) {
          console.error('Failed to create thread:', error)
          setEngineStatus('error')
          return
        }
      }

      // Add placeholder for assistant response（同时写两份）
      const assistantMessageId = `assistant-${Date.now()}`
      const assistantMessage: Message = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        parts: []
      }
      addMessage(assistantMessage)
      setGenerating(true)

      try {
        // Governed graph: every turn is driven through the durable governed-graph
        // execution plane. sendMessage now returns turnId immediately (SSE
        // subscription is fire-and-forget), so activeTurnId is set BEFORE the
        // turn completes — this makes the stop button functional.
        const turnId = await api.sendMessage(currentThreadId, finalContent, (event: SSEEvent) => {
          handleSseEvent(assistantMessageId, event)
        }, attachmentIds, useAppStore.getState().selectedModel ?? undefined, useAppStore.getState().reasoningMode || undefined)

        // 立即设置 activeTurnId — 停止按钮和 steer 依赖它
        useAppStore.getState().setActiveTurnId(turnId)
        // v1.1.2: 订阅 governed engine stream（并行分支 + ROI 增量）
        void subscribeEngineProjection(currentThreadId, turnId)
        // 轮询执行投影（非阻塞 — turn 完成由 SSE 终端事件驱动）
        void pollExecution(currentThreadId, turnId)

        // 等待 turn 完成 — subscribeToThread 的 promise 在收到终端事件时 resolve
        await api.waitForTurnCompletion()
      } catch (error) {
        console.error('Failed to send message:', error)
        turnUpdate(assistantMessageId, 'error', { message: '无法连接到引擎，请检查引擎状态后重试。' })
      } finally {
        updateMessage(assistantMessageId, useAppStore.getState().messages.find((m) => m.id === assistantMessageId)?.content ?? '')
        setGenerating(false)
        // 任务完成通知（窗口失焦时触发桌面通知 + 提示音）
        notifyTurnCompletion()
        // 最终再拉一次执行投影（确保 completed 状态）
        const state = useAppStore.getState()
        if (state.activeTurnId && state.threadId) {
          try {
            const view = await getEngineAPI(enginePort).getTurnExecution(state.threadId, state.activeTurnId)
            state.setTurnExecution(view)
          } catch { /* 投影不可用时静默 */ }
        }

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
    [enginePort, threadId, isGenerating, addMessage, updateMessage, setThreadId, setGenerating, setEngineStatus, handleSseEvent, pollExecution, subscribeEngineProjection]
  )

  // 加载历史会话
  const loadThread = useCallback(
    async (loadThreadId: string) => {
      const api = getEngineAPI(enginePort)
      try {
        const thread = (await api.getThread(loadThreadId)) as {
          turns?: Array<{ items?: Array<Record<string, unknown>> }>
        }
        clearMessages()
        setThreadId(loadThreadId)
        const newMessages: Message[] = []
        for (const turn of thread.turns ?? []) {
          for (const item of turn.items ?? []) {
            const role = (item.role as string) ?? 'assistant'
            const kind = (item.kind as string) ?? ''
            if (role === 'user' || kind === 'user_message') {
              newMessages.push({
                id: (item.id as string) ?? `msg-${Date.now()}-${Math.random()}`,
                role: 'user',
                content: (item.text as string) ?? '',
                timestamp: Date.parse((item.createdAt as string) ?? '') || Date.now()
              })
            } else if (kind === 'assistant_text') {
              // 过滤 QiLin 注入的 <memory>...</memory> 等内部块：
              // - 整条都是 internal → 丢弃（不显示）
              // - 混入到合法 reply 中 → 剥掉 memory 块保留 reply
              const rawText = (item.text as string) ?? ''
              if (isInternalOnlyText(rawText)) continue
              const cleanText = sanitizeAssistantText(rawText)
              newMessages.push({
                id: (item.id as string) ?? `msg-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                content: cleanText,
                timestamp: Date.parse((item.createdAt as string) ?? '') || Date.now(),
                parts: [{ type: 'text', text: cleanText }]
              })
            }
          }
        }
        // 批量加载：走 setChatMessages 双写 messages + messages_v2。
        // 若只写 messages，ChatFeed（优先读 v2）会误走 emptySlot 渲染 WelcomeScreen。
        setChatMessages(newMessages)
      } catch (error) {
        console.error('Failed to load thread:', error)
      }
    },
    [enginePort, clearMessages, setThreadId, setChatMessages]
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
      useAppStore.setState({
        messages_v2: keptMessages,
        messages: keptMessages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content ?? m.text ?? '',
          timestamp: m.createdAt,
          isStreaming: m.isStreaming
        }))
      })

      // 3. 重发——直接调 sendMessage，让它把新的 user message 加进去并启动 turn
      await sendMessage(replacementText)
    },
    [isGenerating, sendMessage]
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
    // engineStreamAbortRef 会随 setGenerating(false) 之后的清理断开
    // 这里手动 abort 确保立即停止订阅
    engineStreamAbortRef.current?.abort()
    setGenerating(false)
  }, [enginePort, setGenerating])

  // 追加指令到正在运行的 turn（steer）
  const steer = useCallback(async (text: string) => {
    const state = useAppStore.getState()
    if (!state.threadId || !state.activeTurnId || !text.trim()) return
    const api = getEngineAPI(enginePort)
    try {
      await api.steerTurn(state.threadId, state.activeTurnId, text.trim())
    } catch (e) {
      console.error('[useChat] Failed to steer turn:', e)
    }
  }, [enginePort])

  // 手动压缩上下文
  const compactContext = useCallback(async (opts?: { reason?: string; budgetTokens?: number }) => {
    const state = useAppStore.getState()
    if (!state.threadId) return
    const api = getEngineAPI(enginePort)
    try {
      await api.compactThread(state.threadId, opts)
    } catch (e) {
      console.error('[useChat] Failed to compact context:', e)
    }
  }, [enginePort])

  // 绑定 sendMessage 到 ref（queue 模式递归发送用）
  sendMessageRef.current = sendMessage

    return {
    messages,
    isGenerating,
    threadId,
    sendMessage,
    editAndResend,
    stopGeneration,
    steer,
    compactContext,
    newChat,
    loadThread,
    checkConnection,
    resolveApproval,
    submitUserInput,
    cancelUserInput
  }
}

// 注：handleItemEvent 已被 turnReducer 的 reduceItemEvent 取代（在 turnReducer.ts 中）。
// 旧 item 协议（item_created/item_updated/item_completed）现在走 turnUpdate 路径。
