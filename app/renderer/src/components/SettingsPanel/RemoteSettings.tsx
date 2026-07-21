import { useState } from 'react'
import { useI18n } from '../../i18n'

// ============ Remote Control Settings Page ============
// Design: bidirectional remote control for KCoder
//   1. Connect to a remote KCoder/QiongQi engine (this frontend → remote engine)
//   2. Expose local engine to LAN devices (phone/tablet → this machine's agent)
//   3. Security controls (auth, permissions, timeout)

export interface RemoteSession {
  id: string
  device: string
  ip: string
  connectedAt: string
  permission: 'readonly' | 'full'
}

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error'
type PermissionLevel = 'readonly' | 'full'

// ---- Persistence layer (localStorage mock, to be replaced by engine API) ----

const STORAGE_KEY = 'kcoder-remote-settings'

interface RemotePrefs {
  remoteEnabled: boolean
  remoteUrl: string
  remoteToken: string
  exposeEnabled: boolean
  exposeToken: string
  requireAuth: boolean
  permissionLevel: PermissionLevel
  sessionTimeout: number
}

const DEFAULT_PREFS: RemotePrefs = {
  remoteEnabled: false,
  remoteUrl: '',
  remoteToken: '',
  exposeEnabled: false,
  exposeToken: '',
  requireAuth: true,
  permissionLevel: 'readonly',
  sessionTimeout: 30,
}

function loadPrefs(): RemotePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(prefs: RemotePrefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  // Reserved: sync to engine via PUT /api/remote/config
}

// Future API endpoints:
//   GET  /api/remote/config         → current remote settings
//   PUT  /api/remote/config         → update settings
//   POST /api/remote/test           → test remote engine connectivity
//   POST /api/remote/token          → generate access token
//   GET  /api/remote/sessions       → list connected sessions
//   DELETE /api/remote/sessions/:id → revoke a session

// ============ Component ============

export function RemoteSettings() {
  const { t } = useI18n()
  const [prefs, setPrefs] = useState<RemotePrefs>(loadPrefs)
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle')
  const [sessions] = useState<RemoteSession[]>(MOCK_SESSIONS)

  const update = (patch: Partial<RemotePrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
  }

  const handleTestConnection = () => {
    setConnStatus('testing')
    // Reserved: POST /api/remote/test { url, token }
    setTimeout(() => {
      setConnStatus(prefs.remoteUrl.trim() ? 'connected' : 'error')
    }, 1200)
  }

  const handleGenerateToken = () => {
    const token = `kcr_${Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`
    update({ exposeToken: token })
  }

  const lanUrl = `http://192.168.1.${Math.floor(Math.random() * 200) + 10}:19426`

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="max-w-[680px] mx-auto">
          <h1 className="text-lg font-semibold text-text-primary">{t('settings.remote.title')}</h1>
          <p className="text-xs text-text-muted mt-1">{t('settings.remote.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-[680px] mx-auto space-y-8 pt-2">

          {/* ===== Section 1: Connect to remote engine ===== */}
          <section>
            <SectionHeader
              title={t('settings.remote.section.remote')}
              desc={t('settings.remote.section.remote.desc')}
            />
            <div className="rounded-xl bg-bg-surface border border-border-subtle px-5 py-4 space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">{t('settings.remote.enableRemote')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('settings.remote.enableRemote.desc')}</p>
                </div>
                <ToggleSwitch checked={prefs.remoteEnabled} onChange={(v) => update({ remoteEnabled: v })} />
              </div>

              {prefs.remoteEnabled && (
                <>
                  {/* Remote URL */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">{t('settings.remote.url')}</label>
                    <input
                      type="text"
                      value={prefs.remoteUrl}
                      onChange={(e) => update({ remoteUrl: e.target.value })}
                      placeholder="http://192.168.1.100:19426"
                      className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
                    />
                  </div>

                  {/* Token */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">{t('settings.remote.token')}</label>
                    <input
                      type="password"
                      value={prefs.remoteToken}
                      onChange={(e) => update({ remoteToken: e.target.value })}
                      placeholder={t('settings.remote.token.placeholder')}
                      className="w-full px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary placeholder-text-muted outline-none focus:border-border-strong transition-colors font-mono"
                    />
                  </div>

                  {/* Test connection */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleTestConnection}
                      disabled={connStatus === 'testing'}
                      className="px-4 py-2 rounded-lg text-xs font-medium bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      {connStatus === 'testing' ? t('settings.remote.testing') : t('settings.remote.test')}
                    </button>
                    {connStatus === 'connected' && (
                      <span className="flex items-center gap-1.5 text-xs text-[#22c55e]">
                        <span className="w-2 h-2 rounded-full bg-[#22c55e]" />
                        {t('settings.remote.connected')}
                      </span>
                    )}
                    {connStatus === 'error' && (
                      <span className="flex items-center gap-1.5 text-xs text-[#ef4444]">
                        <span className="w-2 h-2 rounded-full bg-[#ef4444]" />
                        {t('settings.remote.connError')}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ===== Section 2: Expose local engine ===== */}
          <section>
            <SectionHeader
              title={t('settings.remote.section.expose')}
              desc={t('settings.remote.section.expose.desc')}
            />
            <div className="rounded-xl bg-bg-surface border border-border-subtle px-5 py-4 space-y-4">
              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">{t('settings.remote.enableExpose')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('settings.remote.enableExpose.desc')}</p>
                </div>
                <ToggleSwitch checked={prefs.exposeEnabled} onChange={(v) => update({ exposeEnabled: v })} />
              </div>

              {prefs.exposeEnabled && (
                <>
                  {/* Access URL + QR placeholder */}
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <label className="block text-xs text-text-muted mb-1.5">{t('settings.remote.accessUrl')}</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary font-mono truncate">
                          {lanUrl}
                        </code>
                        <button
                          onClick={() => navigator.clipboard?.writeText(lanUrl)}
                          className="shrink-0 px-3 py-2 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
                        >
                          {t('settings.remote.copy')}
                        </button>
                      </div>
                      <p className="text-[11px] text-text-muted mt-1.5 opacity-70">{t('settings.remote.accessUrl.hint')}</p>
                    </div>
                    {/* QR code placeholder */}
                    <div className="shrink-0 w-[88px] h-[88px] rounded-lg border border-border-custom bg-bg-input flex flex-col items-center justify-center gap-1">
                      <svg className="w-8 h-8 text-text-muted opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                      </svg>
                      <span className="text-[9px] text-text-muted opacity-60">{t('settings.remote.qr')}</span>
                    </div>
                  </div>

                  {/* Access token */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">{t('settings.remote.exposeToken')}</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 rounded-lg text-sm bg-bg-input border border-border-custom text-text-primary font-mono truncate">
                        {prefs.exposeToken || '••••••••••••••••'}
                      </code>
                      <button
                        onClick={handleGenerateToken}
                        className="shrink-0 px-3 py-2 rounded-lg text-xs text-text-secondary border border-border-custom hover:bg-bg-hover transition-colors"
                      >
                        {prefs.exposeToken ? t('settings.remote.regenerate') : t('settings.remote.generate')}
                      </button>
                    </div>
                  </div>

                  {/* Connected sessions */}
                  <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                      {t('settings.remote.sessions')} ({sessions.length})
                    </label>
                    {sessions.length === 0 ? (
                      <p className="text-xs text-text-muted opacity-60 py-2">{t('settings.remote.noSessions')}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {sessions.map((s) => (
                          <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-hover/50 border border-border-custom">
                            <span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" />
                            <span className="text-xs text-text-primary font-medium">{s.device}</span>
                            <span className="text-[11px] text-text-muted font-mono">{s.ip}</span>
                            <span className="px-1.5 py-px rounded text-[10px] bg-bg-hover text-text-muted border border-border-custom">
                              {s.permission === 'full' ? t('settings.remote.perm.full') : t('settings.remote.perm.readonly')}
                            </span>
                            <span className="ml-auto text-[11px] text-text-muted opacity-60">{s.connectedAt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ===== Section 3: Security ===== */}
          <section>
            <SectionHeader
              title={t('settings.remote.section.security')}
              desc={t('settings.remote.section.security.desc')}
            />
            <div className="rounded-xl bg-bg-surface border border-border-subtle px-5 py-4 space-y-4">
              {/* Require auth */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">{t('settings.remote.requireAuth')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('settings.remote.requireAuth.desc')}</p>
                </div>
                <ToggleSwitch checked={prefs.requireAuth} onChange={(v) => update({ requireAuth: v })} />
              </div>

              {/* Permission level */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">{t('settings.remote.permLevel')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('settings.remote.permLevel.desc')}</p>
                </div>
                <select
                  value={prefs.permissionLevel}
                  onChange={(e) => update({ permissionLevel: e.target.value as PermissionLevel })}
                  className="px-3 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none cursor-pointer hover:border-[#52525b] transition-colors"
                >
                  <option value="readonly">{t('settings.remote.perm.readonly')}</option>
                  <option value="full">{t('settings.remote.perm.full')}</option>
                </select>
              </div>

              {/* Session timeout */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">{t('settings.remote.timeout')}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{t('settings.remote.timeout.desc')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={prefs.sessionTimeout}
                    onChange={(e) => update({ sessionTimeout: Number(e.target.value) || 30 })}
                    min={5}
                    step={5}
                    className="w-20 px-3 py-1.5 rounded-lg text-xs bg-bg-input border border-border-custom text-text-primary outline-none focus:border-border-strong transition-colors font-mono text-center"
                  />
                  <span className="text-[11px] text-text-muted">{t('settings.remote.minutes')}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

// ---- Mock sessions ----

const MOCK_SESSIONS: RemoteSession[] = [
  { id: 's1', device: 'iPhone 15 Pro', ip: '192.168.1.42', connectedAt: '10:24', permission: 'readonly' },
]

// ============ Shared sub-components ============

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-xs font-medium text-text-muted">{title}</h2>
      <p className="text-[11px] text-text-muted opacity-60 mt-0.5">{desc}</p>
    </div>
  )
}

/** Toggle: ON = blue #3b82f6 + dot right; OFF = gray #3f3f46 + dot left */
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${checked ? 'bg-[#3b82f6]' : 'bg-[#3f3f46]'}`}
    >
      <span
        className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${checked ? 'left-[19px]' : 'left-[3px]'}`}
      />
    </button>
  )
}
