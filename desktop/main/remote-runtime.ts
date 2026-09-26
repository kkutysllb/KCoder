/**
 * 远端服务需要的本地路径解析：runtime 目录与远端 Node。
 *
 * 单独成文件是为了让 `remote-connections` 只关心编排——这里处理的都是"开发态与
 * 打包态落点不同"的琐碎事。
 *
 * @module desktop/main/remote-runtime
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureBundledRuntime, resolveRuntime } from './dsh-contract'
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

/**
 * 本地 runtime 目录（含 `lib/bin.js` 与 `node_modules`）。
 *
 * 优先从 `resolveRuntime()` 的实际入口反推——开发态与打包态的落点不同，而
 * "解析出来的那条命令"是唯一同时正确的事实源；反推不成立时退回内置解压目录。
 * @returns 目录绝对路径；不可用时为 null。
 */
export function runtimeDirForRemote(): string | null {
  const resolved = resolveRuntime()
  if (resolved !== null) {
    for (const arg of resolved.args) {
      if (!arg.endsWith(join('lib', 'bin.js'))) continue
      const found = usable(dirname(dirname(arg)))
      if (found !== null) return found
    }
  }
  return usable(ensureBundledRuntime())
}

/**
 * 该主机上可用的 Node 可执行文件。
 *
 * 直接取世界描述里的 `node`：引导流程已经把那台机器上的用户态 Node 路径记在
 * `worlds.json` 里（免 sudo 安装，路径是绝对路径），不必再探测一次。
 * @param spec - 已注册的世界描述。
 * @returns 远端 Node 绝对路径。
 */
export function remoteDshBin(spec: RemoteWorldSpec): string {
  return spec.node
}
