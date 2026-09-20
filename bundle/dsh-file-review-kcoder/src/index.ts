/**
 * File-review-tab plugin, node half. Registers the response-format guidance
 * that lets the browser half recognize final-response file references (only on
 * carriers whose built-in ui-deliverables plugin does not already own it — see
 * {@link registerFileReferenceGuidance}), plus the Code Mode mutation recorder
 * behind the review tab. The browser half ships via exports["./client"],
 * discovered through the package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReviewService } from './file-review-service.ts'

export type * from './change-types.ts'
export { FileReviewService, transformFile } from './file-review-service.ts'

/** Services required for the model guidance paired with the browser renderer. */
export const inject = ['systemPrompt']

/** Stable final-response guidance owned by the matching renderer. */
const FILE_REFERENCE_PROMPT = 'When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/**
 * The built-in ui-deliverables plugin registers byte-identical guidance as the
 * section `ui:deliverable-file-references`; this package's copy exists only for
 * carriers that predate it (the section has shipped in every Web composition
 * since dsh 0.1.0-rc.7).
 *
 * Two sections with different names both render, so keeping ours unconditionally
 * put the same paragraph in the prompt twice. Since dsh 0.1.2-alpha.1 the
 * section's placement is a centralized constant, and its presence is therefore
 * probeable without reaching into the registry's private layer table: a carrier
 * that knows the `DELIVERABLE_FILE_REFERENCES` position is exactly a carrier
 * whose built-in plugin owns the guidance. `getSectionOrder` returns
 * `undefined` (never throws) for an unknown name and is absent entirely on
 * older releases, so both older cases fall through to our own registration.
 * @param ctx - host context carrying the system-prompt registry.
 */
function registerFileReferenceGuidance(ctx: Context): void {
  const orders = ctx.systemPrompt as unknown as {
    getSectionOrder?: (name: string) => number | undefined
  }
  const builtInOrder = typeof orders.getSectionOrder === 'function'
    ? orders.getSectionOrder('DELIVERABLE_FILE_REFERENCES')
    : undefined
  if (typeof builtInOrder === 'number') return
  // systemPrompt.section 的 disposer 挂在服务自身 ctx 的 effect 上，不会
  // 随插件 fiber 回收；必须由插件 ctx.effect 收集，停用/卸载（HMR）时
  // 才能撤销该 section（否则 system prompt 里残留 ui:file-review-references）。
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'ui:file-review-references',
    order: 190,
    text: FILE_REFERENCE_PROMPT,
  }))
}

/** Runtime shape of the `tools/post-execute` waterfall arguments we consume. */
interface PostExecuteCall {
  readonly name: string
  readonly callId: string
  readonly rootCallId?: string | undefined
  readonly parent?: unknown
  readonly agent?: Agent | undefined
}
interface PostExecuteResult {
  readonly value?: unknown
}
type PostExecuteDecision = { readonly kind: string }
type PostExecuteNext = () => Promise<PostExecuteDecision>

/**
 * Register the Code Mode (`run_code`) mutation recorder that backs the
 * browser-side review tab, and — on carriers that lack it — the model guidance
 * for the file-reference renderer shipped by this package.
 *
 * Nested dispatch results carry no wire views — the diff cards only ride
 * model-direct tool/call frames — so reviewing programmatic file edits needs a
 * second source: this listener snapshots the full `before`/`after` content of
 * every nested file mutation (`edit`/`write` — recognized by result shape, not
 * tool name) into the `fileReview` service, which the browser half later turns
 * into line-level hunks and merges into the owning `run_code` turn.
 * @param ctx - host context carrying the system-prompt registry and tool waterfall.
 */
export function apply(ctx: Context): void {
  const service = new FileReviewService(ctx)
  registerFileReferenceGuidance(ctx)

  // 'tools/post-execute' lives in the host tool registry's Cordis event map,
  // outside this package's typed Events surface; the loose emitter cast keeps
  // the runtime contract (args are unknown-typed below) without inventing a
  // dependency on the registry plugin's type package. ctx.effect owns the
  // registration so fiber disposal (HMR / plugin disable) removes the
  // listener — a leaked one would record every mutation twice.
  const emitter = ctx as unknown as {
    on(event: string, listener: (exec: unknown, result: unknown, next: unknown) => unknown): () => void
  }
  ctx.effect(() => {
    const off = emitter.on('tools/post-execute', async (
      execRaw: unknown,
      resultRaw: unknown,
      nextRaw: unknown,
    ): Promise<PostExecuteDecision> => {
      const exec = execRaw as PostExecuteCall
      const result = resultRaw as PostExecuteResult
      const next = nextRaw as PostExecuteNext
      const decision = await next()
      if (decision.kind !== 'accept') return decision
      // Model-direct mutations are already reviewable through conversation views;
      // only nested dispatches (run_code sub-calls) need host-side recording.
      if (exec.parent === undefined || exec.agent === undefined) return decision
      const value = result.value
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return decision
      const candidate = value as { path?: unknown; before?: unknown; after?: unknown }
      if (typeof candidate.path !== 'string' || typeof candidate.after !== 'string') return decision
      if (candidate.before !== null && typeof candidate.before !== 'string') return decision
      service.recordMutation(exec.agent, {
        rootCallId: String(exec.rootCallId ?? exec.callId),
        name: exec.name,
        path: candidate.path,
        before: candidate.before ?? null,
        after: candidate.after,
      })
      return decision
    })
    return () => { off() }
  }, 'file-review-tab: ptc recorder')
}
