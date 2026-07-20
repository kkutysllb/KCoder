/**
 * Strip chat-template special tokens that some providers leak into streamed
 * text deltas. GLM (ChatGLM / GLM-4 / GLM-5) in particular can emit
 * `<|begin_of_sentence|>` at the start of a completion when the endpoint does
 * not post-process the model output. These tokens are meaningless to users
 * and must not reach the rendered message.
 *
 * The list is intentionally a conservative superset of the common
 * `<|...|>`-style control tokens. We strip ANY `<|token|>`-shaped sequence so
 * newly-added provider tokens are covered without a code change, while plain
 * text that merely contains angle brackets (e.g. `<div>`, code snippets) is
 * left untouched — the pattern requires the `|` delimiters.
 */

import { stripInlineReasoningTags } from './reasoning-tags.js'
import { stripInlineToolCallMarkers } from './tool-call-markers.js'

/** Matches a single `<|name|>`-style special token (name is non-greedy, no
 *  newlines, no inner spaces so we don't swallow real prose). */
const SPECIAL_TOKEN_PATTERN = /<\|[^|\n<]*\|>/g

/** Known bracket-style markers some providers prepend to a completion (e.g.
 *  GLM's `[gMASK]`). Enumerated explicitly to avoid stripping arbitrary
 *  `[...]` prose (code, citations, footnotes). */
const BRACKET_MARKERS: readonly string[] = ['[gMASK]', '[MASK]']
const BRACKET_MARKER_PATTERN = new RegExp(
  BRACKET_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
)

/**
 * Remove chat-template special tokens (e.g. `<|begin_of_sentence|>`,
 * `<|user|>`, `<|assistant|>`, `<|endoftext|>`) and known bracket markers
 * (e.g. `[gMASK]`) from `text`.
 *
 * Returns the cleaned text. When every character is stripped (the model only
 * emitted tokens), returns an empty string so callers can skip emitting an
 * empty delta.
 */
export function stripSpecialTokens(text: string): string {
  if (!text) return text
  // Fast path: nothing to strip.
  if (!text.includes('<|') && !text.includes('[')) return text
  let out = text.replace(SPECIAL_TOKEN_PATTERN, '')
  out = out.replace(BRACKET_MARKER_PATTERN, '')
  return out
}

/**
 * Full text sanitization applied at every model-text emission point:
 * special tokens, bracket markers, inline reasoning/thinking tags, AND inline
 * tool/function-call markers. Use this (rather than calling the individual
 * strippers) so new sanitization rules are picked up everywhere automatically.
 */
export function sanitizeModelText(text: string): string {
  return stripInlineToolCallMarkers(stripInlineReasoningTags(stripSpecialTokens(text)))
}
