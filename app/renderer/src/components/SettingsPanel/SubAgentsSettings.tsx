import { useState, useMemo } from 'react'
import { useI18n } from '../../i18n'

// ============ Sub-Agents Settings Page ============
// Data model (aligned with future backend API contract)

export interface SubAgentEntry {
  id: string
  name: string
  type: 'builtin' | 'user'
  description: string
  /** Tool list; empty array means "all tools" */
  tools: string[]
  /** Source identifier, e.g. built-in:general-purpose */
  source: string
  /** Markdown system prompt content */
  content: string
  /** Inheritance mode for builtin agents */
  inheritMode: 'default' | 'custom'
  createdAt?: string
  updatedAt?: string
}

type AgentFilter = 'all' | 'builtin' | 'user'

// ---- Mock data (will be replaced by engine API) ----
// TODO(backend): 后端无 /api/subagents 路由（会 404），暂保留 mock 数据。
// 待后端补齐 subagents CRUD 路由后，替换为 api.listSubAgents() 等调用。

const BUILTIN_AGENTS: SubAgentEntry[] = [
  {
    id: 'general-purpose',
    name: 'general-purpose',
    type: 'builtin',
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    tools: [],
    source: 'built-in:general-purpose',
    content: '',
    inheritMode: 'default',
  },
  {
    id: 'explore',
    name: 'Explore',
    type: 'builtin',
    description: 'Read-only search agent for broad fan-out searches.',
    tools: ['read', 'grep', 'find', 'glob', 'lsp', 'web_search', 'web_fetch'],
    source: 'built-in:Explore',
    content: '',
    inheritMode: 'default',
  },
]

const DEFAULT_USER_AGENTS: SubAgentEntry[] = [
  {
    id: 'code-reviewer',
    name: 'code-reviewer',
    type: 'user',
    description: '专注代码审查的子智能体，检查代码质量、安全漏洞和最佳实践。',
    tools: ['read', 'grep', 'find'],
    source: 'user:code-reviewer',
    content: '# Code Reviewer\n\n你是一个专业的代码审查专家...',
    inheritMode: 'custom',
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-15T14:30:00Z',
  },
]

// ---- Reserved API layer (mock implementation, to be replaced) ----

const STORAGE_KEY = 'kcoder-user-agents'

function loadUserAgents(): SubAgentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_USER_AGENTS
  } catch {
    return DEFAULT_USER_AGENTS
  }
}

function saveUserAgents(agents: SubAgentEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents))
  // Reserved: sync to engine via IPC / REST API
  // window.kcoder?.send('save-subagents', { agents })
}

// Future API endpoints (see engine-api.ts):
//   GET    /api/subagents          → list all
//   POST   /api/subagents          → create user agent
//   PUT    /api/subagents/:id      → update user agent
//   DELETE /api/subagents/:id      → delete user agent
//   POST   /api/subagents/:id/clone → clone builtin as user agent

// ============ Component ============

export function SubAgentsSettings() {
  const { t } = useI18n()
  const [userAgents, setUserAgents] = useState<SubAgentEntry[]>(loadUserAgents)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [editingAgent, setEditingAgent] = useState<SubAgentEntry | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const allAgents = useMemo(() => [...BUILTIN_AGENTS, ...userAgents], [userAgents])

  const filtered = allAgents.filter((a) => {
    if (filter !== 'all' && a.type !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    }
    return true
  })

  const builtinFiltered = filtered.filter((a) => a.type === 'builtin')
  const userFiltered = filtered.filter((a) => a.type === 'user')

  const handleCloneBuiltin = (agent: SubAgentEntry) => {
    const clone: SubAgentEntry = {
      ...agent,
      id: `${agent.id}-custom`,
      type: 'user',
      source: `user:${agent.id}-custom`,
      inheritMode: 'custom',
      content: `# ${agent.name} (custom)\n\n<!-- 基于内置 ${agent.id} 克隆，可自由修改 -->`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const next = [...userAgents, clone]
    setUserAgents(next)
    saveUserAgents(next)
    setEditingAgent(clone)
  }

  const handleDelete = (id: string) => {
    const next = userAgents.filter((a) => a.id !== id)
    setUserAgents(next)
    saveUserAgents(next)
  }

  const handleSave = (agent: SubAgentEntry) => {
    const exists = userAgents.some((a) => a.id === agent.id)
    const next = exists
      ? userAgents.map((a) => (a.id === agent.id ? { ...agent, updatedAt: new Date().toISOString() } : a))
      : [...userAgents, agent]
    setUserAgents(next)
    saveUserAgents(next)
    setEditingAgent(null)
    setShowCreate(false)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{t('settings.agents.title')}</h1>
              <p className="text-xs text-text-muted mt-1">{t('settings.agents.subtitle')}</p>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowCreate(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.agents.create')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.agents.openFolder')}
                onClick={() => console.log('[KCoder] TODO: open subagents folder via IPC')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.agents.refresh')}
                onClick={() => setUserAgents(loadUserAgents())}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search + Filter */}
          <div className="flex items-center gap-3 mt-5">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.agents.search')}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
              />
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as AgentFilter)}
              className="px-3 py-2 rounded-lg text-[13px] bg-bg-input border border-border-custom text-text-primary outline-none cursor-pointer hover:border-[#52525b] transition-colors"
            >
              <option value="all">{t('settings.agents.filter.all')}</option>
              <option value="builtin">{t('settings.agents.filter.builtin')}</option>
              <option value="user">{t('settings.agents.filter.user')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto space-y-8 pt-2">
          {/* Builtin section */}
          {(filter === 'all' || filter === 'builtin') && builtinFiltered.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-text-muted">
                  {t('settings.agents.section.builtin')} {builtinFiltered.length} {t('settings.agents.items')}
                </h2>
                <span className="text-[11px] text-text-muted opacity-70">{t('settings.agents.builtinNote')}</span>
              </div>
              <div className="space-y-2">
                {builtinFiltered.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onClone={() => handleCloneBuiltin(agent)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* User section */}
          {(filter === 'all' || filter === 'user') && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-text-muted">
                  {t('settings.agents.section.user')} {userFiltered.length} {t('settings.agents.items')}
                </h2>
              </div>
              {userFiltered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-custom py-10 text-center">
                  <p className="text-sm text-text-muted">{t('settings.agents.empty')}</p>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="mt-3 px-4 py-1.5 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
                  >
                    {t('settings.agents.create')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {userFiltered.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      onEdit={() => setEditingAgent(agent)}
                      onDelete={() => handleDelete(agent.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(showCreate || editingAgent) && (
        <AgentEditorModal
          agent={editingAgent}
          onSave={handleSave}
          onClose={() => { setEditingAgent(null); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

// ============ Agent Card ============

function AgentCard({
  agent,
  onClone,
  onEdit,
  onDelete,
}: {
  agent: SubAgentEntry
  onClone?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)

  const toolLabel = agent.tools.length === 0
    ? t('settings.agents.allTools')
    : t('settings.agents.toolCount').replace('{n}', String(agent.tools.length))

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-4 py-3.5 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="shrink-0 w-9 h-9 rounded-full border border-[#52525b] bg-bg-hover flex items-center justify-center mt-0.5">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{agent.name}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
              {agent.type === 'builtin' ? t('settings.agents.badge.builtin') : t('settings.agents.badge.user')}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
              {toolLabel}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">{agent.description}</p>
          <p className="text-[11px] text-text-muted mt-1 font-mono opacity-60">{agent.source}</p>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          {agent.type === 'builtin' ? (
            /* Inherit dropdown */
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-secondary hover:text-text-primary hover:border-[#52525b] transition-colors"
              >
                {t('settings.agents.inherit')}
                <svg className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg bg-bg-primary border border-border-custom shadow-xl py-1">
                    <button
                      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t('settings.agents.menu.useDefault')}
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                      onClick={() => { setMenuOpen(false); onClone?.() }}
                    >
                      {t('settings.agents.menu.clone')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            /* User agent actions */
            <>
              <button
                onClick={onEdit}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.agents.edit')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </button>
              <button
                onClick={onDelete}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                title={t('settings.agents.delete')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tool chips (expanded for user agents with tools) */}
      {agent.tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5 pl-12">
          {agent.tools.map((tool) => (
            <span key={tool} className="px-1.5 py-0.5 rounded bg-bg-hover text-[10px] text-text-muted font-mono">
              {tool}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ============ Agent Editor Modal ============

function AgentEditorModal({
  agent,
  onSave,
  onClose,
}: {
  agent: SubAgentEntry | null
  onSave: (agent: SubAgentEntry) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const isEdit = agent !== null

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [tools, setTools] = useState(agent?.tools.join(', ') ?? '')
  const [content, setContent] = useState(agent?.content ?? '')
  const [err, setErr] = useState<string | null>(null)

  const handleSubmit = () => {
    if (!name.trim()) {
      setErr(t('settings.agents.editor.nameRequired'))
      return
    }
    onSave({
      id: agent?.id ?? name.trim().toLowerCase().replace(/[^\w-]+/g, '-'),
      name: name.trim(),
      type: 'user',
      description: description.trim(),
      tools: tools.split(',').map((s) => s.trim()).filter(Boolean),
      source: `user:${agent?.id ?? name.trim().toLowerCase().replace(/[^\w-]+/g, '-')}`,
      content,
      inheritMode: 'custom',
      createdAt: agent?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl bg-bg-primary border border-border-custom p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary">
          {isEdit ? t('settings.agents.editor.editTitle') : t('settings.agents.editor.createTitle')}
        </h2>
        <p className="text-xs text-text-muted mt-1">{t('settings.agents.editor.hint')}</p>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.agents.editor.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.agents.editor.name.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.agents.editor.desc')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.agents.editor.desc.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.agents.editor.tools')}</label>
            <input
              type="text"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder={t('settings.agents.editor.tools.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
            />
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.agents.editor.tools.hint')}</p>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.agents.editor.content')}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('settings.agents.editor.content.placeholder')}
              rows={10}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors resize-none font-mono leading-relaxed"
            />
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-[#ef4444]">{err}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('settings.agents.editor.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors"
          >
            {t('settings.agents.editor.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
