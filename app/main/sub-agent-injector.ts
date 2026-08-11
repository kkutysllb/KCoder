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
interface SubAgentEntry {
  id: string
  description?: string
  content?: string
  tools?: string[]
  inheritMode?: 'default' | 'custom'
}

/**
 * 把单个 sub-agent 翻译成 YAML custom_agents 条目。
 *
 * 输出形如（4 空格缩进 agent id，6 空格缩进字段）：
 *   ```
 *   code-reviewer:
 *         description: "代码审查专家"
 *         system_prompt: "你是一个代码审查员..."
 *         tools: ["read_file","grep"]
 *   ```
 * JSON.stringify 产出的是合法 YAML 1.2 子集，PyYAML safe_load 可直接解析。
 */
function subAgentToYamlEntry(agent: SubAgentEntry): string {
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

  return lines.join('\n')
}

/**
 * 用新的 custom_agents 块替换 config.yaml 中 `subagents.custom_agents:` 子段。
 *
 * 三种情况：
 *   1. 无 `subagents:` 顶层段 → 追加 `subagents:\n<newBlock>`
 *   2. 有 `subagents:` 无 `  custom_agents:` 子段 → 在 subagents 段末尾追加 newBlock
 *   3. 有 `  custom_agents:` 子段 → 替换该子段（保留 subagents 下其他同级字段）
 *
 * newBlock 形如：`"  custom_agents:\n    agent-id:\n      description: ..."`
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

  // 3. 在 subagents 段内定位 `  custom_agents:` 子段（恰好 2 空格缩进）
  let caStart = -1
  for (let i = subStart + 1; i < subEnd; i++) {
    if (/^  custom_agents:\s*$/.test(lines[i])) {
      caStart = i
      break
    }
  }

  // 情况 2：有 subagents 段无 custom_agents 子段 → 在 subEnd 前追加
  if (caStart === -1) {
    const before = lines.slice(0, subEnd).join('\n').replace(/\s+$/, '')
    const after = lines.slice(subEnd).join('\n').replace(/^\s+/, '').replace(/\s+$/, '')
    const parts: string[] = [before, newBlock]
    if (after) parts.push(after)
    return `${parts.join('\n\n')}\n`
  }

  // 情况 3：定位 custom_agents 子段结束
  // 遇到下一个 2 空格同级 key（`  \S`）或 subagents 段结束
  let caEnd = subEnd
  for (let i = caStart + 1; i < subEnd; i++) {
    if (/^  \S/.test(lines[i])) {
      caEnd = i
      break
    }
  }

  const before = lines.slice(0, caStart).join('\n').replace(/\s+$/, '')
  const after = lines.slice(caEnd).join('\n').replace(/^\s+/, '').replace(/\s+$/, '')
  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(newBlock)
  if (after) parts.push(after)
  return `${parts.join('\n\n')}\n`
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

  // sub_agents.json 可能是数组（save_json 直存）或 {subAgents: [...]} 包装
  const parsed = JSON.parse(raw) as SubAgentEntry[] | { subAgents?: SubAgentEntry[] }
  const agents = Array.isArray(parsed) ? parsed : (parsed.subAgents ?? [])

  // 过滤无效条目：必须有 id 和 content（system_prompt 必填）
  const valid = agents.filter((a) => a && a.id && a.content)

  const block = valid.length > 0
    ? `  custom_agents:\n${valid.map(subAgentToYamlEntry).join('\n')}`
    : `  custom_agents: {}`

  const configPath = resolveConfigYamlPath()
  const original = await readFile(configPath, 'utf8')
  const updated = replaceCustomAgentsSection(original, block)
  await atomicWrite(configPath, updated)
}
