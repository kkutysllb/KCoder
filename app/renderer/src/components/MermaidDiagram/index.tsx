// MermaidDiagram — agent 输出的 mermaid 代码围栏渲染成 SVG 图表。
//
// LLM 生成的 mermaid 语法常有幻觉（非法节点 id、括号不闭合、中文标点等），
// 渲染失败是常态而非例外，因此失败兜底必须优雅：
//   1. 渲染失败 → 显示友好提示条 + 回退普通代码块（源码可复制、可修改后重试）
//   2. 提供「重试渲染」按钮 —— 用户手动修正源码的场景
//
// mermaid 为动态 import：不用图表的会话不付出加载成本（库 ~1MB）。

import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'

let mermaidReady: Promise<typeof import('mermaid').default> | null = null

async function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      })
      return m.default
    })
  }
  return mermaidReady
}

export function MermaidDiagram({ code }: { code: string }) {
  const { t } = useI18n()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)
    loadMermaid()
      .then(async (mermaid) => {
        const { svg } = await mermaid.render(`mmd-${Date.now()}-${attempt}`, code)
        if (!cancelled) setSvg(svg)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e))
      })
    return () => {
      cancelled = true
    }
  }, [code, attempt])

  if (error) {
    // 兜底：语法渲染失败 → 提示条 + 源码回退（可复制可重试）
    return (
      <div className="my-3">
        <div className="flex items-center gap-1.5 rounded-t-lg border border-amber-500/30 border-b-0 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-400/90">
          <span aria-hidden>⚠️</span>
          <span className="flex-1">{t('mermaid.renderFailed')}</span>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded px-1.5 py-0.5 hover:bg-amber-400/10 transition-colors"
          >
            {t('mermaid.retry')}
          </button>
        </div>
        <pre className="overflow-x-auto rounded-b-lg border border-amber-500/20 bg-bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed text-text-secondary">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="my-3 flex items-center gap-2 rounded-lg border border-border-custom bg-bg-surface/50 px-4 py-6 text-xs text-text-muted">
        <svg className="h-3.5 w-3.5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        {t('mermaid.rendering')}
      </div>
    )
  }

  return (
    <div
      className="mermaid-svg my-3 overflow-x-auto rounded-lg border border-border-custom bg-bg-surface/60 px-4 py-3 [&_svg]:mx-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
