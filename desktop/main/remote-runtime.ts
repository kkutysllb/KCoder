/**
 * 远端服务需要的本地路径解析：runtime 目录与远端 Node。
 *
 * 单独成文件是为了让 `remote-connections` 只关心编排——这里处理的都是"开发态与
 * 打包态落点不同"的琐碎事。
 *
 * @module desktop/main/remote-runtime
 */

import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs'
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
