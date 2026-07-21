import { useState, useRef, useEffect, useCallback } from 'react'

// Agent permission modes - maps to engine approvalPolicy/sandboxMode, backend integration reserved
const PERMISSION_MODES = [
  { id: 'confirm-before-change', label: '变更前确认', description: '改文件前先问我。' },
  { id: 'auto-edit', label: '自动编辑', description: '自动编辑文件。' },
  { id: 'plan-mode', label: '计划模式', description: '编辑前先出计划。' },
  { id: 'full-access', label: '完全访问', description: '减少确认次数。' },
] as const

type PermissionMode = typeof PERMISSION_MODES[number]['id']

// Icon for each permission mode
function PermIcon({ id, className }: { id: PermissionMode; className?: string }) {
  switch (id) {
    case 'confirm-before-change':
      return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
          <path d="M7.5 3a1.5 1.5 0 00-1.5 1.5v.75c0 .28.06.55.17.8L4.5 8.25a1.5 1.5 0 00-.44 1.06v1.44c0 .6.36 1.14.9 1.38l.54.24v2.88c0 .9.54 1.71 1.38 2.06l.12.05v1.89a.75.75 0 001.5 0v-2.25h1.5v2.25a.75.75 0 001.5 0v-2.25h.75c.41 0 .75-.34.75-.75v-6.19l1.28-1.28a.75.75 0 00-1.06-1.06l-1.72 1.72-.5-.22V4.5A1.5 1.5 0 009 3h-1.5z" />
        </svg>
      )
    case 'auto-edit':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3l1.9 5.7a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z" />
        </svg>
      )
    case 'plan-mode':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      )
    case 'full-access':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      )
  }
}

interface CommandInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  projectName?: string
  branchName?: string
  permission?: PermissionMode
  onPermissionChange?: (mode: PermissionMode) => void
}

export function CommandInput({
  onSend,
  disabled,
  projectName,
  branchName = 'main',
  permission = 'full-access',
  onPermissionChange
}: CommandInputProps) {
  const [input, setInput] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const permMenuRef = useRef<HTMLDivElement>(null)

  // Close permission menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (permMenuRef.current && !permMenuRef.current.contains(e.target as Node)) {
        setShowPermMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentPerm = PERMISSION_MODES.find((p) => p.id === permission) ?? PERMISSION_MODES[3]

  const handlePermSelect = useCallback((id: PermissionMode) => {
    onPermissionChange?.(id)
    setShowPermMenu(false)
  }, [onPermissionChange])

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`
    }
  }, [input])

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSend(input)
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-bg-input rounded-xl border border-[#3f3f46] shadow-lg">
        {/* Top row: project and branch selectors */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {projectName && (
            <button className="dropdown-btn">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span>{projectName}</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          <button className="dropdown-btn">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            </svg>
            <span>{branchName}</span>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Input area */}
        <div className="px-4 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="向 KCoder 提问, @ 提及文件、文件夹或画板, / 使用命令或子智能体, $ 使用技能, # 关联对话"
            disabled={disabled}
            rows={1}
            className="command-input resize-none min-h-[24px]"
          />
        </div>

        {/* Bottom row: actions and model selector */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button className="w-7 h-7 rounded-md bg-[#333336] hover:bg-[#3f3f46] flex items-center justify-center text-[#a1a1aa] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <div className="relative" ref={permMenuRef}>
              <button
                className="dropdown-btn !bg-transparent !px-2"
                onClick={() => setShowPermMenu(!showPermMenu)}
              >
                <span className="text-[#a1a1aa]">{currentPerm.label}</span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Permission mode dropdown menu */}
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-[240px] rounded-xl bg-[#2a2a2e] border border-[#3a3a3e] shadow-2xl py-1.5 z-50">
                  {PERMISSION_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => handlePermSelect(mode.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        permission === mode.id
                          ? 'bg-[#333338]'
                          : 'hover:bg-[#303034]'
                      }`}
                    >
                      <PermIcon id={mode.id} className="w-5 h-5 shrink-0 text-[#e4e4e7]" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-[#e4e4e7] leading-tight">{mode.label}</span>
                        <span className="block text-xs text-[#8b8b90] mt-0.5 leading-tight">{mode.description}</span>
                      </span>
                      {permission === mode.id && (
                        <svg className="w-4 h-4 shrink-0 text-[#e4e4e7]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Model selector */}
            <button className="dropdown-btn">
              <span>未配置模型</span>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={disabled || !input.trim()}
              className="w-8 h-8 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#3f3f46] disabled:cursor-not-allowed flex items-center justify-center text-black disabled:text-[#71717a] transition-colors"
            >
              {disabled ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
