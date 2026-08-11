import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '../i18n'
import { getEngineAPI } from '../services/engine-api'
import type { AuthState } from '../hooks/useAuth'

type AuthMode = 'initialize' | 'login' | 'register'

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  auth: AuthState
  enginePort: number
}

export function AuthModal({ isOpen, onClose, auth, enginePort }: AuthModalProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(true)

  // Detect setup status when modal opens
  useEffect(() => {
    if (!isOpen) return
    setDetecting(true)
    setError(null)
    const api = getEngineAPI(enginePort)
    api.getSetupStatus()
      .then((status) => {
        setMode(status.needs_setup ? 'initialize' : 'login')
      })
      .catch(() => setMode('login'))
      .finally(() => setDetecting(false))
  }, [isOpen, enginePort])

  const handleSubmit = useCallback(async () => {
    if (loading) return
    setError(null)

    if (!email.trim()) {
      setError(t('auth.error.emailRequired'))
      return
    }
    if (password.length < 8) {
      setError(t('auth.error.passwordTooShort'))
      return
    }
    if (mode !== 'login' && password !== confirm) {
      setError(t('auth.error.passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      if (mode === 'initialize') {
        await auth.initialize(email.trim(), password)
      } else if (mode === 'register') {
        await auth.register(email.trim(), password)
      } else {
        await auth.login(email.trim(), password)
      }
      setEmail('')
      setPassword('')
      setConfirm('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [loading, email, password, confirm, mode, auth, onClose, t])

  if (!isOpen) return null

  const titleKey = mode === 'initialize' ? 'auth.title.initialize' : mode === 'register' ? 'auth.title.register' : 'auth.title.login'
  const submitKey = mode === 'initialize' ? 'auth.submit.initialize' : mode === 'register' ? 'auth.submit.register' : 'auth.submit.login'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[380px] rounded-2xl bg-bg-surface border border-border-custom shadow-2xl p-6">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <img
            src="/favicon-64.png"
            alt="KCoder"
            width={48}
            height={48}
            className="rounded-xl"
          />
          <h2 className="text-base font-semibold text-text-primary mt-3">
            {detecting ? t('auth.detecting') : t(titleKey)}
          </h2>
          {mode === 'initialize' && !detecting && (
            <p className="text-xs text-text-muted mt-1 text-center">{t('auth.hint.initialize')}</p>
          )}
        </div>

        {!detecting && (
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="space-y-3">
            {/* Email */}
            <div>
              <label className="block text-xs text-text-muted mb-1">{t('auth.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email.placeholder')}
                autoFocus
                className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border-custom text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#3b82f6] transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs text-text-muted mb-1">{t('auth.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.password.placeholder')}
                className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border-custom text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#3b82f6] transition-colors"
              />
            </div>

            {/* Confirm password */}
            {mode !== 'login' && (
              <div>
                <label className="block text-xs text-text-muted mb-1">{t('auth.confirm')}</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('auth.confirm.placeholder')}
                  className="w-full px-3 py-2 rounded-lg bg-bg-primary border border-border-custom text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-[#3b82f6] transition-colors"
                />
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {loading ? t('auth.submitting') : t(submitKey)}
            </button>
          </form>
        )}

        {/* Mode switch */}
        {!detecting && mode !== 'initialize' && (
          <div className="mt-4 text-center">
            <button
              className="text-xs text-text-muted hover:text-[#3b82f6] transition-colors"
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}
            >
              {mode === 'login' ? t('auth.switch.toRegister') : t('auth.switch.toLogin')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
