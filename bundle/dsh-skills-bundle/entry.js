// dsh-skills-bundle 胶水插件。
//
// 零依赖纯 ESM（对齐 dsh-vision-router 的 out-of-tree bundle 形态，
// 可被 profile node_modules 直接 resolve，无需构建步骤）。激活时同步
// 扫描包内 skills/manifest.json，逐个读取 SKILL.md 剥离 frontmatter 后
// 经 ctx.skills.register() 注册为 runtime skill；注册落在调用上下文的
// 全局层，对 profile 下所有 agent 会话可见（tool-skill 会话目录合入）。
// 同步 IO 仅在激活时发生一次，量级为 5 个小文件，不值得引异步时序。
//
// skill 元数据来源是 manifest.json 而非解析 frontmatter：manifest 由
// 适配脚本（scripts/adapt-kskills.mjs）与 SKILL.md 一并产出，单一事实
// 源，插件端无需 YAML 解析器。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'kcoder-skills'

/** 注册进 skill registry（ctx key: skills）。 */
export const inject = ['skills']

/** 包根（entry.js 所在目录）。 */
const ROOT = fileURLToPath(new URL('.', import.meta.url))

/** 技能内容目录。 */
const SKILLS_DIR = join(ROOT, 'skills')

/**
 * 剥离 SKILL.md 开头的 YAML frontmatter 块（--- 限界），返回正文。
 * 适配产物保证以 frontmatter 开头；无 frontmatter 时原样返回。
 */
function stripFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return raw
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return raw
  return raw.slice(end + 5).replace(/^\n+/, '')
}

/** 注册清单内全部技能；返回组合 disposer。 */
export function apply(ctx) {
  const manifest = JSON.parse(readFileSync(join(SKILLS_DIR, 'manifest.json'), 'utf8'))
  const disposers = []
  for (const item of manifest.skills) {
    const dir = join(SKILLS_DIR, item.dir)
    const content = stripFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'))
    disposers.push(ctx.skills.register({
      name: item.name,
      description: item.description,
      ...item.whenToUse === undefined ? {} : { whenToUse: item.whenToUse },
      source: 'runtime',
      content,
      // 正文引用的相对资源（如 templates/）按此基目录解析
      resourceBase: { kind: 'directory', path: dir },
    }))
  }
  // 激活诊断直走 stdout（与就绪行同通道；Cordis logger 在函数插件的
  // 简化 ctx 上未必就绪，且 info 级常被过滤）
  console.log(`kcoder-skills: ${disposers.length} runtime skills registered (${manifest.skills.map((s) => s.name).join(', ')})`)
  return () => { for (const dispose of disposers) dispose() }
}
