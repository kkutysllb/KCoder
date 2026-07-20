import { useEffect, useState } from 'react'
import { useAppStore } from './stores/app-store'
import { Sidebar } from './components/Sidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useChat } from './hooks/useChat'

export default function App() {
  const { initializeEngine, messages } = useAppStore()
  const { sendMessage, isGenerating } = useChat()
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    // Get engine port from URL query params
    const params = new URLSearchParams(window.location.search)
    const port = parseInt(params.get('enginePort') || '18899', 10)
    initializeEngine(port)

    // Listen for settings IPC
    window.kcoder?.on('open-settings', () => setShowSettings(true))
  }, [initializeEngine])

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-full bg-bg-primary">
      {/* Sidebar */}
      <Sidebar onOpenSettings={() => setShowSettings(true)} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {hasMessages ? (
          <ChatPanel />
        ) : (
          <WelcomeScreen onSend={sendMessage} disabled={isGenerating} />
        )}
      </div>

      {/* Settings panel */}
      <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  )
}
