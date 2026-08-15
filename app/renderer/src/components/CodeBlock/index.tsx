import { useEffect, useMemo, useState } from 'react'
import { highlight } from '../../lib/highlighter'
import { stripUnprintable } from '../../lib/chatMessage'
import { useI18n } from '../../i18n'

interface CodeBlockProps {
  language: string
  code: string
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)

  // 产品层兜底：剥离控制字符 / 非打印字符，避免二进制或编码内容破坏代码块
  // 布局、行号对齐或 Shiki 高亮（模型 echo 非文本文件时常见）。
  const safeCode = useMemo(() => stripUnprintable(code), [code])

  // 异步高亮：完成前 / 失败时回退纯文本，不闪烁不崩溃
  useEffect(() => {
    let cancelled = false
    setHtml(null)
    highlight(safeCode, language).then((result) => {
      if (!cancelled && result) setHtml(result)
    })
    return () => {
      cancelled = true
    }
  }, [safeCode, language])

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(safeCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border-custom">
      {/* Header */}
      <div className="flex items-center justify-between bg-bg-input px-4 py-2">
        <span className="text-xs font-medium text-text-muted">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-active hover:text-text-secondary"
        >
          {copied ? t('code.copied') : t('code.copy')}
        </button>
      </div>

      {/* Code content：行号列 + 高亮代码 */}
      <div className="flex overflow-x-auto bg-bg-surface">
        {lineCount > 1 && (
          <div className="shrink-0 select-none border-r border-border-subtle bg-[rgba(0,0,0,0.15)] px-3 py-4 text-right font-mono text-[13px] leading-[1.7] text-text-muted/50">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}

        {html ? (
          <div
            className="flex-1 px-4 py-4 font-mono text-[13px] leading-[1.7] [&_.line]:block [&>pre.shiki]:!m-0 [&>pre.shiki]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="flex-1 overflow-x-auto px-4 py-4 font-mono text-[13px] leading-[1.7]">
            <code className="text-text-primary">{safeCode}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
