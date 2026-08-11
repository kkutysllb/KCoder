import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { getEngineAPI } from '../services/engine-api'
import type { AuthSetupStatus } from '../services/engine-api'
import type { AuthState } from '../hooks/useAuth'

type AuthView = 'landing' | 'login' | 'register' | 'initialize'

interface AuthExperienceProps {
  auth: AuthState
  enginePort: number
}

function ArrowRight() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  )
}

function ArrowLeft() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="m15 18-6-6 6-6M9 12h10" />
    </svg>
  )
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="m3 3 18 18M10.58 10.58a2 2 0 0 0 2.83 2.83M9.88 4.24A9.77 9.77 0 0 1 12 4c5 0 8.5 4 9.5 8a11.4 11.4 0 0 1-2.05 3.83M6.23 6.23C3.78 7.9 2.57 10.3 2.5 12c.4 1.64 1.6 4.16 4.29 5.8A9.9 9.9 0 0 0 12 20c1.17 0 2.28-.2 3.29-.56" />
    </svg>
  ) : (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2.5 12S6 4 12 4s9.5 8 9.5 8S18 20 12 20 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" strokeWidth="1.6" />
    </svg>
  )
}

function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/favicon-64.png"
        alt="KCoder logo"
        className={`${large ? 'h-12 w-12 rounded-[15px]' : 'h-9 w-9 rounded-[11px]'} shadow-[0_0_32px_rgba(30,136,229,0.22)]`}
      />
      <span className={`${large ? 'text-xl' : 'text-base'} font-semibold tracking-[-0.02em] text-white`}>KCoder</span>
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="mt-10 w-full max-w-[560px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d1117] shadow-2xl shadow-black/30">
      <div className="flex h-10 items-center border-b border-white/[0.08] px-3.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-[#f26d67]" />
          <span className="h-2 w-2 rounded-full bg-[#e8b64d]" />
          <span className="h-2 w-2 rounded-full bg-[#45c879]" />
        </div>
        <div className="mx-auto flex items-center gap-2 pr-10 text-[10px] font-medium text-[#8495a7]">
          <img src="/favicon-32.png" alt="" className="h-4 w-4 rounded" />
          KCoder / auth-flow
        </div>
      </div>
      <div className="grid h-[224px] grid-cols-[130px_1fr]">
        <div className="border-r border-white/[0.08] bg-[#0a0e13] p-3">
          <div className="mb-3 text-[9px] font-medium uppercase tracking-[0.16em] text-[#566779]">Workspace</div>
          <div className="space-y-1 text-[10px]">
            <div className="rounded-md bg-[#1e88e5]/15 px-2 py-1.5 text-[#8cc8f6]">auth / routes.py</div>
            <div className="px-2 py-1.5 text-[#718294]">ui / SignIn.tsx</div>
            <div className="px-2 py-1.5 text-[#718294]">hooks / useAuth.ts</div>
          </div>
          <div className="mt-5 border-t border-white/[0.07] pt-3">
            <div className="mb-2 text-[9px] uppercase tracking-[0.16em] text-[#566779]">Agent</div>
            <div className="flex items-center gap-2 text-[10px] text-[#a5b5c5]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#45c879] shadow-[0_0_7px_#45c879]" />
              Implementing
            </div>
          </div>
        </div>
        <div className="min-w-0 p-4 font-mono text-[10px] leading-[1.7]">
          <div className="mb-3 flex items-center justify-between font-sans">
            <div>
              <p className="text-[11px] font-medium text-[#d8e1ea]">Connect authentication</p>
              <p className="mt-0.5 text-[9px] text-[#607286]">3 files changed · backend verified</p>
            </div>
            <span className="rounded bg-[#45c879]/10 px-2 py-1 text-[9px] text-[#66d990]">Passed</span>
          </div>
          <div className="border-l border-white/[0.07] pl-3 text-[#7e8e9f]">
            <div><span className="mr-3 text-[#44515e]">12</span><span className="text-[#c48be8]">async function</span> <span className="text-[#80bdf0]">signIn</span>(email, password) {'{'}</div>
            <div className="bg-[#45c879]/[0.07] text-[#a6c8b2]"><span className="mr-3 text-[#4f765c]">13</span>+ const session = await engine.authLogin(...)</div>
            <div className="bg-[#45c879]/[0.07] text-[#a6c8b2]"><span className="mr-3 text-[#4f765c]">14</span>+ persistSession(session.access_token)</div>
            <div><span className="mr-3 text-[#44515e]">15</span>{'}'}</div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-white/[0.07] pt-3 font-sans text-[9px] text-[#718294]">
            <span className="text-[#45c879]">✓</span>
            JWT session established with local engine
          </div>
        </div>
      </div>
    </div>
  )
}

export function AuthExperience({ auth, enginePort }: AuthExperienceProps) {
  const { t } = useI18n()
  const [view, setView] = useState<AuthView>('landing')
  const [setupStatus, setSetupStatus] = useState<AuthSetupStatus | null>(null)
  const [detecting, setDetecting] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const api = useMemo(() => getEngineAPI(enginePort), [enginePort])

  useEffect(() => {
    let cancelled = false
    setDetecting(true)
    api.getSetupStatus()
      .then((status) => {
        if (!cancelled) setSetupStatus(status)
      })
      .catch(() => {
        if (!cancelled) setSetupStatus(null)
      })
      .finally(() => {
        if (!cancelled) setDetecting(false)
      })
    return () => { cancelled = true }
  }, [api])

  const openLogin = useCallback(() => {
    setView(setupStatus?.needs_setup ? 'initialize' : 'login')
    setError(null)
  }, [setupStatus])

  const openRegister = useCallback(() => {
    setView('register')
    setError(null)
  }, [])

  const reset = useCallback(() => {
    setView('landing')
    setError(null)
    setPassword('')
    setConfirm('')
  }, [])

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
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
    if (view !== 'login' && password !== confirm) {
      setError(t('auth.error.passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      if (view === 'initialize') await auth.initialize(email.trim(), password)
      else if (view === 'register') await auth.register(email.trim(), password)
      else await auth.login(email.trim(), password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('auth.error.unknown'))
    } finally {
      setLoading(false)
    }
  }, [auth, confirm, email, loading, password, t, view])

  const formTitle = view === 'initialize' ? t('auth.title.initialize') : view === 'register' ? t('auth.title.register') : t('auth.title.login')
  const submitLabel = view === 'initialize' ? t('auth.submit.initialize') : view === 'register' ? t('auth.submit.register') : t('auth.submit.login')
  const formSubtitle = view === 'initialize' ? t('auth.hint.initialize') : view === 'register' ? t('auth.page.registerSubtitle') : t('auth.page.loginSubtitle')

  return (
    <main className="min-h-screen overflow-auto bg-[#080b10] text-white">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative flex min-h-[580px] flex-col overflow-hidden border-b border-white/[0.08] px-7 py-8 sm:px-12 lg:min-h-screen lg:border-b-0 lg:border-r lg:px-16 lg:py-10">
          <div className="relative z-10 flex items-center justify-between">
            <BrandMark large />
            <span className="hidden text-[11px] uppercase tracking-[0.22em] text-[#71849a] sm:block">Local agent workspace</span>
          </div>

          <div className="relative z-10 flex flex-1 flex-col justify-center py-14 lg:py-20">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.28em] text-[#5faef1]">{t('auth.page.eyebrow')}</p>
            <h1 className="max-w-[620px] text-4xl font-semibold leading-[1.1] tracking-[-0.04em] text-white sm:text-5xl lg:text-[3.55rem]">
              {t('auth.page.heroTitle')}
            </h1>
            <p className="mt-6 max-w-[520px] text-base leading-7 text-[#96a6b7] sm:text-lg">
              {t('auth.page.heroSubtitle')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-xs text-[#9bb3c9]">
              {[t('auth.page.feature.plan'), t('auth.page.feature.build'), t('auth.page.feature.review')].map((feature) => (
                <span key={feature} className="rounded-full border border-white/[0.1] bg-white/[0.035] px-3 py-1.5">{feature}</span>
              ))}
            </div>
            <ProductPreview />
          </div>

          <p className="relative z-10 text-xs text-[#607286]">{t('auth.page.footer')}</p>
        </section>

        <section className="flex min-h-[560px] items-center justify-center px-6 py-12 sm:px-12 lg:min-h-screen lg:px-16">
          {view === 'landing' ? (
            <div className="w-full max-w-[410px]">
              <BrandMark />
              <div className="mt-12">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#71849a]">{t('auth.page.welcomeEyebrow')}</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white">{t('auth.page.welcomeTitle')}</h2>
                <p className="mt-4 text-sm leading-6 text-[#8999aa]">{t('auth.page.welcomeSubtitle')}</p>
              </div>
              <div className="mt-9 space-y-3">
                <button onClick={openLogin} className="group flex w-full items-center justify-between rounded-xl bg-[#e8f3ff] px-5 py-3.5 text-sm font-semibold text-[#10253a] transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#5faef1]/60">
                  <span>{detecting ? t('auth.detecting') : setupStatus?.needs_setup ? t('auth.submit.initialize') : t('auth.submit.login')}</span>
                  <ArrowRight />
                </button>
                <button onClick={openRegister} className="flex w-full items-center justify-between rounded-xl border border-white/[0.14] bg-white/[0.035] px-5 py-3.5 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/[0.07] focus:outline-none focus:ring-2 focus:ring-[#5faef1]/60">
                  <span>{t('auth.submit.register')}</span>
                  <ArrowRight />
                </button>
              </div>
              <p className="mt-6 text-center text-xs leading-5 text-[#607286]">{t('auth.page.privacy')}</p>
            </div>
          ) : (
            <div className="w-full max-w-[410px]">
              <button onClick={reset} className="mb-10 inline-flex items-center gap-2 text-xs text-[#8393a4] transition hover:text-white"><ArrowLeft />{t('auth.page.back')}</button>
              <BrandMark />
              <h2 className="mt-10 text-3xl font-semibold tracking-[-0.035em] text-white">{formTitle}</h2>
              <p className="mt-3 text-sm leading-6 text-[#8999aa]">{formSubtitle}</p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-[#a6b5c4]">{t('auth.email')}</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('auth.email.placeholder')} autoFocus autoComplete="email" className="h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.045] px-4 text-sm text-white outline-none transition placeholder:text-[#5d6d7d] focus:border-[#5faef1] focus:bg-white/[0.07]" />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-[#a6b5c4]">{t('auth.password')}</span>
                  <span className="relative block">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('auth.password.placeholder')} autoComplete={view === 'login' ? 'current-password' : 'new-password'} className="h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.045] px-4 pr-12 text-sm text-white outline-none transition placeholder:text-[#5d6d7d] focus:border-[#5faef1] focus:bg-white/[0.07]" />
                    <button type="button" title={showPassword ? t('auth.page.hidePassword') : t('auth.page.showPassword')} onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#6f8192] transition hover:text-white"><EyeIcon hidden={!showPassword} /></button>
                  </span>
                </label>
                {view !== 'login' && (
                  <label className="block">
                    <span className="mb-2 block text-xs font-medium text-[#a6b5c4]">{t('auth.confirm')}</span>
                    <span className="relative block">
                      <input type={showConfirm ? 'text' : 'password'} value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder={t('auth.confirm.placeholder')} autoComplete="new-password" className="h-12 w-full rounded-xl border border-white/[0.12] bg-white/[0.045] px-4 pr-12 text-sm text-white outline-none transition placeholder:text-[#5d6d7d] focus:border-[#5faef1] focus:bg-white/[0.07]" />
                      <button type="button" title={showConfirm ? t('auth.page.hidePassword') : t('auth.page.showPassword')} onClick={() => setShowConfirm((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-[#6f8192] transition hover:text-white"><EyeIcon hidden={!showConfirm} /></button>
                    </span>
                  </label>
                )}
                {error && <p role="alert" className="rounded-xl border border-[#ef6b6b]/20 bg-[#ef6b6b]/[0.08] px-3.5 py-3 text-xs leading-5 text-[#ff9f9f]">{error}</p>}
                <button type="submit" disabled={loading || detecting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e8f3ff] text-sm font-semibold text-[#10253a] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#5faef1]/60">
                  {loading ? t('auth.submitting') : submitLabel}
                  {!loading && <ArrowRight />}
                </button>
              </form>

              {view !== 'initialize' && (
                <p className="mt-6 text-center text-xs text-[#718294]">
                  {view === 'login' ? t('auth.switch.toRegister') : t('auth.switch.toLogin')}
                  <button onClick={() => { setView(view === 'login' ? 'register' : 'login'); setError(null) }} className="ml-1 font-medium text-[#80bdf0] hover:text-white">{view === 'login' ? t('auth.submit.register') : t('auth.submit.login')}</button>
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
