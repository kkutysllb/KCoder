// ClarificationCard — 结构化澄清卡片（参考 KStock ClarificationCard.tsx）。
//
// 当 Agent 调用 ask_clarification 工具时，渲染结构化交互卡片替代通用 modal：
// - choice_with_other：选项 + "其他"自定义输入
// - form：表单字段（text/textarea/number/select/multi_select/checkbox/date）
// - free_text：自由文本输入
//
// 用户提交后，通过 onPick 把所选内容回调给父级，父级再 POST 给引擎。

import { useState, type FormEvent } from 'react'
import type { HumanInputPayload, ClarificationFormField } from '../../lib/chatMessage'

interface ClarificationCardProps {
  payload: HumanInputPayload
  onPick: (text: string) => void
}

export function ClarificationCard({ payload, onPick }: ClarificationCardProps) {
  switch (payload.input_mode) {
    case 'choice_with_other':
      return <ChoiceCard key={payload.request_id} payload={payload} onPick={onPick} />
    case 'form':
      return <FormCard key={payload.request_id} payload={payload} onPick={onPick} />
    case 'free_text':
      return <FreeTextCard key={payload.request_id} payload={payload} onPick={onPick} />
    default:
      return null
  }
}

// ── choice_with_other ──────────────────────────────────────────────

function ChoiceCard({ payload, onPick }: { payload: HumanInputPayload; onPick: (t: string) => void }) {
  const [selected, setSelected] = useState<string>('')
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const options = payload.options ?? []
  const finalValue = showOther ? otherText.trim() : selected

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!finalValue || submitting) return
    setSubmitting(true)
    onPick(finalValue)
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-4">
      {payload.context && (
        <p className="text-xs text-text-muted mb-2">{payload.context}</p>
      )}
      <p className="text-sm text-text-primary font-medium mb-3">{payload.question}</p>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <label
            key={opt.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
              !showOther && selected === opt.value
                ? 'bg-blue-500/10 border border-blue-500/30'
                : 'hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            <input
              type="radio"
              name="clarify-choice"
              value={opt.value}
              checked={!showOther && selected === opt.value}
              onChange={() => {
                setSelected(opt.value)
                setShowOther(false)
              }}
              className="accent-blue-500"
            />
            <span className="text-sm text-text-primary">{opt.label}</span>
          </label>
        ))}
        {/* "其他"选项 */}
        <label className={`flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
          showOther ? 'bg-blue-500/10 border border-blue-500/30' : 'hover:bg-white/[0.03] border border-transparent'
        }`}>
          <input
            type="radio"
            name="clarify-choice"
            checked={showOther}
            onChange={() => setShowOther(true)}
            className="accent-blue-500 mt-1"
          />
          <div className="flex-1">
            <span className="text-sm text-text-primary">其他</span>
            {showOther && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="请输入..."
                autoFocus
                className="mt-1.5 w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-blue-500/50"
              />
            )}
          </div>
        </label>
      </div>
      <button
        type="submit"
        disabled={!finalValue || submitting}
        className="mt-3 w-full py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? '提交中…' : '回复并确认'}
      </button>
    </form>
  )
}

// ── free_text ────────────────────────────────────────────────────────

function FreeTextCard({ payload, onPick }: { payload: HumanInputPayload; onPick: (t: string) => void }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || submitting) return
    setSubmitting(true)
    onPick(text.trim())
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-4">
      {payload.context && (
        <p className="text-xs text-text-muted mb-2">{payload.context}</p>
      )}
      <p className="text-sm text-text-primary font-medium mb-3">{payload.question}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="请输入..."
        autoFocus
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-blue-500/50 resize-none min-h-[80px]"
      />
      <button
        type="submit"
        disabled={!text.trim() || submitting}
        className="mt-3 w-full py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? '提交中…' : '回复并确认'}
      </button>
    </form>
  )
}

// ── form ──────────────────────────────────────────────────────────────

function FormCard({ payload, onPick }: { payload: HumanInputPayload; onPick: (t: string) => void }) {
  const fields = payload.fields ?? []
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    // 校验 required
    for (const f of fields) {
      if (f.required && !values[f.name]) return
    }
    setSubmitting(true)
    // 把表单数据拼成可读字符串（简单实现，未来可以结构化）
    const text = fields
      .map((f) => {
        const v = values[f.name]
        if (v == null || v === '') return null
        const label = f.label ?? f.name
        return `${label}: ${Array.isArray(v) ? v.join(', ') : v}`
      })
      .filter(Boolean)
      .join('\n')
    onPick(text || '(空表单)')
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.03] p-4">
      {payload.context && (
        <p className="text-xs text-text-muted mb-2">{payload.context}</p>
      )}
      <p className="text-sm text-text-primary font-medium mb-3">{payload.question}</p>
      <div className="space-y-3">
        {fields.map((field) => (
          <FormFieldInput
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
          />
        ))}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="mt-4 w-full py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? '提交中…' : '回复并确认'}
      </button>
    </form>
  )
}

function FormFieldInput({
  field,
  value,
  onChange
}: {
  field: ClarificationFormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const label = field.label ?? field.name

  const commonProps = {
    id: field.name,
    placeholder: field.placeholder,
    required: field.required,
    className: 'w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-blue-500/50'
  }

  switch (field.type) {
    case 'textarea':
      return (
        <label key={field.name} className="block">
          <span className="block text-xs text-text-secondary mb-1">{label}{field.required && ' *'}</span>
          <textarea
            {...commonProps}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={commonProps.className + ' resize-none min-h-[60px]'}
          />
        </label>
      )
    case 'number':
      return (
        <label key={field.name} className="block">
          <span className="block text-xs text-text-secondary mb-1">{label}{field.required && ' *'}</span>
          <input
            {...commonProps}
            type="number"
            value={(value as number) ?? ''}
            onChange={(e) => onChange(e.target.valueAsNumber)}
          />
        </label>
      )
    case 'date':
      return (
        <label key={field.name} className="block">
          <span className="block text-xs text-text-secondary mb-1">{label}{field.required && ' *'}</span>
          <input
            {...commonProps}
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
    case 'checkbox':
      return (
        <label key={field.name} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            required={field.required}
            className="accent-blue-500"
          />
          <span className="text-sm text-text-primary">{label}</span>
        </label>
      )
    case 'select':
    case 'multi_select': {
      const isMulti = field.type === 'multi_select'
      const options = field.options ?? []
      return (
        <label key={field.name} className="block">
          <span className="block text-xs text-text-secondary mb-1">{label}{field.required && ' *'}</span>
          <select
            {...commonProps}
            multiple={isMulti}
            value={(value as string | string[]) ?? (isMulti ? [] : '')}
            onChange={(e) => {
              if (isMulti) {
                onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
              } else {
                onChange(e.target.value)
              }
            }}
          >
            {!isMulti && <option value="">— 请选择 —</option>}
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </label>
      )
    }
    default: // text
      return (
        <label key={field.name} className="block">
          <span className="block text-xs text-text-secondary mb-1">{label}{field.required && ' *'}</span>
          <input
            {...commonProps}
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
  }
}
