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
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border-custom">
      {/* Header */}
      <div className="flex items-center justify-between bg-bg-input px-4 py-2">
        <span className="text-xs font-medium text-text-muted">{language}</span>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-active hover:text-text-secondary"
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {/* Code content */}
      <pre className="overflow-x-auto bg-bg-surface p-4">
        <code className="text-[13px] text-text-primary">{code}</code>
      </pre>
    </div>
  )
}
