import { useState, useMemo, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { useAppStore } from '../../stores/app-store'
import { getEngineAPI, type PluginEntry, type DiscoverPlugin } from '../../services/engine-api'

// ============ Plugins Settings Page ============
// 数据来自后端 GET /api/plugins（已合并 enabled 状态）+ GET /api/plugins/discover。

export type { PluginEntry, DiscoverPlugin }

type PluginTab = 'installed' | 'discover'
type CategoryFilter = 'all' | 'development' | 'documents' | 'workflow' | 'guide'

// ============ Component ============

export function PluginsSettings() {
  const { t } = useI18n()
  const { enginePort, engineStatus } = useAppStore()
  const [tab, setTab] = useState<PluginTab>('installed')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [discoverPlugins, setDiscoverPlugins] = useState<DiscoverPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const api = getEngineAPI(enginePort)
      const [installed, discover] = await Promise.all([
        api.listPlugins(),
        api.getPluginDiscover().catch(() => ({ plugins: [] as DiscoverPlugin[] }))
      ])
      setPlugins(installed)
      // 标记已安装
      const installedIds = new Set(installed.map((p) => p.id))
      setDiscoverPlugins(discover.plugins.map((p) => ({ ...p, installed: installedIds.has(p.id) })))
    } catch (e) {
      console.error('[Plugins] Failed to load:', e)
    } finally {
      setLoading(false)
    }
  }, [enginePort])

  useEffect(() => {
    if (engineStatus === 'connected') refresh()
    else setLoading(false)
  }, [engineStatus, refresh])

  const filteredInstalled = useMemo(() => plugins.filter((p) => {
    if (category !== 'all' && p.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    }
    return true
  }), [plugins, category, search])

  const filteredDiscover = useMemo(() => discoverPlugins.filter((p) => {
    if (category !== 'all' && p.category !== category) return false
    if (search) {
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    }
    return true
  }), [discoverPlugins, category, search])

  const handleToggle = useCallback(async (id: string) => {
    const current = plugins.find((p) => p.id === id)
    if (!current) return
    const nextEnabled = !current.enabled
    // 乐观更新
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: nextEnabled } : p)))
    try {
      const api = getEngineAPI(enginePort)
      await api.togglePlugin(id, nextEnabled)
    } catch (e) {
      console.error('[Plugins] Failed to toggle:', e)
      // 回滚
      setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: current.enabled } : p)))
    }
  }, [plugins, enginePort])

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true)
    try {
      const api = getEngineAPI(enginePort)
      await api.checkPluginUpdates()
    } catch (e) {
      console.error('[Plugins] Failed to check updates:', e)
    } finally {
      setCheckingUpdate(false)
    }
  }, [enginePort])

  const handleInstall = useCallback(async (id: string) => {
    try {
      const api = getEngineAPI(enginePort)
      await api.installPlugin(id)
      await refresh()
    } catch (e) {
      console.error('[Plugins] Failed to install:', e)
    }
  }, [enginePort, refresh])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-semibold text-text-primary">{t('settings.plugins.title')}</h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-info text-white">
                  {t('settings.plugins.beta')}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-1">{t('settings.plugins.subtitle')}</p>
            </div>
            {/* Refresh button */}
            <button
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title={t('settings.plugins.refresh')}
              onClick={refresh}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            </button>
          </div>

          {/* Tabs + Search + Filter */}
          <div className="flex items-center gap-3 mt-5">
            {/* Tabs */}
            <div className="flex items-center rounded-lg border border-border-custom overflow-hidden shrink-0">
              <button
                onClick={() => setTab('installed')}
                className={`px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  tab === 'installed'
                    ? 'bg-white text-black'
                    : 'bg-bg-input text-text-muted hover:text-text-primary'
                }`}
              >
                {t('settings.plugins.tab.installed')}
              </button>
              <button
                onClick={() => setTab('discover')}
                className={`px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  tab === 'discover'
                    ? 'bg-white text-black'
                    : 'bg-bg-input text-text-muted hover:text-text-primary'
                }`}
              >
                {t('settings.plugins.tab.discover')}
              </button>
            </div>

            {/* Search */}
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.plugins.search')}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
              />
            </div>

            {/* Category filter */}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
              className="px-3 py-2 rounded-lg text-[13px] bg-bg-input border border-border-custom text-text-primary outline-none cursor-pointer hover:border-[#52525b] transition-colors shrink-0"
            >
              <option value="all">{t('settings.plugins.filter.all')}</option>
              <option value="development">{t('settings.plugins.filter.development')}</option>
              <option value="documents">{t('settings.plugins.filter.documents')}</option>
              <option value="workflow">{t('settings.plugins.filter.workflow')}</option>
              <option value="guide">{t('settings.plugins.filter.guide')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto pt-2">
          {tab === 'installed' ? (
            <>
              {/* Section header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-text-muted">
                  {t('settings.plugins.section.installed')} {filteredInstalled.length}
                </h2>
                <button
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary border border-border-custom hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  <svg className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  {checkingUpdate ? t('settings.plugins.checking') : t('settings.plugins.checkUpdate')}
                </button>
              </div>

              {/* Plugin cards */}
              <div className="space-y-2">
                {filteredInstalled.map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    expanded={expandedId === plugin.id}
                    onExpand={() => setExpandedId(expandedId === plugin.id ? null : plugin.id)}
                    onToggle={() => handleToggle(plugin.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Discover section */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-medium text-text-muted">
                  {t('settings.plugins.section.discover')} {filteredDiscover.length}
                </h2>
              </div>
              <div className="space-y-2">
                {filteredDiscover.map((plugin) => (
                  <DiscoverCard
                    key={plugin.id}
                    plugin={plugin}
                    installed={plugin.installed}
                    onInstall={() => handleInstall(plugin.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Plugin Card (installed) ============

function PluginCard({
  plugin,
  expanded,
  onExpand,
  onToggle,
}: {
  plugin: PluginEntry
  expanded: boolean
  onExpand: () => void
  onToggle: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-4 py-3.5 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="shrink-0 w-9 h-9 rounded-full border border-[#52525b] bg-bg-hover flex items-center justify-center">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>

        {/* Name + version + badge */}
        <div className="w-[200px] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{plugin.name}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-text-muted font-mono">v{plugin.version}</span>
            {plugin.builtin && (
              <span className="px-1.5 py-px rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                {t('settings.plugins.badge.builtin')}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="flex-1 min-w-0 text-xs text-text-muted truncate">{plugin.description}</p>

        {/* Expand chevron */}
        <button
          onClick={onExpand}
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          title={t('settings.plugins.detail')}
        >
          <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Toggle: gray track + white knob (matches General page reference) */}
        <button
          onClick={onToggle}
          className={`relative shrink-0 rounded-full transition-colors duration-200 ${plugin.enabled ? 'bg-border-strong' : 'bg-bg-active'}`}
          style={{ width: 48, height: 28 }}
          title={plugin.enabled ? t('settings.plugins.disable') : t('settings.plugins.enable')}
        >
          <span
            className="absolute top-[3px] left-[3px] rounded-full bg-white shadow-sm transition-transform duration-200"
            style={{ width: 22, height: 22, transform: plugin.enabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-3 pl-12 pr-10">
          <div className="rounded-lg bg-bg-hover/50 border border-border-custom px-4 py-3">
            <div className="flex items-center gap-6">
              <ProvidesStat label={t('settings.plugins.provides.skills')} count={plugin.provides.skills} />
              <ProvidesStat label={t('settings.plugins.provides.commands')} count={plugin.provides.commands} />
              <ProvidesStat label={t('settings.plugins.provides.hooks')} count={plugin.provides.hooks} />
              <ProvidesStat label={t('settings.plugins.provides.mcpServers')} count={plugin.provides.mcpServers} />
            </div>
            <div className="flex items-center gap-4 mt-2.5 pt-2.5 border-t border-border-custom">
              <span className="text-[11px] text-text-muted">
                {t('settings.plugins.source')}: <span className="font-mono">{plugin.source}</span>
              </span>
              {plugin.author && (
                <span className="text-[11px] text-text-muted">
                  {t('settings.plugins.author')}: {plugin.author}
                </span>
              )}
              <span className="text-[11px] text-text-muted">
                {t('settings.plugins.category')}: {t(`settings.plugins.filter.${plugin.category}`)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProvidesStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-semibold ${count > 0 ? 'text-text-primary' : 'text-text-muted opacity-50'}`}>{count}</span>
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  )
}

// ============ Discover Card ============

function DiscoverCard({
  plugin,
  installed,
  onInstall,
}: {
  plugin: DiscoverPlugin
  installed: boolean
  onInstall: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-4 py-3.5 hover:border-border-strong transition-colors">
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="shrink-0 w-9 h-9 rounded-full border border-[#52525b] bg-bg-hover flex items-center justify-center">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m-18.432 0A8.959 8.959 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
        </div>

        {/* Name + version */}
        <div className="w-[180px] shrink-0">
          <span className="text-sm font-medium text-text-primary truncate block">{plugin.name}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-text-muted font-mono">v{plugin.version}</span>
            <span className="text-[11px] text-text-muted opacity-60">{plugin.author}</span>
          </div>
        </div>

        {/* Description */}
        <p className="flex-1 min-w-0 text-xs text-text-muted truncate">{plugin.description}</p>

        {/* Downloads */}
        <span className="shrink-0 text-[11px] text-text-muted opacity-60 font-mono">
          {plugin.downloads.toLocaleString()} {t('settings.plugins.downloads')}
        </span>

        {/* Install button */}
        <button
          onClick={onInstall}
          disabled={installed}
          className={`shrink-0 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            installed
              ? 'bg-bg-hover text-text-muted border border-border-custom cursor-default'
              : 'bg-white text-black hover:bg-gray-200'
          }`}
        >
          {installed ? t('settings.plugins.installed') : t('settings.plugins.install')}
        </button>
      </div>
    </div>
  )
}
