import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type AuthUser,
  type ProjectEntry,
  type ThreadSummary
} from '../../services/engine-api'
import { getGeneralPref } from '../../lib/generalPrefs'

// Icons as components
const Icons = {
  NewTask: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Search: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  Clock: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Skills: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Folder: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Hash: () => (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  Back: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
    </svg>
  ),
  Forward: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
    </svg>
  ),
  PanelLeftClose: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 5.25h16.5a.75.75 0 01.75.75v12a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V6a.75.75 0 01.75-.75zM14 9l-3 3 3 3" />
    </svg>
  ),
  SortUpDown: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
    </svg>
  ),
  ArchiveBox: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  Check: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  ChatBubble: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  Plus: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Settings: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Device: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" />
    </svg>
  ),
  Logout: () => (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  )
}

interface SidebarProps {
  onOpenSettings?: (tab?: string) => void
  onToggleCollapse?: () => void
  user?: AuthUser | null
  onOpenAuth?: () => void
  onLogout?: () => void
  onSelectThread?: (threadId: string) => void
  /** 侧栏宽度（外部传入以便支持拖拽缩放） */
  width?: number
}

const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 420

/** 相对时间格式化（"刚刚"/"5分钟前"/"2小时前"/"3天前"） */
function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

/** 归档保留时长转毫秒 */
function parseRetention(retention: string): number {
  const match = retention.match(/^(\d+)([dwm])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // 默认 7 天
  const value = parseInt(match[1], 10)
  const unit = match[2]
  const multipliers = { d: 86400000, w: 604800000, m: 2592000000 }
  return value * (multipliers[unit as keyof typeof multipliers] ?? multipliers.d)
}

/** 路径归一化（容忍尾部斜杠差异，用于 workspace↔project 匹配） */
function normPath(p: string): string {
  return p.replace(/\/+$/, '') || p
}

/** 任务/会话行（项目分组与「会话」分区共用的渲染单元） */
function ThreadRow({
  thread,
  isActive,
  onSelect,
  onArchive,
  onDelete
}: {
  thread: ThreadSummary
  isActive: boolean
  onSelect: () => void
  onArchive: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const { t } = useI18n()
  const time = formatRelativeTime(thread.updatedAt)
  // 标题展示：New Chat → 新对话；空 title → 未命名会话
  const displayTitle = !thread.title
    ? t('sidebar.untitled')
    : thread.title === 'New Chat'
      ? t('sidebar.newChat')
      : thread.title
  return (
    <div
      className={`task-item group w-full ${isActive ? 'bg-bg-hover text-text-primary' : ''} ${thread.archived ? 'opacity-50' : ''}`}
      onClick={onSelect}
      title={displayTitle}
    >
      <span className="truncate flex-1 text-left">{displayTitle}</span>
      <span className="text-xs text-text-muted shrink-0 ml-2 group-hover:hidden">{time}</span>
      {/* Archive toggle — visible on hover */}
      <button
        onClick={onArchive}
        className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-[#10b981] hover:bg-[#10b981]/10 transition-colors shrink-0"
        title={thread.archived ? t('sidebar.unarchive') : t('sidebar.archive')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      </button>
      {/* Delete button — visible on hover */}
      <button
        onClick={onDelete}
        className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors shrink-0"
        title={t('sidebar.delete')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>
    </div>
  )
}

/** View / sort dropdown menu (reference design) */
function SortMenu({
  viewMode,
  sortBy,
  onViewMode,
  onSortBy,
  onClose
}: {
  viewMode: 'project' | 'timeline'
  sortBy: 'updated' | 'created'
  onViewMode: (v: 'project' | 'timeline') => void
  onSortBy: (s: 'updated' | 'created') => void
  onClose: () => void
}) {
  const { t } = useI18n()

  const itemCls = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-[#e5e5e8] hover:bg-[#3a3a3f] transition-colors'

  return (
    <>
      {/* Click-outside backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-[#3a3a3f] bg-[#2b2b30] p-1.5 shadow-2xl">
        <div className="px-2 pt-1.5 pb-1 text-xs text-[#8a8a8f]">{t('sidebar.view')}</div>
        <button className={itemCls} onClick={() => onViewMode('project')}>
          <span className="text-[#8a8a8f]"><Icons.Folder /></span>
          <span>{t('sidebar.viewByProject')}</span>
          {viewMode === 'project' && <span className="ml-auto text-[#10b981]"><Icons.Check /></span>}
        </button>
        <button className={itemCls} onClick={() => onViewMode('timeline')}>
          <span className="text-[#8a8a8f]"><Icons.Clock /></span>
          <span>{t('sidebar.timeline')}</span>
          {viewMode === 'timeline' && <span className="ml-auto text-[#10b981]"><Icons.Check /></span>}
        </button>
        <div className="my-1.5 border-t border-[#3a3a3f]" />
        <div className="px-2 pb-1 text-xs text-[#8a8a8f]">{t('sidebar.sortBy')}</div>
        <button className={itemCls} onClick={() => onSortBy('updated')}>
          <span className="text-[#8a8a8f]"><Icons.ChatBubble /></span>
          <span>{t('sidebar.sortByUpdated')}</span>
          {sortBy === 'updated' && <span className="ml-auto text-[#10b981]"><Icons.Check /></span>}
        </button>
        <button className={itemCls} onClick={() => onSortBy('created')}>
          <span className="text-[#8a8a8f]"><Icons.Plus /></span>
          <span>{t('sidebar.sortByCreated')}</span>
          {sortBy === 'created' && <span className="ml-auto text-[#10b981]"><Icons.Check /></span>}
        </button>
      </div>
    </>
  )
}

export function Sidebar({ onOpenSettings, onToggleCollapse, user, onOpenAuth, onLogout, onSelectThread, width }: SidebarProps) {
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [sortBy, setSortBy] = useState<'updated' | 'created'>('updated')
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [loadingThreads, setLoadingThreads] = useState(false)
  // 已尝试自动注册的 workspace 路径（防重复请求）
  const autoRegisteredRef = useRef<Set<string>>(new Set())
  const { enginePort, engineStatus, threadId, setThreadId, setWorkspacePath, clearMessages } = useAppStore()
  const { t } = useI18n()

  // 加载会话列表
  const loadThreads = useCallback(async () => {
    if (engineStatus !== 'connected') {
      console.log('[KCoder] loadThreads: skipped, engineStatus =', engineStatus)
      return
    }
    setLoadingThreads(true)
    try {
      const api = getEngineAPI(enginePort)
      const result = await api.listThreads({ includeArchived: true })
      console.log('[KCoder] loadThreads: got', result.threads.length, 'threads from port', enginePort)
      // 按更新时间降序
      const sorted = [...result.threads].sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      )
      setThreads(sorted)

      // 项目实体列表（老 gateway 无此端点时忽略，保持旧行为）
      let projectsList: ProjectEntry[] = []
      try {
        projectsList = (await api.listProjects()).projects
      } catch {
        projectsList = []
      }

      // 老数据兜底：workspace 非空但未注册项目的任务 → 自动注册项目。
      // 保证「项目」分区永不丢数据（幂等 upsert，后端按 path 去重）。
      const registeredPaths = new Set(projectsList.map((p) => normPath(p.path)))
      for (const thread of sorted) {
        const ws = thread.workspace?.trim()
        if (!ws || registeredPaths.has(normPath(ws))) continue
        if (autoRegisteredRef.current.has(ws)) continue
        autoRegisteredRef.current.add(ws)
        try {
          const entry = await api.createProject(ws)
          projectsList = [
            ...projectsList.filter((p) => p.id !== entry.id),
            entry
          ]
        } catch (error) {
          console.error('[KCoder] Failed to auto-register project:', ws, error)
        }
      }
      setProjects(projectsList)

      // 自动归档：超过保留期且未归档的会话标记为 archived
      if (getGeneralPref('autoArchive')) {
        const retentionMs = parseRetention(getGeneralPref('archiveRetention'))
        const now = Date.now()
        const toArchive = sorted.filter(
          (t) => !t.archived && t.updatedAt && now - new Date(t.updatedAt).getTime() > retentionMs
        )
        if (toArchive.length > 0) {
          await Promise.all(
            toArchive.map((t) => api.updateThread(t.id, { archived: true }).catch(() => {}))
          )
          const refreshed = await api.listThreads({ includeArchived: true })
          setThreads(
            [...refreshed.threads].sort((a, b) =>
              (b.updatedAt || '').localeCompare(a.updatedAt || '')
            )
          )
        }
      }
    } catch (error) {
      console.error('[KCoder] Failed to load threads:', error)
      // 重试一次（引擎可能刚启动，store 还没 ready）
      setTimeout(async () => {
        try {
          const api = getEngineAPI(enginePort)
          const result = await api.listThreads({ includeArchived: true })
          setThreads([...result.threads].sort((a, b) =>
            (b.updatedAt || '').localeCompare(a.updatedAt || '')
          ))
        } catch {
          // 静默 — 下次 selectThread/loadThread 时会重新触发
        }
      }, 2000)
    } finally {
      setLoadingThreads(false)
    }
  }, [enginePort, engineStatus])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  // 切换到某个会话
  const selectThread = useCallback((id: string, workspace?: string) => {
    setThreadId(id)
    if (workspace) setWorkspacePath(workspace)
    onSelectThread?.(id)
  }, [setThreadId, setWorkspacePath, onSelectThread])

  // 新建会话 — 清空当前消息（窄条上的目录/分支/模型选择保留在 store 中）
  const handleNewChat = useCallback(() => {
    clearMessages()
    setThreadId(null)
  }, [clearMessages, setThreadId])

  // 删除会话 — 调引擎 DELETE /v1/threads/:id（递归删除线程目录全部数据）
  const handleDeleteThread = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(t('sidebar.deleteConfirm'))) return
    try {
      const api = getEngineAPI(enginePort)
      const deleted = await api.deleteThread(id)
      if (deleted) {
        setThreads((prev) => prev.filter((t) => t.id !== id))
        // 如果删除的是当前线程，清空消息
        if (id === threadId) {
          clearMessages()
          setThreadId(null)
        }
      }
    } catch (error) {
      console.error('[KCoder] Failed to delete thread:', error)
      alert(t('sidebar.deleteFailed'))
    }
  }, [enginePort, threadId, clearMessages, setThreadId, t])

  // 归档 / 取消归档
  const handleArchiveToggle = useCallback(async (id: string, currentlyArchived: boolean | undefined, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const api = getEngineAPI(enginePort)
      await api.updateThread(id, { archived: !currentlyArchived })
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, archived: !currentlyArchived } : t)))
    } catch (error) {
      console.error('[KCoder] Failed to toggle archive:', error)
    }
  }, [enginePort])

  // 归档过滤：showArchived 为 false 时只显示未归档会话
  const visibleThreads = showArchived ? threads : threads.filter((t) => !t.archived)

  // 切换项目分组折叠态
  const toggleProjectCollapse = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])

  // 新建项目 — 打开文件夹选择器并注册
  const handleAddProject = useCallback(async () => {
    const picked = await window.kcoder?.dialog?.openFolder()
    if (!picked) return
    try {
      const api = getEngineAPI(enginePort)
      const entry = await api.createProject(picked)
      setProjects((prev) => [...prev.filter((p) => p.id !== entry.id), entry])
    } catch (error) {
      console.error('[KCoder] Failed to add project:', error)
      alert(t('sidebar.addProjectFailed'))
    }
  }, [enginePort, t])

  // 重命名项目
  const handleRenameProject = useCallback(async (project: ProjectEntry) => {
    const name = prompt(t('sidebar.projectNamePrompt'), project.name)
    if (!name || !name.trim() || name.trim() === project.name) return
    try {
      const api = getEngineAPI(enginePort)
      const updated = await api.updateProject(project.id, { name: name.trim() })
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updated : p)))
    } catch (error) {
      console.error('[KCoder] Failed to rename project:', error)
      alert(t('sidebar.renameFailed'))
    }
  }, [enginePort, t])

  // 删除项目 — 注销注册，其下任务由后端自动归档
  const handleDeleteProject = useCallback(async (project: ProjectEntry) => {
    const count = threads.filter(
      (th) => normPath(th.workspace) === normPath(project.path) && !th.archived
    ).length
    const message = t('sidebar.deleteProjectConfirm')
      .replace('{name}', project.name)
      .replace('{count}', String(count))
    if (!confirm(message)) return
    try {
      const api = getEngineAPI(enginePort)
      await api.deleteProject(project.id)
      setProjects((prev) => prev.filter((p) => p.id !== project.id))
      await loadThreads()
    } catch (error) {
      console.error('[KCoder] Failed to delete project:', error)
      alert(t('sidebar.deleteProjectFailed'))
    }
  }, [enginePort, t, threads, loadThreads])

  // ── 双分区分组计算（任务归项目 / 普通对话归会话） ────────────────
  // 任务：workspace 非空（创建时绑定目录）
  const taskThreads = visibleThreads.filter((t) => t.workspace?.trim())
  // 会话：workspace 为空（不绑定项目的普通对话）
  const chatThreads = visibleThreads.filter((t) => !t.workspace?.trim())

  // 线程排序：sortBy 生效（默认按更新时间降序）
  const sortThreads = (list: ThreadSummary[]): ThreadSummary[] => {
    const key = sortBy === 'created' ? 'createdAt' : 'updatedAt'
    return [...list].sort((a, b) => (b[key] || '').localeCompare(a[key] || ''))
  }

  // 任务按项目实体分组：优先匹配已注册项目（路径归一化比较）；
  // 未匹配的兜底临时分组（正常情况下已被 loadThreads 自动注册补齐）
  const byPath = new Map<string, ProjectEntry>()
  for (const p of projects) byPath.set(normPath(p.path), p)
  const groupMap = new Map<
    string,
    { key: string; project: ProjectEntry | null; threads: ThreadSummary[] }
  >()
  for (const thread of taskThreads) {
    const project = byPath.get(normPath(thread.workspace)) ?? null
    const key = project ? project.id : `__ws__${thread.workspace}`
    const group = groupMap.get(key) ?? { key, project, threads: [] }
    group.threads.push(thread)
    groupMap.set(key, group)
  }
  const timeKey = sortBy === 'created' ? 'createdAt' : 'updatedAt'
  const projectGroups = Array.from(groupMap.values())
    .map((g) => ({ ...g, threads: sortThreads(g.threads) }))
    .sort(
      (a, b) =>
        (b.threads[0]?.[timeKey] || '').localeCompare(a.threads[0]?.[timeKey] || '')
    )
  const sortedChatThreads = sortThreads(chatThreads)

  return (
    <div
      className="h-full bg-bg-sidebar flex flex-col border-r border-border-custom shrink-0"
      style={{ width: width ?? DEFAULT_SIDEBAR_WIDTH }}
    >
      {/* Top bar - leave space for real macOS traffic lights (hiddenInset at x:16,y:16) */}
      <div className="drag-region h-12 flex items-center px-3">
        <div className="no-drag flex items-center gap-0.5 ml-20 text-[#8a8a8f]">
          {/* 历史导航后退（保留为导航按钮，不复用为折叠） */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => window.history.back()}
            title={t('sidebar.back')}
          >
            <Icons.Back />
          </button>
          {/* 历史导航前进 */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => window.history.forward()}
            title={t('sidebar.forward')}
          >
            <Icons.Forward />
          </button>
          {/* 分隔 */}
          <div className="w-px h-3.5 bg-border-custom mx-0.5" />
          {/* 折叠侧边栏（专门按钮，与历史导航分离） */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={onToggleCollapse}
            title={t('sidebar.collapse')}
          >
            <Icons.PanelLeftClose />
          </button>
        </div>
      </div>

      {/* Navigation items */}
      <div className="px-3 py-2 space-y-0.5">
        <button className="sidebar-item w-full" onClick={handleNewChat}>
          <Icons.NewTask />
          <span>{t('sidebar.newTask')}</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Search />
          <span>{t('sidebar.search')}</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Clock />
          <span>{t('sidebar.scheduledTasks')}</span>
        </button>
        <button className="sidebar-item w-full" onClick={() => onOpenSettings?.('skills')}>
          <Icons.Skills />
          <span>{t('sidebar.skills')}</span>
        </button>
      </div>

      {/* sort/archive controls */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <div className="relative">
            <button
              onClick={() => setShowSortMenu(v => !v)}
              className={`p-1.5 rounded-md transition-colors ${
                showSortMenu ? 'text-white bg-bg-hover' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
              }`}
              title={t('sidebar.sort')}
            >
              <Icons.SortUpDown />
            </button>
            {showSortMenu && (
              <SortMenu
                viewMode="project"
                sortBy={sortBy}
                onViewMode={() => setShowSortMenu(false)}
                onSortBy={(s) => { setSortBy(s); setShowSortMenu(false) }}
                onClose={() => setShowSortMenu(false)}
              />
            )}
          </div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`p-1.5 rounded-md transition-colors ${
              showArchived ? 'text-white bg-bg-hover' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
            }`}
            title={t('sidebar.archive')}
          >
            <Icons.ArchiveBox />
          </button>
        </div>
      </div>

      {/* Section: 项目（一等实体分组，下挂任务） */}
      <div className="px-4 pt-1 pb-1 flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-primary">{t('sidebar.project')}</span>
        <button
          onClick={handleAddProject}
          className="p-1 rounded-md text-text-muted hover:text-white hover:bg-bg-hover transition-colors"
          title={t('sidebar.addProject')}
        >
          <Icons.Plus />
        </button>
      </div>

      {/* 项目/会话列表（双分区：任务归项目，普通对话归会话） */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">加载中…</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">
            {engineStatus === 'connected' ? '暂无会话，点击「新建任务」开始' : '引擎未连接'}
          </div>
        )}

        {/* 项目分组：可折叠、hover 重命名/删除 */}
        {projectGroups.map(({ key, project, threads: taskList }) => {
          const collapsed = collapsedProjects.has(key)
          const projectName = project?.name ?? (project?.path.split('/').pop() || key)
          return (
            <div key={key} className="mb-2">
              <div className="group flex items-center gap-1 px-2 py-1.5 text-[12px] font-medium text-text-secondary rounded-md hover:bg-bg-hover transition-colors">
                <button
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  onClick={() => toggleProjectCollapse(key)}
                >
                  <svg className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  <Icons.Folder />
                  <span className="truncate" title={project?.path}>{projectName}</span>
                  <span className="text-[10px] opacity-60 shrink-0">{taskList.length}</span>
                </button>
                {project && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => handleRenameProject(project)}
                      className="p-1 rounded text-text-muted hover:text-white hover:bg-bg-hover/60 transition-colors"
                      title={t('sidebar.renameProject')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project)}
                      className="p-1 rounded text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                      title={t('sidebar.deleteProject')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
              {!collapsed && (
                <div className="space-y-0.5 mt-0.5">
                  {taskList.map(thread => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === threadId}
                      onSelect={() => selectThread(thread.id, thread.workspace)}
                      onArchive={(e) => handleArchiveToggle(thread.id, thread.archived, e)}
                      onDelete={(e) => handleDeleteThread(thread.id, e)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Section: 会话（不绑定项目的普通对话，时间序平铺） */}
        <div className="px-1 pt-3 pb-1 text-[13px] font-medium text-text-primary">
          {t('sidebar.chats')}
        </div>
        <div className="space-y-0.5">
          {sortedChatThreads.map(thread => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === threadId}
              onSelect={() => selectThread(thread.id, thread.workspace)}
              onArchive={(e) => handleArchiveToggle(thread.id, thread.archived, e)}
              onDelete={(e) => handleDeleteThread(thread.id, e)}
            />
          ))}
        </div>
      </div>

      {/* User profile */}
      <div className="px-3 py-3 border-t border-border-custom">
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-text-primary truncate max-w-[100px]" title={user.email}>
                {user.email.split('@')[0]}
              </span>
              {user.is_admin && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-[#3b82f6]/15 text-[#3b82f6]">{t('auth.badge.admin')}</span>
              )}
              <div className="ml-auto flex items-center gap-2 text-text-muted">
                <button
                  className="hover:text-text-secondary transition-colors"
                  title={t('auth.logout')}
                  onClick={onLogout}
                >
                  <Icons.Logout />
                </button>
                <button className="hover:text-text-secondary transition-colors" onClick={() => onOpenSettings?.()}>
                  <Icons.Settings />
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                onClick={onOpenAuth}
                title={t('auth.loginHint')}
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
                  U
                </div>
                <span className="text-sm text-text-primary">{t('sidebar.user')}</span>
              </button>
              <div className="ml-auto flex items-center gap-2 text-text-muted">
                <button className="hover:text-text-secondary transition-colors">
                  <Icons.Device />
                </button>
                <button className="hover:text-text-secondary transition-colors" onClick={() => onOpenSettings?.()}>
                  <Icons.Settings />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
