import { useState, useRef, useEffect, useCallback } from 'react'

// Agent permission levels - maps to engine sandboxMode
const PERMISSION_LEVELS = [
  { id: 'read-only', label: '只读', description: '仅读取文件，不做任何修改' },
  { id: 'workspace-write', label: '工作区写入', description: '可修改当前工作区文件' },
  { id: 'danger-full-access', label: '完全访问', description: '可执行任意命令和文件操作' },
] as const

type PermissionLevel = typeof PERMISSION_LEVELS[number]['id']

interface CommandInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  projectName?: string
  branchName?: string
  permission?: PermissionLevel
  onPermissionChange?: (level: PermissionLevel) => void
}

export function CommandInput({
  onSend,
  disabled,
  projectName,
  branchName = 'main',
  permission = 'workspace-write',
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

  const currentPerm = PERMISSION_LEVELS.find((p) => p.id === permission) ?? PERMISSION_LEVELS[1]

  const handlePermSelect = useCallback((id: PermissionLevel) => {
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
      <div className="bg-bg-input rounded-xl border border-[#3f3f46] shadow-lg overflow-hidden">
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
                <svg className={`w-3.5 h-3.5 ${permission === 'danger-full-access' ? 'text-accent' : 'text-[#a1a1aa]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span className={permission === 'danger-full-access' ? 'text-accent' : 'text-[#a1a1aa]'}>{currentPerm.label}</span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Permission dropdown menu */}
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg bg-[#1e1e20] border border-[#333336] shadow-xl py-1 z-50">
                  <p className="px-3 py-1.5 text-[11px] text-[#52525b] uppercase tracking-wider">Agent 权限</p>
                  {PERMISSION_LEVELS.map((level) => (
                    <button
                      key={level.id}
                      onClick={() => handlePermSelect(level.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                        permission === level.id ? 'bg-[#2a2a2c]' : 'hover:bg-[#2a2a2c]'
                      }`}
                    >
                      <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                        permission === level.id ? 'bg-[#22c55e]' : 'bg-[#3f3f46]'
                      }`} />
                      <div>
                        <p className={`text-sm ${permission === level.id ? 'text-[#e4e4e7]' : 'text-[#a1a1aa]'}`}>{level.label}</p>
                        <p className="text-[11px] text-[#52525b] mt-0.5">{level.description}</p>
                      </div>
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
