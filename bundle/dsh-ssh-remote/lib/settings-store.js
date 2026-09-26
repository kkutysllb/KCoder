// dsh-ssh-remote — 动态主机存储：原子写 + 导入解析（JSON / YAML 子集 / ssh_config）。
import * as path from 'node:path'
import * as fs from 'node:fs'
import { normalizeHost } from './hosts.js'

/** tmp+rename 原子写（对目录 watcher 友好）。 */
export function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 读动态主机文件；缺失/损坏返回 []。 */
export function readHostsFile(file) {
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function stripQuotes(v) {
  const t = v.trim()
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1)
  return t
}

/** stripQuotes + 非引号值剥行内注释（如 `port: 22 # 备注`）。 */
function cleanValue(v) {
  const t = stripQuotes(v)
  const raw = v.trim()
  if (raw.startsWith("'") || raw.startsWith('"')) return t
  return t.replace(/\s+#.*$/, '')
}

/** 极简 YAML 子集：仅支持「- key: value 顶层列表 + 一层缩进键值」。够 hosts 粘贴用。 */
function parseYamlSubset(text) {
  const items = []
  let cur = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line || /^\s*#/.test(line)) continue
    if (/^-\s+\S/.test(line)) {
      cur = {}
      items.push(cur)
      const kv = line.replace(/^-\s+/, '')
      const idx = kv.indexOf(':')
      if (idx > 0) cur[kv.slice(0, idx).trim()] = cleanValue(kv.slice(idx + 1))
      continue
    }
    if (/^\s+\S/.test(line) && cur) {
      const t = line.trim()
      const idx = t.indexOf(':')
      if (idx > 0) cur[t.slice(0, idx).trim()] = cleanValue(t.slice(idx + 1))
    }
  }
  return items
}

/** ssh_config 解析：Host 块（支持多别名与 `Key = value` 分隔）→ 主机条目；跳过通配；ProxyJump 别名转 jump 引用（大小写不敏感）。 */
function parseSshConfig(text) {
  const blocks = []
  let cur = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // 归一化 `Key = value` → `Key value`（OpenSSH 两种分隔都合法）
    const norm = line.replace(/^([A-Za-z][\w-]*)\s*=\s*/, '$1 ')
    const m = norm.match(/^(Host|HostName|User|Port|IdentityFile|ProxyJump)\s+(.+)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'host') {
      cur = { aliases: val.split(/\s+/).filter(Boolean) }
      blocks.push(cur)
    } else if (cur) {
      cur[key] = val
    }
  }
  const hosts = []
  const errors = []
  const aliases = new Set()
  for (const b of blocks) for (const a of b.aliases) if (!/[*?]/.test(a)) aliases.add(a.toLowerCase())
  const seenIds = new Set()
  for (const b of blocks) {
    for (const alias of b.aliases) {
      if (/[*?]/.test(alias)) continue
      const id = alias.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      if (seenIds.has(id)) continue
      seenIds.add(id)
      if (b.port && !/^\d+$/.test(String(b.port).trim())) errors.push('[' + id + '] Port 非数字: ' + b.port + '，已回退 22')
      const entry = {
        id,
        name: alias,
        host: b.hostname || alias,
        user: b.user || 'root',
        port: b.port && /^\d+$/.test(String(b.port).trim()) ? Number(b.port) : 22,
        identityFile: b.identityfile || '',
        jump: '',
      }
      if (b.proxyjump) {
        const jumpAlias = b.proxyjump.split('@').pop().split(':').shift()
        if (aliases.has(jumpAlias.toLowerCase())) entry.jump = jumpAlias.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
        else errors.push('[' + id + '] ProxyJump ' + jumpAlias + ' 未在导入内容中，已忽略')
      }
      if (!entry.identityFile) errors.push('[' + id + '] 缺 IdentityFile，导入后需补密钥路径')
      hosts.push(entry)
    }
  }
  return { raw: hosts, errors }
}

/**
 * 导入解析统一入口。
 * @returns {{hosts: object[], errors: string[]}} hosts 为「可入库的原始字段」（未 normalize，由保存时校验）。
 */
export function parseImport(text, format) {
  const errors = []
  let rawList = []
  try {
    if (format === 'json') {
      const data = JSON.parse(text)
      rawList = Array.isArray(data) ? data : (Array.isArray(data && data.hosts) ? data.hosts : [])
    } else if (format === 'yaml') {
      rawList = parseYamlSubset(text)
    } else if (format === 'sshconfig') {
      const r = parseSshConfig(text)
      rawList = r.raw
      errors.push(...r.errors)
    } else {
      return { hosts: [], errors: ['未知格式: ' + format] }
    }
  } catch (err) {
    return { hosts: [], errors: ['解析失败: ' + (err && err.message)] }
  }
  const hosts = []
  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue
    const n = normalizeHost({ ...raw })
    if (n) hosts.push({ ...n, source: undefined })
    else errors.push('条目非法（id/host/identityFile 缺失或 id 非 [a-z0-9_-]）: ' + JSON.stringify(raw).slice(0, 120))
  }
  return { hosts, errors }
}
