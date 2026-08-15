// DeliveryResult — 任务交付结果卡片（turn 结束时收尾）。
//
// Cursor/Cline 风格：✓ 已完成 头部 + 修改文件统计（N 文件 / +A -D）+ 动作按钮
// （复制摘要、提交 commit）+ 文件清单（复用 FileChangeCard，含 diff 查看 + 逐文件撤销）。
// 仅在 turn 完成（非流式）且有文件变更时渲染。

import { useMemo, useState } from 'react'
import type { ChatMessage } from '../../lib/chatMessage'
import { FileChangeCard } from './FileChangeCard'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI } from '../../services/engine-api'
import { useI18n } from '../../i18n'

interface DeliveryResultProps {
  msg: ChatMessage
}

export function DeliveryResult({ msg }: DeliveryResultProps) {
  const { t } = useI18n()
  const enginePort = useAppStore((s) => s.enginePort)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const changes = msg.fileChanges
  const [copied, setCopied] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [commitMsg, setCommitMsg] = useState<string | null>(null)

  if (!changes) return null
  const summary = changes.summary
  const totalFiles = summary.created + summary.modified + summary.deleted + summary.symlink_created

  // 验证状态：本 turn 最后一次完成的 run_tests 工具调用（输出前 200 字）。
  // 失败标记优先；出现 passed 且无失败标记才算通过；否则未知（中性）。
  const verification = useMemo(() => {
    const calls = (msg.toolCalls ?? []).filter(
      (c) => c.name === 'run_tests' && c.status === 'completed'
    )
    if (calls.length === 0) return null
    const last = calls[calls.length - 1]
    const text = (last.summary ?? last.output ?? '').trim().slice(0, 200)
    if (!text) return null
    const failed = /FAILED|Traceback|AssertionError|npm ERR|error:\s|exit code [1-9]/i.test(text)
    const passed = !failed && /passed|\bOK\b|成功/i.test(text)
    return { text, passed, failed }
  }, [msg.toolCalls])

  const copySummary = async () => {
    const lines = [
      `${t('delivery.done')}：${t('delivery.filesChanged', { n: totalFiles })}（+${summary.additions} -${summary.deletions}）`,
      ...(changes.files ?? []).map(
        (f) => `- ${f.path} (${f.status}, +${f.additions} -${f.deletions})`
      ),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const onCommit = async () => {
    if (!workspacePath) {
      setCommitMsg(t('delivery.noWorkspace'))
      setTimeout(() => setCommitMsg(null), 2500)
      return
    }
    const message = window.prompt(t('delivery.commitPrompt'))
    if (!message) return
    setCommitting(true)
    setCommitMsg(null)
    try {
      const r = await getEngineAPI(enginePort).commitWorkspace(workspacePath, message)
      setCommitMsg(r.success ? t('delivery.committed') : `${t('delivery.commitFailed')}: ${r.error ?? ''}`)
    } catch (e) {
      setCommitMsg(`${t('delivery.commitFailed')}: ${e}`)
    } finally {
      setCommitting(false)
      setTimeout(() => setCommitMsg(null), 3000)
    }
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-success/30 bg-success/[0.04]">
      {/* 头部：✓ 已完成 + 统计 + 动作 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-success">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {t('delivery.done')}
        </span>
        <span className="text-xs text-text-muted">
          {t('delivery.filesChanged', { n: totalFiles })}
        </span>
        <span className="font-mono text-xs tabular-nums">
          <span className="text-success">+{summary.additions}</span>{' '}
          <span className="text-danger">-{summary.deletions}</span>
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {commitMsg && <span className="text-[10px] text-text-muted">{commitMsg}</span>}
          <button
            type="button"
            onClick={copySummary}
            className="flex items-center gap-1 rounded-md border border-border-custom px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H14L19 10V19H8V5Z M8 5L14 5 M14 5V10H19 M8 12H15 M8 16H15" />
            </svg>
            {copied ? t('delivery.copied') : t('delivery.copySummary')}
          </button>
          <button
            type="button"
            onClick={onCommit}
            disabled={committing}
            className="flex items-center gap-1 rounded-md bg-success/90 px-2 py-1 text-[11px] text-white transition-colors hover:bg-success disabled:opacity-50"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            {committing ? '…' : t('delivery.commit')}
          </button>
        </div>
      </div>

      {/* token 用量（如有） */}
      {msg.usage && msg.usage.totalTokens > 0 && (
        <div className="px-3.5 pb-1 text-[10px] text-text-muted">
          {t('delivery.tokens')}：{msg.usage.totalTokens.toLocaleString()}
          <span className="ml-1 opacity-70">
            (↑{msg.usage.promptTokens.toLocaleString()} ↓{msg.usage.completionTokens.toLocaleString()})
          </span>
        </div>
      )}

      {/* 验证状态（run_tests 工具调用结果） */}
      {verification && (
        <div className="px-3.5 pb-1 text-[10px] text-text-muted">
          <span className={verification.failed ? 'text-danger' : verification.passed ? 'text-success' : ''}>
            {verification.failed ? '✗' : verification.passed ? '✓' : '·'}
          </span>{' '}
          {t('delivery.verification')}：{verification.text}
        </div>
      )}

      {/* 文件清单（含 diff 查看 + 逐文件撤销） */}
      <div className="border-t border-success/20">
        <FileChangeCard changes={changes} />
      </div>
    </div>
  )
}
