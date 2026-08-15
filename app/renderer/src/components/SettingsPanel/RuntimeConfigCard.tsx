import { useState, useEffect, useMemo } from 'react'
import { useI18n } from '../../i18n'
import type { ContextSize } from '../../services/engine-api'

// ============ Field definitions for config cards ============

export type FieldType = 'boolean' | 'string' | 'nullable-string' | 'number' | 'select' | 'context-size'

export interface SelectOption {
  value: string
  label: string
}

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  hint?: string
  min?: number
  max?: number
  step?: number
  options?: SelectOption[]
}

// ============ Utils ============

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 把后端返回的 ContextSize | ContextSize[] | null 统一成编辑器可用的单一 ContextSize。 */
export function normalizeContextSize(val: unknown): ContextSize {
  if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === 'object') {
    return { type: val[0].type ?? 'messages', value: val[0].value ?? 20 }
  }
  if (val && typeof val === 'object' && 'type' in val) {
    const cs = val as Record<string, unknown>
    return {
      type: (cs.type as ContextSize['type']) ?? 'messages',
      value: typeof cs.value === 'number' ? cs.value : 20
    }
  }
  return { type: 'messages', value: 20 }
}

// ============ RuntimeConfigCard ============

export function RuntimeConfigCard({
  title,
  description,
  fields,
  initialValue,
  onSave,
  saving,
  savedHint
}: {
  title: string
  description: string
  fields: FieldDef[]
  initialValue: Record<string, unknown>
  onSave: (value: Record<string, unknown>) => Promise<void>
  saving: boolean
  savedHint?: string
}) {
  const { t } = useI18n()
  const [formValue, setFormValue] = useState<Record<string, unknown>>(() => ({ ...initialValue }))
  const [error, setError] = useState<string | null>(null)
  const [showSavedHint, setShowSavedHint] = useState(false)

  // 当外部 initialValue 变化（热重载后刷新），同步到 form
  useEffect(() => {
    setFormValue({ ...initialValue })
  }, [initialValue])

  const dirty = useMemo(() => !deepEqual(formValue, initialValue), [formValue, initialValue])

  const setField = (key: string, value: unknown): void => {
    setFormValue((prev) => ({ ...prev, [key]: value }))
    setError(null)
    setShowSavedHint(false)
  }

  const handleSave = async (): Promise<void> => {
    setError(null)
    setShowSavedHint(false)
    try {
      await onSave(formValue)
      setShowSavedHint(true)
      setTimeout(() => setShowSavedHint(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleReset = (): void => {
    setFormValue({ ...initialValue })
    setError(null)
    setShowSavedHint(false)
  }

  return (
    <div className="rounded-xl border border-border-custom bg-bg-surface p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="space-y-2.5">
        {fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            value={formValue[field.key]}
            onChange={(v) => setField(field.key, v)}
          />
        ))}
      </div>
      {error && (
        <div className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</div>
      )}
      {showSavedHint && (
        <div className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-500 text-[11px]">
          {savedHint ?? t('settings.memory.saved')}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {dirty && (
          <button
            onClick={handleReset}
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

export function FieldRow({
  field,
  value,
  onChange
}: {
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const labelId = `cfg-${field.key}`

  if (field.type === 'boolean') {
    const checked = Boolean(value)
    return (
      <div className="flex items-center justify-between gap-3 py-0.5">
        <label htmlFor={labelId} className="flex-1">
          <span className="text-xs text-text-primary">{field.label}</span>
          {field.hint && <p className="text-[10px] text-text-muted mt-0.5">{field.hint}</p>}
        </label>
        <button
          id={labelId}
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-white' : 'bg-bg-hover'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${checked ? 'translate-x-4 bg-black' : 'bg-text-muted'}`}
          />
        </button>
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="py-0.5">
        <label htmlFor={labelId} className="block text-xs text-text-primary">{field.label}</label>
        {field.hint && <p className="text-[10px] text-text-muted mb-1">{field.hint}</p>}
        <select
          id={labelId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'number') {
    const numVal = typeof value === 'number' && !Number.isNaN(value) ? value : 0
    return (
      <div className="py-0.5">
        <label htmlFor={labelId} className="block text-xs text-text-primary">{field.label}</label>
        {field.hint && <p className="text-[10px] text-text-muted mb-1">{field.hint}</p>}
        <input
          id={labelId}
          type="number"
          value={numVal}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isNaN(n) ? 0 : n)
          }}
          className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
        />
      </div>
    )
  }

  if (field.type === 'nullable-string') {
    // 可清空的字符串：value 为 null 时显示空串
    const strVal = value == null ? '' : String(value)
    return (
      <div className="py-0.5">
        <label htmlFor={labelId} className="block text-xs text-text-primary">{field.label}</label>
        {field.hint && <p className="text-[10px] text-text-muted mb-1">{field.hint}</p>}
        <div className="mt-1 flex gap-1">
          <input
            id={labelId}
            type="text"
            value={strVal}
            placeholder="(空)"
            onChange={(e) => onChange(e.target.value || null)}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
          />
          {value != null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="px-2 rounded-lg text-[10px] text-text-muted hover:bg-bg-hover border border-border-custom"
              title="清空"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'context-size') {
    const cs = normalizeContextSize(value)
    return (
      <div className="py-0.5">
        <label className="block text-xs text-text-primary">{field.label}</label>
        {field.hint && <p className="text-[10px] text-text-muted mb-1">{field.hint}</p>}
        <div className="mt-1 flex gap-1">
          <select
            value={cs.type}
            onChange={(e) => onChange({ type: e.target.value as ContextSize['type'], value: cs.value })}
            className="px-2 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
          >
            <option value="messages">messages</option>
            <option value="tokens">tokens</option>
            <option value="fraction">fraction</option>
          </select>
          <input
            type="number"
            value={cs.value}
            min={0}
            step={cs.type === 'fraction' ? 0.05 : 1}
            onChange={(e) => {
              const n = Number(e.target.value)
              onChange({ type: cs.type, value: Number.isNaN(n) ? 0 : n })
            }}
            className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
          />
        </div>
      </div>
    )
  }

  // string
  return (
    <div className="py-0.5">
      <label htmlFor={labelId} className="block text-xs text-text-primary">{field.label}</label>
      {field.hint && <p className="text-[10px] text-text-muted mb-1">{field.hint}</p>}
      <input
        id={labelId}
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong"
      />
    </div>
  )
}
