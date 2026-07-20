/**
 * Qiongqi coding preset — public surface.
 *
 * This preset demonstrates how to specialise the domain-neutral Qiongqi
 * runtime into a software-engineering agent without forking the engine.
 * It injects a coding-focused system prompt, coding-specific pinned
 * constraints, and a display name, then delegates to the core
 * `createQiongqiServeRuntime`.
 *
 * Usage:
 * ```ts
 * import { createCodingAgent } from '@qiongqi/preset-coding'
 *
 * const runtime = await createCodingAgent({
 *   host: '127.0.0.1',
 *   port: 8899,
 *   dataDir: '~/.qiongqi/data',
 *   runtimeToken: process.env.QIONGQI_TOKEN!,
 *   apiKey: process.env.DEEPSEEK_API_KEY!,
 *   baseUrl: 'https://api.deepseek.com',
 *   model: 'deepseek-chat',
 *   approvalPolicy: 'on-request',
 *   sandboxMode: 'workspace',
 *   tokenEconomyMode: true,
 *   insecure: false
 * })
 * ```
 *
 * To mount the reference coding skills (planning, tdd, code-review, ...),
 * pass them via `capabilities.skills.roots` pointing at a skill bundle.
 */
import {
  createQiongqiServeRuntime,
  type QiongqiServeRuntimeOptions
} from '@qiongqi/http'
import { CODING_SYSTEM_PROMPT } from './coding-system-prompt.js'

/**
 * Options for the coding preset.
 *
 * Mirrors `QiongqiServeRuntimeOptions` but makes `systemPrompt`,
 * `agentName`, and `pinnedConstraints` overridable while still
 * defaulting to coding-preset values.
 */
export type CodingPresetOptions = Omit<
  QiongqiServeRuntimeOptions,
  'systemPrompt' | 'agentName' | 'pinnedConstraints'
> & {
  /**
   * Override the coding system prompt entirely. When omitted, the
   * preset uses {@link CODING_SYSTEM_PROMPT}.
   */
  systemPrompt?: string
  /**
   * Override the display name. Defaults to `'Qiongqi Coding'`.
   */
  agentName?: string
  /**
   * Override the pinned constraints. When omitted, the preset uses
   * coding-specific defaults that keep the stable prefix
   * byte-stable and enforce honest verification claims.
   */
  pinnedConstraints?: string[]
}

/**
 * Default pinned constraints for the coding preset.
 */
export const CODING_PINNED_CONSTRAINTS: readonly string[] = [
  'system: preserve user intent across compaction',
  'system: keep the HTTP/SSE contract stable for clients',
  'system: keep the stable coding-preset prefix byte-stable for prompt-cache reuse',
  'system: never claim a change is verified without running the relevant tests or build'
] as const

/**
 * Assemble a Qiongqi runtime configured as a coding agent.
 *
 * This is a thin specialisation layer: it fills in coding-preset
 * defaults for `systemPrompt`, `agentName`, and `pinnedConstraints`,
 * then delegates to {@link createQiongqiServeRuntime}. Every other
 * option (model, storage, capabilities, approval policy, ...) is
 * forwarded unchanged.
 */
export async function createCodingAgent(
  options: CodingPresetOptions
): ReturnType<typeof createQiongqiServeRuntime> {
  return createQiongqiServeRuntime({
    ...options,
    agentName: options.agentName ?? 'Qiongqi Coding',
    systemPrompt: options.systemPrompt ?? CODING_SYSTEM_PROMPT,
    pinnedConstraints: options.pinnedConstraints ?? [...CODING_PINNED_CONSTRAINTS]
  })
}

export { CODING_SYSTEM_PROMPT } from './coding-system-prompt.js'
