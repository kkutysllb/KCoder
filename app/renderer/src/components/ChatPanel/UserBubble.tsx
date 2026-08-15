// UserBubble — 用户消息气泡（参考 KStock UserBubble.tsx）。
//
// 功能：
//   1. 右对齐浅灰气泡，纯文本
//   2. 鼠标悬浮显示复制 + 编辑按钮
//   3. 点击编辑 → inline textarea（Enter 提交，Shift/Cmd+Enter 换行）
//   4. canEdit 权限由父级动态控制（通常要求下一个 assistant turn 已完成）

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../lib/chatMessage'

interface UserBubbleProps {
  msg: ChatMessage
  canEdit?: boolean
  editDisabled?: boolean
  onEditResend?: (messageId: string, replacementText: string) => Promise<void>
}

export function UserBubble({ msg, canEdit = false, editDisabled = false, onEditResend }: UserBubbleProps) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(msg.content ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content ?? '')
      setError(null)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
      setError('复制失败，请稍后重试')
    }
  }

  const handleSubmit = async () => {
    const replacementText = editText.trim()
    if (!replacementText || !onEditResend || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onEditResend(msg.id, replacementText)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新发送失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  // 编辑模式
  if (editing) {
    return (
      <div className="flex flex-col items-end gap-2 group">
        <div className="w-full max-w-[80%] rounded-xl border border-info/40 bg-[#1e2a3a] overflow-hidden">
          <textarea
            aria-label="编辑用户消息"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              const modifier = e.metaKey || e.ctrlKey
              if (e.key !== 'Enter' || modifier || e.shiftKey) return
              e.preventDefault()
              void handleSubmit()
            }}
            disabled={submitting}
            autoFocus
            className="w-full bg-transparent text-sm text-text-primary px-4 py-3 outline-none resize-none min-h-[80px] placeholder:text-text-muted"
            placeholder="编辑消息内容..."
          />
          <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => {
                setEditText(msg.content ?? '')
                setError(null)
                setEditing(false)
              }}
              disabled={submitting}
              className="px-3 py-1 rounded-md text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !editText.trim() || !onEditResend}
              className="px-3 py-1 rounded-md text-xs font-medium bg-info text-white hover:bg-[#2563eb] transition-colors disabled:opacity-50"
            >
              {submitting ? '准备中' : '重新发送'}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-danger px-2" role="alert">{error}</p>}
      </div>
    )
  }

  // 展示模式
  return (
    <div className="flex flex-col items-end gap-1 group">
      <div className="user-bubble">
        {msg.content}
      </div>
      <div className="flex items-center gap-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? '已复制' : '复制消息'}
          title={copied ? '已复制' : '复制消息'}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {copied ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditText(msg.content ?? '')
            setError(null)
            setEditing(true)
          }}
          aria-label="编辑消息"
          title={canEdit ? '编辑消息' : '该消息暂不可编辑'}
          disabled={!canEdit || editDisabled || !onEditResend}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>
      {error && <p className="text-xs text-danger px-2" role="alert">{error}</p>}
    </div>
  )
}
