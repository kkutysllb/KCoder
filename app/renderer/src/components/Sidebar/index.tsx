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
import {
  IconArchiveBox,
  IconBolt,
  IconChatBubble,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconDevice,
  IconFolder,
  IconLogout,
  IconPanelLeftClose,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSortUpDown,
  IconTrash
} from '../icons'

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
/** 项目下默认展示的最近任务数，超出部分折叠到「更多」 */
const DEFAULT_VISIBLE_TASKS = 5

/** 相对时间格式化（"刚刚"/"5分钟前"/"2小时前"/"3天前"，走 i18n） */
function formatRelativeTime(
  iso: string,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string
): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ''
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('time.justNow')
  if (min < 60) return t('time.minutesAgo', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('time.hoursAgo', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 30) return t('time.daysAgo', { n: day })
  return new Date(ts).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN')
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
  const { t, locale } = useI18n()
  const time = formatRelativeTime(thread.updatedAt, t, locale)
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
        className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-teal hover:bg-teal/10 transition-colors shrink-0"
        title={thread.archived ? t('sidebar.unarchive') : t('sidebar.archive')}
      >
        <IconArchiveBox className="w-3.5 h-3.5" />
      </button>
      {/* Delete button — visible on hover */}
      <button
        onClick={onDelete}
        className="hidden group-hover:flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
        title={t('sidebar.delete')}
      >
        <IconTrash className="w-3.5 h-3.5" />
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

  const itemCls = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-primary hover:bg-bg-active transition-colors'

  return (
    <>
      {/* Click-outside backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-border-strong bg-bg-hover p-1.5 shadow-2xl">
        <div className="px-2 pt-1.5 pb-1 text-xs text-muted-icon">{t('sidebar.view')}</div>
        <button className={itemCls} onClick={() => onViewMode('project')}>
          <span className="text-muted-icon"><IconFolder /></span>
          <span>{t('sidebar.viewByProject')}</span>
          {viewMode === 'project' && <span className="ml-auto text-teal"><IconCheck /></span>}
        </button>
        <button className={itemCls} onClick={() => onViewMode('timeline')}>
          <span className="text-muted-icon"><IconClock /></span>
          <span>{t('sidebar.timeline')}</span>
          {viewMode === 'timeline' && <span className="ml-auto text-teal"><IconCheck /></span>}
        </button>
        <div className="my-1.5 border-t border-border-strong" />
        <div className="px-2 pb-1 text-xs text-muted-icon">{t('sidebar.sortBy')}</div>
        <button className={itemCls} onClick={() => onSortBy('updated')}>
          <span className="text-muted-icon"><IconChatBubble /></span>
          <span>{t('sidebar.sortByUpdated')}</span>
          {sortBy === 'updated' && <span className="ml-auto text-teal"><IconCheck /></span>}
        </button>
        <button className={itemCls} onClick={() => onSortBy('created')}>
          <span className="text-muted-icon"><IconPlus /></span>
          <span>{t('sidebar.sortByCreated')}</span>
          {sortBy === 'created' && <span className="ml-auto text-teal"><IconCheck /></span>}
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
  // 展开全部任务的项目（默认只展示最近 DEFAULT_VISIBLE_TASKS 个）
  const [showAllProjects, setShowAllProjects] = useState<Set<string>>(new Set())
  // 会话区折叠态
  const [chatsCollapsed, setChatsCollapsed] = useState(false)
  const [loadingThreads, setLoadingThreads] = useState(false)
  // 已尝试自动注册的 workspace 路径（防重复请求）
  const autoRegisteredRef = useRef<Set<string>>(new Set())
  const { enginePort, engineStatus, threadId, workspacePath, setThreadId, setWorkspacePath, clearMessages, setPanelOpen, threadListVersion } = useAppStore()
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
      // 归档线程跳过（隐藏历史不需要重新注册）；死路径走 silentMissing，
      // 后端 200 skipped，不在开发者面板刷 400。
      const registeredPaths = new Set(projectsList.map((p) => normPath(p.path)))
      for (const thread of sorted) {
        if (thread.archived) continue
        const ws = thread.workspace?.trim()
        if (!ws || registeredPaths.has(normPath(ws))) continue
        if (autoRegisteredRef.current.has(ws)) continue
        autoRegisteredRef.current.add(ws)
        try {
          const entry = await api.createProject(ws, undefined, { silentMissing: true })
          if ('skipped' in entry) continue
          const registered = entry as ProjectEntry
          projectsList = [
            ...projectsList.filter((p) => p.id !== registered.id),
            registered
          ]
        } catch (error) {
          // 兜底：非 200 的失败按「目录已删」静默跳过，其余才报错
          if (error instanceof Error && error.message.includes('Directory does not exist')) {
            console.warn('[KCoder] Skip auto-register (directory gone):', ws)
          } else {
            console.error('[KCoder] Failed to auto-register project:', ws, error)
          }
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
  }, [loadThreads, threadListVersion])

  // 切换到某个会话。编码任务（有 workspace）默认展开浮动面板（Git/计划/进度），
  // 普通对话（无 workspace）默认收起——面板的 Git 段对普通对话无意义。
  // 用户仍可手动 toggle 覆盖。
  const selectThread = useCallback((id: string, workspace?: string) => {
    setThreadId(id)
    if (workspace) setWorkspacePath(workspace)
    setPanelOpen(!!workspace)
    onSelectThread?.(id)
  }, [setThreadId, setWorkspacePath, setPanelOpen, onSelectThread])

  // 新建会话 — 清空当前消息（窄条上的目录/分支/模型选择保留在 store 中）
  const handleNewChat = useCallback(() => {
    clearMessages()
    setThreadId(null)
  }, [clearMessages, setThreadId])

  // 在指定项目下新建任务：绑定该项目 workspace 并开启全新会话。
  // thread 的 workspace 在创建时绑定，首条消息发送后即归入该项目分组。
  const handleNewTaskInProject = useCallback((project: ProjectEntry, groupKey: string) => {
    clearMessages() // 重置 threadId/messages 等，下一条消息创建新线程
    setPanelOpen(false) // 新任务从干净布局开始；首条消息会自动展开浮动面板
    setWorkspacePath(project.path)
    // 展开该项目分组，便于看到即将出现的新任务
    setCollapsedProjects((prev) => {
      if (!prev.has(groupKey)) return prev
      const next = new Set(prev)
      next.delete(groupKey)
      return next
    })
  }, [clearMessages, setPanelOpen, setWorkspacePath])

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

  // 切换项目内任务列表「显示全部/收起最近 5 个」
  const toggleShowAll = useCallback((projectId: string) => {
    setShowAllProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])

  // 新建项目 — 打开文件夹选择器并注册（入口：输入框目录选择器之外的后备）。
  // 注册成功后同时将其选为当前 workspace：否则 store 仍指向旧项目（或为空），
  // 下一条消息会创建绑定旧 workspace 的线程，agent 将分析错项目。
  const handleAddProject = useCallback(async () => {
    const picked = await window.kcoder?.dialog?.openFolder()
    if (!picked) return
    try {
      const api = getEngineAPI(enginePort)
      // 对话框选择的目录必然存在（且未带 silentMissing，缺失会 400），
      // 因此这里返回值一定是 ProjectEntry。
      const entry = (await api.createProject(picked)) as ProjectEntry
      setProjects((prev) => [...prev.filter((p) => p.id !== entry.id), entry])
      // 切换 workspace = 开启新会话（thread 的 workspace 创建时绑定，不可改）
      if (picked !== workspacePath) {
        clearMessages()
        setPanelOpen(false)
        setWorkspacePath(picked)
      }
    } catch (error) {
      console.error('[KCoder] Failed to add project:', error)
      alert(t('sidebar.addProjectFailed'))
    }
  }, [enginePort, workspacePath, clearMessages, setPanelOpen, setWorkspacePath, t])

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
        <div className="no-drag flex items-center gap-0.5 ml-20 text-muted-icon">
          {/* 历史导航后退（保留为导航按钮，不复用为折叠） */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => window.history.back()}
            title={t('sidebar.back')}
          >
            <IconChevronLeft />
          </button>
          {/* 历史导航前进 */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => window.history.forward()}
            title={t('sidebar.forward')}
          >
            <IconChevronRight />
          </button>
          {/* 分隔 */}
          <div className="w-px h-3.5 bg-border-custom mx-0.5" />
          {/* 折叠侧边栏（专门按钮，与历史导航分离） */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={onToggleCollapse}
            title={t('sidebar.collapse')}
          >
            <IconPanelLeftClose />
          </button>
        </div>
      </div>

      {/* 品牌标识 */}
      <div className="flex items-center gap-2 px-4 pt-2 pb-1.5">
        <img src="/favicon-64.png" alt="KCoder" className="h-6 w-6 rounded-md" />
        <span className="text-sm font-semibold text-text-primary tracking-[0.08em]">KCoder</span>
      </div>

      {/* Navigation items */}
      <div className="px-3 py-2 space-y-0.5">
        <button className="sidebar-item w-full" onClick={handleNewChat}>
          <IconPlus />
          <span>{t('sidebar.newTask')}</span>
        </button>
        <button className="sidebar-item w-full cursor-not-allowed opacity-45" disabled title={t('common.comingSoon')}>
          <IconSearch />
          <span>{t('sidebar.search')}</span>
        </button>
        <button className="sidebar-item w-full cursor-not-allowed opacity-45" disabled title={t('common.comingSoon')}>
          <IconClock />
          <span>{t('sidebar.scheduledTasks')}</span>
        </button>
        <button className="sidebar-item w-full" onClick={() => onOpenSettings?.('skills')}>
          <IconBolt />
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
                showSortMenu ? 'text-text-primary bg-bg-hover' : 'text-muted-icon hover:text-text-primary hover:bg-bg-hover'
              }`}
              title={t('sidebar.sort')}
            >
              <IconSortUpDown />
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
              showArchived ? 'text-text-primary bg-bg-hover' : 'text-muted-icon hover:text-text-primary hover:bg-bg-hover'
            }`}
            title={t('sidebar.archive')}
          >
            <IconArchiveBox />
          </button>
        </div>
      </div>

      {/* Section: 项目（一等实体分组，下挂任务）。
          不放「添加项目」＋按钮——与项目行 hover 的「＋新建任务」视觉重复；
          添加项目的入口是输入框窄条的目录选择器（发消息时自动注册项目）。 */}
      <div className="px-4 pt-1 pb-1 flex items-center">
        <span className="text-[13px] font-medium text-text-primary">{t('sidebar.project')}</span>
      </div>

      {/* 项目/会话列表（双分区：任务归项目，普通对话归会话） */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">{t('sidebar.loading')}</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">
            {engineStatus === 'connected' ? t('sidebar.empty') : t('sidebar.engineOffline')}
          </div>
        )}

        {/* 项目分组：点击名称折叠/展开，hover 重命名/删除 */}
        {projectGroups.map(({ key, project, threads: taskList }) => {
          const collapsed = collapsedProjects.has(key)
          const showAll = showAllProjects.has(key)
          const projectName = project?.name ?? (project?.path.split('/').pop() || key)
          // 默认只展示最近 DEFAULT_VISIBLE_TASKS 个任务，其余通过「更多」展开
          const visibleTasks = showAll ? taskList : taskList.slice(0, DEFAULT_VISIBLE_TASKS)
          return (
            <div key={key} className="mb-2">
              <div className="group flex items-center gap-1 px-2 py-1.5 text-[12px] font-medium text-text-secondary rounded-md hover:bg-bg-hover transition-colors">
                <button
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                  onClick={() => toggleProjectCollapse(key)}
                  title={project?.path}
                >
                  <IconFolder />
                  <span className="truncate">{projectName}</span>
                  <span className="text-[10px] opacity-60 shrink-0">{taskList.length}</span>
                </button>
                {project && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => handleNewTaskInProject(project, key)}
                      className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover/60 transition-colors"
                      title={t('sidebar.newTask')}
                    >
                      <IconPlus />
                    </button>
                    <button
                      onClick={() => handleRenameProject(project)}
                      className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover/60 transition-colors"
                      title={t('sidebar.renameProject')}
                    >
                      <IconPencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project)}
                      className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title={t('sidebar.deleteProject')}
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {!collapsed && (
                <div className="space-y-0.5 mt-0.5">
                  {visibleTasks.map(thread => (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      isActive={thread.id === threadId}
                      onSelect={() => selectThread(thread.id, thread.workspace)}
                      onArchive={(e) => handleArchiveToggle(thread.id, thread.archived, e)}
                      onDelete={(e) => handleDeleteThread(thread.id, e)}
                    />
                  ))}
                  {/* 任务超过 5 个时：默认折叠，点击「更多」展开全部 */}
                  {taskList.length > DEFAULT_VISIBLE_TASKS && (
                    <button
                      className="w-full text-left px-2 py-1 text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover rounded-md transition-colors"
                      onClick={() => toggleShowAll(key)}
                    >
                      {showAll
                        ? t('sidebar.showLess')
                        : `${t('sidebar.showMore')} (${taskList.length - DEFAULT_VISIBLE_TASKS})`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Section: 会话（不绑定项目的普通对话，时间序平铺，右侧折叠按钮） */}
        <div className="px-1 pt-3 pb-1 flex items-center justify-between">
          <span className="text-[13px] font-medium text-text-primary">{t('sidebar.chats')}</span>
          <button
            onClick={() => setChatsCollapsed(v => !v)}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title={t('sidebar.collapse')}
          >
            <IconChevronRight className={`w-3.5 h-3.5 transition-transform ${chatsCollapsed ? '' : 'rotate-90'}`} strokeWidth={2} />
          </button>
        </div>
        {!chatsCollapsed && (
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
        )}
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
                <span className="text-[10px] px-1 py-0.5 rounded bg-info/15 text-info">{t('auth.badge.admin')}</span>
              )}
              <div className="ml-auto flex items-center gap-2 text-text-muted">
                <button
                  className="hover:text-text-secondary transition-colors"
                  title={t('auth.logout')}
                  onClick={onLogout}
                >
                  <IconLogout />
                </button>
                <button className="hover:text-text-secondary transition-colors" onClick={() => onOpenSettings?.()}>
                  <IconSettings />
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
                  <IconDevice />
                </button>
                <button className="hover:text-text-secondary transition-colors" onClick={() => onOpenSettings?.()}>
                  <IconSettings />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
