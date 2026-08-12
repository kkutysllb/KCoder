// InfoPanel — 浮动信息面板（参考 KStock 三段堆叠式布局）。
//
// 风格：三个 section 上下排列，每段 = 标题(icon + label) + 内容 + 段间分隔线
//   1. Git 工具：当前分支 + 变更统计（+/-）+ HEAD 短 sha
//   2. 计划：thread goal（线程目标描述）
//   3. 进度：todos 完成计数 + 进度条 + 已完成项 checklist
//
// 展开策略保留：auto（有执行数据时自动展开）/ manual（用户手动 toggle）

import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type WorkspaceStatus } from '../../services/engine-api'
import { getGeneralPref } from '../../lib/generalPrefs'

export function InfoPanel() {
  const { t } = useI18n()
  const {
    panelOpen,
    setPanelOpen,
    threadId, enginePort, engineStatus,
    workspacePath, selectedBranch,
    setThreadGoal, setThreadTodos
  } = useAppStore()

  // 面板开合完全由用户控制（右上角 ℹ️ 按钮 / 面板内折叠按钮）。
  // 移除点击外部遮罩自动折叠 + auto 策略强制展开——两者都违背用户意图。

  // 线程切换时加载 goal + todos
  useEffect(() => {
    if (!threadId || engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getThreadGoal(threadId).then(setThreadGoal).catch(() => {})
    api.getThreadTodos(threadId).then(setThreadTodos).catch(() => {})
  }, [threadId, enginePort, engineStatus, setThreadGoal, setThreadTodos])

  if (!panelOpen) return null

  return (
    <aside className="fixed top-12 right-3 z-50 w-[340px] max-h-[calc(100vh-60px)] flex flex-col rounded-xl border border-[rgba(255,255,255,0.13)] bg-[rgba(30,33,36,0.94)] shadow-2xl overflow-hidden backdrop-blur-md">
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

        {/* 内容：三个 section 上下排列，scroll */}
        <div className="flex-1 overflow-y-auto pb-3">
          <GitSection workspacePath={workspacePath} selectedBranch={selectedBranch} />
          <PlanSection />
          {getGeneralPref('showTodo') && <ProgressSection />}
        </div>
      </aside>
  )
}

// ─── Section 1: Git 工具 ─────────────────────────────────────

function GitSection({
  workspacePath,
  selectedBranch
}: {
  workspacePath: string | null
  selectedBranch: string | null
}) {
  const { t } = useI18n()
  const enginePort = useAppStore((s) => s.enginePort)
  const engineStatus = useAppStore((s) => s.engineStatus)
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)

  useEffect(() => {
    if (!workspacePath || engineStatus !== 'connected') {
      setStatus(null)
      return
    }
    const api = getEngineAPI(enginePort)
    let cancelled = false
    const load = () =>
      api
        .getWorkspaceStatus(workspacePath)
        .then((s) => !cancelled && setStatus(s))
        .catch(() => !cancelled && setStatus(null))
    load()
    // 30s 自动刷新（与 git fs watcher 缺失场景下的妥协）
    const id = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [workspacePath, enginePort, engineStatus])

  return (
    <Section icon={<GitIcon />} title={t('panel.sectionGit')}>
      {!workspacePath ? (
        <Row label={t('panel.envDir')} value="—" />
      ) : !status ? (
        <Row label={t('panel.envBranch')} value="…" />
      ) : !status.isGitRepository ? (
        <Row label={t('panel.envDir')} value={t('panel.notGitRepo')} />
      ) : (
        <>
          <Row
            label={t('panel.envBranch')}
            value={status.branch ?? selectedBranch ?? '—'}
            mono
          />
          {status.headSha && (
            <Row
              label={t('panel.headSha')}
              value={status.headSha}
              mono
            />
          )}
          <Row
            label={t('panel.changes')}
            value={
              status.fileChangeCount == null
                ? '—'
                : status.fileChangeCount === 0
                  ? t('panel.workingTreeClean')
                  : String(status.fileChangeCount)
            }
            valueClass={
              status.isDirty
                ? 'text-[#f59e0b]'
                : status.isDirty === false
                  ? 'text-[#22c55e]'
                  : 'text-text-muted'
            }
          />
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
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
              threadGoal.status === 'active'
                ? 'text-[#22c55e] bg-[#22c55e]/10'
                : threadGoal.status === 'complete'
                  ? 'text-[#3b82f6] bg-[#3b82f6]/10'
                  : threadGoal.status === 'blocked'
                    ? 'text-[#ef4444] bg-[#ef4444]/10'
                    : 'text-text-muted bg-bg-hover'
            }`}>
              {threadGoal.status}
            </span>
          </div>
          <p className="text-xs text-text-primary leading-relaxed">
            {threadGoal.objective}
          </p>
          {(threadGoal.tokenBudget || threadGoal.tokensUsed > 0 || threadGoal.timeUsedSeconds > 0) && (
            <div className="flex gap-3 text-[10px] text-text-muted">
              {(threadGoal.tokenBudget || threadGoal.tokensUsed > 0) && (
                <span>{t('panel.tokens')}: {threadGoal.tokensUsed}{threadGoal.tokenBudget ? `/${threadGoal.tokenBudget}` : ''}</span>
              )}
              {threadGoal.timeUsedSeconds > 0 && (
                <span>{t('panel.time')}: {Math.round(threadGoal.timeUsedSeconds)}s</span>
              )}
            </div>
          )}
        </div>
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
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  return (
    <Section icon={<ProgressIcon />} title={t('panel.sectionProgress')} rightSlot={
      total > 0 ? (
        <span className="text-[11px] text-text-muted tabular-nums">
          <span className={doneCount === total ? 'text-[#22c55e]' : 'text-text-primary'}>{doneCount}</span>
          <span>/{total}</span>
          {pct === 100 && <span className="ml-1 text-[#22c55e]">✓</span>}
        </span>
      ) : null
    }>
      {total === 0 ? (
        <EmptyHint text={t('panel.progressEmpty')} />
      ) : (
        <>
          {/* 进度条 */}
          <div className="h-1 rounded-full bg-bg-hover overflow-hidden mb-2">
            <div
              className={`h-full transition-all ${pct === 100 ? 'bg-[#22c55e]' : 'bg-[#3b82f6]'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
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
                  <span className={`leading-relaxed flex-1 ${
                    todo.status === 'completed'
                      ? 'text-text-muted'
                      : todo.status === 'in_progress'
                        ? 'text-text-primary'
                        : 'text-text-secondary'
                  }`}>
                    {todo.content}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}
    </Section>
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
    <section className="px-4 py-3 border-t border-[rgba(255,255,255,0.06)] first:border-t-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-text-muted [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
        <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{title}</h3>
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

function TodoCheckbox({ status }: { status: 'pending' | 'in_progress' | 'completed' }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border border-[#22c55e] bg-[#22c55e] flex items-center justify-center">
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  if (status === 'in_progress') {
    return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border-2 border-[#3b82f6] animate-pulse" />
  }
  return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border border-[#52525b]" />
}

// ─── 图标 ─────────────────────────────────────────────────────

function GitIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3v12m0 0l-3-3m3 3l3-3m6-9a9 9 0 110 18 9 9 0 010-18z" transform="matrix(-1 0 0 1 24 0)" />
    </svg>
  )
}

function PlanIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function ProgressIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}
