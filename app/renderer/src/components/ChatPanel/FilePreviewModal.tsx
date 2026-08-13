// FilePreviewModal — 应用内文件预览弹窗（thread outputs 文件）。
//
// ArtifactBar（present_files 卡片）与 AssistantTurn（正文中的文件链接）
// 共用：点击后经 GET /v1/threads/:id/file 拉取内容，md 文件渲染 markdown，
// 其余纯文本展示。避免 Electron 把文件路径链接抛给系统浏览器（黑屏）。

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/app-store'

interface FilePreviewModalProps {
  path: string
  onClose: () => void
}

export function FilePreviewModal({ path, onClose }: FilePreviewModalProps) {
  const enginePort = useAppStore((s) => s.enginePort)
  const threadId = useAppStore((s) => s.threadId)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (!threadId) {
          if (!cancelled) setError('Thread ID not available')
          return
        }
        // engine 端口固定走 store 的 enginePort，不能用 window.location.port
        // （dev 模式下是 vite 端口，会拿到 index.html 而非文件内容）。
        const res = await fetch(
          `http://127.0.0.1:${enginePort}/v1/threads/${threadId}/file?path=${encodeURIComponent(path)}`
        )
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText)
          if (!cancelled) setError(`Failed to load: ${text}`)
          return
        }
        const text = await res.text()
        if (!cancelled) setContent(text)
      } catch (err) {
        if (!cancelled) setError(`Error: ${err}`)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [path, enginePort, threadId])

  const fileName = path.split('/').pop() || path
  const isMarkdown = fileName.endsWith('.md')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex h-[80vh] w-[min(900px,90vw)] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-sidebar shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="min-w-0 truncate font-mono text-sm text-text-primary" title={path}>
            {fileName}
          </span>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4">
          {content == null && error == null ? (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              <span className="animate-pulse">加载中…</span>
            </div>
          ) : error ? (
            <div className="text-sm text-red-400">{error}</div>
          ) : isMarkdown ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-text-primary">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
