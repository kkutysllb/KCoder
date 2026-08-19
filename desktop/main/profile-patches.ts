/**
 * 上游插件缺陷补丁（profiles/web/patches）的跨平台物化。
 *
 * 已覆盖：
 * - dsh-plugin-genui：卡片注册漏传 key + node half 不注册 settings
 *   namespace 两个上游缺陷（npm 最新版同样存在）
 * - dsh-context：node half 缓存失败缺陷（projection 状态残留），修复版
 *   与 npm 原版快照分别归档于 .patches/dsh-context-fix（应用版）与
 *   .patches/dsh-context（原版），patch 由此生成
 *
 * 补丁经 pnpm patchedDependencies（name-only 声明）固化在用户 profile：
 * 上游任意版本安装/升级时 pnpm 都会尝试应用，应用失败静默跳过（插件
 * 裸装，报错横幅提示需更新 patch）。
 *
 * macOS 上靠 launchd 定时任务同步；Windows 无此机制，且 0.1.5 之前
 * 的安装包根本不随包分发 patch——本模块补上：app 启动时（dsh 启动
 * 前）幂等物化 patch 文件 + 声明到 $DSH_HOME/profiles/web，插件已装
 * 但补丁未生效时触发一次 pnpm install 应用。任何失败只记日志不抛——
 * 补丁缺席时 dsh 仍可正常启动。
 *
 * 源目录：开发态 `PROJECT_ROOT/profiles/web/patches`；打包态
 * `resources/profile-patches`（electron-builder extraResources 物化）。
 *
 * @module desktop/main/profile-patches
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'

/** 分发的 patch 源目录（开发态仓库内；打包态 extraResources）。 */
function patchSource(): string {
  const packaged = join(process.resourcesPath ?? PROJECT_ROOT, 'profile-patches')
  if (existsSync(packaged)) return packaged
  return join(PROJECT_ROOT, 'profiles', 'web', 'patches')
}

/** 源目录内全部 patch 文件（`pkg@version.patch` 命名，可多包多版本）。 */
function patchFiles(source: string): string[] {
  return readdirSync(source).filter((f) => f.endsWith('.patch'))
}

/**
 * 各插件补丁的生效特征：node half 文件包含标记串即视为补丁已应用。
 * 与 scripts/update-profile-plugins.mjs 的校验保持一致（两处新增插件
 * 补丁时同步更新）。
 */
const PATCH_MARKS: Record<string, Array<[file: string, mark: string]>> = {
  'dsh-plugin-genui': [
    ['lib/client.js', 'key: "genui-design"'],
    ['lib/index.js', 'ctx.settings.register("genui-design"'],
    // inject 数组的 "settings"（ctx.settings 可用的必要条件，缺失时
    // register 反而会造成新的运行时错误）
    ['lib/index.js', '"agents",\n\t"settings"'],
  ],
  // 修复版用 delete 清理投影状态；原版为置 undefined（缓存残留根因）
  'dsh-context': [['lib/index.js', 'delete st.pendingShadowedSeqs']],
}

/**
 * mark 缺失时的锄点注入兑底（与 patch 内容等价；pnpm patch 机制在任何
 * 平台/版本下静默失败时的第三层保险——锄不中或多处命中则跳过留警告，
 * 绝不盲改）。锄点基于当前锁定版本（genui 0.12.2 唯一版）的产物字节。
 */
interface PatchFallback {
  pkg: string
  file: string
  /** 生效特征（已含则跳过，幂等） */
  mark: string
  /** 锄子串（须在文件中恰好出现一次） */
  anchor: string
  /** 锄后插入（含前导换行）；或整段替换 */
  inject?: string
  replace?: string
}

const PATCH_FALLBACKS: PatchFallback[] = [
  {
    pkg: 'dsh-plugin-genui', file: 'lib/client.js',
    mark: 'key: "genui-design"',
    anchor: 'name: "settings.plugin.item",',
    inject: '\n\t\t\tkey: "genui-design",',
  },
  {
    pkg: 'dsh-plugin-genui', file: 'lib/index.js',
    mark: 'ctx.settings.register("genui-design"',
    anchor: 'async function apply(ctx, config) {',
    inject: '\n\tctx.settings.register("genui-design", z.object({}), { applies: "live" });',
  },
  {
    pkg: 'dsh-plugin-genui', file: 'lib/index.js',
    mark: '"agents",\n\t"settings"',
    anchor: '"webServer",\n\t"agents"',
    replace: '"webServer",\n\t"agents",\n\t"settings"',
  },
  {
    pkg: 'dsh-context', file: 'lib/index.js',
    mark: 'delete st.pendingShadowedSeqs',
    anchor: 'st.pendingShadowedSeqs = void 0;',
    replace: 'delete st.pendingShadowedSeqs;',
  },
]

/**
 * 锄点注入兑底：逐规则校验 mark，缺失且锄唯一命中时直接改写
 * node_modules 内的产物文件（hoisted 实体文件，pnpm 不校验内容）。
 * 任何不确定（锄 0 处/多 处/读写失败）都跳过——宁可裸装报错也不盲改。
 */
function enforcePatchFallbacks(profileDir: string): void {
  for (const rule of PATCH_FALLBACKS) {
    const file = join(profileDir, 'node_modules', rule.pkg, rule.file)
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // 插件未装/文件缺失：不适用
    }
    if (text.includes(rule.mark)) continue
    const hits = text.split(rule.anchor).length - 1
    if (hits !== 1) {
      console.warn(`[profile-patches] 兑底注入跳过（锄点 ${hits} 处命中）：${rule.pkg}/${rule.file}`)
      continue
    }
    const next = rule.replace !== undefined
      ? text.replace(rule.anchor, rule.replace)
      : text.replace(rule.anchor, rule.anchor + (rule.inject ?? ''))
    try {
      writeFileSync(file, next)
      console.log(`[profile-patches] 已兑底注入：${rule.pkg}/${rule.file}`)
    } catch (error) {
      console.warn(`[profile-patches] 兑底注入写入失败（${rule.pkg}/${rule.file}）：`, error)
    }
  }
}

/**
 * 补丁是否已生效：逐 patch 按包名特征校验；插件未安装视为已满足
 * （后续 dsh plugin install 时 pnpm 会自动应用 name-only 补丁）。
 */
function patchApplied(profileDir: string, files: string[]): boolean {
  for (const f of files) {
    const pkg = f.replace(/@[^@]+\.patch$/, '')
    const marks = PATCH_MARKS[pkg]
    if (!marks) continue
    const modDir = join(profileDir, 'node_modules', pkg)
    if (!existsSync(modDir)) continue
    for (const [rel, mark] of marks) {
      const file = join(modDir, rel)
      if (!existsSync(file) || !readFileSync(file, 'utf8').includes(mark)) return false
    }
  }
  return true
}

/** 幂等声明 patchedDependencies（name-only），缺失条目逐条补写。返回是否就位。 */
function ensurePatchDeclared(profileDir: string, names: string[]): boolean {
  const yamlPath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(yamlPath)) return false
  let yaml = readFileSync(yamlPath, 'utf8')
  const missing = names.filter(
    (n) => !yaml.includes(`\n  ${n.replace(/@[^@]+\.patch$/, '')}: patches/`),
  )
  if (missing.length === 0) return true
  const entries = missing.map((n) => `  ${n.replace(/@[^@]+\.patch$/, '')}: patches/${n}`).join('\n')
  const m = yaml.match(/^patchedDependencies:\n(?:[ \t].*\n?)*/m)
  if (m) {
    // 已有块（如旧版仅 genui）：新条目追加到块尾（replace 避免 m[0]
    // 与文件头的偏移错位）
    yaml = yaml.replace(m[0], `${m[0]}${entries}\n`)
  } else {
    const anchor = 'nodeLinker: hoisted\n'
    if (!yaml.includes(anchor)) return false
    // 声明块逐 patch 生成：name-only（不锁版本）→ 上游任意版本都尝试应用
    yaml = yaml.replace(
      anchor,
      `${anchor}patchedDependencies:
  # 上游插件缺陷补丁（app 启动幂等物化）：name-only 声明，上游任意版本
  # 都尝试应用；应用失败时 pnpm 静默跳过（插件裸装，报错横幅会提示）。
${entries}
`,
    )
  }
  writeFileSync(yamlPath, yaml)
  return true
}

/**
 * 幂等物化（dsh 启动前调用）：patch 文件 + 声明就位；插件已装但补丁
 * 未生效时跑一次 pnpm install 应用（PATH 增强在 index.ts 入口完成）。
 */
export function ensureProfilePatches(): void {
  try {
    const source = patchSource()
    const files = patchFiles(source)
    if (files.length === 0) {
      console.warn('[profile-patches] patch 源缺失，跳过物化:', source)
      return
    }
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    if (!existsSync(join(profileDir, 'pnpm-workspace.yaml'))) {
      console.warn('[profile-patches] profile 尚未初始化（pnpm-workspace.yaml 缺失），跳过')
      return
    }
    // 1) patch 文件物化（幂等：直接覆盖，文件小且内容稳定）。
    //    落盘后行尾归一化为 LF：Windows CI 的 git autocrlf 可能把源转成
    //    CRLF，而 npm 包文件是 LF，CRLF patch 无法应用（v0.1.9 Windows
    //    插件加载失败根因的兑底；根治靠 .gitattributes）
    mkdirSync(join(profileDir, 'patches'), { recursive: true })
    for (const f of files) {
      const dest = join(profileDir, 'patches', f)
      copyFileSync(join(source, f), dest)
      const raw = readFileSync(dest, 'utf8')
      const lf = raw.replace(/\r\n/g, '\n')
      if (lf !== raw) {
        writeFileSync(dest, lf)
        console.warn(`[profile-patches] ${f} 行尾已归一化为 LF（源疑似 CRLF）`)
      }
    }
    // 2) patchedDependencies 声明（幂等）
    if (!ensurePatchDeclared(profileDir, files)) {
      console.warn('[profile-patches] 声明写入失败（缺 nodeLinker: hoisted 锚点），跳过')
      return
    }
    // 3) 生效校验：插件已装但补丁未生效 → 一次性 install 应用；
    //    插件未装则声明就位即可（后续 dsh plugin install 时 pnpm 自动应用）。
    //    pnpm 经 dsh-contract.runPnpm（vendor 实体优先 + win32 shell）。
    //    install 重试后仍未生效（patch 机制静默失败）→ 锄点注入兑底
    if (patchApplied(profileDir, files)) return
    console.log('[profile-patches] 插件已装但补丁未生效，执行 pnpm install 应用补丁 …')
    const r = runPnpm(['install'], profileDir, 600_000)
    if (r.status !== 0) {
      console.error('[profile-patches] pnpm install 失败:', r.stderr?.slice(0, 2000) ?? r.error)
    }
    if (!patchApplied(profileDir, files)) {
      console.warn('[profile-patches] pnpm patch 未生效，执行锄点兑底注入 …')
      enforcePatchFallbacks(profileDir)
    }
  } catch (error) {
    console.error('[profile-patches] 物化失败:', error)
  }
}
