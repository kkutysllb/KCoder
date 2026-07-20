/**
 * Strip inline tool/function-call markers that MiniMax M3 (and similar
 * models) emit inside the text stream when they fail to use the standard
 * `tool_calls` channel. These are protocol artifacts, not user-facing text.
 *
 * Observed MiniMax M3 inline formats:
 *   - `<]minimax[>`                    — segment delimiter (appears in pairs)
 *   - `<invoke name="bash">...</invoke>` — tool-invocation wrapper
 *   - `<command>...</command>`           — argument sub-tags inside <invoke>
 *   - `<parameter name="x">...</parameter>`
 *   - `<tool_call>...</tool_call>` / orphaned `</tool_call>`
 *   - `(tool call)` / `(tool call [Tool call: name] {...})` prose-style leaks
 *   - `<function_calls>[<invoke name="bash">]...` bracket-style XML leaks
 *   - `[<parameter name="command">...][ ]` bracket parameter leaks
 *
 * We strip the tag-shaped ones (angle-bracket and bracket-delimited) which are
 * unambiguous. The prose-style `(tool call [Tool call: ...] {...})` is harder
 * to match without false positives, so it is handled by a conservative pattern
 * that requires the literal `Tool call:` marker.
 */

/** MiniMax segment delimiter `<]minimax[>` (and its mirror). */
const MINIMAX_DELIMITER_RE = /<\]minimax\[>/g

/** Paired MiniMax tool-invocation wrapper and its argument sub-tags. */
const MINIMAX_INVOKE_TAGS = ['invoke', 'command', 'parameter', 'tool_call', 'function_calls', 'action'] as const
const PAIRED_INVOKE_RE = new RegExp(
  `<(?:${MINIMAX_INVOKE_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${MINIMAX_INVOKE_TAGS.join('|')})>`,
  'gi',
)
const UNCLOSED_INVOKE_RE = new RegExp(
  `\\[?<(?:${MINIMAX_INVOKE_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*`,
  'gi',
)
const ORPHANED_INVOKE_CLOSE_RE = new RegExp(
  `<\\/(?:${MINIMAX_INVOKE_TAGS.join('|')})>`,
  'gi',
)

/**
 * Bracket-style XML tool-call leak (Anthropic/Claude format that MiniMax
 * sometimes emits verbatim):
 *   `<function_calls>[<invoke name="bash">][<parameter name="command">...][ ]`
 *   `(tool call <function_calls>[<invoke ...>][<parameter ...>]...`
 *   `][<path>...][</path>][ ]`  — bracket-wrapped path/antml tags
 * These appear as bracket-delimited tags without proper angle-bracket pairing.
 */
const BRACKET_FUNCTION_CALLS_RE = /(?:\(tool call\s*)?<function_calls>[\s\S]*?<\/function_calls>(?:\))?/gi
const BRACKET_FUNCTION_CALLS_UNCLOSED_RE = /(?:\(tool call\s*)?<function_calls>[\s\S]*$/gi
const BRACKET_INVOKE_BLOCK_RE = /\[<invoke\s+name="[^"]*">\][\s\S]*?\[<\/invoke>\]/gi
const BRACKET_INVOKE_UNCLOSED_RE = /\[<invoke\s+name="[^"]*">\][\s\S]*$/gi
const BRACKET_PARAMETER_BLOCK_RE = /\[<parameter\s+name="[^"]*">[\s\S]*?\]\s*/gi
/**
 * Bracket-wrapped antml tag leaks. MiniMax emits these in several variants:
 *   `][/path/to/file][</path>][ ]`           — raw content between ][ and [</tag>]
 *   `][<path>/path/to/file][</path>][ ]`     — with opening <path> tag
 *   `][content here][</content>][ ]`         — other tag types
 *   `[<invoke name="bash">][cmd][ ][ ]`      — invoke with bracketed args
 *
 * Common pattern: content enclosed by brackets with an XML closing tag at end.
 */
const BRACKET_ANTML_TAGS = ['path', 'invoke', 'parameter', 'function_calls', 'command', 'content', 'antml:invoke', 'antml:parameter'] as const
/** Match: `][` + any content + `[</tag>][ ]` (the closing bracket-tag pair) */
const BRACKET_ANTML_PAIRED_RE = new RegExp(
  `\\]\\[[\\s\\S]*?\\[<\\/(?:${BRACKET_ANTML_TAGS.join('|')})>\\]\\s*`,
  'gi',
)
/** Match: `[<tag>...content...][</tag>][ ]` (with opening tag) */
const BRACKET_ANTML_OPEN_RE = new RegExp(
  `\\[<(?:${BRACKET_ANTML_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?\\[<\\/(?:${BRACKET_ANTML_TAGS.join('|')})>\\]\\s*`,
  'gi',
)
/** Unclosed variant: `][<tag>content` at end of stream (no closing tag yet).
 *  Only matches when there's an actual opening XML tag after ][ */
const BRACKET_ANTML_UNCLOSED_RE = new RegExp(
  `\\]\\[<(?:${BRACKET_ANTML_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*$`,
  'gi',
)
/** Closing tag only: `[</path>][ ]` left orphaned after content was stripped */
const BRACKET_CLOSE_RE = /\[<\/(?:invoke|parameter|function_calls|path|command|content|antml:invoke|antml:parameter)>\]\s*/gi
/** Stray empty bracket markers: [ ][ ] at end of tool-call blocks */
const STRAY_BRACKET_SPACES_RE = /\[\s*\]\s*/g
/**
 * Stray bracket delimiters left after stripping tool-call fragments.
 * MiniMax M3 emits `][` as an empty delimiter between stripped content blocks.
 * Since this only runs when HAS_MARKER_RE matched (confirming tool-call
 * leakage), any remaining `][` is a stray fragment.
 * Exception: skip `][` between alphanumeric chars (e.g. arr[0][1]).
 */
const STRAY_BRACKET_PAIR_RE = /(?<![a-zA-Z0-9])\]\[\/?\s*/g
/**
 * MiniMax `]`-delimited command leak. After other markers are stripped,
 * bare shell commands wrapped in standalone `]` delimiters remain:
 *   `] ls -la && echo "test" ]`
 *   `] python script.py ]`
 * Match `]` at line start + shell command + trailing `]`.
 */
const BRACKET_COMMAND_LEAK_RE = /^\]\s+.+?\s+\]$/gm
/** Leaked (tool call) or (tool call ) markers — with or without trailing space */
const LEAKED_TOOL_CALL_RE = /\(\s*tool\s*call\s*\)\s*/gi
/**
 * Anthropic-style leak: `(to name="bash">][command][</command>][ ]`
 * The `(to ` prefix is a truncated `(tool call)` that MiniMax sometimes emits
 * before bracket-wrapped tags. Match `(to ` + optional name attr + `>]` + any
 * content + closing bracket-tag.
 */
const ANTHROPIC_TO_LEAK_RE = /\(\s*to\s+name="[^"]*">\][\s\S]*?\[<\/(?:command|parameter|invoke|path|content)>\]\s*/gi
const ANTHROPIC_TO_UNCLOSED_RE = /\(\s*to\s+name="[^"]*">\][\s\S]*$/gi

/**
 * Prose-style leak: `(tool call [Tool call: write] {...})`. Requires the
 * literal `Tool call:` discriminator so we don't match arbitrary parenthetical
 * prose. Non-greedy, stops at the matching closing paren on the same logical
 * block.
 */
const PROSE_TOOL_CALL_RE = /\(tool call\s*\[Tool call:[^\]]*\][\s\S]*?\)\s*/gi

/** Fast-path test: any tool-call marker present at all? */
const HAS_MARKER_RE = /<\]minimax\[>|<\/?(?:invoke|command|parameter|tool_call|function_calls|action)\b|\(\s*(?:tool\s*call|to\s+name=)|<function_calls>|\[<(?:invoke|parameter|function_calls|path|command|content)|\]\[|\[<\/(?:path|invoke|parameter|command|content|function_calls|antml|action)|^\]|(?<=\n)\]/i

/**
 * Remove inline tool/function-call markers and their inner content from `text`.
 *
 * Returns the cleaned text. When every character was a marker (the model only
 * emitted a tool-call block inline), returns an empty string so callers can
 * skip emitting an empty delta.
 */
export function stripInlineToolCallMarkers(text: string): string {
  if (!text) return text
  if (!HAS_MARKER_RE.test(text)) return text
  let out = text.replace(MINIMAX_DELIMITER_RE, '')
  // Angle-bracket paired tags
  out = out.replace(PAIRED_INVOKE_RE, '')
  out = out.replace(UNCLOSED_INVOKE_RE, '')
  out = out.replace(ORPHANED_INVOKE_CLOSE_RE, '')
  // Bracket-style XML tags (function_calls format)
  out = out.replace(BRACKET_FUNCTION_CALLS_RE, '')
  out = out.replace(BRACKET_FUNCTION_CALLS_UNCLOSED_RE, '')
  out = out.replace(BRACKET_INVOKE_BLOCK_RE, '')
  out = out.replace(BRACKET_INVOKE_UNCLOSED_RE, '')
  out = out.replace(BRACKET_PARAMETER_BLOCK_RE, '')
  // Bracket-wrapped antml tags: ][/path...][</path>][ ] or ][<path>...][</path>][ ]
  out = out.replace(BRACKET_ANTML_PAIRED_RE, '')
  out = out.replace(BRACKET_ANTML_OPEN_RE, '')
  out = out.replace(BRACKET_ANTML_UNCLOSED_RE, '')
  out = out.replace(BRACKET_CLOSE_RE, '')
  // Stray empty bracket markers left after stripping
  out = out.replace(STRAY_BRACKET_SPACES_RE, '')
  // Stray bracket delimiters: ][ (orphaned tool-call fragment)
  out = out.replace(STRAY_BRACKET_PAIR_RE, ' ')
  // Bracket-delimited command leaks: ] command ]
  out = out.replace(BRACKET_COMMAND_LEAK_RE, '')
  // Anthropic-style (to name="..."> leaks
  out = out.replace(ANTHROPIC_TO_LEAK_RE, '')
  out = out.replace(ANTHROPIC_TO_UNCLOSED_RE, '')
  // Prose-style and empty markers
  out = out.replace(PROSE_TOOL_CALL_RE, '')
  out = out.replace(LEAKED_TOOL_CALL_RE, '')
  return out
}
