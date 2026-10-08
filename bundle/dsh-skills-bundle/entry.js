// dsh-skills-bundle 胶水插件（v1.1）。
//
// 零依赖纯 ESM（对齐 dsh-vision-router 的 out-of-tree bundle 形态，
// 可被 profile node_modules 直接 resolve，无需构建步骤）。两批技能：
//
// - core（manifest.skills）：激活即注册，语义同 v1.0；
// - optional（manifest.optional）：随包分发、默认不注册——用户在设置页
//   「可选技能」分区（client.js 贡献的 settings.section）里按需启用，
//   启用集持久化在 `$QILIN_HOME/kcoder-skills.json`（0600）。
//
// client 侧无法读盘也无法直写宿主状态，所以宿主经 webServer 挂一个
// fenced JSON API（/kcoder-skills/api，与 /api 网关同款 Host 回环信任
// 边界）：GET catalog 出两批清单与启用态，POST set-enabled 改启用集并
// 就地重注册（dispose 旧 optional 注册 → 注册新集合）。
//
// skill 元数据来源是 manifest.json 而非解析 frontmatter：manifest 由
// scripts/gen-manifest.mjs 与 SKILL.md 一并产出，单一事实源，插件端无需
// YAML 解析器。

import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'kcoder-skills'

/** 注册进 skill registry（ctx key: skills）与 web 路由（ctx key: webServer）。 */
export const inject = ['skills', 'webServer']

/** 包根（entry.js 所在目录）。 */
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** 技能内容目录。 */
const SKILLS_DIR = join(ROOT, 'skills')

/** 可选技能启用集的持久化文件（QILIN_HOME 内，产品私有命名空间）。 */
const STATE_FILE = 'kcoder-skills.json'

/** QILIN_HOME 解析（packages/util/home-paths 同语义：env 覆盖优先，空白视同未设）。 */
function qilinHome() {
  const override = process.env.QILIN_HOME
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), '.qilin')
}

/** 剥离 SKILL.md 开头的 YAML frontmatter 块（--- 限界），返回正文。 */
function stripFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return raw
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return raw
  return raw.slice(end + 5).replace(/^\n+/, '')
}

/** 读取可选技能启用集（文件缺失/损坏/非法条目一律容错为空集）。 */
function readEnabled() {
  try {
    const parsed = JSON.parse(readFileSync(join(qilinHome(), STATE_FILE), 'utf8'))
    if (Array.isArray(parsed?.enabled)) return parsed.enabled.filter((name) => typeof name === 'string')
  } catch {
    // 无状态文件（未做过选择）或损坏：空集起步
  }
  return []
}

/** 持久化启用集（0600；失败不阻塞本次会话的注册变更）。 */
function writeEnabled(enabled) {
  try {
    writeFileSync(join(qilinHome(), STATE_FILE), `${JSON.stringify({ enabled }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // 只读 home 等异常：启用集退化为本次会话内有效
  }
}

/**
 * 技能注册的公共形状（manifest 条目 → ctx.skills.register 入参）。
 * 正文相对资源（templates/ 等）按技能目录解析。
 */
function registrationOf(item) {
  const dir = join(SKILLS_DIR, item.dir)
  return {
    name: item.name,
    description: item.description,
    ...item.whenToUse === undefined ? {} : { whenToUse: item.whenToUse },
    source: 'runtime',
    content: stripFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8')),
    resourceBase: { kind: 'directory', path: dir },
  }
}

/** Host 回环信任边界（与 /api 网关同款：只服务本机回环 Host 的请求）。 */
function isLoopbackHost(headers) {
  const raw = headers?.host
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return false
  const host = value.toLowerCase().replace(/:\d+$/, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

function writeJson(res, status, payload) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  } catch {
    // 客户端已断开等写失败：无处可报，忽略
  }
}

/** 读请求体（async-iterable 字节块 → 文本）。 */
async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 注册清单内全部技能；返回组合 disposer。
 * @param {object} ctx - cordis 插件上下文（skills + webServer 已注入）。
 */
export function apply(ctx) {
  const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, 'manifest.json'), 'utf8'))
  const coreSkills = Array.isArray(manifest.skills) ? manifest.skills : []
  const optionalSkills = Array.isArray(manifest.optional) ? manifest.optional : []
  const optionalByName = new Map(optionalSkills.map((item) => [item.name, item]))

  /** @type {Array<() => void>} */
  const disposers = []
  /** @type {Map<string, () => void>} optional 技能的现行注册（name → disposer）。 */
  const live = new Map()

  let enabled = new Set(readEnabled().filter((name) => optionalByName.has(name)))

  for (const item of coreSkills) {
    disposers.push(ctx.skills.register(registrationOf(item)))
  }

  /** 就地同步 optional 注册集到当前 enabled。 */
  function syncOptional() {
    for (const [name, dispose] of live) {
      if (!enabled.has(name)) {
        try { dispose() } catch {}
        live.delete(name)
      }
    }
    for (const name of enabled) {
      if (live.has(name)) continue
      const item = optionalByName.get(name)
      if (item === undefined) continue
      live.set(name, ctx.skills.register(registrationOf(item)))
    }
  }
  syncOptional()

  // fenced JSON API：设置页「可选技能」分区的数据面。
  const routeDisposer = ctx.webServer?.register?.({
    kind: 'prefix',
    path: '/kcoder-skills/api',
    handler: async (req, res) => {
      if (!isLoopbackHost(req.headers)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      const method = (req.method ?? 'GET').toUpperCase()
      const pathname = new URL(req.url ?? '/', 'http://kcoder.internal').pathname
      const action = pathname.startsWith('/kcoder-skills/api/') ? pathname.slice('/kcoder-skills/api/'.length) : ''
      if (method === 'GET' && action === 'catalog') {
        writeJson(res, 200, {
          ok: true,
          core: coreSkills.map(({ name, description }) => ({ name, description })),
          optional: optionalSkills.map(({ name, description }) => ({ name, description, enabled: enabled.has(name) })),
        })
        return
      }
      if (method === 'POST' && action === 'set-enabled') {
        let requested
        try {
          const body = JSON.parse((await readBody(req)) || '{}')
          requested = Array.isArray(body?.enabled) ? body.enabled.filter((name) => typeof name === 'string') : null
        } catch {
          requested = null
        }
        if (requested === null) {
          writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'body must be {"enabled": string[]}' } })
          return
        }
        enabled = new Set(requested.filter((name) => optionalByName.has(name)))
        writeEnabled([...enabled])
        syncOptional()
        // 变更诊断：验证/排障时在引擎 stdout 直接可见注册面变化
        console.log(`kcoder-skills: optional set updated → ${live.size}/${optionalSkills.length} enabled (${[...enabled].join(', ') || 'none'})`)
        writeJson(res, 200, { ok: true, enabled: [...enabled] })
        return
      }
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown kcoder-skills API method' } })
    },
  })
  if (typeof routeDisposer === 'function') disposers.push(routeDisposer)

  // 激活诊断直走 stdout（与就绪行同通道；Cordis logger 在函数插件的
  // 简化 ctx 上未必就绪，且 info 级常被过滤）
  console.log(`kcoder-skills: ${coreSkills.length} core skills registered, ${live.size}/${optionalSkills.length} optional enabled (${[...enabled].join(', ') || 'none'})`)
  return () => {
    for (const dispose of live.values()) { try { dispose() } catch {} }
    live.clear()
    for (const dispose of disposers) { try { dispose() } catch {} }
  }
}
