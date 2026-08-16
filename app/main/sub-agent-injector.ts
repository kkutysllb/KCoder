/**
 * sub-agent-injector.ts — 把 KCoder sub_agents.json 注入 QiLin config.yaml.
 *
 * 数据流：
 *   Settings > Sub-agents 保存 → sub_agents.json → [本模块] → config.yaml
 *                                                        ↓
 *                                          QiLin get_app_config() signature
 *                                          自动热重载（同 qilin-config-injector）
 *
 * 设计要点：
 *   1. 只覆盖 config.yaml 的 `subagents.custom_agents:` 子段，保留
 *      `subagents.timeout_seconds` / `max_turns` 等同级字段（见
 *      replaceCustomAgentsSection 的三情况处理）
 *   2. 无 sub_agents.json（ENOENT）时跳过（首次运行未创建过 sub-agent）
 *   3. sub_agents.json 存在但为空数组时写入 `custom_agents: {}`（支持
 *      用户删除全部 sub-agent 后清空 config）
 *   4. 字段映射（sub_agents.json → config.yaml custom_agents.<id>）：
 *        id          → YAML key
 *        description → description（CustomSubagentConfig 必填）
 *        content     → system_prompt（必填，sub-agent 的系统提示词）
 *        inheritMode="default" → 省略 tools（CustomSubagentConfig 默认 None = 继承全部工具）
 *        inheritMode="custom"  → tools: [白名单数组]
 *   5. 原子写入（同 qilin-config-injector：同目录 tmp + rename）
 *
 * QiLin 消费链路（零改动）：注入后 config.yaml 的 custom_agents 由
 * `load_subagents_config_from_dict`（config/subagents_config.py:259）加载到
 * `_subagents_config.custom_agents`，task_tool 的 get_subagent_config 按 name
 * 查找，agent 通过 delegate_task(subagent_type="<id>") 调用。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { resolveConfigYamlPath, atomicWrite } from './qilin-config-injector'

/** sub_agents.json 单条记录（仅声明本模块用到的字段）。 */
export interface SubAgentEntry {
  id: string
  description?: string
  content?: string
  tools?: string[]
  inheritMode?: 'default' | 'custom'
}

/** sub_agents.json 全局参数段。 */
export interface SubAgentSettings {
  timeout_seconds?: number
  max_turns?: number | null
  max_total_per_run?: number
}

/** sub_agents.json 完整存储格式。 */
export interface SubAgentsStore {
  settings?: SubAgentSettings
  agents?: SubAgentEntry[]
  // 兼容旧 key
  subAgents?: SubAgentEntry[]
}

/**
 * 把全局参数翻译成 YAML 行（2 空格缩进，subagents 段同级字段）。
 */
function settingsToYamlLines(settings: SubAgentSettings): string[] {
  const lines: string[] = []
  if (settings.timeout_seconds != null) {
    lines.push(`  timeout_seconds: ${settings.timeout_seconds}`)
  }
  if (settings.max_turns != null) {
    lines.push(`  max_turns: ${settings.max_turns}`)
  }
  if (settings.max_total_per_run != null) {
    lines.push(`  max_total_per_run: ${settings.max_total_per_run}`)
  }
  return lines
}

/**
 * 把单个 sub-agent 翻译成 YAML custom_agents 条目。
 *
 * 输出形如（4 空格缩进 agent id，6 空格缩进字段）：
 *   ```
 *   nova:
 *         description: "代码探索者"
 *         system_prompt: "..."
 *         timeout_seconds: 900
 *         max_turns: 50
 *   ```
 * JSON.stringify 产出的是合法 YAML 1.2 子集，PyYAML safe_load 可直接解析。
 *
 * 关键：CustomSubagentConfig 自带 timeout_seconds=900 / max_turns=50 默认值，
 * 但全局 subagents.timeout_seconds / max_turns 只对内置子代理生效（见
 * registry.py:83-99 的注释）。因此必须把全局参数显式写入每个 custom
 * agent 的 YAML 条目，才能让用户的配置真正生效。
 */
function subAgentToYamlEntry(agent: SubAgentEntry, settings?: SubAgentSettings): string {
  const lines: string[] = [`    ${agent.id}:`]
  const push = (key: string, value: unknown): void => {
    lines.push(`      ${key}: ${JSON.stringify(value)}`)
  }

  // CustomSubagentConfig.description / system_prompt 必填，空串兜底
  push('description', agent.description ?? '')
  push('system_prompt', agent.content ?? '')

  // inheritMode="custom" 才输出 tools 白名单；"default" 省略 → 继承全部工具
  if (agent.inheritMode === 'custom') {
    push('tools', agent.tools ?? [])
  }

  // 全局参数注入：使全局 timeout_seconds / max_turns 对 custom agents 生效。
 // registry.py 明确不会用全局值覆盖 custom agent 自身的值，所以必须显式写入。
  if (settings) {
    if (settings.timeout_seconds != null) {
      push('timeout_seconds', settings.timeout_seconds)
    }
    if (settings.max_turns != null) {
      push('max_turns', settings.max_turns)
    }
  }

  return lines.join('\n')
}

/**
 * 用新的块替换 config.yaml 中整个 `subagents:` 段的内容。
 *
 * newBlock 包含全局参数行（如 `  timeout_seconds: 1800`）和
 * `  custom_agents:` 子段，统一覆盖原 subagents 段的全部内容。
 *
 * 两种情况：
 *   1. 无 `subagents:` 顶层段 → 追加 `subagents:\n<newBlock>`
 *   2. 有 `subagents:` 段 → 替换其全部内容（保留后续顶层段不变）
 */
function replaceCustomAgentsSection(original: string, newBlock: string): string {
  const lines = original.split('\n')

  // 1. 定位 `subagents:` 顶层 key
  let subStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^subagents:\s*$/.test(lines[i])) {
      subStart = i
      break
    }
  }

  // 情况 1：无 subagents 段 → 追加到文件末尾
  if (subStart === -1) {
    const trimmed = original.replace(/\s+$/, '')
    return `${trimmed}\n\nsubagents:\n${newBlock}\n`
  }

  // 2. 定位 subagents 段结束（下一个列 0 字母或 EOF）
  let subEnd = lines.length
  for (let i = subStart + 1; i < lines.length; i++) {
    if (/^[a-zA-Z]/.test(lines[i])) {
      subEnd = i
      break
    }
  }

  // 情况 2：替换 subagents 段的全部内容（`subagents:` 行保留，后续全部用 newBlock 覆盖）
  const before = lines.slice(0, subStart + 1).join('\n') // 包含 `subagents:` 行
  const after = lines.slice(subEnd)
  const parts: string[] = [before, newBlock]
  if (after.length > 0) {
    const afterText = after.join('\n').replace(/^\s+$/, '')
    if (afterText.trim()) parts.push(afterText)
  }
  return `${parts.join('\n')}\n`
}

/**
 * 读 `<dataDir>/kcoder_local/sub_agents.json`（v0.1 仓库内）或
 * `<dataDir>/product/kcoder_local/sub_agents.json`（v0.2 数据根），
 * 转换为 custom_agents YAML，注入 config.yaml 的 `subagents.custom_agents:` 子段。
 *
 * 路径解析优先 v0.2 位置（统一数据根的 product/）；不存在时回退 v0.1 位置。
 *
 * - 文件不存在（ENOENT）→ 静默跳过（保留 config.yaml 原状，首次运行场景）
 * - 文件存在但为空数组 → 写入 `custom_agents: {}`（清空残留，支持删除场景）
 * - 有有效条目 → 按字段映射生成 YAML，原子写入
 *
 * 触发时机（见 plan C2）：
 *   1. 引擎启动后（engine-host.ts 调 syncSubAgents）
 *   2. SubAgentsSettings 保存成功后（renderer 经 IPC 触发）
 */
export async function syncSubAgents(dataDir: string): Promise<void> {
  // v0.2: <dataDir>/product/kcoder_local/sub_agents.json
  // v0.1 回退：<dataDir>/kcoder_local/sub_agents.json
  const v02Path = join(dataDir, 'product', 'kcoder_local', 'sub_agents.json')
  const v01Path = join(dataDir, 'kcoder_local', 'sub_agents.json')
  const jsonPath = existsSync(v02Path) ? v02Path : v01Path
  let raw: string
  try {
    raw = await readFile(jsonPath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  // sub_agents.json 格式：{ settings: {...}, agents: [...] }
  // 兼容旧格式：裸数组、{ subAgents: [...] }
  let settings: SubAgentSettings | undefined
  let agents: SubAgentEntry[]
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    agents = parsed
  } else if (parsed && typeof parsed === 'object') {
    const store = parsed as SubAgentsStore
    settings = store.settings
    agents = store.agents ?? store.subAgents ?? []
  } else {
    agents = []
  }

  // 过滤无效条目：必须有 id 和 content（system_prompt 必填）
  const valid = agents.filter((a) => a && a.id && a.content)

  // 构建 subagents 段：全局参数行 + custom_agents 子段
  const settingsLines = settings ? settingsToYamlLines(settings) : []
  const customAgentsBlock = valid.length > 0
    ? `  custom_agents:\n${valid.map((a) => subAgentToYamlEntry(a, settings)).join('\n')}`
    : `  custom_agents: {}`
  const fullBlock = [...settingsLines, customAgentsBlock].join('\n')

  const configPath = resolveConfigYamlPath()
  const original = await readFile(configPath, 'utf8')
  const updated = replaceCustomAgentsSection(original, fullBlock)
  await atomicWrite(configPath, updated)
}

// ============ sub_agents.json CRUD（renderer 经 IPC 调用） ============

/** sub_agents.json 存储路径（v0.2 数据根优先，v0.1 回退）。 */
export function subAgentsJsonPath(dataDir: string): string {
  return join(dataDir, 'product', 'kcoder_local', 'sub_agents.json')
}

/** 读取完整 store；文件不存在返回空 store，兼容旧格式（裸数组 / {subAgents}）。 */
export async function readSubAgentsStore(dataDir: string): Promise<SubAgentsStore> {
  const v02 = subAgentsJsonPath(dataDir)
  const v01 = join(dataDir, 'kcoder_local', 'sub_agents.json')
  const jsonPath = existsSync(v02) ? v02 : v01
  try {
    const raw = await readFile(jsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { settings: {}, agents: parsed as SubAgentEntry[] }
    }
    if (parsed && typeof parsed === 'object') {
      const store = parsed as SubAgentsStore
      return { settings: store.settings ?? {}, agents: store.agents ?? store.subAgents ?? [] }
    }
    return { settings: {}, agents: [] }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: {}, agents: [] }
    }
    throw err
  }
}

/** 原子写 store（v0.2 路径；mkdir -p）。 */
export async function writeSubAgentsStore(dataDir: string, store: SubAgentsStore): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const path = subAgentsJsonPath(dataDir)
  await mkdir(dirname(path), { recursive: true })
  await atomicWrite(path, JSON.stringify({ settings: store.settings ?? {}, agents: store.agents ?? [] }, null, 2))
}

/** 读取 store 的 JSON 版本（返回给 renderer 展示用，字段与原 SubAgentEntry 兼容）。 */
export function storeToSubAgentEntries(store: SubAgentsStore): SubAgentEntry[] {
  return (store.agents ?? []).filter((a) => a && a.id)
}
