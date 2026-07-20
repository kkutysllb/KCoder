import { useState } from 'react'
import { useAppStore } from '../../stores/app-store'

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

const mockProjects: Project[] = [
  {
    id: 'kstock',
    name: 'KStock',
    tasks: [
      { id: '1', title: '可转债全景分析 Tushare集...', time: '1天' },
      { id: '2', title: '股指期货ETF专题历史结果...', time: '1天' },
      { id: '3', title: '可转债全景分析 Tushare数...', time: '1天' },
      { id: '4', title: '股指期货ETF专题数据获取...', time: '1天' },
      { id: '5', title: '可转债全景分析 Tushare数...', time: '1天' },
      { id: '6', title: '股指期货ETF专题数据获取...', time: '1天' },
      { id: '7', title: '市场分析模块与技能对应分...', time: '1天', hasUpdate: true },
      { id: '8', title: '可转债全景分析 Tushare集...', time: '1天' },
      { id: '9', title: '可转债全景分析 Tushare集...', time: '1天' },
      { id: '10', title: '可转债全景分析 Tushare集...', time: '1天' },
      { id: '11', title: '可转债全景分析 Tushare集...', time: '1天' },
      { id: '12', title: '可转债全景分析 Tushare集...', time: '1天' }
    ]
  },
  {
    id: 'kworks',
    name: 'KWorks',
    tasks: [
      { id: '1', title: '资金联动分析万元转元修复', time: '2天' },
      { id: '2', title: '核心引擎验证：仅DeepSee...', time: '2天' },
      { id: '3', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '4', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '5', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '6', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '7', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '8', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '9', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '10', title: 'A股分析系统微信推送功能...', time: '2天' },
      { id: '11', title: 'A股分析系统微信推送功能...', time: '2天' }
    ]
  },
  {
    id: 'oclaw',
    name: 'OClaw',
    tasks: []
  },
  {
    id: 'kcoder',
    name: 'KCoder',
    tasks: []
  }
]

export function Sidebar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [activeTab, setActiveTab] = useState<'group' | 'project'>('project')
  const [expandedProjects, setExpandedProjects] = useState<string[]>(['kstock', 'kworks'])
  const { setWorkspacePath } = useAppStore()

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev =>
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    )
  }

  return (
    <div className="w-[260px] h-full bg-bg-sidebar flex flex-col border-r border-[#2a2a2c]">
      {/* Top bar with window controls */}
      <div className="drag-region h-12 flex items-center px-3 gap-2">
        {/* macOS window buttons placeholder */}
        <div className="no-drag flex items-center gap-2 ml-1">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
        </div>
        <div className="no-drag flex items-center gap-1 ml-2 text-[#71717a]">
          <button className="p-1 hover:text-[#a1a1aa] transition-colors">
            <Icons.Back />
          </button>
          <button className="p-1 hover:text-[#a1a1aa] transition-colors">
            <Icons.Forward />
          </button>
        </div>
      </div>

      {/* Navigation items */}
      <div className="px-3 py-2 space-y-0.5">
        <button className="sidebar-item w-full">
          <Icons.NewTask />
          <span>新建任务</span>
          <span className="ml-auto text-xs text-[#52525b]">⌘N</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Search />
          <span>搜索</span>
          <span className="ml-auto text-xs text-[#52525b]">⌘K</span>
        </button>
        <button className="sidebar-item w-full">
          <Icons.Skills />
          <span>技能</span>
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
                : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
          >
            # 分组
          </button>
          <button
            onClick={() => setActiveTab('project')}
            className={`px-3 py-1 rounded-md transition-colors ${
              activeTab === 'project'
                ? 'bg-white text-black'
                : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
          >
            📁 项目
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
              className="sidebar-item w-full font-medium text-[#e4e4e7]"
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
                      <span className="text-xs text-[#52525b]">{task.time}</span>
                    </span>
                  </button>
                ))}
                {project.tasks.length > 10 && (
                  <button className="task-item w-full text-[#71717a] hover:text-[#a1a1aa]">
                    显示更多
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* User profile */}
      <div className="px-3 py-3 border-t border-[#2a2a2c]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
            k
          </div>
          <span className="text-sm text-[#e4e4e7]">kkutys</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#333336] text-[#a1a1aa]">Max</span>
          <div className="ml-auto flex items-center gap-2 text-[#71717a]">
            <button className="hover:text-[#a1a1aa] transition-colors">
              <Icons.Device />
            </button>
            <button className="hover:text-[#a1a1aa] transition-colors" onClick={onOpenSettings}>
              <Icons.Settings />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
