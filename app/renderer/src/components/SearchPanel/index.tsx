// SearchPanel — 工作区全文搜索（find in files）。
//
// 消费 POST /v1/workspace/search（ripgrep）。结果按文件分组，点击命中 →
// onOpenFile(path) 打开文件（进 FilePreviewPanel）。与文件树共用左栏抽屉：
// 搜索框有内容时显示结果，否则隐藏本面板、显示文件树。

import { useEffect, useRef, useState } from 'react'
import { getEngineAPI, type SearchHit } from '../../services/engine-api'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'

interface SearchPanelProps {
  rootPath: string
  query: string
  onOpenFile: (path: string) => void
}

export function SearchPanel({ rootPath, query, onOpenFile }: SearchPanelProps) {
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enginePort = useAppStore((s) => s.enginePort)
  const reqId = useRef(0)
  const { t } = useI18n()

  useEffect(() => {
    const q = query.trim()
    if (!q || !rootPath) {
      setResults([])
      setTruncated(false)
      setError(null)
      return
    }
    const myId = ++reqId.current
    setLoading(true)
    setError(null)
    const debounce = setTimeout(async () => {
      try {
        const data = await getEngineAPI(enginePort).workspaceSearch(rootPath, q, { maxResults: 200 })
        if (myId !== reqId.current) return // 被更新的请求取代
        setResults(data.results)
        setTruncated(data.truncated)
      } catch (e) {
        if (myId !== reqId.current) return
        setError(String(e))
        setResults([])
      } finally {
        if (myId === reqId.current) setLoading(false)
      }
    }, 300) // 防抖
    return () => clearTimeout(debounce)
  }, [query, rootPath, enginePort])

  if (!query.trim()) return null

  // 按文件分组
  const groups = new Map<string, SearchHit[]>()
  for (const h of results) {
    const arr = groups.get(h.file) ?? []
    arr.push(h)
    groups.set(h.file, arr)
  }

  return (
    <div className="py-1">
      {loading && (
        <div className="px-3 py-1 text-[11px] text-text-muted">{t('files.searching')}</div>
      )}
      {error && (
        <div className="px-3 py-1 text-[11px] text-red-400">{error}</div>
      )}
      {!loading && results.length === 0 && !error && (
        <div className="px-3 py-2 text-[11px] text-text-muted">{t('files.noResults')}</div>
      )}
      {Array.from(groups.entries()).map(([file, hits]) => (
        <div key={file} className="mb-1">
          <div className="px-2 py-1 text-[11px] font-medium text-[#5b9bd5] truncate" title={file}>
            {file}
            <span className="ml-1 text-text-muted font-normal">({hits.length})</span>
          </div>
          {hits.map((h, i) => (
            <button
              key={`${h.file}-${h.line}-${i}`}
              onClick={() => onOpenFile(`${rootPath}/${h.file}`)}
              className="flex w-full items-start gap-2 rounded px-2 py-0.5 text-left hover:bg-bg-hover"
            >
              <span className="shrink-0 text-[10px] text-text-muted font-mono pt-0.5">{h.line}</span>
              <code className="min-w-0 flex-1 truncate text-[11px] text-text-secondary font-mono">
                {h.text.trim()}
              </code>
            </button>
          ))}
        </div>
      ))}
      {truncated && (
        <div className="px-3 py-1 text-[10px] text-text-muted">{t('files.truncated')}</div>
      )}
    </div>
  )
}
