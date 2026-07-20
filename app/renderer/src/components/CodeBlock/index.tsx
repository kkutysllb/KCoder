import { useState } from 'react'

interface CodeBlockProps {
  language: string
  code: string
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-[#333336]">
      {/* Header */}
      <div className="flex items-center justify-between bg-[#2a2a2c] px-4 py-2">
        <span className="text-xs font-medium text-[#71717a]">{language}</span>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-xs text-[#71717a] transition-colors hover:bg-[#333336] hover:text-[#a1a1aa]"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* Code content */}
      <pre className="overflow-x-auto bg-[#1a1a1c] p-4">
        <code className="text-[13px] text-[#e4e4e7]">{code}</code>
      </pre>
    </div>
  )
}
