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
    <div className="flex-1 relative flex flex-col items-center justify-center px-8 overflow-hidden">
      {/* Large background "K" letter - disappears when task starts */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <span className="text-[420px] font-bold leading-none text-white/[0.03] tracking-tighter">
          K
        </span>
      </div>

      {/* Greeting text */}
      <h1 className="relative z-10 text-2xl font-medium text-text-primary mb-12 tracking-wide">
        {greeting}
      </h1>

      {/* Command input */}
      <div className="relative z-10 w-full flex justify-center">
        <CommandInput onSend={onSend} disabled={disabled} />
      </div>

      {/* Quick hints */}
      <div className="relative z-10 mt-8 flex items-center gap-6 text-xs text-text-muted">
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
          <kbd className="px-1.5 py-0.5 rounded bg-bg-input text-text-muted">#</kbd>
          {t('welcome.hintChat')}
        </span>
      </div>
    </div>
  )
}
