// EditorTabs — 编辑器多 Tab 栏。
//
// 渲染 store.openTabs：每 Tab 显示文件名 + 脏点 + 关闭按钮；点击切换 active。
// 关闭 dirty Tab 前确认（避免丢失未保存修改）。配合 FilePreviewPanel（单实例，
// 按 activeTab 渲染）实现多文件编辑切换。

import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'

export function EditorTabs() {
  const openTabs = useAppStore((s) => s.openTabs)
  const activeTab = useAppStore((s) => s.activeTab)
  const tabDirty = useAppStore((s) => s.tabDirty)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const { t } = useI18n()

  if (openTabs.length === 0) return null

  return (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-border-custom bg-bg-surface/40">
      {openTabs.map((path) => {
        const name = path.split('/').pop() || path
        const isActive = path === activeTab
        const dirty = !!tabDirty[path]
        return (
          <div
            key={path}
            onClick={() => setActiveTab(path)}
            title={path}
            className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border-custom px-3 py-1.5 text-xs transition-colors ${
              isActive
                ? 'bg-bg-primary text-text-primary'
                : 'text-text-muted hover:bg-bg-hover hover:text-text-secondary'
            }`}
          >
            {isActive && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#3b82f6]" />}
            <span className="max-w-[140px] truncate font-mono">{name}</span>
            {dirty && <span className="text-[#f59e0b]">●</span>}
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (dirty && !confirm(t('files.closeTabConfirm'))) return
                closeTab(path)
              }}
              className={`rounded p-0.5 transition-colors ${
                isActive ? 'text-text-muted hover:bg-bg-hover hover:text-text-primary' : 'text-text-muted hover:text-text-primary'
              } ${openTabs.length === 1 ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}
              aria-label={`关闭 ${name}`}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}
