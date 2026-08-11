import { useCallback, useRef } from 'react'
import { useAppStore, type Message, type MessagePart } from '../stores/app-store'
import {
  getEngineAPI,
  type SSEEvent,
  type ApprovalRequest,
  type UserInputRequest
} from '../services/engine-api'
import type { EngineStreamEvent, RoiSnapshot } from '../services/contracts'

export function useChat() {
  const {
    enginePort,
    threadId,
    messages,
    isGenerating,
    setThreadId,
    addMessage,
    updateMessage,
    appendMessagePart,
    settleStreamingReasoning,
    updateLastToolCall,
    updateApprovalPart,
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
    setThreadTodos
  } = useAppStore()

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

      switch (kind) {
        // —— 文本流式增量 ——
        // 收到文本增量意味着推理阶段结束、正文阶段开始。先把仍在流式的 reasoning
        // part 收尾（打上 completedAt），渲染层据此折叠为「已思考 Ns」摘要条。
        case 'assistant_text_delta': {
          settleStreamingReasoning(assistantMessageId)
          const delta = (data.delta as string) ?? ''
          if (delta) appendMessagePart(assistantMessageId, { type: 'text', text: delta })
          break
        }

        // —— 推理流式增量 ——
        // 带上 isStreaming:true + startedAt，让 appendMessagePart 的合并分支能识别
        // 「最后一段正在流式的 reasoning」并追加而不是新建碎片 part。
        case 'assistant_reasoning_delta': {
          const delta = (data.delta as string) ?? (data.text as string) ?? ''
          if (delta)
            appendMessagePart(assistantMessageId, {
              type: 'reasoning',
              text: delta,
              isStreaming: true,
              startedAt: Date.now()
            })
          break
        }

        // —— item 事件（携带完整 TurnItem）——
        case 'item_created':
        case 'item_updated':
        case 'item_completed': {
          const item = data.item as Record<string, unknown> | undefined
          if (!item) break
          handleItemEvent(assistantMessageId, item, kind, appendMessagePart, updateLastToolCall)
          break
        }

        // —— 工具调用生命周期 ——
        case 'tool_call_started': {
          const callId = (data.callId as string) ?? ''
          const toolName = (data.toolName as string) ?? 'tool'
          if (callId) {
            appendMessagePart(assistantMessageId, {
              type: 'tool_call',
              toolName,
              status: 'running',
              callId,
              startedAt: Date.now(),
              args: (data.args as Record<string, unknown> | undefined) ?? undefined
            })
          }
          break
        }
        case 'tool_call_finished': {
          const callId = (data.callId as string) ?? ''
          if (callId) {
            updateLastToolCall(assistantMessageId, callId, {
              status: data.isError ? 'failed' : 'completed',
              summary: (data.summary as string) ?? undefined,
              completedAt: Date.now()
            })
          }
          break
        }

        // —— token 用量 ——
        case 'usage': {
          const usage = data.usage as Record<string, unknown> | undefined
          if (usage) {
            const u = {
              promptTokens: (usage.promptTokens as number) ?? 0,
              completionTokens: (usage.completionTokens as number) ?? 0,
              totalTokens: (usage.totalTokens as number) ?? 0
            }
            appendMessagePart(assistantMessageId, { type: 'usage', ...u })
            // 同时累加到会话总量（供输入框底部 ROI 缩略条展示）
            useAppStore.getState().addSessionUsage(u)
          }
          break
        }

        // —— 错误 ——
        case 'error': {
          const msg = (data.message as string) ?? '发生错误'
          appendMessagePart(assistantMessageId, { type: 'text', text: `\n\n⚠️ ${msg}` })
          break
        }

        // —— 审批请求 ——
        // v1.1.2: 并行分支可同时各自请求审批，因此用并发 Map（addPendingApproval）
        // 记录每个 pending 审批；旧的单值 pendingApproval 由 store 自动同步指向最新的。
        case 'approval_requested': {
          const approvalId = (data.approvalId as string) ?? ''
          const toolName = (data.toolName as string) ?? 'tool'
          const summary = (data.summary as string) ?? undefined
          const status = (data.status as ApprovalRequest['status']) ?? 'pending'
          const branchId = (data.branchId as string) ?? undefined
          if (approvalId) {
            appendMessagePart(assistantMessageId, { type: 'approval', approvalId, toolName, summary, status, branchId })
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
            updateApprovalPart(assistantMessageId, approvalId, status)
            // 从并发 Map 移除（store 会把旧的单值指针重指到其它仍 pending 的项）
            resolvePendingApproval(approvalId)
          }
          break
        }

        // —— 结构化输入请求 ——
        // 同审批：并发 Map 容纳多个分支同时挂起的输入请求。
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

        // turn 终止事件由 subscribeToThread 处理（resolve promise）。
        // turn_failed 需要显示错误信息——否则引擎报错时前端完全静默，
        // 用户只看到“消息发出去了但什么都没发生”。
        case 'turn_failed': {
          const failMsg = (data.message as string) ?? 'turn 执行失败（引擎未提供错误详情）'
          appendMessagePart(assistantMessageId, { type: 'text', text: `\n\n⚠️ ${failMsg}` })
          break
        }
        case 'turn_completed':
        case 'turn_aborted':
        case 'heartbeat':
          break
        // —— 线程目标 / 待办实时更新 ——
        // 引擎在 agent 使用 create_goal/update_goal/todo_write 工具时发出这些
        // 事件，实时同步到 Plan 面板（不再只在切线程时拉一次）。
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

        // —— 上下文压缩（当前 QiLin 引擎未发，预留渲染，信号源就绪后零改动生效）——
        case 'compaction_started': {
          appendMessagePart(assistantMessageId, { type: 'compaction', kind: 'started' })
          break
        }
        case 'compaction_completed': {
          appendMessagePart(assistantMessageId, { type: 'compaction', kind: 'completed' })
          break
        }

        case 'pipeline_stage':
        case 'tool_call_ready':
        case 'tool_result_upload_wait':
        case 'tool_storm_suppressed':
        case 'tool_catalog_changed':
        case 'thread_created':
        case 'thread_updated':
        case 'turn_started':
        case 'turn_steered':
        case 'agent_message_delta':
        case 'agent_message_completed':
          // 这些事件暂不渲染（后续迭代），静默忽略
          break
      }
    },
    [
      appendMessagePart,
      settleStreamingReasoning,
      updateLastToolCall,
      updateApprovalPart,
      addPendingApproval,
      resolvePendingApproval,
      addPendingUserInput,
      resolvePendingUserInput,
      setThreadGoal,
      setThreadTodos
    ]
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

      // Add placeholder for assistant response（带空 parts 数组）
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
        }, attachmentIds, useAppStore.getState().selectedModel ?? undefined, useAppStore.getState().subagentEnabled || undefined)

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
        appendMessagePart(assistantMessageId, {
          type: 'text',
          text: '⚠️ 无法连接到引擎，请检查引擎状态后重试。'
        })
      } finally {
        updateMessage(assistantMessageId, useAppStore.getState().messages.find((m) => m.id === assistantMessageId)?.content ?? '')
        setGenerating(false)
        // 最终再拉一次执行投影（确保 completed 状态）
        const state = useAppStore.getState()
        if (state.activeTurnId && state.threadId) {
          try {
            const view = await getEngineAPI(enginePort).getTurnExecution(state.threadId, state.activeTurnId)
            state.setTurnExecution(view)
          } catch { /* 投影不可用时静默 */ }
        }
      }
    },
    [enginePort, threadId, isGenerating, addMessage, updateMessage, appendMessagePart, setThreadId, setGenerating, setEngineStatus, handleSseEvent, pollExecution, subscribeEngineProjection]
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
              newMessages.push({
                id: (item.id as string) ?? `msg-${Date.now()}-${Math.random()}`,
                role: 'assistant',
                content: (item.text as string) ?? '',
                timestamp: Date.parse((item.createdAt as string) ?? '') || Date.now(),
                parts: [{ type: 'text', text: (item.text as string) ?? '' }]
              })
            }
          }
        }
        // 批量加入（绕过逐条 addMessage 的多次 set）
        useAppStore.setState((state) => ({ messages: [...state.messages, ...newMessages] }))
      } catch (error) {
        console.error('Failed to load thread:', error)
      }
    },
    [enginePort, clearMessages, setThreadId]
  )

  // Start a new chat
  const newChat = useCallback(() => {
    clearMessages()
  }, [clearMessages])

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

  return {
    messages,
    isGenerating,
    threadId,
    sendMessage,
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

/**
 * 处理 item_created/item_updated/item_completed 事件中的 TurnItem。
 * 按 item.kind 分发到对应的 message part。
 */
function handleItemEvent(
  assistantMessageId: string,
  item: Record<string, unknown>,
  kind: string,
  appendPart: (id: string, part: MessagePart) => void,
  updateToolCall: (id: string, callId: string, patch: Partial<Extract<MessagePart, { type: 'tool_call' }>>) => void
) {
  const itemKind = (item.kind as string) ?? ''
  const itemId = (item.id as string) ?? ''
  const isCompleted = kind === 'item_completed'

  switch (itemKind) {
    case 'assistant_text': {
      // kernel_v3 streams live deltas (assistant_text_delta) during model
      // generation, then emits a final item_completed with the full text.
      // We skip item_created/item_updated to avoid clobbering the delta
      // stream — only sync on item_completed (final authoritative text).
      if (!isCompleted) break
      const text = (item.text as string) ?? ''
      appendPart(assistantMessageId, { type: 'text', text, itemId })
      break
    }
    case 'assistant_reasoning': {
      // Same as assistant_text: only sync on item_completed.
      if (!isCompleted) break
      const text = (item.text as string) ?? ''
      appendPart(assistantMessageId, { type: 'reasoning', text, itemId })
      break
    }
    case 'tool_call': {
      const callId = (item.callId as string) ?? ''
      const toolName = (item.toolName as string) ?? 'tool'
      const status = (item.status as string) ?? 'running'
      if (callId) {
        const mappedStatus = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running'
        updateToolCall(assistantMessageId, callId, {
          status: mappedStatus as 'running' | 'completed' | 'failed',
          summary: (item.summary as string) ?? undefined
        })
      } else if (isCompleted) {
        appendPart(assistantMessageId, {
          type: 'tool_call',
          toolName,
          status: 'completed',
          summary: (item.summary as string) ?? undefined
        })
      }
      break
    }
    case 'tool_result': {
      const toolName = (item.toolName as string) ?? 'tool'
      const output = item.output
      const isError = (item.isError as boolean) ?? false
      appendPart(assistantMessageId, {
        type: 'tool_result',
        toolName,
        output: typeof output === 'string' ? output : JSON.stringify(output),
        isError
      })
      break
    }
  }
}
