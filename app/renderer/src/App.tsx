import { useEffect, useState, useRef } from 'react'
import { useAppStore } from './stores/app-store'
import { Sidebar } from './components/Sidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthModal } from './components/AuthModal'
import { TerminalPanel } from './components/TerminalPanel'
import { UserInputModal } from './components/ChatPanel/UserInputModal'
import { InfoPanel } from './components/InfoPanel'
import { useChat } from './hooks/useChat'
import { useAuth } from './hooks/useAuth'
import { getEngineAPI } from './services/engine-api'
import { I18nProvider, useI18n } from './i18n'

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
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25A2.25 2.25 0 0113.5 8.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    </button>
  )
}

/** 展开策略按钮（手动/自动） */
function PanelStrategyButton() {
  const { t } = useI18n()
  const { panelStrategy, setPanelStrategy, panelOpen, setPanelOpen } = useAppStore()
  const isAuto = panelStrategy === 'auto'
  return (
    <button
      onClick={() => {
        const next = isAuto ? 'manual' : 'auto'
        setPanelStrategy(next)
        // 切到 auto 时若面板已关则不强制开（等数据触发）；切到 manual 时保持当前状态
        if (next === 'manual' && !panelOpen) setPanelOpen(false)
      }}
      title={isAuto ? t('panel.strategyAuto') : t('panel.strategyManual')}
      className={`p-1.5 rounded-md transition-colors ${
        isAuto ? 'text-[#3b82f6] bg-[#3b82f6]/10' : 'text-[#8a8a8f] hover:text-white hover:bg-bg-hover'
      }`}
    >
      {isAuto ? (
        /* 自动：闪电图标 */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ) : (
        /* 手动：手形图标 */
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.975m.075-5.975a1.575 1.575 0 013.15 0v3m-9.45-.75V7.5a1.575 1.575 0 013.15 0v4.312m0-1.687a1.575 1.575 0 013.15 0v3m0 0V12m0 0a1.575 1.575 0 013.15 0v4.312c0 .433-.09.85-.252 1.233l-.424.994a3.375 3.375 0 01-2.51 2.024l-.426.085a7.59 7.59 0 01-3.057-.067c-.51-.114-1.02-.275-1.49-.488a6.15 6.15 0 01-1.005-.564l-.275-.19a3.375 3.375 0 01-1.292-2.992l.425-3.397" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const { initializeEngine, setEngineStatus, messages, enginePort, workspacePath } = useAppStore()
  const { sendMessage, isGenerating, loadThread } = useChat()
  const auth = useAuth(enginePort)
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)

  useEffect(() => {
    // Apply saved theme on startup
    try {
      const raw = localStorage.getItem('kcoder-general-prefs')
      const theme = raw ? (JSON.parse(raw).theme || 'dark') : 'dark'
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const isLight = theme === 'light' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('theme-light', isLight)
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

  const hasMessages = messages.length > 0

  const toggleTerminal = () => {
    const next = !showTerminal
    setShowTerminal(next)
    if (next) setTerminalMounted(true)
  }

  return (
    <I18nProvider>
    <div className="flex h-full bg-bg-primary">
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <Sidebar
          onOpenSettings={() => setShowSettings(true)}
          onToggleCollapse={() => setSidebarCollapsed(true)}
          user={auth.user}
          onOpenAuth={() => setShowAuth(true)}
          onLogout={() => auth.logout()}
          onSelectThread={(id) => loadThread(id)}
        />
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top-right controls: panel strategy + panel toggle + terminal */}
        <div className="absolute top-3 right-4 z-30 no-drag flex items-center gap-1">
          <PanelStrategyButton />
          <PanelToggleButton />
          <div className="w-px h-4 bg-border-custom mx-0.5" />
          <TerminalToggleButton active={showTerminal} onToggle={toggleTerminal} />
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
        {hasMessages ? (
          <ChatPanel />
        ) : (
          <WelcomeScreen onSend={sendMessage} disabled={isGenerating} />
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

      {/* Settings panel */}
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />

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
    </div>
    </I18nProvider>
  )
}
