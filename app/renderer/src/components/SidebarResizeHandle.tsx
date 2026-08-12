// SidebarResizeHandle — 侧边栏拖拽缩放分隔条（参考 KStock SidebarResizeHandle.tsx）。
//
// 支持：
// - 鼠标拖拽（Pointer events，移动端友好）
// - 键盘箭头键微调（±12px，无障碍）
// - body class 切换防止文本选择
// - aria 属性（role=separator + valuemin/max/now）
//
// 用法：放在可拖拽侧栏（Sidebar / SettingsPanel）的右/左侧边界，
// 通过 onResize 回调把新宽度回写到 store。
// 必须通过 style.left 指定 handle 的水平位置（侧栏右边缘）——
// CSS 只提供 position:absolute，left 由调用方注入。
import { useCallback, useEffect, useRef, type CSSProperties } from 'react'

interface SidebarResizeHandleProps {
  width: number
  minWidth: number
  maxWidth: number
  onResize: (width: number) => void
  label: string
  /** 必须提供 left（px），让 handle 绝对定位到侧栏右边缘。 */
  style?: CSSProperties
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  onResize,
  label,
  style
}: SidebarResizeHandleProps) {
  const cleanupRef = useRef<(() => void) | null>(null)

  const stopDragging = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    document.body.classList.remove('sidebar-resizing')
  }, [])

  // 组件卸载时清理监听器，防止 drag 状态残留
  useEffect(() => stopDragging, [stopDragging])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    stopDragging()

    const startX = event.clientX
    const startWidth = width

    const handleMove = (moveEvent: PointerEvent) => {
      onResize(clamp(startWidth + moveEvent.clientX - startX, minWidth, maxWidth))
    }
    const handleUp = () => stopDragging()

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp, { once: true })
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    document.body.classList.add('sidebar-resizing')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 12 : -12
    onResize(clamp(width + delta, minWidth, maxWidth))
  }

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      style={style}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  )
}
