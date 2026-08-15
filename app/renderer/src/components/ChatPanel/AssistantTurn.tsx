// AssistantTurn — AI turn 编排器（参考 KStock AssistantTurn.tsx）。
//
// Claude/ChatGPT 风格无气泡布局，从上到下按语义分区：
//   1. 阶段徽章（无工具调用时）
//   2. ReasoningBlock（思考流，默认折叠）
//   3. SubagentGroup[]（子代理活动）
//   4. ToolActivitySummary（工具调用摘要，折叠式）
//   5. 正文 text（markdown）
//   6. ClarificationCard（如有交互式澄清，替换 fallback 正文）
//   7. 错误信息

import { useCallback, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, HumanInputPayload, ToolCall, TurnSegment } from '../../lib/chatMessage'
import { isInternalOnlyText, sanitizeAssistantText, isLikelyCorruptText } from '../../lib/chatMessage'
import { CodeBlock } from '../CodeBlock'
import { ToolActivitySummary, ToolCallRow } from './ToolActivitySummary'
import { useAppStore } from '../../stores/app-store'
import { useI18n } from '../../i18n'
import { StageBadge } from './StageBadge'
import { ReasoningBlock } from './ReasoningBlock'
import { SubagentGroup } from './SubagentGroup'
import { ClarificationCard } from './ClarificationCard'
import { ArtifactBar } from './ArtifactBar'
import { DeliveryResult } from './DeliveryResult'
import { StreamingDots } from './parts/icons'

interface AssistantTurnProps {
  msg: ChatMessage
  isStreaming?: boolean
  showStage?: boolean
  showReasoning?: boolean
  showToolCalls?: boolean
  /** ask_clarification 选项被选中时回调。 */
  onClarifyPick?: (text: string, question?: string) => void
  /** 重新生成本条 assistant 回复。 */
  onRegenerate?: (assistantMessageId: string) => void
  /** branches 状态（并行分支投影）。 */
  branches?: Record<string, unknown>
  /** 执行审批：批准被拦截的操作（confirm-before-change 模式）。 */
  onApprove?: (opId: string, toolName: string) => void
  /** 执行审批：拒绝被拦截的操作。 */
  onReject?: (opId: string, toolName: string) => void
  /** 计划批准：批准 present_plan 提交的计划并进入执行阶段。 */
  onPlanApprove?: (planId: string, title: string, planText: string) => void
  /** 计划批准：拒绝/要求修改计划。 */
  onPlanReject?: (planId: string, title: string) => void
  /** 交付卡：把 changelog 条目写入项目 CHANGELOG（交给 agent 执行）。 */
  onDeliveryChangelog?: (entry: string) => void
}

/**
 * 检测 turn 是否携带交互式澄清（ask_clarification）。
 * 如果是，用 ClarificationCard 替换 fallback 正文。
 */
function detectClarification(msg: ChatMessage): {
  payload?: HumanInputPayload
  isInteractive: boolean
} {
  // SSE 翻译层 (sse.py) 从 ToolMessage.artifact 中提取 human_input payload，
  // 在 tool_call_finished 事件中传递。当 toolCalls 里有 name === 'ask_clarification'
  // 且 status === 'completed' 时触发 ClarificationCard 渲染。
  const call = msg.toolCalls?.find(
    (c) => c.name === 'ask_clarification' && c.status === 'completed'
  )
  if (!call) return { isInteractive: false }
  const payload = call.artifact as HumanInputPayload | undefined
  if (!payload || payload.kind !== 'human_input_request') {
    return { isInteractive: false }
  }
  return {
    payload,
    isInteractive:
      payload.input_mode === 'choice_with_other' ||
      payload.input_mode === 'form' ||
      payload.input_mode === 'free_text'
  }
}

// ── 执行审批（confirm-before-change 模式）───────────────────────────────
//
// 引擎 PermissionMiddleware 在 mutating 工具执行前中断 turn，ToolMessage
// 内容携带 <approval_request id="..." tool="...">…</approval_request>。
// 前端检测该标记渲染审批卡：批准 → onApprove（approvedOps 随下轮放行一次）；
// 拒绝 → onReject（模型停止/改道）。
// 引擎 PermissionMiddleware 把 <approval_request> 块写在 ToolMessage.content 里。
// gateway 实时流的 tool_call_finished 只写 summary（截断到 500 字），历史加载才写
// output；且 500 字截断可能砍掉 </approval_request> 闭合标签。因此：
//   1) 检测同时查 output 与 summary；
//   2) 正则以「闭合标签或字符串结尾」收尾，容忍截断（id/tool 总在开头，不受影响）。
const APPROVAL_RE = /<approval_request id="([^"]+)" tool="([^"]+)">([\s\S]*?)(?:<\/approval_request>|$)/

function detectApproval(msg: ChatMessage): {
  opId: string
  toolName: string
  argsPreview: string
} | null {
  for (const call of msg.toolCalls ?? []) {
    if (call.status !== 'completed') continue
    const raw = call.output ?? call.summary ?? ''
    if (!raw) continue
    const m = APPROVAL_RE.exec(String(raw))
    if (m) {
      return {
        opId: m[1],
        toolName: m[2],
        argsPreview: m[3].trim().slice(0, 1200)
      }
    }
  }
  return null
}

function ApprovalCard({
  opId,
  toolName,
  argsPreview,
  onApprove,
  onReject
}: {
  opId: string
  toolName: string
  argsPreview: string
  onApprove: (opId: string, toolName: string) => void
  onReject: (opId: string, toolName: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="my-2 rounded-lg border border-info/40 bg-info/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-info">
        <span aria-hidden>🛂</span>
        <span>{t('approval.title')}</span>
        <span className="ml-1 rounded bg-info/15 px-1.5 py-0.5 font-mono text-[10px]">{toolName}</span>
      </div>
      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/25 p-2 font-mono text-[11px] text-text-secondary">
        {argsPreview}
      </pre>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onApprove(opId, toolName)}
          className="rounded-md bg-info px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2563eb] transition-colors"
        >
          {t('approval.approve')}
        </button>
        <button
          onClick={() => onReject(opId, toolName)}
          className="rounded-md border border-border-custom px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
        >
          {t('approval.reject')}
        </button>
      </div>
    </div>
  )
}

// ── 计划批准（plan-mode 的 present_plan 出口）──────────────────────────
//
// 引擎 present_plan 工具把 <plan_request id="..." status="awaiting_approval">
// …</plan_request> 写在 ToolMessage.content 里。前端检测该标记渲染计划批准卡：
// 批准 → onPlanApprove（切换 auto-edit + 携带计划发起执行 turn）；
// 拒绝 → onPlanReject（告知模型调整计划）。
// 与 approval_request 相同的截断容错：查 output ?? summary，闭合标签可缺失。
const PLAN_RE = /<plan_request id="([^"]+)" status="[^"]*">([\s\S]*?)(?:<\/plan_request>|$)/

interface PlanPayload {
  planId: string
  title: string
  overview: string
  steps: string[]
  verification: string
  planText: string
}

function detectPlan(msg: ChatMessage): PlanPayload | null {
  for (const call of msg.toolCalls ?? []) {
    if (call.name !== 'present_plan' || call.status !== 'completed') continue
    const raw = call.output ?? call.summary ?? ''
    if (!raw) continue
    const m = PLAN_RE.exec(String(raw))
    if (!m) continue
    const inner = m[2].trim()
    // 轻解析：Title: 行 → overview 段 → Steps: 编号列表 → Verification: 段。
    // 用换行边界定位（引擎输出固定为 "Steps:\n" / "Verification:\n" 开头的新行）。
    const titleMatch = /^Title:\s*(.+)$/m.exec(inner)
    const title = titleMatch?.[1]?.trim() || 'Untitled plan'
    const stepsIdx = inner.indexOf('\nSteps:\n')
    const stepsVerifIdx = inner.indexOf('\nVerification:\n')
    let overview = inner.replace(/^Title:\s*.+$/m, '').trim()
    let steps: string[] = []
    let verification = ''
    if (stepsIdx >= 0) {
      overview = inner.slice(0, stepsIdx).replace(/^Title:\s*.+$/m, '').trim()
      const stepsEnd = stepsVerifIdx > stepsIdx ? stepsVerifIdx : inner.length
      const stepsText = inner.slice(stepsIdx + '\nSteps:\n'.length, stepsEnd).trim()
      steps = stepsText
        .split('\n')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
      if (stepsVerifIdx > stepsIdx) {
        verification = inner.slice(stepsVerifIdx + '\nVerification:\n'.length).trim()
      }
    }
    return { planId: m[1], title, overview, steps, verification, planText: inner }
  }
  return null
}

function PlanApprovalCard({
  plan,
  onApprove,
  onReject
}: {
  plan: PlanPayload
  onApprove: (planId: string, title: string, planText: string) => void
  onReject: (planId: string, title: string) => void
}) {
  const { t } = useI18n()
  return (
    <div className="my-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-success">
        <span aria-hidden>📋</span>
        <span>{t('plan.title')}</span>
        <span className="ml-1 rounded bg-success/15 px-1.5 py-0.5 font-mono text-[10px]">{plan.planId}</span>
      </div>
      <div className="mt-1.5 text-xs font-semibold text-text-primary">{plan.title}</div>
      {plan.overview && (
        <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{plan.overview}</p>
      )}
      {plan.steps.length > 0 && (
        <ol className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
          {plan.steps.slice(0, 12).map((step, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-text-muted shrink-0">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
          {plan.steps.length > 12 && (
            <li className="text-text-muted">…（共 {plan.steps.length} 步，展示前 12 步）</li>
          )}
        </ol>
      )}
      {plan.verification && (
        <pre className="mt-1.5 rounded bg-black/25 px-2 py-1 font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all">
          ✓ {plan.verification}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => onApprove(plan.planId, plan.title, plan.planText)}
          className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16a34a] transition-colors"
        >
          {t('plan.approve')}
        </button>
        <button
          onClick={() => onReject(plan.planId, plan.title)}
          className="rounded-md border border-border-custom px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
        >
          {t('plan.reject')}
        </button>
      </div>
    </div>
  )
}

// ── 交付卡（present_delivery：PR 描述 + changelog 条目）────────────────
//
// 引擎 present_delivery 工具把 <delivery id="...">…</delivery> 写在
// ToolMessage.content 里。前端渲染交付卡：复制 PR 描述 / 追加 CHANGELOG。
// 解析与 plan_request 相同的截断容错（查 output ?? summary）。
const DELIVERY_RE = /<delivery id="([^"]+)">([\s\S]*?)(?:<\/delivery>|$)/

interface DeliveryPayload {
  deliveryId: string
  title: string
  summary: string
  changes: string[]
  tests: string
  review: string
  changelog: string
}

function detectDelivery(msg: ChatMessage): DeliveryPayload | null {
  for (const call of msg.toolCalls ?? []) {
    if (call.name !== 'present_delivery' || call.status !== 'completed') continue
    const raw = call.output ?? call.summary ?? ''
    if (!raw) continue
    const m = DELIVERY_RE.exec(String(raw))
    if (!m) continue
    const inner = m[2].trim()
    const titleMatch = /^Title:\s*(.+)$/m.exec(inner)
    const title = titleMatch?.[1]?.trim() || 'Untitled change'
    const offChanges = inner.indexOf('\nChanges:\n')
    const offTests = inner.indexOf('\nTests:\n')
    const offReview = inner.indexOf('\nReview:\n')
    const offChangelog = inner.indexOf('\nChangelog:\n')
    const summaryEnd = offChanges >= 0 ? offChanges : inner.length
    const summary = inner.slice(0, summaryEnd).replace(/^Title:\s*.+$/m, '').trim()
    const changesText =
      offChanges >= 0
        ? inner.slice(
            offChanges + '\nChanges:\n'.length,
            [offTests, offReview, offChangelog, inner.length].filter((o) => o > offChanges).sort((a, b) => a - b)[0] ?? inner.length
          )
        : ''
    const changes = changesText
      .trim()
      .split('\n')
      .map((s) => s.replace(/^-\s*/, '').trim())
      .filter(Boolean)
    const sliceSection = (off: number, header: string, nextOffs: number[]) => {
      if (off < 0) return ''
      const end = nextOffs.filter((o) => o > off).sort((a, b) => a - b)[0] ?? inner.length
      return inner.slice(off + header.length, end).trim()
    }
    const tests = sliceSection(offTests, '\nTests:\n', [offReview, offChangelog])
    const review = sliceSection(offReview, '\nReview:\n', [offChangelog])
    const changelog = sliceSection(offChangelog, '\nChangelog:\n', [])
    return { deliveryId: m[1], title, summary, changes, tests, review, changelog }
  }
  return null
}

function DeliveryCard({
  delivery,
  onChangelogWrite
}: {
  delivery: DeliveryPayload
  onChangelogWrite: (entry: string) => void
}) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const prText = useMemo(() => {
    // PR 描述模板（Phase D3）：标题/概述/变更/验证清单/审查结论
    const verificationItems = delivery.tests
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const parts = [
      `# ${delivery.title}`,
      '',
      delivery.summary,
      '',
      '## Changes',
      ...delivery.changes.map((c) => `- ${c}`),
      '',
      '## Verification',
      ...(verificationItems.length > 0 ? verificationItems.map((v) => `- [ ] ${v}`) : ['(none)'])
    ]
    if (delivery.review) parts.push('', '## Review', delivery.review)
    return parts.join('\n')
  }, [delivery])

  const copyPr = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }, [prText])

  return (
    <div className="my-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
        <span aria-hidden>📦</span>
        <span>{t('delivery.title')}</span>
        <span className="ml-1 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px]">{delivery.deliveryId}</span>
      </div>
      <div className="mt-1.5 text-xs font-semibold text-text-primary">{delivery.title}</div>
      {delivery.summary && (
        <p className="mt-1 text-xs text-text-secondary whitespace-pre-wrap">{delivery.summary}</p>
      )}
      {delivery.changes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-text-secondary">
          {delivery.changes.slice(0, 12).map((change, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-text-muted shrink-0">•</span>
              <span>{change}</span>
            </li>
          ))}
        </ul>
      )}
      {delivery.tests && (
        <pre className="mt-1.5 rounded bg-black/25 px-2 py-1 font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all">
          ✓ {delivery.tests}
        </pre>
      )}
      {delivery.review && (
        <p className="mt-1.5 text-xs text-text-muted whitespace-pre-wrap">
          <span className="font-medium text-text-secondary">{t('delivery.review')}: </span>
          {delivery.review}
        </p>
      )}
      {delivery.changelog && (
        <pre className="mt-1.5 rounded bg-black/25 px-2 py-1 font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all">
          {delivery.changelog}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        <button
          onClick={copyPr}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
        >
          {copied ? t('delivery.copied') : t('delivery.copyPr')}
        </button>
        {delivery.changelog && (
          <button
            onClick={() => onChangelogWrite(delivery.changelog)}
            className="rounded-md border border-border-custom px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover transition-colors"
          >
            {t('delivery.writeChangelog')}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * 兜底折叠：当一段正文被判定为已损坏（替换字符占比过高，通常是模型 echo 了
 * 二进制 / 非文本文件内容）时，渲染此提示而非把乱码当 markdown 渲染。
 * 提供 <details> 展开查看原始（已清洗）内容，兼顾兜底与可追溯。
 */
function CorruptTextNotice({ text }: { text: string }) {
  const { t } = useI18n()
  return (
    <div className="my-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400/90">
      <div className="flex items-center gap-1.5">
        <span aria-hidden>⚠️</span>
        <span>{t('chat.corruptContent')}</span>
      </div>
      <details className="mt-1 text-text-muted">
        <summary className="cursor-pointer select-none text-[11px] hover:text-text-secondary">
          {t('chat.corruptShowRaw')}
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/20 p-2 font-mono text-[11px] text-text-muted">
          {text.slice(0, 2000)}
        </pre>
      </details>
    </div>
  )
}

/**
 * 连续工具段分组渲染：正文段直接渲染；连续 ≥3 个工具段折叠为一行汇总
 * （「N 个工具调用 · 摘要」），点击展开扁平行明细。组内有运行中调用时
 * 强制展开（保实时感）；历史/失败混合状态在汇总行标注。
 */
function ToolSegments({
  segments,
  callById,
  streaming,
  renderText,
}: {
  segments: TurnSegment[]
  callById: Record<string, ToolCall>
  streaming: boolean
  renderText: (text: string, key: string, isLast: boolean) => React.ReactNode
}) {
  const { t } = useI18n()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  // 分组：把 segments 切成 text / tool-run 的交替序列
  const groups = useMemo(() => {
    const out: Array<
      | { kind: 'text'; text: string; key: string; isLast: boolean }
      | { kind: 'tools'; calls: ToolCall[]; key: string }
    > = []
    let curToolCalls: ToolCall[] = []
    const flushTools = () => {
      if (curToolCalls.length > 0) {
        out.push({ kind: 'tools', calls: curToolCalls, key: `g${out.length}` })
        curToolCalls = []
      }
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg.type === 'text') {
        flushTools()
        const segText = sanitizeAssistantText(seg.text)
        if (segText) {
          out.push({ kind: 'text', text: segText, key: `t${i}`, isLast: i === segments.length - 1 })
        }
      } else {
        const call = callById[seg.callId]
        if (call) curToolCalls.push(call)
      }
    }
    flushTools()
    return out
  }, [segments, callById])

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      {groups.map((g) => {
        if (g.kind === 'text') {
          return renderText(g.text, g.key, g.isLast)
        }
        const hasRunning = g.calls.some((c) => c.status === 'running')
        const expanded = hasRunning || expandedGroups.has(g.key)
        if (expanded) {
          return (
            <div key={g.key} className="space-y-0.5 my-0.5">
              {g.calls.length >= 3 && !hasRunning && (
                <button
                  onClick={() => toggleGroup(g.key)}
                  className="text-[11px] text-[#6b7280] hover:text-text-secondary transition-colors"
                >
                  {t('tools.collapseGroup', { n: g.calls.length })}
                </button>
              )}
              {g.calls.map((c) => (
                <ToolCallRow key={c.id} call={c} />
              ))}
            </div>
          )
        }
        // 折叠态：一行汇总
        const running = g.calls.filter((c) => c.status === 'running').length
        const failed = g.calls.filter((c) => c.status === 'failed').length
        const fileCount = g.calls.filter((c) => /read|write|edit|str_replace|multiedit|create/i.test(c.name)).length
        return (
          <button
            key={g.key}
            onClick={() => toggleGroup(g.key)}
            className="flex items-center gap-1.5 py-0.5 text-[11px] text-[#9ca3af] hover:text-text-secondary transition-colors group/g"
          >
            <svg className="w-2.5 h-2.5 text-[#6b7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span>
              {t('tools.ranTools', { n: g.calls.length })}
              {fileCount > 0 && ` · ${t('tools.touchedFiles', { n: fileCount })}`}
              {failed > 0 && ` · ${t('tools.failedCount', { n: failed })}`}
            </span>
          </button>
        )
      })}
    </>
  )
}

export function AssistantTurn({
  msg,
  isStreaming,
  showStage = true,
  showReasoning = true,
  showToolCalls = true,
  onClarifyPick,
  onRegenerate,
  onApprove,
  onReject,
  onPlanApprove,
  onPlanReject,
  onDeliveryChangelog
}: AssistantTurnProps) {
  const streaming = isStreaming ?? msg.status === 'streaming'

  // 文件链接点击 → 打开全局预览右栏（三分栏第三栏，App.tsx 挂载）
  const openFilePreview = useAppStore((s) => s.openFilePreview)
  const { t } = useI18n()

  // 兜底净化：剥掉 QiLin 注入的 <memory> 等内部块（防止 SSE 流式或
  // loadThread 路径漏过滤时直接渲染给用户）。
  const displayText = useMemo(
    () => (isInternalOnlyText(msg.text) ? '' : sanitizeAssistantText(msg.text)),
    [msg.text]
  )

  // 澄清检测
  const { payload: clarifyPayload, isInteractive: hasInteractiveClarification } = useMemo(
    () => detectClarification(msg),
    [msg]
  )

  // 执行审批检测（confirm-before-change 模式的 <approval_request> 拦截标记）
  const approval = useMemo(() => detectApproval(msg), [msg])
  // 计划批准检测（plan-mode 的 present_plan 出口）
  const plan = useMemo(() => detectPlan(msg), [msg])
  // 交付卡检测（present_delivery 的 PR/changelog 交付）
  const delivery = useMemo(() => detectDelivery(msg), [msg])
  const visibleToolCalls = useMemo(
    () =>
      msg.toolCalls?.filter(
        (c) => c.name !== 'ask_clarification' && c.name !== 'present_plan' && c.name !== 'present_delivery'
      ) ?? [],
    [msg.toolCalls]
  )
  // callId → ToolCall 映射（交错渲染时按 segment.callId 查找）
  const callById = useMemo(() => {
    const m: Record<string, ToolCall> = {}
    for (const c of visibleToolCalls) m[c.id] = c
    return m
  }, [visibleToolCalls])

  // markdown 渲染组件（链接/代码块），正文段与回退正文共用
  const mdComponents = useMemo(
    () => ({
      a({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'> & { href?: string }) {
        const h = href || ''
        if (h.startsWith('/mnt/user-data/')) {
          return (
            <a
              href={h}
              onClick={(e) => {
                e.preventDefault()
                openFilePreview(h)
              }}
              title="在预览面板中打开该文件"
              {...props}
            >
              {children}
            </a>
          )
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        )
      },
      code({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
        const match = /language-(\w+)/.exec(className || '')
        const codeString = String(children).replace(/\n$/, '')
        if (match) {
          return <CodeBlock language={match[1]} code={codeString} />
        }
        return <code className="" {...props}>{children}</code>
      }
    }),
    [openFilePreview]
  )

  const hasToolActivity = showToolCalls && visibleToolCalls.length > 0
  const showTurnHeader = (showStage && !hasToolActivity) || msg.status === 'compacted'

  const hasContent =
    (displayText && displayText.length > 0) ||
    (showReasoning && msg.reasoning) ||
    (showToolCalls && msg.toolCalls && msg.toolCalls.length > 0) ||
    (msg.subagents && msg.subagents.length > 0) ||
    hasInteractiveClarification

  return (
    <article aria-label="助手消息" className="group">
      {/* turn 容器：去掉左侧 28px K 头像后，文字直接铺满 */}
      <div className="min-w-0">
        {/* 1. 阶段徽章 / compaction 通知 */}
        {showTurnHeader && (
          <div className="flex items-center gap-2 mb-2">
            {showStage && !hasToolActivity && (
              <StageBadge stage={msg.stage} streaming={streaming} />
            )}
            {msg.status === 'compacted' && (
              <span
                className="text-[10px] text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded"
                title="引擎已压缩历史上下文"
              >
                上下文已压缩
              </span>
            )}
          </div>
        )}

        {/* 2. 思考流（默认折叠） */}
        {showReasoning && msg.reasoning && (
          <ReasoningBlock
            reasoning={msg.reasoning}
            streaming={streaming}
            thinkingMs={msg.thinkingMs}
          />
        )}

        {/* 3. 子代理活动 */}
        {msg.subagents?.map((task) => (
          <SubagentGroup key={task.taskId} task={task} showToolCalls={showToolCalls} />
        ))}

        {/* 4. 正文 ↔ 工具调用按执行顺序交错展示（Cursor/Cline 风格）。
            有 segments 时分阶段渲染（正文段→工具卡片→正文段…）；
            无 segments（历史消息）回退到「聚合工具摘要 + 整段正文」。
            连续 ≥3 个工具段折叠为一行汇总（阅读节奏），点击展开明细；
            有运行中的调用时组保持展开（保实时感）。 */}
        {msg.segments && msg.segments.length > 0 ? (
          <div className="space-y-1.5 [&>div.turn-text]:!my-0.5">
            <ToolSegments
              segments={msg.segments}
              callById={callById}
              streaming={streaming}
              renderText={(segText, key, isLast) => (
                <div key={key} className="turn-text markdown-body">
                  {isLikelyCorruptText(segText) ? (
                    <CorruptTextNotice text={segText} />
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {segText}
                    </ReactMarkdown>
                  )}
                  {streaming && isLast && (
                    <span className="inline-block ml-1 align-middle" aria-hidden="true">
                      <span className="inline-block w-1.5 h-3 bg-info animate-pulse" />
                    </span>
                  )}
                </div>
              )}
            />
          </div>
        ) : (
          <>
            {showToolCalls && (
              <ToolActivitySummary calls={visibleToolCalls} streaming={streaming} />
            )}
            {hasInteractiveClarification && !approval && clarifyPayload && onClarifyPick ? (
              <ClarificationCard
                payload={clarifyPayload}
                onPick={(text) => onClarifyPick(text, clarifyPayload.question)}
              />
            ) : (
              displayText && (
                <div className="turn-text markdown-body">
                  {isLikelyCorruptText(displayText) ? (
                    <CorruptTextNotice text={displayText} />
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {displayText}
                    </ReactMarkdown>
                  )}
                  {streaming && (
                    <span className="inline-block ml-1 align-middle" aria-hidden="true">
                      <span className="inline-block w-1.5 h-3 bg-info animate-pulse" />
                    </span>
                  )}
                </div>
              )
            )}
          </>
        )}

        {/* 交错模式下澄清卡片置于内容之后 */}
        {msg.segments && msg.segments.length > 0 && hasInteractiveClarification && !approval && clarifyPayload && onClarifyPick && (
          <ClarificationCard
            payload={clarifyPayload}
            onPick={(text) => onClarifyPick(text, clarifyPayload.question)}
          />
        )}

        {/* 产出文件 */}
        <ArtifactBar msg={msg} />

        {/* 执行审批卡（confirm-before-change：引擎拦截 mutating 工具并暂停 turn） */}
        {!streaming && approval && onApprove && onReject && (
          <ApprovalCard
            opId={approval.opId}
            toolName={approval.toolName}
            argsPreview={approval.argsPreview}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}

        {/* 计划批准卡（plan-mode：present_plan 提交计划，批准后进入执行阶段） */}
        {!streaming && plan && onPlanApprove && onPlanReject && (
          <PlanApprovalCard
            plan={plan}
            onApprove={onPlanApprove}
            onReject={onPlanReject}
          />
        )}

        {/* 交付卡（present_delivery：PR 描述 + changelog 条目） */}
        {!streaming && delivery && onDeliveryChangelog && (
          <DeliveryCard delivery={delivery} onChangelogWrite={onDeliveryChangelog} />
        )}

        {/* 上下文压缩提示（compaction_completed 事件，manual/auto 压缩通用） */}
        {!streaming && msg.compaction && (msg.compaction.removedCount ?? 0) > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-text-muted">
            <span aria-hidden>📦</span>
            <span>
              {t('compact.done', {
                removed: msg.compaction.removedCount ?? 0,
                preserved: msg.compaction.preservedCount ?? 0
              })}
            </span>
          </div>
        )}

        {/* 交付结果（turn 完成且有文件变更时收尾）：✓已完成 + 统计 + 复制/提交 + 文件清单 */}
        {!streaming && msg.fileChanges && msg.fileChanges.files.length > 0 && (
          <DeliveryResult msg={msg} />
        )}

        {/* 空内容 streaming 占位 */}
        {!hasContent && streaming && (
          <div className="flex items-center gap-2 pt-1 text-text-muted">
            <StreamingDots />
            <span className="text-xs">正在启动…</span>
          </div>
        )}

        {/* 错误 */}
        {msg.error && (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs text-red-300">{msg.error}</span>
          </div>
        )}

        {/* 操作栏：重新生成（非流式、有正文、未出错时显示） */}
        {!streaming && hasContent && !msg.error && onRegenerate && (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onRegenerate(msg.id)}
              title={t('chat.regenerate')}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.356M19.6 9.348A8 8 0 106.32 6.876L4 9.348m0 0V4.356M4 9.348h4.992" />
              </svg>
              {t('chat.regenerate')}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
