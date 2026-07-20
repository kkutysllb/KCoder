import { useEffect } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useChat } from '../../hooks/useChat'

export function StatusBar() {
  const { engineStatus, enginePort, workspacePath } = useAppStore()
  const { checkConnection } = useChat()

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

  return (
    <div className="flex items-center justify-between border-t border-surface-lighter bg-surface px-4 py-2 text-xs text-gray-500">
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

        {/* Engine name */}
        <span className="text-gray-600">Powered by QiongQi</span>
      </div>
    </div>
  )
}
