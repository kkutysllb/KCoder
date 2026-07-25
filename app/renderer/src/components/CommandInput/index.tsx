import { useState, useRef, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI, type ModelEntry, type BranchListResponse } from '../../services/engine-api'

// Agent permission modes - maps to engine approvalPolicy/sandboxMode, backend integration reserved
const PERMISSION_MODES = [
  { id: 'confirm-before-change', labelKey: 'perm.confirmBeforeChange', descKey: 'perm.confirmBeforeChange.desc' },
  { id: 'auto-edit', labelKey: 'perm.autoEdit', descKey: 'perm.autoEdit.desc' },
  { id: 'plan-mode', labelKey: 'perm.planMode', descKey: 'perm.planMode.desc' },
  { id: 'full-access', labelKey: 'perm.fullAccess', descKey: 'perm.fullAccess.desc' },
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

/** 目录/分支选择器（输入框上方窄条） */
function DirectoryBranchBar() {
  const { t } = useI18n()
  const {
    enginePort, engineStatus,
    workspacePath, setWorkspacePath,
    selectedBranch, setSelectedBranch,
    selectedModel, setSelectedModel,
    pendingNewBranch, setPendingNewBranch
  } = useAppStore()

  const [models, setModels] = useState<ModelEntry[]>([])
  const [branches, setBranches] = useState<BranchListResponse | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [loadingDir, setLoadingDir] = useState(false)

  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showNewBranchInput, setShowNewBranchInput] = useState(false)
  const [newBranchValue, setNewBranchValue] = useState('')
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const newBranchRef = useRef<HTMLInputElement>(null)

  // 加载模型列表（连接后）
  useEffect(() => {
    if (engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getModels()
      .then((res) => {
        setModels(res.models)
        // 首次：若 store 未选模型，默认选 active 或第一个
        if (!useAppStore.getState().selectedModel) {
          const active = res.models.find((m) => m.active)
          setSelectedModel(active ? active.name : (res.models[0]?.name ?? null))
        }
      })
      .catch((e) => console.error('[CommandInput] Failed to load models:', e))
  }, [enginePort, engineStatus, setSelectedModel])

  // 选择目录后加载分支
  const loadDirectoryInfo = useCallback(async (path: string) => {
    const api = getEngineAPI(enginePort)
    setLoadingDir(true)
    try {
      // 后端对非 git 目录返回 { branches: [], current: null }（HTTP 200）；
      // 仅当请求本身失败（401/网络错误）时才进 catch。
      const branchList = await api.listBranches(path)
      setBranches(branchList)
      const hasBranches = branchList.branches.length > 0 || branchList.current !== null
      setIsGitRepo(hasBranches)
      if (branchList.current) {
        setSelectedBranch(branchList.current)
        setPendingNewBranch(null)
      } else if (branchList.branches.length > 0) {
        setSelectedBranch(branchList.branches[0])
        setPendingNewBranch(null)
      } else {
        setSelectedBranch(null)
      }
    } catch (e) {
      // 请求失败（认证/网络）—— 不要误判为"非 git 仓库"，记录错误并保留目录
      console.error('[CommandInput] Failed to load directory info:', e)
      setBranches(null)
      setIsGitRepo(false)
    } finally {
      setLoadingDir(false)
    }
  }, [enginePort, setSelectedBranch, setPendingNewBranch])

  // 打开文件夹选择器
  const handleBrowse = useCallback(async () => {
    const picked = await window.kcoder?.dialog?.openFolder()
    if (!picked) return
    setWorkspacePath(picked)
    setShowNewBranchInput(false)
    setNewBranchValue('')
    await loadDirectoryInfo(picked)
  }, [setWorkspacePath, loadDirectoryInfo])

  // 关闭菜单（点击外部）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setShowBranchMenu(false)
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 新建分支输入框聚焦
  useEffect(() => {
    if (showNewBranchInput) newBranchRef.current?.focus()
  }, [showNewBranchInput])

  const confirmNewBranch = useCallback(() => {
    const name = newBranchValue.trim()
    if (!name) {
      setShowNewBranchInput(false)
      return
    }
    setPendingNewBranch(name)
    setSelectedBranch(name)
    setShowNewBranchInput(false)
    setShowBranchMenu(false)
  }, [newBranchValue, setPendingNewBranch, setSelectedBranch])

  const branchLabel = pendingNewBranch
    ? `${pendingNewBranch}+`
    : (selectedBranch || (isGitRepo ? t('newtask.branch.createExisting') : '—'))

  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
      {/* 项目目录选择器 */}
      <button
        className="dropdown-btn"
        onClick={handleBrowse}
        title={workspacePath || t('newtask.directory.placeholder')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="max-w-[180px] truncate">
          {workspacePath ? workspacePath.split('/').pop() : t('newtask.directory')}
        </span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 仓库分支选择器 */}
      {workspacePath && (
        <div className="relative" ref={branchMenuRef}>
          <button
            className="dropdown-btn"
            onClick={() => setShowBranchMenu((v) => !v)}
            disabled={loadingDir}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v12m0 0l-3-3m3 3l3-3m6-9a9 9 0 110 18 9 9 0 010-18z" transform="matrix(-1 0 0 1 24 0)" />
            </svg>
            <span className="max-w-[140px] truncate">{loadingDir ? t('newtask.branch.loading') : branchLabel}</span>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showBranchMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl bg-[#2a2a2e] border border-[#3a3a3e] shadow-2xl py-1.5 z-50 max-h-64 overflow-y-auto">
              {!isGitRepo && branches === null && (
                <div className="px-4 py-2 text-xs text-text-muted">{t('newtask.branch.none')}</div>
              )}
              {branches?.branches.map((b) => (
                <button
                  key={b}
                  onClick={() => {
                    setSelectedBranch(b)
                    setPendingNewBranch(null)
                    setShowBranchMenu(false)
                  }}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                    selectedBranch === b && !pendingNewBranch ? 'bg-[#333338] text-text-primary' : 'text-[#c0c0c5] hover:bg-[#303034]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v12m0 0l-3-3m3 3l3-3" />
                  </svg>
                  <span className="truncate flex-1">{b}</span>
                  {b === branches.current && <span className="text-[10px] text-[#8a8a8f]">HEAD</span>}
                  {selectedBranch === b && !pendingNewBranch && (
                    <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
              {/* 新建分支 */}
              <div className="my-1 border-t border-[#3a3a3e]" />
              {showNewBranchInput ? (
                <div className="px-3 py-2 space-y-2">
                  <input
                    ref={newBranchRef}
                    type="text"
                    value={newBranchValue}
                    onChange={(e) => setNewBranchValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmNewBranch() }
                      if (e.key === 'Escape') { setShowNewBranchInput(false); setNewBranchValue('') }
                    }}
                    placeholder={t('newtask.branch.placeholder')}
                    className="w-full bg-bg-input text-text-primary placeholder-text-muted rounded-md px-2 py-1.5 text-xs outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={confirmNewBranch}
                      className="flex-1 px-2 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-gray-200"
                    >
                      {t('common.confirm')}
                    </button>
                    <button
                      onClick={() => { setShowNewBranchInput(false); setNewBranchValue('') }}
                      className="px-2 py-1 rounded-md text-text-secondary hover:bg-[#303034] text-xs"
                    >
                      {t('newtask.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewBranchInput(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] text-[#c0c0c5] hover:bg-[#303034] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{t('newtask.branch.new')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface CommandInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  permission?: PermissionMode
  onPermissionChange?: (mode: PermissionMode) => void
}

export function CommandInput({
  onSend,
  disabled,
  permission = 'full-access',
  onPermissionChange
}: CommandInputProps) {
  const [input, setInput] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const permMenuRef = useRef<HTMLDivElement>(null)
  const { t } = useI18n()

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

  // 模型选择器（底栏右侧）— 从 store 读取，复用 DirectoryBranchBar 加载的模型
  const { enginePort, engineStatus, selectedModel, setSelectedModel } = useAppStore()
  const [models, setModels] = useState<ModelEntry[]>([])
  const [showModelMenu, setShowModelMenu] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getModels()
      .then((res) => {
        setModels(res.models)
        if (!useAppStore.getState().selectedModel) {
          const active = res.models.find((m) => m.active)
          setSelectedModel(active ? active.name : (res.models[0]?.name ?? null))
        }
      })
      .catch(() => { /* 忽略 */ })
  }, [enginePort, engineStatus, setSelectedModel])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activeModel = models.find((m) => m.name === selectedModel)

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="bg-bg-input rounded-xl border border-border-strong shadow-lg">
        {/* Top row: project directory + branch selectors（窄条） */}
        <DirectoryBranchBar />

        {/* Input area */}
        <div className="px-4 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('input.placeholder')}
            disabled={disabled}
            rows={1}
            className="command-input resize-none min-h-[24px]"
          />
        </div>

        {/* Bottom row: actions and model selector */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button className="w-7 h-7 rounded-md bg-bg-active hover:bg-[#3f3f46] flex items-center justify-center text-text-secondary transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <div className="relative" ref={permMenuRef}>
              <button
                className="dropdown-btn !bg-transparent !px-2"
                onClick={() => setShowPermMenu(!showPermMenu)}
              >
                <span className="text-text-secondary">{t(currentPerm.labelKey)}</span>
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
                      <PermIcon id={mode.id} className="w-5 h-5 shrink-0 text-text-primary" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-text-primary leading-tight">{t(mode.labelKey)}</span>
                        <span className="block text-xs text-[#8b8b90] mt-0.5 leading-tight">{t(mode.descKey)}</span>
                      </span>
                      {permission === mode.id && (
                        <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className="relative" ref={modelMenuRef}>
              <button
                className="dropdown-btn"
                onClick={() => setShowModelMenu((v) => !v)}
              >
                <span className="max-w-[120px] truncate">{activeModel ? (activeModel.display_name || activeModel.name) : t('input.noModel')}</span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showModelMenu && (
                <div className="absolute bottom-full right-0 mb-2 w-56 rounded-xl bg-[#2a2a2e] border border-[#3a3a3e] shadow-2xl py-1.5 z-50 max-h-64 overflow-y-auto">
                  {models.length === 0 && (
                    <div className="px-4 py-2 text-xs text-text-muted">{t('newtask.model.none')}</div>
                  )}
                  {models.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => { setSelectedModel(m.name); setShowModelMenu(false) }}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                        selectedModel === m.name ? 'bg-[#333338] text-text-primary' : 'text-[#c0c0c5] hover:bg-[#303034]'
                      }`}
                    >
                      <span className="truncate flex-1">{m.display_name || m.name}</span>
                      {m.active && <span className="text-[#10b981] text-xs">★</span>}
                      {selectedModel === m.name && (
                        <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Send button */}
            <button
              onClick={handleSubmit}
              disabled={disabled || !input.trim()}
              className="w-8 h-8 rounded-full bg-white hover:bg-gray-200 disabled:bg-[#3f3f46] disabled:cursor-not-allowed flex items-center justify-center text-black disabled:text-text-muted transition-colors"
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
