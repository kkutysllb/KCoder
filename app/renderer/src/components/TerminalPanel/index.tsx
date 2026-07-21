import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from '../../i18n'

interface TerminalTab {
  id: string
  shell: string
  name: string
  cwd: string
}

interface TerminalEntry {
  term: Terminal
  fit: FitAddon
}

/** Dark theme matching the app palette */
const XTERM_THEME = {
  background: '#1a1a1e',
  foreground: '#d4d4d8',
  cursor: '#e5e5e8',
  cursorAccent: '#1a1a1e',
  selectionBackground: '#3a3a5f',
  black: '#1a1a1e',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e5e5e8',
  brightBlack: '#71717a',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff'
}

interface TerminalPanelProps {
  workspacePath?: string | null
  /** Whether the panel is currently shown (kept mounted to preserve sessions) */
  visible: boolean
  /** Called when the last terminal tab is closed so the host can unmount */
  onEmpty: () => void
}

export function TerminalPanel({ workspacePath, visible, onEmpty }: TerminalPanelProps) {
  const { t } = useI18n()
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [height, setHeight] = useState(240)

  // xterm instances live outside React state (mutable, not re-rendered)
  const entries = useRef(new Map<string, TerminalEntry>())
  const containerRefs = useRef(new Map<string, HTMLDivElement | null>())
  const creatingRef = useRef(false)
  // Tracks whether any terminal has ever been created (so we don't fire
  // onEmpty on the initial empty mount)
  const hasCreatedRef = useRef(false)
  const heightRef = useRef(height)
  heightRef.current = height

  /** Spawn a new PTY + xterm instance */
  const createTerminal = useCallback(async () => {
    if (creatingRef.current) return
    const api = window.kcoder?.terminal
    if (!api) {
      console.error('[KCoder] Terminal API unavailable (preload not loaded)')
      return
    }
    creatingRef.current = true
    try {
      const info = await api.create({
        cwd: workspacePath || undefined,
        cols: 80,
        rows: 24
      })

      const term = new Terminal({
        theme: XTERM_THEME,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, monospace",
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: true,
        scrollback: 5000
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.loadAddon(new WebLinksAddon())

      // User keystrokes → PTY
      term.onData((data) => api.write(info.id, data))
      // Resize events → PTY
      term.onResize(({ cols, rows }) => api.resize(info.id, cols, rows))

      entries.current.set(info.id, { term, fit })
      hasCreatedRef.current = true
      setTabs((prev) => [...prev, info])
      setActiveId(info.id)
    } catch (err) {
      console.error('[KCoder] Failed to create terminal:', err)
    } finally {
      creatingRef.current = false
    }
  }, [workspacePath])

  /** Kill a PTY + dispose its xterm */
  const closeTerminal = useCallback(async (id: string) => {
    const entry = entries.current.get(id)
    if (entry) {
      entry.term.dispose()
      entries.current.delete(id)
    }
    containerRefs.current.delete(id)
    await window.kcoder?.terminal?.kill(id)
    setTabs((prev) => prev.filter((tab) => tab.id !== id))
  }, [])

  // Wire PTY output → xterm, and handle shell exit
  useEffect(() => {
    const api = window.kcoder?.terminal
    if (!api) return
    const offData = api.onData((id, data) => {
      entries.current.get(id)?.term.write(data)
    })
    const offExit = api.onExit((id) => {
      const entry = entries.current.get(id)
      if (entry) {
        entry.term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')
      }
      setTabs((prev) => prev.filter((tab) => tab.id !== id))
    })
    return () => {
      offData()
      offExit()
    }
  }, [])

  // Keep activeId valid and notify host when the last tab is closed.
  // Derived from `tabs` so it stays StrictMode-safe (no side effects in
  // state updaters).
  useEffect(() => {
    if (!hasCreatedRef.current) return
    if (tabs.length === 0) {
      onEmpty()
      return
    }
    setActiveId((cur) => (cur && tabs.some((tab) => tab.id === cur) ? cur : tabs[tabs.length - 1].id))
  }, [tabs, onEmpty])

  // Create the first terminal on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createTerminal()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach xterm to its container div when a tab becomes active / mounts
  useEffect(() => {
    if (!activeId) return
    const entry = entries.current.get(activeId)
    const el = containerRefs.current.get(activeId)
    if (!entry || !el) return

    if (!entry.term.element || entry.term.element.parentElement !== el) {
      entry.term.open(el)
    }
    // Fit after the panel is laid out
    requestAnimationFrame(() => {
      try {
        entry.fit.fit()
      } catch {
        // Container may not be visible yet
      }
      entry.term.focus()
    })
  }, [activeId, tabs.length])

  // Refit + focus when the panel becomes visible again
  useEffect(() => {
    if (!visible || !activeId) return
    const entry = entries.current.get(activeId)
    if (!entry) return
    requestAnimationFrame(() => {
      try {
        entry.fit.fit()
      } catch {
        // ignore
      }
      entry.term.focus()
    })
  }, [visible, activeId])

  // Refit on window resize
  useEffect(() => {
    const onResize = () => {
      if (!activeId) return
      const entry = entries.current.get(activeId)
      if (entry) {
        try {
          entry.fit.fit()
        } catch {
          // ignore
        }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeId])

  // Drag-to-resize panel height
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = heightRef.current
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      setHeight(Math.min(Math.max(startH + delta, 120), window.innerHeight * 0.7))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      // Refit after resize
      const entry = activeId ? entries.current.get(activeId) : undefined
      if (entry) {
        try {
          entry.fit.fit()
        } catch {
          // ignore
        }
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [activeId])

  return (
    <div
      className={`flex flex-col shrink-0 border-t border-[#2a2a2f] bg-[#1a1a1e] ${visible ? '' : 'hidden'}`}
      style={{ height }}
    >
      {/* Drag handle */}
      <div
        className="h-1 shrink-0 cursor-ns-resize hover:bg-[#3a3a5f] transition-colors"
        onMouseDown={onDragStart}
      />

      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-[#2a2a2f] bg-[#1e1e22]">
        <span className="text-[13px] font-medium text-[#e5e5e8]">{t('terminal.title')}</span>

        {/* Tab pills */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-colors group ${
                tab.id === activeId
                  ? 'bg-[#2d2d32] text-white'
                  : 'text-[#8a8a8f] hover:text-[#c0c0c5] hover:bg-[#26262b]'
              }`}
              title={tab.cwd}
            >
              <span className="px-1 py-px rounded bg-[#3a3a3f] text-[10px] text-[#b0b0b5]">{tab.shell}</span>
              <span>{tab.name}</span>
              <span
                className="opacity-0 group-hover:opacity-100 hover:text-white transition-opacity ml-0.5"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTerminal(tab.id)
                }}
                title={t('terminal.closeTab')}
              >
                ×
              </span>
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-1 text-[#8a8a8f]">
          <button
            className="p-1 rounded-md hover:text-white hover:bg-[#2d2d32] transition-colors"
            onClick={createTerminal}
            title={t('terminal.new')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            className="p-1 rounded-md hover:text-white hover:bg-[#2d2d32] transition-colors"
            onClick={() => (activeId ? closeTerminal(activeId) : onEmpty())}
            title={t('terminal.close')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Terminal containers (all stay mounted to preserve scrollback) */}
      <div className="flex-1 overflow-hidden relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => {
              containerRefs.current.set(tab.id, el)
            }}
            className={`absolute inset-0 p-1 ${tab.id === activeId ? 'visible' : 'invisible'}`}
          />
        ))}
        {tabs.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs text-[#8a8a8f]">
            {t('terminal.empty')}
          </div>
        )}
      </div>
    </div>
  )
}
