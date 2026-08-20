#!/usr/bin/env node
/**
 * KSkills → kcoder-skills bundle 适配脚本（两档分发）。
 *
 * 从本地 KSkills 仓库（默认 ~/kk_Projects/KSkills）选取知识型技能，
 * dsh 兼容清洗后物化到 bundle/kcoder-skills/skills/：
 *
 * - 核心批 → skills/<name>/，进 manifest.json（entry.js 注册生效，
 *   目录常驻会话上下文）
 * - 可选批 → skills/optional/<name>/，不进 manifest（不注册、零目录税；
 *   技能面板「未启用」分区展示，拷到 ~/.dsh/skills/<name>/ 即启用）
 * - office 批 → 源在 KSkills/office/ 的「知识+脚本」型技能（docx/
 *   xlsx/pptx/pdf），整资源物化到 skills/optional/：SKILL.md 清洗 +
 *   scripts/references/LICENSE 原样拷贝（启用后 agent 可直接执行
 *   scripts/*.py，离线纯本地，替代云端 LLM 驱动的 officecli 插件）
 *
 * 批次划分：核心 = 高频通用场景（实现/调试/评审/架构/类型/前端…）；
 * 可选 = 长尾域（特定后端/运维/文档/流程）；排除 = 语言变体、Claude/
 * Vercel/创作生态专属、QiongQi 专属工作流、浅重叠中文轻量批。
 *
 * 处理规则：
 * - frontmatter 仅保留 name / description（展平为单行——entry.js 端不解析
 *   YAML，元数据走 manifest.json 单一事实源）
 * - 正文剥 Claude Code 生态残留：powershell 代码块、含 Claude Code /
 *   ${CLAUDE_PLUGIN_ROOT} / ~/.claude 引用的整行
 * - QiongQi 工具名映射到 dsh 真实工具：search_code→grep、
 *   find_files→glob、read_file_lines→read（web_search 同名）
 * - 计划落点约定对齐：docs/superpowers/plans/ → plans/（git 面板扫描约定）
 *
 * 注意：planning-with-files 不在本脚本清单内——它是耦合 KCoder 单文件
 * plans/ 约定的手写深度改编版，由 bundle 内直接维护；KSkills 上游更新
 * 后需人工比对方法论差异。
 *
 * 用法：
 *   node scripts/adapt-kskills.mjs [--src /path/to/KSkills]
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename, extname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 机械清洗的核心批（进 manifest，注册生效）。 */
const CORE_SKILLS = [
  // ④ 自研英文方法论批（计划/评审/子代理/git 流）
  'test-driven-development',
  'subagent-driven-development',
  'dispatching-parallel-agents',
  'using-git-worktrees',
  'brainstorming',
  'requesting-code-review',
  'receiving-code-review',
  'finishing-a-development-branch',
  'webapp-testing',
  // ⑤ 自研工程短批（高频通用域）
  'implement',
  'refactor',
  'debug',
  'test-writer',
  'architecture',
  'api-design',
  'technical-design',
  'codebase-analysis',
  'diff-analysis',
  'requirements-analysis',
  'typescript',
  'frontend-engineering',
  'react-nextjs',
  'error-handling',
  'performance',
  'security-hardening',
  'release-engineering',
]

/** 可选批（物化到 skills/optional/，不进 manifest 不注册）。 */
const OPTIONAL_SKILLS = [
  // 特定技术域
  'database',
  'migration',
  'fastapi-backend',
  'state-management',
  'ui-polish',
  'web-accessibility',
  'vertical-slice-development',
  // 构建/运维链
  'ci-cd',
  'deployment',
  'rollback-recovery',
  'build-system',
  'dependency-upgrade',
  'environment-setup',
  'project-scaffolding',
  'patch-authoring',
  'observability',
  // 流程/文档域
  'product-spec',
  'qa-test-plan',
  'acceptance-criteria',
  'handoff-docs',
  'docs',
  'internal-comms',
  'workflow-automation',
  'operations-runbook',
  'context-management',
  'project-delivery-workflow',
  'pr-review-advanced',
  // 轻量工具型（与 dsh 原生工具契合，按需启用）
  'todo',
  'web',
  'goal',
  'frontend-design',
  'web-design-guidelines',
]

/** office 批：整资源技能（源在 office/ 子目录），物化到 optional/。
 * docx/xlsx/pptx/pdf 离线 Office+PDF 操作（scripts/*.py）；doc-coauthoring
 * 结构化文档协作；slidev Markdown 开发者幻灯片；slack-gif-creator GIF
 * 创作（core/*.py）；microsoft-foundry Azure azd 部署域（references）。 */
const OFFICE_SKILLS = [
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'doc-coauthoring',
  'slidev',
  'slack-gif-creator',
  'microsoft-foundry',
]

/** 整拷时排除的文件（Claude 插件机制产物 / 系统杂 file）。 */
const OFFICE_EXCLUDE = new Set(['install.sh', 'uninstall.sh', 'CHANGELOG.md', '.DS_Store'])

/** media 批：多媒体生成技能（源在 media/ 子目录），整资源物化并进
 * manifest（内置注册生效，开箱即用）。脚本调用的多模态模型凭据
 * 由桌面端「设置 → 技能 → 多媒体模型」统一配置，dsh 启动时从
 * $DSH_HOME/media-models.env 注入进程环境（见 media-models.ts）。 */
const MEDIA_SKILLS = [
  'image-generation',
  'video-generation',
  'music-generation',
  'podcast-generation',
  'comic',
]

/** research 批：研究方法论（knowledge-only，源在 research/ 子目录）。 */
const RESEARCH_SKILLS = ['deep-research']

/** manifest 中的固定顺序（手写版 + 旧清洗批 + 核心批 + 多媒体/研究批）。 */
const MANIFEST_ORDER = [
  'planning-with-files',
  'task-decomposition',
  'writing-plans',
  'executing-plans',
  'verification-before-completion',
  ...CORE_SKILLS,
  ...MEDIA_SKILLS,
  ...RESEARCH_SKILLS,
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

/** QiongQi 工具名 → dsh 真实工具名（docs/tool-catalog.md 对照）。 */
const TOOL_NAME_MAP = {
  search_code: 'grep',
  find_files: 'glob',
  read_file_lines: 'read',
}

function cleanBody(body) {
  // 1) 整块删除 powershell 代码围栏（含 fence 行之间全部内容）
  let out = body.replace(/```powershell[\s\S]*?```\n?/g, '')
  // 2) 删除含 Claude 生态残留的整行（句中引用平台/路径即失效语境）
  out = out
    .split('\n')
    .filter((line) =>
      !/claude[_ ]?code|CLAUDE_PLUGIN_ROOT|~\/\.claude|\$HOME\/\.claude|superpowers:/i.test(line))
    .join('\n')
  // 3) QiongQi 工具名映射（反引号包裹与裸文本两种形态）
  for (const [from, to] of Object.entries(TOOL_NAME_MAP)) {
    out = out.replaceAll(`\`${from}\``, `\`${to}\``).replaceAll(from, to)
  }
  // 4) 计划落点约定对齐（KCoder git 面板扫描 plans/ 一层目录）
  out = out.replaceAll('docs/superpowers/plans/', 'plans/')
  // 5) 压掉 3+ 连续空行（删块残留）
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trimEnd() + '\n'
}

// ── 适配产出 ────────────────────────────────────────────────────────────────

/** bundle 物化后的技能根（$DSH_HOME 由 KCoder 主进程预置并随 dsh
 * 进程传给 agent 的 bash，双引号内可展开；resourceBase 同指此处）。 */
const BUNDLE_SKILLS = '$DSH_HOME/profiles/web/node_modules/@kcoder/skills-bundle/skills'

/** media 技能正文头部的环境说明（桌面端统一配置，免手动 export）。 */
const MEDIA_ENV_NOTE = [
  '> **KCoder 桌面端**：本技能依赖的多模态模型凭据（API Key / Base URL /',
  '> 模型名）由桌面端统一配置并注入进程环境——在「设置 → 技能 → 多媒体',
  '> 模型」分区填写即可，无需手动 export。脚本按内置优先级选择已配置',
  '> 的 provider；均未配置时按各脚本自带的默认值与报错引导处理。',
  '',
].join('\n')

/** 多媒体技能正文本地化：云端沙箱路径 → 本地物化路径，并清掉云端
 * 专属的工具引用行。在通用 cleanBody 之后应用。 */
function cleanMediaBody(name, body) {
  let out = body
    .split('\n')
    .filter((line) =>
      // 云端专属指令：present_files 工具 / 检查 /mnt/user-data 目录的提示
      !/present_files|check the folder under/.test(line))
    .join('\n')
  out = out.replaceAll(`/mnt/skills/public/${name}/`, `${BUNDLE_SKILLS}/${name}/`)
  out = out.replaceAll('/mnt/skills/public/', `${BUNDLE_SKILLS}/`)
  out = out.replaceAll('/mnt/user-data/workspace/', './')
  out = out.replaceAll('/mnt/user-data/outputs/', './outputs/')
  out = out.replaceAll('/mnt/user-data/', './')
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** media 技能的文本资源（templates/ 等）同样做云端路径本地化。
 * 只处理小体积文本类型（SKILL.md 已在正文清洗里覆盖）。 */
const LOCALIZE_EXTS = new Set(['.md', '.json', '.txt', '.yaml', '.yml'])

function localizeMediaAssets(name, destDir) {
  for (const rel of readdirSync(destDir, { recursive: true })) {
    const p = join(destDir, String(rel))
    const st = statSync(p)
    if (!st.isFile() || st.size > 512 * 1024) continue
    if (!LOCALIZE_EXTS.has(extname(p))) continue
    const text = readFileSync(p, 'utf8')
    const next = text
      .replaceAll(`/mnt/skills/public/${name}/`, `${BUNDLE_SKILLS}/${name}/`)
      .replaceAll('/mnt/skills/public/', `${BUNDLE_SKILLS}/`)
      .replaceAll('/mnt/user-data/workspace/', './')
      .replaceAll('/mnt/user-data/outputs/', './outputs/')
      .replaceAll('/mnt/user-data/', './')
    if (next !== text) {
      writeFileSync(p, next)
      console.log(`    \u00b7 ${rel} \u8def\u5f84\u672c\u5730\u5316`)
    }
  }
}

function adaptSkill(name, subdir = '') {
  const srcPath = join(SRC, 'coding', name, 'SKILL.md')
  if (!existsSync(srcPath)) throw new Error(`KSkills 源缺失: ${srcPath}`)
  const { fields, body } = parseFrontmatter(readFileSync(srcPath, 'utf8'))
  if (fields.name !== name) throw new Error(`name 不一致: ${fields.name} vs ${name}`)
  const description = flattenDescription(fields.description ?? '')
  if (description === '') throw new Error(`${name}: description 为空`)
  const cleaned = cleanBody(body)
  const destDir = join(OUT, subdir, name)
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  writeFileSync(
    join(destDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${cleaned}`,
  )
  console.log(`  ✓ ${subdir ? 'optional/' : ''}${name} (${cleaned.split('\n').length} 行正文)`)
}

/** 整资源技能适配（源在子目录的批次）：SKILL.md 清洗 + 其余资源整拷
 * （scripts/references/templates/LICENSE）。manifest=true 物化到 skills/
 * 根（进 manifest，注册生效）；false 物化到 optional/（随包不注册）。 */
function adaptResourceSkill(name, srcSub, { manifest = false, clean = 'plain', note = '' } = {}) {
  const srcDir = join(SRC, srcSub, name)
  const srcPath = join(srcDir, 'SKILL.md')
  if (!existsSync(srcPath)) throw new Error(`KSkills 源缺失: ${srcPath}`)
  const { fields, body } = parseFrontmatter(readFileSync(srcPath, 'utf8'))
  if (fields.name !== name) throw new Error(`name 不一致: ${fields.name} vs ${name}`)
  const description = flattenDescription(fields.description ?? '')
  if (description === '') throw new Error(`${name}: description 为空`)
  const cleaned = clean === 'media' ? cleanMediaBody(name, cleanBody(body)) : cleanBody(body)
  const destDir = join(OUT, manifest ? '' : 'optional', name)
  rmSync(destDir, { recursive: true, force: true })
  mkdirSync(destDir, { recursive: true })
  cpSync(srcDir, destDir, {
    recursive: true,
    filter: (src) => !OFFICE_EXCLUDE.has(basename(src)),
  })
  writeFileSync(
    join(destDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${note}${cleaned}`,
  )
  const files = readdirSync(destDir, { recursive: true }).length
  if (clean === 'media') localizeMediaAssets(name, destDir)
  console.log(`  ✓ ${manifest ? '' : 'optional/'}${name} (${cleaned.split('\n').length} 行正文 + ${files} 个资源文件)`)
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
console.log('核心批（进 manifest，注册生效）:')
for (const name of ['task-decomposition', 'writing-plans', 'executing-plans', 'verification-before-completion']) adaptSkill(name)
for (const name of CORE_SKILLS) adaptSkill(name)
console.log('可选批（skills/optional/，不注册）:')
for (const name of OPTIONAL_SKILLS) adaptSkill(name, 'optional')
console.log('office 批（整资源，物化到 skills/optional/，不注册）:')
for (const name of OFFICE_SKILLS) adaptResourceSkill(name, 'office')
console.log('media 批（整资源，进 manifest，内置注册）:')
for (const name of MEDIA_SKILLS) adaptResourceSkill(name, 'media', { manifest: true, clean: 'media', note: MEDIA_ENV_NOTE })
console.log('research 批（knowledge-only，进 manifest，内置注册）:')
for (const name of RESEARCH_SKILLS) adaptResourceSkill(name, 'research', { manifest: true })
regenerateManifest()
console.log(`完成：核心 ${MANIFEST_ORDER.length} + 可选 ${OPTIONAL_SKILLS.length + OFFICE_SKILLS.length} = ${MANIFEST_ORDER.length + OPTIONAL_SKILLS.length + OFFICE_SKILLS.length} 技能。`)
