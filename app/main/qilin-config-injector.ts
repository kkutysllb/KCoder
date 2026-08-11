/**
 * qilin-config-injector.ts — 把 KCoder model profiles 注入 QiLin config.yaml.
 *
 * 数据流：
 *   Settings 保存 → user-data.json → [本模块] → config.yaml models 段
 *                                              ↓
 *                                    QiLin get_app_config() signature 自动热重载
 *                                    （vendor/qilin/.../app_config.py:650）
 *
 * 设计要点：
 *   1. 只覆盖 config.yaml 的 `models:` 段，其余段（sandbox/database/...）原样保留
 *   2. 无 profile 时跳过（保留占位 model，避免引擎报 "No chat models configured"）
 *   3. active profile 放 models[0]（_resolve_model_name 默认取 models[0]）
 *   4. YAML 值用 JSON.stringify 序列化（JSON 是 YAML 1.2 子集，PyYAML safe_load 支持）
 *   5. 原子写入（同目录 tmp + rename），避免引擎读到半写文件
 */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { FileUserDataStore, type UserModelProfileRecord } from './user-data-store'
import { resolveRuntimeDir } from './qilin-runtime-manager'

/**
 * 解析 config.yaml 路径。
 *
 * 优先级：
 *   1. process.env.QILIN_CONFIG_PATH（与 gateway 一致）
 *   2. <runtimeDir>/config.yaml（复用 runtime-manager 的 resolveRuntimeDir）
 */
export function resolveConfigYamlPath(): string {
  if (process.env.QILIN_CONFIG_PATH) return process.env.QILIN_CONFIG_PATH
  return join(resolveRuntimeDir(), 'config.yaml')
}

/**
 * 把单个 profile 翻译成 YAML models 列表项（不含 `models:` header，含 2 空格缩进）。
 *
 * 跳过缺 `use` 或 `providerModel` 的 profile（QiLin ModelConfig 要求两者必填）。
 * 返回 null 表示该 profile 不可用。
 */
function profileToYamlEntry(name: string, p: UserModelProfileRecord): string | null {
  // ModelConfig 必填字段：name + use + model
  if (!p.use || !p.providerModel) return null

  const lines: string[] = [`  - name: ${JSON.stringify(name)}`]
  const push = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return
    // JSON.stringify 产出的双引号字符串/数字/布尔/对象 都是合法 YAML
    lines.push(`    ${key}: ${JSON.stringify(value)}`)
  }

  push('display_name', p.displayName || name)
  push('description', `KCoder model profile: ${name}`)
  push('use', p.use)
  push('model', p.providerModel)
  push('api_key', p.apiKey)
  push('openai_api_base', p.baseUrl || undefined)
  push('supports_thinking', p.supportsThinking ?? false)
  push('supports_vision', p.supportsVision ?? false)
  push('supports_reasoning_effort', p.supportsReasoningEffort ?? false)
  push('when_thinking_enabled', p.whenThinkingEnabled)
  push('when_thinking_disabled', p.whenThinkingDisabled)
  push('use_responses_api', p.useResponsesApi)
  push('output_version', p.outputVersion)
  push('max_tokens', p.maxTokens)
  push('temperature', p.temperature)

  return lines.join('\n')
}

/**
 * 用新的 models 块替换 config.yaml 中的 `models:` 段。
 *
 * 段落边界规则：`models:` 行之后，遇到下一个顶层 key（列 0 起始字母）或 EOF
 * 即为段尾。中间的注释/空行被消耗进 models 段。
 */
function replaceModelsSection(original: string, newModelsBlock: string): string {
  const lines = original.split('\n')

  // 定位顶层 `models:` key
  let modelsStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^models:\s*$/.test(lines[i])) {
      modelsStart = i
      break
    }
  }

  if (modelsStart === -1) {
    // 无 models 段：追加到文件末尾
    const trimmed = original.replace(/\s+$/, '')
    return `${trimmed}\n\nmodels:\n${newModelsBlock}\n`
  }

  // 定位 models 段结束：下一个顶层 key（列 0 起始字母）或 EOF
  let modelsEnd = lines.length
  for (let i = modelsStart + 1; i < lines.length; i++) {
    if (/^[a-zA-Z]/.test(lines[i])) {
      modelsEnd = i
      break
    }
  }

  const before = lines.slice(0, modelsStart).join('\n').replace(/\s+$/, '')
  const after = lines.slice(modelsEnd).join('\n').replace(/^\s+/, '').replace(/\s+$/, '')

  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(`models:\n${newModelsBlock}`)
  if (after) parts.push(after)
  return `${parts.join('\n\n')}\n`
}

/**
 * 把一个用户的 model profiles 同步写入 config.yaml。
 *
 * - 无 profile 时跳过（保留占位）
 * - active profile 放 models[0]
 * - 缺 use/providerModel 的 profile 被跳过
 */
export async function syncEngineModels(dataDir: string, userId: string): Promise<void> {
  const store = new FileUserDataStore({ workspaceRoot: dataDir })
  const { activeModel, profiles } = await store.listModelProfiles(userId)

  const validNames = Object.entries(profiles)
    .filter(([, p]) => p.use && p.providerModel)
    .map(([name]) => name)

  if (validNames.length === 0) {
    // 无可用 profile — 保留 config.yaml 原状（占位 model 让引擎能启动）
    return
  }

  // active profile 排第一（确保 _resolve_model_name 默认取到它）
  const ordered = activeModel && validNames.includes(activeModel)
    ? [activeModel, ...validNames.filter((n) => n !== activeModel)]
    : validNames

  const entries = ordered
    .map((name) => profileToYamlEntry(name, profiles[name]))
    .filter((e): e is string => e !== null)

  if (entries.length === 0) return

  const configPath = resolveConfigYamlPath()
  const original = await readFile(configPath, 'utf8')
  const updated = replaceModelsSection(original, entries.join('\n'))
  await atomicWrite(configPath, updated)
}

/**
 * 尽力注入：读 user-data.json，取第一个有 profile 的用户调 syncEngineModels。
 *
 * 用于引擎启动时（userId 未知）的防御性注入。无 profile / 文件不存在时静默跳过。
 */
export async function syncEngineModelsBestEffort(dataDir: string): Promise<void> {
  // v0.2: user-data.json 在 <dataDir>/config/user-data.json（统一数据根）
  // 回退：<dataDir>/system/data/user-data.json（v0.1 兼容）
  const newPath = join(dataDir, 'config', 'user-data.json')
  const legacyPath = join(dataDir, 'system', 'data', 'user-data.json')
  const userDataPath = existsSync(newPath) ? newPath : (existsSync(legacyPath) ? legacyPath : newPath)
  let raw: string
  try {
    raw = await readFile(userDataPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  const snapshot = JSON.parse(raw) as {
    users?: Record<string, { modelProfiles?: Record<string, unknown> }>
  }
  const users = snapshot.users ?? {}
  for (const [uid, record] of Object.entries(users)) {
    if (record.modelProfiles && Object.keys(record.modelProfiles).length > 0) {
      await syncEngineModels(dataDir, uid)
      return
    }
  }
}

/** 原子写入：同目录 tmp + rename（避免跨文件系统 rename 失败）。 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, path)
}
