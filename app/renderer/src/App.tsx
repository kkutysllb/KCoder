import { useEffect, useState } from 'react'
import { useAppStore } from './stores/app-store'
import { Sidebar } from './components/Sidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { AuthModal } from './components/AuthModal'
import { useChat } from './hooks/useChat'
import { useAuth } from './hooks/useAuth'
import { getEngineAPI } from './services/engine-api'
import { I18nProvider } from './i18n'

export default function App() {
  const { initializeEngine, setEngineStatus, messages, enginePort } = useAppStore()
  const { sendMessage, isGenerating } = useChat()
  const auth = useAuth(enginePort)
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
        />
      )}

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sidebar expand button when collapsed */}
        {sidebarCollapsed && (
          <div className="drag-region h-12 flex items-center px-3 shrink-0">
            <button
              className="no-drag ml-20 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              onClick={() => setSidebarCollapsed(false)}
              title="展开侧边栏"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <line x1="6" y1="2" x2="6" y2="14" stroke="currentColor" strokeWidth="1.3" />
                <rect x="2.5" y="4.5" width="2" height="1.5" rx="0.5" />
                <rect x="2.5" y="7.25" width="2" height="1.5" rx="0.5" />
                <rect x="2.5" y="10" width="2" height="1.5" rx="0.5" />
              </svg>
            </button>
          </div>
        )}
        {hasMessages ? (
          <ChatPanel />
        ) : (
          <WelcomeScreen onSend={sendMessage} disabled={isGenerating} />
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
    </div>
    </I18nProvider>
  )
}
