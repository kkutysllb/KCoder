#!/usr/bin/env node
/**
 * KSkills → kcoder-skills bundle 适配脚本。
 *
 * 从本地 KSkills 仓库（默认 ~/kk_Projects/KSkills）选取知识型技能，做
 * dsh 兼容清洗后物化到 bundle/kcoder-skills/skills/，并重生成 manifest.json。
 *
 * 处理规则：
 * - frontmatter 仅保留 name / description（展平为单行——entry.js 端不解析
 *   YAML，元数据走 manifest.json 单一事实源）
 * - 正文剥离 Claude Code 生态残留：powershell 代码块、含 Claude Code /
 *   ${CLAUDE_PLUGIN_ROOT} / ~/.claude 引用的整行
 * - 计划落点约定对齐：docs/superpowers/plans/ → plans/（git 面板扫描约定）
 *
 * 注意：planning-with-files 不在本脚本清单内——它是耦合 KCoder 单文件
 * plans/ 约定的手写深度改编版，由 bundle 内直接维护；KSkills 上游更新
 * 后需人工比对方法论差异。
 *
 * 用法：
 *   node scripts/adapt-kskills.mjs [--src /path/to/KSkills]
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 机械清洗的技能清单（planning-with-files 为手写改编版，不在列）。 */
const ADAPTED_SKILLS = [
  'task-decomposition',
  'writing-plans',
  'executing-plans',
  'verification-before-completion',
]

/** manifest 中的固定顺序（含手写版）。 */
const MANIFEST_ORDER = [
  'planning-with-files',
  ...ADAPTED_SKILLS,
]

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_SRC = join(homedir(), 'kk_Projects', 'KSkills')
const DEFAULT_OUT = join(REPO_ROOT, 'bundle', 'kcoder-skills', 'skills')

// ── 参数 ────────────────────────────────────────────────────────────────────

function argValue(flag) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : null
}
const SRC = resolve(argValue('--src') ?? DEFAULT_SRC)
const OUT = resolve(argValue('--out') ?? DEFAULT_OUT)

// ── frontmatter 解析（极简：仅 name/description，支持 >- 折叠） ────────────

function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) throw new Error('SKILL.md 缺少 frontmatter')
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) throw new Error('frontmatter 未闭合')
  const lines = raw.slice(4, end).split('\n')
  const fields = {}
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\w[\w-]*):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    const [, key, value] = m
    // 空值或 YAML 折叠标记（>/|- 及其 chop/keep 变体）都走折叠收集
    if (value !== '' && !/^(?:[>|][+-]?|)$/.test(value)) {
      fields[key] = value
    } else {
      // 折叠块（>- 等）：收集后续缩进行
      const folded = []
      for (let j = i + 1; j < lines.length && (lines[j] === '' || /^\s+\S/.test(lines[j])); j++) {
        if (lines[j].trim() !== '') folded.push(lines[j].trim())
      }
      fields[key] = folded.join(' ')
      i += folded.length
    }
  }
  return { fields, body: raw.slice(end + 5).replace(/^\n+/, '') }
}

/** 单行化 description：折叠空白，避免 entry.js 端 manifest 出现多行。 */
function flattenDescription(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// ── 正文清洗 ────────────────────────────────────────────────────────────────

function cleanBody(body) {
  // 1) 整块删除 powershell 代码围栏（含 fence 行之间全部内容）
  let out = body.replace(/```powershell[\s\S]*?```\n?/g, '')
  // 2) 删除含 Claude 生态残留的整行（句中引用平台/路径即失效语境）
  out = out
    .split('\n')
    .filter((line) =>
      !/claude[_ ]?code|CLAUDE_PLUGIN_ROOT|~\/\.claude|\$HOME\/\.claude|superpowers:/i.test(line))
    .join('\n')
  // 3) 计划落点约定对齐（KCoder git 面板扫描 plans/ 一层目录）
  out = out.replaceAll('docs/superpowers/plans/', 'plans/')
  // 4) 压掉 3+ 连续空行（删块残留）
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trimEnd() + '\n'
}

// ── 适配产出 ────────────────────────────────────────────────────────────────

function adaptSkill(name) {
  const srcPath = join(SRC, 'coding', name, 'SKILL.md')
  if (!existsSync(srcPath)) throw new Error(`KSkills 源缺失: ${srcPath}`)
  const { fields, body } = parseFrontmatter(readFileSync(srcPath, 'utf8'))
  if (fields.name !== name) throw new Error(`name 不一致: ${fields.name} vs ${name}`)
  const description = flattenDescription(fields.description ?? '')
  if (description === '') throw new Error(`${name}: description 为空`)
  const cleaned = cleanBody(body)
  const destDir = join(OUT, name)
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  writeFileSync(
    join(destDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${cleaned}`,
  )
  console.log(`  ✓ ${name} (${cleaned.split('\n').length} 行正文)`)
}

// ── manifest 重生成（覆盖手写版） ───────────────────────────────────────────

function regenerateManifest() {
  const skills = []
  for (const dir of MANIFEST_ORDER) {
    const skillPath = join(OUT, dir, 'SKILL.md')
    if (!existsSync(skillPath)) throw new Error(`manifest 扫描缺失: ${skillPath}`)
    const { fields } = parseFrontmatter(readFileSync(skillPath, 'utf8'))
    skills.push({ dir, name: fields.name, description: flattenDescription(fields.description ?? '') })
  }
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ skills }, null, 2)}\n`)
  console.log(`  ✓ manifest.json (${skills.length} 技能)`)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

console.log(`KSkills 适配: ${SRC} → ${OUT}`)
if (!existsSync(SRC)) {
  console.error(`错误: KSkills 仓库不存在（--src 指定）: ${SRC}`)
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
for (const name of ADAPTED_SKILLS) adaptSkill(name)
regenerateManifest()
console.log('完成。')
