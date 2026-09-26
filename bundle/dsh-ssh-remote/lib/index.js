// dsh-ssh-remote — 宿主端入口：Config、装配、生命周期、系统提示、10 个 Agent 工具、回环 HTTP API。
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as cp from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CredentialStore, identityOf } from './credentials.js'
import { harnessHome } from './home.js'
import { HostRegistry, normalizeHost, assignMissingIds } from './hosts.js'
import { TargetStore } from './targets.js'
import { ConnectionManager } from './connection.js'
import { Runner } from './exec.js'
import { FsOps } from './fsops.js'
import { Transfer } from './transfer.js'
import { atomicWriteJson, readHostsFile, parseImport } from './settings-store.js'

export const name = 'ssh-remote'
// inject 声明的服务须全部可用插件才加载（cordis 语义）；webServer 由下方 HTTP API 段使用，目标宿主为 web profile。
export const inject = ['tools', 'webServer', 'systemPrompt']

export const Config = z.object({
  hosts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    host: z.string(),
    user: z.string().default('root'),
    port: z.number().default(22),
    identityFile: z.string(),
    jump: z.string().default(''),
    defaultCwd: z.string().default(''),
    connectTimeoutSec: z.number().default(15),
    controlPersistSec: z.number().default(600),
  })).default([]),
  commandTimeoutMs: z.number().default(60000),
  hostsFile: z.string().default(path.join(harnessHome(), 'ssh-remote', 'hosts.json')),
  // 密码登录的加密凭据库与「自管」主密钥文件（可挪到任意路径，如 U 盘/私有目录）。
  // 留空则与 hostsFile 同目录（credentials.enc / credentials.key / askpass.sh）。
  credentialsFile: z.string().default(''),
  credentialsKeyFile: z.string().default(''),
})

/** 生成 SSH_ASKPASS 包装脚本（0700）：带凭据库路径，供 ssh/scp 需要密码时回调。 */
function writeAskpassScript(dest, credsFile, keyFile) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const q = (v) => '"' + String(v).replace(/(["\\$`])/g, '\\$1') + '"'
  const body = '#!/bin/sh\nexec ' + q(process.execPath) + ' ' + q(path.join(here, 'askpass.js'))
    + ' --file ' + q(credsFile) + ' --key ' + q(keyFile) + ' "$@"\n'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, body, { mode: 0o700 })
  try { fs.chmodSync(dest, 0o700) } catch { /* 尽力而为 */ }
  return dest
}

const SYSTEM_PROMPT = [
  '<ssh_remote_guide>',
  '本机装有 SSH 远程工具插件（dsh-ssh-remote）：可在配置的远程 Linux 主机上执行命令、读写编辑文件、搜索、传输。',
  '工作流：',
  '1. 远程任务开始时先调 ssh_hosts 查看可用主机（id/名称/地址）。',
  '2. 远程命令用 ssh_run(hostId=..., command=...)（远端 bash 解释，带超时）；不要手工拼 ssh 命令行。',
  '3. 远程文件：ssh_read（带行号）/ ssh_write（全量覆写）/ ssh_edit（字面量替换，防冲突）。',
  '4. 远程定位：ssh_glob（find）/ ssh_grep（POSIX ERE 正则）。',
  '5. 传输：ssh_push / ssh_pull（recursive=true 走目录）。本地文件仍用本地工具。',
  '</ssh_remote_guide>',
].join('\n')

function fmtErr(err) {
  return { ok: false, error: { kind: err && err.kind ? err.kind : 'error', message: String((err && err.message) || err) } }
}

// —— 工具呈现（dsh 0.1.7 起：output.presentationMeta 投影值 → presentCall/presentResult 出卡片意图）——
// 纪律：纯函数、replay-safe、永不抛；字段缺失一律回退通用卡（present* 的返回不得依赖 execute 副作用）。
const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const hostOf = (a) => (a && a.hostId ? String(a.hostId) : '默认主机')
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v))
const textBlocks = (text) => [{ type: 'text', text: String(text) }]
const genericResult = (title, content) => ({ card: 'generic', ...(title ? { title } : {}), ...(content ? { content } : {}) })
const errorResult = (result) => {
  const m = isRecord(result && result.meta) ? result.meta : {}
  const message = String(m.error || '调用失败')
  return genericResult(message, textBlocks(message))
}
/** 传输类（push/pull）结果卡：非零退出码/超时以摘要后缀呈现。 */
const transferResult = (title, result) => {
  const m = isRecord(result && result.meta) ? result.meta : {}
  if (m.error) return errorResult(result)
  const suffix = typeof m.exitCode === 'number' && m.exitCode !== 0
    ? '（exit ' + m.exitCode + '）'
    : (m.timedOut ? '（超时）' : '')
  return genericResult(title + suffix)
}
/** 单文件改动的结果卡（整文件 diff：写入无前像，编辑是字面量替换）。 */
const diffResult = (filePath, oldText, newText, title) => ({
  card: 'diff',
  title,
  diffs: [{ path: String(filePath), oldText: oldText === undefined ? null : asText(oldText), newText: asText(newText ?? '') }],
  locations: [{ path: String(filePath) }],
})
/** `grep -rnE` 的 file:line:text 行 → 搜索卡的分组形状（首次出现顺序即文件顺序）。 */
const parseGrepMatches = (matches) => {
  const order = []
  const groups = new Map()
  for (const raw of Array.isArray(matches) ? matches : []) {
    const m = /^(.*?):(\d+):(.*)$/.exec(String(raw))
    const path = m ? m[1] : String(raw)
    if (!groups.has(path)) { groups.set(path, { path, matches: [] }); order.push(path) }
    groups.get(path).matches.push(m
      ? { lineNumber: Number(m[2]), line: m[3] }
      : { lineNumber: 0, line: '' })
  }
  return order.map(p => groups.get(p))
}
/** 给输出声明挂上 presentationMeta 投影（缺省不动）。 */
const withMeta = (out, presentationMeta) => (presentationMeta ? { ...out, presentationMeta } : out)

export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const registry = new HostRegistry({ staticHosts: cfg.hosts || [], hostsFile: cfg.hostsFile, logger: ctx.logger })
  const dataDir = path.dirname(cfg.hostsFile)
  const credsFile = cfg.credentialsFile || path.join(dataDir, 'credentials.enc')
  const credsKeyFile = cfg.credentialsKeyFile || path.join(dataDir, 'credentials.key')
  const creds = new CredentialStore({ file: credsFile, keyFile: credsKeyFile, logger: ctx.logger })
  // 远程目标：本地工作区 ↔ 远程主机目录 的绑定（壳的工作区是本地语义，远程目录靠它桥接）
  const targets = new TargetStore({ file: path.join(dataDir, 'targets.json'), logger: ctx.logger })
  const askpassSh = writeAskpassScript(path.join(dataDir, 'askpass.sh'), credsFile, credsKeyFile)
  // SSH_ASKPASS 是环境变量（ssh_config 无对应项），所以在统一的 spawnFn 注入：
  // 所有 ssh/scp/tar 子进程都带上助手路径；key/agent 模式下有 BatchMode=yes，
  // 不会触发提示，因此无副作用。
  const askpassEnv = { SSH_ASKPASS: askpassSh, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: 'dsh-ssh-remote' }
  const spawnFn = (cmd, args, o) => cp.spawn(cmd, args, Object.assign({}, o, { env: Object.assign({}, process.env, askpassEnv) }))
  const conn = new ConnectionManager({ spawnFn })
  const runner = new Runner({
    spawnFn,
    muxArgs: (h) => conn.muxArgs(h),
    target: (h) => conn.target(h),
    defaults: { commandTimeoutMs: cfg.commandTimeoutMs },
  })
  const fsops = new FsOps({ runner })
  const transfer = new Transfer({ conn, runner, spawnFn })

  const pick = (id) => {
    const h = registry.pick(id)
    conn.resolveJump(h, registry)
    return h
  }
  /** 先保证 master（best-effort），再执行；FsOpsError 结构化返回。 */
  const withHost = async (id, fn) => {
    const h = pick(id)
    const ready = await conn.beforeOp(h)
    if (!ready.ok && !ready.degraded) {
      const err = new Error(ready.error || '连接失败')
      err.kind = 'unreachable'
      return fmtErr(err)
    }
    try {
      return await fn(h)
    } catch (err) {
      return fmtErr(err)
    }
  }

  ctx.effect(() => {
    registry.startWatch()
    return () => { registry.stopWatch() }
  }, 'ssh-remote: lifecycle')

  try {
    ctx.systemPrompt.section({ name: 'ssh-remote', order: 121, text: SYSTEM_PROMPT })
  } catch (err) { ctx.logger?.warn?.('[ssh-remote] 系统提示注册失败: ' + (err && err.message)) }

  try {
    ctx.systemPrompt.context({
      name: 'ssh-remote-target',
      order: 121,
      // 函数形式：每次组装提示时求值，目标一变即生效；返回空串则不贡献任何内容
      text: () => {
        const t = targets.active()
        if (!t) return ''
        return '<ssh_remote_target>当前远程目标：主机 ' + t.hostId + ' 的目录 ' + t.path + '（绑定到本地工作区 ' + t.workspace + '）。'
          + '在该目标上干活时：执行/读写/搜索一律用 ssh_* 工具并以该目录为 cwd（未显式传 cwd 时会自动落到该目录）；'
          + '产出文件后可用 ssh_pull 拉回本地工作区。</ssh_remote_target>'
      },
    })
  } catch (err) { ctx.logger?.warn?.('[ssh-remote] 远程目标上下文注册失败: ' + (err && err.message)) }

  const jsonOut = { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] }
  const textOut = (pick2) => ({ schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: pick2(v) }] })

  try {
    ctx.tools.register(defineTool({
      name: 'ssh_hosts',
      description: '列出可用 SSH 远程主机（id/名称/地址/来源 static|dynamic/是否默认跳板引用），远程任务开始时先调用本工具。',
      parameters: {},
      output: withMeta(jsonOut, (_a = {}, v) => ({
        count: Array.isArray(v && v.hosts) ? v.hosts.length : 0,
        ids: Array.isArray(v && v.hosts) ? v.hosts.slice(0, 50).map(h => String(h.id)) : [],
      })),
      presentCall: () => ({ card: 'generic', title: '列出 SSH 远程主机' }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        return genericResult('SSH 远程主机：' + (m.count || 0) + ' 台')
      },
      async execute() {
        return { hosts: registry.list().map(h => ({ id: h.id, name: h.name, host: h.host, user: h.user, port: h.port, jump: h.jump || null, defaultCwd: h.defaultCwd || null, source: h.source })), validationErrors: registry.validationErrors() }
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_status',
      description: 'SSH 连接池状态：每主机 ControlMaster 状态（up/down/degraded）、延迟、命令数、最后错误。',
      parameters: {},
      output: withMeta(jsonOut, (_a = {}, v) => ({
        count: Array.isArray(v && v.connections) ? v.connections.length : 0,
        lines: Array.isArray(v && v.connections)
          ? v.connections.map(c => String(c.id) + '：' + String(c.master) + (c.latencyMs !== null && c.latencyMs !== undefined ? ' · ' + c.latencyMs + 'ms' : '') + (c.commands ? ' · ' + c.commands + ' 次命令' : ''))
          : [],
      })),
      presentCall: () => ({ card: 'generic', title: 'SSH 连接池状态' }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        const lines = Array.isArray(m.lines) ? m.lines : []
        return genericResult('SSH 连接池：' + (m.count || 0) + ' 条', lines.length ? textBlocks(lines.join('\n')) : undefined)
      },
      async execute() { return { connections: conn.view(), degraded: conn.degraded } },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_run',
      description: '在远程主机执行命令（远端 bash 解释，单参数直传不经本地 shell）。返回 {exitCode, stdout, stderr, durationMs, timedOut}。cwd 可选（缺省用主机 defaultCwd）。',
      parameters: {
        hostId: { type: 'string', description: '主机 id（来自 ssh_hosts）；缺省第一条。' },
        command: { type: 'string', required: true, description: '远程命令（bash 语法）。' },
        cwd: { type: 'string', description: '工作目录（可选）。' },
        timeoutMs: { type: 'number', description: '超时毫秒（缺省插件配置）。' },
      },
      output: withMeta(textOut(v => (v && v.ok === false) ? JSON.stringify(v) : ((v && v.stdout) || '') + (v && v.stderr ? '\n[stderr] ' + v.stderr : '') + '\n[exit ' + (v && v.exitCode) + ']'), (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : {
            host: hostOf(a),
            output: String(v?.stdout || '') + (v?.stderr ? (v.stdout ? '\n' : '') + v.stderr : ''),
            exitCode: typeof v?.exitCode === 'number' ? v.exitCode : undefined,
            timedOut: Boolean(v?.timedOut),
          }),
      presentCall: (a = {}) => ({ card: 'terminal', title: asText(a.command), description: hostOf(a) + (a.cwd ? ' · cwd ' + a.cwd : '') }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        if (m.error) return errorResult(result)
        return {
          card: 'terminal',
          ...(typeof m.exitCode === 'number' && m.exitCode >= 0 ? { exitCode: m.exitCode } : {}),
          output: asText(m.output ?? '') + (m.timedOut ? '\n[已超时，本地进程被终止]' : ''),
        }
      },
      async execute(args) {
        const a = args || {}
        if (!a.command) throw new Error('command 必填')
        return withHost(a.hostId, h => runner.run(h, String(a.command), { cwd: a.cwd || targets.activePathFor(h.id), timeoutMs: a.timeoutMs }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_read',
      description: '读远程文本文件窗口（带行号，tab 分隔，格式同本地 read）。参数 offset（起始行，1 起）/ limit（行数，默认 2000）。二进制文件会被拒绝。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        path: { type: 'string', required: true, description: '远程文件绝对路径。' },
        offset: { type: 'number', description: '起始行（1 起）。' },
        limit: { type: 'number', description: '行数（默认 2000）。' },
      },
      output: withMeta(textOut(v => (v && v.ok === false) ? JSON.stringify(v) : (v.content || '') + '\n[' + (v.lines || 0) + ' 行，sha256 ' + String(v.sha256 || '').slice(0, 12) + ']'), (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), path: String(v?.path || a.path), lines: Number(v?.lines) || 0, sha256: String(v?.sha256 || '').slice(0, 12) }),
      presentCall: (a = {}) => ({
        card: 'generic',
        title: '读取 ' + asText(a.path),
        kind: 'read',
        locations: [{ path: String(a.path), ...(a.offset ? { line: Number(a.offset) } : {}) }],
      }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        if (m.error) return errorResult(result)
        return genericResult(m.lines + ' 行 · sha256 ' + m.sha256)
      },
      async execute(args) {
        const a = args || {}
        if (!a.path) throw new Error('path 必填')
        return withHost(a.hostId, h => fsops.read(h, String(a.path), { offset: a.offset, limit: a.limit }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_write',
      description: '全量覆写远程文件（stdin→临时文件→原子替换）。返回新 sha256。mkdirs=true 自动建父目录。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        path: { type: 'string', required: true, description: '远程文件绝对路径。' },
        content: { type: 'string', required: true, description: '完整新内容。' },
        mkdirs: { type: 'boolean', description: '自动创建父目录（默认 false）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), path: String(v?.path || a.path), sha256: String(v?.sha256 || '').slice(0, 12), bytes: String(a.content || '').length }),
      presentCall: (a = {}) => diffResult(a.path, undefined, a.content, '写入 ' + asText(a.path)),
      presentResult: (a = {}, result) => result && result.isError
        ? errorResult(result)
        : diffResult(a.path, undefined, a.content, '写入 ' + asText(a.path)),
      async execute(args) {
        const a = args || {}
        if (!a.path || a.content === undefined) throw new Error('path 与 content 必填')
        return withHost(a.hostId, h => fsops.write(h, String(a.path), String(a.content), { mkdirs: Boolean(a.mkdirs) }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_edit',
      description: '远程文件字面量替换编辑（同本地 edit 语义）：oldString 默认需唯一命中；远端文件在读取后被改动会报 stale-edit，需重读重试。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        path: { type: 'string', required: true, description: '远程文件绝对路径。' },
        oldString: { type: 'string', required: true, description: '被替换文本（须与文件内容精确匹配）。' },
        newString: { type: 'string', description: '替换文本（空串=删除）。' },
        replaceAll: { type: 'boolean', description: '替换全部命中（默认 false）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), path: String(v?.path || a.path), sha256: String(v?.sha256 || '').slice(0, 12), replacements: Number(v?.replacements) || 0 }),
      presentCall: (a = {}) => diffResult(a.path, a.oldString, a.newString, (a.replaceAll ? '替换全部 ' : '编辑 ') + asText(a.path)),
      presentResult: (a = {}, result) => result && result.isError
        ? errorResult(result)
        : diffResult(a.path, a.oldString, a.newString, (a.replaceAll ? '替换全部 ' : '编辑 ') + asText(a.path)),
      async execute(args) {
        const a = args || {}
        if (!a.path || a.oldString === undefined) throw new Error('path 与 oldString 必填')
        return withHost(a.hostId, h => fsops.edit(h, String(a.path), String(a.oldString), String(a.newString || ''), { replaceAll: Boolean(a.replaceAll) }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_glob',
      description: '远程文件名匹配（远端 find -name）：返回匹配文件路径数组（上限 200，超出标 truncated）。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        pattern: { type: 'string', required: true, description: "glob 模式（如 '*.js'）。" },
        path: { type: 'string', description: '搜索根目录（缺省主机 defaultCwd 或 .）。' },
        maxDepth: { type: 'number', description: '最大深度（默认 3，上限 10）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), paths: Array.isArray(v?.files) ? v.files : [], truncated: Boolean(v?.truncated), total: Number(v?.total) || (Array.isArray(v?.files) ? v.files.length : 0) }),
      presentCall: (a = {}) => ({ card: 'generic', title: '查找 ' + asText(a.pattern), kind: 'search', ...(a.path ? { rawInput: { path: a.path } } : {}) }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        if (m.error) return errorResult(result)
        return { card: 'search', shape: 'paths', paths: Array.isArray(m.paths) ? m.paths : [], truncated: Boolean(m.truncated), total: Number(m.total) || 0 }
      },
      async execute(args) {
        const a = args || {}
        if (!a.pattern) throw new Error('pattern 必填')
        return withHost(a.hostId, h => fsops.glob(h, String(a.pattern), { path: a.path, maxDepth: a.maxDepth }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_grep',
      description: '远程内容搜索（POSIX ERE 正则；grep -rnE）：返回 file:line:text 行数组（跳过二进制文件）（上限 250，超出标 truncated）。默认排除 .git。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        pattern: { type: 'string', required: true, description: 'POSIX ERE 正则。' },
        path: { type: 'string', description: '搜索根目录。' },
        include: { type: 'string', description: "文件名过滤 glob（如 '*.py'）。" },
        ignoreCase: { type: 'boolean', description: '忽略大小写（默认 false）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), files: parseGrepMatches(v?.matches), truncated: Boolean(v?.truncated), total: Number(v?.total) || (Array.isArray(v?.matches) ? v.matches.length : 0) }),
      presentCall: (a = {}) => ({ card: 'generic', title: '搜索 ' + asText(a.pattern), kind: 'search', ...(a.path ? { rawInput: { path: a.path } } : {}) }),
      presentResult: (_a = {}, result) => {
        const m = isRecord(result && result.meta) ? result.meta : {}
        if (m.error) return errorResult(result)
        return { card: 'search', shape: 'matches', files: Array.isArray(m.files) ? m.files : [], truncated: Boolean(m.truncated), total: Number(m.total) || 0 }
      },
      async execute(args) {
        const a = args || {}
        if (!a.pattern) throw new Error('pattern 必填')
        return withHost(a.hostId, h => fsops.grep(h, String(a.pattern), { path: a.path, include: a.include, ignoreCase: Boolean(a.ignoreCase) }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_push',
      description: '上传本地文件/目录到远程主机（单文件 scp；recursive=true 目录 tar-over-ssh）。返回 {exitCode, stderr, durationMs}。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        localPath: { type: 'string', required: true, description: '本地文件/目录绝对路径。' },
        remotePath: { type: 'string', required: true, description: '远程目标路径。' },
        recursive: { type: 'boolean', description: '目录递归（默认 false）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), exitCode: typeof v?.exitCode === 'number' ? v.exitCode : undefined, timedOut: Boolean(v?.timedOut) }),
      presentCall: (a = {}) => ({ card: 'generic', title: '上传 ' + asText(a.localPath) + ' → ' + asText(a.remotePath), kind: 'other', rawInput: { host: hostOf(a), recursive: Boolean(a.recursive) } }),
      presentResult: (_a = {}, result) => result && result.isError ? errorResult(result) : transferResult('上传完成', result),
      async execute(args) {
        const a = args || {}
        if (!a.localPath || !a.remotePath) throw new Error('localPath 与 remotePath 必填')
        return withHost(a.hostId, h => transfer.push(h, String(a.localPath), String(a.remotePath), { recursive: Boolean(a.recursive) }))
      },
    }))

    ctx.tools.register(defineTool({
      name: 'ssh_pull',
      description: '从远程主机下载文件/目录到本地（单文件 scp；recursive=true 目录 tar-over-ssh，自动建本地父目录）。',
      parameters: {
        hostId: { type: 'string', description: '主机 id；缺省第一条。' },
        remotePath: { type: 'string', required: true, description: '远程文件/目录路径。' },
        localPath: { type: 'string', required: true, description: '本地目标路径。' },
        recursive: { type: 'boolean', description: '目录递归（默认 false）。' },
      },
      output: withMeta(jsonOut, (a = {}, v) => (isRecord(v) && v.ok === false)
        ? { error: (v.error && v.error.message) || 'error', host: hostOf(a) }
        : { host: hostOf(a), exitCode: typeof v?.exitCode === 'number' ? v.exitCode : undefined, timedOut: Boolean(v?.timedOut) }),
      presentCall: (a = {}) => ({ card: 'generic', title: '下载 ' + asText(a.remotePath) + ' → ' + asText(a.localPath), kind: 'fetch', rawInput: { host: hostOf(a), recursive: Boolean(a.recursive) } }),
      presentResult: (_a = {}, result) => result && result.isError ? errorResult(result) : transferResult('下载完成', result),
      async execute(args) {
        const a = args || {}
        if (!a.remotePath || !a.localPath) throw new Error('remotePath 与 localPath 必填')
        return withHost(a.hostId, h => transfer.pull(h, String(a.remotePath), String(a.localPath), { recursive: Boolean(a.recursive) }))
      },
    }))
    ctx.tools.register(defineTool({
      name: 'ssh_target',
      description: '查看/设置「当前远程目标」（本地工作区 ↔ 远程主机目录 的绑定）。设为目标后，其它 ssh_* 工具在该主机上未显式给 cwd 时默认落在目标目录，系统提示也会实时同步。不带 action=查看。',
      parameters: {
        action: { type: 'string', description: 'show（默认，查看）| set（设置目标）| clear（解绑）' },
        hostId: { type: 'string', description: 'action=set 必填：目标主机 id（来自 ssh_hosts）' },
        path: { type: 'string', description: 'action=set 必填：远端目录绝对路径' },
        workspace: { type: 'string', description: '本地工作区路径；缺省用当前活跃工作区（无活跃工作区时 set/clear 必填）' },
      },
      output: withMeta(jsonOut, (_a = {}, v) => ({
        action: isRecord(v) ? v.action : undefined,
        hostId: isRecord(v) && v.active ? v.active.hostId : undefined,
        path: isRecord(v) && v.active ? v.active.path : undefined,
      })),
      presentCall: (a = {}) => ({ card: 'generic', title: '远程目标 · ' + asText(a.action || 'show'), kind: 'other', rawInput: { hostId: a.hostId, path: a.path } }),
      presentResult: (_a = {}, result) => result && result.isError ? errorResult(result) : genericResult(result),
      async execute(args) {
        const a = args || {}
        const action = String(a.action || 'show')
        const cur = targets.active()
        const ws = String(a.workspace || (cur && cur.workspace) || '')
        if (action === 'set') {
          if (!a.hostId || !a.path) throw new Error('set 需要 hostId 与 path')
          pick(a.hostId) // 校验主机存在
          const key = ws || '_default'
          const b = targets.bind(key, a.hostId, String(a.path))
          return { action: 'set', active: { workspace: key, hostId: b.hostId, path: b.path }, bindings: targets.list() }
        }
        if (action === 'clear') {
          return { action: 'clear', removed: targets.unbind(ws || '_default'), active: targets.active(), bindings: targets.list() }
        }
        return { action: 'show', active: cur, bindings: targets.list() }
      },
    }))
  } catch (err) {
    ctx.logger?.error?.('[ssh-remote] 工具注册失败: ' + (err && err.message))
    throw err
  }

  // ---- 回环 HTTP API ----

  /** 新增单台动态主机（id 与静态/已有冲突则 409）。 */
  function addDynamicHost(body) {
    const raw = body && typeof body === 'object' ? { ...body, source: 'dynamic' } : null
    if (!raw) return { status: 400, payload: { ok: false, error: { code: 'bad-host', message: '主机字段非法（需为对象）' } } }
    assignMissingIds([raw], registry.list().map(h => h.id)) // 缺 id 由服务端补，避免整条被丢
    const n = normalizeHost(raw)
    if (!n) return { status: 400, payload: { ok: false, error: { code: 'bad-host', message: '主机字段非法（id [a-z0-9_-] / host 必填；auth=key 时需 identityFile）' } } }
    if (registry.list().some(h => h.id === n.id)) return { status: 409, payload: { ok: false, error: { code: 'conflict', message: 'id 已存在: ' + n.id } } }
    atomicWriteJson(registry.hostsFile, [...readHostsFile(registry.hostsFile), n])
    registry.reload()
    return { status: 200, payload: { ok: true, value: registry.list() } }
  }

  /* HTTP 路由体：第三参 bodyOverride 仅测试注入路径；真实 HTTP 层走 req 流。
     注册进 webServer 的 handler 严格是 (req, res) 两参——对齐 dsh 0.1.7 的 WebRoute 契约。 */
  function handleApi(req, res, body) {
    {
          const host = String(req.headers.host ?? '')
          const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host)
          if (!loopback) { respond(res, 403, { ok: false, error: { code: 'forbidden', message: 'loopback only' } }); return }
          const url = new URL(req.url || '/', 'http://' + host)
          const p = url.pathname.replace(/\/+$/, '')
          const m = req.method
          // 说明：body 第三参仅测试注入路径；真实 HTTP 层走 req 流。

          if (m === 'GET' && p === '/ssh-remote/api/status') {
            respond(res, 200, { ok: true, value: { hosts: registry.list(), connections: conn.view(), validationErrors: registry.validationErrors(), degraded: conn.degraded } })
            return
          }
          if (m === 'GET' && p === '/ssh-remote/api/hosts') {
            respond(res, 200, { ok: true, value: registry.list().map(h => ({ ...h, hasPassword: creds.has(identityOf(h.user, h.host)) })) })
            return
          }
          // 凭据：只进加密库（AES-256-GCM），响应里永不回显密码。
          if (m === 'PUT' && p === '/ssh-remote/api/credentials') {
            readJson(req, body).then(b => {
              const user = String((b && b.user) || '').trim()
              const host = String((b && b.host) || '').trim()
              const password = b && b.password
              if (!user || !host || typeof password !== 'string' || password === '') {
                respond(res, 400, { ok: false, error: { code: 'bad-request', message: 'user/host/password 必填' } })
                return
              }
              const identity = identityOf(user, host)
              creds.set(identity, password)
              respond(res, 200, { ok: true, value: { identity, hasPassword: true } })
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          if (m === 'DELETE' && p.startsWith('/ssh-remote/api/credentials/')) {
            const identity = decodeURIComponent(p.slice('/ssh-remote/api/credentials/'.length))
            respond(res, 200, { ok: true, value: { removed: creds.remove(identity) } })
            return
          }
          if (m === 'POST' && p === '/ssh-remote/api/hosts') {
            readJson(req, body).then(body => {
              const r = addDynamicHost(body)
              respond(res, r.status, r.payload)
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          if (m === 'POST' && p === '/ssh-remote/api/hosts/bulk') {
            readJson(req, body).then(body => {
              const arr = Array.isArray(body && body.hosts) ? body.hosts : []
              const errs = []
              const cleaned = []
              // 缺 id 先统一补 id（slug + 计数），否则 normalizeHost 会把整条当非法丢掉，
              // 而前端只看 ok 就提示"已保存"，表现为保存后列表为空。
              const raws = arr.map(raw => ({ ...raw, source: 'dynamic' }))
              assignMissingIds(raws, registry.list().filter(h => h.source === 'static').map(h => h.id))
              for (const raw of raws) {
                const n = normalizeHost(raw)
                if (n) cleaned.push(n)
                else errs.push('条目非法: ' + JSON.stringify(raw).slice(0, 80))
              }
              const conflicts = cleaned.filter(h => registry.source(h.id) === 'static').map(h => h.id)
              if (conflicts.length) {
                respond(res, 409, { ok: false, error: { code: 'static-conflict', message: '不可覆盖静态主机: ' + conflicts.join(', ') } })
                return
              }
              atomicWriteJson(registry.hostsFile, cleaned)
              registry.reload()
              respond(res, 200, { ok: true, value: registry.list(), warnings: errs })
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          if (m === 'POST' && p === '/ssh-remote/api/hosts/import') {
            readJson(req, body).then(async body => {
              const r = parseImport(String((body && body.text) || ''), String((body && body.format) || 'json'))
              if (body && body.commit) {
                const existing = readHostsFile(registry.hostsFile)
                const ids = new Set(existing.map(h => h.id))
                const stat = new Set(registry.list().filter(h => h.source === 'static').map(h => h.id))
                const add = r.hosts.filter(h => !ids.has(h.id) && !stat.has(h.id))
                atomicWriteJson(registry.hostsFile, [...existing, ...add.map(h => ({ ...h, source: undefined }))])
                registry.reload()
                respond(res, 200, { ok: true, value: { added: add.map(h => h.id), skipped: r.hosts.length - add.length, errors: r.errors, hosts: registry.list() } })
              } else {
                respond(res, 200, { ok: true, value: { preview: r } })
              }
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          const delM = p.match(/^\/ssh-remote\/api\/hosts\/([a-z0-9_-]+)$/)
          if (m === 'DELETE' && delM) {
            const id = delM[1]
            if (registry.source(id) === 'static') { respond(res, 409, { ok: false, error: { code: 'static-conflict', message: '静态主机不可删除' } }); return }
            const remaining = readHostsFile(registry.hostsFile).filter(h => h.id !== id)
            atomicWriteJson(registry.hostsFile, remaining)
            registry.reload()
            respond(res, 200, { ok: true, value: registry.list() })
            return
          }
          if (m === 'POST' && p === '/ssh-remote/api/probe') {
            readJson(req, body).then(async body => {
              try {
                const h = pick(body && body.hostId)
                const started = Date.now()
                const r = await conn.ensureMaster(h)
                respond(res, 200, { ok: true, value: { hostId: h.id, ok: r.ok, degraded: !!r.degraded, latencyMs: Date.now() - started, error: r.error || null } })
              } catch (err) {
                const msg = String((err && err.message) || err)
                const notFound = msg.includes('不存在') || msg.includes('未配置')
                respond(res, notFound ? 404 : 409, { ok: false, error: { code: notFound ? 'not-found' : 'conflict', message: msg } })
              }
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          // 远程目录浏览（"选择工作区 → 远程目录"的逐层选择器数据源）
          if (m === 'POST' && p === '/ssh-remote/api/browse') {
            readJson(req, body).then(async b => {
              try {
                const h = pick(b && b.hostId)
                const want = b && b.path ? String(b.path) : ''
                const r = await runner.run(h, 'pwd && ls -1Ap | head -300', { cwd: want || undefined, timeoutMs: 20000 })
                const lines = String(r.output || '').split(/\r?\n/)
                const resolved = (lines.shift() || '').trim()
                if (r.timedOut || !resolved) {
                  respond(res, 400, { ok: false, error: { code: 'directory-unreadable', message: r.timedOut ? '目录列举超时' : ((r.output || '').trim().slice(-200) || '目录不可读') } })
                  return
                }
                const entries = lines.filter(Boolean).map(name => ({ name: name.replace(/\/$/, ''), isDir: name.endsWith('/') }))
                const parent = resolved === '/' ? null : (resolved.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/')
                respond(res, 200, { ok: true, value: { path: resolved, parent, entries } })
              } catch (err) {
                const msg = String((err && err.message) || err)
                respond(res, msg.includes('不存在') || msg.includes('未配置') ? 404 : 409, { ok: false, error: { code: 'conflict', message: msg } })
              }
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          // 远程目标绑定：本地工作区 ↔ 远程目录
          if (m === 'GET' && p === '/ssh-remote/api/target') {
            respond(res, 200, { ok: true, value: { active: targets.active(), bindings: targets.list() } })
            return
          }
          if (m === 'PUT' && p === '/ssh-remote/api/target') {
            readJson(req, body).then(b => {
              const ws = String((b && b.workspace) || '').trim()
              const hostId = String((b && b.hostId) || '').trim()
              const remote = String((b && b.path) || '').trim()
              if (!hostId || !remote) { respond(res, 400, { ok: false, error: { code: 'bad-request', message: 'hostId/path 必填' } }); return }
              const key = ws || '_default'
              try { pick(hostId) } catch (err) { respond(res, 404, { ok: false, error: { code: 'not-found', message: String((err && err.message) || err) } }); return }
              const binding = targets.bind(key, hostId, remote)
              respond(res, 200, { ok: true, value: { active: targets.active(), binding } })
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          if (m === 'POST' && p === '/ssh-remote/api/target/unbind') {
            readJson(req, body).then(b => {
              const ws = String((b && b.workspace) || '').trim()
              respond(res, 200, { ok: true, value: { removed: ws ? targets.unbind(ws) : false, active: targets.active() } })
            }).catch(() => respond(res, 400, { ok: false, error: { code: 'bad-json', message: 'invalid json body' } }))
            return
          }
          respond(res, 404, { ok: false, error: { code: 'not-found', message: 'no route: ' + p } })
    }
  }

  try {
    ctx.inject(['webServer'], (sctx) => {
      sctx.effect(() => sctx.webServer.register({
        kind: 'prefix',
        path: '/ssh-remote/api',
        handler: (req, res) => handleApi(req, res, undefined),
      }), 'ssh-remote: http api')
    })
  } catch (err) { ctx.logger?.warn?.('[ssh-remote] HTTP API 注册失败: ' + (err && err.message)) }

  // cordis 4.0.x：apply 只能返回函数（收为插件 disposer）或 undefined；
  // 返回普通对象会 TypeError('Invalid effect') 使 fiber 直接 FAILED，
  // 运行时启停/卸载（HMR）的状态机随之异常。disposer 语义：
  // 1) conn.dispose 置 disposed——在途/后续操作不再重建 master；
  // 2) 返回 teardownAll 的 promise——unload 会 await 它，全部
  //    `ssh -O exit`（每主机上限约 10s）完成后管理器才继续 pnpm remove。
  // 内件（conn/fsops 等）作为属性挂在 disposer 上：cordis 只调用函数本身，
  // 属性不影响生命周期，同时保留既有测试/调试面（inst.conn 桩替换）。
  const dispose = () => {
    conn.dispose(registry.list())
    return conn.teardownAll(registry.list())
  }
  return Object.assign(dispose, { registry, conn, runner, fsops, transfer, handleApi })
}

function respond(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function readJson(req, bodyOverride) {
  if (bodyOverride !== undefined) {
    // 解析失败转 rejected promise（与流式路径一致，路由 .catch → 400）
    if (typeof bodyOverride !== 'string') return Promise.resolve(bodyOverride || {})
    return new Promise((resolve, reject) => {
      try { resolve(JSON.parse(bodyOverride)) } catch (e) { reject(e) }
    })
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > 64 * 1024) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}
