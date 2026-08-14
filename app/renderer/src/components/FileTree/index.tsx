// FileTree — 工作区文件树浏览器。
//
// 懒加载：目录首次展开时调 GET /v1/workspace/tree 拉单层条目。文件点击 →
// onOpenFile(absolutePath)（由父级决定如何打开，通常进 FilePreviewPanel）。
// 隐藏的目录（node_modules/.venv/.git 等）已在后端过滤。

import { useEffect, useState, useCallback, useRef } from 'react'
import { getEngineAPI, type WorkspaceTreeEntry } from '../../services/engine-api'
import { useAppStore } from '../../stores/app-store'

interface FileTreeProps {
  rootPath: string
  onOpenFile: (path: string) => void
}

interface Node {
  name: string
  path: string
  type: 'dir' | 'file'
}

export function FileTree({ rootPath, onOpenFile }: FileTreeProps) {
  if (!rootPath) {
    return (
      <div className="px-3 py-6 text-center text-xs text-text-muted">
        未选择工作区目录
      </div>
    )
  }
  return (
    <div className="py-1 text-sm">
      <DirNode
      name={rootPath.split('/').pop() || rootPath}
      path={rootPath}
      depth={0}
      defaultOpen
      onOpenFile={onOpenFile}
      />
    </div>
  )
}

function DirNode({
  name,
  path,
  depth,
  defaultOpen,
  onOpenFile
}: {
  name: string
  path: string
  depth: number
  defaultOpen?: boolean
  onOpenFile: (path: string) => void
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [entries, setEntries] = useState<Node[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enginePort = useAppStore((s) => s.enginePort)
  const fetchedRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getEngineAPI(enginePort).workspaceTree(path)
      setEntries(data.entries.map((e: WorkspaceTreeEntry) => ({ name: e.name, path: `${path}/${e.name}`, type: e.type })))
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [path, enginePort])

  useEffect(() => {
    if (defaultOpen && !fetchedRef.current) {
      fetchedRef.current = true
      load()
    }
  }, [defaultOpen, load])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !entries && !fetchedRef.current) {
      fetchedRef.current = true
      load()
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[13px] text-text-secondary hover:bg-bg-hover"
        style={{ paddingLeft: depth * 12 + 6 }}
        title={path}
      >
        <svg
          className={`w-3 h-3 shrink-0 text-text-muted transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <svg className="w-3.5 h-3.5 shrink-0 text-[#5b9bd5]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="truncate">{name}</span>
      </button>
      {open && (
        <div>
          {loading && (
            <div className="px-3 py-1 text-[11px] text-text-muted" style={{ paddingLeft: depth * 12 + 30 }}>加载中…</div>
          )}
          {error && (
            <div className="px-3 py-1 text-[11px] text-red-400" style={{ paddingLeft: depth * 12 + 30 }}>{error}</div>
          )}
          {entries?.map((e) =>
            e.type === 'dir' ? (
              <DirNode
                key={e.path}
                name={e.name}
                path={e.path}
                depth={depth + 1}
                onOpenFile={onOpenFile}
              />
            ) : (
              <FileNode key={e.path} name={e.name} path={e.path} depth={depth + 1} onClick={() => onOpenFile(e.path)} />
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileNode({ name, path, depth, onClick }: { name: string; path: string; depth: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[13px] text-text-secondary hover:bg-bg-hover hover:text-text-primary"
      style={{ paddingLeft: depth * 12 + 24 }}
      title={path}
    >
      <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <span className="truncate">{name}</span>
    </button>
  )
}
