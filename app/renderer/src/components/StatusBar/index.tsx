// StatusBar — 底部状态栏（参考 Codex 状态栏设计）。
//
// 三段布局：
//   左侧：engine 状态指示灯 + 端口
//   中部：当前 workspace 路径（缩短显示）
//   右侧最右：toggle 文件预览右抽屉按钮 + 切换变更聚合抽屉按钮
//
// 设计要点：
// - 高度紧凑（h-7 ≈ 28px），不抢主区域空间
// - 顶部细边框 + 暗色背景，与 ChatPanel 内容区视觉分层
// - 右侧按钮组对齐到 top-3 right-4，与主区域右上角按钮视觉位置一致

import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { IconTerminal } from '../icons'

const STATUS_COLOR = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  connected: 'bg-green-500',
  error: 'bg-red-500'
} as const

export function StatusBar() {
  const { t } = useI18n()
  const engineStatus = useAppStore((s) => s.engineStatus)
  const enginePort = useAppStore((s) => s.enginePort)
  const workspacePath = useAppStore((s) => s.workspacePath)
  const changePanelOpen = useAppStore((s) => s.changePanelOpen)
  const toggleChangePanel = useAppStore((s) => s.toggleChangePanel)

  const statusColor = STATUS_COLOR[engineStatus]
  const statusLabel = t(`statusbar.${engineStatus}`)

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border-custom bg-bg-surface px-3 h-7 text-[11px] text-text-muted select-none">
      {/* 左：引擎状态 + 端口 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${statusColor}`} />
          <span>{statusLabel}</span>
        </div>
        <span className="font-mono">:{enginePort}</span>
        {workspacePath && (
          <>
            <span className="text-text-muted/50">·</span>
            <span
              className="font-mono truncate max-w-[280px]"
              title={workspacePath}
            >
              {workspacePath}
            </span>
          </>
        )}
      </div>

      {/* 中（占位 + 可扩展区） */}
      <div className="flex-1" />

      {/* 右：按钮组（toggle 变更聚合抽屉）。文件预览抽屉开关已放在顶部
          右上角按钮组（App.tsx FilePreviewToggleButton），这里不再重复。 */}
      <div className="flex items-center gap-1">
        <IconBtn
          title={t('statusbar.toggleChanges')}
          active={changePanelOpen}
          disabled={false}
          onClick={toggleChangePanel}
        >
          <IconTerminal className="w-3.5 h-3.5" />
        </IconBtn>
      </div>
    </div>
  )
}

/** 图标按钮——active 时背景高亮，disabled 时半透明。 */
function IconBtn({
  title,
  active,
  disabled,
  onClick,
  children
}: {
  title: string
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-1 rounded transition-colors ${
        active
          ? 'text-text-primary bg-bg-hover'
          : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted`}
    >
      {children}
    </button>
  )
}