import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type MonthFilter,
  type RuntimeConfig,
  type TokenBudgetConfig,
  type TokenUsageConfig,
  type TokenUsageStats,
  type TokenUsageTimeseriesItem
} from '../../services/engine-api'
import { RuntimeConfigCard } from './RuntimeConfigCard'

// ============ Token Usage & Budget Settings Page ============

const DEFAULT_BUDGET: TokenBudgetConfig = {
  enabled: false,
  max_tokens: 200000,
  max_input_tokens: null,
  max_output_tokens: null,
  warn_threshold: 0.8,
  hard_stop_threshold: 1.0,
  per_agent: {}
}

export function TokenUsageSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [runtimeCfg, setRuntimeCfg] = useState<RuntimeConfig | null>(null)
  const [cfgLoading, setCfgLoading] = useState(true)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [refreshEffectedAt, setRefreshEffectedAt] = useState(0)

  const loadRuntimeConfig = useCallback(async () => {
    if (engineStatus !== 'connected') { setCfgLoading(false); return }
    setCfgLoading(true)
    try {
      const api = getEngineAPI(enginePort)
      const cfg = await api.getRuntimeConfig()
      setRuntimeCfg(cfg)
    } catch (e) {
      console.error('[TokenUsage] Failed to load runtime config:', e)
    } finally {
      setCfgLoading(false)
    }
  }, [enginePort, engineStatus])

  useEffect(() => {
    loadRuntimeConfig()
  }, [loadRuntimeConfig])

  // 保存后轮询刷新生效值（QiLin 热重载 1-2s 内生效）
  useEffect(() => {
    if (refreshEffectedAt === 0) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 800))
        if (cancelled) return
        try {
          const api = getEngineAPI(enginePort)
          const cfg = await api.getRuntimeConfig()
          if (!cancelled) setRuntimeCfg(cfg)
          return
        } catch {
          // 继续重试
        }
      }
    }
    poll()
    return () => { cancelled = true }
  }, [refreshEffectedAt, enginePort])

  const handleSaveSection = useCallback(
    async (section: 'token_usage' | 'token_budget', value: Record<string, unknown>): Promise<void> => {
      setCfgSaving(true)
      try {
        const api = getEngineAPI(enginePort)
        const result = await api.updateRuntimeConfigSection(section, value)
        // 立即更新本地（optimistic），轮询会拿回热重载后的值
        const key = section === 'token_usage' ? 'tokenUsage' : 'tokenBudget'
        setRuntimeCfg((prev) => prev ? { ...prev, [key]: result as never } : prev)
        setRefreshEffectedAt(Date.now())
      } finally {
        setCfgSaving(false)
      }
    },
    [enginePort]
  )

  // 合并当前 token_budget 生效值（保留 per_agent 等未编辑字段）
  const handleSaveBudget = useCallback(
    async (value: Record<string, unknown>): Promise<void> => {
      const merged = {
        ...DEFAULT_BUDGET,
        ...(runtimeCfg?.tokenBudget as unknown as Record<string, unknown> ?? {}),
        ...value,
      }
      await handleSaveSection('token_budget', merged)
    },
    [handleSaveSection, runtimeCfg]
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t('settings.tokenUsage.title')}</h2>
          <p className="text-xs text-text-muted mt-1">{t('settings.tokenUsage.desc')}</p>
        </div>

        {cfgLoading ? (
          <div className="text-center py-6 text-xs text-text-muted">{t('common.loading')}</div>
        ) : runtimeCfg ? (
          <>
            {/* Token 使用统计开关 */}
            <RuntimeConfigCard
              title={t('settings.tokenUsage.usageTitle')}
              description={t('settings.tokenUsage.usageDesc')}
              fields={[
                {
                  key: 'enabled',
                  label: t('settings.tokenUsage.usageEnabled'),
                  type: 'boolean',
                  hint: t('settings.tokenUsage.usageEnabledDesc')
                }
              ]}
              initialValue={runtimeCfg.tokenUsage as unknown as Record<string, unknown>}
              onSave={(v) => handleSaveSection('token_usage', v)}
              saving={cfgSaving}
            />

            {/* Token 预算限制 */}
            <TokenBudgetForm
              initialValue={{
                ...DEFAULT_BUDGET,
                ...(runtimeCfg.tokenBudget as unknown as Record<string, unknown> ?? {})
              } as TokenBudgetConfig}
              saving={cfgSaving}
              onSave={handleSaveBudget}
            />
          </>
        ) : null}

        {/* 图表化用量 Dashboard */}
        <TokenUsageDashboard engineConnected={engineStatus === 'connected'} enginePort={enginePort} />
      </div>
    </div>
  )
}

// ============ Token Budget Form ============

function TokenBudgetForm({
  initialValue,
  saving,
  onSave
}: {
  initialValue: TokenBudgetConfig
  saving: boolean
  onSave: (value: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useI18n()
  const [local, setLocal] = useState<TokenBudgetConfig>(initialValue)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLocal(initialValue)
    setError(null)
  }, [initialValue])

  const dirty = JSON.stringify(local) !== JSON.stringify(initialValue)
  const disabled = saving || !local.enabled

  const update = <K extends keyof TokenBudgetConfig>(key: K, value: TokenBudgetConfig[K]): void => {
    setLocal((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  const handleSave = async (): Promise<void> => {
    if (local.hard_stop_threshold < local.warn_threshold) {
      setError(t('settings.tokenUsage.thresholdError'))
      return
    }
    try {
      await onSave(local as unknown as Record<string, unknown>)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-xl border border-border-custom bg-bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{t('settings.tokenUsage.budgetTitle')}</h3>
        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{t('settings.tokenUsage.budgetDesc')}</p>
      </div>

      {/* 总开关 */}
      <div className="flex items-center justify-between gap-3 py-0.5">
        <label className="flex-1">
          <span className="text-xs text-text-primary">{t('settings.tokenUsage.budgetEnabled')}</span>
          <p className="text-[10px] text-text-muted mt-0.5">{t('settings.tokenUsage.budgetEnabledDesc')}</p>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={local.enabled}
          onClick={() => update('enabled', !local.enabled)}
          disabled={saving}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${local.enabled ? 'bg-white' : 'bg-bg-hover'} ${saving ? 'opacity-40' : ''}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${local.enabled ? 'translate-x-4 bg-black' : 'bg-text-muted'}`}
          />
        </button>
      </div>

      {/* 总 Token 上限 */}
      <NumberField
        label={t('settings.tokenUsage.maxTokens')}
        hint={t('settings.tokenUsage.maxTokensHint')}
        value={local.max_tokens}
        min={1000}
        disabled={disabled}
        onChange={(v) => update('max_tokens', v)}
      />

      {/* 输入/输出独立上限（可空） */}
      <div className="grid grid-cols-2 gap-3">
        <NullableNumberField
          label={t('settings.tokenUsage.maxInput')}
          value={local.max_input_tokens}
          min={1}
          placeholder={t('settings.tokenUsage.nullableHint')}
          disabled={disabled}
          onChange={(v) => update('max_input_tokens', v)}
        />
        <NullableNumberField
          label={t('settings.tokenUsage.maxOutput')}
          value={local.max_output_tokens}
          min={1}
          placeholder={t('settings.tokenUsage.nullableHint')}
          disabled={disabled}
          onChange={(v) => update('max_output_tokens', v)}
        />
      </div>

      {/* 阈值 */}
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={t('settings.tokenUsage.warnThreshold')}
          hint={t('settings.tokenUsage.warnThresholdHint')}
          value={local.warn_threshold}
          min={0}
          max={1}
          step={0.05}
          disabled={disabled}
          onChange={(v) => update('warn_threshold', v)}
        />
        <NumberField
          label={t('settings.tokenUsage.hardStop')}
          hint={t('settings.tokenUsage.hardStopHint')}
          value={local.hard_stop_threshold}
          min={0}
          max={1}
          step={0.05}
          disabled={disabled}
          onChange={(v) => update('hard_stop_threshold', v)}
        />
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {dirty && (
          <button
            onClick={() => { setLocal(initialValue); setError(null) }}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs text-text-muted hover:bg-bg-hover transition-colors disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? t('settings.memory.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}

// ============ Form field helpers ============

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="py-0.5">
      <label className="block text-xs text-text-primary">{label}</label>
      {hint && <p className="text-[10px] text-text-muted mb-1">{hint}</p>}
      <input
        type="number"
        value={Number.isNaN(value) ? '' : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isNaN(n) ? 0 : n)
        }}
        className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong disabled:opacity-40"
      />
    </div>
  )
}

/** 可清空的数字输入：留空 → null（不单独限制）。 */
function NullableNumberField({
  label,
  value,
  min,
  placeholder,
  disabled,
  onChange
}: {
  label: string
  value: number | null
  min?: number
  placeholder?: string
  disabled: boolean
  onChange: (v: number | null) => void
}) {
  return (
    <div className="py-0.5">
      <label className="block text-xs text-text-primary">{label}</label>
      <input
        type="number"
        value={value == null ? '' : value}
        min={min}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (!raw) { onChange(null); return }
          const n = Number(raw)
          onChange(Number.isNaN(n) ? null : n)
        }}
        className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong disabled:opacity-40"
      />
    </div>
  )
}

// ============ Token Usage Dashboard (charts) ============

/**
 * Wrap Recharts ResponsiveContainer so the chart is only mounted after the
 * parent has been laid out. This avoids the v3 `width(-1)/height(-1)` warning
 * that ResizeObserver emits on the very first frame.
 */
function ResponsiveChart({ children }: { children: React.ReactElement }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])
  if (!ready) {
    return <div className="h-full w-full" aria-hidden />
  }
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={50} minWidth={0}>
      {children}
    </ResponsiveContainer>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'data'; stats: TokenUsageStats; timeseries: TokenUsageTimeseriesItem[] }

interface TsDataRow {
  date: string
  run_count: number
  llm_call_count: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
}

const MODEL_COLORS = [
  '#4d6bfe', '#06b6d4', '#f59e0b', '#10b981',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f97316', '#64748b'
]

const CALLER_CONFIG = [
  { key: 'lead_agent' as const, color: '#8b5cf6', bg: 'bg-[#8b5cf6]/10', text: 'text-[#8b5cf6]' },
  { key: 'subagent' as const, color: '#06b6d4', bg: 'bg-[#06b6d4]/10', text: 'text-[#06b6d4]' },
  { key: 'middleware' as const, color: '#f59e0b', bg: 'bg-amber/10', text: 'text-amber' }
]

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtPct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%'
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

/** 当前北京时间所在月份。 */
function getCurrentBeijingMonth(): MonthFilter {
  const now = new Date()
  const bj = new Date(now.getTime() + 8 * 3600_000)
  return { year: bj.getUTCFullYear(), month: bj.getUTCMonth() + 1 }
}

/** 把按日期排序的时间序列补齐成连续日期（缺失日补 0）。 */
function fillDateRange(items: TokenUsageTimeseriesItem[]): TsDataRow[] {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (!first || !last) return []
  const minDate = new Date(first.date)
  const maxDate = new Date(last.date)
  const dateMap = new Map(sorted.map((d) => [d.date, d]))

  const result: TsDataRow[] = []
  const cur = new Date(minDate)
  while (cur <= maxDate) {
    const key = cur.toISOString().slice(0, 10)
    const existing = dateMap.get(key)
    result.push({
      date: `${cur.getMonth() + 1}-${cur.getDate()}`,
      run_count: existing?.run_count ?? 0,
      llm_call_count: existing?.llm_call_count ?? 0,
      total_tokens: existing?.total_tokens ?? 0,
      input_tokens: existing?.input_tokens ?? 0,
      output_tokens: existing?.output_tokens ?? 0
    })
    cur.setDate(cur.getDate() + 1)
  }
  return result
}

function formatShortDate(label: React.ReactNode): string {
  if (typeof label !== 'string') return ''
  const parts = label.split('-')
  if (parts.length < 2) return label
  return `${parseInt(parts[0] ?? '0')}-${parseInt(parts[1] ?? '0')}`
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  accent
}: {
  label: string
  value: string
  sub?: string
  icon: ReactNode
  accent: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-custom bg-bg-surface px-4 py-3 min-w-[170px] flex-1">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] text-text-muted truncate">{label}</div>
        <div className="text-base font-bold font-mono tracking-tight text-text-primary">{value}</div>
        {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

// ============ Cache Hit Section ============

function CacheHitSection({
  totalCacheRead,
  totalInput,
  byModel
}: {
  totalCacheRead: number
  totalInput: number
  byModel: Record<string, { tokens: number; input_tokens: number; cache_read_tokens: number }>
}) {
  const { t } = useI18n()
  const hitRate = totalInput > 0 ? (totalCacheRead / totalInput) * 100 : 0
  const cacheMiss = Math.max(totalInput - totalCacheRead, 0)

  const modelEntries = Object.entries(byModel)
    .filter(([, d]) => d.cache_read_tokens > 0)
    .sort(([, a], [, b]) => b.cache_read_tokens - a.cache_read_tokens)
    .slice(0, 8)

  return (
    <div className="rounded-xl border border-border-custom bg-bg-surface p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal/10">
          <svg className="w-3.5 h-3.5 text-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        </span>
        {t('settings.tokenUsage.cacheHitTitle')}
      </h3>

      {/* 汇总行 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label={t('settings.tokenUsage.cacheHitTokens')} value={fmtNum(totalCacheRead)} tone="text-teal" />
        <StatBox label={t('settings.tokenUsage.cacheHitRate')} value={`${hitRate.toFixed(1)}%`} />
        <StatBox label={t('settings.tokenUsage.cacheMiss')} value={fmtNum(cacheMiss)} />
        <StatBox label={t('settings.tokenUsage.cacheSavedHint')} value={fmtNum(totalCacheRead)} tone="text-teal" />
      </div>

      {/* 命中率进度条 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>{t('settings.tokenUsage.cacheHitRate')}</span>
          <span className="font-mono">{fmtNum(totalCacheRead)} / {fmtNum(totalInput)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-hover">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal to-[#14b8a6] transition-all"
            style={{ width: `${Math.min(hitRate, 100)}%` }}
          />
        </div>
      </div>

      {/* 按模型细分 */}
      {modelEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] text-text-muted">{t('settings.tokenUsage.byModel')}</div>
          {modelEntries.map(([model, data], idx) => {
            const modelHitRate = data.input_tokens > 0 ? (data.cache_read_tokens / data.input_tokens) * 100 : 0
            const color = MODEL_COLORS[idx % MODEL_COLORS.length]
            return (
              <div key={model} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-text-muted min-w-0 truncate flex-1">{model}</span>
                <span className="text-[10px] font-mono text-text-muted shrink-0">{fmtNum(data.cache_read_tokens)}</span>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-bg-hover shrink-0">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(modelHitRate, 100)}%`, backgroundColor: color }} />
                </div>
                <span className="text-[10px] font-mono shrink-0 w-10 text-right">{modelHitRate.toFixed(0)}%</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border-custom bg-bg-input px-3 py-2.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={`text-base font-bold font-mono ${tone ?? 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

// ============ Per-Model Section ============

function ModelSection({
  model,
  colorIdx,
  tsData,
  inputTokens,
  outputTokens,
  totalTokens,
  totalCalls,
  totalLlmCalls,
  cacheReadTokens
}: {
  model: string
  colorIdx: number
  tsData: TsDataRow[]
  inputTokens: number
  outputTokens: number
  totalTokens: number
  totalCalls: number
  totalLlmCalls: number
  cacheReadTokens: number
}) {
  const { t } = useI18n()
  const color = MODEL_COLORS[colorIdx % MODEL_COLORS.length]

  const labelInterval = tsData.length > 15
    ? Math.ceil(tsData.length / 12)
    : tsData.length > 7
      ? 1
      : 0

  const tickAngle = tsData.length > 10 ? -40 : 0
  const bottomMargin = tickAngle !== 0 ? 24 : 0

  const chartTickStyle = { fontSize: 10, fill: 'var(--color-text-muted)' }
  const tiltedTickStyle = tickAngle !== 0
    ? { ...chartTickStyle, angle: tickAngle, textAnchor: 'end' as const }
    : chartTickStyle
  const tooltipStyle = {
    backgroundColor: 'var(--color-bg-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'var(--color-text-primary)'
  }

  return (
    <div className="rounded-xl border border-border-custom bg-bg-surface p-4">
      {/* Model header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="text-[13px] font-semibold text-text-primary">{model}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
          <span>Tokens: <span className="font-mono font-medium text-text-primary">{fmtNum(totalTokens)}</span></span>
          <span>{t('settings.tokenUsage.runsColumn')}: <span className="font-mono font-medium text-text-primary">{fmtNum(totalCalls)}</span></span>
          <span>API: <span className="font-mono font-medium text-text-primary">{fmtNum(totalLlmCalls)}</span></span>
          <span className="hidden sm:inline">{t('settings.tokenUsage.input')}: <span className="font-mono font-medium text-text-primary">{fmtNum(inputTokens)}</span></span>
          <span className="hidden sm:inline">{t('settings.tokenUsage.output')}: <span className="font-mono font-medium text-text-primary">{fmtNum(outputTokens)}</span></span>
          {cacheReadTokens > 0 && (
            <span className="hidden sm:inline text-teal">
              {t('settings.tokenUsage.cacheHit')}: <span className="font-mono font-medium">{fmtNum(cacheReadTokens)}</span>
              <span className="text-text-muted ml-0.5">({fmtPct(cacheReadTokens, inputTokens)})</span>
            </span>
          )}
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* API calls & task runs dual-axis chart */}
        <div className="min-w-0">
          <div className="text-[10px] text-text-muted mb-1">API {t('settings.tokenUsage.runsColumn')}</div>
          {tsData.length > 0 ? (
            <div className="h-[200px] w-full">
              <ResponsiveChart>
                <ComposedChart data={tsData} margin={{ top: 4, right: 8, bottom: bottomMargin, left: 0 }}>
                  <defs>
                    <linearGradient id={`area-calls-${colorIdx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`area-runs-${colorIdx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={tiltedTickStyle}
                    axisLine={false}
                    tickLine={false}
                    interval={labelInterval}
                    tickFormatter={formatShortDate}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ ...chartTickStyle, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={(v: number) => fmtNum(v)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ ...chartTickStyle, fontSize: 10, fill: '#10b981' }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    tickFormatter={(v: number) => fmtNum(v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: 'var(--color-text-primary)' }}
                    labelFormatter={formatShortDate}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 2 }} iconSize={8} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="llm_call_count"
                    name="API"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill={`url(#area-calls-${colorIdx})`}
                    dot={false}
                    activeDot={{ r: 4, fill: '#f59e0b' }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="run_count"
                    name={t('settings.tokenUsage.runsColumn')}
                    stroke="#10b981"
                    strokeWidth={2}
                    fill={`url(#area-runs-${colorIdx})`}
                    dot={false}
                    activeDot={{ r: 4, fill: '#10b981' }}
                  />
                </ComposedChart>
              </ResponsiveChart>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-text-muted text-[10px]">
              {t('settings.tokenUsage.noData')}
            </div>
          )}
        </div>

        {/* Input/Output stacked bar chart */}
        <div className="min-w-0">
          <div className="text-[10px] text-text-muted mb-1">
            {t('settings.tokenUsage.input')}/{t('settings.tokenUsage.output')}
          </div>
          {tsData.length > 0 ? (
            <div className="h-[200px] w-full">
              <ResponsiveChart>
                <BarChart data={tsData} margin={{ top: 4, right: 8, bottom: bottomMargin, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={tiltedTickStyle}
                    axisLine={false}
                    tickLine={false}
                    interval={labelInterval}
                    tickFormatter={formatShortDate}
                  />
                  <YAxis
                    tick={{ ...chartTickStyle, fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                    tickFormatter={(v: number) => fmtNum(v)}
                  />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: 'var(--color-text-primary)' }}
                    labelFormatter={formatShortDate}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 2 }} iconSize={8} />
                  <Bar dataKey="input_tokens" name={t('settings.tokenUsage.input')} stackId="io" fill="#6366f1" maxBarSize={16} />
                  <Bar dataKey="output_tokens" name={t('settings.tokenUsage.output')} stackId="io" fill="#06b6d4" maxBarSize={16} />
                </BarChart>
              </ResponsiveChart>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-text-muted text-[10px]">
              {t('settings.tokenUsage.noData')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Main Dashboard ============

function TokenUsageDashboard({ engineConnected, enginePort }: { engineConnected: boolean; enginePort: number }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<MonthFilter>(getCurrentBeijingMonth)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [monthsOpen, setMonthsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const monthOptions = useMemo(() => {
    const opts: { y: number; m: number; label: string }[] = []
    const d = new Date()
    for (let i = 0; i < 12; i++) {
      const dt = new Date(d.getFullYear(), d.getMonth() - i, 1)
      const label = `${dt.getFullYear()} - ${dt.getMonth() + 1}月`
      if (!opts.some((o) => o.y === dt.getFullYear() && o.m === dt.getMonth() + 1)) {
        opts.push({ y: dt.getFullYear(), m: dt.getMonth() + 1, label })
      }
    }
    return opts
  }, [])

  const filterLabel = `${filter.year} - ${filter.month}月`
  const currentBjMonth = getCurrentBeijingMonth()

  const load = useCallback(async (silent = false) => {
    if (!engineConnected) {
      setLoadState({ status: 'error', message: t('settings.tokenUsage.engineOffline') })
      return
    }
    if (!silent) setLoadState({ status: 'loading' })
    else setRefreshing(true)
    try {
      const api = getEngineAPI(enginePort)
      const [stats, timeseries] = await Promise.all([
        api.getTokenUsageStats(filter),
        api.getTokenUsageTimeseries(31, filter)
      ])
      if (stats.total_runs === 0) {
        setLoadState({ status: 'empty' })
      } else {
        setLoadState({ status: 'data', stats, timeseries })
      }
    } catch (err) {
      if (!silent) {
        setLoadState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      setRefreshing(false)
    }
  }, [engineConnected, enginePort, filter, t])

  useEffect(() => {
    void load()
  }, [load])

  // 每 5 分钟静默自动刷新
  useEffect(() => {
    const interval = setInterval(() => { void load(true) }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [load])

  const modelEntries = useMemo(() => {
    if (loadState.status !== 'data') return []
    return Object.entries(loadState.stats.by_model).sort(([, a], [, b]) => b.tokens - a.tokens)
  }, [loadState])

  const modelTimeseries = useMemo(() => {
    if (loadState.status !== 'data') return {}
    const byModel: Record<string, TokenUsageTimeseriesItem[]> = {}
    for (const item of loadState.timeseries) {
      const m = item.model_name
      byModel[m] ??= []
      byModel[m].push(item)
    }
    const result: Record<string, TsDataRow[]> = {}
    for (const [model, items] of Object.entries(byModel)) {
      result[model] = fillDateRange(items)
    }
    return result
  }, [loadState])

  // --- Loading ---
  if (loadState.status === 'loading') {
    return (
      <div className="rounded-xl border border-border-custom bg-bg-surface p-4 space-y-3">
        <DashboardHeader onRefresh={load} refreshing={false} />
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-lg border border-border-custom bg-bg-input p-3 space-y-2 min-w-[170px] flex-1 animate-pulse">
              <div className="h-3 w-16 bg-bg-hover rounded" />
              <div className="h-6 w-20 bg-bg-hover rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // --- Error ---
  if (loadState.status === 'error') {
    return (
      <div className="rounded-xl border border-border-custom bg-bg-surface p-4">
        <DashboardHeader onRefresh={load} refreshing={refreshing} />
        <div className="flex flex-col items-center justify-center py-10">
          <div className="mb-3 rounded-full bg-danger/10 p-3">
            <svg className="w-5 h-5 text-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </div>
          <p className="text-xs text-text-muted">{loadState.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {t('settings.tokenUsage.retry')}
          </button>
        </div>
      </div>
    )
  }

  // --- Empty ---
  if (loadState.status === 'empty') {
    return (
      <div className="rounded-xl border border-border-custom bg-bg-surface p-4">
        <DashboardHeader onRefresh={load} refreshing={refreshing} />
        <div className="flex flex-col items-center justify-center py-10">
          <div className="mb-3 rounded-full bg-bg-hover p-3">
            <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <p className="text-xs text-text-muted">{t('settings.tokenUsage.noData')}</p>
        </div>
      </div>
    )
  }

  const { stats } = loadState

  return (
    <div className="rounded-xl border border-border-custom bg-bg-surface p-4 space-y-4">
      {/* Toolbar: month selector + refresh */}
      <DashboardHeader
        onRefresh={load}
        refreshing={refreshing}
        filter={filter}
        filterLabel={filterLabel}
        monthsOpen={monthsOpen}
        onToggleMonths={() => setMonthsOpen((v) => !v)}
        onSelectMonth={(f) => { setFilter(f); setMonthsOpen(false) }}
        isCurrentMonth={filter.year === currentBjMonth.year && filter.month === currentBjMonth.month}
        monthOptions={monthOptions}
      />

      {/* 时区提示 */}
      <div className="text-[10px] text-text-muted">{t('settings.tokenUsage.timezoneHint')}</div>

      {/* Summary cards */}
      <div className="flex flex-wrap gap-3">
        <SummaryCard
          label={t('settings.tokenUsage.summaryRuns')}
          value={fmtNum(stats.total_runs)}
          sub={filterLabel}
          icon={
            <svg className="w-4 h-4 text-[#818cf8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          }
          accent="bg-[#6366f1]/10"
        />
        <SummaryCard
          label={t('settings.tokenUsage.summaryApiCalls')}
          value={fmtNum(stats.total_llm_call_count)}
          sub={filterLabel}
          icon={
            <svg className="w-4 h-4 text-[#a78bfa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
          }
          accent="bg-[#8b5cf6]/10"
        />
        <SummaryCard
          label={t('settings.tokenUsage.input')}
          value={fmtNum(stats.total_input_tokens)}
          icon={
            <svg className="w-4 h-4 text-[#22d3ee]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          }
          accent="bg-[#06b6d4]/10"
        />
        <SummaryCard
          label={t('settings.tokenUsage.output')}
          value={fmtNum(stats.total_output_tokens)}
          icon={
            <svg className="w-4 h-4 text-[#fbbf24]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          }
          accent="bg-amber/10"
        />
        <SummaryCard
          label={t('settings.tokenUsage.total')}
          value={fmtNum(stats.total_tokens)}
          icon={
            <svg className="w-4 h-4 text-[#34d399]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          accent="bg-teal/10"
        />
      </div>

      {/* Cache hit statistics */}
      <CacheHitSection
        totalCacheRead={stats.total_cache_read_tokens}
        totalInput={stats.total_input_tokens}
        byModel={stats.by_model}
      />

      {/* Per-model sections */}
      {modelEntries.length > 0 ? (
        <div className="space-y-3">
          {modelEntries.map(([model, data], idx) => (
            <ModelSection
              key={model}
              model={model}
              colorIdx={idx}
              tsData={modelTimeseries[model] ?? []}
              inputTokens={data.input_tokens}
              outputTokens={data.output_tokens}
              totalTokens={data.tokens}
              totalCalls={data.runs}
              totalLlmCalls={data.llm_call_count}
              cacheReadTokens={data.cache_read_tokens}
            />
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-text-muted text-xs">{t('settings.tokenUsage.noData')}</div>
      )}

      {/* By Caller Section */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#06b6d4]/10">
            <svg className="w-3.5 h-3.5 text-[#06b6d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
            </svg>
          </span>
          {t('settings.tokenUsage.byCaller')}
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {CALLER_CONFIG.map((cfg) => {
            const tokens = stats.by_caller[cfg.key]
            const callerTotal = Math.max(
              stats.by_caller.lead_agent + stats.by_caller.subagent + stats.by_caller.middleware,
              1
            )
            const pct = Math.max((tokens / callerTotal) * 100, 2)
            const label =
              cfg.key === 'lead_agent'
                ? t('settings.tokenUsage.leadAgent')
                : cfg.key === 'subagent'
                  ? t('settings.tokenUsage.subagent')
                  : t('settings.tokenUsage.middleware')
            return (
              <div key={cfg.key} className="rounded-lg border border-border-custom bg-bg-input p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.bg}`}>
                    <svg className={`w-3.5 h-3.5 ${cfg.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                    </svg>
                  </span>
                  <span className="text-[10px] text-text-muted">{label}</span>
                </div>
                <div className="font-mono text-base font-bold text-text-primary">{fmtNum(tokens)}</div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-hover">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: cfg.color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============ Dashboard Header (toolbar) ============

function DashboardHeader({
  onRefresh,
  refreshing,
  filter,
  filterLabel,
  monthsOpen,
  onToggleMonths,
  onSelectMonth,
  isCurrentMonth,
  monthOptions
}: {
  onRefresh: (silent?: boolean) => Promise<void>
  refreshing: boolean
  filter?: MonthFilter
  filterLabel?: string
  monthsOpen?: boolean
  onToggleMonths?: () => void
  onSelectMonth?: (f: MonthFilter) => void
  isCurrentMonth?: boolean
  monthOptions?: { y: number; m: number; label: string }[]
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
        </svg>
        {t('settings.tokenUsage.statsTitle')}
      </h3>
      <div className="flex items-center gap-1.5">
        {filter && filterLabel && (
          <div className="relative">
            <button
              type="button"
              onClick={onToggleMonths}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border border-border-custom hover:bg-bg-hover transition-colors text-text-primary"
            >
              <svg className="w-3 h-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <span>{filterLabel}</span>
              <svg className={`w-3 h-3 text-text-muted transition-transform ${monthsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {monthsOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-bg-surface border border-border-custom rounded-lg shadow-xl py-1 min-w-[150px] max-h-[260px] overflow-auto">
                <button
                  type="button"
                  onClick={() => onSelectMonth?.(getCurrentBeijingMonth())}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors ${isCurrentMonth ? 'text-[#818cf8] font-medium' : 'text-text-primary'}`}
                >
                  {t('settings.tokenUsage.thisMonth')}
                </button>
                <div className="border-t border-border-custom my-1" />
                {monthOptions?.map((opt) => (
                  <button
                    type="button"
                    key={`${opt.y}-${opt.m}`}
                    onClick={() => onSelectMonth?.({ year: opt.y, month: opt.m })}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors ${
                      filter.year === opt.y && filter.month === opt.m ? 'text-[#818cf8] font-medium' : 'text-text-primary'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted transition-colors"
          title={t('settings.tokenUsage.refresh')}
        >
          <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
      </div>
    </div>
  )
}
