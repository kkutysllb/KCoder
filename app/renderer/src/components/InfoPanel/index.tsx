import { useEffect } from 'react'
import { useAppStore, type PanelTab } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI } from '../../services/engine-api'
import { ExecutionView } from '../ChatPanel/ExecutionView'

/**
 * 浮动信息面板 — 右侧浮动抽屉，聚合：
 * - 执行（ExecutionView：DAG / 委派树）
 * - 计划（线程目标 + 待办列表）
 * - 环境（项目目录 / 分支 / 模型 / 编排模式）
 *
 * 展开策略：manual（手动开关）/ auto（有执行数据时自动展开）
 */
export function InfoPanel() {
  const { t } = useI18n()
  const {
    panelOpen, panelStrategy, panelTab,
    setPanelOpen, setPanelTab,
    threadId, enginePort, engineStatus,
    turnExecution, setThreadGoal, setThreadTodos
  } = useAppStore()

  // auto 策略：有执行投影数据、并行分支或 ROI 时自动展开
  useEffect(() => {
    if (panelStrategy !== 'auto') return
    const hasBranches = Object.keys(useAppStore.getState().branches).length > 0
    const hasRoi = useAppStore.getState().roiSnapshot != null
    if (turnExecution?.available || hasBranches || hasRoi) {
      setPanelOpen(true)
    }
  }, [panelStrategy, turnExecution, setPanelOpen])

  // 线程切换时加载 goal + todos
  useEffect(() => {
    if (!threadId || engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getThreadGoal(threadId).then(setThreadGoal).catch(() => {})
    api.getThreadTodos(threadId).then(setThreadTodos).catch(() => {})
  }, [threadId, enginePort, engineStatus, setThreadGoal, setThreadTodos])

  if (!panelOpen) return null

  return (
    <>
      {/* 点击遮罩折叠（mobile/tablet 行为；桌面端面板可常驻） */}
      <div
        className="fixed inset-0 z-40 bg-black/20 md:bg-transparent"
        onClick={() => setPanelOpen(false)}
      />
      {/* 浮动面板 */}
      <div className="fixed top-12 right-3 bottom-3 z-50 w-[340px] flex flex-col rounded-xl border border-border-custom bg-bg-sidebar shadow-2xl overflow-hidden">
        {/* Header: tabs + close */}
        <div className="flex items-center gap-1 px-2 py-2 border-b border-border-custom shrink-0">
          <PanelTabButton tab="execution" active={panelTab} onClick={setPanelTab} label={t('panel.execution')} icon={<ExecIcon />} />
          <PanelTabButton tab="plan" active={panelTab} onClick={setPanelTab} label={t('panel.plan')} icon={<PlanIcon />} />
          <PanelTabButton tab="env" active={panelTab} onClick={setPanelTab} label={t('panel.env')} icon={<EnvIcon />} />
          <button
            onClick={() => setPanelOpen(false)}
            className="ml-auto p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('panel.collapse')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {panelTab === 'execution' && <ExecutionView />}
          {panelTab === 'plan' && <PlanTab />}
          {panelTab === 'env' && <EnvTab />}
        </div>
      </div>
    </>
  )
}

// ============ Tab 按钮 ============

function PanelTabButton({ tab, active, onClick, label, icon }: {
  tab: PanelTab
  active: PanelTab
  onClick: (t: PanelTab) => void
  label: string
  icon: React.ReactNode
}) {
  const isActive = active === tab
  return (
    <button
      onClick={() => onClick(tab)}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        isActive ? 'bg-bg-active text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ============ 计划 Tab（目标 + 待办）============

function PlanTab() {
  const { t } = useI18n()
  const { threadGoal, threadTodos } = useAppStore()

  if (!threadGoal && (!threadTodos || threadTodos.items.length === 0)) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-text-muted p-4 text-center">
        {t('panel.planEmpty')}
      </div>
    )
  }

  const todos = threadTodos?.items ?? []
  const doneCount = todos.filter((t) => t.status === 'completed').length

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-4">
      {/* 目标 */}
      {threadGoal && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('panel.objective')}</h3>
            <GoalStatusBadge status={threadGoal.status} />
          </div>
          <p className="text-xs text-text-primary leading-relaxed bg-bg-input rounded-lg px-3 py-2 border border-border-subtle">
            {threadGoal.objective}
          </p>
          {/* 用量 */}
          <div className="flex gap-3 mt-1.5 text-[10px] text-text-muted">
            {threadGoal.tokenBudget && (
              <span>{t('panel.tokens')}: {threadGoal.tokensUsed}/{threadGoal.tokenBudget}</span>
            )}
            {!threadGoal.tokenBudget && threadGoal.tokensUsed > 0 && (
              <span>{t('panel.tokens')}: {threadGoal.tokensUsed}</span>
            )}
            {threadGoal.timeUsedSeconds > 0 && (
              <span>{t('panel.time')}: {Math.round(threadGoal.timeUsedSeconds)}s</span>
            )}
          </div>
        </div>
      )}

      {/* 待办 */}
      {todos.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wide">{t('panel.todos')}</h3>
            <span className="text-[10px] text-text-muted">{doneCount}/{todos.length}</span>
            {/* 进度条 */}
            <div className="flex-1 h-1 rounded-full bg-bg-hover overflow-hidden">
              <div
                className="h-full bg-[#22c55e] transition-all"
                style={{ width: `${todos.length > 0 ? (doneCount / todos.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="space-y-1">
            {todos.map((todo) => (
              <div key={todo.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-bg-hover/50 transition-colors">
                <TodoCheckbox status={todo.status} />
                <span className={`text-xs leading-relaxed flex-1 ${
                  todo.status === 'completed' ? 'text-text-muted line-through' : 'text-text-secondary'
                }`}>
                  {todo.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GoalStatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'text-[#22c55e] bg-[#22c55e]/10'
    : status === 'complete' ? 'text-[#3b82f6] bg-[#3b82f6]/10'
    : status === 'blocked' ? 'text-[#ef4444] bg-[#ef4444]/10'
    : 'text-text-muted bg-bg-hover'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{status}</span>
}

function TodoCheckbox({ status }: { status: 'pending' | 'in_progress' | 'completed' }) {
  if (status === 'completed') {
    return (
      <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded border border-[#22c55e] bg-[#22c55e] flex items-center justify-center">
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    )
  }
  if (status === 'in_progress') {
    return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded border-2 border-[#3b82f6] animate-pulse" />
  }
  return <span className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded border border-[#52525b]" />
}

// ============ 环境 Tab ============

function EnvTab() {
  const { t } = useI18n()
  const { workspacePath, selectedBranch, selectedModel, orchestrationPreference } = useAppStore()

  const rows = [
    { label: t('panel.envDir'), value: workspacePath },
    { label: t('panel.envBranch'), value: selectedBranch },
    { label: t('panel.envModel'), value: selectedModel },
    { label: t('panel.envOrch'), value: orchestrationPreference === 'team' ? t('orchestration.team') : t('orchestration.standard') }
  ]

  return (
    <div className="h-full overflow-y-auto px-4 py-3 space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border border-border-subtle bg-bg-input px-3 py-2">
          <p className="text-[10px] text-text-muted uppercase tracking-wide">{row.label}</p>
          <p className="text-xs text-text-primary font-mono mt-0.5 truncate" title={row.value ?? ''}>
            {row.value || '—'}
          </p>
        </div>
      ))}
    </div>
  )
}

// ============ 图标 ============

function ExecIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25h4.5M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25h-4.5m4.5 0h1.5m-1.5 0v-2.625a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H9.75v.75h.75v-.75zm0 0V9m0 0H9.75M10.5 9h.75" />
    </svg>
  )
}

function PlanIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function EnvIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}
