/**
 * 逐主机世界描述（`worlds.json`）的读取。
 *
 * 该文件由插件的引导流程写入。当前连接流程只取其中的**别名、远端 Node 与展示
 * 名**——"生成执行世界 overlay"那套已由"把服务跑在远端"取代（见
 * remote-server.ts 头注释）；此处保留读取即可。
 *
 * 历史背景：上游 SSH 世界是**部署所有、进程级、单主机**的——
 * `dsh-ssh` 的 `host` 是 OpenSSH 别名，`workspace` 是单值，而 `ctx.fs` /
 * `ctx.subprocess` / `ctx.sandbox` 都是单一服务名。因此「每个远程主机一个
 * sidecar」是唯一成立的编排，而每个 sidecar 需要一个**把自己那个世界装起来**
 * 的 overlay。静态 bundle 装不下逐主机数据，这一层就是补它的。
 *
 * 数据由引导流程写入（插件仓 `scripts/provision-remote-world.mjs --register`），
 * 与 `hosts.json` 同目录同 DSH_HOME 口径。
 *
 * @module desktop/main/remote-world
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-contract'

/** 一台已引导就绪的远程主机：装好 Node 与 helper、并有可用 ssh 别名。 */
export interface RemoteWorldSpec {
  /** 主机 id（与插件主机注册表的 id 一致）。 */
  hostId: string
  /** 展示名。 */
  name: string
  /** `~/.ssh/config` 里的 Host 别名——`dsh-ssh` 只接受别名，不接受 user@host。 */
  alias: string
  /** 远端 Node 可执行文件绝对路径。 */
  node: string
  /** 远端 helper 入口绝对路径。 */
  helper: string
  /** 上述 helper 入口的 SHA-256（不匹配即拒绝连接）。 */
  helperHash: string
  /** 远端默认工作区绝对路径。 */
  workspace: string
}

/** 描述文件：与插件共用的 `<DSH_HOME>/ssh-remote/` 目录。 */
export function remoteWorldsPath(): string {
  return join(dshHome(), 'ssh-remote', 'worlds.json')
}



/**
 * Read the registered worlds. A missing or malformed file is an empty list:
 * this feeds a menu, and a broken registry must not take the shell down.
 * @returns every registered world, in file order.
 */
export function readRemoteWorlds(): RemoteWorldSpec[] {
  const path = remoteWorldsPath()
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is RemoteWorldSpec => {
      const candidate = entry as Partial<RemoteWorldSpec>
      return typeof candidate.hostId === 'string' && candidate.hostId !== ''
        && typeof candidate.alias === 'string' && candidate.alias !== ''
        && typeof candidate.node === 'string' && candidate.node !== ''
        && typeof candidate.helper === 'string' && candidate.helper !== ''
        && typeof candidate.helperHash === 'string' && candidate.helperHash !== ''
        && typeof candidate.workspace === 'string' && candidate.workspace !== ''
    })
  } catch {
    return []
  }
}


