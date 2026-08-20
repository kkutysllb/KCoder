/**
 * 技能目录枚举：设置「技能」面板的数据源（纯文件系统静态枚举）。
 *
 * 按来源分区，与插件页严格分开（插件=引擎组成层；技能=提示词能力包，
 * 模型按 description 匹配加载或用户 `/name` 调用）：
 *
 * - builtin：@kcoder/skills-bundle 随包分发的核心批（读 bundle 源的
 *   skills/manifest.json，不依赖 dsh 是否已物化）
 * - optional：bundle 的 skills/optional/ 长尾批（随包但不注册，
 *   零目录税；拷到 ~/.dsh/skills/<name>/ 即启用）
 * - project：当前工作区 `.dsh/skills` / `.agents/skills`（dsh rank 100/200）
 * - user：`$DSH_HOME/skills`（rank 400）与 `~/.agents/skills`（rank 500，
 *   agents.md 生态跨工具共享目录——Claude Code 等同样读取）
 *
 * 目录约定与上游 skill-filesystem 一致：根下一层目录，每个子目录含
 * SKILL.md（YAML frontmatter name+description）。frontmatter 用行级极简
 * 解析（仅取顶层标量与 >- 折叠块；嵌套字段如 hooks 直接跳过——枚举
 * 不消费它们）。正文读取走白名单：只放行上次枚举命中的 SKILL.md 路径。
 *
 * @module desktop/main/skills-catalog
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { dshHome } from './dsh-contract'
import { bundleSource } from './kcoder-skills-bundle'
import { fileActivity } from './file-activity'
import type { SkillCatalogEntry, SkillCatalogGroup } from '@shared/ipc-contract'

/** 最近一次枚举命中的 SKILL.md 绝对路径集合（read 白名单）。 */
let knownPaths = new Set<string>()

/** 最近一次枚举的 optional 条目路径集合（enable 白名单）。 */
let optionalPaths = new Set<string>()

/** 行级解析 frontmatter 的 name/description（标量或 >- 折叠块）。 */
function parseNameDescription(raw: string): { name: string; description: string } {
  let name = ''
  let description = ''
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---\n', 4)
    if (end !== -1) {
      const lines = raw.slice(4, end).split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = /^(name|description):\s*(.*)$/.exec(lines[i])
        if (m === null) continue
        const [, key, value] = m
        if (value !== '' && !/^[>|][+-]?$/.test(value)) {
          if (key === 'name') name = value
          else description = value
        } else {
          // 折叠块：收集后续缩进行
          const folded: string[] = []
          for (let j = i + 1; j < lines.length && (lines[j] === '' || /^\s+\S/.test(lines[j])); j++) {
            if (lines[j].trim() !== '') folded.push(lines[j].trim())
          }
          if (key === 'name') name = folded.join(' ')
          else description = folded.join(' ')
          i += folded.length
        }
      }
    }
  }
  return { name, description: description.replace(/\s+/g, ' ').trim() }
}

/** 扫一个技能根目录（一层目录，子目录含 SKILL.md 即收录）。 */
function scanRoot(
  root: string,
  source: SkillCatalogEntry['source'],
  out: SkillCatalogEntry[],
): void {
  let dirs: string[]
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
  } catch {
    return // 根不存在或不可读：正常空态
  }
  for (const dir of dirs) {
    const skillPath = join(root, dir, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    try {
      const { name, description } = parseNameDescription(readFileSync(skillPath, 'utf8'))
      if (name === '' || description === '') continue // 上游同样忽略缺 name/description 的文件
      out.push({ name, description, source, path: skillPath })
    } catch {
      // 单个文件读失败不拖垮整个面板
    }
  }
}

/**
 * 枚举全部技能（三来源分区）。每次调用重建白名单。
 */
export function listSkills(): SkillCatalogGroup[] {
  const entries: SkillCatalogEntry[] = []

  // 1) KCoder 内置：bundle 源 manifest 是单一事实源（含版本）
  const builtin: SkillCatalogEntry[] = []
  try {
    const bundleDir = join(bundleSource(), 'skills')
    const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8')) as {
      skills: Array<{ dir: string; name: string; description: string }>
    }
    for (const item of manifest.skills) {
      const skillPath = join(bundleDir, item.dir, 'SKILL.md')
      if (existsSync(skillPath)) {
        builtin.push({ name: item.name, description: item.description, source: 'builtin', path: skillPath })
      }
    }
  } catch {
    // bundle 源缺失（异常环境）：内置区空态
  }
  // 2) 工作区项目技能（file-activity 的 activeKey 是桌面端跟踪用户
  //    所开工作区的既有真相点，与 git 面板扫描 plans 同源）
  const ws = fileActivity.activeKey()
  if (ws !== '') {
    scanRoot(join(ws, '.dsh/skills'), 'project', entries)
    scanRoot(join(ws, '.agents/skills'), 'project', entries)
  }

  // 3) 用户全局（DSH_HOME 专属 + agents.md 共享）
  scanRoot(join(dshHome(), 'skills'), 'user', entries)
  scanRoot(join(homedir(), '.agents', 'skills'), 'shared', entries)

  // 4) 可选批最后扫（要拿生效层做基准）：bundle 的 optional/ 目录
  //    随包但不进 manifest，拷到用户/工作区才被 dsh 发现；启用是复制
  //    不是移动，源目录残留——已装到生效层的同名条目剔除，
  //    否则刷新后「未启用」区原地残留同一技能造成两区重复显示
  const active = new Set(entries.map((e) => e.name))
  const optional: SkillCatalogEntry[] = []
  scanRoot(join(bundleSource(), 'skills', 'optional'), 'optional', optional)
  const enabledOptional = optional.filter((e) => !active.has(e.name))

  knownPaths = new Set([...builtin, ...enabledOptional, ...entries].map((e) => e.path))
  optionalPaths = new Set(enabledOptional.map((e) => e.path))

  const groups: SkillCatalogGroup[] = [
    { id: 'builtin', title: 'KCoder 内置（已启用）', entries: builtin },
    { id: 'project', title: '工作区项目技能', entries: entries.filter((e) => e.source === 'project') },
    { id: 'user', title: '用户全局技能', entries: entries.filter((e) => e.source === 'user' || e.source === 'shared') },
    { id: 'optional', title: '未启用（随包可选）', entries: enabledOptional },
  ]
  return groups
}

/**
 * 读一份 SKILL.md 正文（剥 frontmatter）。白名单：只放行枚举命中的路径。
 */
export function readSkillBody(path: string): string | null {
  if (!knownPaths.has(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    if (!raw.startsWith('---\n')) return raw
    const end = raw.indexOf('\n---\n', 4)
    return end === -1 ? raw : raw.slice(end + 5).replace(/^\n+/, '')
  } catch {
    return null
  }
}

/**
 * 启用一个 optional 技能：拷到 $DSH_HOME/skills/<name>/（用户全局）。
 * 白名单：只放行枚举到的 optional 条目（页面按钮点出来的路径）。
 * 目标已存在时先删再拷（cpSync 对已存在目录会把源拷进里面，
 * 同 shell cp -R 分叉坑）；父目录 mkdir -p 兜住首次启用。
 */
export function enableOptionalSkill(path: string): boolean {
  if (!optionalPaths.has(path)) return false
  const src = dirname(path)
  const target = join(dshHome(), 'skills', basename(src))
  try {
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(src, target, { recursive: true })
    return true
  } catch {
    return false
  }
}
