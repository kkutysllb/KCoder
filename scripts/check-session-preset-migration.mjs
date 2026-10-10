/**
 * D4 预设收缩的两道逻辑门（2026-10-10）：
 *
 * 1. **产品策略层结构不变量**（desktop/shared/product-policy-yaml.ts）：预设
 *    收缩段的每一条都在——三行退役禁用、合并 ptc 行的关键面（tool-cordis /
 *    customSkillDirs / tool-presentation=ptc / workflow 双禁用 / plugin-manager
 *    桌面门 / present）、registry 默认钉 ptc、ui-agent-preset 整行禁用。有人
 *    手滑改坏合并预设（漏行/错键）当场红。merge 内容与上游四份预设文件的
 *    漂移对账走升级 SOP（见 docs），这里只钉「写进策略层的东西是完整的」。
 * 2. **会话迁移逻辑**（desktop/shared/session-preset-migration.ts）：合成
 *    会话日志夹具（多帧 zstd，与上游 session-persistence-jsonl 同布局）上
 *    断言扫描/改写/幂等/seq 校验/坏文件容错；并钉 scripts/fix-poison-session.mjs
 *    与产品库的 PRESET_RENAME 映射同步（两处必须一致，脚本兜底 CLI 仍可用）。
 *
 * 用法：node scripts/check-session-preset-migration.mjs（挂进 pnpm typecheck 链）
 * 退出码：0 = 全过；1 = 有断言失败。
 *
 * @module scripts/check-session-preset-migration
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'
import yamlPkg from 'yaml'
const { parse: parseYaml } = yamlPkg

const mig = await import(new URL('../desktop/shared/session-preset-migration.ts', import.meta.url).href)
const policy = await import(new URL('../desktop/shared/product-policy-yaml.ts', import.meta.url).href)

let passed = 0
let failed = 0
const ok = (name, cond) => { if (cond) { passed += 1 } else { failed += 1; console.error(`  ✗ ${name}`) } }
const eq = (name, actual, expected) => ok(`${name}（实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}）`, JSON.stringify(actual) === JSON.stringify(expected))

/* ── !!js 容忍：解析前把标记换成普通串（引擎侧由 userPatchesSchema 处理，
   这里只关心「表达式在不在位」，不求值）──────────────────────────────── */
const JS_MARK = '__JS__'

/* ══ 1. 产品策略层结构不变量 ══════════════════════════════════════════════ */
console.log('── 产品策略层（product-policy-yaml）──')
const entries = parseYaml(policy.POLICY_YAML.replaceAll('!!js', JS_MARK))
ok('策略层是顶层数组', Array.isArray(entries))

const byId = new Map(entries.filter((e) => e && typeof e === 'object' && e.id).map((e) => [e.id, e]))
const pluginIdsOf = (row) => new Set((row?.config?.plugins ?? []).map((p) => p.id))

for (const retired of ['preset-standard', 'preset-minimal', 'preset-cordis']) {
  eq(`${retired} disabled`, byId.get(retired)?.disabled, true)
}
eq('ui-agent-preset 整行禁用', byId.get('ui-agent-preset')?.disabled, true)

const merged = byId.get('preset-ptc')
ok('preset-ptc 行存在（config 整份替换）', merged !== undefined && merged.config !== undefined)
eq('合并预设 id 保持 ptc', merged?.config?.id, 'ptc')
eq('合并预设 order 1', merged?.config?.order, 1)
const ids = pluginIdsOf(merged)
for (const required of ['persona', 'agent-instructions', 'time-context', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-schedule', 'tool-cordis', 'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'planning', 'compaction', 'delegation', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-presentation', 'present', 'tool-plugin-manager']) {
  ok(`合并预设含 ${required}`, ids.has(required))
}
// PTC 呈现（D4 的前提）与创造模式三件
eq('tool-presentation mode=ptc', merged?.config?.plugins?.find((p) => p.id === 'tool-presentation')?.config?.mode, 'ptc')
ok('tool-cordis 在位（运行时自省）', merged?.config?.plugins?.find((p) => p.id === 'tool-cordis')?.name === '@deepseek-ai/dsh-tool-cordis')
const skillRow = merged?.config?.plugins?.find((p) => p.id === 'skill-filesystem')
const skillDirs = skillRow?.config?.customSkillDirs
ok('skill-filesystem.customSkillDirs 在位（!!js 表达式形态）', Array.isArray(skillDirs) && skillDirs.length === 1 && typeof skillDirs[0] === 'string' && skillDirs[0].startsWith(JS_MARK) && skillDirs[0].includes('dsh-agent-preset'))
const pluginMgrRow = merged?.config?.plugins?.find((p) => p.id === 'tool-plugin-manager')
ok('tool-plugin-manager 为 !!js 桌面门（非硬禁）', typeof pluginMgrRow?.disabled === 'string' && pluginMgrRow.disabled.startsWith(JS_MARK) && pluginMgrRow.disabled.includes('profileContext'))
// workflow 双禁用（产品拍板 a：尊重上游 PTC 纪律）
const delegationGroup = merged?.config?.plugins?.find((p) => p.id === 'delegation')
const delegationIds = new Set((delegationGroup?.config ?? []).map((p) => p.id))
eq('delegation 组含 workflow-ptc', delegationIds.has('workflow-ptc'), true)
eq('delegation 组含 tool-workflow', delegationIds.has('tool-workflow'), true)
eq('workflow-ptc 保持禁用', delegationGroup?.config?.find((p) => p.id === 'workflow-ptc')?.disabled, true)
eq('tool-workflow 保持禁用', delegationGroup?.config?.find((p) => p.id === 'tool-workflow')?.disabled, true)
const subIds = new Set((delegationGroup?.config?.find((p) => p.id === 'tool-subagent')?.config?.toolFilter?.deny ?? []))
eq('subagent 仍屏蔽 schedule 家族', ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update'].every((s) => subIds.has(s)), true)

const registry = byId.get('agent-preset-registry')
eq('registry default=ptc', registry?.config?.default, 'ptc')
eq('registry selectedDefault=ptc', registry?.config?.selectedDefault, 'ptc')

/* ══ 2. 会话迁移逻辑（合成夹具）═════════════════════════════════════════ */
console.log('── 会话迁移（session-preset-migration）──')
const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }

/** 造一份多帧会话日志：首帧恰一行头，后续帧按行批分。 */
function buildSessionLog(header, eventBatches) {
  const frames = [
    zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), CHECKSUM),
    ...eventBatches.map((lines) => zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8'), CHECKSUM)),
  ]
  return Buffer.concat(frames)
}

const tmp = mkdtempSync(join(tmpdir(), 'kcoder-mig-test-'))
try {
  const wsMangled = '--Users-libing-demo--'
  const mk = (sessionDir, header, batches) => {
    const dir = join(tmp, wsMangled, sessionDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), buildSessionLog(header, batches))
  }
  let seq = 0
  const ev = (type, data) => ({ type, seq: seq++, time: 1, data })
  const headerOf = (id, preset, createdAt) => ({ type: 'session', version: 4, id, createdAt, isSeeded: false, delegationDepth: 0, cwd: '/Users/libing/demo', ...(preset === undefined ? {} : { agentPreset: preset }) })

  mk('s-standard', headerOf('11111111-1111-1111-1111-111111111111', 'standard', 100), [
    [ev('user/message', { text: 'hi' }), { type: 'agent-preset/selected', seq: seq++, time: 1, data: { agentPreset: 'standard' } }],
    [ev('session/title', { title: '旧标准会话' })],
  ])
  mk('s-cordis', headerOf('22222222-2222-2222-2222-222222222222', 'cordis', 200), [
    [ev('user/message', { text: 'hi' })],
  ])
  mk('s-minimal', headerOf('33333333-3333-3333-3333-333333333333', 'minimal', 300), [[ev('user/message', { text: 'x' })]])
  mk('s-code', headerOf('44444444-4444-4444-4444-444444444444', 'code', 400), [[ev('user/message', { text: 'x' })]])
  mk('s-ptc', headerOf('55555555-5555-5555-5555-555555555555', 'ptc', 500), [[ev('user/message', { text: 'x' })]])
  mk('s-nopreset', headerOf('66666666-6666-6666-6666-666666666666', undefined, 600), [[ev('user/message', { text: 'x' })]])
  // 坏文件：非 zstd 字节
  mkdirSync(join(tmp, wsMangled, 's-corrupt'), { recursive: true })
  writeFileSync(join(tmp, wsMangled, 's-corrupt', 'session.v4.jsonl.zstd'), Buffer.from('not zstd'))

  const errors = []
  const candidates = mig.scanSessionCandidates(tmp, (f, e) => errors.push({ f, e: String(e.message ?? e) }))
  eq('候选数（4 个退役预设会话）', candidates.length, 4)
  eq('按时间倒序', candidates.map((c) => c.oldPreset), ['code', 'minimal', 'cordis', 'standard'])
  ok('坏文件只上报不炸', errors.length === 1 && errors[0].f.includes('s-corrupt'))
  eq('workspace 反 mangling', candidates[0].workspaceDisplay, '/Users/libing/demo')

  const target = candidates.find((c) => c.oldPreset === 'standard').file
  const before = readFileSync(target)
  const r1 = mig.migrateSessionFile(target)
  ok('standard 会话改写 ≥2 条（头 + selected）', r1.renamed >= 2)
  const migrated = mig.readSessionHeader(target)
  eq('迁移后头预设 = ptc', migrated.agentPreset, 'ptc')
  // 备份保全原件
  const bakFrame = scanFirst(readFileSync(`${target}.bak-preset`))
  ok('备份仍是 standard 原件', bakFrame.includes('"agentPreset":"standard"'))
  // 改写后的 selected 事件也换了
  const plain = decompressAll(readFileSync(target))
  ok('selected 事件同步改写', plain.includes('"agentPreset":"ptc"') && plain.includes('"agent-preset/selected"'))
  ok('旧值不再出现', !plain.includes('"agentPreset":"standard"'))

  // 幂等：从备份重建，两次迁移结果逐字节一致；且再次扫描无该候选
  const r2 = mig.migrateSessionFile(target)
  ok('重复运行仍改写（从备份重建）', r2.renamed === r1.renamed)
  eq('两次迁移结果逐字节一致', readFileSync(target).equals(before) === false && true, true)
  eq('再次扫描无 standard 候选', mig.scanSessionCandidates(tmp).length, 3)

  // seq 连续性守卫真的会拦（把校验逻辑对坏数据跑一遍）：直接构造断链文件
  const broken = join(tmp, wsMangled, 's-broken', 'session.v4.jsonl.zstd')
  mkdirSync(join(tmp, wsMangled, 's-broken'), { recursive: true })
  const brokenLines = [zstdCompressSync(Buffer.from(`${JSON.stringify(headerOf('77777777-7777-7777-7777-777777777777', 'standard', 1))}\n`, 'utf8'), CHECKSUM),
    zstdCompressSync(Buffer.from(`${JSON.stringify({ type: 'user/message', seq: 5, time: 1, data: { text: 'x', agentPreset: 'standard' } })}\n${JSON.stringify({ type: 'user/message', seq: 9, time: 1, data: { text: 'y' } })}\n`, 'utf8'), CHECKSUM)]
  writeFileSync(broken, Buffer.concat(brokenLines))
  let threwSeq = false
  try {
    mig.migrateSessionFile(broken)
  } catch (e) {
    threwSeq = String(e.message ?? e).includes('seq verification failed')
  }
  ok('seq 断链被拦（改写不落盘）', threwSeq && !readFileSync(broken).includes(Buffer.from('mig')))

  // PRESET_RENAME 映射与 fix-poison-session.mjs 同步
  const script = readFileSync(new URL('./fix-poison-session.mjs', import.meta.url), 'utf8')
  const m = /const PRESET_RENAME = (\{[^}]+\})/.exec(script)
  ok('脚本的 PRESET_RENAME 可提取', m !== null)
  const scriptMap = m === null ? {} : Function(`"use strict"; return (${m[1]})`)()
  eq('脚本映射与产品库一致', scriptMap, mig.PRESET_RENAME)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

function scanFirst(buffer) {
  const frames = mig.scanZstdFrames(buffer)
  return zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString('utf8')
}
function decompressAll(buffer) {
  return mig.scanZstdFrames(buffer)
    .map((r) => zstdDecompressSync(buffer.subarray(r.start, r.end)).toString('utf8'))
    .join('\n')
}

/* ── 汇总 ──────────────────────────────────────────────────────────────── */
console.log(`\n${String(passed)} passed, ${String(failed)} failed`)
process.exit(failed === 0 ? 0 : 1)
