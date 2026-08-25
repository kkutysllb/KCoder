/**
 * 上游插件缺陷补丁（profiles/web/patches）的跨平台物化。
 *
 * 已覆盖：
 * - @dsh-external/dsh-drag-to-attachment：两处缺陷：
 *   1) wrap 的 sendSession 附件分支发送成功后无 return（resolve
 *      undefined）。rc.7 时代 defaultSink 是 fire-and-forget（void），
 *      无返回值无害；rc.8 把提交事务硬化为消费 `Promise<SubmitOutcome>`
 *      （settleSubmit 读 outcome.kind），undefined 直接 TypeError 且 then
 *      回调内抛出无人接 → submit-settled 永不派发 → machine 卡
 *      submitting → 输入框 readOnly + 草稿保留（发带附件/图片后输入框
 *      锁死的根因）。补丁补一行 return 对齐原版契约（patch 文件分发）。
 *   2) v1.0.3 的 npm files 白名单不含 vendor/everything，node_modules
 *      里恒缺 Everything.exe；ensureEverything 对缺失 exe 的 spawn 无
 *      error 监听（try/catch 包不住异步 'error' 事件）→ unhandled
 *      'error' 直接崩掉整个 dsh 进程（Windows 打包版启动失败根因）。
 *      注入存在性检查（缺失走 PowerShell 兜底搜索）+ child error 监听。
 *      注：两个产物文件均为 CRLF（v1.0.3 tarball 固定字节）；git apply
 *      对 LF patch + CRLF 文件会拒应用，但 pnpm 的应用器行尾宽容
 *      （实证：client.js 的 return 修复即此路径落地），patch 文件照常
 *      分发，锄点兑底按 CRLF 字节锄入。
 * - @dsh-external/dsh-drag-to-attachment（用户消息气泡的两项 KCoder
 *   增强，0.2.7 加）：① 复制按钮 — windows.ts 拒绝所有权限导致
 *   navigator.clipboard.writeText 静默失败，原版 copyUserText 吞错
 *   无 execCommand 兜底 → 修复兜底 + 错误处理；② 编辑按钮 — 原本点击
 *   把用户消息复制到输入框（方案 A 改为就地编辑：点击铅笔气泡内
 *   变 textarea + 发送/取消，发送直接调 conversation.send(newText) 走新
 *   一轮，session 落定无删除能力故保留原消息实际展示+新轮并存的方案）。
 *   patches 文件已并入宿主 @1.0.3.patch（曾有独立 __edit-copy@x.patch：
 *   其键名 pkgNameOf 产出带 __edit-copy 后缀、恒不匹配 dependencies，
 *   声明从未写入——0.2.7 至 0.2.10 增强实际从未应用的根因；同包
 *   pnpm 仅支持一个 patchedDependencies 声明，合并是唯一正解）
 * - dsh-video-preview（用户自装，genui 同款「自装也覆盖」）：VIDEO_EXTS
 *   把 "ts" 当 MPEG-TS 流抢先声明，TypeScript 源码全被视频播放器接管
 *   （matchFileViewer 按 priority 降序，video（0）压过内置 code 兑底
 *   （-100））。补丁删 "ts" 保留 m2ts；快照归档 .patches/dsh-video-preview。
 *   0.3.5 曾随「插件方已迭代吸收」误判退役，8-25 现场 0.1.1 复测
 *   "ts" 仍在——未吸收，复役
 *
 * 补丁经 pnpm patchedDependencies 固化在用户 profile：精确版本键
 * （name@ver）只对匹配版本应用；版本漂移时声明“未用”，由
 * allowUnusedPatches 容忍——pnpm 11（内置运行时 vendored 版本，对齐
 * 上游 packageManager）对补丁应用失败是硬错误 ERR_PNPM_PATCH_FAILED，
 * name-only 全版本强套 + 静默跳过是 pnpm 10 语义。@x（无版本锚）patch
 * 维持 name-only，失配面收窄到这一类（补丁链自愈兑底覆盖）。
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

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, WEB_PROFILE, dshHome, runPnpm } from './dsh-contract'

/**
 * 插件自愈日志（~/.dsh/logs/plugins-heal.log）：GUI 打包态看不到主
 * 进程 console，Windows 现场自愈链是否执行/在哪一步失败完全黑盒
 * （v0.2.0 的教训）。超 1MB 轮转为 .old；写失败不影响主流程。
 */
export function healLog(message: string): void {
  try {
    const dir = join(dshHome(), 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'plugins-heal.log')
    try {
      if (statSync(file).size > 1_048_576) renameSync(file, `${file}.old`)
    } catch {
      // 首次写入无旧文件
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // 日志失败不影响自愈主流程
  }
}

/** 分发的 patch 源目录（开发态仓库内；打包态 extraResources）。 */
function patchSource(): string {
  const packaged = join(process.resourcesPath ?? PROJECT_ROOT, 'profile-patches')
  if (existsSync(packaged)) return packaged
  return join(PROJECT_ROOT, 'profiles', 'web', 'patches')
}

/** 源目录内全部 patch 文件（`pkg@version.patch` 命名，可多包多版本）。 */
function patchFiles(source: string): string[] {
  try {
    return readdirSync(source).filter((f) => f.endsWith('.patch'))
  } catch {
    return [] // 源缺失/不可读：物化跳过，但锄点注入规则静态、仍可执行
  }
}

/**
 * 各插件补丁的生效特征：node half 文件包含标记串即视为补丁已应用。
 * 与 scripts/update-profile-plugins.mjs 的校验保持一致（两处新增插件
 * 补丁时同步更新）。
 */
const PATCH_MARKS: Record<string, Array<[file: string, mark: string]>> = {
  // 修复特征：附件分支的 return（原版 1.0.3 无此串；clearFiles 组合锚定
  // 防上游未来自己加同款串时误判）
  // KCoder 编辑/复制增强标记（已并入宿主 patch；commitEditInPlace /
  // editBtnStyle.PRIMARY 都是 KCoder 引入，足够稳定不可误判）
  '@dsh-external/dsh-drag-to-attachment': [
    ['lib/client.js', "clearFiles()\n        return { kind: 'success' }"],
    // Everything spawn 防崩修复（单行 mark：即便无读侧行尾归一化也不受
    // CRLF 产物影响）
    ['lib/index.js', "child.on('error', () => {})"],
    ['lib/client.js', "editBtnStyle.PRIMARY = 'kcoder-edit-primary'"],
    // 就地编辑发送修复版特征：scoped conversation 获取（旧版根 ctx 直取
    // send 恒落空，此 mark 缺失 → 自愈链重放新 patch）
    ['lib/client.js', 'activeCtx.sessions.scope(curId)'],
  ],
  // 修复特征：扩展表无 ts（原版 "3g2", "ts", "m2ts"；根级 client.js）
  'dsh-video-preview': [['client.js', '"3g2", "m2ts"']],
}

/**
 * 已退役的分发补丁包（上游持续迭代，补丁不再需要）：现场残留的旧
 * patch 文件与声明由自愈链回收（ensureProfilePatches 的文件回收步骤
 * + ensurePatchDeclared 的缺失文件声明摘除）。
 */
const RETIRED_PATCH_PKGS = ['dsh-plugin-genui', 'dsh-context', 'dsh-better-sidebar']

/**
 * mark 缺失时的锄点注入兑底（与 patch 内容等价；pnpm patch 机制在任何
 * 平台/版本下静默失败时的第三层保险——锄不中或多处命中则跳过留警告，
 * 绝不盲改）。锄点基于当前锁定版本的产物字节。
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
    // video-preview 复役锄点：原版扩展表含 "ts"（单次出现），删之留
    // m2ts——与 patch 内容等价的第三层兑底
    pkg: 'dsh-video-preview', file: 'client.js',
    mark: '"3g2", "m2ts"',
    anchor: '"3g2", "ts", "m2ts"',
    replace: '"3g2", "m2ts"',
  },
  {
    // rc.8 提交事务硬化后 wrap 的附件分支必须返回 SubmitOutcome，
    // 否则 settleSubmit 读 undefined.kind 炸 → 输入框永久锁死。
    // 目标文件 CRLF（v1.0.3 tarball 固定字节），锄点与注入均按 \r\n
    pkg: '@dsh-external/dsh-drag-to-attachment', file: 'lib/client.js',
    mark: "clearFiles()\n        return { kind: 'success' }",
    anchor: "this.releaseDraftImages(attachments)\r\n        clearFiles()",
    inject: "\r\n        return { kind: 'success' }",
  },
  {
    // v1.0.3 npm files 白名单排除 vendor/everything → node_modules 恒缺
    // Everything.exe，ensureEverything 对缺失 exe 的 spawn 无 error 监听
    // → unhandled 'error' 崩掉 dsh 进程（spawn ENOENT 异步派发，try/catch
    // 包不住）。锄入：spawn 前存在性检查（缺失则跳过，windowsSearch 有
    // PATH es.exe / PowerShell 兜底）+ child.on('error') 接异步失败。
    // 目标文件 CRLF（v1.0.3 tarball 固定字节），锄点与注入均按 \r\n；
    // patch 文件同步分发此修复（pnpm 应用器行尾宽容）
    pkg: '@dsh-external/dsh-drag-to-attachment', file: 'lib/index.js',
    mark: "child.on('error', () => {})",
    anchor: "  try {\r\n    const child = spawn(EVERYTHING_EXE, ['-startup'], {\r\n      detached: true, stdio: 'ignore', windowsHide: true,\r\n    })\r\n    child.unref()\r\n  } catch (error) {",
    replace: "  try {\r\n    await access(EVERYTHING_EXE, constants.F_OK)\r\n  } catch (error) {\r\n    return\r\n  }\r\n  try {\r\n    const child = spawn(EVERYTHING_EXE, ['-startup'], {\r\n      detached: true, stdio: 'ignore', windowsHide: true,\r\n    })\r\n    child.on('error', () => {})\r\n    child.unref()\r\n  } catch (error) {",
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
      healLog(`[patches] 兑底注入跳过（锄点 ${hits} 处命中）：${rule.pkg}/${rule.file}`)
      continue
    }
    const next = rule.replace !== undefined
      ? text.replace(rule.anchor, rule.replace)
      : text.replace(rule.anchor, rule.anchor + (rule.inject ?? ''))
    try {
      writeFileSync(file, next)
      console.log(`[profile-patches] 已兑底注入：${rule.pkg}/${rule.file}`)
      healLog(`[patches] 已兑底注入：${rule.pkg}/${rule.file}`)
    } catch (error) {
      console.warn(`[profile-patches] 兑底注入写入失败（${rule.pkg}/${rule.file}）：`, error)
      healLog(`[patches] 兑底注入写入失败（${rule.pkg}/${rule.file}）：${String(error)}`)
    }
  }
}

/**
 * 补丁是否已生效：逐 patch 按包名特征校验；插件未安装视为已满足
 * （后续 dsh plugin install 时 pnpm 对匹配版本自动应用）；带版本的
 * 声明在版本漂移时不应用（「未用」），锄点兑底与自愈链据此跳过。
 * mark 匹配前把产物行尾归一化为 LF——drag-to-attachment 的 lib 是
 * CRLF 文件（v1.0.3 tarball 固定字节），跨行组合 mark 按字节匹配会恒
 * 失配，导致每次启动误判未生效而反复 install 重放（阻塞主进程）。
 */
function patchApplied(profileDir: string, files: string[]): boolean {
  for (const f of files) {
    const pkg = pkgNameOf(f)
    const marks = PATCH_MARKS[pkg]
    if (!marks) continue
    const modDir = join(profileDir, 'node_modules', pkg)
    if (!existsSync(modDir)) continue
    if (!patchVersionMatches(f, modDir)) continue
    for (const [rel, mark] of marks) {
      const file = join(modDir, rel)
      if (!existsSync(file) || !readFileSync(file, 'utf8').replace(/\r\n/g, '\n').includes(mark)) {
        return false
      }
    }
  }
  return true
}

/**
 * 幂等声明 patchedDependencies，声明严格跟随 profile dependencies
 * 实态（依赖图真相）：
 * - 包在 manifest dependencies 而未声明 → 补写（未装但已声明依赖也算
 *   ——install 时进依赖图，补丁须先就位；用户自装受补丁覆盖的插件
 *   后下次启动在此补声明，marks 校验未过则锄点注入/重装自愈）
 * - 包已声明但不在 dependencies（预置撤除后残留/用户卸载）→ 摘除该行
 *   （allowUnusedPatches 已容忍未用声明，摘除仍保持配置卫生）；
 *   摘除范围仅限本模块分发的包，用户手动声明的其它补丁不动
 * - 声明键用精确版本（name@ver，patch 文件名的 @ver 段）：pnpm 11 对
 *   失配补丁硬错误，精确键让漂移版本不应用（“未用”）；@x 类维持
 *   name-only；同时确保 allowUnusedPatches: true 在位
 * 返回声明操作是否执行到位（yaml 缺锚点等失败降级继续）。
 */
function ensurePatchDeclared(profileDir: string, names: string[]): boolean {
  const yamlPath = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(yamlPath)) return false
  let yaml = readFileSync(yamlPath, 'utf8')
  let changed = false
  let deps: ReadonlySet<string> | undefined
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown> }
    deps = new Set(Object.keys(manifest.dependencies ?? {}))
  } catch {
    // manifest 缺失/损坏：无法判定实态，不增不删（后续 install 也会因
    // manifest 崩，修复它不归本模块）
  }
  // pnpm 11 语义配套：未用声明容忍（精确键漂移/摘除残留都不再报
  // ERR_PNPM_UNUSED_PATCH）
  if (!/^allowUnusedPatches:/m.test(yaml)) {
    const topAnchor = 'nodeLinker: hoisted\n'
    if (yaml.includes(topAnchor)) {
      yaml = yaml.replace(
        topAnchor,
        `${topAnchor}# KCoder：未用补丁声明容忍（精确版本键 + 实装版本漂移时声明未用不报错）\nallowUnusedPatches: true\n`,
      )
      changed = true
    }
  }
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)
  // 该包的任意声明行：name-only 与 name@ver 两种键形态（scoped 带引号，
  // @ver 在引号内）；兼容历史写入的裸键
  const declLineOf = (pkg: string): RegExp =>
    new RegExp(
      String.raw`^  (?:'${escapeRe(pkg)}(?:@[^']+)?'|${escapeRe(pkg)}(?:@[^:\s'"]+)?)?: patches/[^\n]*\n?`,
      'gm',
    )
  if (deps !== undefined) {
    for (const n of names) {
      const pkg = pkgNameOf(n)
      if (deps.has(pkg)) continue
      const next = yaml.replace(declLineOf(pkg), '')
      if (next !== yaml) {
        yaml = next
        changed = true
        console.log(`[profile-patches] 已摘除未用补丁声明（包不在 dependencies）：${pkg}`)
        healLog(`[patches] 已摘除未用补丁声明（包不在 dependencies）：${pkg}`)
      }
    }
  }
  // 退役/缺失回收：本链管理的包（含已退役），声明行引用的 patch 文件
  // 已不在现场（发行侧摘除后由回收步骤删除，或现场被手动清理）——残留
  // 声明会让 pnpm install 对缺失文件报错，摘除之；范围限管理包，用户
  // 自建补丁声明不受影响
  const managedPkgs = new Set([...Object.keys(PATCH_MARKS), ...RETIRED_PATCH_PKGS])
  const recycled = yaml.replace(
    /^ {2}(?:'[^']+'|[^:\n]+): patches\/(\S+)\n?/gm,
    (line, file) => (managedPkgs.has(pkgNameOf(file)) && !existsSync(join(profileDir, 'patches', file)) ? '' : line),
  )
  if (recycled !== yaml) {
    yaml = recycled
    changed = true
    console.log('[profile-patches] 已摘除引用缺失文件的退役补丁声明')
    healLog('[patches] 已摘除引用缺失文件的退役补丁声明')
  }
  // 只发生摘除（deps 不可判/无缺项）时也要落盘，否则摘除丢失；
  // 全部摘完时连块头带注释一起移除，防空块让 pnpm yaml 解析歧义
  const emptyBlock = changed && yaml.match(/: patches\//) === null
  if (deps === undefined || emptyBlock) {
    if (emptyBlock) {
      yaml = yaml
        .replace(/^patchedDependencies:\n(?:[ \t].*\n?)*/m, '')
        .replace(/\n{2,}/, '\n')
    }
    if (changed) writeFileSync(yamlPath, yaml)
    return true
  }
  const declKeyOf = (n: string): string => {
    const pkg = pkgNameOf(n)
    const vm = /@([^@]+)\.patch$/.exec(n)
    return vm === null || vm[1] === 'x' ? pkg : `${pkg}@${vm[1]}`
  }
  // 键形态迁移：name-only → 精确版本键（@x 类除外）。老版本（v0.2.9 及
  // 之前的打包/脚本）写 name-only 声明，且其缺失检测不识别精确键——
  // 升级后首次启动会把精确键现场误判缺失而追加 name-only（两种形态并
  // 存）；name-only 对漂移版本强套 patch 在 pnpm 11 下是硬错误
  // PATCH_FAILED，既有精确键时 name-only 是冗余直接摘除，无则升级
  for (const n of names) {
    const pkg = pkgNameOf(n)
    const vm = /@([^@]+)\.patch$/.exec(n)
    if (vm === null || vm[1] === 'x' || !deps.has(pkg)) continue
    const nameOnly = new RegExp(
      String.raw`^  (?:'${escapeRe(pkg)}'|${escapeRe(pkg)}): patches/[^\n]*\n`,
      'gm',
    )
    if (!nameOnly.test(yaml)) continue
    const exact = new RegExp(
      String.raw`^  (?:'${escapeRe(pkg)}@[^']+'|${escapeRe(pkg)}@[^:\s'"]+): patches/`,
      'm',
    )
    // 老代码可反复追加同名 name-only 行：首处升级为精确键，其余摘除
    // （全局替换会把每一行都变成重复精确键，yaml 重复键 pnpm 拒解析）
    let upgraded = false
    yaml = exact.test(yaml)
      ? yaml.replace(nameOnly, '')
      : yaml.replace(nameOnly, () => {
          if (upgraded) return ''
          upgraded = true
          return `  ${yamlKeyOf(declKeyOf(n))}: patches/${n}\n`
        })
    changed = true
    console.log(`[profile-patches] 补丁声明键形态已规范（name-only → 精确键/摘除冗余）：${pkg}`)
    healLog(`[patches] 补丁声明键形态已规范（name-only → 精确键/摘除冗余）：${pkg}`)
  }
  const missing = names.filter(
    (n) => deps.has(pkgNameOf(n)) && !declLineOf(pkgNameOf(n)).test(yaml),
  )
  if (missing.length === 0) {
    if (changed) writeFileSync(yamlPath, yaml)
    return true
  }
  const entries = missing.map((n) => `  ${yamlKeyOf(declKeyOf(n))}: patches/${n}`).join('\n')
  const m = yaml.match(/^patchedDependencies:\n(?:[ \t].*\n?)*/m)
  if (m) {
    // 已有块：新条目追加到块尾（replace 避免 m[0]
    // 与文件头的偏移错位）
    yaml = yaml.replace(m[0], `${m[0]}${entries}\n`)
  } else {
    const anchor = 'nodeLinker: hoisted\n'
    if (!yaml.includes(anchor)) {
      // 缺锚点无法补写：仅落盘已有的摘除
      if (changed) writeFileSync(yamlPath, yaml)
      return false
    }
    // 声明块逐 patch 生成：精确版本键（@x 类除外）——漂移版本不应用，
    // 声明未用由 allowUnusedPatches 容忍（pnpm 11 语义）
    yaml = yaml.replace(
      anchor,
      `${anchor}patchedDependencies:
  # 上游插件缺陷补丁（app 启动幂等物化）：精确版本键，只对匹配版本应用；
  # 版本漂移时声明未用由 allowUnusedPatches 容忍（pnpm 11 语义）。
${entries}
`,
    )
  }
  writeFileSync(yamlPath, yaml)
  return true
}

/**
 * files 不可用（patch 源缺失）时的全量校验哨兵：`@x.patch` 尾巴的唯一
 * 用途是喂给 patchApplied 的包名提取器，覆盖 PATCH_MARKS 全部包。
 */
const KNOWN_PATCH_SENTINELS = [
  '@dsh-external__dsh-drag-to-attachment@x.patch',
  'dsh-video-preview@x.patch',
]

/**
 * 从 patch 文件名提取包名：剥 `@version.patch` 尾巴；scoped 包用 pnpm
 * 惯例的 `@scope__name` 双下划线形态（带 `/` 的文件名会破坏非递归
 * readdir 物化链），首个 `__` 还原为 `/`。非 scoped 名不含 `__` 不受影响。
 */
function pkgNameOf(patchFile: string): string {
  return patchFile.replace(/@[^@]+\.patch$/, '').replace(/^(@[^/]*?)__/, '$1/')
}

/**
 * 补丁与实装版本门控：patch 按特定版本产物字节生成（文件名 @ver 段），
 * 版本漂移后 hunk 必然失配——pnpm 应用时 WARN 跳过（pnpm 10 行为；11 为
 * 硬错误），锄点锚点同样按版本字节写死，install 重放只是让 pnpm 再 WARN
 * 一次：自愈不可能成功。视为「不适用」而非缺失，避免每次启动空转一轮
 * pnpm install（用户把插件升到 patch 目标版本之外：better-sidebar npm
 * 0.14.0 → git 0.15.2 实证，0.15.2 无 diff pill 功能属产品取舍而非自愈
 * 缺口——该补丁已于 2026-08-25 随迭代退役，见 RETIRED_PATCH_PKGS）。
 * @x 后缀（无版本约束：drag-to-attachment 增强/KNOWN 哨兵）不
 * 设门；package.json 不可读时放行，交 marks 校验兑底判定。
 */
function patchVersionMatches(patchFile: string, modDir: string): boolean {
  const m = /@([^@]+)\.patch$/.exec(patchFile)
  if (m === null || m[1] === 'x') return true
  try {
    const installed = (JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf8')) as { version?: string }).version
    return installed === m[1]
  } catch {
    return true
  }
}

/**
 * YAML 声明键：`@` 是 YAML 保留指示符，scoped 包名必须单引号包裹，
 * 否则 pnpm 的 yaml 解析器拒解析（install 整体失败）。声明与检查两处
 * 用同一形态，避免误判未声明而重复追加。
 */
function yamlKeyOf(pkg: string): string {
  return pkg.startsWith('@') ? `'${pkg}'` : pkg
}

/**
 * 幂等物化（dsh 启动前调用）：patch 文件 + 声明就位；插件已装但补丁
 * 未生效时跑一次 pnpm install 应用（PATH 增强在 index.ts 入口完成）。
 */
export function ensureProfilePatches(): void {
  try {
    const source = patchSource()
    const files = patchFiles(source)
    const profileDir = join(dshHome(), 'profiles', WEB_PROFILE)
    // 早退仅限「profile 未初始化」（node_modules 必空，注入也无对象）；
    // 其余前置失败（patch 源缺失、声明写入失败）只降级不中断——锄点
    // 注入规则是静态的，不依赖 patch 文件在场，任何一步都应尽量修到底
    // （v0.2.0 的教训：早退 return 会把裸装现场留到引擎启动报错）。
    if (!existsSync(join(profileDir, 'pnpm-workspace.yaml'))) {
      console.warn('[profile-patches] profile 尚未初始化（pnpm-workspace.yaml 缺失），跳过')
      healLog('[patches] profile 尚未初始化（pnpm-workspace.yaml 缺失），跳过')
      return
    }
    if (files.length === 0) {
      console.warn('[profile-patches] patch 源缺失，跳过物化:', source)
      healLog(`[patches] patch 源缺失，跳过物化（仅锄点注入可用）: ${source}`)
      enforcePatchFallbacks(profileDir)
      healLog(
        patchApplied(profileDir, KNOWN_PATCH_SENTINELS)
          ? '[patches] 源缺失但锄点注入后 marks 全部在位'
          : '[patches] 源缺失且 marks 仍有缺失（下次启动重试）',
      )
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
        healLog(`[patches] ${f} 行尾已归一化为 LF（源疑似 CRLF）`)
      }
    }
    // 1.5) 退役补丁回收：曾由本链分发的包，patch 从发布物摘除（上游
    //    迭代不再需要）后，现场旧文件不会自行消失——版本恰好匹配时
    //    补丁还会继续应用（违背退役意图），残留声明则让 install 对缺失
    //    文件报错。回收范围仅限本链管理的包（含已退役），用户自建
    //    patch 文件不带这些包名不受影响；声明由第 2 步同步摘除
    const managed = new Set([...Object.keys(PATCH_MARKS), ...RETIRED_PATCH_PKGS])
    for (const f of readdirSync(join(profileDir, 'patches'))) {
      if (!f.endsWith('.patch') || files.includes(f)) continue
      if (!managed.has(pkgNameOf(f))) continue
      rmSync(join(profileDir, 'patches', f))
      console.log(`[profile-patches] 已回收退役补丁：${f}`)
      healLog(`[patches] 已回收退役补丁：${f}`)
    }
    // 2) patchedDependencies 声明（幂等）
    if (!ensurePatchDeclared(profileDir, files)) {
      console.warn('[profile-patches] 声明写入失败（缺 nodeLinker: hoisted 锚点）')
      healLog('[patches] 声明写入失败（缺 nodeLinker: hoisted 锚点），降级继续')
    }
    // 3) 生效校验与修复：插件已装但补丁未生效时，**锄点注入优先**
    //    （纯字节操作：无平台差异、无 pnpm 依赖、毫秒级完成）——
    //    v0.2.0 的教训：install 重放在 Windows 现场可能慢/失败/静默
    //    跳过（spawnSync 还会阻塞主进程至多 10 分钟），作为兑底而非
    //    首选。注入没全中（版本漂移致锄点失配）才回退 install 重放，
    //    让 pnpm 重新解包应用 name-only 补丁。
    //    插件未装则声明就位即可（后续安装时 pnpm 自动应用）。
    if (patchApplied(profileDir, files)) {
      healLog('[patches] 补丁全部生效，无需自愈')
      return
    }
    console.warn('[profile-patches] 补丁未生效，优先锄点注入修复 …')
    healLog('[patches] 补丁未生效，优先锄点注入修复 …')
    enforcePatchFallbacks(profileDir)
    if (patchApplied(profileDir, files)) {
      healLog('[patches] 锄点注入后补丁全部生效（未跑 install）')
      return
    }
    healLog('[patches] 注入后仍有 mark 缺失，回退 pnpm install 重放 …')
    const r = runPnpm(['install'], profileDir, 600_000)
    healLog(
      `[patches] pnpm install exit=${String(r.status)}` +
        (r.status !== 0 ? ` stderr=${(r.stderr ?? '').slice(0, 800)}` : ''),
    )
    if (r.status !== 0) {
      console.error('[profile-patches] pnpm install 失败:', r.stderr?.slice(0, 2000) ?? r.error)
    }
    if (!patchApplied(profileDir, files)) {
      healLog('[patches] install 后仍未生效，最后一次锄点注入 …')
      enforcePatchFallbacks(profileDir)
    }
    healLog(
      patchApplied(profileDir, files)
        ? '[patches] 自愈完成：补丁全部生效'
        : '[patches] 自愈失败：仍有 mark 缺失（插件可能裸装报错）',
    )
  } catch (error) {
    console.error('[profile-patches] 物化失败:', error)
    healLog(`[patches] 物化异常：${String(error)}`)
  }
}
