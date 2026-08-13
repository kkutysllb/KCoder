// FileChangeCard — 单轮 turn 的 workspace 文件变更卡片。
//
// 收起态：`+23 -5 · 3 files`；展开态：文件列表（状态色点 + 路径 + 每文件
// +/- 数），点击文件弹出 DiffViewer 查看行级差异。

import { useState } from 'react'
import type { FileChangesPayload, FileChange } from '../../lib/chatMessage'
import { DiffViewer } from './DiffViewer'

interface FileChangeCardProps {
  changes: FileChangesPayload
}

const STATUS_DOT: Record<FileChange['status'], string> = {
  created: 'bg-[#22c55e]',
  modified: 'bg-[#eab308]',
  deleted: 'bg-[#ef4444]',
  symlink_created: 'bg-[#3b82f6]'
}

export function FileChangeCard({ changes }: FileChangeCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<FileChange | null>(null)

  const { summary, files } = changes
  const totalFiles =
    summary.created + summary.modified + summary.deleted + summary.symlink_created
  if (totalFiles === 0 && files.length === 0) return null

  const hasAdd = summary.additions > 0
  const hasDel = summary.deletions > 0

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border-custom bg-bg-surface/60">
      {/* 收起态头部 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
      >
        <svg
          className="h-3.5 w-3.5 shrink-0 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 12.5l5-5 5 5M7 12.5h10M12 7.5v10"
          />
        </svg>
        <span className="flex items-center gap-2 font-mono text-xs tabular-nums">
          {hasAdd && <span className="text-[#22c55e]">+{summary.additions}</span>}
          {hasDel && <span className="text-[#ef4444]">-{summary.deletions}</span>}
          <span className="text-text-secondary">· {totalFiles} files</span>
          {summary.truncated && (
            <span className="text-[10px] text-text-muted" title="部分文件未纳入统计">
              (truncated)
            </span>
          )}
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

      {/* 展开文件列表 */}
      {expanded && (
        <div className="border-t border-border-custom">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => setSelected(file)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-hover"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[file.status] ?? 'bg-gray-500'}`}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
                {file.path}
              </span>
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                {file.additions > 0 && (
                  <span className="text-[#22c55e]">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="ml-1 text-[#ef4444]">-{file.deletions}</span>
                )}
              </span>
            </button>
          ))}
          {files.length === 0 && (
            <div className="px-3 py-2 text-xs text-text-muted">无文件详情</div>
          )}
        </div>
      )}

      {/* diff 弹窗 */}
      {selected && <DiffViewer change={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
