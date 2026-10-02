/**
 * 技能目录枚举：设置「技能」面板的数据源（纯文件系统静态枚举）。
 *
 * 按来源分区，与插件页严格分开（插件=引擎组成层；技能=提示词能力包，
 * 模型按 description 匹配加载或用户 `/name` 调用）：
 *
 * - builtin：dsh-skills-bundle 随包分发的核心批（读 bundle 源的
 *   skills/manifest.json，不依赖 dsh 是否已物化）
 * - optional：bundle 的 skills/optional/ 长尾批（随包但不注册，
 *   零目录税；拷到 ~/.kcoder/skills/<name>/ 即启用）
 * - project：当前工作区 `.dsh/skills` / `.agents/skills`（dsh rank 100/200）
 * - user：`$DSH_HOME/skills`（rank 400）与 `~/.agents/skills`（rank 500，
 *   agents.md 生态跨工具共享目录——Claude Code 等同样读取）
 * - disabled：已停用暂存（`$DSH_HOME/skills-disabled/<来源>/<名>/`，引擎
 *   不扫描所以不生效；「停用 = 移出扫描根」的设计依据见 disabledRoot 注释）
 *
 * 目录约定与上游 skill-filesystem 一致：根下一层目录，每个子目录含
 * SKILL.md（YAML frontmatter name+description）。frontmatter 用行级极简
 * 解析（仅取顶层标量与 >- 折叠块；嵌套字段如 hooks 直接跳过——枚举
 * 不消费它们）。正文读取走白名单：只放行上次枚举命中的 SKILL.md 路径。
 *
 * @module desktop/main/skills-catalog
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
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

/** 最近一次枚举的用户/共享条目路径集合（停用白名单）。 */
let disablePaths = new Set<string>()

/** 最近一次枚举的已停用条目路径集合（恢复白名单）。 */
let parkedPaths = new Set<string>()

/**
 * 已停用技能的暂存根（停车场）：`$DSH_HOME/skills-disabled/<来源>/<名>/`。
 *
 * 上游引擎没有技能级禁用机制——skill-filesystem 只按固定根扫描
 * （$DSH_HOME/skills rank 400、~/.agents/skills rank 500，无 ignore
 * 列表、**也不跳过点目录**，仅 user-dsh 根特判 .system），所以「停用」
 * 唯一可靠实现是把技能目录**移出扫描根**：引擎 watcher 观察到 unlinkDir
 * 即时失效，会话内技能列表同步收缩；文件原样保留，随时可恢复。
 * 停车场选扫描根的**兄弟目录**而非根内点目录（.disabled/）——点目录
 * 上游照样发现（无过滤），只有根外才真正不可见。二级子目录编码来源
 * （user = $DSH_HOME/skills、shared = ~/.agents/skills），恢复时按布局
 * 归位，无需额外元数据文件。Claude Code 等共享 ~/.agents/skills 的工具
 * 同样只扫 skills 本身，兄弟目录对它们也是惰性的。
 */
function disabledRoot(origin: 'user' | 'shared'): string {
  return join(dshHome(), 'skills-disabled', origin)
}

/** 移动一个目录（rename 优先；跨设备 fallback 拷删）。目标必须不存在。 */
function moveDir(src: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true })
  try {
    renameSync(src, target)
  } catch {
    // EXDEV（跨卷）等：拷贝后删源；拷贝失败则源保持原状（停用未发生）
    cpSync(src, target, { recursive: true })
    rmSync(src, { recursive: true, force: true })
  }
}

/**
 * 行级解析 frontmatter 的 name/description（标量或 >- 折叠块）。
 *
 * 行尾容错：CRLF/CR 统一归一为 LF——Windows runner 打包（checkout
 * autocrlf 转换）与本地 Windows clone/手动编辑的 SKILL.md 均可为
 * CRLF，而解析与正文剥壳均按 LF 写（startsWith('---\n') 等字面匹配
 * 遇 '\r' 直接失败 → 整个 optional 分区条目全跳过，v0.2.9 Windows
 * 打包版「未启用（随包可选）」区空的根因；macOS 包 LF 不受影响）。
 */
function parseNameDescription(raw: string): { name: string; description: string } {
  if (raw.includes('\r')) raw = raw.split('\r\n').join('\n').split('\r').join('\n')
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
    const bundleDir = join(bundleSource('dsh-skills-bundle'), 'skills')
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

  // 4) 已停用（停车场，引擎不扫描所以不生效）：按来源舱扫描
  const parked: SkillCatalogEntry[] = []
  scanRoot(disabledRoot('user'), 'disabled', parked)
  scanRoot(disabledRoot('shared'), 'disabled', parked)

  // 5) 可选批最后扫（要拿生效层做基准）：bundle 的 optional/ 目录
  //    随包但不进 manifest，拷到用户/工作区才被 dsh 发现；启用是复制
  //    不是移动，源目录残留——已装到生效层的同名条目剔除，
  //    否则刷新后「未启用」区原地残留同一技能造成两区重复显示。
  //    基准含停车场同名条目：已停用的技能不算「未启用」，否则「恢复」
  //    与「启用」两颗按钮会在两个分区同时指向同一技能
  const active = new Set([...entries, ...parked].map((e) => e.name))
  const optional: SkillCatalogEntry[] = []
  scanRoot(join(bundleSource('dsh-skills-bundle'), 'skills', 'optional'), 'optional', optional)
  const enabledOptional = optional.filter((e) => !active.has(e.name))

  const userEntries = entries.filter((e) => e.source === 'user' || e.source === 'shared')
  knownPaths = new Set([...builtin, ...enabledOptional, ...entries, ...parked].map((e) => e.path))
  optionalPaths = new Set(enabledOptional.map((e) => e.path))
  disablePaths = new Set(userEntries.map((e) => e.path))
  parkedPaths = new Set(parked.map((e) => e.path))

  const groups: SkillCatalogGroup[] = [
    { id: 'builtin', title: 'KCoder 内置（已启用）', entries: builtin },
    { id: 'project', title: '工作区项目技能', entries: entries.filter((e) => e.source === 'project') },
    { id: 'user', title: '用户全局技能', entries: userEntries },
    { id: 'disabled', title: '已停用（可恢复）', entries: parked },
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
    let raw = readFileSync(path, 'utf8')
    if (raw.includes('\r')) raw = raw.split('\r\n').join('\n').split('\r').join('\n') // 同 parseNameDescription：CRLF 容错
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

/**
 * 停用一个用户/共享技能：整个目录移入 $DSH_HOME/skills-disabled/<来源>/<名>/。
 * 白名单：只放行枚举到的用户/共享条目（页面按钮点出来的路径）；移动而非
 * 删除——技能文件原样保留，「停用」可逆。来源按路径所处扫描根判定，与
 * 停车场二级子目录一一对应（恢复归位的依据）。目标同名已存在（上次停用
 * 后又重建/装回同名技能）→ 拒绝，返回 false（不覆盖暂存数据）。
 */
export function disableUserSkill(path: string): boolean {
  if (!disablePaths.has(path)) return false
  const src = dirname(path)
  const skillRoot = dirname(src)
  const origin = skillRoot === join(dshHome(), 'skills') ? 'user' : 'shared'
  const target = join(disabledRoot(origin), basename(src))
  if (existsSync(target)) return false
  try {
    moveDir(src, target)
    return true
  } catch {
    return false
  }
}

/**
 * 恢复一个已停用技能：从停车场移回来源目录（user → $DSH_HOME/skills、
 * shared → ~/.agents/skills，目录布局即来源）。白名单：只放行枚举到的
 * 已停用条目。生效层同名已存在 → 拒绝（不覆盖现役技能），返回 false。
 */
export function restoreDisabledSkill(path: string): boolean {
  if (!parkedPaths.has(path)) return false
  const src = dirname(path)
  const origin = basename(dirname(src))
  if (origin !== 'user' && origin !== 'shared') return false
  const targetRoot = origin === 'user' ? join(dshHome(), 'skills') : join(homedir(), '.agents', 'skills')
  const target = join(targetRoot, basename(src))
  if (existsSync(target)) return false
  try {
    moveDir(src, target)
    return true
  } catch {
    return false
  }
}
