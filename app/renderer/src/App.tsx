import { useEffect, useState, useRef, useMemo } from 'react'
import { useAppStore } from './stores/app-store'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthModal } from './components/AuthModal'
import { AuthExperience } from './components/AuthExperience'
import { TerminalPanel } from './components/TerminalPanel'
import { UserInputModal } from './components/ChatPanel/UserInputModal'
import { InfoPanel } from './components/InfoPanel'
import { ChangePanel } from './components/ChangePanel'
import { FilePreviewPanel } from './components/ChatPanel/FilePreviewPanel'
import { FileTree } from './components/FileTree'
import { SearchPanel } from './components/SearchPanel'
import { SidebarResizeHandle } from './components/SidebarResizeHandle'
import { CommandPalette, type CommandItem } from './components/CommandPalette'
import { useChat } from './hooks/useChat'
import { useAuth } from './hooks/useAuth'
import { getEngineAPI } from './services/engine-api'
import { I18nProvider, useI18n } from './i18n'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 420

/** Floating terminal open/close button (top-right, reference design) */
function TerminalToggleButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  return (
    <button
      onClick={onToggle}
      title={t('terminal.toggle')}
      className={`p-1.5 rounded-md transition-colors ${
        active ? 'text-white bg-bg-hover' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z"
        />
      </svg>
    </button>
  )
}

/** 浮动信息面板开关按钮 */
function PanelToggleButton() {
  const { t } = useI18n()
  const { panelOpen, setPanelOpen } = useAppStore()
  return (
    <button
      onClick={() => setPanelOpen(!panelOpen)}
      title={t('panel.toggle')}
      className={`p-1.5 rounded-md transition-colors ${
        panelOpen ? 'text-white bg-bg-hover' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
    </button>
  )
}

/** 文件变更面板开关按钮（badge 显示未读变更文件数） */
function ChangePanelToggleButton() {
  const { changePanelOpen, setChangePanelOpen, unreadChangeCount, clearUnreadChanges } =
    useAppStore()
  return (
    <button
      onClick={() => {
        const next = !changePanelOpen
        setChangePanelOpen(next)
        if (next) clearUnreadChanges()
      }}
      title="文件变更面板"
      className={`relative p-1.5 rounded-md transition-colors ${
        changePanelOpen
          ? 'text-white bg-bg-hover'
          : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12.25l4.5-4.5 4.5 4.5M12 7.75v9.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5h15" opacity={0.4} />
      </svg>
      {unreadChangeCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#3b82f6] px-0.5 text-[9px] font-medium leading-none text-white">
          {unreadChangeCount > 99 ? '99+' : unreadChangeCount}
        </span>
      )}
    </button>
  )
}

/** 新建会话按钮 */
function NewChatButton() {
  const { newChat } = useChat()
  return (
    <button
      onClick={() => newChat()}
      title="新建会话"
      className="p-1.5 rounded-md transition-colors text-[#8a8a8f] hover:text-white hover:bg-bg-hover"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    </button>
  )
}

/** 命令面板挂载点 — 在 I18nProvider 内渲染以使用 useI18n。 */
function KCommandPalette(props: {
  onNewChat: () => void
  onToggleTerminal: () => void
  onTogglePanel: () => void
  onToggleSidebar: () => void
  onOpenSettings: (tab?: string) => void
}) {
  const { t } = useI18n()
  const { newChat } = useChat()

  const toggleTheme = () => {
    try {
      const raw = localStorage.getItem('kcoder-general-prefs')
      const parsed = raw ? JSON.parse(raw) : {}
      const cur = parsed.theme || 'dark'
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const isLight = cur === 'light' || (cur === 'system' && mq.matches)
      const nextTheme = isLight ? 'dark' : 'light'
      parsed.theme = nextTheme
      localStorage.setItem('kcoder-general-prefs', JSON.stringify(parsed))
      document.documentElement.classList.toggle('theme-light', nextTheme === 'light')
      window.kcoder?.send('save-settings', { general: parsed })
    } catch { /* ignore */ }
  }

  const commands: CommandItem[] = useMemo(() => [
    { id: 'new-chat', label: t('cp.newChat'), group: t('commandPalette.group.actions'), keywords: 'new chat', shortcut: '⌘N', action: () => { newChat(); props.onNewChat() } },
    { id: 'toggle-terminal', label: t('cp.toggleTerminal'), group: t('commandPalette.group.view'), keywords: 'terminal', action: props.onToggleTerminal },
    { id: 'toggle-panel', label: t('cp.togglePanel'), group: t('commandPalette.group.view'), keywords: 'info panel', action: props.onTogglePanel },
    { id: 'toggle-sidebar', label: t('cp.toggleSidebar'), group: t('commandPalette.group.view'), keywords: 'sidebar', action: props.onToggleSidebar },
    { id: 'toggle-theme', label: t('cp.toggleTheme'), group: t('commandPalette.group.view'), keywords: 'theme light dark', action: toggleTheme },
    { id: 'settings', label: t('cp.settings'), group: t('commandPalette.group.settings'), keywords: 'settings preferences', action: () => props.onOpenSettings() },
    { id: 'settings-models', label: t('cp.settings.models'), group: t('commandPalette.group.settings'), keywords: 'model', action: () => props.onOpenSettings('models') },
    { id: 'settings-agents', label: t('cp.settings.agents'), group: t('commandPalette.group.settings'), keywords: 'agent subagent', action: () => props.onOpenSettings('agents') },
    { id: 'settings-mcp', label: t('cp.settings.mcp'), group: t('commandPalette.group.settings'), keywords: 'mcp', action: () => props.onOpenSettings('mcp') },
    { id: 'settings-skills', label: t('cp.settings.skills'), group: t('commandPalette.group.settings'), keywords: 'skill', action: () => props.onOpenSettings('skills') },
  ], [t, newChat, props])

  return <CommandPalette commands={commands} />
}

/** 文件预览右抽屉开关按钮（顶部按钮组最右，展开/关闭右侧文件预览栏） */
function FilePreviewToggleButton() {
  const { t } = useI18n()
  const filePreviewPath = useAppStore((s) => s.filePreviewPath)
  const lastFilePreviewPath = useAppStore((s) => s.lastFilePreviewPath)
  const toggleFilePreview = useAppStore((s) => s.toggleFilePreview)
  // 从未预览过文件 → 按钮禁用（无路径可 toggle 打开）
  const disabled = !filePreviewPath && !lastFilePreviewPath
  const active = !!filePreviewPath
  return (
    <button
      onClick={toggleFilePreview}
      disabled={disabled}
      title={t('statusbar.toggleFilePreview')}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'text-white bg-bg-hover'
          : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#8a8a8f]`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 3.75v16.5a.75.75 0 00.75.75H19.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75H4.5a.75.75 0 00-.75.75zM14.25 3.75v16.5"
        />
      </svg>
    </button>
  )
}

export default function App() {
  const { initializeEngine, setEngineStatus, messages, enginePort, workspacePath, panelOpen, setPanelOpen, sidebarWidth, setSidebarWidth, openTabs, activeTab, closeFilePreview, openFilePreview } = useAppStore()
  const { loadThread } = useChat()
  const auth = useAuth(enginePort)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string>('general')
  const [showAuth, setShowAuth] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [showFileTree, setShowFileTree] = useState(false)
  const [fileSearchQuery, setFileSearchQuery] = useState('')

  useEffect(() => {
    // Apply saved theme on startup + sync general prefs to main process (proxy/cert)
    try {
      const raw = localStorage.getItem('kcoder-general-prefs')
      const parsed = raw ? JSON.parse(raw) : {}
      const theme = parsed.theme || 'dark'
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const isLight = theme === 'light' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('theme-light', isLight)
      // Sync proxy/cert settings to main process on startup
      window.kcoder?.send('save-settings', { general: parsed })
    } catch { /* ignore */ }

    // Get engine port/token from URL query params
    const params = new URLSearchParams(window.location.search)
    const port = parseInt(params.get('enginePort') || '18899', 10)
    const token = params.get('engineToken') || ''
    initializeEngine(port)

    // Verify engine connectivity (main process guarantees engine is up before window loads)
    const api = getEngineAPI(port, token)
    let attempts = 0
    const checkHealth = async () => {
      const ok = await api.health()
      if (ok) {
        setEngineStatus('connected')
      } else if (attempts++ < 20) {
        setTimeout(checkHealth, 500)
      } else {
        setEngineStatus('error')
      }
    }
    checkHealth()

    // Listen for settings IPC
    window.kcoder?.on('open-settings', () => setShowSettings(true))
  }, [initializeEngine, setEngineStatus])

  // Listen for engine restart events triggered from the tray menu.
  // The tray calls restartEngine() in the main process and sends the new
  // { port, token } so the renderer can reconnect.
  useEffect(() => {
    const handleRestarted = (data: unknown) => {
      const { port, token } = data as { port: number; token: string }
      initializeEngine(port)
      const api = getEngineAPI(port, token)
      let attempts = 0
      const checkHealth = async () => {
        const ok = await api.health()
        if (ok) {
          setEngineStatus('connected')
        } else if (attempts++ < 30) {
          setTimeout(checkHealth, 500)
        } else {
          setEngineStatus('error')
        }
      }
      checkHealth()
    }
    window.kcoder?.on('engine:restarted', handleRestarted)
    return () => {
      window.kcoder?.off('engine:restarted', handleRestarted as (...args: unknown[]) => void)
    }
  }, [initializeEngine, setEngineStatus])

  const hasMessages = messages.length > 0

  const toggleTerminal = () => {
    const next = !showTerminal
    setShowTerminal(next)
    if (next) setTerminalMounted(true)
  }

  return (
    <I18nProvider>
    {auth.checking ? (
      <div className="flex h-full items-center justify-center bg-[#080b10]">
        <div className="flex flex-col items-center gap-4 text-[#8fa1b3]">
          <img src="/favicon-64.png" alt="KCoder" className="h-12 w-12 rounded-[15px] shadow-[0_0_32px_rgba(30,136,229,0.25)]" />
          <span className="text-xs tracking-[0.18em]">KCODER</span>
        </div>
      </div>
    ) : !auth.user ? (
      <AuthExperience auth={auth} enginePort={enginePort} />
    ) : (
    <div className="flex h-full bg-bg-primary">
      {/* Sidebar — 包一层 relative，宽度由 store 驱动，右边缘加拖拽 handle */}
      {!sidebarCollapsed && (
        <div className="relative shrink-0">
          <Sidebar
            onOpenSettings={(tab) => { if (tab) setSettingsTab(tab); setShowSettings(true) }}
            onToggleCollapse={() => setSidebarCollapsed(true)}
            user={auth.user}
            onOpenAuth={() => setShowAuth(true)}
            onLogout={() => auth.logout()}
            onSelectThread={(id) => loadThread(id)}
            width={sidebarWidth}
          />
          <SidebarResizeHandle
            width={sidebarWidth}
            minWidth={SIDEBAR_MIN}
            maxWidth={SIDEBAR_MAX}
            onResize={setSidebarWidth}
            label="拖拽调整侧栏宽度"
            style={{ left: sidebarWidth }}
          />
        </div>
      )}

      {/* Main content area — 顶部状态栏区域（右上角控件）不随面板移动；
          外层不位移，ChatFeed 在 main 满宽（滚动条始终在窗口最右端）；
          InfoPanel 浮在上面盖住一部分滚动条，消息/Composer 内部给面板让位 */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top-right controls: panel toggle + terminal — 固定在窗口右上角，永不移动 */}
        <div className="absolute top-3 right-4 z-30 no-drag flex items-center gap-1">
          <PanelToggleButton />
          <button
            onClick={() => setShowFileTree((v) => !v)}
            title="文件浏览器"
            className={`p-1.5 rounded-md transition-colors ${showFileTree ? 'text-white bg-bg-hover' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
          <ChangePanelToggleButton />
          <NewChatButton />
          <div className="w-px h-4 bg-border-custom mx-0.5" />
          <TerminalToggleButton active={showTerminal} onToggle={toggleTerminal} />
          {/* 最右：文件预览右抽屉开关 */}
          <FilePreviewToggleButton />
        </div>

        {/* Sidebar expand button when collapsed — simple right chevron (reference design) */}
        {sidebarCollapsed && (
          <div className="drag-region h-12 flex items-center px-3 shrink-0">
            <button
              className="no-drag ml-20 p-1 rounded-md text-[#8a8a8f] hover:text-text-primary hover:bg-bg-hover transition-colors"
              onClick={() => setSidebarCollapsed(false)}
              title="展开侧边栏"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* 内层内容区 — 不再压缩；ChatFeed 在此满宽，滚动条始终在窗口最右端 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {hasMessages ? (
            <ChatPanel />
          ) : (
            // ChatPanel 内部会通过 ChatFeed 的 emptySlot 渲染 WelcomeScreen，
            // 同时承担"回到底部"按钮和编辑重发的交互。但首次启动时
            // messages 为空，直接挂 ChatPanel 让它自己渲染 emptySlot。
            <ChatPanel />
          )}

          {/* Terminal panel — kept mounted to preserve PTY sessions */}
          {terminalMounted && (
            <TerminalPanel
              workspacePath={workspacePath}
              visible={showTerminal}
              onEmpty={() => {
                setShowTerminal(false)
                setTerminalMounted(false)
              }}
            />
          )}
        </div>
      </div>

      {/* 文件预览右栏（三分栏第三栏）：作为 flex 子项参与文档流，
          打开时主内容区自动收缩让位，不浮动覆盖 workspace 内容 */}
      {openTabs.length > 0 && activeTab && (
        <FilePreviewPanel path={activeTab} onClose={closeFilePreview} />
      )}

      {/* 工作区文件树 + 全局搜索（左侧浮动面板，右上角按钮切换） */}
      {showFileTree && (
        <aside className="absolute left-0 top-12 bottom-0 z-20 w-[260px] flex flex-col border-r border-border-custom bg-bg-primary shadow-xl animate-[slide-in-right_0.2s_ease-out]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-custom">
            <span className="text-xs font-medium text-text-secondary">文件</span>
            <button onClick={() => setShowFileTree(false)} className="text-text-muted hover:text-text-primary">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* 搜索框：有内容时显示搜索结果，否则显示文件树 */}
          <div className="px-2 py-1.5 border-b border-border-custom">
            <input
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              placeholder="在工作区中搜索…"
              className="w-full rounded bg-bg-hover px-2 py-1 text-xs text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-[#3b82f6]"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {fileSearchQuery.trim() ? (
              <SearchPanel rootPath={workspacePath ?? ''} query={fileSearchQuery} onOpenFile={(p) => openFilePreview(p)} />
            ) : (
              <FileTree rootPath={workspacePath ?? ''} onOpenFile={(p) => openFilePreview(p)} />
            )}
          </div>
        </aside>
      )}

      {/* Settings panel */}
      <SettingsPanel isOpen={showSettings} initialNav={settingsTab} onClose={() => setShowSettings(false)} />

      {/* Auth modal */}
      <AuthModal
        isOpen={showAuth}
        onClose={() => setShowAuth(false)}
        auth={auth}
        enginePort={enginePort}
      />

      {/* 结构化输入弹窗（后端 user_input_requested 事件触发） */}
      <UserInputModal />

      {/* 浮动信息面板（执行/计划/环境） */}
      <InfoPanel />

      {/* 文件变更聚合抽屉（状态栏变更按钮打开） */}
      <ChangePanel />

      {/* 命令面板（Cmd+K / Ctrl+K） */}
      <KCommandPalette
        onNewChat={() => {}}
        onToggleTerminal={toggleTerminal}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenSettings={(tab) => { if (tab) setSettingsTab(tab); setShowSettings(true) }}
      />
    </div>
    )}
    </I18nProvider>
  )
}
