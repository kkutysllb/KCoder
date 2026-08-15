// InfoPanel — 浮动信息面板（参考 KStock 四段堆叠式布局）。
//
// 风格：四个 section 上下排列，每段 = 标题(icon + label) + 右上角操作区 + 内容
//   1. Git 工具：变更统计 +/- badge + 分支 + commit/push 按钮组
//   2. 计划：thread goal（线程目标描述）
//   3. 进度：todos 完成计数 + checklist（无进度条）
//   4. 智能体：当前任务实际调用的 sub-agents（来自 toolCalls 里的 task 工具调用，动态）
//
// 展开策略保留：auto（有执行数据时自动展开）/ manual（用户手动 toggle）

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type CommitResult,
  type WorkspaceStatus
} from '../../services/engine-api'
import { getGeneralPref } from '../../lib/generalPrefs'

export function InfoPanel() {
  const { t } = useI18n()
  const {
    panelOpen,
    setPanelOpen,
    threadId, enginePort, engineStatus,
    workspacePath,
    setThreadGoal, setThreadTodos
  } = useAppStore()

  // 线程切换时加载 goal + todos
  useEffect(() => {
    if (!threadId || engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getThreadGoal(threadId).then(setThreadGoal).catch(() => {})
    api.getThreadTodos(threadId).then(setThreadTodos).catch(() => {})
  }, [threadId, enginePort, engineStatus, setThreadGoal, setThreadTodos])

  // 刷新工作区状态（commit/push 后由按钮触发）
  const reloadGit = useCallback(() => {
    window.dispatchEvent(new CustomEvent('kcoder:reload-workspace-status'))
  }, [])

  // 提交：弹输入框收集 message，调用 commitWorkspace，反馈给用户
  const onCommit = useCallback(async () => {
    if (!workspacePath) return
    const message = window.prompt(t('panel.commitNeedMessage'))
    if (!message) return
    const api = getEngineAPI(enginePort)
    const r = await api.commitWorkspace(workspacePath, message)
    handleGitResult(r, t('panel.commit'), reloadGit)
  }, [workspacePath, enginePort, t, reloadGit])

  // 推送：直接调用 pushWorkspace
  const onPush = useCallback(async () => {
    if (!workspacePath) return
    const api = getEngineAPI(enginePort)
    const r = await api.pushWorkspace(workspacePath)
    handleGitResult(r, t('panel.push'), reloadGit)
  }, [workspacePath, enginePort, t, reloadGit])

  if (!panelOpen) return null

  return (
    <aside className="fixed top-12 right-3 z-50 w-[340px] max-h-[calc(100vh-60px)] flex flex-col rounded-xl border border-float-border bg-float-bg shadow-2xl overflow-hidden backdrop-blur-md">
      {/* 头部：标题 + 关闭 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
          {t('panel.title')}
        </h2>
        <button
          onClick={() => setPanelOpen(false)}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t('panel.collapse')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 内容：四个 section 上下排列，scroll */}
      <div className="flex-1 overflow-y-auto pb-3">
        <GitSection
          workspacePath={workspacePath}
          onCommit={onCommit}
          onPush={onPush}
          onRefresh={reloadGit}
        />
        <PlanSection />
        {getGeneralPref('showTodo') && <ProgressSection />}
        <AgentsSection />
      </div>
    </aside>
  )
}

/** 统一处理 git 操作结果：成功 console + 刷新状态；失败 alert。 */
function handleGitResult(
  r: CommitResult,
  opLabel: string,
  reload: () => void
) {
  if (r.success) {
    console.log(`[KCoder] ${opLabel} OK`, r.output ?? '')
    reload()
  } else {
    const msg = r.error || r.output || 'unknown error'
    console.error(`[KCoder] ${opLabel} failed`, msg)
    window.alert(`${opLabel} 失败：${msg}`)
  }
}

// ─── Section 1: Git 工具 ─────────────────────────────────────

function GitSection({
  workspacePath,
  onCommit,
  onPush,
  onRefresh
}: {
  workspacePath: string | null
  onCommit: () => void
  onPush: () => void
  onRefresh: () => void
}) {
  const { t } = useI18n()
  const enginePort = useAppStore((s) => s.enginePort)
  const engineStatus = useAppStore((s) => s.engineStatus)
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)

  const load = useCallback(() => {
    if (!workspacePath || engineStatus !== 'connected') {
      setStatus(null)
      return
    }
    const api = getEngineAPI(enginePort)
    api
      .getWorkspaceStatus(workspacePath)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [workspacePath, enginePort, engineStatus])

  useEffect(() => {
    load()
    // 30s 自动轮询兜底（fs watcher 缺失场景的妥协）
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  // 监听 commit/push 后的强制刷新
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('kcoder:reload-workspace-status', handler)
    return () => window.removeEventListener('kcoder:reload-workspace-status', handler)
  }, [load])

  const dirty = !!status?.isDirty
  const additions = status?.additions ?? 0
  const deletions = status?.deletions ?? 0
  const branchLabel = status?.branch ?? '—'

  return (
    <Section
      icon={<GitIcon />}
      title={t('panel.sectionGit')}
      rightSlot={
        workspacePath && status?.isGitRepository ? (
          <div className="flex items-center gap-1 -mr-1">
            <IconBtn title={t('panel.refresh')} onClick={onRefresh}>
              <RefreshIcon />
            </IconBtn>
            <IconBtn
              title={t('panel.commit')}
              disabled={!dirty}
              onClick={onCommit}
            >
              <CommitIcon />
            </IconBtn>
            <IconBtn title={t('panel.push')} onClick={onPush}>
              <PushIcon />
            </IconBtn>
          </div>
        ) : null
      }
    >
      {!workspacePath ? (
        <Row label={t('panel.envDir')} value="—" />
      ) : !status ? (
        <Row label={t('panel.envBranch')} value="…" />
      ) : !status.isGitRepository ? (
        <Row label={t('panel.envDir')} value={t('panel.notGitRepo')} />
      ) : (
        <>
          {/* 变更数：+/- badge 风格 */}
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-[11px] text-text-muted">{t('panel.changes')}</span>
            {dirty ? (
              <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums">
                <span className="text-success">+{additions}</span>
                <span className="text-danger">−{deletions}</span>
              </span>
            ) : (
              <span className="text-xs text-text-muted">{t('panel.workingTreeClean')}</span>
            )}
          </div>
          {/* 分支：下拉箭头（视觉指示可切换，KCoder 当前未提供切换功能） */}
          <div className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-[11px] text-text-muted">{t('panel.envBranch')}</span>
            <span className="inline-flex items-center gap-1 text-xs font-mono">
              <BranchIcon />
              {branchLabel}
            </span>
          </div>
        </>
      )}
    </Section>
  )
}

// ─── Section 2: 计划 ──────────────────────────────────────────

function PlanSection() {
  const { t } = useI18n()
  const { threadGoal } = useAppStore()

  return (
    <Section icon={<PlanIcon />} title={t('panel.sectionPlan')}>
      {!threadGoal ? (
        <EmptyHint text={t('panel.planEmpty')} />
      ) : (
        <p className="text-xs text-text-primary leading-relaxed">
          {threadGoal.objective}
        </p>
      )}
    </Section>
  )
}

// ─── Section 3: 进度 ──────────────────────────────────────────

function ProgressSection() {
  const { t } = useI18n()
  const { threadTodos } = useAppStore()
  const todos = threadTodos?.items ?? []
  const doneCount = todos.filter((todo) => todo.status === 'completed').length
  const total = todos.length

  return (
    <Section
      icon={<ProgressIcon />}
      title={t('panel.sectionProgress')}
      rightSlot={
        total > 0 ? (
          <span className="text-[11px] text-text-muted tabular-nums">
            <span className={doneCount === total ? 'text-success' : 'text-text-primary'}>
              {doneCount}
            </span>
            <span>/{total}</span>
          </span>
        ) : null
      }
    >
      {total === 0 ? (
        <EmptyHint text={t('panel.progressEmpty')} />
      ) : (
        <div className="space-y-1.5">
          <p className="text-[11px] text-text-muted">{t('panel.progressDone').replace('{n}', String(doneCount))}</p>
          {/* todo checklist（按状态分组：completed 在前，in_progress 中间，pending 最后） */}
          <div className="space-y-1">
            {[...todos]
              .sort((a, b) => {
                const order = { completed: 0, in_progress: 1, pending: 2 } as const
                return order[a.status] - order[b.status]
              })
              .map((todo) => (
                <div key={todo.id} className="flex items-start gap-2 text-xs">
                  <TodoCheckbox status={todo.status} />
                  <span
                    className={`leading-relaxed flex-1 ${
                      todo.status === 'completed'
                        ? 'text-text-muted'
                        : todo.status === 'in_progress'
                          ? 'text-text-primary'
                          : 'text-text-secondary'
                    }`}
                  >
                    {todo.content}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Section>
  )
}

// ─── Section 4: 智能体 ────────────────────────────────────────
//
// 数据源：当前 thread 的 toolCalls 里 name === 'task' 的调用（QiLin 用 `task`
// 工具把工作委派给 subagent）。动态展示「本次任务实际调用了哪些子代理」，
// 而非 /v1/sub-agents 的全量内置配置列表。

interface TaskInvocation {
  callId: string
  subagentType: string
  description?: string
  status: 'running' | 'completed' | 'failed'
}

function AgentsSection() {
  const { t } = useI18n()
  const messagesV2 = useAppStore((s) => s.messages_v2)

  // 从所有 assistant turn 的 toolCalls 里筛出 task 调用，按 callId 去重
  //（保留首次出现，后续 tool_call_finished 会更新 status）。
  const tasks = useMemo<TaskInvocation[]>(() => {
    const seen = new Map<string, TaskInvocation>()
    for (const msg of messagesV2) {
      if (msg.role !== 'assistant') continue
      for (const tc of msg.toolCalls ?? []) {
        if (tc.name !== 'task') continue
        const args = (tc.args ?? {}) as { subagent_type?: string; description?: string }
        const subagentType = args.subagent_type ?? 'subagent'
        const description = args.description
        const existing = seen.get(tc.id)
        if (!existing) {
          seen.set(tc.id, {
            callId: tc.id,
            subagentType,
            description,
            status: tc.status
          })
        } else if (existing.status !== tc.status) {
          // tool_call_finished 更新状态后，用最新 status 覆盖
          seen.set(tc.id, { ...existing, status: tc.status })
        }
      }
    }
    return Array.from(seen.values())
  }, [messagesV2])

  return (
    <Section icon={<AgentsIcon />} title={t('panel.sectionAgents')}>
      {tasks.length === 0 ? (
        <EmptyHint text={t('panel.agentsEmpty')} />
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <AgentItem key={task.callId} task={task} />
          ))}
        </ul>
      )}
    </Section>
  )
}

function AgentItem({ task }: { task: TaskInvocation }) {
  return (
    <li className="rounded-md border border-border-subtle bg-bg-hover/40 px-2.5 py-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            task.status === 'running'
              ? 'bg-blue-400 animate-pulse'
              : task.status === 'failed'
                ? 'bg-red-400'
                : 'bg-green-400'
          }`}
        />
        <span className="text-xs font-medium text-text-primary truncate">
          {task.subagentType}
        </span>
      </div>
      {task.description && (
        <p className="text-[11px] text-text-muted leading-relaxed mt-0.5 line-clamp-2">
          {task.description}
        </p>
      )}
    </li>
  )
}

// ─── 通用组件 ────────────────────────────────────────────────

function Section({
  icon,
  title,
  rightSlot,
  children
}: {
  icon: React.ReactNode
  title: string
  rightSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="px-4 py-3 border-t border-border-subtle first:border-t-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-muted [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
        <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
          {title}
        </h3>
        {rightSlot && <div className="ml-auto">{rightSlot}</div>}
      </div>
      <div className="text-xs">{children}</div>
    </section>
  )
}

function Row({
  label,
  value,
  mono,
  valueClass
}: {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span
        title={value}
        className={`truncate text-xs ${mono ? 'font-mono' : ''} ${valueClass ?? 'text-text-primary'}`}
      >
        {value}
      </span>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-text-muted italic">{text}</p>
}

function IconBtn({
  title,
  disabled,
  onClick,
  children
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
    >
      {children}
    </button>
  )
}

function TodoCheckbox({ status }: { status: 'pending' | 'in_progress' | 'completed' }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border border-success bg-success flex items-center justify-center">
        <svg
          className="w-2.5 h-2.5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  if (status === 'in_progress') {
    return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border-2 border-info animate-pulse" />
  }
  return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border border-[#52525b]" />
}

// ─── 图标 ─────────────────────────────────────────────────────

function GitIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 3v12m0 0l-3-3m3 3l3-3m6-9a9 9 0 110 18 9 9 0 010-18z"
        transform="matrix(-1 0 0 1 24 0)"
      />
    </svg>
  )
}

function PlanIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function ProgressIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  )
}

function AgentsIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6.75a3 3 0 11-5.196 1.706M15.75 6.75v.008M15.75 6.75h.008v.008h-.008V6.75zm-3 6.75a3 3 0 11-5.196 1.706M12.75 13.5v.008M12.75 13.5h.008v.008h-.008V13.5z"
      />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg
      className="w-3 h-3 text-text-muted"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
      />
    </svg>
  )
}

function CommitIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

function PushIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  )
}