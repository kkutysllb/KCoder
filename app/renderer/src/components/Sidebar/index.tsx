import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import type { AuthUser } from '../../services/engine-api'

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

interface Task {
  id: string
  title: string
  time: string
  hasUpdate?: boolean
}

interface Project {
  id: string
  name: string
  tasks: Task[]
}

const mockProjects: Project[] = []

interface SidebarProps {
  onOpenSettings?: () => void
  onToggleCollapse?: () => void
  user?: AuthUser | null
  onOpenAuth?: () => void
  onLogout?: () => void
}

export function Sidebar({ onOpenSettings, onToggleCollapse, user, onOpenAuth, onLogout }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'group' | 'project'>('project')
  const [expandedProjects, setExpandedProjects] = useState<string[]>([])
  const { setWorkspacePath } = useAppStore()
  const { t } = useI18n()

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    )
  }

  return (
    <div className="w-[260px] h-full bg-bg-sidebar flex flex-col border-r border-border-custom">
      {/* Top bar - leave space for real macOS traffic lights (hiddenInset at x:16,y:16) */}
      <div className="drag-region h-12 flex items-center px-3">
        <div className="no-drag flex items-center gap-1 ml-20 text-text-muted">
          {/* Sidebar collapse toggle - grid panel style */}
          <button
            className="p-1 rounded-md hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={onToggleCollapse}
            title={t('sidebar.collapse')}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.3" />
              <rect x="2.5" y="4.5" width="2" height="1.5" rx="0.5" />
              <rect x="2.5" y="7.25" width="2" height="1.5" rx="0.5" />
              <rect x="2.5" y="10" width="2" height="1.5" rx="0.5" />
            </svg>
          </button>
          <button className="p-1 hover:text-text-secondary transition-colors">
            <Icons.Back />
          </button>
          <button className="p-1 hover:text-text-secondary transition-colors">
            <Icons.Forward />
          </button>
        </div>
      </div>

      {/* Navigation items */}
      <div className="px-3 py-2 space-y-0.5">
        <button className="sidebar-item w-full">
          <Icons.NewTask />
          <span>{t('sidebar.newTask')}</span>
          <span className="ml-auto text-xs text-text-muted">⌘N</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Search />
          <span>{t('sidebar.search')}</span>
          <span className="ml-auto text-xs text-text-muted">⌘K</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Skills />
          <span>{t('sidebar.skills')}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1 text-sm">
          <button
            onClick={() => setActiveTab('group')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'group'
                ? 'bg-white text-black'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('sidebar.group')}
          </button>
          <button
            onClick={() => setActiveTab('project')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'project'
                ? 'bg-white text-black'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {t('sidebar.project')}
          </button>
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {mockProjects.map(project => (
          <div key={project.id} className="mb-2">
            {/* Project header */}
            <button
              onClick={() => toggleProject(project.id)}
              className="sidebar-item w-full font-medium text-text-primary"
            >
              <span className={`transform transition-transform ${expandedProjects.includes(project.id) ? 'rotate-0' : '-rotate-90'}`}>
                <Icons.ChevronDown />
              </span>
              <Icons.Folder />
              <span>{project.name}</span>
            </button>

            {/* Tasks */}
            {expandedProjects.includes(project.id) && project.tasks.length > 0 && (
              <div className="ml-4 mt-1 space-y-0.5">
                {project.tasks.slice(0, 10).map(task => (
                  <button
                    key={task.id}
                    className="task-item w-full"
                    onClick={() => setWorkspacePath(`/projects/${project.name}`)}
                  >
                    <span className="truncate flex-1 text-left">{task.title}</span>
                    <span className="flex items-center gap-1.5 ml-2 shrink-0">
                      {task.hasUpdate && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                      )}
                      <span className="text-xs text-text-muted">{task.time}</span>
                    </span>
                  </button>
                ))}
                {project.tasks.length > 10 && (
                  <button className="task-item w-full text-text-muted hover:text-text-secondary">
                    {t('sidebar.showMore')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
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
