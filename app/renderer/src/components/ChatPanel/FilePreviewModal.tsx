// FilePreviewModal — 应用内文件预览抽屉（thread outputs 文件）。
//
// ArtifactBar（present_files 卡片）与 AssistantTurn（正文中的文件链接）
// 共用：点击后经 GET /v1/threads/:id/file 拉取内容，md 文件渲染 markdown，
// 其余纯文本展示。避免 Electron 把文件路径链接抛给系统浏览器（黑屏）。
//
// 右侧滑出抽屉（参考 ChangePanel/InfoPanel 风格），z-[60] 高于两个浮动
// 面板（z-50），弹出时自然遮挡右边的浮动面板。

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/app-store'

interface FilePreviewModalProps {
  path: string
  onClose: () => void
}

/** 容错解码：agent 输出的链接可能已是 URL 编码形式，展示与请求前归一化。 */
function safeDecodePath(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

export function FilePreviewModal({ path, onClose }: FilePreviewModalProps) {
  const enginePort = useAppStore((s) => s.enginePort)
  const threadId = useAppStore((s) => s.threadId)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decodedPath = safeDecodePath(path)

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
          `http://127.0.0.1:${enginePort}/v1/threads/${threadId}/file?path=${encodeURIComponent(decodedPath)}`
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
  }, [decodedPath, enginePort, threadId])

  const fileName = decodedPath.split('/').pop() || decodedPath
  const isMarkdown = fileName.endsWith('.md')

  return (
    <aside className="fixed top-12 right-3 z-[60] flex h-[calc(100vh-60px)] w-[640px] flex-col overflow-hidden rounded-xl border border-[rgba(255,255,255,0.13)] bg-[rgba(30,33,36,0.97)] shadow-2xl backdrop-blur-md">
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary"
          title={decodedPath}
        >
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
    </aside>
  )
}
