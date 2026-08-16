import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI, type ModelEntry, type BranchListResponse, type ProjectEntry } from '../../services/engine-api'
import { getGeneralPref } from '../../lib/generalPrefs'

// Agent permission modes - maps to engine approvalPolicy/sandboxMode.
// NOTE: confirm-before-change / plan-mode 依赖后端审批中断（QiLin interrupts），
// 四种执行权限模式（引擎 PermissionMiddleware 按 configurable.permission_mode 拦截）。
// 全部启用：plan-mode=只读分析 / auto-edit=默认（编辑放行+危险命令拒绝）/
// confirm-before-change=变更前审批（Command 中断 + 前端审批卡）/
// full-access=完全放行。
const PERMISSION_MODES = [
  { id: 'plan-mode', labelKey: 'perm.planMode', descKey: 'perm.planMode.desc', enabled: true },
  { id: 'auto-edit', labelKey: 'perm.autoEdit', descKey: 'perm.autoEdit.desc', enabled: true },
  { id: 'confirm-before-change', labelKey: 'perm.confirmBeforeChange', descKey: 'perm.confirmBeforeChange.desc', enabled: true },
  { id: 'full-access', labelKey: 'perm.fullAccess', descKey: 'perm.fullAccess.desc', enabled: true },
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

/**
 * 菜单 Portal：渲染到 document.body + fixed 定位。
 * 输入卡片祖先链上有 overflow-hidden（新任务页圆角裁剪）和
 * backdrop-filter（会变成 fixed 的 containing block），菜单用
 * absolute 定位会被裁掉/错位——Portal 从根上绕开。
 */
function MenuPortal({
  anchorRef,
  open,
  align = 'left',
  width,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  align?: 'left' | 'right'
  width: number
  children: React.ReactNode
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const compute = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const left =
        align === 'right' ? Math.max(8, r.right - width) : Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      // 菜单整体位于 anchor 上方（等价原 bottom-full + mb-2），
      // 具体由 translateY(-100%) 完成，top 取 anchor 顶 - 8px。
      setPos({ left, top: Math.max(8, r.top - 8) })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open, anchorRef, align, width])

  if (!open || !pos) return null
  return createPortal(
    <div
      className="k-menu-portal fixed z-[9999] rounded-xl bg-bg-hover border border-border-strong shadow-2xl py-1.5 max-h-72 overflow-y-auto"
      style={{ left: pos.left, top: pos.top, width, transform: 'translateY(-100%)' }}
    >
      {children}
    </div>,
    document.body
  )
}

/** 目录/分支选择器（输入框上方窄条） */
function DirectoryBranchBar() {
  const { t } = useI18n()
  const {
    enginePort, engineStatus,
    workspacePath, setWorkspacePath,
    selectedBranch, setSelectedBranch,
    selectedModel, setSelectedModel,
    pendingNewBranch, setPendingNewBranch,
    clearMessages, setPanelOpen
  } = useAppStore()

  const [models, setModels] = useState<ModelEntry[]>([])
  const [branches, setBranches] = useState<BranchListResponse | null>(null)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [loadingDir, setLoadingDir] = useState(false)
  const [projects, setProjects] = useState<ProjectEntry[]>([])

  const [showDirMenu, setShowDirMenu] = useState(false)
  const [showBranchMenu, setShowBranchMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const dirMenuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

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

  // 打开目录下拉菜单时加载已注册项目（最近使用的目录）
  useEffect(() => {
    if (!showDirMenu || engineStatus !== 'connected') return
    getEngineAPI(enginePort)
      .listProjects()
      .then((res) => setProjects(res.projects))
      .catch((e) => console.error('[CommandInput] Failed to load projects:', e))
  }, [showDirMenu, enginePort, engineStatus])

  // 切换到指定项目（下拉菜单选中项）。与 handleBrowse 同语义：
  // 切换 = 开新会话（thread 的 workspace 创建时绑定，不可改）。
  // path 为空串 = 「无项目」普通对话（thread 不绑定 workspace）。
  const handlePickProject = useCallback(async (path: string) => {
    setShowDirMenu(false)
    const next = path || null
    if (next === workspacePath) return
    clearMessages()
    setPanelOpen(false)
    setWorkspacePath(next)
    if (next) await loadDirectoryInfo(next)
    else {
      // 无项目：清掉分支态（分支 chip 随 workspacePath 消失）
      setBranches(null)
      setIsGitRepo(false)
      setSelectedBranch(null)
      setPendingNewBranch(null)
    }
  }, [workspacePath, clearMessages, setPanelOpen, setWorkspacePath, loadDirectoryInfo, setBranches, setIsGitRepo, setSelectedBranch, setPendingNewBranch])

  // 打开文件夹选择器
  const handleBrowse = useCallback(async () => {
    setShowDirMenu(false)
    const picked = await window.kcoder?.dialog?.openFolder()
    if (!picked) return
    // 切换到不同项目 = 开启新会话。thread 的 workspace 在创建时绑定（PATCH 不
    // 允许修改），且旧线程携带旧项目的完整对话历史；若沿用旧 threadId，新消息
    // 会发进旧线程，agent 将基于旧 workspace + 旧历史作答（表现为"答非所问"）。
    if (picked !== workspacePath) {
      clearMessages() // 重置 messages_v2 / threadId / 分支草稿等会话态
      setPanelOpen(false) // 新会话从干净布局开始；下一条编码消息会自动重开面板
    }
    setWorkspacePath(picked)
    await loadDirectoryInfo(picked)
  }, [workspacePath, clearMessages, setPanelOpen, setWorkspacePath, loadDirectoryInfo])

  // 关闭菜单（点击外部）。菜单内容渲染在 body 下的 Portal 里（绕开输入卡片
  // 的 overflow 裁剪），因此除了 anchor 容器，还要放行 Portal 内部的点击。
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.k-menu-portal')) return
      if (dirMenuRef.current && !dirMenuRef.current.contains(target)) {
        setShowDirMenu(false)
      }
      if (branchMenuRef.current && !branchMenuRef.current.contains(target)) {
        setShowBranchMenu(false)
      }
      if (modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 分支搜索/创建（菜单内输入框）：过滤列表；输入不存在的分支名 → 创建项
  const [branchSearch, setBranchSearch] = useState('')
  const branchSearchRef = useRef<HTMLInputElement>(null)

  // 菜单打开时聚焦搜索框并清空上次搜索
  useEffect(() => {
    if (showBranchMenu) {
      setBranchSearch('')
      // Portal 渲染在 body 下，等一帧再聚焦
      requestAnimationFrame(() => branchSearchRef.current?.focus())
    }
  }, [showBranchMenu])

  /** 搜索关键字精确匹配的分支不存在 → 以此名创建（发首条消息时 checkout -b）。 */
  const createBranchFromSearch = useCallback(() => {
    const name = branchSearch.trim()
    if (!name) return
    setPendingNewBranch(name)
    setSelectedBranch(name)
    setShowBranchMenu(false)
  }, [branchSearch, setPendingNewBranch, setSelectedBranch])

  const branchLabel = pendingNewBranch
    ? `${pendingNewBranch}+`
    : (selectedBranch || (isGitRepo ? t('newtask.branch.createExisting') : '—'))

  // 搜索过滤后的分支列表（大小写不敏感子串匹配）
  const filteredBranches = useMemo(() => {
    const all = branches?.branches ?? []
    const q = branchSearch.trim().toLowerCase()
    if (!q) return all
    return all.filter((b) => b.toLowerCase().includes(q))
  }, [branches, branchSearch])

  return (
    <div className="composer-dirbar">
      {/* 项目目录选择器：点击弹下拉（最近项目 + 选择目录），不再直接弹系统选择器 */}
      <div className="relative" ref={dirMenuRef}>
        <button
          className="composer-chip"
          onClick={() => setShowDirMenu((v) => !v)}
          title={workspacePath || t('newtask.directory.placeholder')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="max-w-[140px] truncate">
            {workspacePath ? workspacePath.split('/').pop() : t('newtask.directory')}
          </span>
          <svg className="w-3 h-3 caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <MenuPortal anchorRef={dirMenuRef} open={showDirMenu} width={288}>
            {/* 分组标题：项目 */}
            <div className="px-4 pt-1.5 pb-1 text-[11px] text-muted-icon">{t('sidebar.project')}</div>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePickProject(p.path)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                  p.path === workspacePath ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-[10px] text-text-muted">{p.path}</span>
                </span>
                {p.path === workspacePath && (
                  <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
            {projects.length === 0 && (
              <div className="px-4 py-2 text-xs text-text-muted">{t('newtask.directory.noProjects')}</div>
            )}
            {/* 无项目：普通对话（thread 不绑定 workspace，不进项目分组） */}
            <button
              onClick={() => handlePickProject('')}
              className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                !workspacePath ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{t('newtask.directory.noProject')}</span>
                <span className="block truncate text-[10px] text-text-muted">{t('newtask.directory.noProjectDesc')}</span>
              </span>
              {!workspacePath && (
                <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            {/* 选择目录（系统文件夹选择器） */}
            <div className="my-1 border-t border-border-strong" />
            <button
              onClick={() => {
                setShowDirMenu(false)
                handleBrowse()
              }}
              className="w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
              <span>{t('newtask.directory.pick')}</span>
            </button>
            {/* 在 Finder 中显示当前目录（需已选目录） */}
            {workspacePath && (
              <button
                onClick={() => {
                  setShowDirMenu(false)
                  window.kcoder?.dialog?.showInFolder?.(workspacePath)
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] text-text-secondary hover:bg-bg-hover transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 12l2 2 4-4" />
                </svg>
                <span>{t('newtask.directory.reveal')}</span>
              </button>
            )}
        </MenuPortal>
      </div>

      {/* 仓库分支选择器 */}
      {workspacePath && (
        <div className="relative" ref={branchMenuRef}>
          <button
            className="composer-chip"
            onClick={() => setShowBranchMenu((v) => !v)}
            disabled={loadingDir}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v12m0 0l-3-3m3 3l3-3m6-9a9 9 0 110 18 9 9 0 010-18z" transform="matrix(-1 0 0 1 24 0)" />
            </svg>
            <span className="max-w-[110px] truncate">{loadingDir ? t('newtask.branch.loading') : branchLabel}</span>
            <svg className="w-3 h-3 caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <MenuPortal anchorRef={branchMenuRef} open={showBranchMenu} width={256}>
              {/* 搜索 / 创建分支 */}
              <div className="px-2.5 pt-1.5 pb-1 sticky top-0 bg-bg-hover">
                <input
                  ref={branchSearchRef}
                  type="text"
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      // 回车：列表有匹配 → 切换第一个；无精确匹配 → 创建
                      if (filteredBranches.length > 0 && filteredBranches.some((b) => b === branchSearch.trim())) {
                        setSelectedBranch(branchSearch.trim())
                        setPendingNewBranch(null)
                        setShowBranchMenu(false)
                      } else if (branchSearch.trim()) {
                        createBranchFromSearch()
                      } else if (filteredBranches.length > 0) {
                        // 空搜索回车：保持当前分支
                        setShowBranchMenu(false)
                      }
                    }
                    if (e.key === 'Escape') setShowBranchMenu(false)
                  }}
                  placeholder={t('newtask.branch.searchOrCreate')}
                  className="w-full bg-bg-surface border border-border-strong focus:border-[#4a4a4e] text-text-primary placeholder-text-muted rounded-md px-2.5 py-1.5 text-xs outline-none transition-colors"
                />
              </div>

              {!isGitRepo && branches === null && (
                <div className="px-4 py-2 text-xs text-text-muted">{t('newtask.branch.none')}</div>
              )}
              {isGitRepo && filteredBranches.length === 0 && branchSearch.trim() && (
                <div className="px-4 py-1.5 text-xs text-text-muted">{t('newtask.branch.noMatch')}</div>
              )}
              {filteredBranches.map((b) => (
                <button
                  key={b}
                  onClick={async () => {
                    // 检出已有分支（真实 git checkout）。脏工作区会被网关 409 拒绝，
                    // 错误信息直接提示用户先提交/撤销。
                    if (!workspacePath || b === branches?.current) {
                      setSelectedBranch(b)
                      setPendingNewBranch(null)
                      setShowBranchMenu(false)
                      return
                    }
                    try {
                      await getEngineAPI(enginePort).checkoutBranch(workspacePath, b)
                      setSelectedBranch(b)
                      setPendingNewBranch(null)
                      setShowBranchMenu(false)
                      await loadDirectoryInfo(workspacePath)
                    } catch (e) {
                      alert(`${t('newtask.branch.switchFailed')}: ${e instanceof Error ? e.message : e}`)
                    }
                  }}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                    selectedBranch === b && !pendingNewBranch ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3v12m0 0l-3-3m3 3l3-3" />
                  </svg>
                  <span className="truncate flex-1">{b}</span>
                  {b === branches?.current && <span className="text-[10px] text-muted-icon">HEAD</span>}
                  {selectedBranch === b && !pendingNewBranch && (
                    <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
              {/* 搜索词不是已有分支 → 创建项（发首条消息时 checkout -b） */}
              {branchSearch.trim() && !filteredBranches.some((b) => b === branchSearch.trim()) && (
                <>
                  <div className="my-1 border-t border-border-strong" />
                  <button
                    onClick={createBranchFromSearch}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] text-info hover:bg-bg-hover transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="truncate">
                      {t('newtask.branch.create')} <span className="font-mono">"{branchSearch.trim()}"</span>
                    </span>
                  </button>
                </>
              )}
          </MenuPortal>
        </div>
      )}
    </div>
  )
}

interface CommandInputProps {
  onSend: (message: string, attachmentIds?: string[]) => void
  disabled?: boolean
  /** True when the agent is currently generating — shows stop button + steer. */
  isGenerating?: boolean
  /** Stop the current turn (interrupt). */
  onStop?: () => void
  /** Append instructions to the running turn (steer / guide mode). */
  onSteer?: (text: string) => void
  /** Queue a message for after the current turn finishes (queue mode). */
  onQueue?: (text: string) => void
  /**
   * 是否显示顶部「目录 + 分支」窄条（任务创建参数）。默认 true（新任务页）。
   * 历史任务传 false：thread 的 workspace/分支创建时已绑定，任务中途展示
   * 选择器暗示可切换，概念混乱且易误触（切换 = 开新会话）。
   */
  showDirBar?: boolean
  /** 手动压缩上下文（强制压缩 turn；任务页低频操作）。 */
  onCompact?: () => void
}

export function CommandInput({
  onSend,
  disabled,
  isGenerating,
  onStop,
  onSteer,
  onQueue,
  showDirBar = true,
  onCompact
}: CommandInputProps) {
  const [input, setInput] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const permMenuRef = useRef<HTMLDivElement>(null)

  // 粘贴剪贴板图片 → 走附件管线（截图快速喂给 agent）。
  // 纯文本粘贴不拦截，正常进 textarea。
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    const images: File[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) images.push(f)
      }
    }
    if (images.length > 0) {
      e.preventDefault() // 阻止图片二进制进入 textarea
      setPendingFiles((prev) => [...prev, ...images])
    }
  }, [])
  const { t } = useI18n()

  // ── @-mention：输入 @ 触发文件选择器，选中后插入路径并加入上下文 ──
  const [filesIndex, setFilesIndex] = useState<string[] | null>(null)
  const [mention, setMention] = useState<{ active: boolean; query: string; start: number }>({ active: false, query: '', start: -1 })
  const [mentionIdx, setMentionIdx] = useState(0)
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([])

  // 首次触发 @ 时懒加载工作区文件清单（缓存到 filesIndex）。
  // 用 getState() 读 workspacePath/enginePort，避免与下方 store 解构的 TDZ 冲突。
  const ensureFilesIndex = useCallback(async () => {
    if (filesIndex) return
    const { workspacePath: wp, enginePort: ep } = useAppStore.getState()
    if (!wp) return
    try {
      const data = await getEngineAPI(ep).workspaceFiles(wp)
      setFilesIndex(data.files)
    } catch (e) {
      console.error('[CommandInput] load files index failed:', e)
    }
  }, [filesIndex])

  // 从光标位置提取当前 @token
  const detectMention = useCallback((value: string, cursor: number) => {
    const before = value.slice(0, cursor)
    const m = before.match(/(^|\s)@([\w./\-]*)$/)
    if (!m) {
      setMention({ active: false, query: '', start: -1 })
      return
    }
    const atIdx = (m.index ?? 0) + m[1].length
    setMention({ active: true, query: m[2], start: atIdx })
    setMentionIdx(0)
    void ensureFilesIndex()
  }, [ensureFilesIndex])

  const mentionResults = useMemo(() => {
    if (!mention.active || !filesIndex) return []
    const q = mention.query.toLowerCase()
    const filtered = q
      ? filesIndex.filter((f) => f.toLowerCase().includes(q)).slice(0, 12)
      : filesIndex.slice(0, 12)
    return filtered
  }, [mention, filesIndex])

  const insertMention = useCallback((file: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const before = input.slice(0, mention.start)
    const after = input.slice(cursor)
    const next = `${before}@${file} ${after}`
    setInput(next)
    setMention({ active: false, query: '', start: -1 })
    setMentionedFiles((prev) => (prev.includes(file) ? prev : [...prev, file]))
    requestAnimationFrame(() => {
      const pos = (before + `@${file} `).length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }, [input, mention.start])

  // Close permission menu on outside click（Portal 内容放行，见 DirectoryBranchBar 注释）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.k-menu-portal')) return
      if (permMenuRef.current && !permMenuRef.current.contains(target)) {
        setShowPermMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 执行权限：store 单源（新任务页/任务页共用，sendMessage 透传给引擎）
  const permission = useAppStore((s) => s.permissionMode)
  const setPermissionMode = useAppStore((s) => s.setPermissionMode)

  const currentPerm = PERMISSION_MODES.find((p) => p.id === permission) ?? PERMISSION_MODES[1]

  const handlePermSelect = useCallback((id: PermissionMode) => {
    setPermissionMode(id)
    setShowPermMenu(false)
  }, [setPermissionMode])

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

  const handleSubmit = async () => {
    const text = input.trim()
    if (!text && pendingFiles.length === 0) return

    // isGenerating：按 interactionMode 分流
    // guide → steer（追加到运行中的 turn）
    // queue → onQueue（排队等 turn 完成后自动发送）
    if (isGenerating) {
      const mode = getGeneralPref('interactionMode')
      if (mode === 'guide' && onSteer) {
        onSteer(text)
      } else if (onQueue) {
        onQueue(text)
      } else if (onSteer) {
        onSteer(text)
      }
      setInput('')
      return
    }

    if (disabled) return

    let attachmentIds: string[] | undefined
    // Upload pending files as attachments before sending.
    if (pendingFiles.length > 0) {
      setUploadingFiles(true)
      try {
        const api = getEngineAPI(enginePort)
        const uploaded = await Promise.all(
          pendingFiles.map((f) =>
            api.uploadAttachment(f, {
              ...(threadId ? { threadId } : {}),
              ...(workspacePath ? { workspace: workspacePath } : {})
            })
          )
        )
        attachmentIds = uploaded.map((a) => a.id)
      } catch (e) {
        console.error('[CommandInput] attachment upload failed:', e)
      } finally {
        setUploadingFiles(false)
      }
    }
    const messageText = text || (pendingFiles.length > 0 ? `(${pendingFiles.length} file(s))` : '')
    // 把 @-mention 的文件作为「请参考」上下文注入 prompt（agent 用 read 工具读取）
    const finalText = mentionedFiles.length > 0
      ? `${messageText}\n\n<user_referenced_files>\n请参考以下工作区文件（相对路径）：\n${mentionedFiles.map((f) => `- ${f}`).join('\n')}\n</user_referenced_files>`
      : messageText
    onSend(finalText, attachmentIds)
    setInput('')
    setPendingFiles([])
    setMentionedFiles([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // @-mention 键盘导航：↑↓ 选择、Enter 确认、Esc 关闭
    if (mention.active && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        insertMention(mentionResults[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        setMention({ active: false, query: '', start: -1 })
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // 模型选择器（底栏右侧）— 从 store 读取，复用 DirectoryBranchBar 加载的模型
  const { enginePort, engineStatus, selectedModel, setSelectedModel, modelVersion, threadId, workspacePath, reasoningMode, setReasoningMode } = useAppStore()
  const [models, setModels] = useState<ModelEntry[]>([])
  const [showModelMenu, setShowModelMenu] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (engineStatus !== 'connected') return
    const api = getEngineAPI(enginePort)
    api.getModels()
      .then((res) => {
        setModels(res.models)
        // 每次刷新都重新选择 active 模型（设置页配置变更后立即生效）
        const active = res.models.find((m) => m.active)
        if (active) {
          setSelectedModel(active.name)
        } else if (!useAppStore.getState().selectedModel && res.models.length > 0) {
          setSelectedModel(res.models[0].name)
        }
      })
      .catch((e) => {
        // 静默吞错会掩盖"模型 API 失败"导致的"未配置模型"误导性提示。
        // 至少打日志便于诊断；UI 层有 selectedModel fallback 显示当前选择名。
        console.error('[CommandInput] Failed to load models:', e)
      })
  }, [enginePort, engineStatus, setSelectedModel, modelVersion])

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
  // 即使 models 还没加载好（异步竞态 / getModels 失败），也用 selectedModel
  // 兜底显示当前选择的模型名，避免误导用户看到"未配置模型"。
  const displayModelName = activeModel?.display_name || activeModel?.name || selectedModel || t('input.noModel')

  return (
    <div className="flex flex-col gap-1 w-full">
    <div className="composer-card">
      {/* Top row: project directory + branch selectors（窄条，仅新任务页） */}
      {showDirBar && <DirectoryBranchBar />}

        {/* Pending attachments preview */}
        {pendingFiles.length > 0 && (
          <div className="px-4 pt-2 flex flex-wrap gap-1.5">
            {pendingFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-bg-hover text-[11px] text-text-secondary border border-border-custom">
                <svg className="w-3 h-3 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                <span className="truncate max-w-32">{f.name}</span>
                <button
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-text-muted hover:text-danger transition-colors shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* @-mention 引用的文件 chips */}
        {mentionedFiles.length > 0 && (
          <div className="px-4 pt-2 flex flex-wrap gap-1.5">
            {mentionedFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-md bg-info/10 text-[11px] text-info border border-info/30">
                <span className="text-info">@</span>
                <span className="truncate max-w-40 font-mono">{f}</span>
                <button
                  onClick={() => setMentionedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-info/60 hover:text-danger transition-colors shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Input area */}
        <div
          className="px-4 py-2"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const dropped = Array.from(e.dataTransfer.files)
            if (dropped.length > 0) setPendingFiles((prev) => [...prev, ...dropped])
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              detectMention(e.target.value, e.target.selectionStart)
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isGenerating ? t('chat.steer.placeholder') : t('input.placeholder')}
            disabled={disabled && !isGenerating}
            rows={1}
            className={`command-input resize-none ${isGenerating ? 'placeholder-info' : ''}`}
          />
          {/* @-mention 文件选择器（Portal 渲染，避免被输入卡片 overflow 裁剪） */}
          <MenuPortal anchorRef={textareaRef} open={mention.active && mentionResults.length > 0} width={320}>
              {mentionResults.map((f, i) => (
                <button
                  key={f}
                  onMouseEnter={() => setMentionIdx(i)}
                  onClick={() => insertMention(f)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${i === mentionIdx ? 'bg-bg-active text-text-primary' : 'text-text-secondary'}`}
                >
                  <svg className="w-3 h-3 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate font-mono">{f}</span>
                </button>
              ))}
          </MenuPortal>
        </div>

        {/* Bottom toolbar: actions + model selector + send */}
        <div className="composer-toolbar">
          <div className="flex items-center gap-2">
            {/* Attachment button (paperclip) — opens file picker */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length > 0) {
                  setPendingFiles((prev) => [...prev, ...Array.from(files)])
                  e.target.value = ''
                }
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t('chat.attach')}
              disabled={uploadingFiles}
              className="composer-chip !p-0 !w-7 !h-7 justify-center"
            >
              {uploadingFiles ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
              )}
            </button>

            {/* 手动压缩上下文（长任务历史摘要；运行中禁用） */}
            {onCompact && (
              <button
                type="button"
                onClick={onCompact}
                disabled={isGenerating}
                title={t('input.compactContext')}
                className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:text-text-muted"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V6a2 2 0 012-2h3M20 9V6a2 2 0 00-2-2h-3M4 15v3a2 2 0 002 2h3M20 15v3a2 2 0 01-2 2h-3M9 12h6" />
                </svg>
              </button>
            )}
            <div className="relative" ref={permMenuRef}>
              <button
                className="composer-chip"
                onClick={() => setShowPermMenu(!showPermMenu)}
              >
                <span>{t(currentPerm.labelKey)}</span>
                <svg className="w-3 h-3 caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Permission mode dropdown menu */}
              <MenuPortal anchorRef={permMenuRef} open={showPermMenu} width={240}>
                  {PERMISSION_MODES.map((mode) => {
                    const disabled = !mode.enabled
                    return (
                    <button
                      key={mode.id}
                      disabled={disabled}
                      onClick={() => !disabled && handlePermSelect(mode.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : permission === mode.id
                            ? 'bg-bg-active'
                            : 'hover:bg-bg-hover'
                      }`}
                    >
                      <PermIcon id={mode.id} className="w-5 h-5 shrink-0 text-text-primary" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-medium text-text-primary leading-tight">
                          {t(mode.labelKey)}
                          {disabled && (
                            <span className="ml-1.5 align-middle text-[10px] font-normal text-muted-icon border border-[#4a4a4e] rounded px-1 py-px">{t('perm.comingSoon')}</span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-icon mt-0.5 leading-tight">{t(mode.descKey)}</span>
                      </span>
                      {permission === mode.id && !disabled && (
                        <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    )
                  })}
              </MenuPortal>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* 推理深度选择器（参考 KStock ReasoningModePicker） */}
            <ReasoningModePicker
              model={activeModel}
              value={reasoningMode}
              onChange={setReasoningMode}
            />

            {/* Model selector */}
            <div className="relative" ref={modelMenuRef}>
              <button
                className="composer-chip"
                onClick={() => setShowModelMenu((v) => !v)}
              >
                <span className="max-w-[110px] truncate">{displayModelName}</span>
                <svg className="w-3 h-3 caret" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <MenuPortal anchorRef={modelMenuRef} open={showModelMenu} align="right" width={224}>
                  {models.length === 0 && (
                    <div className="px-4 py-2 text-xs text-text-muted">{t('newtask.model.none')}</div>
                  )}
                  {models.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => { setSelectedModel(m.name); setShowModelMenu(false) }}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors ${
                        selectedModel === m.name ? 'bg-bg-active text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      <span className="truncate flex-1">{m.display_name || m.name}</span>
                      {m.active && <span className="text-teal text-xs">★</span>}
                      {selectedModel === m.name && (
                        <svg className="w-4 h-4 shrink-0 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
              </MenuPortal>
            </div>

            {/* Send / Stop button */}
            {isGenerating ? (
              <button
                type="button"
                onClick={() => onStop?.()}
                title={t('chat.stop')}
                aria-label={t('chat.stop')}
                className="send-button stop"
              >
                {/* Stop icon (square) */}
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={disabled || !input.trim()}
                aria-label="发送消息"
                className="send-button"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </div>
        </div>
    </div>

      {/* ROI 缩略条 — 紧贴输入框下方，始终展示会话用量摘要；hover 上浮详情 */}
      <RoiMiniStrip />
    </div>
  )
}

/**
 * 推理深度选择器（参考 KStock ReasoningModePicker）。
 * - auto / off：所有模型可用
 * - low / medium / high：仅模型 supports_thinking && supports_reasoning_effort 时可用
 */
function ReasoningModePicker({
  model,
  value,
  onChange
}: {
  model: ModelEntry | undefined
  value: 'auto' | 'off' | 'low' | 'medium' | 'high'
  onChange: (mode: 'auto' | 'off' | 'low' | 'medium' | 'high') => void
}) {
  const { t } = useI18n()
  const supportsEffort = Boolean(model?.supports_thinking)
  const effectiveValue = supportsEffort || value === 'auto' || value === 'off' ? value : 'auto'

  return (
    <label
      className="reasoning-mode-picker"
      title={supportsEffort ? t('chat.reasoning.title') : t('chat.reasoning.titleLimited')}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.5v15m7.5-7.5h-15M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{t('chat.reasoning')}</span>
      <select
        aria-label="推理模式"
        value={effectiveValue}
        disabled={!model}
        onChange={(e) => onChange(e.target.value as 'auto' | 'off' | 'low' | 'medium' | 'high')}
      >
        <option value="auto">{t('chat.reasoning.auto')}</option>
        <option value="off">{t('chat.reasoning.off')}</option>
        {supportsEffort && <option value="low">{t('chat.reasoning.low')}</option>}
        {supportsEffort && <option value="medium">{t('chat.reasoning.medium')}</option>}
        {supportsEffort && <option value="high">{t('chat.reasoning.high')}</option>}
      </select>
    </label>
  )
}

/**
 * ROI 缩略条 — 紧贴输入框下方的独立窄条，始终展示当前会话的 token 用量摘要。
 * 鼠标 hover 时在上方弹出详细统计面板，维度参考 KWorks：
 * - 会话总量（输入/输出/总量）
 * - 工具调用次数
 * - 思考耗时
 * - 平均回合用量
 */
function RoiMiniStrip() {
  const { t } = useI18n()
  const sessionUsage = useAppStore((s) => s.sessionUsage)
  const isGenerating = useAppStore((s) => s.isGenerating)
  const messages = useAppStore((s) => s.messages_v2)

  const total = sessionUsage.totalTokens
  const promptPct = total > 0 ? (sessionUsage.promptTokens / total) * 100 : 0
  const completionPct = total > 0 ? (sessionUsage.completionTokens / total) * 100 : 0

  // 从 messages_v2 聚合工具调用、思考耗时等维度
  const assistantTurns = messages.filter((m) => m.role === 'assistant')
  const totalToolCalls = assistantTurns.reduce((sum, m) => sum + (m.toolCalls?.length ?? 0), 0)
  const totalThinkingMs = assistantTurns.reduce((sum, m) => sum + (m.thinkingMs ?? 0), 0)
  const completedTurns = assistantTurns.filter((m) => m.status === 'done').length
  const failedTurns = assistantTurns.filter((m) => m.status === 'error').length

  return (
    <div className="group relative">
      {/* 摘要条 — 固定高度，始终可见 */}
      <div className="flex items-center gap-2 px-4 h-6 rounded-lg bg-bg-surface/60 border border-border-subtle backdrop-blur-sm">
        {/* 运行中脉冲指示灯 */}
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isGenerating ? 'bg-success animate-pulse' : 'bg-text-muted/40'
          }`}
        />
        {/* 摘要数字 */}
        <div className="flex items-center gap-2.5 text-[10px] font-mono text-text-muted shrink-0">
          <span>↓{formatTokens(sessionUsage.promptTokens)}</span>
          <span>↑{formatTokens(sessionUsage.completionTokens)}</span>
          {total > 0 && <span className="text-text-secondary">Σ{formatTokens(total)}</span>}
          <span>{sessionUsage.runs}{sessionUsage.runs !== 1 ? ' runs' : ' run'}</span>
        </div>
        {/* 微型 token 比例条 */}
        <div className="flex-1 h-1 rounded-full bg-bg-hover overflow-hidden flex">
          <div className="bg-info/60" style={{ width: `${promptPct}%` }} title={`Prompt: ${formatTokens(sessionUsage.promptTokens)}`} />
          <div className="bg-success/60" style={{ width: `${completionPct}%` }} title={`Completion: ${formatTokens(sessionUsage.completionTokens)}`} />
        </div>
        {/* hover 展开箭头（向上） */}
        <svg className="w-2.5 h-2.5 text-text-muted transition-transform group-hover:-rotate-180 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* hover 弹出详情 — 向上悬浮，不占文档流空间 */}
      <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150 absolute right-0 bottom-full mb-1 z-40 rounded-lg border border-border-subtle bg-bg-sidebar shadow-2xl p-3 space-y-2 w-72">
        {/* ── Token 用量区 ── */}
        <div>
          <p className="text-[9px] font-medium text-text-muted uppercase tracking-wide mb-1.5">Tokens</p>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-text-muted">{t('roi.prompt')}</span>
              <span className="font-mono text-info">↓{formatTokens(sessionUsage.promptTokens)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-text-muted">{t('roi.completion')}</span>
              <span className="font-mono text-success">↑{formatTokens(sessionUsage.completionTokens)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-text-muted">{t('roi.avgPerRun')}</span>
              <span className="font-mono text-text-secondary">
                {sessionUsage.runs > 0 ? formatTokens(Math.round(total / sessionUsage.runs)) : '—'}
                <span className="text-text-muted ml-1">/ run</span>
              </span>
            </div>
          </div>
        </div>

        {/* ── 任务效率区 ── */}
        <div className="border-t border-border-subtle pt-2">
          <p className="text-[9px] font-medium text-text-muted uppercase tracking-wide mb-1.5">{t('roi.efficiency')}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-text-muted">{t('roi.runs')}</span>
              <span className="font-mono text-text-secondary">{sessionUsage.runs}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t('roi.toolCalls')}</span>
              <span className="font-mono text-text-secondary">{totalToolCalls}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t('roi.thinking')}</span>
              <span className="font-mono text-text-secondary">{formatDuration(totalThinkingMs)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">{t('roi.successRate')}</span>
              <span className="font-mono text-text-secondary">
                {sessionUsage.runs > 0
                  ? `${Math.round((completedTurns / sessionUsage.runs) * 100)}%`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* ── 任务状态分布 ── */}
        {sessionUsage.runs > 0 && (
          <div className="border-t border-border-subtle pt-2">
            <div className="flex items-center gap-2 h-1.5 rounded-full overflow-hidden bg-bg-hover">
              {completedTurns > 0 && (
                <div className="bg-success/70" style={{ width: `${(completedTurns / sessionUsage.runs) * 100}%` }} title={`Done: ${completedTurns}`} />
              )}
              {failedTurns > 0 && (
                <div className="bg-danger/70" style={{ width: `${(failedTurns / sessionUsage.runs) * 100}%` }} title={`Error: ${failedTurns}`} />
              )}
              {isGenerating && (
                <div className="bg-info/70 animate-pulse" style={{ width: '100%' }} title="Running" />
              )}
            </div>
            <div className="flex gap-3 mt-1 text-[9px] text-text-muted">
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-success/70" />{completedTurns}</span>
              {failedTurns > 0 && (
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-danger/70" />{failedTurns}</span>
              )}
              {isGenerating && (
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-info/70 animate-pulse" />1</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1_000) return `${ms}ms`
  const s = ms / 1_000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return `${m}m${rest}s`
}
