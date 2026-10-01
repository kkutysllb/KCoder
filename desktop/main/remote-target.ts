/**
 * 远端目标平台（三元组）与原生包规格的派生规则。
 *
 * 为什么**单独成文件且不引入任何依赖**：这套判据正是 2026-10-01 事故的根因
 * ——`localAddonSpecs` 把命名族硬编码成 `-linux-x64`，aarch64 目标机被 npm 以
 * `EBADPLATFORM` 整单拒绝，而失败被哨兵字符串吞掉，于是留下一个永久粘滞的坏状态。
 * 判据必须能被**离线断言**（`scripts/check-remote-addon-specs.mjs`）——依赖
 * electron 或 node:fs 的话，检查脚本就没法直接跑它。
 *
 * 事实依据（2026-10-01 实机核验）：
 * - 本地 runtime 树的 `optionalDependencies` 已声明全部平台变体，故谓词只需从
 *   「常量」变成「按目标三元组生成的命名族」；
 * - 命名族的编码方式**因包而异**：多数是 `-linux-<cpu>[-gnu]`，`@img/sharp` 的
 *   musl 变体却是 `-linuxmusl-<cpu>`，而 `@deepseek-ai/node-addon-system-*`
 *   一个包内含 glibc + musl 两套（名称与 libc 无关）。⇒ libc 不能靠统一后缀映射，
 *   本轮明确只支持 linux/glibc。
 *
 * @module desktop/main/remote-target
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 远端目标平台。本轮只支持 Linux + glibc（见 {@link parseTarget} 的拒绝分支）。 */
export interface RemoteTarget {
  /** 只支持 linux：macOS 远端在引导流程更早的步骤就断了。 */
  os: 'linux'
  /** CPU 架构。 */
  cpu: 'x64' | 'arm64'
  /** C 库实现。musl 缺可信判据，本轮拒绝。 */
  libc: 'gnu'
}

/** 平台不受支持：message 是给人看的原因（可直接进 RemoteServerError 的 detail）。 */
export class RemoteTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteTargetError'
  }
}

/**
 * 把 `uname` 的输出规范化成目标三元组。
 *
 * **不认识就抛错，绝不退化成空清单**——那会复刻「静默装 0 个包」的原始事故。
 * @param os - `uname -s` 的原始值（如 `Linux`）。
 * @param arch - `uname -m` 的原始值（如 `aarch64`）。
 * @param libc - 探测到的 C 库（`gnu` / `musl`）。
 * @returns 规范化的目标三元组。
 * @throws {RemoteTargetError} 平台不受支持时。
 */
export function parseTarget(os: string, arch: string, libc: string): RemoteTarget {
  const system = os.trim().toLowerCase()
  if (system === 'darwin') {
    throw new RemoteTargetError('暂不支持 macOS 远端：引导流程的 Node 安装仍硬编码 linux- 前缀（bundle/dsh-ssh-remote/lib/provision.js）')
  }
  if (system !== 'linux') throw new RemoteTargetError(`不认识的远端系统：${os.trim() || '(空)'}`)

  const machine = arch.trim().toLowerCase()
  let cpu: RemoteTarget['cpu']
  if (machine === 'x86_64' || machine === 'amd64' || machine === 'x64') cpu = 'x64'
  else if (machine === 'aarch64' || machine === 'arm64') cpu = 'arm64'
  else throw new RemoteTargetError(`不认识的远端架构：${arch.trim() || '(空)'}`)

  const c = libc.trim().toLowerCase()
  if (c === 'musl') {
    throw new RemoteTargetError([
      '暂不支持 musl（Alpine）远端：',
      'node-addon-require-builtin 的 musl 变体名是 -linux-<cpu>-musl 而非 -gnu，',
      '本地 runtime 树又未声明任何 musl 变体，没有可信判据（2026-10-01 核验）。',
    ].join(''))
  }
  if (c !== 'gnu') throw new RemoteTargetError(`不认识的 C 库：${libc.trim() || '(空)'}`)

  return { os: 'linux', cpu, libc: 'gnu' }
}

/**
 * 该目标下原生包名可能带的后缀（命名族）。
 *
 * 两种都要收：`@koromix/koffi-linux-arm64` 只带平台，`node-addon-require-builtin-linux-arm64-gnu`
 * 还带 libc。
 * @param target - 目标三元组。
 * @returns 后缀列表。
 */
export function addonSuffixes(target: RemoteTarget): readonly string[] {
  return [`-linux-${target.cpu}`, `-linux-${target.cpu}-gnu`]
}

/**
 * 包名是否属于该目标平台。
 * @param name - 包名。
 * @param target - 目标三元组。
 * @returns 命中任一命名族后缀。
 */
export function matchesAddonTarget(name: string, target: RemoteTarget): boolean {
  return addonSuffixes(target).some(suffix => name.endsWith(suffix))
}

/** 三元组的短标签，用于日志、指纹与报错文案（如 `linux-arm64/gnu`）。 */
export function targetLabel(target: RemoteTarget): string {
  return `${target.os}-${target.cpu}/${target.libc}`
}

/**
 * 缺一不可的原生包名。
 *
 * 这两个正是本次事故里缺失的绑定：`cordis-plugin-loader` 装载即 require
 * `node-addon-require-builtin`，`dsh-app-boot` 的 host preparation 又要
 * `@deepseek-ai/node-addon-system`。清单**覆盖不足**时必须在安装**之前**响亮失败，
 * 而不是装完一堆再等 180 秒的就绪超时。
 * @param target - 目标三元组。
 * @returns 该目标下必须到位的包名。
 */
export function requiredAddonNames(target: RemoteTarget): readonly string[] {
  const platform = `linux-${target.cpu}`
  return [`node-addon-require-builtin-${platform}-gnu`, `@deepseek-ai/node-addon-system-${platform}`]
}

/**
 * 规格清单里缺失的必需包。
 * @param specs - `名称@版本` 列表。
 * @param target - 目标三元组。
 * @returns 缺失的包名（空数组 = 覆盖完整）。
 */
export function missingRequiredAddons(specs: readonly string[], target: RemoteTarget): readonly string[] {
  // 取 `名称@版本` 里的名称部分；作用域包的 leading `@` 不能当分隔符，故要求索引 > 0。
  const names = new Set(specs.map((spec) => {
    const at = spec.lastIndexOf('@')
    return at > 0 ? spec.slice(0, at) : spec
  }))
  return requiredAddonNames(target).filter(name => !names.has(name))
}

/**
 * 需要从 npm 补到远端的**目标平台**原生包规格。
 *
 * 收集两路来源，缺一不可：
 * 1. 各包 `optionalDependencies` 里声明为该目标平台的条目；
 * 2. 本地树里名字本身就属于该目标平台的包。
 *
 * **不按"本地已经存在"跳过**——本地那份是 macOS 构建留下的空壳（只有
 * `prebuilds.json`），跳过就等于把 linux 二进制整个漏掉，实机报
 * `Cannot find module '…/node-addon-system-linux-x64/bin/glibc/system.node'`。
 *
 * 判据走 {@link matchesAddonTarget}：按目标三元组生成命名族。写死成 `-linux-x64`
 * 的那版在 aarch64 目标机上被 npm 整单 `EBADPLATFORM` 拒绝，且失败被吞掉，留下永久
 * 粘滞的坏状态（2026-10-01 事故，见 plans/remote-arch-adaptation.md）。
 * @param runtimeDir - 本地 runtime 目录（含 `node_modules`）。
 * @param target - 远端目标三元组。
 * @returns `名称@版本` 列表；版本缺失或为 workspace 协议且本地无实体时跳过。
 */
export function localAddonSpecs(runtimeDir: string, target: RemoteTarget): string[] {
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
  const isTargetAddon = (name: string): boolean => matchesAddonTarget(name, target)
  const visit = (dir: string): void => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const pkgPath = join(dir, entry, 'package.json')
      if (!existsSync(pkgPath)) continue
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          name?: string
          version?: string
          optionalDependencies?: Record<string, string>
        }
        if (typeof pkg.name === 'string' && isTargetAddon(pkg.name) && typeof pkg.version === 'string') {
          specs.set(pkg.name, pkg.version)
        }
        for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
          if (!isTargetAddon(name)) continue
          if (specs.has(name)) continue
          // workspace: 协议对远端 npm 无意义，取本地实体版本兜底。
          const declared = pkg.optionalDependencies?.[name] ?? ''
          const range = declared.startsWith('workspace:') ? versionOf(name) : declared
          if (range !== null && range !== '') specs.set(name, range)
        }
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
