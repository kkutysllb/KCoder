// FilePreviewPanel — 应用内文件预览右栏（三分栏布局的第三栏）。
//
// 全局单例（App.tsx 挂载），作为 flex 布局的第三栏参与文档流：打开时
// 主内容区（聊天区）自动收缩让位，不浮动覆盖 workspace 内容；关闭时
// 整栏移除。参考 Codex 的右侧文件预览设计。
//
// 数据经 GET /v1/threads/:id/file 拉取，md 文件渲染 markdown，其余纯文本。
// 挂载时播放 slide-in-right 滑入动画（视觉上从右侧滑出）。

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI } from '../../services/engine-api'
import { CodeEditor } from '../CodeEditor'
import { EditorTabs } from '../EditorTabs'
import { useI18n } from '../../i18n'

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
  const workspacePath = useAppStore((s) => s.workspacePath)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const { t } = useI18n()
  // 编辑状态上提到 store（按路径持久化）：切 Tab 不丢失未保存修改。
  // store 键 = path prop（与 openFilePreview 存入的键一致）。
  const editedContent = useAppStore((s) => s.tabEdited[path])
  const dirty = useAppStore((s) => !!s.tabDirty[path])
  const setTabEdited = useAppStore((s) => s.setTabEdited)
  const setTabDirty = useAppStore((s) => s.setTabDirty)

  const decodedPath = safeDecodePath(path)
  const isVirtual = decodedPath.startsWith('/mnt/')
  // 仅工作区（真实）路径可编辑；虚拟沙箱路径只读
  const editable = !isVirtual

  const handleSave = useCallback(async () => {
    if (!dirty || editedContent == null) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await getEngineAPI(enginePort).writeWorkspaceFile(decodedPath, editedContent)
      setContent(editedContent)
      setTabDirty(path, false)
      setSaveMsg(t('editor.saved'))
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (e) {
      setSaveMsg(`${t('editor.saveFailed')}: ${e}`)
    } finally {
      setSaving(false)
    }
  }, [dirty, editedContent, decodedPath, enginePort])

  useEffect(() => {
    let cancelled = false
    setSaveMsg(null)
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
            // 沙箱虚拟路径在 thread 端点找不到（404）→ 尝试剥离 /mnt/[user-data/][workspace/]
            // 前缀，按工作区相对路径用 workspace 端点读取（agent 常以沙箱路径引用工作区文件）
            const rel = decodedPath.replace(/^\/mnt\/(?:user-data\/)?(?:workspace\/)?/, '')
            if (workspacePath && rel && rel !== decodedPath) {
              try {
                const data = await getEngineAPI(enginePort).readWorkspaceFile(
                  `${workspacePath}/${rel}`.replace(/\/+/g, '/')
                )
                if (!cancelled) {
                  setContent(data.truncated ? `${data.content}\n\n${t('editor.truncated')}` : data.content)
                  return
                }
              } catch {
                /* 回退也失败，落到下面的错误提示 */
              }
            }
            const text = await res.text().catch(() => res.statusText)
            if (!cancelled) setError(`Failed to load: ${text}`)
            return
          }
          const text = await res.text()
          if (!cancelled) setContent(text)
        } else {
          const data = await getEngineAPI(enginePort).readWorkspaceFile(decodedPath)
          if (!cancelled) {
            setContent(data.truncated ? `${data.content}\n\n${t('editor.truncated')}` : data.content)
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
    <section className="relative z-[55] flex h-full w-[640px] shrink-0 flex-col overflow-hidden border-l border-border-custom bg-bg-primary animate-[slide-in-right_0.25s_ease-out]">
      {/* 多 Tab 栏 */}
      <EditorTabs />
      {/* 标题栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-custom px-4 py-3">
        <span
          className="min-w-0 flex-1 truncate font-mono text-sm text-text-primary"
          title={decodedPath}
        >
          {fileName}
          {dirty && <span className="ml-1 text-amber">●</span>}
        </span>
        {saveMsg && <span className="shrink-0 text-[10px] text-text-muted">{saveMsg}</span>}
        {editable && (
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            title="保存 (Ctrl/Cmd+S)"
            className={`shrink-0 rounded px-2 py-1 text-xs transition-colors ${
              dirty && !saving
                ? 'bg-info text-white hover:bg-[#2563eb]'
                : 'text-text-muted cursor-default'
            }`}
          >
            {saving ? t('editor.saving') : t('editor.save')}
          </button>
        )}
        {/* 折叠面板（保留 tabs，可从右上按钮再展开） */}
        <button
          onClick={() => useAppStore.getState().toggleFilePreview()}
          className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
          title={t('files.collapsePanel')}
          aria-label="Collapse panel"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 4v16" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 9.5L13 12l-2.5 2.5" />
          </svg>
        </button>
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
      {content == null && error == null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
          <span className="animate-pulse">{t('files.loading')}</span>
        </div>
      ) : error ? (
        <div className="flex-1 overflow-auto p-4 text-sm text-red-400">{error}</div>
      ) : editable ? (
        // 工作区文件：Monaco 可编辑（md 也用编辑器，便于直接改）。
        // 编辑值优先用 store 缓存（tabEdited），切 Tab 回来恢复未保存修改。
        <div className="flex-1 min-h-0">
          <CodeEditor
            path={decodedPath}
            value={editedContent ?? content!}
            onChange={(v) => {
              setTabEdited(path, v)
              setTabDirty(path, v !== content)
            }}
            onSave={handleSave}
          />
        </div>
      ) : isMarkdown ? (
        <div className="flex-1 overflow-auto p-4 markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <CodeEditor path={decodedPath} value={content!} readOnly />
        </div>
      )}
    </section>
  )
}
