// DiffViewer — unified diff 行级查看器。
//
// 解析 gateway 生成的 unified diff 文本（WorkspaceFileChange.diff），渲染
// 行级 +/- 高亮、双列行号（old/new）、hunk 头，并对长段未变行做折叠
// （保留首尾各 3 行，中间可展开）。
//
// 两种模式：
//   - 弹窗模式：传入 onClose，居中模态展示单个文件的 diff
//   - 内联模式：不传 onClose，直接渲染在卡片内（ChangePanel 用）

import { useMemo, useState } from 'react'
import type { FileChange } from '../../lib/chatMessage'

interface DiffViewerProps {
  change: FileChange
  /** 提供则渲染为居中弹窗（含遮罩）；省略则内联渲染。 */
  onClose?: () => void
}

// ── diff 解析 ───────────────────────────────────────────────────

type DiffLineType = 'header' | 'hunk' | 'add' | 'del' | 'ctx' | 'meta'

interface DiffLine {
  type: DiffLineType
  text: string
  oldLine?: number
  newLine?: number
}

/** 折叠块：flat 数组中被折叠的连续 ctx 行。 */
interface CollapsedBlock {
  start: number
  count: number
}

const CTX_KEEP = 3
const CTX_MIN_TO_COLLAPSE = CTX_KEEP * 2 + 1

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  let seenHunk = false

  for (const raw of diff.split('\n')) {
    if (!seenHunk && raw.startsWith('---')) {
      lines.push({ type: 'header', text: raw })
      continue
    }
    if (!seenHunk && raw.startsWith('+++')) {
      lines.push({ type: 'header', text: raw })
      continue
    }
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) {
        oldLine = parseInt(m[1], 10)
        newLine = parseInt(m[2], 10)
      }
      seenHunk = true
      lines.push({ type: 'hunk', text: raw })
      continue
    }
    if (seenHunk) {
      if (raw.startsWith('+')) {
        lines.push({ type: 'add', text: raw.slice(1), newLine: newLine++ })
        continue
      }
      if (raw.startsWith('-')) {
        lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++ })
        continue
      }
      if (raw.startsWith('\\')) {
        lines.push({ type: 'meta', text: raw })
        continue
      }
      // 空格前缀或无前缀（空行）
      const text = raw.startsWith(' ') ? raw.slice(1) : raw
      lines.push({ type: 'ctx', text, oldLine: oldLine++, newLine: newLine++ })
      continue
    }
    // hunk 之前的杂散行（极少见）：按上下文处理
    lines.push({ type: 'ctx', text: raw })
  }
  return lines
}

/** 把长段连续 ctx 行折叠为 CollapsedBlock（保留首尾各 CTX_KEEP 行）。 */
function buildCollapsedBlocks(lines: DiffLine[]): CollapsedBlock[] {
  const blocks: CollapsedBlock[] = []
  let runStart = -1
  let runCount = 0
  let flatIndex = -1

  for (const line of lines) {
    flatIndex++
    if (line.type === 'ctx') {
      if (runStart < 0) {
        runStart = flatIndex
        runCount = 0
      }
      runCount++
    } else {
      if (runCount > CTX_MIN_TO_COLLAPSE) {
        blocks.push({
          start: runStart + CTX_KEEP,
          count: runCount - CTX_KEEP * 2
        })
      }
      runStart = -1
      runCount = 0
    }
  }
  if (runCount > CTX_MIN_TO_COLLAPSE) {
    blocks.push({ start: runStart + CTX_KEEP, count: runCount - CTX_KEEP * 2 })
  }
  return blocks
}

// ── 徽标文案 ───────────────────────────────────────────────────

function unavailableText(change: FileChange): string | null {
  switch (change.diff_unavailable_reason) {
    case 'binary':
      return '二进制文件，无法显示差异'
    case 'sensitive':
      return '敏感文件，内容不展示'
    case 'large':
      return '文件过大，差异不展示'
    case 'symlink':
      return '符号链接，差异不展示'
    case 'truncated':
      return change.diff ? '差异过大，已截断展示' : '差异过大，已截断'
    default:
      return null
  }
}

function statusText(status: FileChange['status']): string {
  switch (status) {
    case 'created':
      return '新建'
    case 'modified':
      return '修改'
    case 'deleted':
      return '删除'
    case 'symlink_created':
      return '符号链接'
  }
}

const STATUS_STYLE: Record<FileChange['status'], { badge: string; dot: string }> = {
  created: { badge: 'text-[#22c55e] bg-[#22c55e]/10', dot: 'bg-[#22c55e]' },
  modified: { badge: 'text-[#eab308] bg-[#eab308]/10', dot: 'bg-[#eab308]' },
  deleted: { badge: 'text-[#ef4444] bg-[#ef4444]/10', dot: 'bg-[#ef4444]' },
  symlink_created: { badge: 'text-[#3b82f6] bg-[#3b82f6]/10', dot: 'bg-[#3b82f6]' }
}

// ── 行渲染 ─────────────────────────────────────────────────────

function lineClass(type: DiffLineType): string {
  switch (type) {
    case 'add':
      return 'bg-[rgba(34,197,94,0.12)] text-[#7ee2a8]'
    case 'del':
      return 'bg-[rgba(239,68,68,0.12)] text-[#fca5a5]'
    case 'hunk':
      return 'bg-[rgba(59,130,246,0.15)] text-[#93c5fd]'
    case 'header':
      return 'bg-[rgba(255,255,255,0.04)] text-text-muted'
    case 'meta':
      return 'text-text-muted/60 italic'
    default:
      return 'text-text-secondary'
  }
}

function linePrefix(type: DiffLineType): string {
  switch (type) {
    case 'add':
      return '+'
    case 'del':
      return '-'
    case 'hunk':
      return ''
    case 'header':
      return ''
    default:
      return ' '
  }
}

// ── 组件 ───────────────────────────────────────────────────────

export function DiffViewer({ change, onClose }: DiffViewerProps) {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set())

  const parsed = useMemo(() => parseDiff(change.diff || ''), [change.diff])
  const blocks = useMemo(() => buildCollapsedBlocks(parsed), [parsed])

  // 折叠块索引：buildCollapsedBlocks 顺序编号，用 start 作 key
  const visible = useMemo(() => {
    const hidden = new Set<number>()
    blocks.forEach((block, idx) => {
      if (!expandedBlocks.has(idx)) {
        for (let i = block.start; i < block.start + block.count; i++) hidden.add(i)
      }
    })
    return parsed.map((line, i) => (hidden.has(i) ? null : line))
  }, [parsed, blocks, expandedBlocks])

  const unavailable = unavailableText(change)
  const st = STATUS_STYLE[change.status]
  const fileName = change.path.split('/').pop() || change.path

  const toggleBlock = (idx: number) => {
    setExpandedBlocks((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const body = (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border-custom">
      {/* 文件头 */}
      <div className="flex items-center justify-between gap-2 bg-bg-input px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
          <span className="truncate font-mono text-xs text-text-primary" title={change.path}>
            {fileName}
          </span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${st.badge}`}>
            {statusText(change.status)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
          {change.additions > 0 && <span className="text-[#22c55e]">+{change.additions}</span>}
          {change.deletions > 0 && <span className="text-[#ef4444]">-{change.deletions}</span>}
          {change.diff_truncated && (
            <span className="text-[10px] text-text-muted" title="差异被截断">
              truncated
            </span>
          )}
        </div>
      </div>

      {/* diff 内容 */}
      <div className="max-h-[60vh] overflow-auto bg-bg-surface">
        {unavailable ? (
          <div className="px-4 py-6 text-center text-xs text-text-muted">{unavailable}</div>
        ) : change.diff ? (
          <pre className="font-mono text-[12px] leading-[1.6]">
            {visible.map((line, i) => {
              if (line === null) {
                // 折叠块的位置：找到对应的 block 索引渲染展开按钮
                const blockIdx = blocks.findIndex(
                  (b) => i >= b.start && i < b.start + b.count
                )
                if (blockIdx < 0) return null
                const block = blocks[blockIdx]
                const isExpanded = expandedBlocks.has(blockIdx)
                return (
                  <button
                    key={`fold-${block.start}`}
                    onClick={() => toggleBlock(blockIdx)}
                    className="block w-full cursor-pointer bg-[rgba(255,255,255,0.03)] px-3 py-1 text-center font-sans text-[11px] text-[#3b82f6] hover:bg-[rgba(59,130,246,0.08)]"
                  >
                    {isExpanded
                      ? '▲ 收起'
                      : `▼ 展开 ${block.count} 行未变内容`}
                  </button>
                )
              }
              return (
                <div key={i} className={`flex ${lineClass(line.type)}`}>
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-text-muted/50">
                    {line.oldLine ?? ''}
                  </span>
                  <span className="w-10 shrink-0 select-none pr-2 text-right text-text-muted/50">
                    {line.newLine ?? ''}
                  </span>
                  <span className="w-6 shrink-0 select-none">{linePrefix(line.type)}</span>
                  <span className="whitespace-pre-wrap break-all">{line.text}</span>
                </div>
              )
            })}
          </pre>
        ) : (
          <div className="px-4 py-6 text-center text-xs text-text-muted">
            {change.status === 'deleted' ? '文件被删除（无内容展示）' : '无差异内容'}
          </div>
        )}
      </div>
    </div>
  )

  if (!onClose) return body

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-[720px]" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  )
}
