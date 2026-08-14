import { CommandInput } from '../CommandInput'
import { useI18n } from '../../i18n'

interface WelcomeScreenProps {
  onSend: (message: string) => void
  disabled?: boolean
}

// Get greeting key based on time of day
function getGreetingKey(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'welcome.morning'
  if (hour >= 12 && hour < 18) return 'welcome.afternoon'
  if (hour >= 18 && hour < 23) return 'welcome.evening'
  return 'welcome.night'
}

export function WelcomeScreen({ onSend, disabled }: WelcomeScreenProps) {
  const { t } = useI18n()
  const greeting = t(getGreetingKey())

  return (
    <div className="flex-1 h-full relative flex flex-col items-center px-8 overflow-hidden">
      {/* Large background "K" letter - disappears when task starts */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <span className="text-[420px] font-bold leading-none text-white/[0.03] tracking-tighter">
          K
        </span>
      </div>

      {/* Spacer to push content group down (greeting + input + hints centered as a block) */}
      <div className="flex-1" />

      {/* Greeting text */}
      <h1 className="relative z-10 text-2xl font-medium text-text-primary mb-10 tracking-wide">
        {greeting}
      </h1>

      {/* Command input — constrained width so it renders as a centered
          hero input, not a full-width top bar */}
      <div className="relative z-10 w-full max-w-2xl flex justify-center">
        <CommandInput onSend={onSend} disabled={disabled} />
      </div>

      {/* Quick hints */}
      <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">@</kbd>
          {t('welcome.hintFile')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">/</kbd>
          {t('welcome.hintCommand')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">$</kbd>
          {t('welcome.hintSkill')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">⌘K</kbd>
          {t('welcome.hintCmdK')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">📁</kbd>
          {t('welcome.hintFiles')}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">⌘V</kbd>
          {t('welcome.hintPaste')}
        </span>
      </div>

      {/* 示例提示（点击即发） */}
      <div className="relative z-10 mt-5 w-full max-w-2xl">
        <div className="mb-2 text-center text-[11px] text-text-muted">{t('welcome.tipTitle')}</div>
        <div className="flex flex-col items-center gap-1.5">
          {[t('welcome.tip1'), t('welcome.tip2'), t('welcome.tip3')].map((tip) => (
            <button
              key={tip}
              onClick={() => onSend(tip)}
              disabled={disabled}
              className="w-full max-w-xl rounded-lg border border-border-custom bg-bg-surface/40 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:border-[#3b82f6]/40 disabled:opacity-50"
            >
              {tip}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom spacer keeps the block vertically centered even on short windows */}
      <div className="flex-1" />
    </div>
  )
}
