import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import {
  getEngineAPI,
  type ModelEntry,
  type BranchListResponse,
  type ThreadResponse
} from '../../services/engine-api'

interface NewTaskDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreated?: (thread: ThreadResponse) => void
}

/**
 * 新建任务对话框。
 *
 * 选择项目目录（Electron 原生文件夹选择器）+ 选择/新建仓库分支 + 选模型 + 填标题，
 * 提交时调 POST /v1/threads 创建带完整参数的线程。
 *
 * 分支选择：选已有分支仅记录（后端当前检出分支即工作分支）；
 * 输入新分支名则先 POST /v1/workspace/branch 创建。
 */
export function NewTaskDialog({ isOpen, onClose, onCreated }: NewTaskDialogProps) {
  const { t } = useI18n()
  const { enginePort, engineStatus, setThreadId, setWorkspacePath } = useAppStore()

  const [directory, setDirectory] = useState('')
  const [branchMode, setBranchMode] = useState<'existing' | 'new'>('existing')
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [newBranchName, setNewBranchName] = useState('')
  const [branches, setBranches] = useState<BranchListResponse | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [isDirty, setIsDirty] = useState<boolean | null>(null)
  const [loadingBranches, setLoadingBranches] = useState(false)

  const [models, setModels] = useState<ModelEntry[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [mode, setMode] = useState<'agent' | 'plan'>('agent')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 加载模型列表（对话框打开时）
  useEffect(() => {
    if (!isOpen || engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getModels()
      .then((res) => {
        setModels(res.models)
        const active = res.models.find((m) => m.active)
        if (active) setSelectedModel(active.name)
        else if (res.models.length > 0) setSelectedModel(res.models[0].name)
      })
      .catch((e) => console.error('[NewTask] Failed to load models:', e))
  }, [isOpen, enginePort, engineStatus])

  // 选择目录后加载分支和工作区状态
  const loadDirectoryInfo = useCallback(async (path: string) => {
    const api = getEngineAPI(enginePort)
    setLoadingBranches(true)
    setError(null)
    try {
      const [status, branchList] = await Promise.all([
        api.getWorkspaceStatus(path).catch(() => null),
        api.listBranches(path).catch(() => null)
      ])
      setIsGitRepo(status?.isGitRepository ?? false)
      setIsDirty(status?.isDirty ?? null)
      setBranches(branchList)
      if (branchList && branchList.current) {
        setSelectedBranch(branchList.current)
        setBranchMode('existing')
      } else if (branchList && branchList.branches.length > 0) {
        setSelectedBranch(branchList.branches[0])
        setBranchMode('existing')
      } else {
        setSelectedBranch('')
        // 无分支或非 git 仓库，默认切到新建（若是 git 仓库）
        setBranchMode(status?.isGitRepository ? 'new' : 'existing')
      }
    } catch (e) {
      console.error('[NewTask] Failed to load directory info:', e)
    } finally {
      setLoadingBranches(false)
    }
  }, [enginePort])

  // 打开文件夹选择器
  const handleBrowse = useCallback(async () => {
    const picked = await window.kcoder?.dialog?.openFolder()
    if (!picked) return
    setDirectory(picked)
    await loadDirectoryInfo(picked)
  }, [loadDirectoryInfo])

  // 提交创建任务
  const handleCreate = useCallback(async () => {
    setError(null)
    if (!directory.trim()) {
      setError(t('newtask.error.directoryRequired'))
      return
    }
    if (!selectedModel) {
      setError(t('newtask.error.noModel'))
      return
    }

    setSubmitting(true)
    const api = getEngineAPI(enginePort)
    try {
      // 若选择新建分支，先创建（不切换检出）
      if (branchMode === 'new' && newBranchName.trim()) {
        try {
          await api.createBranch(directory, newBranchName.trim())
        } catch (e) {
          setError(t('newtask.error.branchCreate').replace('{detail}', (e as Error).message))
          setSubmitting(false)
          return
        }
      }

      // 创建线程（带 workspace/model/title/workModeId）
      const thread = await api.createThread({
        workspace: directory,
        model: selectedModel,
        title: taskTitle.trim() || undefined,
        workModeId: 'coding',
        mode
      })

      setThreadId(thread.id)
      setWorkspacePath(directory)
      onCreated?.(thread)
      onClose()
      // 重置表单
      setDirectory('')
      setNewBranchName('')
      setTaskTitle('')
      setBranches(null)
    } catch (e) {
      setError(t('newtask.error.threadCreate').replace('{detail}', (e as Error).message))
    } finally {
      setSubmitting(false)
    }
  }, [directory, selectedModel, branchMode, newBranchName, taskTitle, mode, enginePort, setThreadId, setWorkspacePath, onCreated, onClose, t])

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, submitting, onClose])

  if (!isOpen) return null

  const inputCls = 'w-full bg-bg-input text-text-primary placeholder-text-muted rounded-lg px-3 py-2 text-sm outline-none border border-transparent focus:border-[#3f3f46] transition-colors'
  const labelCls = 'block text-xs font-medium text-text-secondary mb-1.5'
  const branchBadgeText = isGitRepo
    ? branches?.current
      ? `${branches.current} · ${isDirty ? t('newtask.branch.dirty') : t('newtask.branch.clean')}`
      : t('newtask.branch.createExisting')
    : t('newtask.branch.none')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => !submitting && onClose()} />
      <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-border-custom bg-bg-sidebar shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-custom">
          <h2 className="text-base font-semibold text-text-primary">{t('newtask.title')}</h2>
          <button
            onClick={() => !submitting && onClose()}
            className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-md hover:bg-bg-hover"
            disabled={submitting}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* 项目目录 */}
          <div>
            <label className={labelCls}>{t('newtask.directory')}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-bg-input rounded-lg px-3 py-2 min-w-0">
                <svg className="w-4 h-4 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className={`truncate text-sm ${directory ? 'text-text-primary' : 'text-text-muted'}`}>
                  {directory || t('newtask.directory.placeholder')}
                </span>
                {directory && (
                  <span className="ml-auto shrink-0 text-[11px] text-text-muted bg-bg-active px-1.5 py-0.5 rounded">
                    {branchBadgeText}
                  </span>
                )}
              </div>
              <button
                onClick={handleBrowse}
                disabled={submitting}
                className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium bg-bg-active hover:bg-[#3f3f46] text-text-primary transition-colors disabled:opacity-50"
              >
                {t('newtask.browse')}
              </button>
            </div>
          </div>

          {/* 仓库分支 */}
          {directory && (
            <div>
              <label className={labelCls}>{t('newtask.branch')}</label>
              {!isGitRepo ? (
                <div className="text-xs text-text-muted bg-bg-input rounded-lg px-3 py-2">
                  {t('newtask.branch.none')}
                </div>
              ) : loadingBranches ? (
                <div className="text-xs text-text-muted px-1">{t('newtask.branch.loading')}</div>
              ) : (
                <>
                  {/* 切换：已有 / 新建 */}
                  <div className="flex items-center gap-1.5 mb-2 text-xs">
                    <button
                      onClick={() => setBranchMode('existing')}
                      disabled={submitting}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        branchMode === 'existing' ? 'bg-[#1e1e22] text-white' : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
                      }`}
                    >
                      {t('newtask.branch.existing')}
                    </button>
                    <button
                      onClick={() => setBranchMode('new')}
                      disabled={submitting}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        branchMode === 'new' ? 'bg-[#1e1e22] text-white' : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
                      }`}
                    >
                      {t('newtask.branch.new')}
                    </button>
                  </div>

                  {branchMode === 'existing' ? (
                    branches && branches.branches.length > 0 ? (
                      <select
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        disabled={submitting}
                        className={inputCls}
                      >
                        {branches.branches.map((b) => (
                          <option key={b} value={b}>{b}{b === branches.current ? ' (当前)' : ''}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-text-muted bg-bg-input rounded-lg px-3 py-2">
                        {t('newtask.branch.createExisting')}
                      </div>
                    )
                  ) : (
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      disabled={submitting}
                      placeholder={t('newtask.branch.placeholder')}
                      className={inputCls}
                    />
                  )}
                  <p className="text-[11px] text-text-muted mt-1.5">{t('newtask.branch.hint')}</p>
                </>
              )}
            </div>
          )}

          {/* 任务标题 */}
          <div>
            <label className={labelCls}>{t('newtask.taskTitle')}</label>
            <input
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              disabled={submitting}
              placeholder={t('newtask.taskTitle.placeholder')}
              className={inputCls}
            />
          </div>

          {/* 模型 + 模式 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{t('newtask.model')}</label>
              {models.length === 0 ? (
                <div className="text-xs text-text-muted bg-bg-input rounded-lg px-3 py-2">
                  {t('newtask.model.none')}
                </div>
              ) : (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={submitting}
                  className={inputCls}
                >
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.display_name || m.name}{m.active ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className={labelCls}>{t('newtask.workMode')}</label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setMode('agent')}
                  disabled={submitting}
                  className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    mode === 'agent' ? 'bg-[#1e1e22] text-white' : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
                  }`}
                >
                  {t('newtask.mode.agent')}
                </button>
                <button
                  onClick={() => setMode('plan')}
                  disabled={submitting}
                  className={`flex-1 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    mode === 'plan' ? 'bg-[#1e1e22] text-white' : 'bg-[#2d2d32] text-[#b0b0b5] hover:text-white'
                  }`}
                >
                  {t('newtask.mode.plan')}
                </button>
              </div>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-custom">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            {t('newtask.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={submitting || !directory || !selectedModel}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 disabled:bg-[#3f3f46] disabled:text-text-muted disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {submitting && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {submitting ? t('newtask.creating') : t('newtask.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
