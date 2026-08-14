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

  const tips = [
    { text: t('welcome.tip1'), icon: 'arch' },
    { text: t('welcome.tip2'), icon: 'code' },
    { text: t('welcome.tip3'), icon: 'search' },
  ]

  return (
    <div className="flex-1 h-full relative flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* 柔和背景光晕（替代原先沉重的巨型 K 字水印） */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 38%, rgba(59,130,246,0.10), transparent 70%)',
        }}
      />

      {/* 顶部品牌标记 */}
      <div className="relative z-10 mb-7 flex flex-col items-center gap-3">
        <img
          src="/favicon-64.png"
          alt="KCoder"
          className="h-14 w-14 rounded-2xl shadow-[0_8px_30px_rgba(59,130,246,0.30)]"
        />
        <h1 className="text-xl font-medium text-text-primary tracking-wide">{greeting}</h1>
      </div>

      {/* 主输入区 */}
      <div className="relative z-10 w-full max-w-2xl">
        <div className="rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.25)] ring-1 ring-border-custom/60 overflow-hidden">
          <CommandInput onSend={onSend} disabled={disabled} />
        </div>
      </div>

      {/* 示例卡片（点击即发） */}
      <div className="relative z-10 mt-7 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
        {tips.map((tip) => (
          <button
            key={tip.text}
            onClick={() => onSend(tip.text)}
            disabled={disabled}
            className="group flex flex-col gap-2 rounded-xl border border-border-custom bg-bg-surface/30 px-3.5 py-3 text-left transition-all hover:border-[#3b82f6]/40 hover:bg-bg-hover disabled:opacity-50"
          >
            <TipIcon name={tip.icon} />
            <span className="text-xs leading-snug text-text-secondary group-hover:text-text-primary">
              {tip.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TipIcon({ name }: { name: string }) {
  const cls = 'h-4 w-4 text-[#60a5fa]'
  if (name === 'arch') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9-4 9 4-9 4-9-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9 4 9-4M3 17l9 4 9-4" />
      </svg>
    )
  }
  if (name === 'code') {
    return (
      <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 5l-2 14" />
      </svg>
    )
  }
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4-4" />
    </svg>
  )
}
