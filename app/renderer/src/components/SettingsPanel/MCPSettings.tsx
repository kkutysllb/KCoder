import { useState, useMemo } from 'react'
import { useI18n } from '../../i18n'

// ============ MCP Servers Settings Page ============
// Data model aligned with engine contracts:
//   McpServerConfig (packages/foundation/contracts/src/capabilities.ts)
//   McpServerDiagnostic (packages/adapters/adapter-tools/src/mcp-tool-provider.ts)

export interface McpServerEntry {
  name: string
  enabled: boolean
  transport: 'stdio' | 'streamable-http' | 'sse'
  /** stdio transport: executable command */
  command?: string
  /** stdio transport: command arguments */
  args: string[]
  /** streamable-http / sse transport: server URL */
  url?: string
  headers: Record<string, string>
  env: Record<string, string>
  trustScope: 'user' | 'workspace'
  timeoutMs: number
  description: string
  /** Where this server definition comes from */
  source: 'user' | 'plugin'
  pluginId?: string
  // ---- Runtime diagnostics (populated by engine) ----
  status: 'disabled' | 'connected' | 'error' | 'plugin-disabled'
  toolCount: number
  lastError?: string
}

// ---- Mock data (will be replaced by engine API: GET /api/mcp/config) ----

const PLUGIN_SERVERS: McpServerEntry[] = [
  {
    name: 'android-emulator',
    enabled: false,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-android-emulator'],
    headers: {},
    env: {},
    trustScope: 'workspace',
    timeoutMs: 30000,
    description: '该 MCP 服务器内置在插件中，启用插件后会加载。',
    source: 'plugin',
    pluginId: 'kcoder-plugins-official',
    status: 'plugin-disabled',
    toolCount: 0,
  },
  {
    name: 'ios-simulator',
    enabled: false,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-ios-simulator'],
    headers: {},
    env: {},
    trustScope: 'workspace',
    timeoutMs: 30000,
    description: '该 MCP 服务器内置在插件中，启用插件后会加载。',
    source: 'plugin',
    pluginId: 'kcoder-plugins-official',
    status: 'plugin-disabled',
    toolCount: 0,
  },
]

const DEFAULT_USER_SERVERS: McpServerEntry[] = [
  {
    name: 'filesystem',
    enabled: true,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    headers: {},
    env: {},
    trustScope: 'workspace',
    timeoutMs: 30000,
    description: '提供文件系统读写能力的 MCP 服务器。',
    source: 'user',
    status: 'connected',
    toolCount: 8,
  },
]

// ---- Persistence layer (localStorage mock, to be replaced by engine API) ----

const STORAGE_KEY = 'kcoder-mcp-servers'

function loadUserServers(): McpServerEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_USER_SERVERS
  } catch {
    return DEFAULT_USER_SERVERS
  }
}

function saveUserServers(servers: McpServerEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
  // Reserved: sync to engine via PUT /api/mcp/config
  // window.kcoder?.send('save-mcp-config', { mcp_servers: ... })
}

// Future API endpoints (engine already has GET/PUT /api/mcp/config):
//   GET  /api/mcp/config        → { mcp_servers: Record<name, config>, skills }
//   PUT  /api/mcp/config        → save full config
//   GET  /api/runtime/diagnostics → mcpServers: McpServerDiagnostic[]

// ============ Component ============

export function MCPSettings() {
  const { t } = useI18n()
  const [userServers, setUserServers] = useState<McpServerEntry[]>(loadUserServers)
  const [search, setSearch] = useState('')
  const [editingServer, setEditingServer] = useState<McpServerEntry | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const filteredPlugin = PLUGIN_SERVERS.filter((s) => matchSearch(s, search))
  const filteredUser = userServers.filter((s) => matchSearch(s, search))

  const handleToggle = (name: string) => {
    const next = userServers.map((s) =>
      s.name === name
        ? { ...s, enabled: !s.enabled, status: s.enabled ? 'disabled' as const : s.status === 'disabled' ? 'connected' as const : s.status }
        : s
    )
    setUserServers(next)
    saveUserServers(next)
  }

  const handleDelete = (name: string) => {
    const next = userServers.filter((s) => s.name !== name)
    setUserServers(next)
    saveUserServers(next)
  }

  const handleSave = (server: McpServerEntry) => {
    const exists = userServers.some((s) => s.name === server.name)
    const next = exists
      ? userServers.map((s) => (s.name === server.name ? server : s))
      : [...userServers, server]
    setUserServers(next)
    saveUserServers(next)
    setEditingServer(null)
    setShowCreate(false)
  }

  const handleExport = () => {
    const config: Record<string, unknown> = {}
    for (const s of [...PLUGIN_SERVERS, ...userServers]) {
      config[s.name] = {
        enabled: s.enabled,
        transport: s.transport,
        ...(s.command ? { command: s.command } : {}),
        ...(s.args.length ? { args: s.args } : {}),
        ...(s.url ? { url: s.url } : {}),
        ...(Object.keys(s.headers).length ? { headers: s.headers } : {}),
        ...(Object.keys(s.env).length ? { env: s.env } : {}),
        trustScope: s.trustScope,
        timeoutMs: s.timeoutMs,
      }
    }
    const blob = new Blob([JSON.stringify({ mcp_servers: config }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mcp-config.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">{t('settings.mcp.title')}</h1>
              <p className="text-xs text-text-muted mt-1">{t('settings.mcp.subtitle')}</p>
            </div>
            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowCreate(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.mcp.add')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <button
                onClick={handleExport}
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-border-custom text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.mcp.export')}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="mt-5">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.mcp.search')}
                className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto space-y-8 pt-2">
          {/* Plugin MCP servers section */}
          {filteredPlugin.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-xs font-medium text-text-muted">{t('settings.mcp.section.plugin')}</h2>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                  {filteredPlugin.length}
                </span>
              </div>
              <div className="space-y-2">
                {filteredPlugin.map((server) => (
                  <ServerCard key={server.name} server={server} />
                ))}
              </div>
            </section>
          )}

          {/* User MCP servers section */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-medium text-text-muted">{t('settings.mcp.section.user')}</h2>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                {filteredUser.length}
              </span>
            </div>
            {filteredUser.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-custom py-10 text-center">
                <p className="text-sm text-text-muted">{t('settings.mcp.empty')}</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 px-4 py-1.5 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
                >
                  {t('settings.mcp.add')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUser.map((server) => (
                  <ServerCard
                    key={server.name}
                    server={server}
                    onToggle={() => handleToggle(server.name)}
                    onEdit={() => setEditingServer(server)}
                    onDelete={() => handleDelete(server.name)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Create / Edit modal */}
      {(showCreate || editingServer) && (
        <ServerEditorModal
          server={editingServer}
          existingNames={userServers.map((s) => s.name)}
          onSave={handleSave}
          onClose={() => { setEditingServer(null); setShowCreate(false) }}
        />
      )}
    </div>
  )
}

function matchSearch(server: McpServerEntry, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    server.name.toLowerCase().includes(q) ||
    server.description.toLowerCase().includes(q) ||
    (server.command ?? '').toLowerCase().includes(q) ||
    (server.url ?? '').toLowerCase().includes(q)
  )
}

// ============ Server Card ============

function ServerCard({
  server,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: McpServerEntry
  onToggle?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useI18n()
  const isPlugin = server.source === 'plugin'

  return (
    <div className="rounded-xl bg-bg-surface border border-border-subtle px-4 py-3.5 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="shrink-0 w-9 h-9 rounded-full border border-[#52525b] bg-bg-hover flex items-center justify-center mt-0.5">
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.867 19.125h.008v.008h-.008v-.008z" />
          </svg>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary">{server.name}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom font-mono">
              {server.name}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom font-mono">
              {server.transport}
            </span>
            {/* Status badge */}
            {server.status === 'plugin-disabled' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#eab308]/10 text-[#eab308] border border-[#eab308]/30">
                {t('settings.mcp.status.pluginDisabled')}
              </span>
            )}
            {server.status === 'connected' && server.enabled && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                {t('settings.mcp.status.connected')}
              </span>
            )}
            {server.status === 'error' && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                {t('settings.mcp.status.error')}
              </span>
            )}
            {server.status === 'disabled' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-text-muted border border-border-custom">
                {t('settings.mcp.status.disabled')}
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">{server.description}</p>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-[11px] text-text-muted font-mono opacity-60">
              {isPlugin ? server.pluginId : server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}
            </p>
            {server.toolCount > 0 && (
              <span className="text-[11px] text-text-muted opacity-60">
                {t('settings.mcp.toolCount').replace('{n}', String(server.toolCount))}
              </span>
            )}
          </div>
          {server.lastError && (
            <p className="text-[11px] text-[#ef4444] mt-1 truncate">{server.lastError}</p>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1.5">
          {isPlugin ? (
            <span className="text-[11px] text-text-muted opacity-60 px-2">{t('settings.mcp.pluginHint')}</span>
          ) : (
            <>
              {/* Enable/disable toggle */}
              <button
                onClick={onToggle}
                className={`relative w-8 h-[18px] rounded-full transition-colors ${server.enabled ? 'bg-[#3b82f6]' : 'bg-[#3f3f46]'}`}
                title={server.enabled ? t('settings.mcp.disable') : t('settings.mcp.enable')}
              >
                <span
                  className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${server.enabled ? 'left-[16px]' : 'left-[2px]'}`}
                />
              </button>
              <button
                onClick={onEdit}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                title={t('settings.mcp.edit')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </button>
              <button
                onClick={onDelete}
                className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors"
                title={t('settings.mcp.delete')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============ Server Editor Modal ============

function ServerEditorModal({
  server,
  existingNames,
  onSave,
  onClose,
}: {
  server: McpServerEntry | null
  existingNames: string[]
  onSave: (server: McpServerEntry) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const isEdit = server !== null

  const [name, setName] = useState(server?.name ?? '')
  const [description, setDescription] = useState(server?.description ?? '')
  const [transport, setTransport] = useState<McpServerEntry['transport']>(server?.transport ?? 'stdio')
  const [command, setCommand] = useState(server?.command ?? '')
  const [args, setArgs] = useState(server?.args.join(' ') ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [envText, setEnvText] = useState(
    server ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : ''
  )
  const [timeoutMs, setTimeoutMs] = useState(server?.timeoutMs ?? 30000)
  const [err, setErr] = useState<string | null>(null)

  const parseEnv = (text: string): Record<string, string> => {
    const env: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const idx = line.indexOf('=')
      if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
    }
    return env
  }

  const handleSubmit = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setErr(t('settings.mcp.editor.nameRequired'))
      return
    }
    if (!isEdit && existingNames.includes(trimmedName)) {
      setErr(t('settings.mcp.editor.nameDuplicate'))
      return
    }
    if (transport === 'stdio' && !command.trim()) {
      setErr(t('settings.mcp.editor.commandRequired'))
      return
    }
    if ((transport === 'streamable-http' || transport === 'sse') && !url.trim()) {
      setErr(t('settings.mcp.editor.urlRequired'))
      return
    }
    onSave({
      name: trimmedName,
      enabled: server?.enabled ?? true,
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.split(/\s+/).filter(Boolean) : [],
      url: transport !== 'stdio' ? url.trim() : undefined,
      headers: server?.headers ?? {},
      env: parseEnv(envText),
      trustScope: server?.trustScope ?? 'workspace',
      timeoutMs: Number(timeoutMs) || 30000,
      description: description.trim(),
      source: 'user',
      status: server?.status ?? 'disabled',
      toolCount: server?.toolCount ?? 0,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[560px] max-h-[85vh] overflow-y-auto rounded-2xl bg-bg-primary border border-border-custom p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-text-primary">
          {isEdit ? t('settings.mcp.editor.editTitle') : t('settings.mcp.editor.createTitle')}
        </h2>
        <p className="text-xs text-text-muted mt-1">{t('settings.mcp.editor.hint')}</p>

        <div className="mt-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder={t('settings.mcp.editor.name.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors disabled:opacity-50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.desc')}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.mcp.editor.desc.placeholder')}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors"
            />
          </div>

          {/* Transport */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.transport')}</label>
            <select
              value={transport}
              onChange={(e) => setTransport(e.target.value as McpServerEntry['transport'])}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary outline-none cursor-pointer hover:border-[#52525b] transition-colors"
            >
              <option value="stdio">stdio</option>
              <option value="streamable-http">streamable-http</option>
              <option value="sse">sse</option>
            </select>
          </div>

          {/* stdio fields */}
          {transport === 'stdio' && (
            <>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.command')}</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.args')}</label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
                />
                <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.mcp.editor.args.hint')}</p>
              </div>
            </>
          )}

          {/* http/sse fields */}
          {(transport === 'streamable-http' || transport === 'sse') && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.url')}</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3001/mcp"
                className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
              />
            </div>
          )}

          {/* Env */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.env')}</label>
            <textarea
              value={envText}
              onChange={(e) => setEnvText(e.target.value)}
              placeholder={'API_KEY=xxx\nDEBUG=true'}
              rows={3}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors resize-none font-mono leading-relaxed"
            />
            <p className="text-[11px] text-text-muted mt-1 opacity-70">{t('settings.mcp.editor.env.hint')}</p>
          </div>

          {/* Timeout */}
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t('settings.mcp.editor.timeout')}</label>
            <input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              min={1000}
              step={1000}
              className="w-40 px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong transition-colors font-mono"
            />
            <span className="ml-2 text-[11px] text-text-muted">ms</span>
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-[#ef4444]">{err}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('settings.mcp.editor.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors"
          >
            {t('settings.mcp.editor.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
