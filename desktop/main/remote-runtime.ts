/**
 * 远端服务需要的本地路径解析：runtime 目录与远端 Node。
 *
 * 单独成文件是为了让 `remote-connections` 只关心编排——这里处理的都是"开发态与
 * 打包态落点不同"的琐碎事。
 *
 * @module desktop/main/remote-runtime
 */

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { ensureBundledRuntime, resolveDshCommand } from './dsh-contract'
import type { RemoteWorldSpec } from './remote-world'

/** runtime 目录是否可用（必须同时有入口与依赖树）。 */
function usable(dir: string | null): string | null {
  if (dir === null) return null
  const bin = join(dir, 'lib', 'bin.js')
  const modules = join(dir, 'node_modules')
  if (!existsSync(bin) || !existsSync(modules)) return null
  try {
    if (!statSync(modules).isDirectory()) return null
  } catch {
    return null
  }
  return dir
}

/** 入口在命令里的相对位置（与 dsh-contract 的 BUNDLED_BIN 同口径）。 */
const BIN_SUFFIX = join('lib', 'bin.js')

/**
 * 该目录能否直接搬到另一台机器。
 *
 * 开发态的"运行时"是 monorepo 的 `apps/cli`，其 `node_modules/@deepseek-ai/*`
 * **全是符号链接**（指向 `vendor/`），搬过去就是一堆断链；打包态的运行时是扁平
 * 真实目录。两者都能跑，但只有后者可搬运——所以优先选自足的那份
 * （2026-09-26 实机：照搬开发态会让远端起不来）。
 * @param dir - 候选运行时目录。
 * @returns 依赖树是否为真实目录。
 */
function selfContained(dir: string): boolean {
  const scoped = join(dir, 'node_modules', '@deepseek-ai')
  try {
    if (!statSync(scoped).isDirectory()) return false
    const sample = readdirSync(scoped)[0]
    if (sample === undefined) return false
    return !lstatSync(join(scoped, sample)).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * 本地 runtime 目录（含 `lib/bin.js` 与 `node_modules`）。
 *
 * 候选顺序刻意把**自足的扁平运行时**排在前面（同机安装的正式版
 * `<userData>/kcoder-runtime` 就是这种），开发态克隆那份只作兜底——它靠 tar
 * 解引用符号链接也能搬，但体积与语义都更差。
 * @returns 目录绝对路径；不可用时为 null（调用方应把 {@link runtimeProbeDetail} 一并报出）。
 */
export function runtimeDirForRemote(): string | null {
  const candidates: string[] = []
  const userData = app.getPath('userData')
  candidates.push(join(userData, 'kcoder-runtime'))
  // 开发态 userData 带 -dev 后缀；同机安装的正式版运行时在前缀路径下，是扁平自足的那份。
  candidates.push(join(userData.replace(/-dev$/, ''), 'kcoder-runtime'))
  const bundled = ensureBundledRuntime()
  if (bundled !== null) candidates.push(bundled)
  const command = resolveDshCommand()
  for (const arg of command?.baseArgs ?? []) {
    if (arg.endsWith(BIN_SUFFIX)) candidates.push(dirname(dirname(arg)))
  }
  const usableOnes = candidates.map(usable).filter((dir): dir is string => dir !== null)
  return usableOnes.find(selfContained) ?? usableOnes[0] ?? null
}

/**
 * 失败时的诊断：把试过的候选列出来。
 *
 * "不可用"三个字不足以排查（这次就是我自己被它挡住），而候选来自运行时解析，
 * 打印出来就能一眼看出是解析没命中还是目录不完整。
 * @returns 人读的候选清单。
 */
export function runtimeProbeDetail(): string {
  const lines: string[] = []
  const userData = app.getPath('userData')
  for (const dir of [join(userData, 'kcoder-runtime'), join(userData.replace(/-dev$/, ''), 'kcoder-runtime'), ensureBundledRuntime() ?? '']) {
    if (dir === '') continue
    lines.push(`${usable(dir) !== null ? (selfContained(dir) ? '✅ 可用且自足' : '⚠️ 可用但依赖为符号链接') : '❌ 不可用'}  ${dir}`)
  }
  const command = resolveDshCommand()
  lines.push(`解析来源: ${command === null ? '（无）' : `${command.source} · ${command.describe}`}`)
  for (const arg of command?.baseArgs ?? []) {
    if (arg.endsWith(BIN_SUFFIX)) lines.push(`入口候选: ${arg} → ${usable(dirname(dirname(arg))) !== null ? '可用' : '不可用'}`)
  }
  return lines.join('\n')
}

/**
 * 该主机上可用的 Node 可执行文件。
 *
 * 直接取世界描述里的 `node`：引导流程已经把那台机器上的用户态 Node 路径记在
 * `worlds.json` 里（免 sudo 安装，绝对路径），不必再探测一次。
 * @param spec - 已注册的世界描述。
 * @returns 远端 Node 绝对路径。
 */
export function remoteDshBin(spec: RemoteWorldSpec): string {
  return spec.node
}

/**
 * 本地 runtime 的引擎版本。
 *
 * 以 `@deepseek-ai/dsh` 自己的 version 为准（它就是被装到远端的那份元包），
 * 不读 runtime 根的 package.json——那个文件的依赖是 `workspace:` 协议，
 * 对远端 npm 毫无用处。
 * @param runtimeDir - 本地 runtime 目录。
 * @returns 版本串；读不到时为 null。
 */
export function localEngineVersion(runtimeDir: string): string | null {
  // `@deepseek-ai/dsh` 只是**发布形态**的元包；KCoder 的 runtime 是逐个引擎包组装的，
  // 里面**没有**它。所以先找它，找不到就取同版本线的 `dsh-app-boot`——版本线一致，
  // 而"取不到就装 latest"会把远端带到另一条线上去（实测装成 0.1.5-rc.3，入口与 CLI
  // 行为都与本地不符）。
  for (const name of ['dsh', 'dsh-app-boot']) {
    try {
      const pkg = JSON.parse(readFileSync(join(runtimeDir, 'node_modules', '@deepseek-ai', name, 'package.json'), 'utf8')) as { version?: string }
      if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
    } catch {
      // 换下一个候选
    }
  }
  return null
}

/**
 * 需要从 npm 补到远端的 **linux-x64 原生包**规格。
 *
 * 收集两路来源，缺一不可：
 * 1. 各包 `optionalDependencies` 里声明为 linux-x64 的条目；
 * 2. 本地树里名字本身就以 linux-x64 结尾的包。
 *
 * **不按"本地已经存在"跳过**——本地那份是 macOS 构建留下的空壳（只有
 * `prebuilds.json`），跳过就等于把 linux 二进制整个漏掉，实机报
 * `Cannot find module '…/node-addon-system-linux-x64/bin/glibc/system.node'`。
 * @param runtimeDir - 本地 runtime 目录。
 * @returns `名称@版本` 列表；版本缺失或为 workspace 协议且本地无实体时跳过。
 */
export function localAddonSpecs(runtimeDir: string): string[] {
  const modules = join(runtimeDir, 'node_modules')
  const specs = new Map<string, string>()
  const versionOf = (name: string): string | null => {
    try {
      const pkg = JSON.parse(readFileSync(join(modules, name, 'package.json'), 'utf8')) as { version?: string }
      return typeof pkg.version === 'string' ? pkg.version : null
    } catch {
      return null
    }
  }
  const isLinuxX64 = (name: string): boolean => /-linux-x64(-gnu)?$/.test(name)
  const visit = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const pkgPath = join(dir, entry, 'package.json')
      if (!existsSync(pkgPath)) continue
      // 名字本身就是 linux-x64 的包：直接用装好的版本。
      const ownName = entry.startsWith('@') ? entry : entry
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: string
          version?: string
          optionalDependencies?: Record<string, string>
        }
        if (typeof pkg.name === 'string' && isLinuxX64(pkg.name) && typeof pkg.version === 'string') {
          specs.set(pkg.name, pkg.version)
        }
        for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
          if (!isLinuxX64(name)) continue
          if (specs.has(name)) continue
          // workspace: 协议对远端 npm 无意义，取本地实体版本兜底。
          const declared = pkg.optionalDependencies?.[name] ?? ''
          const range = declared.startsWith('workspace:') ? versionOf(name) : declared
          if (range !== null && range !== '') specs.set(name, range)
        }
        void ownName
      } catch {
        // 损坏的 package.json 跳过
      }
    }
  }
  visit(modules)
  for (const scope of existsSync(modules) ? readdirSync(modules) : []) {
    if (scope.startsWith('@')) visit(join(modules, scope))
  }
  return [...specs].map(([name, version]) => `${name}@${version}`).sort()
}
