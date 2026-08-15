// ChangePanel — workspace 文件变更聚合抽屉（状态栏变更按钮打开）。
//
// 聚合当前 thread 全部 assistant turn 的 fileChanges（前端 messages_v2
// 已存储，无需再请求后端），按时间倒序分组展示；每个文件点击后内联
// 展开 DiffViewer 查看行级差异。

import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import type { FileChangesPayload, FileChange } from '../../lib/chatMessage'
import { DiffViewer } from '../ChatPanel/DiffViewer'

interface ChangeEntry {
  id: string
  createdAt: number
  changes: FileChangesPayload
}

const STATUS_DOT: Record<FileChange['status'], string> = {
  created: 'bg-success',
  modified: 'bg-warning',
  deleted: 'bg-danger',
  symlink_created: 'bg-info'
}

export function ChangePanel() {
  const { t } = useI18n()
  const { changePanelOpen, setChangePanelOpen, messages_v2 } = useAppStore()

  if (!changePanelOpen) return null

  const entries: ChangeEntry[] = messages_v2
    .filter((m) => m.role === 'assistant' && m.fileChanges)
    .map((m) => ({ id: m.id, createdAt: m.createdAt, changes: m.fileChanges! }))
    .reverse()

  return (
    <aside className="fixed top-12 right-3 z-50 flex w-[440px] max-h-[calc(100vh-60px)] flex-col overflow-hidden rounded-xl border border-float-border bg-float-bg shadow-2xl backdrop-blur-md">
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
          {t('changes.title')}
        </h2>
        <button
          onClick={() => setChangePanelOpen(false)}
          className="rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          title={t('common.close')}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {entries.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-text-muted">
            {t('changes.empty')}
            <p className="mt-1 text-[11px] text-text-muted/60">
              {t('changes.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <ChangeEntryItem key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

// ─── 单轮变更分组 ───────────────────────────────────────────────

function ChangeEntryItem({ entry }: { entry: ChangeEntry }) {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const { summary, files } = entry.changes
  const time = new Date(entry.createdAt).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })
  const selected = files.find((f) => f.path === selectedPath) ?? null

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle">
      {/* 组头：时间 + 统计 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        <span className="text-[10px] text-text-muted">{time}</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
          {summary.additions > 0 && (
            <span className="text-success">+{summary.additions}</span>
          )}
          {summary.deletions > 0 && (
            <span className="text-danger">-{summary.deletions}</span>
          )}
          <span className="text-text-secondary">· {t('changes.fileCount', { n: files.length })}</span>
        </span>
        <svg
          className={`ml-auto h-3 w-3 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border-subtle">
          {files.map((file) => (
            <div key={file.path}>
              <button
                onClick={() => setSelectedPath(selectedPath === file.path ? null : file.path)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-hover ${
                  selectedPath === file.path ? 'bg-bg-hover/60' : ''
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[file.status] ?? 'bg-gray-500'}`}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                  {file.path}
                </span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums">
                  {file.additions > 0 && (
                    <span className="text-success">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="ml-1 text-danger">-{file.deletions}</span>
                  )}
                </span>
              </button>
              {selected && (
                <div className="px-2 pb-2">
                  <DiffViewer change={selected} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
