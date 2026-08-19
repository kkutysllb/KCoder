/**
 * MCP 服务器配置存储：`$DSH_HOME/profiles/web/cordis.patch.yml` 里
 * `@deepseek-ai/dsh-mcp-client` 实例条目的 CRUD。
 *
 * 每个 MCP 服务器 = patch 层一个 `- insert: [<entry>]` 项（loader 的
 * applyEntryPatches：insert 无 id = 顶层追加；直写条目会被报
 * `entry not found` 跳过）。启停 = 条目 `disabled` 字段（cordis entry
 * 标准字段，true 时插件树不加载该实例）。
 *
 * 保真策略：yaml Document API 只增删改匹配节点，文件其余内容——
 * compaction 禁用行等其他 patch、用户注释、原始格式——原样保留。
 * 解析失败的文件绝不能写回（保存返回 ok:false，等用户修好手编内容）。
 *
 * 保存后上游 watchUserPatches（app-boot）经 Cordis HMR 事务性重组
 * 插件树：mcp-client 断开重连，无需重启引擎。
 *
 * @module desktop/main/mcp-store
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Document, YAMLMap, YAMLSeq, parseDocument } from 'yaml'
import { WEB_PROFILE, dshHome } from './dsh-contract'

/** MCP 服务器条目（cordis.patch.yml 里一个 mcp-client 实例的视图形状）。 */
export interface McpServerEntry {
  /** patch 条目 id（GUI 管理的实例约定 `mcp-<serverName>`）。 */
  id: string
  /** 工具 namespace（模型侧工具名 mcp__<serverName>__*；[A-Za-z0-9_-]{1,32}）。 */
  serverName: string
  /** 传输方式（上游 mcp-client 支持的两种）。 */
  transport: 'stdio' | 'streamable-http'
  /** 启用（false 时条目序列化为 disabled: true，插件树不加载）。 */
  enabled: boolean
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  headers: Record<string, string>
  /** 工具调用超时毫秒（null = 上游默认 60000）。 */
  toolCallTimeoutMs: number | null
}

/** MCP 服务器写操作结果（校验失败/文件不可写时 ok:false + error 文案）。 */
export interface McpWriteResult {
  ok: boolean
  error: string | null
}

/** MCP 客户端桥接插件（宿主 peer，实体随发行版分发，无需安装）。 */
const MCP_PLUGIN = '@deepseek-ai/dsh-mcp-client'

/** serverName 约束（上游 mcp-client 契约；同时是工具名 namespace）。 */
const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/

function patchPath(): string {
  return join(dshHome(), 'profiles', WEB_PROFILE, 'cordis.patch.yml')
}

/** 读入并解析 patch 文档；文件不存在/空内容返回空文档，坏 YAML 返回 null。 */
function readDoc(): Document | null {
  const file = patchPath()
  if (!existsSync(file)) return new Document([])
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  if (text.trim() === '') return new Document([])
  const doc = parseDocument(text)
  if (doc.errors.length > 0) return null
  if (doc.contents === null) return new Document([])
  if (!(doc.contents instanceof YAMLSeq)) return null
  return doc
}

/** 写回（不折叠长行：URL/命令行完整可读）。 */
function writeDoc(doc: Document): void {
  writeFileSync(patchPath(), doc.toString({ lineWidth: 0 }), 'utf8')
}

/* ---- 读取端小工具（YAMLMap → 安全标量）---- */

function mapOf(node: unknown): YAMLMap | null {
  return node instanceof YAMLMap ? node : null
}

function strOf(m: YAMLMap, key: string): string {
  const v = m.get(key)
  return typeof v === 'string' ? v : ''
}

function recOf(m: YAMLMap, key: string): Record<string, string> {
  const out: Record<string, string> = {}
  const v = m.get(key)
  if (v instanceof YAMLMap) {
    for (const pair of v.items) {
      const k = String(pair.key ?? '')
      if (k !== '') out[k] = String(pair.value ?? '')
    }
  }
  return out
}

function arrOf(m: YAMLMap, key: string): string[] {
  const v = m.get(key)
  return v instanceof YAMLSeq ? v.items.map((i) => String(i ?? '')) : []
}

/** YAMLMap 条目 → 契约形状（缺字段给中性默认，绝不抛）。 */
function entryFromNode(node: YAMLMap): McpServerEntry {
  const config = mapOf(node.get('config')) ?? new YAMLMap()
  const transport = strOf(config, 'transport')
  const timeout = config.get('toolCallTimeoutMs')
  return {
    id: strOf(node, 'id'),
    serverName: strOf(config, 'serverName'),
    transport: transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    enabled: node.get('disabled') !== true,
    command: strOf(config, 'command'),
    args: arrOf(config, 'args'),
    env: recOf(config, 'env'),
    cwd: strOf(config, 'cwd'),
    url: strOf(config, 'url'),
    headers: recOf(config, 'headers'),
    toolCallTimeoutMs: typeof timeout === 'number' ? timeout : null,
  }
}

/** 定位 insert 数组里的 mcp-client 条目（match 谓词作用于条目 YAMLMap）。 */
interface Located {
  patch: YAMLMap
  insert: YAMLSeq
  idx: number
}

function locate(doc: Document, match: (entry: YAMLMap) => boolean): Located | null {
  const top = doc.contents
  if (!(top instanceof YAMLSeq)) return null
  for (const patch of top.items) {
    const pm = mapOf(patch)
    if (pm === null) continue
    const insert = pm.get('insert')
    if (!(insert instanceof YAMLSeq)) continue
    for (let i = 0; i < insert.items.length; i++) {
      const e = mapOf(insert.items[i])
      if (e !== null && e.get('name') === MCP_PLUGIN && match(e)) {
        return { patch: pm, insert, idx: i }
      }
    }
  }
  return null
}

/** 全部 mcp-client 条目（文件缺失/坏 YAML 返回空数组——保存时会给出具体错误）。 */
export function mcpServers(): McpServerEntry[] {
  const doc = readDoc()
  if (doc === null) return []
  const out: McpServerEntry[] = []
  const top = doc.contents
  if (!(top instanceof YAMLSeq)) return out
  for (const patch of top.items) {
    const insert = mapOf(patch)?.get('insert')
    if (!(insert instanceof YAMLSeq)) continue
    for (const item of insert.items) {
      const e = mapOf(item)
      if (e !== null && e.get('name') === MCP_PLUGIN) out.push(entryFromNode(e))
    }
  }
  return out
}

// 空内容时 readDoc 已返回空文档，非 null 即顶层 seq（save/delete 的追加
// 路径据此收窄 doc.contents）。

/** GUI 写入形态的纯对象（空集合字段省略，保持 patch 文件干净）。 */
function plainEntry(e: McpServerEntry): Record<string, unknown> {
  const config: Record<string, unknown> = { serverName: e.serverName, transport: e.transport }
  if (e.transport === 'stdio') {
    config.command = e.command
    if (e.args.length > 0) config.args = e.args
    if (Object.keys(e.env).length > 0) config.env = e.env
    if (e.cwd !== '') config.cwd = e.cwd
  } else {
    config.url = e.url
    if (Object.keys(e.headers).length > 0) config.headers = e.headers
  }
  if (e.toolCallTimeoutMs !== null) config.toolCallTimeoutMs = e.toolCallTimeoutMs
  const out: Record<string, unknown> = { id: e.id, name: MCP_PLUGIN }
  if (!e.enabled) out.disabled = true
  out.config = config
  return out
}

/** 通用写前校验（transport 必填字段 + 唯一性）；返回错误文案或 null。 */
function validate(e: McpServerEntry): string | null {
  if (!SERVER_NAME_RE.test(e.serverName)) {
    return `名称仅限 1-32 位字母/数字/下划线/连字符：${e.serverName === '' ? '（空）' : e.serverName}`
  }
  if (e.transport === 'stdio' && e.command === '') return 'stdio 传输必须填写命令'
  if (e.transport === 'streamable-http' && e.url === '') return 'HTTP 传输必须填写 URL'
  if (e.transport === 'streamable-http' && !/^https?:\/\//.test(e.url)) return 'URL 必须以 http:// 或 https:// 开头'
  return null
}

/**
 * 新增/改写一个 MCP 服务器（按 serverName 定位既有条目就地改写，
 * 否则追加 `- insert: [<entry>]` patch 项）。
 */
export function mcpServerSave(entry: McpServerEntry): McpWriteResult {
  const id = entry.id !== '' ? entry.id : `mcp-${entry.serverName}`
  const e: McpServerEntry = { ...entry, id }
  const invalid = validate(e)
  if (invalid !== null) return { ok: false, error: invalid }
  const doc = readDoc()
  if (doc === null) {
    return { ok: false, error: 'cordis.patch.yml 不存在或无法解析（手编内容有误时请先修复，未做任何写回）' }
  }
  // 唯一性：serverName（工具 namespace，上游在存活实例中要求唯一）与
  // id（patch 树键）都不允许指向别的条目
  const clash = locate(doc, (n) => {
    const other = entryFromNode(n)
    return other.id === e.id || other.serverName === e.serverName
  })
  if (clash !== null) {
    const other = entryFromNode(clash.insert.items[clash.idx] as YAMLMap)
    const isSelf = other.id === e.id && other.serverName === e.serverName
    if (!isSelf) {
      const what = other.serverName === e.serverName ? `名称 ${e.serverName}` : `id ${e.id}`
      return { ok: false, error: `${what} 已被其他 MCP 服务器占用` }
    }
  }
  const node = doc.createNode(plainEntry(e))
  if (clash !== null) {
    // 就地改写（条目级注释会被替换——GUI 管理的条目无条目级注释）
    clash.insert.items[clash.idx] = node
  } else {
    const top = doc.contents
    if (!(top instanceof YAMLSeq)) {
      // readDoc 保证非 null 即顶层 seq；此分支仅类型收窄
      return { ok: false, error: 'patch 文件顶层不是数组（手编内容有误）' }
    }
    const item = doc.createNode({ insert: [plainEntry(e)] })
    top.add(item)
  }
  try {
    writeDoc(doc)
  } catch (error) {
    return { ok: false, error: `写入失败：${String(error)}` }
  }
  return { ok: true, error: null }
}

/** 删除一个 MCP 服务器（按 id；条目摘除后 insert 数组空则删整个 patch 项）。 */
export function mcpServerDelete(id: string): McpWriteResult {
  const doc = readDoc()
  if (doc === null) {
    return { ok: false, error: 'cordis.patch.yml 不存在或无法解析（未做任何写回）' }
  }
  const located = locate(doc, (n) => strOf(n, 'id') === id)
  if (located !== null) {
    located.insert.items.splice(located.idx, 1)
    if (located.insert.items.length === 0) {
      // insert 空了：摘掉整个 patch 项（留空 insert 会得到一条无害但
      // 无意义的 patch 项，徒增文件噪音）
      const top = doc.contents as YAMLSeq
      const i = top.items.indexOf(located.patch)
      if (i >= 0) top.items.splice(i, 1)
    }
    try {
      writeDoc(doc)
    } catch (error) {
      return { ok: false, error: `写入失败：${String(error)}` }
    }
  }
  return { ok: true, error: null }
}
