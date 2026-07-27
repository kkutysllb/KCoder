import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { getEngineAPI, type SkillEntry } from '../../services/engine-api'

// ============ Skills Settings Page ============
// Layout aligned with reference design:
// - Header: title + subtitle + icon actions (+, export, refresh)
// - Toolbar: search + status filter dropdown
// - Single scrollable list: workspace/personal section + Plugin section (read-only)

type StatusFilter = 'all' | 'enabled' | 'disabled'

export function SkillsSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [toggling, setToggling] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    if (engineStatus === 'connected') {
      loadSkills()
    } else {
      setLoading(false)
    }
  }, [engineStatus, loadSkills])

  const handleToggle = async (skill: SkillEntry) => {
    // The new engine has no per-skill enable/disable endpoint. Skills are
    // active when their package exists on disk. Toggle is a no-op here;
    // skill lifecycle (create via drafts, delete) is the real control surface.
    setToggling((prev) => new Set(prev).add(skill.id))
    try {
      // No-op: the engine manages skill availability by directory presence.
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

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(skills, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kcoder-skills.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Split into workspace/personal vs plugin-registered skills
  const isPlugin = (s: SkillEntry) => s.family === 'plugin' || s.category === 'plugin'

  const matchesSearch = (s: SkillEntry) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  }

  const matchesStatus = (s: SkillEntry) => {
    if (statusFilter === 'enabled') return s.enabled
    if (statusFilter === 'disabled') return !s.enabled
    return true
  }

  const workspaceSkills = skills.filter((s) => !isPlugin(s) && matchesSearch(s) && matchesStatus(s))
  const pluginSkills = skills.filter((s) => isPlugin(s) && matchesSearch(s))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[720px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold text-text-primary">{t('settings.skills.title')}</h1>
              <p className="text-[13px] text-text-muted mt-1">{t('settings.skills.subtitle')}</p>
            </div>
            <div className="flex items-center gap-0.5 pt-1">
              <HeaderIconButton title={t('settings.skills.create')} onClick={() => setShowCreate(true)}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </HeaderIconButton>
              <HeaderIconButton title={t('settings.skills.export')} onClick={handleExport}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </HeaderIconButton>
              <HeaderIconButton title={t('settings.skills.refresh')} onClick={loadSkills}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </HeaderIconButton>
            </div>
          </div>

          {/* Search + status filter */}
          <div className="mt-5 flex gap-2">
            <div className="relative flex-1">
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
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="shrink-0 px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-secondary outline-none cursor-pointer hover:border-border-strong transition-colors appearance-none pr-8 bg-no-repeat bg-[right_10px_center]"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundSize: '14px' }}
            >
              <option value="all">{t('settings.skills.filter.all')}</option>
              <option value="enabled">{t('settings.skills.filter.enabled')}</option>
              <option value="disabled">{t('settings.skills.filter.disabled')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Skill list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[720px] mx-auto">
          {loading ? (
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
          ) : workspaceSkills.length === 0 && pluginSkills.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-text-muted">{t('settings.skills.empty')}</p>
            </div>
          ) : (
            <>
              {/* Workspace & personal skills */}
              <div className="space-y-2 pt-2">
                {workspaceSkills.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    toggling={toggling.has(skill.id)}
                    onToggle={() => handleToggle(skill)}
                    onDelete={() => handleDelete(skill)}
                  />
                ))}
              </div>

              {/* Plugin skills section (read-only) */}
              {pluginSkills.length > 0 && (
                <div className="mt-8">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-sm font-semibold text-text-primary">{t('settings.skills.section.plugin')}</h2>
                    <span className="text-xs text-text-muted">{pluginSkills.length} {t('settings.skills.items')}</span>
                  </div>
                  <p className="text-xs text-text-muted mt-1">{t('settings.skills.section.pluginNote')}</p>
                  <div className="space-y-2 mt-3">
                    {pluginSkills.map((skill) => (
                      <PluginRow key={skill.id} skill={skill} />
                    ))}
                  </div>
                </div>
              )}
            </>
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

// Header icon button (+, export, refresh)
function HeaderIconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
    >
      <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        {children}
      </svg>
    </button>
  )
}

// Cube icon shared by skill rows
function CubeIcon() {
  return (
    <svg className="w-[18px] h-[18px] text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  )
}

// Workspace / personal skill row: icon + name + desc + label + toggle + delete
function SkillRow({
  skill,
  toggling,
  onToggle,
  onDelete,
}: {
  skill: SkillEntry
  toggling: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()

  const sourceLabel = skill.builtin
    ? t('settings.skills.badge.builtin')
    : t('settings.skills.personal')

  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-surface border border-border-subtle px-4 py-3">
      {/* Icon */}
      <div className="shrink-0 w-9 h-9 rounded-lg bg-bg-hover border border-border-custom flex items-center justify-center">
        <CubeIcon />
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-text-primary truncate block">{skill.name}</span>
        <p className="text-xs text-text-muted truncate mt-0.5">{skill.description || skill.id}</p>
      </div>

      {/* Source label */}
      <span className="shrink-0 text-xs text-text-muted">{sourceLabel}</span>

      {/* Toggle */}
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`relative shrink-0 rounded-full transition-colors duration-200 ${
          toggling ? 'opacity-50' : ''
        } ${skill.enabled ? 'bg-[#4d4d57]' : 'bg-[#3a3a42]'}`}
        style={{ width: 48, height: 28 }}
      >
        <span
          className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
          style={{ width: 22, height: 22, transform: skill.enabled ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>

      {/* Delete (only deletable) */}
      {skill.deletable && (
        <button
          onClick={onDelete}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
          title={t('settings.skills.delete')}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Plugin skill row (read-only): icon + name + desc + category + Plugin badge
function PluginRow({ skill }: { skill: SkillEntry }) {
  const { t } = useI18n()

  return (
    <div className="flex items-center gap-3 rounded-xl bg-bg-surface border border-border-subtle px-4 py-3">
      {/* Icon */}
      <div className="shrink-0 w-9 h-9 rounded-lg bg-bg-hover border border-border-custom flex items-center justify-center">
        <CubeIcon />
      </div>

      {/* Name + description */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-text-primary truncate block">{skill.name}</span>
        <p className="text-xs text-text-muted truncate mt-0.5">{skill.description || skill.id}</p>
      </div>

      {/* Category + Plugin badge */}
      {skill.category && skill.category !== 'plugin' && (
        <span className="shrink-0 text-xs text-text-muted">{skill.category}</span>
      )}
      <span className="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-medium bg-bg-hover text-text-muted border border-border-custom">
        {t('settings.skills.badge.plugin')}
      </span>
    </div>
  )
}

// Create skill modal — uses the /v1/skills/drafts pipeline:
// upload files → analyze → generate → install.
function CreateSkillModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const { enginePort } = useAppStore()
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<'upload' | 'analyzing' | 'generating' | 'installing' | 'done'>('upload')
  const [err, setErr] = useState<string | null>(null)
  const [generatedPreview, setGeneratedPreview] = useState<string>('')

  const api = getEngineAPI(enginePort)

  const handleSubmit = async () => {
    if (files.length === 0) return
    setErr(null)
    try {
      // Step 1: create draft from uploaded files
      setPhase('analyzing')
      const created = await api.createSkillDraft(files)
      const draftId = created.draftId

      // Step 2: analyze uploaded files
      await api.analyzeSkillDraft(draftId)

      // Step 3: generate SKILL.md
      setPhase('generating')
      const genResponse = await api.generateSkillDraft(draftId) as { draft?: { skillMarkdown: string } }
      if (genResponse.draft?.skillMarkdown) {
        setGeneratedPreview(genResponse.draft.skillMarkdown)
      }

      // Step 4: install as a real skill
      setPhase('installing')
      await api.installSkillDraft(draftId, genResponse)

      setPhase('done')
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('upload')
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
          {phase === 'upload' && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">{t('settings.skills.create.upload')}</label>
              <input
                type="file"
                multiple
                onChange={(e) => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                className="w-full text-sm text-text-secondary file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-bg-hover file:text-text-primary file:cursor-pointer"
              />
              {files.length > 0 && (
                <p className="mt-2 text-xs text-text-muted">
                  {files.length} file(s): {files.map((f) => f.name).join(', ')}
                </p>
              )}
              <p className="mt-2 text-[11px] text-text-muted leading-relaxed">
                {t('settings.skills.create.pipeline.desc')}
              </p>
            </div>
          )}

          {phase !== 'upload' && phase !== 'done' && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="w-4 h-4 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
              <span>
                {phase === 'analyzing' && t('settings.skills.create.phase.analyzing')}
                {phase === 'generating' && t('settings.skills.create.phase.generating')}
                {phase === 'installing' && t('settings.skills.create.phase.installing')}
              </span>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-sm text-[#22c55e]">✓ {t('settings.skills.create.phase.done')}</div>
          )}

          {generatedPreview && phase !== 'upload' && (
            <details className="mt-2">
              <summary className="text-xs text-text-muted cursor-pointer">{t('settings.skills.create.preview')}</summary>
              <pre className="mt-2 p-3 rounded-lg bg-bg-input text-[11px] text-text-secondary overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">{generatedPreview}</pre>
            </details>
          )}
        </div>

        {err && <p className="mt-3 text-xs text-[#ef4444]">{err}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('settings.skills.create.cancel')}
          </button>
          {phase === 'upload' && (
            <button
              onClick={handleSubmit}
              disabled={files.length === 0}
              className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              {t('settings.skills.create.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
