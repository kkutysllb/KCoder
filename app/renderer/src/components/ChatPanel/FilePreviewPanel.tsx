// FilePreviewPanel — 应用内文件预览右栏（三分栏布局的第三栏）。
//
// 全局单例（App.tsx 挂载），作为 flex 布局的第三栏参与文档流：打开时
// 主内容区（聊天区）自动收缩让位，不浮动覆盖 workspace 内容；关闭时
// 整栏移除。参考 Codex 的右侧文件预览设计。
//
// 数据经 GET /v1/threads/:id/file 拉取，md 文件渲染 markdown，其余纯文本。
// 挂载时播放 slide-in-right 滑入动画（视觉上从右侧滑出）。

import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI } from '../../services/engine-api'

interface FilePreviewPanelProps {
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

export function FilePreviewPanel({ path, onClose }: FilePreviewPanelProps) {
  const enginePort = useAppStore((s) => s.enginePort)
  const threadId = useAppStore((s) => s.threadId)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decodedPath = safeDecodePath(path)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // 虚拟沙箱路径（/mnt/...）走 thread-scoped 端点；真实工作区路径走
        // workspace 端点（readWorkspaceFile，支持任意绝对路径）。
        const isVirtual = decodedPath.startsWith('/mnt/')
        if (isVirtual) {
          if (!threadId) {
            if (!cancelled) setError('Thread ID not available')
            return
          }
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
        } else {
          const data = await getEngineAPI(enginePort).readWorkspaceFile(decodedPath)
          if (!cancelled) {
            setContent(data.truncated ? `${data.content}\n\n[文件过大，已截断]` : data.content)
          }
        }
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
    <section className="flex h-full w-[640px] shrink-0 flex-col overflow-hidden border-l border-border-custom bg-bg-primary animate-[slide-in-right_0.25s_ease-out]">
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-custom px-4 py-3">
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
          // 三元里 TS 不会跨分支收窄 content（仍可能为 null）。
          // 走到这里 content 必非 null，用 `!` 显式断言。
          <CodeWithLineNumbers content={content!} />
        )}
      </div>
    </section>
  )
}

/** 纯文本内容 + 行号渲染。md 不走这里（行号会打散 markdown 结构）。 */
function CodeWithLineNumbers({ content }: { content: string }) {
  const lines = content.split('\n')
  // 行号宽度：取总行数的位数（10 行 → 2ch，1000 行 → 4ch），加右侧 padding。
  const gutterWidth = Math.max(2, String(lines.length).length) + 1
  return (
    <pre className="font-mono text-xs text-text-primary leading-5">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span
            className="select-none pr-3 text-right text-text-muted/50 shrink-0 tabular-nums"
            style={{ width: `${gutterWidth}ch` }}
          >
            {i + 1}
          </span>
          <span className="whitespace-pre-wrap break-all flex-1 min-w-0">
            {line || ' '}
          </span>
        </div>
      ))}
    </pre>
  )
}
