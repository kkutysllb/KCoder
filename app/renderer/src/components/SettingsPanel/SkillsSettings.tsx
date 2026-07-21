import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type SkillEntry, type MarketplaceSkill } from '../../services/engine-api'

// ============ Skills Settings Page ============

type SkillTab = 'workspace' | 'plugin' | 'marketplace'

export function SkillsSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [marketSkills, setMarketSkills] = useState<MarketplaceSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<SkillTab>('workspace')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toggling, setToggling] = useState<Set<string>>(new Set())
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)

  const api = getEngineAPI(enginePort)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await api.listSkills()
      setSkills(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  const loadMarketplace = useCallback(async () => {
    try {
      const index = await api.getMarketplace()
      setMarketSkills(index.skills ?? [])
    } catch {
      // marketplace is best-effort
    }
  }, [api])

  useEffect(() => {
    if (engineStatus === 'connected') {
      loadSkills()
      loadMarketplace()
    } else {
      setLoading(false)
    }
  }, [engineStatus, loadSkills, loadMarketplace])

  const handleToggle = async (skill: SkillEntry) => {
    setToggling((prev) => new Set(prev).add(skill.id))
    try {
      if (skill.enabled) {
        await api.disableSkill(skill.id)
      } else {
        await api.enableSkill(skill.id)
      }
      setSkills((prev) =>
        prev.map((s) =>
          s.id === skill.id ? { ...s, enabled: !s.enabled, status: s.enabled ? 'disabled' : 'registered' } : s
        )
      )
    } catch {
      // revert silently
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(skill.id)
        return next
      })
    }
  }

  const handleDelete = async (skill: SkillEntry) => {
    try {
      await api.deleteSkill(skill.id)
      setSkills((prev) => prev.filter((s) => s.id !== skill.id))
    } catch {
      // ignore
    }
  }

  const handleInstall = async (skill: MarketplaceSkill) => {
    setInstalling((prev) => new Set(prev).add(skill.id))
    try {
      await api.installSkill({ source: skill.source, skillId: skill.id })
      await loadSkills()
    } catch {
      // ignore
    } finally {
      setInstalling((prev) => {
        const next = new Set(prev)
        next.delete(skill.id)
        return next
      })
    }
  }

  // Filter by tab + search
  const installedIds = new Set(skills.map((s) => s.id))
  const filtered = skills.filter((s) => {
    const isPlugin = s.family === 'plugin' || s.category === 'plugin'
    if (tab === 'plugin' && !isPlugin) return false
    if (tab === 'workspace' && isPlugin) return false
    if (tab === 'marketplace') return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    }
    return true
  })

  const filteredMarket = marketSkills.filter((s) => {
    if (installedIds.has(s.id)) return false
    if (search) {
      const q = search.toLowerCase()
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some((tag) => tag.includes(q))
    }
    return true
  })

  const workspaceCount = skills.filter((s) => s.family !== 'plugin' && s.category !== 'plugin').length
  const pluginCount = skills.filter((s) => s.family === 'plugin' || s.category === 'plugin').length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">{t('settings.skills.title')}</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('settings.skills.create')}
          </button>
        </div>

        {/* Search */}
        <div className="max-w-[680px] mx-auto mt-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('settings.skills.search')}
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-[680px] mx-auto mt-4 flex gap-1 border-b border-border-custom">
          <TabButton active={tab === 'workspace'} onClick={() => setTab('workspace')}>
            {t('settings.skills.tab.workspace')} ({workspaceCount})
          </TabButton>
          <TabButton active={tab === 'plugin'} onClick={() => setTab('plugin')}>
            {t('settings.skills.tab.plugin')} ({pluginCount})
          </TabButton>
          <TabButton active={tab === 'marketplace'} onClick={() => setTab('marketplace')}>
            {t('settings.skills.tab.marketplace')} ({filteredMarket.length})
          </TabButton>
        </div>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto">
          {tab === 'marketplace' ? (
            /* Marketplace tab */
            engineStatus !== 'connected' ? (
              <div className="text-center py-16">
                <p className="text-sm text-text-muted">{t('settings.skills.engineOffline')}</p>
              </div>
            ) : filteredMarket.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-text-muted">{t('settings.skills.market.allInstalled')}</p>
              </div>
            ) : (
              <div className="space-y-2 pt-4">
                {filteredMarket.map((skill) => (
                  <MarketplaceCard
                    key={skill.id}
                    skill={skill}
                    installing={installing.has(skill.id)}
                    onInstall={() => handleInstall(skill)}
                  />
                ))}
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-sm text-text-muted">{t('settings.skills.loadError')}</p>
              <p className="text-xs text-text-muted mt-1 opacity-70">{error}</p>
              <button
                onClick={loadSkills}
                className="mt-4 px-4 py-2 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
              >
                {t('settings.skills.retry')}
              </button>
            </div>
          ) : engineStatus !== 'connected' ? (
            <div className="text-center py-16">
              <p className="text-sm text-text-muted">{t('settings.skills.engineOffline')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-text-muted">{t('settings.skills.empty')}</p>
            </div>
          ) : (
            <div className="space-y-2 pt-4">
              {filtered.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  expanded={expandedId === skill.id}
                  toggling={toggling.has(skill.id)}
                  onToggle={() => handleToggle(skill)}
                  onDelete={() => handleDelete(skill)}
                  onExpand={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateSkillModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            loadSkills()
          }}
        />
      )}
    </div>
  )
}

// Tab button
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
        active
          ? 'text-text-primary font-medium border-white'
          : 'text-text-muted hover:text-text-secondary border-transparent'
      }`}
    >
      {children}
    </button>
  )
}

// Skill card row
function SkillCard({
  skill,
  expanded,
  toggling,
  onToggle,
  onDelete,
  onExpand,
}: {
  skill: SkillEntry
  expanded: boolean
  toggling: boolean
  onToggle: () => void
  onDelete: () => void
  onExpand: () => void
}) {
  const { t } = useI18n()

  const categoryLabel = skill.builtin
    ? t('settings.skills.badge.builtin')
    : skill.family === 'plugin' || skill.category === 'plugin'
      ? 'Plugin'
      : t('settings.skills.badge.custom')

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand chevron */}
        <button
          onClick={onExpand}
          className="shrink-0 w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Icon */}
        <div className="shrink-0 w-8 h-8 rounded-lg bg-bg-hover border border-border-custom flex items-center justify-center">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        </div>

        {/* Name + description */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onExpand}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{skill.name}</span>
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
              {categoryLabel}
            </span>
            {skill.status === 'invalid' && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444]">
                {t('settings.skills.badge.invalid')}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted truncate mt-0.5">{skill.description || skill.id}</p>
        </div>

        {/* Delete (only deletable) */}
        {skill.deletable && (
          <button
            onClick={onDelete}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
            title={t('settings.skills.delete')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}

        {/* Toggle */}
        <button
          onClick={onToggle}
          disabled={toggling}
          className={`relative shrink-0 w-10 h-[22px] rounded-full transition-colors ${
            toggling ? 'opacity-50' : ''
          } ${skill.enabled ? 'bg-[#22c55e]' : 'bg-[#3a3a42]'}`}
        >
          <span
            className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${
              skill.enabled ? 'translate-x-[21px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-border-subtle">
          <div className="grid grid-cols-2 gap-3 mt-3">
            <DetailItem label="ID" value={skill.id} />
            <DetailItem label={t('settings.skills.detail.version')} value={skill.version} />
            <DetailItem label={t('settings.skills.detail.category')} value={skill.category || '-'} />
            <DetailItem label={t('settings.skills.detail.status')} value={skill.status} />
          </div>

          {/* Commands */}
          {skill.commands.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-text-muted mb-1.5">{t('settings.skills.detail.commands')}</p>
              <div className="flex flex-wrap gap-1.5">
                {skill.commands.map((cmd, i) => (
                  <span key={i} className="px-2 py-0.5 rounded bg-bg-hover text-xs text-text-secondary font-mono">
                    /{cmd.id ?? skill.id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Permissions */}
          {Object.keys(skill.permissions).length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] text-text-muted mb-1.5">{t('settings.skills.detail.permissions')}</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(skill.permissions).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded bg-bg-hover text-[11px] text-text-muted">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Root path */}
          {skill.root && (
            <p className="mt-3 text-[11px] text-text-muted truncate font-mono opacity-70">{skill.root}</p>
          )}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className="text-xs text-text-secondary mt-0.5">{value}</p>
    </div>
  )
}

// Marketplace skill card
function MarketplaceCard({
  skill,
  installing,
  onInstall,
}: {
  skill: MarketplaceSkill
  installing: boolean
  onInstall: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-surface border border-border-subtle px-4 py-3">
      {/* Icon */}
      <div className="shrink-0 w-8 h-8 rounded-lg bg-bg-hover border border-border-custom flex items-center justify-center">
        <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .414.336.75.75.75z" />
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{skill.name}</span>
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
            {skill.category}
          </span>
          <span className="shrink-0 text-[10px] text-text-muted">v{skill.version}</span>
        </div>
        <p className="text-xs text-text-muted truncate mt-0.5">{skill.description}</p>
        {skill.tags.length > 0 && (
          <div className="flex gap-1 mt-1">
            {skill.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="px-1.5 py-px rounded bg-bg-hover text-[10px] text-text-muted">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Install button */}
      <button
        onClick={onInstall}
        disabled={installing}
        className="shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 disabled:opacity-40 transition-colors"
      >
        {installing ? t('settings.skills.market.installing') : t('settings.skills.market.install')}
      </button>
    </div>
  )
}

// Create skill modal
function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const { enginePort } = useAppStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const api = getEngineAPI(enginePort)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await api.createSkill({ name: name.trim(), description: description.trim(), content: content || undefined })
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl bg-bg-primary border border-border-custom p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary">{t('settings.skills.create')}</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.skills.create.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.skills.create.name.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.skills.create.desc')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.skills.create.desc.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.skills.create.content')}</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('settings.skills.create.content.placeholder')}
              rows={6}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors resize-none font-mono"
            />
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-[#ef4444]">{err}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('settings.skills.create.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 disabled:opacity-40 transition-colors"
          >
            {saving ? t('settings.skills.creating') : t('settings.skills.create.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
