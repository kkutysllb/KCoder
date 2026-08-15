import { useState, useEffect } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useChat } from '../../hooks/useChat'
import type { UserInputRequest } from '../../services/engine-api'

/**
 * 结构化输入弹窗 — 后端发 user_input_requested 事件时弹出。
 * 渲染 questions（每个含 options），用户选择后提交 answers 到 POST /v1/user-inputs/:id。
 */
export function UserInputModal() {
  const pendingUserInput = useAppStore((s) => s.pendingUserInput)
  const { submitUserInput, cancelUserInput } = useChat()

  if (!pendingUserInput) return null

  return (
    <UserInputModalInner
      request={pendingUserInput}
      onSubmit={(answers) => submitUserInput(pendingUserInput.inputId, answers)}
      onCancel={() => cancelUserInput(pendingUserInput.inputId)}
    />
  )
}

function UserInputModalInner({
  request,
  onSubmit,
  onCancel
}: {
  request: UserInputRequest
  onSubmit: (answers: Array<{ id: string; label: string; value: string }>) => void
  onCancel: () => void
}) {
  const questions = request.questions ?? []
  // 每个 question 的选中 option label（或自由文本）
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // 弹窗打开时聚焦
  useEffect(() => {
    setAnswers({})
  }, [request.inputId])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const answerList = questions.map((q) => ({
        id: q.id,
        label: q.options.find((o) => o.label === answers[q.id])?.label ?? answers[q.id] ?? '',
        value: answers[q.id] ?? ''
      }))
      onSubmit(answerList)
    } finally {
      setSubmitting(false)
    }
  }

  const allAnswered = questions.length > 0 && questions.every((q) => (answers[q.id] ?? '').trim().length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && onCancel()} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-border-custom bg-bg-sidebar shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-custom">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-info" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
            </svg>
            <h2 className="text-sm font-semibold text-text-primary">需要输入</h2>
          </div>
          <button
            onClick={() => !submitting && onCancel()}
            className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-bg-hover"
            disabled={submitting}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {request.prompt && (
            <p className="text-sm text-text-secondary leading-relaxed">{request.prompt}</p>
          )}
          {questions.map((q) => (
            <div key={q.id}>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                {q.header && <span className="text-text-muted mr-1.5">{q.header}</span>}
                {q.question}
              </label>
              <div className="space-y-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.label }))}
                    disabled={submitting}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left text-xs transition-colors border ${
                      answers[q.id] === opt.label
                        ? 'bg-info/10 border-info/40 text-text-primary'
                        : 'bg-bg-input border-border-custom text-text-secondary hover:border-[#52525b]'
                    }`}
                  >
                    <span className={`mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                      answers[q.id] === opt.label ? 'border-info' : 'border-[#52525b]'
                    }`}>
                      {answers[q.id] === opt.label && <span className="w-1.5 h-1.5 rounded-full bg-info" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium">{opt.label}</span>
                      {opt.description && <span className="block text-text-muted mt-0.5 opacity-80">{opt.description}</span>}
                    </span>
                  </button>
                ))}
                {/* 无选项时允许自由文本输入 */}
                {q.options.length === 0 && (
                  <input
                    type="text"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    disabled={submitting}
                    className="w-full bg-bg-input text-text-primary placeholder-text-muted rounded-lg px-3 py-2 text-xs outline-none border border-border-custom focus:border-info"
                  />
                )}
              </div>
            </div>
          ))}
          {questions.length === 0 && !request.prompt && (
            <p className="text-xs text-text-muted">引擎请求输入但未提供具体问题。</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-custom">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !allAnswered}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 disabled:bg-[#3f3f46] disabled:text-text-muted disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {submitting && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            提交
          </button>
        </div>
      </div>
    </div>
  )
}
