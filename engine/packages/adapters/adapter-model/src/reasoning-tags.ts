/**
 * Strip inline reasoning/thinking tags that some models emit inside their text
 * stream (instead of through a dedicated `reasoning_content` channel).
 *
 * Models reached via raw OpenAI-compat endpoints (vLLM, llama.cpp, OpenRouter,
 * some GLM/DeepSeek proxies) can inline reasoning as tags like:
 *   - DeepSeek-R1:        `<think>...</think>`
 *   - Some fine-tunes:    `<thinking>...</thinking>`, `<reflection>...</reflection>`
 *   - MiniMax M3:         `<mm:think>...</mm:think>` (colon-prefixed), `<ask>...</ask>`
 *
 * The content between the tags IS the reasoning; we drop it entirely here
 * (the engine's reasoning channel is populated separately via
 * `reasoning_content`/`thinking_delta`). What matters at this layer is that
 * neither the tags nor their inner text leak into the assistant's visible
 * message body.
 *
 * Handles the full lifecycle robustly:
 *   1. Paired tags:        `<tag>...</tag>`           → removed (inner dropped)
 *   2. Unclosed opener:    `<tag>reasoning still going` → removed to end of text
 *                          (streaming mid-block, or model forgot to close)
 *   3. Orphaned closer:    `actual answer</tag>`        → the `</tag>` removed
 *                          (opener was in an earlier chunk)
 *   4. Variant tag names:  `<thinking>`, `<reasoning>`, `<reflection>`,
 *                          `<mm:think>` (MiniMax M3), `<ask>`
 *
 * Order matters: paired removal first, then unclosed-openers (greedy to EOF),
 * then orphaned closers. This avoids the unclosed-opener rule eating a block
 * that actually closes later in the same text.
 */

/**
 * Reasoning/instruction tag names known to be emitted inline by various models.
 * Names may contain colons (e.g. MiniMax's `mm:think`).
 */
const REASONING_TAG_NAMES = [
  'think',
  'thinking',
  'reasoning',
  'reflection',
  'mm:think',
  'ask',
] as const

/** A single name alternative escaped for regex, joined into an alternation.
 *  Colons are escaped; names are matched case-insensitively. */
const NAME_ALT = REASONING_TAG_NAMES.join('|')

/** Matches a paired `<tag>...</tag>` block for any reasoning tag name. */
const PAIRED_RE = new RegExp(
  `<(?:${NAME_ALT})>[\\s\\S]*?<\\/(?:${NAME_ALT})>`,
  'gi',
)

/**
 * Matches an unclosed opener: `<tag>` with no matching closer anywhere to its
 * right in the text. Applied AFTER paired removal, so any remaining `<tag>`
 * opener means the closer never arrived. Everything from the opener to the end
 * of the text is reasoning and is dropped.
 */
const UNCLOSED_OPENER_RE = new RegExp(
  `<(?:${NAME_ALT})>[\\s\\S]*`,
  'gi',
)

/** Matches an orphaned closing tag `</tag>` with no preceding opener. */
const ORPHANED_CLOSER_RE = new RegExp(
  `<\\/(?:${NAME_ALT})>`,
  'gi',
)

/** Fast-path test: does the text contain any reasoning tag at all? */
const HAS_ANY_TAG_RE = new RegExp(
  `<\\/?(${NAME_ALT})>`,
  'i',
)

/**
 * Remove inline reasoning tags and their inner content from `text`.
 *
 * Returns the cleaned text. When every character is reasoning (the model only
 * emitted a think block), returns an empty string so callers can skip emitting
 * an empty delta.
 */
export function stripInlineReasoningTags(text: string): string {
  if (!text) return text
  // Fast path: no reasoning tags present.
  if (!HAS_ANY_TAG_RE.test(text)) return text
  let out = text.replace(PAIRED_RE, '')
  out = out.replace(UNCLOSED_OPENER_RE, '')
  out = out.replace(ORPHANED_CLOSER_RE, '')
  return out
}
