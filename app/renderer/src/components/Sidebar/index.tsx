import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type AuthUser, type ThreadSummary } from '../../services/engine-api'

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
  onOpenSettings?: () => void
  onToggleCollapse?: () => void
  user?: AuthUser | null
  onOpenAuth?: () => void
  onLogout?: () => void
  onSelectThread?: (threadId: string) => void
  onNewTask?: () => void
}

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

export function Sidebar({ onOpenSettings, onToggleCollapse, user, onOpenAuth, onLogout, onSelectThread, onNewTask }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'group' | 'project'>('project')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [viewMode, setViewMode] = useState<'project' | 'timeline'>('timeline')
  const [sortBy, setSortBy] = useState<'updated' | 'created'>('updated')
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loadingThreads, setLoadingThreads] = useState(false)
  const { enginePort, engineStatus, threadId, setThreadId, setWorkspacePath, clearMessages } = useAppStore()
  const { t } = useI18n()

  // 加载会话列表
  const loadThreads = useCallback(async () => {
    if (engineStatus !== 'connected') return
    setLoadingThreads(true)
    try {
      const api = getEngineAPI(enginePort)
      const result = await api.listThreads()
      // 按更新时间降序
      const sorted = [...result.threads].sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      )
      setThreads(sorted)
    } catch (error) {
      console.error('[KCoder] Failed to load threads:', error)
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

  // 新建会话 — 清空当前消息并打开新建任务对话框
  const handleNewChat = useCallback(() => {
    clearMessages()
    setThreadId(null)
    onNewTask?.()
  }, [clearMessages, setThreadId, onNewTask])

  return (
    <div className="w-[260px] h-full bg-bg-sidebar flex flex-col border-r border-border-custom">
      {/* Top bar - leave space for real macOS traffic lights (hiddenInset at x:16,y:16) */}
      <div className="drag-region h-12 flex items-center px-3">
        <div className="no-drag flex items-center gap-0.5 ml-20 text-[#8a8a8f]">
          {/* Collapse sidebar — simple left chevron (reference design) */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={onToggleCollapse}
            title={t('sidebar.collapse')}
          >
            <Icons.Back />
          </button>
          <button className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors">
            <Icons.Forward />
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
        <button className="sidebar-item w-full">
          <Icons.Skills />
          <span>{t('sidebar.skills')}</span>
        </button>
      </div>

      {/* Tabs + sort/archive controls (reference design) */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-[13px]">
          <button
            onClick={() => setActiveTab('group')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
              activeTab === 'group'
                ? 'bg-[#1e1e22] text-white'
                : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
            }`}
          >
            <Icons.Hash />
            <span>{t('sidebar.group')}</span>
          </button>
          <button
            onClick={() => setActiveTab('project')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
              activeTab === 'project'
                ? 'bg-[#1e1e22] text-white'
                : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
            }`}
          >
            <Icons.Folder />
            <span>{t('sidebar.project')}</span>
          </button>

          {/* Sort / filter + archive */}
          <div className="ml-auto flex items-center gap-0.5">
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
                  viewMode={viewMode}
                  sortBy={sortBy}
                  onViewMode={(v) => { setViewMode(v); setShowSortMenu(false) }}
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
      </div>

      {/* Section title */}
      <div className="px-4 pt-2 pb-1 text-[13px] font-medium text-text-primary">
        {t('sidebar.conversations')}
      </div>

      {/* 会话列表（对接 GET /v1/threads） */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">加载中…</div>
        )}
        {!loadingThreads && threads.length === 0 && (
          <div className="px-2 py-4 text-xs text-text-muted text-center">
            {engineStatus === 'connected' ? '暂无会话，点击「新建任务」开始' : '引擎未连接'}
          </div>
        )}
        {threads.map(thread => {
          const isActive = thread.id === threadId
          const time = formatRelativeTime(thread.updatedAt)
          return (
            <button
              key={thread.id}
              className={`task-item w-full ${isActive ? 'bg-bg-hover text-text-primary' : ''}`}
              onClick={() => selectThread(thread.id, thread.workspace)}
              title={thread.title || thread.id}
            >
              <span className="truncate flex-1 text-left">
                {thread.title || '未命名会话'}
              </span>
              <span className="text-xs text-text-muted shrink-0 ml-2">{time}</span>
            </button>
          )
        })}
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
                <button className="hover:text-text-secondary transition-colors" onClick={onOpenSettings}>
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
                <button className="hover:text-text-secondary transition-colors" onClick={onOpenSettings}>
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
