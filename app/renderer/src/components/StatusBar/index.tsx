import { useEffect } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useChat } from '../../hooks/useChat'

export function StatusBar() {
  const {
    engineStatus,
    enginePort,
    workspacePath,
    panelOpen,
    setPanelOpen,
    changePanelOpen,
    setChangePanelOpen,
    unreadChangeCount,
    clearUnreadChanges
  } = useAppStore()
  const { checkConnection, newChat } = useChat()

  // Check connection periodically
  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 30000)
    return () => clearInterval(interval)
  }, [checkConnection])

  const statusConfig = {
    disconnected: { color: 'bg-gray-500', text: 'Disconnected' },
    connecting: { color: 'bg-yellow-500', text: 'Connecting...' },
    connected: { color: 'bg-green-500', text: 'Connected' },
    error: { color: 'bg-red-500', text: 'Error' }
  }

  const status = statusConfig[engineStatus]

  const handleToggleChangePanel = () => {
    const next = !changePanelOpen
    setChangePanelOpen(next)
    if (next) clearUnreadChanges()
  }

  return (
    <div className="flex items-center justify-between border-t border-surface-lighter bg-surface px-4 py-1.5 text-xs text-gray-500">
      <div className="flex items-center gap-4">
        {/* Engine status */}
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${status.color}`} />
          <span>{status.text}</span>
        </div>

        {/* Port info */}
        <span>Port: {enginePort}</span>
      </div>

      <div className="flex items-center gap-4">
        {/* Workspace */}
        {workspacePath && (
          <span className="max-w-[200px] truncate" title={workspacePath}>
            {workspacePath.split('/').pop()}
          </span>
        )}

        {/* 功能图标按钮组 */}
        <div className="flex items-center gap-1">
          {/* 变更面板 */}
          <StatusBarButton
            title="文件变更面板"
            active={changePanelOpen}
            onClick={handleToggleChangePanel}
            badge={unreadChangeCount}
          >
            <FileChangeIcon />
          </StatusBarButton>

          {/* 信息面板 */}
          <StatusBarButton
            title="信息面板"
            active={panelOpen}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            <InfoIcon />
          </StatusBarButton>

          {/* 新会话 */}
          <StatusBarButton title="新建会话" onClick={() => newChat()}>
            <NewChatIcon />
          </StatusBarButton>
        </div>

        {/* Engine name */}
        <span className="text-gray-600">Powered by QiongQi</span>
      </div>
    </div>
  )
}

// ─── 图标按钮 ───────────────────────────────────────────────────

function StatusBarButton({
  title,
  onClick,
  active,
  badge,
  children
}: {
  title: string
  onClick: () => void
  active?: boolean
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`relative rounded p-1.5 transition-colors ${
        active
          ? 'bg-bg-active text-text-primary'
          : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary'
      }`}
    >
      <span className="block [&>svg]:h-3.5 [&>svg]:w-3.5">{children}</span>
      {badge != null && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#3b82f6] px-0.5 text-[9px] font-medium leading-none text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

function FileChangeIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 12.25l4.5-4.5 4.5 4.5M12 7.75v9.5"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5h15" opacity={0.4} />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  )
}

function NewChatIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>
  )
}
