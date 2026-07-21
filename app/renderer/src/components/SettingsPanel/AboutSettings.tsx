import { useI18n } from '../../i18n'

// ============ About Settings Page ============

const APP_VERSION = '0.1.0'
const ENGINE_NAME = 'QiongQi Agent Runtime'
const ENGINE_VERSION = '3.x'

export function AboutSettings() {
  const { t } = useI18n()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-[680px] mx-auto">
          {/* Logo + Name + Version */}
          <div className="flex flex-col items-center pt-10 pb-8">
            {/* K Logo */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-lg shadow-[#3b82f6]/20">
              <span className="text-2xl font-bold text-white tracking-tight">K</span>
            </div>
            <h1 className="text-xl font-semibold text-text-primary mt-4">KCoder</h1>
            <p className="text-xs text-text-muted mt-1 font-mono">v{APP_VERSION}</p>
            <p className="text-sm text-text-muted mt-3 text-center max-w-[360px] leading-relaxed">
              {t('settings.about.desc')}
            </p>
          </div>

          {/* Info cards */}
          <div className="space-y-3">
            {/* Engine */}
            <InfoRow label={t('settings.about.engine')} value={`${ENGINE_NAME} v${ENGINE_VERSION}`} />
            {/* Electron */}
            <InfoRow label={t('settings.about.electron')} value="Electron + Vite + React" />
            {/* Architecture */}
            <InfoRow label={t('settings.about.arch')} value={t('settings.about.arch.value')} />
            {/* Protocol */}
            <InfoRow label={t('settings.about.protocol')} value="HTTP / SSE / A2A" />
          </div>

          {/* Links */}
          <div className="mt-8 pt-6 border-t border-border-custom">
            <h3 className="text-xs font-medium text-text-muted mb-3">{t('settings.about.links')}</h3>
            <div className="flex flex-wrap gap-2">
              <LinkChip label={t('settings.about.links.github')} href="https://github.com/kcoder" />
              <LinkChip label={t('settings.about.links.docs')} href="https://docs.kcoder.dev" />
              <LinkChip label={t('settings.about.links.issues')} href="https://github.com/kcoder/kcoder/issues" />
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-8 pb-6 text-center">
            <p className="text-[11px] text-text-muted opacity-50">
              © 2026 KCoder. {t('settings.about.license')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Sub-components ============

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-bg-surface border border-border-subtle px-4 py-3">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs text-text-primary font-medium">{value}</span>
    </div>
  )
}

function LinkChip({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-text-secondary border border-border-custom hover:text-text-primary hover:bg-bg-hover transition-colors"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
      {label}
    </a>
  )
}
