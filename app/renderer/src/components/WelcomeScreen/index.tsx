import { CommandInput } from '../CommandInput'

interface WelcomeScreenProps {
  onSend: (message: string) => void
  disabled?: boolean
}

// Get greeting based on time of day
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    return '早上好，新的一天从代码开始'
  } else if (hour >= 12 && hour < 18) {
    return '下午好，保持专注继续前进'
  } else if (hour >= 18 && hour < 23) {
    return '晚上好，辛苦了一天记得休息'
  } else {
    return '夜深啦，困了也要照顾好自己哦'
  }
}

export function WelcomeScreen({ onSend, disabled }: WelcomeScreenProps) {
  const greeting = getGreeting()

  return (
    <div className="flex-1 relative flex flex-col items-center justify-center px-8 overflow-hidden">
      {/* Large background "K" letter - disappears when task starts */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        <span className="text-[420px] font-bold leading-none text-white/[0.03] tracking-tighter">
          K
        </span>
      </div>

      {/* Greeting text */}
      <h1 className="relative z-10 text-2xl font-medium text-[#e4e4e7] mb-12 tracking-wide">
        {greeting}
      </h1>

      {/* Command input */}
      <div className="relative z-10 w-full flex justify-center">
        <CommandInput onSend={onSend} disabled={disabled} />
      </div>

      {/* Quick hints */}
      <div className="relative z-10 mt-8 flex items-center gap-6 text-xs text-[#52525b]">
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[#2a2a2c] text-[#71717a]">@</kbd>
          提及文件
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[#2a2a2c] text-[#71717a]">/</kbd>
          命令
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[#2a2a2c] text-[#71717a]">$</kbd>
          技能
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-[#2a2a2c] text-[#71717a]">#</kbd>
          关联对话
        </span>
      </div>
    </div>
  )
}
