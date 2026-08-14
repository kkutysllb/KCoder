// CommandPalette — 轻量命令面板（Cmd+K / Ctrl+K）。
//
// 不依赖外部库。App.tsx 组装命令列表（每个命令含 label/action/可选 icon/分组），
// 本组件负责 Cmd+K 全局监听、模态搜索框、模糊过滤、键盘导航（↑↓ Enter Esc）。
// 参考 Cursor/Raycast 的命令面板形态。

import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n'

export interface CommandItem {
  id: string
  label: string
  /** 分组标题（相同 group 的命令归到一起）。 */
  group?: string
  /** 可选关键字（用于搜索，但不在 label 显示）。 */
  keywords?: string
  /** 可选快捷键展示（纯展示，实际监听在各处）。 */
  shortcut?: string
  icon?: React.ReactNode
  action: () => void
  /** 执行后是否关闭面板（默认 true）。 */
  keepOpen?: boolean
  disabled?: boolean
}

interface CommandPaletteProps {
  commands: CommandItem[]
}

export function CommandPalette({ commands }: CommandPaletteProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 全局 Cmd+K / Ctrl+K 切换
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 打开时重置并聚焦输入
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => {
      const hay = `${c.label} ${c.group ?? ''} ${c.keywords ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [query, commands])

  // 按 group 分组（保持插入顺序）
  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const c of filtered) {
      const g = c.group ?? ''
      const arr = map.get(g) ?? []
      arr.push(c)
      map.set(g, arr)
    }
    return Array.from(map.entries())
  }, [filtered])

  // 扁平化索引用于键盘导航
  const flat = filtered

  const run = (c?: CommandItem) => {
    if (!c || c.disabled) return
    c.action()
    if (!c.keepOpen) setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(flat[active])
    }
  }

  // 活动项滚动到可见区
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  // 计算 flat 中每个命令的全局索引（用于 data-idx 高亮）
  let runningIdx = -1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[min(560px,92vw)] rounded-xl bg-[#1d1d21] border border-[#34343a] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder={t('commandPalette.placeholder')}
          className="w-full bg-transparent px-4 py-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none border-b border-[#34343a]"
        />
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1.5">
          {flat.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-muted">{t('commandPalette.empty')}</div>
          )}
          {groups.map(([group, items]) => (
            <div key={group || '_'} className="py-1">
              {group && (
                <div className="px-4 py-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                  {group}
                </div>
              )}
              {items.map((c) => {
                runningIdx += 1
                const idx = runningIdx
                const isActive = idx === active
                return (
                  <button
                    key={c.id}
                    data-idx={idx}
                    disabled={c.disabled}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => run(c)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      isActive ? 'bg-[#2e2e34] text-text-primary' : 'text-text-secondary'
                    } ${c.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {c.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center text-text-muted">{c.icon}</span>}
                    <span className="flex-1 min-w-0 truncate text-[13px]">{c.label}</span>
                    {c.shortcut && (
                      <span className="text-[10px] text-text-muted font-mono shrink-0">{c.shortcut}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="px-4 py-2 border-t border-[#34343a] flex items-center gap-3 text-[10px] text-text-muted">
          <span>↑↓ {t('commandPalette.navigate')}</span>
          <span>↵ {t('commandPalette.select')}</span>
          <span>esc {t('commandPalette.close')}</span>
        </div>
      </div>
    </div>
  )
}
