/**
 * Stateful streaming extractor for inline reasoning/thinking tags.
 *
 * Models reached via raw OpenAI-compat endpoints (vLLM, llama.cpp, OpenRouter,
 * some GLM/MiniMax proxies) inline reasoning as tags inside `delta.content`
 * instead of using a dedicated `reasoning_content` channel:
 *   - DeepSeek-R1 fine-tunes:  `<think>...</think>`
 *   - Some fine-tunes:         `<thinking>...`, `<reflection>...`
 *   - MiniMax M3:              `<mm:think>...</mm:think>`, `<ask>...</ask>`
 *
 * The challenge: tags are split across streaming chunks. A stateless per-chunk
 * stripper (like `stripInlineReasoningTags`) only sees one chunk at a time, so
 * when `<mm:think>` and `</mm:think>` land in different SSE frames, the inner
 * reasoning text in between is emitted as plain `assistant_text_delta` and
 * leaks into the visible message body.
 *
 * This extractor solves that by maintaining state across `push()` calls:
 *   - Tracks whether we're currently inside a reasoning block.
 *   - Buffers incomplete tag fragments at chunk boundaries (e.g. `<mm:t` +
 *     `hink>`) so a tag name split across chunks is still recognized.
 *   - On `flush()`, emits any trailing reasoning from an unclosed opener.
 *
 * Text outside tags → `text` output. Text inside tags → `reasoning` output.
 * The caller routes these to `assistant_text_delta` / `assistant_reasoning_delta`
 * respectively, so all models converge on the same reasoning channel.
 */

const TAG_NAMES = ['think', 'thinking', 'reasoning', 'reflection', 'mm:think', 'ask'] as const

/** Build `</?name>` patterns, escaping regex-special chars in names (colon). */
const NAME_ALT = TAG_NAMES.join('|')
const OPENER_RE = new RegExp(`<(${NAME_ALT})>`, 'gi')
const CLOSER_RE = new RegExp(`</(${NAME_ALT})>`, 'gi')

/** Max length of a partial tag fragment we might need to buffer = `<` + longest name + `>`. */
const MAX_TAG_LEN = 2 + Math.max(...TAG_NAMES.map((n) => n.length))

export interface ExtractorOutput {
  /** Visible text to emit as `assistant_text_delta` (already cleaned of tags). */
  text: string
  /** Reasoning text to emit as `assistant_reasoning_delta`. */
  reasoning: string
}

/**
 * Stateful streaming reasoning-tag extractor.
 *
 * Feed chunks via `push()`, call `flush()` at stream end.
 */
export class InlineReasoningExtractor {
  private insideReasoning = false
  /** Buffered tail of the previous chunk that might be an incomplete tag prefix. */
  private pendingTail = ''
  /** Accumulated reasoning for the current open block. */
  private reasoningBuffer = ''

  /**
   * Process a chunk of `delta.content`. Returns text and reasoning to emit.
   * Neither output contains raw tag markup — only content.
   */
  push(chunk: string): ExtractorOutput {
    if (!chunk) return { text: '', reasoning: '' }

    // Prepend any deferred tail from the previous chunk, then re-examine.
    let work = this.pendingTail + chunk
    this.pendingTail = ''

    const textParts: string[] = []
    const reasoningParts: string[] = []

    while (work.length > 0) {
      if (this.insideReasoning) {
        // Look for the matching closer.
        CLOSER_RE.lastIndex = 0
        const closerMatch = CLOSER_RE.exec(work)
        if (closerMatch) {
          // Everything up to the closer is reasoning.
          const before = work.slice(0, closerMatch.index)
          if (before) {
            this.reasoningBuffer += before
            reasoningParts.push(before)
          }
          work = work.slice(closerMatch.index + closerMatch[0].length)
          this.insideReasoning = false
          // reasoningBuffer persists across chunks; flush it only when a text
          // boundary or stream-end demands it. For delta emission we emit each
          // piece incrementally.
          continue
        }
        // No closer in this chunk — it's all reasoning (so far). But defer a
        // possible partial closer at the tail (e.g. `</mm:thi`) to the next chunk.
        const safe = this.stripUnsafeTail(work)
        if (safe) {
          this.reasoningBuffer += safe
          reasoningParts.push(safe)
        }
        work = ''
      } else {
        // Look for an opener.
        OPENER_RE.lastIndex = 0
        const openerMatch = OPENER_RE.exec(work)
        if (openerMatch) {
          // Text before the opener is visible.
          const before = work.slice(0, openerMatch.index)
          if (before) textParts.push(before)
          work = work.slice(openerMatch.index + openerMatch[0].length)
          this.insideReasoning = true
          this.reasoningBuffer = ''
          continue
        }
        // No opener. But the tail might be a partial opener (e.g. `<mm:t`).
        // Emit the safe prefix as text, defer the unsafe tail.
        const safe = this.stripUnsafeTail(work)
        if (safe) textParts.push(safe)
        work = ''
      }
    }

    return {
      text: textParts.join(''),
      reasoning: reasoningParts.join('')
    }
  }

  /**
   * Call at stream end. If we're still inside a reasoning block (unclosed
   * opener), emit the accumulated reasoning as a final delta.
   */
  flush(): ExtractorOutput {
    const result: ExtractorOutput = { text: '', reasoning: '' }
    if (this.pendingTail) {
      // The deferred tail was never resolved as a tag — it's plain content.
      if (this.insideReasoning) {
        result.reasoning = this.pendingTail
      } else {
        result.text = this.pendingTail
      }
      this.pendingTail = ''
    }
    return result
  }

  /**
   * Given `work`, emit the definitely-safe portion and defer a tail that could
   * be the start of a tag. The unsafe tail is any suffix starting with `<` that
   * is shorter than a full tag — or a longer suffix if it partially matches a
   * known tag name.
   */
  private stripUnsafeTail(work: string): string {
    const lastLt = work.lastIndexOf('<')
    if (lastLt < 0) {
      // No `<` at all — all safe. (Also resets any earlier partial match.)
      return work
    }
    const tail = work.slice(lastLt)
    if (tail.length > MAX_TAG_LEN) {
      // The `<` is too far from the end to be a partial tag — all safe.
      return work
    }
    // Could `tail` be the start of `<name>` or `</name>`?
    if (this.couldBeTagStart(tail)) {
      this.pendingTail = tail
      return work.slice(0, lastLt)
    }
    return work
  }

  /** Does `fragment` (starting with `<`) look like a prefix of a known tag? */
  private couldBeTagStart(fragment: string): boolean {
    const lower = fragment.toLowerCase()
    // Check against `<name` and `</name` for all known names.
    for (const name of TAG_NAMES) {
      if (`<${name}`.startsWith(lower) || `</${name}`.startsWith(lower)) {
        return true
      }
    }
    // Also a bare `<` or `</` is ambiguous — defer it to be safe.
    if (lower === '<' || lower === '</') return true
    return false
  }
}
